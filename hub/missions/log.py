"""Appending to the mission log (A35 §6.2; M1b plan decisions 4, 5 and 7): idempotency by event_id, one BEGIN
IMMEDIATE per batch, the per-source rate limit, and the refusal counter that raises a Needs you item.

Both counters are in memory: a restart clears them, which is the plan's choice (decision 7). Every refusal is also
logged by the route."""
import math
import threading
import time
from collections import deque
from datetime import datetime, timezone

from .. import db
from . import project, store
from ..needs import ORDER
from .contract import CURRENT, Refused, parse_at

clock = time.time  # tests replace it; nothing here sleeps
WINDOW = 60  # seconds the per-source event limit counts over
REFUSAL_WINDOW, REFUSALS_RAISE, QUIET = 600, 10, 3600  # 10 refusals in 10 min raise the item; an hour quiet clears it
SOURCE_NAMES = {"claude": "Claude Code sessions", "importer": "the mission importer", "localai": "Local AI"}


def _iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


class Limiter:
    """At most `per_window` events per source in any WINDOW seconds. `check` refuses without spending; `spend`
    counts a batch once it is written, so a batch refused for another reason costs nothing."""

    def __init__(self, per_window):
        self.per_window = per_window
        self._spent = {}
        self._lock = threading.Lock()

    def _prune(self, source, now):
        spent = self._spent.setdefault(source, deque())
        while spent and spent[0][0] <= now - WINDOW:
            spent.popleft()
        return spent

    def check(self, source, n, now):
        with self._lock:
            spent = self._prune(source, now)
            used = sum(k for _, k in spent)
            if used + n <= self.per_window:
                return
            freed, wait = 0, WINDOW
            for at, k in spent:
                freed += k
                if used - freed + n <= self.per_window:
                    wait = at + WINDOW - now
                    break
        raise Refused(429, "rate_limited", f"over {self.per_window} events a minute for {source}",
                      retry_after=max(1, math.ceil(wait)))

    def spend(self, source, n, now):
        if n:
            with self._lock:
                self._prune(source, now).append((now, n))


class Refusals:
    """Refusals per source. REFUSALS_RAISE of them inside REFUSAL_WINDOW raise one Needs you item for that source,
    which stays until QUIET seconds pass with no refusal."""

    def __init__(self):
        self._recent, self._raised = {}, {}
        self._lock = threading.Lock()

    def note(self, source, code, now):
        with self._lock:
            recent = self._recent.setdefault(source, deque())
            recent.append(now)
            while recent[0] <= now - REFUSAL_WINDOW:
                recent.popleft()
            raised = self._raised.get(source)
            if raised:
                raised.update(last=now, code=code, count=raised["count"] + 1)
            elif len(recent) >= REFUSALS_RAISE:
                self._raised[source] = {"last": now, "code": code, "count": len(recent)}

    def items(self, now):
        with self._lock:
            for source in [s for s, r in self._raised.items() if now - r["last"] >= QUIET]:
                del self._raised[source]
            raised = sorted(self._raised.items())
        return [{"id": f"pi:missions:{source}:refused", "source": "Pi Hub", "tone": "attention", "kind": "ask",
                 "title": "Mission reports refused",
                 "detail": (f"Pi Hub refused {r['count']} reports from {SOURCE_NAMES.get(source, source)}, the last "
                            f"at {time.strftime('%H:%M', time.localtime(r['last']))} ({r['code']}). Check its key "
                            "and its contract version.")}
                for source, r in raised]


LIMIT = Limiter(CURRENT.limits["events_per_minute_per_source"])
REFUSALS = Refusals()


def attach_needs(data):
    """Each source's refusal item added to a Needs you answer, in tone order, and counted."""
    for item in REFUSALS.items(clock()):
        items = data["items"]
        at = next((n for n, i in enumerate(items) if ORDER.get(i.get("tone"), 9) > ORDER[item["tone"]]), len(items))
        items.insert(at, item)
        data["count"] = data.get("count", 0) + 1
    return data


def ingest(source, events, now=None):
    """Writes a validated batch in one transaction and returns (accepted, duplicates, seq_max). A duplicate event_id
    (in the log or earlier in the batch) is counted and changes nothing. Raises Refused for an execution another
    source created (the whole batch is rolled back) or over the rate limit (duplicates don't count against it)."""
    now = clock() if now is None else now
    store.ready()
    accepted = duplicates = 0
    with db.transaction() as c:
        seen = store.known(c, [e["event_id"] for e in events])
        fresh = []
        for e in events:
            if e["event_id"] in seen:
                duplicates += 1
            else:
                seen.add(e["event_id"])
                fresh.append(e)
        LIMIT.check(source, len(fresh), now)
        states = {}
        for e in fresh:
            if e["initiative"] not in states:
                states[e["initiative"]] = store.load_state(c, e["initiative"])
            _one(c, states[e["initiative"]], source, e, _iso(now))
            accepted += 1
        top = store.seq_max(c)
    LIMIT.spend(source, len(fresh), now)
    return accepted, duplicates, top


def _one(c, state, source, e, received_at):
    exec_id = project.execution_id(source, e)
    row = None
    if exec_id:
        other = store.owner_of(c, exec_id, source)
        if other:
            raise Refused(403, "not_your_execution", "an execution in this batch belongs to another source")
        row = state["rows"]["mission_executions"].get((e["initiative"], exec_id))
    last = project.last_event_at(row) if row else None
    behind = bool(last and parse_at(e["at"]) < last)
    if e["type"] in project.TOOL:
        updated = project.apply_tool(row, e, behind)
        if updated:
            store.put(c, "mission_executions", updated)
            project.fold(state, [("put", "mission_executions", updated)])
        return
    logged = store.append(c, {
        "event_id": e["event_id"], "at": e["at"], "received_at": received_at, "source": source,
        "initiative": e["initiative"], "entity": project.entity_of(e), "type": e["type"],
        "body": project.json_text(e.get("body") or {}), "late": bool(e.get("late")) or behind, "behind": behind})
    changes = project.apply(state, logged)
    store.write(c, changes)
    project.fold(state, changes)
