import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import db, events, plex, reminders, system  # noqa: E402


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    sent = []
    monkeypatch.setattr(events, "push", lambda title, body="", tags="", **k: sent.append((title, body)) or "Sent.")
    reminders.ready()
    return sent


def add(text, due, repeat=None):
    return db.run("INSERT INTO items (list, text, created, due, repeat) VALUES ('todo', ?, 1, ?, ?)", text, due, repeat).lastrowid


def test_one_off_reminder_fires_once(fresh):
    add("Call the vet", 1000)
    reminders.tick(now=2000)
    reminders.tick(now=2060)
    assert fresh == [("Reminder", "Call the vet")]


def test_weekly_reminder_moves_on_and_reopens(fresh):
    rid = add("Bins out", 1000, "weekly")
    reminders.tick(now=1500)
    r = db.one("SELECT due FROM items WHERE id = ?", rid)
    assert r["due"] == 1000 + 7 * 86400
    db.run("UPDATE items SET done = 1, done_at = 2000 WHERE id = ?", rid)
    reminders.tick(now=1000 + 7 * 86400 - 3600)  # within 12 h of the next time: back on the list
    assert db.one("SELECT done FROM items WHERE id = ?", rid)["done"] == 0


def test_quiet_hours_hold_a_reminder_for_later(monkeypatch, fresh):
    monkeypatch.setattr(events, "push", lambda *a, **k: "Held back for quiet hours.")
    rid = add("Feed the cat", 1000)
    reminders.tick(now=2000)
    assert db.one("SELECT reminded FROM items WHERE id = ?", rid)["reminded"] is None


def test_movie_night_respects_filters(monkeypatch):
    pool = [{"key": "1", "title": "Up", "content_rating": "PG", "minutes": 96},
            {"key": "2", "title": "Alien", "content_rating": "R", "minutes": 117}]
    monkeypatch.setattr(plex, "library_stats", lambda: {"_unwatched": pool})
    assert plex.pick(kids=True)["title"] == "Up"
    assert plex.pick(max_minutes=105)["title"] == "Up"
    assert plex.pick(skip=("1",))["title"] == "Alien"
    assert plex.pick(kids=True, skip=("1",)) is None


def test_outages_pair_up_downs_and_ups():
    events.ready()
    for ts, kind in ((100, "pc_down"), (700, "pc_back"), (800, "drive_dropped")):
        db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", int(time.time()) - 10000 + ts, kind)
    out = system.outages()
    assert [(o["what"], o["end"] is not None) for o in out] == [("Movies drive", False), ("Windows PC", True)]
    pc = out[1]
    assert pc["end"] - pc["start"] == 600
