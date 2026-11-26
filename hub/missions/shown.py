"""What an execution shows (A35 §7.5; M1b plan decision 8): one pure function of an execution row and the server's
`now`. Staleness is computed when a read happens, never stored, so a silent source can't stay "Live": the page
relabels from `as_of` between polls, and this is the server half of that rule.

`shown(row, now, pc_on)` returns {"state", "label", "live", "since"}:
- `live` is true only while the label claims the source is reporting: a tool running, or a session that reported
  within WINDOW seconds. Every other label is a statement about the past ("Turn finished 09:40"), never "Live".
- `since` is the ISO time the label counts from (None when no event is known), so the page can write it in its own
  time zone and keep counting. HH:MM in `label` is the server's local time.
- A row whose times can't be read is `unknown` with "No report yet", never idle.

Nothing here reads a clock, the database or the network. `pc_on` is Local AI's `pc` record: True on, False off, None
when it can't be told (its own wording, never "asleep")."""
import time
from datetime import datetime, timezone

from .contract import parse_at

WINDOW = 120  # seconds a session counts as live after its last report (§7.5)
ENDED = ("ended", "done", "failed", "cancelled")
LOCALAI_WORDS = {"queued": "Queued", "running": "Running", "done": "Done", "failed": "Failed",
                 "cancelled": "Cancelled"}


def hhmm(ts):
    return time.strftime("%H:%M", time.localtime(ts))


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


def _result(state, label, live, since):
    return {"state": state, "label": label, "live": live, "since": None if since is None else iso(since)}


def _times(row):
    """(logged, tool, last) as seconds: when the last logged event and the last in-place tool event happened, and the
    later of the two. None for a time that is absent or unreadable."""
    logged, tool = parse_at(row.get("logged_at")), parse_at(row.get("tool_at"))
    known = [t.timestamp() for t in (logged, tool) if t]
    return (logged.timestamp() if logged else None, tool.timestamp() if tool else None,
            max(known) if known else None)


def shown(row, now, pc_on=None):
    logged, tool, last = _times(row)
    if row.get("level") == "full":
        return _localai(row, now, pc_on, last)
    state = row.get("state") or "unknown"
    if state == "ended":
        ended = parse_at(row.get("ended_at"))
        at = ended.timestamp() if ended else last
        return _result("ended", f"Ended {hhmm(at)}" if at is not None else "Ended", False, at)
    if last is None:
        return _result("unknown", "No report yet", False, None)
    after = tool is not None and (logged is None or tool > logged)  # a tool event came after the last logged one
    if after and row.get("tool_state") == "running":
        minutes = max(0, int((now - tool) // 60))
        return _result("running_tool", f"Running a tool for {minutes} min" if minutes else
                       "Running a tool for under 1 min", True, tool)
    if state in ("turn_finished", "waiting_owner") and not after:
        words = "Turn finished" if state == "turn_finished" else "Waiting for you since"
        return _result(state, f"{words} {hhmm(logged)}", False, logged)
    if state == "unknown" and not after:
        return _result("unknown", f"No report since {hhmm(last)}", False, last)
    # working, or a session that reported again after its turn ended or a wait began
    if now - last < WINDOW:
        return _result("working", "Working", True, last)
    return _result("working", f"No report since {hhmm(last)}", False, last)


def _localai(row, now, pc_on, last):
    """Local AI's own rows (§7.5): the run's state while the PC is on, "Last known" when it isn't or can't be told.
    A finished run says so either way: it is not a claim about now."""
    state = row.get("state") or "unknown"
    if last is None:
        return _result("unknown", "No report yet", False, None)
    if state in ENDED:
        return _result(state, f"{LOCALAI_WORDS.get(state, state.capitalize())} {hhmm(last)}", False, last)
    if pc_on is True:
        return _result(state, f"{LOCALAI_WORDS.get(state, state.capitalize())} since {hhmm(last)}", True, last)
    reason = "PC asleep" if pc_on is False else "PC state unknown"
    return _result(state, f"Last known {hhmm(last)} ({reason})", False, last)
