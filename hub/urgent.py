"""Urgent printing problems: one phone push per occurrence, even through quiet hours and restarts.

An occurrence opens when a cause's record first shows the problem and stays open while it does. It is
cleared when every fresh record says otherwise; a problem back within 600 s of a clear is the same
occurrence, unless it is a new print: a printer record whose print started after the last push. The
push_occurrences table, not memory, decides, so a restart doesn't push again."""
import os

from . import db, events

CAUSES = {"print": [("printer", "failed"), ("obico", "failure"), ("hms", "stopped")],
          "pc": [("pc_printing", "off_while_printing")]}
CLICK = {"print": "https://home.home.arpa/workshop", "pc": "https://home.home.arpa/"}
LOOK = {"print": "Open the Workshop page to look.", "pc": "Open the hub to look."}
REOPEN_AFTER = 600  # seconds clear before the same cause is a new occurrence

SCHEMA = ("CREATE TABLE IF NOT EXISTS push_occurrences "
          "(cause TEXT PRIMARY KEY, first_seen INTEGER, pushed_at INTEGER, cleared_at INTEGER)")


_ready = set()  # the DB paths this process has created the table in


def ready():
    path = os.environ.get("HUB_DB", "")
    if path not in _ready:
        db.run(SCHEMA)
        _ready.add(path)


def _look(recs, pairs):
    """(first matching fresh record or None, whether the fresh records say it's clear)."""
    fresh_other, stale_match = False, False
    for id, state in pairs:
        r = recs.get(id)
        if not r:
            continue
        if r.get("stale"):
            stale_match = stale_match or r.get("state") == state
        elif r.get("state") == state:
            return r, False
        else:
            fresh_other = True
    return None, fresh_other and not stale_match


def _number(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _message(cause, hit, recs):
    """(title, body) for a push. A print names how far it got and why it stopped, when Obico or HMS said."""
    if cause != "print":
        return hit.get("headline") or "The PC needs you", hit.get("cause") or LOOK[cause]
    detail = (recs.get("printer") or {}).get("detail") or {}
    pct = _number(detail.get("last_progress"))
    pct = _number(detail.get("progress")) if pct is None else pct
    title = f"X2D print stopped at {round(pct)}%" if pct is not None else "X2D print failed"
    reasons = [r.get("headline", "").rstrip(".") for id, state in CAUSES["print"] if id in ("obico", "hms")
               for r in [recs.get(id) or {}] if r.get("state") == state and not r.get("stale") and r.get("headline")]
    body = ". ".join(reasons) + "." if reasons else hit.get("cause") or LOOK[cause]
    return title, body


def _new_print(cause, recs, row):
    """The printer's current print started after the last push: a retry, not the same failure."""
    started = _number(((recs.get("printer") or {}).get("detail") or {}).get("started"))
    return cause == "print" and started is not None and started > row["pushed_at"]


def check(recs, now, send=None):
    """Pushes each cause that just became active; returns the causes pushed this call."""
    send = send or events.push
    ready()
    now = int(now)
    pushed = []
    for cause, pairs in CAUSES.items():
        hit, clear = _look(recs, pairs)
        row = db.one("SELECT * FROM push_occurrences WHERE cause = ?", cause)
        if hit:
            cleared = row and row["cleared_at"] is not None and now - row["cleared_at"] >= REOPEN_AFTER
            if row and row["pushed_at"] is not None and not cleared and not _new_print(cause, recs, row):
                db.run("UPDATE push_occurrences SET cleared_at = NULL WHERE cause = ?", cause)
                continue
            title, body = _message(cause, hit, recs)
            ok = send(title, body, tags="rotating_light", priority="high", urgent=True, click=CLICK[cause]) == "Sent."
            pending = row and row["pushed_at"] is None and row["cleared_at"] is None and row["first_seen"]
            first = row["first_seen"] if pending else now
            db.run("INSERT INTO push_occurrences (cause, first_seen, pushed_at, cleared_at) VALUES (?, ?, ?, NULL) "
                   "ON CONFLICT(cause) DO UPDATE SET first_seen = excluded.first_seen, "
                   "pushed_at = excluded.pushed_at, cleared_at = NULL",
                   cause, now if ok else first, now if ok else None)
            if ok:
                pushed.append(cause)
        elif clear and row and row["cleared_at"] is None:
            db.run("UPDATE push_occurrences SET cleared_at = ? WHERE cause = ?", now, cause)
    return pushed


def recently_pushed(cause, now, within=REOPEN_AFTER):
    ready()
    row = db.one("SELECT pushed_at FROM push_occurrences WHERE cause = ?", cause)
    return bool(row and row["pushed_at"] is not None and now - row["pushed_at"] < within)
