"""The house's day for Home's band (amendment A8 D7): one lane per system, from local midnight to midnight.

Built only from what the hub already keeps: Bambuddy's print log, the hub's own history (record_events), the Pi's
self-check, the backup ages and the release records. Each source is read on its own; one that fails makes its lane
`available: false` with no marks, never an empty day (plan decision 3). Times are epoch seconds.
"""
import threading
import time
from datetime import datetime

from . import actions, bambuddy, db, records, releases, sources, system

# lane id -> label, and the source named when it doesn't answer (phrase key source_down: "{name} isn't answering")
LANES = [("printer", "X2D", "Bambuddy"), ("workshop_display", "Workshop display", "The hub's history"),
         ("pi", "Raspberry Pi", "The hub's history"), ("backups", "Backups", "Backrest"), ("updates", "Updates", "Pi Hub")]
HISTORY_THINGS = ("workshop_display", "pi")
# Bambuddy's print status -> mark kind, and the word section 9 uses for it
PRINT_KIND = {"completed": "ok", "failed": "bad", "cancelled": "bad", "printing": "run"}  # anything else: "other"


def day_bounds(now):
    """Local midnight to the next local midnight, so a DST day is 23 or 25 hours long."""
    d = datetime.fromtimestamp(now).date()
    start = int(time.mktime((d.year, d.month, d.day, 0, 0, 0, 0, 0, -1)))
    nxt = datetime.fromtimestamp(start + 26 * 3600).date()
    end = int(time.mktime((nxt.year, nxt.month, nxt.day, 0, 0, 0, 0, 0, -1)))
    return d, start, end


def history_events(start):
    """The display's and the Pi's state changes since `start`, plus each one's last change before it (to know how the
    day began), oldest first. None when the history can't be read: a failed read is not a quiet day."""
    try:
        records.ready()
        marks = ",".join("?" * len(HISTORY_THINGS))
        rows = db.rows(f"SELECT ts, thing, new FROM record_events WHERE ts >= ? AND thing IN ({marks}) ORDER BY ts, rowid",
                       int(start), *HISTORY_THINGS)
        before = []
        for thing in HISTORY_THINGS:
            last = db.rows("SELECT ts, thing, new FROM record_events WHERE ts < ? AND thing = ? ORDER BY ts DESC, rowid DESC "
                           "LIMIT 1", int(start), thing)
            before += last
    except Exception:
        return None
    return [{"ts": r["ts"], "thing": r["thing"], "new": r["new"]} for r in [*before, *rows]]


def backup_times():
    """Backup name -> last run (epoch), through the same cached helper call as /api/system/backups; None when unknown."""
    report = sources.cached("helper-backups", 300, lambda: actions.helper("backups:ages", timeout=5))
    if not (report and report.get("ok")):
        return None
    return {n: t for n, t in ((report.get("ages") or {}).items()) if isinstance(t, (int, float))}


def release_times():
    """Each system's latest release (the only one the hub keeps), as {label, at}."""
    out, recs = [], records.all()
    for rid in releases.ids():
        at = ((recs.get(rid) or {}).get("detail") or {}).get("deployed_at")
        if isinstance(at, (int, float)):
            out.append({"label": releases.TARGETS[rid[len(releases.PREFIX):]], "at": at})
    return out


def _guard(read):
    try:
        return read()
    except Exception:
        return None


def gather(start, now):
    """Every source, each read on its own. None means it didn't answer."""
    return {
        "prints": _guard(lambda: bambuddy.prints(50)),
        "events": history_events(start),
        "selfcheck": _guard(system.selfcheck),
        "backups": _guard(backup_times),
        "releases": _guard(release_times),
        "printer": _guard(lambda: records.get("printer")),
    }


def _print_marks(prints, printer, start, end, now):
    """Finished, failed and cancelled prints that ended today, and the one print running now.

    Only the newest "printing" row is the running print: an older one is a log entry Bambuddy never closed, and is left
    out rather than drawn as a bar running all day. Its remaining time and percent come from the printer record only
    while that record is printing (or paused) and fresh: a stale record's numbers may be hours old. A status this map
    doesn't know is still drawn, in the neutral kind, so a print is never silently missing."""
    marks = []
    rec = printer if isinstance(printer, dict) and printer.get("state") in ("printing", "paused") and not printer.get("stale") else None
    detail = (rec or {}).get("detail") or {}
    running = [p for p in prints if p.get("status") == "printing"]
    newest = max(running, key=lambda p: (p.get("started") or 0, p.get("id") or 0)) if running else None
    for p in prints:
        kind = PRINT_KIND.get(p.get("status"), "other")
        name, word = p.get("name") or "Untitled", bambuddy.status_word(p.get("status"))
        if kind == "run":
            if p is not newest:
                continue
            began = p.get("started")
            left = detail.get("minutes_left")
            pct = detail.get("progress")
            title = f"{name}: {word}" + (f", {round(pct)}%" if rec and isinstance(pct, (int, float)) else "")
            mark = {"start": max(began, start) if isinstance(began, (int, float)) else now, "end": now}
            if isinstance(left, (int, float)) and left > 0:
                mark["until"] = int(now + left * 60)
            elif not isinstance(began, (int, float)):
                continue  # nothing to draw: no start and no remaining time
            marks.append({**mark, "kind": kind, "title": title})
            continue
        began, ended = p.get("started"), p.get("ended")
        if not isinstance(ended, (int, float)) or ended < start or ended > end:
            continue
        began = began if isinstance(began, (int, float)) else ended
        marks.append({"start": max(began, start), "end": ended, "kind": kind, "title": f"{name}: {word}"})
    return sorted(marks, key=lambda m: m["start"])


