"""Posting mission events to Pi Hub (A35 §6.2, §7.4): the single drainer for the spool, and the batch client the
importer shares. A failed read of the outcome is never treated as a success: events leave the spool only on a 200,
or when the hub refuses them for what they are (a 4xx that isn't about the caller's key, route or rate)."""
import fcntl
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from .. import decisions, hub, shell
from . import spool
from .local import config_path, enabled, lock_path, log_path  # noqa: F401 (config_path: re-exported)
from .validate import load_contract

BATCH = 50
MAX_PASSES = 5  # events a hook appends during a pass go in the next one; a flood can't hold the lock past this
KEY_TIMEOUT = 2.0  # the Keychain can prompt; a hook must never wait on it
LATE_AFTER_S = 60  # an event older than this when posted is marked late (§6.2: spooled events keep their `at`)
# 4xx codes that say something is wrong with the caller's setup, not with the events: keep the spool and stop.
# 409 is the contract's "version": the hub doesn't accept this client's contract, so dropping would lose everything.
KEEP_CODES = {401, 404, 408, 409, 429}


def log(message: str) -> None:
    """One line to the drain log. Callers pass codes and counts only, never a key or a response body."""
    line = f"{hub.now_iso()} {message}\n"
    try:
        p = log_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass  # the log is a courtesy; a full disk must not fail a drain


@dataclass
class Outcome:
    kind: str  # ok, drop or keep
    code: int | None  # the HTTP status, None when unreachable
    detail: str = ""


@dataclass
class DrainResult:
    status: str  # disabled, busy, empty, done or stopped
    detail: str = ""
    posted: int = 0
    dropped: int = 0
    kept: int = 0
    skipped: list[str] = field(default_factory=list)  # sources left in the spool because they have no key


def key_names(source: str) -> tuple[str, str]:
    """(Keychain item, env variable) for a source's key."""
    return f"pi-hub-mission-{source}-key", f"HOME_MISSION_KEY_{source.upper().replace('-', '_')}"


async def source_key(source: str, runner) -> tuple[str | None, str | None]:
    item, env = key_names(source)
    return await decisions.hub_key(runner, item=item, timeout=KEY_TIMEOUT, env=env)


async def post_batch(client: httpx.AsyncClient, source: str, key: str, events: list[dict]) -> Outcome:
    """POST one batch of at most 50 events. The key goes in a header and nowhere else: nothing here logs it."""
    try:
        r = await client.post(f"/api/missions/events/{source}", json=events,
                              headers={"X-Mission-Contract": "1", "X-Hub-Deploy-Key": key})
    except httpx.TimeoutException:
        return Outcome("keep", None, "timed out")
    except httpx.HTTPError as e:
        return Outcome("keep", None, type(e).__name__)
    code = r.status_code
    if code == 200:
        return Outcome("ok", code)
    if code in KEEP_CODES or code >= 500 or code < 400:
        return Outcome("keep", code)
    return Outcome("drop", code)


def _late(event: dict, now: datetime) -> dict:
    """The event as posted: marked late when it sat in the spool, with its original `at` untouched."""
    try:
        at = datetime.fromisoformat(event["at"])
    except (KeyError, TypeError, ValueError):
        return event
    if at.tzinfo is not None and (now - at).total_seconds() > LATE_AFTER_S:
        return {**event, "late": True}
    return event


async def drain(client_factory: Callable[[], httpx.AsyncClient] = hub.make_client, runner=shell.run) -> DrainResult:
    """Post everything in the spool, once, if mission reporting is on and no other drain is running."""
    on, why = enabled()
    if not on:
        return DrainResult("disabled", why)
    lock = lock_path()
    lock.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return DrainResult("busy", "another drain holds the lock")
        return await _drain_locked(client_factory, runner)
    finally:
        os.close(fd)


async def _drain_locked(client_factory, runner) -> DrainResult:
    """Passes over the spool until one moves nothing (so events a hook appended during a pass, such as a session's
    last ones, are not left for a firing that may never come), at most MAX_PASSES."""
    entries = spool.read_all()
    if not entries:
        return DrainResult("empty", "the spool is empty")
    result = DrainResult("done")
    known = load_contract()["sources"]
    keys: dict[str, str] = {}
    async with client_factory() as client:
        if client.base_url.scheme != "https":  # never put a key on the wire in clear
            log("drain: stopped, the hub URL is not https")
            return _stopped(result, "HOME_MCP_HUB_URL isn't https, so keys aren't sent")
        for _ in range(MAX_PASSES):
            moved_before = result.posted + result.dropped
            stop = await _pass(client, runner, entries, known, keys, result)
            if stop:
                return _stopped(result, stop)
            if result.posted + result.dropped == moved_before:
                break
            entries = spool.read_all()
    if result.skipped:
        return _stopped(result, "no key for " + ", ".join(result.skipped))
    result.kept = len(spool.read_all())  # non-zero when MAX_PASSES ran out: those wait for the next drain
    return result


async def _pass(client, runner, entries: list[dict], known, keys: dict[str, str], result: DrainResult) -> str | None:
    """One pass over `entries`: the reason to stop the whole drain, or None. A source with no key is skipped (and
    not asked for again in later passes); the other sources still post."""
    unknown = [e["event"]["event_id"] for e in entries if e["source"] not in known]
    if unknown:  # a line for a source the contract doesn't have can never be sent
        spool.remove(unknown)
        result.dropped += len(unknown)
        log(f"drain: dropped {len(unknown)} events for an unknown source")
    by_source: dict[str, list[dict]] = {}
    for e in entries:
        if e["source"] in known and e["source"] not in result.skipped:
            by_source.setdefault(e["source"], []).append(e["event"])
    for source, events in by_source.items():
        if source not in keys:
            key, why = await source_key(source, runner)
            if key is None:
                log(f"drain: skipped, no key for source {source} ({why})")
                result.skipped.append(source)
                continue
            keys[source] = key
        now = datetime.now(timezone.utc)
        for i in range(0, len(events), BATCH):
            batch = events[i:i + BATCH]
            out = await post_batch(client, source, keys[source], [_late(e, now) for e in batch])
            ids = [e["event_id"] for e in batch]
            if out.kind == "ok":
                spool.remove(ids)
                result.posted += len(ids)
            elif out.kind == "drop":
                spool.remove(ids)
                result.dropped += len(ids)
                log(f"drain: hub refused {len(ids)} {source} events with HTTP {out.code}, dropped")
            else:
                reason = f"HTTP {out.code}" if out.code else out.detail
                log(f"drain: stopped, {reason}, kept the spool")
                return reason
    return None


def _stopped(result: DrainResult, reason: str) -> DrainResult:
    """Mark the result stopped; kept is whatever is still in the spool."""
    result.status = "stopped"
    result.detail = reason
    result.kept = len(spool.read_all())
    return result
