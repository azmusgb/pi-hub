"""Reminders on to-do items: a phone message when one falls due, and again on its next day or week if it repeats."""
import time

from . import db, events

STEP = {"daily": 86400, "weekly": 7 * 86400}


def ready():
    have = {r["name"] for r in db.rows("PRAGMA table_info(items)")}
    for col, kind in (("due", "INTEGER"), ("repeat", "TEXT"), ("reminded", "INTEGER")):
        if col not in have:
            db.conn().execute(f"ALTER TABLE items ADD COLUMN {col} {kind}")


def tick(now=None):
    """Sends what's due. A repeating reminder moves to its next time and reopens; a one-off is marked as reminded."""
    ready()
    now = int(now or time.time())
    sent = []
    for r in db.rows("SELECT * FROM items WHERE due IS NOT NULL AND due <= ? AND done = 0 AND (reminded IS NULL OR reminded < due)", now):
        result = events.push("Reminder", r["text"], "alarm_clock")
        sent.append((r["id"], result))
        if result == "Held back for quiet hours.":
            continue  # try again on the next tick after quiet hours end
        if r["repeat"] in STEP:
            nxt = r["due"]
            while nxt <= now:
                nxt += STEP[r["repeat"]]
            db.run("UPDATE items SET due = ?, reminded = ? WHERE id = ?", nxt, now, r["id"])
        else:
            db.run("UPDATE items SET reminded = ? WHERE id = ?", now, r["id"])
    # A repeating chore ticked off comes back at its next time.
    db.run("UPDATE items SET done = 0, done_at = NULL WHERE repeat IS NOT NULL AND done = 1 AND due <= ?", now + 12 * 3600)
    return sent


def due_today(now=None):
    ready()
    now = now or time.time()
    end = time.mktime(time.localtime(now)[:3] + (23, 59, 59, 0, 0, -1))
    return db.rows("SELECT id, list, text, due, repeat FROM items WHERE due IS NOT NULL AND done = 0 AND due <= ? ORDER BY due", int(end))[:6]


def run(every=60):
    time.sleep(25)
    while True:
        try:
            tick()
        except Exception:
            pass
        time.sleep(every)
