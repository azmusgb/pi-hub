"""Reminders on to-do items: a phone message when one falls due, and again on its next day or week if it repeats."""
import time

from . import db, events

STEP = {"daily": 86400, "weekly": 7 * 86400}
LATEST = 4102444800  # 1 Jan 2100: a reminder is a time this century, never a number that happens to parse


def ready():
    db.ensure_columns("items", {"due": "INTEGER", "repeat": "TEXT", "reminded": "INTEGER"})


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
            step = STEP[r["repeat"]]
            nxt = r["due"] + ((now - r["due"]) // step + 1) * step  # the first of its times after now, however late
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
