"""The Mac's mission spool (A35 §6.2): one JSON line per event, `{"event": ..., "source": ...}`, appended under flock.
Hooks only ever append here and never touch the network; the drainer posts later. Every event carries an event_id
(set at append time unless the caller already gave one, as the importer's deterministic ids do), so a replay is
harmless: Pi Hub dedupes by it.

Standard library only, with no relative imports: claude/hooks/mission-report.py loads this file by path so a hook
appends with exactly this line format, lock and cap."""
import fcntl
import json
import os
import tempfile
import uuid
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

CAP_BYTES = 5 * 1024 * 1024
KEEP_FRACTION = 0.8  # an overflow trims to this, so the next appends don't each rewrite the file


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def spool_path() -> Path:
    return Path(os.environ.get("HOME_MISSION_SPOOL") or "~/.claude/mission-spool.jsonl").expanduser()


@contextmanager
def locked(path: Path):
    """An exclusive flock on a sidecar file. The spool itself is replaced atomically on rewrite, so it can't carry
    the lock (a lock on a replaced inode protects nothing)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(f"{path}.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)  # closing releases the lock


def _parse(raw: bytes) -> dict | None:
    try:
        entry = json.loads(raw)
    except ValueError:
        return None
    ok = (isinstance(entry, dict) and isinstance(entry.get("event"), dict) and isinstance(entry.get("source"), str)
          and isinstance(entry["event"].get("event_id"), str))
    return entry if ok else None


def _line(entry: dict) -> bytes:
    return json.dumps(entry, separators=(",", ":")).encode("utf-8") + b"\n"


def _replace(path: Path, lines: list[bytes]) -> None:
    """Write `lines` as the whole spool: a temp file in the same directory, fsynced, renamed over it."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".spool-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.writelines(lines)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _raw_lines(path: Path) -> list[bytes]:
    try:
        return path.read_bytes().splitlines(keepends=True)
    except FileNotFoundError:
        return []


def append(event: dict, source: str, path: Path | None = None, cap: int = CAP_BYTES) -> str:
    """Append one event and return its event_id. The caller's dict isn't changed. When the file passes `cap`, the
    oldest lines go and a `gap` event says how many (see _trim)."""
    path = path or spool_path()
    event = dict(event)
    event.setdefault("event_id", str(uuid.uuid4()))
    line = _line({"event": event, "source": source})
    with locked(path):
        with open(path, "ab") as f:
            f.write(line)  # one write call: with O_APPEND and the lock, a line is never torn
            f.flush()
            os.fsync(f.fileno())
        if path.stat().st_size > cap:
            _trim(path, cap)
    return event["event_id"]


def _trim(path: Path, cap: int) -> None:
    """Drop the oldest lines until the file is under KEEP_FRACTION of the cap (the newest line always stays), then
    append one gap event per source that lost events. A dropped gap line folds into the new one's count."""
    lines = _raw_lines(path)
    total = sum(len(x) for x in lines)
    lost: dict[str, dict] = {}  # source -> {dropped, oldest_at, newest_at, initiative}
    drop = 0
    while drop < len(lines) - 1 and total > cap * KEEP_FRACTION:
        total -= len(lines[drop])
        drop += 1
    for raw in lines[:drop]:
        entry = _parse(raw)
        if entry is None:
            continue  # a torn line: nothing to report about it
        ev = entry["event"]
        info = lost.setdefault(entry["source"], {"dropped": 0, "oldest_at": None, "newest_at": None,
                                                 "initiative": None})
        body = ev.get("body") if isinstance(ev.get("body"), dict) else {}
        if ev.get("type") == "gap":
            info["dropped"] += body.get("dropped", 0) if isinstance(body.get("dropped"), int) else 0
            first, last = body.get("oldest_at"), body.get("newest_at")
        else:
            info["dropped"] += 1
            first = last = ev.get("at")
        info["oldest_at"] = info["oldest_at"] or first
        info["newest_at"] = last or info["newest_at"]
        info["initiative"] = ev.get("initiative") or info["initiative"]
    kept = lines[drop:]
    for source, info in lost.items():
        if info["dropped"] < 1 or not info["initiative"]:
            continue
        body = {"dropped": info["dropped"]}
        body.update({k: info[k] for k in ("oldest_at", "newest_at") if info[k]})
        gap = {"event_id": str(uuid.uuid4()), "type": "gap", "at": _now_iso(), "initiative": info["initiative"],
               "body": body}
        kept.append(_line({"event": gap, "source": source}))
    _replace(path, kept)


def read_all(path: Path | None = None) -> list[dict]:
    """Every well-formed entry, oldest first. A torn or foreign line is skipped (status() counts them)."""
    path = path or spool_path()
    with locked(path):
        return [e for e in map(_parse, _raw_lines(path)) if e is not None]


def remove(ids, path: Path | None = None) -> int:
    """Delete the entries whose event_id is in `ids`, rewriting the spool atomically. Returns how many went. Lines
    that don't parse are dropped by the rewrite too: nothing can send them."""
    path = path or spool_path()
    ids = set(ids)
    with locked(path):
        lines = _raw_lines(path)
        kept, gone = [], 0
        for raw in lines:
            entry = _parse(raw)
            if entry is None:
                continue
            if entry["event"]["event_id"] in ids:
                gone += 1
            else:
                kept.append(raw if raw.endswith(b"\n") else raw + b"\n")
        if gone or len(kept) != len(lines):
            _replace(path, kept)
    return gone


def status(path: Path | None = None) -> dict:
    """{count, by_source, oldest_at, corrupt}: what is waiting, for `home-mission spool status`."""
    path = path or spool_path()
    with locked(path):
        raw = _raw_lines(path)
    entries = [e for e in map(_parse, raw) if e is not None]
    ats = [e["event"]["at"] for e in entries if isinstance(e["event"].get("at"), str)]
    return {"count": len(entries), "by_source": dict(Counter(e["source"] for e in entries)),
            "oldest_at": min(ats) if ats else None, "corrupt": len(raw) - len(entries)}