def _display_marks(events, start, now):
    marks, down = [], None
    for e in sorted((e for e in events if e["thing"] == "workshop_display"), key=lambda e: e["ts"]):
        if e["new"] == "offline" and down is None:
            down = max(e["ts"], start)
        elif e["new"] != "offline" and down is not None:  # online, or unknown: the hub no longer says it was offline
            if e["ts"] >= start:
                marks.append({"start": down, "end": e["ts"], "kind": "bad", "title": "Workshop display offline"})
            down = None
    if down is not None:
        marks.append({"start": down, "end": now, "kind": "bad", "title": "Workshop display offline"})
    return marks


def _pi_marks(events, selfcheck, start, end):
    marks = [{"at": e["ts"], "kind": "warn", "title": "Low voltage seen"}
             for e in (events or []) if e["thing"] == "pi" and e["new"] == "power" and start <= e["ts"] < end]
    sc = selfcheck if isinstance(selfcheck, dict) else {}
    ts, total, failed = sc.get("ts"), sc.get("total"), sc.get("failed")
    if isinstance(ts, (int, float)) and start <= ts < end and isinstance(total, int) and isinstance(failed, int):
        marks.append({"at": ts, "kind": "ok", "title": f"Self-check passed, {total - failed} of {total}"} if sc.get("passed")
                     else {"at": ts, "kind": "bad", "title": f"Self-check: {failed} of {total} failed"})
    return sorted(marks, key=lambda m: m["at"])


def _named(name):
    return name if name[:1].isupper() else name.capitalize()


def build(now, inputs):
    """The day as Home's band draws it: lanes in a fixed order, each with its source, whether it answered and its marks."""
    d, start, end = day_bounds(now)
    prints, events, backups = inputs.get("prints"), inputs.get("events"), inputs.get("backups")
    marks = {
        "printer": None if prints is None else _print_marks(prints, inputs.get("printer"), start, end, now),
        "workshop_display": None if events is None else _display_marks(events, start, now),
        "pi": None if events is None else _pi_marks(events, inputs.get("selfcheck"), start, end),
        "backups": None if backups is None else sorted(
            ({"at": t, "kind": "ok", "title": f"{_named(n)} backed up"} for n, t in backups.items() if start <= t < end),
            key=lambda m: m["at"]),
        "updates": None if inputs.get("releases") is None else sorted(
            ({"at": r["at"], "kind": "deployed", "title": f"{r['label']} updated"}
             for r in inputs["releases"] if start <= r["at"] < end), key=lambda m: m["at"]),
    }
    lanes = [{"id": id, "label": label, "source": source, "available": marks[id] is not None, "marks": marks[id] or []}
             for id, label, source in LANES]
    done = None if marks["printer"] is None else [p for p in prints or [] if _ended_in(p, start, end)]
    counts = {
        # cancelled prints are drawn but not counted as failed (section 9 keeps the two words apart)
        "finished": None if done is None else sum(1 for p in done if p.get("status") == "completed"),
        "failed": None if done is None else sum(1 for p in done if p.get("status") == "failed"),
        "power": None if marks["pi"] is None else sum(1 for m in marks["pi"] if m["kind"] == "warn"),
        "updates": None if marks["updates"] is None else len(marks["updates"]),
    }
    return {"day": d.isoformat(), "start": start, "end": end, "now": int(now), "lanes": lanes, "counts": counts}


def _ended_in(p, start, end):
    return isinstance(p.get("ended"), (int, float)) and start <= p["ended"] <= end


_cache = {"at": 0.0, "body": None}
_lock = threading.Lock()
TTL = 10  # seconds: every open Home asks every 15 s; one build serves them all


def body(now=None):
    """The day, built at most once per TTL however many pages ask (the Pi reads the history from its SD card)."""
    now = time.time() if now is None else now
    with _lock:
        if _cache["body"] is not None and 0 <= now - _cache["at"] < TTL:
            return _cache["body"]
        _, start, _ = day_bounds(now)
        out = build(now, gather(start, now))
        _cache.update(at=now, body=out)
        return out
