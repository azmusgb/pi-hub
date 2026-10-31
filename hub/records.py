"""One record per thing the hub knows about, so no two pages can disagree.

A record says what state the thing is in, how serious that is, when it started and when
the hub last heard from its source. A source that goes quiet never turns a thing "off" or
"OK": the last record stays, marked stale. Some changes have to last two checks to count.
"""
import json
import queue
import sys
import threading
import time
import traceback

from . import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS record_events (
  ts INTEGER, thing TEXT, old TEXT, new TEXT, severity TEXT, headline TEXT, cause TEXT
);
"""

# kind -> {state: severity}; every kind also has "unknown", which needs a look
KINDS = {
    "printer": {"printing": "ok", "paused": "attention", "finished": "attention", "failed": "problem",
                "idle": "ok", "offline": "attention"},
    "obico": {"watching": "ok", "off": "ok", "warning": "attention", "failure": "problem", "blind": "attention"},
    "hms": {"clear": "ok", "notice": "attention", "stopped": "problem"},
    "camera": {"live": "ok", "no_picture": "attention"},
    "workshop_display": {"online": "ok", "offline": "attention"},
    "pc": {"on": "ok", "off": "problem"},
    "local_ai": {"ready": "ok", "busy": "ok", "down": "problem"},
    "pi": {"ok": "ok", "hot": "attention", "power": "attention"},
    "movies_drive": {"connected": "ok", "not_mounted": "attention", "missing": "problem"},
    "movie_copy": {"up_to_date": "ok", "behind": "attention"},
    "internet": {"ok": "ok", "slow": "attention", "down": "problem"},
    "adguard": {"blocking": "ok", "not_answering": "attention"},
    "backups": {"ok": "ok", "behind": "attention"},
    "plex": {"playing": "info", "idle": "ok", "stopped": "problem"},
    "devices": {"ok": "ok", "stopped": "problem"},
    "paper_printer": {"ready": "ok", "busy": "info", "problem": "attention"},
    "weather": {"ok": "ok", "warning": "attention"},
    "hub": {"ok": "ok", "disagreement": "attention"},
    "pc_printing": {"fine": "ok", "off_while_printing": "problem"},
}
for _states in KINDS.values():
    _states["unknown"] = "attention"

LEVEL = {"ok": 0, "info": 1, "attention": 2, "problem": 3}

# seconds a source may stay quiet before its records are called stale
STALE_AFTER = {"bambuddy": 90, "pi_status": 90, "netmon": 120, "camera": 90, "plex": 120, "homebridge": 120,
               "cups": 300, "adguard": 900, "backrest": 900, "weather": 3600, "hub": 90}

# kinds whose change has to be seen on two checks in a row
DEBOUNCED = {"workshop_display", "local_ai", "pi", "movies_drive", "internet", "adguard", "plex", "devices"}

DISAGREE_AFTER = 300

# thing -> the source that is the one designated answer for it
SOURCE = {"printer": "bambuddy", "obico": "bambuddy", "hms": "bambuddy", "camera": "camera", "workshop_display": "pi_status", "local_ai": "pi_status",
          "pi": "pi_status", "movies_drive": "pi_status", "movie_copy": "pi_status", "pc": "netmon",
          "internet": "netmon", "adguard": "adguard", "backups": "backrest", "plex": "pi_status",
          "devices": "pi_status", "paper_printer": "cups", "weather": "weather", "hub": "hub", "pc_printing": "hub"}

LABELS = {"printer": "Bambu X2D", "obico": "Failure detection", "hms": "Printer alerts", "camera": "Printer camera", "workshop_display": "Workshop display",
          "pc": "Windows PC", "local_ai": "Local AI", "pi": "Raspberry Pi", "movies_drive": "Movies drive",
          "movie_copy": "Movie copy from the PC", "internet": "Internet", "adguard": "Ad blocking",
          "backups": "Backups", "plex": "Movies", "devices": "Smart-home controls",
          "paper_printer": "Document printer", "weather": "Weather", "hub": "The hub's sources",
          "pc_printing": "PC during a print"}

# source key -> how it reads in a sentence
SOURCE_NAMES = {"bambuddy": "Bambuddy", "pi_status": "The Pi's status service", "netmon": "NETMON",
                "camera": "The printer camera", "plex": "Plex", "homebridge": "Homebridge",
                "cups": "The print server", "adguard": "AdGuard", "backrest": "Backrest",
                "weather": "The weather service", "hub": "The hub"}

_lock = threading.Lock()
_records = {}
_pending = {}  # id -> (state, checks seen) for a debounced change that hasn't counted yet
_subscribers = []
_written = {}  # id -> (body without as_of, when) as last written to the records table
REWRITE_AFTER = 300  # seconds; an unchanged record's row is still rewritten this often


def ready():
    db.conn().executescript(SCHEMA)


def _reset_memory():
    with _lock:
        _records.clear()
        _pending.clear()
        _written.clear()


def make(id, state, headline, source, *, cause="", actions=None, detail=None, disagree=""):
    """A record as a builder sees it; merge adds since, as_of, stale and severity."""
    return {"id": id, "state": state, "headline": headline, "source": source, "cause": cause,
            "actions": actions or [], "detail": detail or {}, "disagree": disagree}


def _severity(id, state):
    return KINDS.get(id, {}).get(state, "attention")


def _not_answering(prev, now):
    rec = dict(prev)
    if now - prev["as_of"] > STALE_AFTER.get(prev["source"], 90):
        name = SOURCE_NAMES.get(prev["source"], prev["source"])
        rec["stale"] = True
        if LEVEL[rec["severity"]] < LEVEL["attention"]:
            rec["severity"] = "attention"
        rec["cause"] = (f"{name} not answering since {time.strftime('%H:%M', time.localtime(prev['as_of']))}; "
                        f"last read {int((now - prev['as_of']) // 60)} min ago.")
    return rec


# kind -> {state: group}: states the debounce counts as one value (the old Watcher's drive connected yes/no)
SAME_FOR_DEBOUNCE = {"movies_drive": {"missing": "not_connected", "not_mounted": "not_connected"}}


def _settled_state(id, prev, state):
    """The state to record: a debounced kind keeps the old one until the new one has been seen twice.
    The debounce is between fresh readings: after a stale record (a restart, or a source that went
    quiet) the new reading counts at once."""
    group = SAME_FOR_DEBOUNCE.get(id, {})
    value = group.get(state, state)
    if id not in DEBOUNCED or prev is None or prev.get("stale") or value == group.get(prev["state"], prev["state"]):
        _pending.pop(id, None)
        return state
    seen = _pending[id][1] + 1 if id in _pending and _pending[id][0] == value else 1
    if seen >= 2:
        _pending.pop(id, None)
        return state
    _pending[id] = (value, seen)
    return prev["state"]


def merge(prev, new, now):
    """The record to store, given the last one and what the source just said (None: it didn't answer)."""
    if new is None:
        return None if prev is None else _not_answering(prev, now)
    with _lock:
        state = _settled_state(new["id"], prev, new["state"])
    rec = dict(new)
    if state != new["state"]:  # still holding the old reading
        rec.update(state=state, headline=prev["headline"], cause=prev["cause"], detail=prev["detail"])
    changed = prev is None or prev["state"] != state
    rec.update(as_of=now, stale=False, severity=_severity(new["id"], state),
               since=now if changed else prev["since"])
    return rec


def store(recs, now):
    """Saves records; returns what changed (state or severity), after writing each change to the log.
    A database that fails is logged, and the changes still go to the subscribers and the caller."""
    changes = []
    with _lock:
        for id, rec in recs.items():
            if rec is None:
                continue
            old = _records.get(id)
            _records[id] = rec
            if old is None or old["state"] != rec["state"] or old["severity"] != rec["severity"]:
                changes.append({"id": id, "ts": int(now), "old": old and old["state"], "new": rec["state"],
                                "severity": rec["severity"], "headline": rec["headline"],
                                "cause": rec["cause"], "record": rec})
        subscribers = list(_subscribers)
    rows = _rows_to_write(recs, now)
    try:
        ready()
        with db.transaction() as c:
            for id, (body, _) in rows.items():
                c.execute("INSERT OR REPLACE INTO records (id, body) VALUES (?, ?)", (id, body))
            for ch in changes:
                c.execute("INSERT INTO record_events (ts, thing, old, new, severity, headline, cause) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?)",
                          (ch["ts"], ch["id"], ch["old"], ch["new"], ch["severity"], ch["headline"], ch["cause"]))
            c.execute("DELETE FROM record_events WHERE ts < ?", (int(now) - 30 * 86400,))
    except Exception:  # a busy or stalled database mustn't lose the changes: the alerts still go out
        traceback.print_exc(file=sys.stderr)
    else:
        with _lock:
            _written.update({id: (same, now) for id, (_, same) in rows.items()})
    for ch in changes:
        for q in subscribers:
            q.put(ch)
    return changes


def _rows_to_write(recs, now):
    """id -> (row body, body without as_of) for the records whose row needs writing: the body changed
    (as_of aside) or the row is REWRITE_AFTER old."""
    out = {}
    with _lock:
        for id, rec in recs.items():
            if rec is None:
                continue
            same = json.dumps({k: v for k, v in rec.items() if k != "as_of"}, sort_keys=True)
            last = _written.get(id)
            if last is None or last[0] != same or now - last[1] >= REWRITE_AFTER:
                out[id] = (json.dumps(rec), same)
    return out


def _about(id):
    return "the printer" if id == "printer" else LABELS.get(id, id)


def _hub(recs, prev, now):
    """The hub's own record: a disagreement between two sources that has lasted DISAGREE_AFTER is attention."""
    # A hub record remembered from before a restart says nothing about now: its clocks start again.
    before = prev["detail"].get("disagree_since", {}) if prev and not prev.get("stale") else {}
    since = {id: before.get(id, now) for id, r in recs.items()
             if r is not None and id != "hub" and r.get("disagree") and not r.get("stale")}
    lasting = sorted((t, id) for id, t in since.items() if now - t >= DISAGREE_AFTER)
    detail = {"disagree_since": since}
    if not lasting:
        return make("hub", "ok", "All sources agree", "hub", detail=detail)
    id = lasting[0][1]
    return make("hub", "disagreement", f"Two sources disagree about {_about(id)}", "hub",
                cause=recs[id]["disagree"], detail=detail)


def refresh(now=None, inputs=None):
    """One pass of the loop: read every source once, build and merge every record, store them; returns the
    changes. The only caller of merge and store (events.run's thread), so records change in one place."""
    from . import things
    now = time.time() if now is None else now
    if inputs is None:
        inputs = things.gather()
    prev = all()
    built = things.build_all(inputs, prev, now)
    recs = {id: merge(prev.get(id), new, now) for id, new in built.items()}
    recs["hub"] = merge(prev.get("hub"), _hub(recs, prev.get("hub"), now), now)
    return store(recs, now)


def load():
    """After a restart: what the table remembers, all marked stale, with nothing written to the log."""
    ready()
    with _lock:
        for r in db.rows("SELECT id, body FROM records"):
            _records[r["id"]] = {**json.loads(r["body"]), "stale": True}


def all():
    with _lock:
        return {id: dict(r) for id, r in _records.items()}


def get(id):
    with _lock:
        r = _records.get(id)
        return dict(r) if r else None


def problems(recs=None):
    """Things that need a look: problems first, then the longest-standing first (of `recs`, or the stored records)."""
    bad = [r for r in (all() if recs is None else recs).values() if LEVEL[r["severity"]] >= LEVEL["attention"]]
    return sorted(bad, key=lambda r: (-LEVEL[r["severity"]], r["since"]))


def recent_events(since=0, limit=40):
    """Recent state and severity changes from record_events, newest first, with human-readable labels."""
    try:
        ready()
        rows = db.rows(
            "SELECT ts, thing, old, new, severity, headline, cause "
            "FROM record_events WHERE ts >= ? ORDER BY ts DESC, rowid DESC LIMIT ?",
            int(since or 0), max(1, min(int(limit or 40), 100))
        )
    except Exception:
        return []
    return [{
        "ts": r["ts"],
        "thing": r["thing"],
        "label": LABELS.get(r["thing"], r["thing"]),
        "old": r["old"],
        "new": r["new"],
        "severity": r["severity"],
        "headline": r["headline"] or "",
        "cause": r["cause"] or "",
    } for r in rows]


def subscribe():
    q = queue.Queue()
    with _lock:
        _subscribers.append(q)
    return q


def unsubscribe(q):
    with _lock:
        if q in _subscribers:
            _subscribers.remove(q)
