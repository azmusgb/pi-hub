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


def test_playing_shape_is_stable_and_hides_internal_fields():
    from hub import now
    s = [{"title": "Alien", "show": "", "year": 1979, "kind": "movie", "who": "Bill", "device": "TV", "state": "paused",
          "progress": 30, "minutes_left": 80, "poster": "/api/now/poster/0.jpg", "_thumb": "/library/metadata/1/thumb/2"}]
    p = now.build(None, s, {}, None)["movies"]["playing"][0]
    assert set(p) == {"title", "show", "year", "kind", "who", "device", "state", "progress", "minutes_left", "poster"}


def test_poster_404_when_nothing_plays(monkeypatch):
    from fastapi.testclient import TestClient
    from hub import app as hub_app, sources
    monkeypatch.setattr(sources, "plex_sessions", lambda: [])
    assert TestClient(hub_app.app).get("/api/now/poster/0.jpg").status_code == 404


def _record_change(ts, thing, new, old="stopped"):
    from hub import records
    records.ready()
    db.run("INSERT INTO record_events (ts, thing, old, new, severity, headline, cause) VALUES (?, ?, ?, ?, 'ok', '', '')",
           ts, thing, old, new)


def test_a_plex_or_homebridge_outage_ends_when_its_record_comes_back(monkeypatch):
    # Plex and Homebridge have no recovery event, so their outages read "Still down" for 30 days.
    from hub import records
    events.ready()
    t = int(time.time()) - 10000
    db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", t, "plex_stopped")
    _record_change(t + 300, "plex", "idle")
    monkeypatch.setattr(records, "get", lambda id: {"id": id, "state": "idle"})
    plex_out = system.outages()[0]
    assert (plex_out["what"], plex_out["end"], plex_out["ongoing"]) == ("Plex", t + 300, False)


def test_an_outage_seen_down_again_or_up_now_is_not_still_down(monkeypatch):
    # A recovery missed (say, during a hub restart) left the earlier outage open for good.
    from hub import records
    events.ready()
    records.ready()
    t = int(time.time()) - 10000
    for ts, kind in ((t, "pc_down"), (t + 500, "pc_down"), (t + 900, "homebridge_stopped")):
        db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", ts, kind)
    states = {"pc": "off", "devices": "ok"}
    monkeypatch.setattr(records, "get", lambda id: {"id": id, "state": states[id]})
    got = [(o["what"], o["start"] - t, o["end"], o["ongoing"]) for o in system.outages()]
    assert got == [("Homebridge", 900, None, False), ("Windows PC", 500, None, True), ("Windows PC", 0, None, False)]


def test_an_outage_whose_thing_cannot_be_read_stays_open(monkeypatch):
    from hub import records
    events.ready()
    records.ready()
    db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", int(time.time()) - 100, "drive_dropped")
    monkeypatch.setattr(records, "get", lambda id: None)
    assert system.outages()[0]["ongoing"] is True


def test_a_first_reading_after_a_start_ends_an_outage_at_an_unknown_time(monkeypatch):
    # Live, 7 Nov: Plex stopped 20 Oct and its record history begins 27 Oct with None -> idle. That says Plex is up,
    # not that it was down for a week.
    from hub import records
    events.ready()
    t = int(time.time()) - 10000
    db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", t, "plex_stopped")
    _record_change(t + 5000, "plex", "idle", old=None)
    monkeypatch.setattr(records, "get", lambda id: {"id": id, "state": "stopped"})
    plex_out = system.outages()[0]
    assert (plex_out["end"], plex_out["ongoing"]) == (None, False)


def test_a_stale_record_keeps_an_outage_open(monkeypatch):
    # After a restart every record is stale with its last state: a pre-outage "ok" mustn't close the outage.
    from hub import records
    events.ready()
    records.ready()
    db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", int(time.time()) - 100, "homebridge_stopped")
    monkeypatch.setattr(records, "get", lambda id: {"id": id, "state": "ok", "stale": True})
    assert system.outages()[0]["ongoing"] is True


def test_a_recovery_through_an_unknown_reading_keeps_its_end_time(monkeypatch):
    from hub import records
    events.ready()
    t = int(time.time()) - 10000
    db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", t, "homebridge_stopped")
    _record_change(t + 100, "devices", "unknown", old="stopped")
    _record_change(t + 160, "devices", "ok", old="unknown")
    monkeypatch.setattr(records, "get", lambda id: {"id": id, "state": "ok"})
    assert system.outages()[0]["end"] == t + 160


def test_a_hub_start_between_down_and_up_leaves_the_end_unknown(monkeypatch):
    from hub import records
    events.ready()
    t = int(time.time()) - 10000
    db.run("INSERT INTO events (ts, kind) VALUES (?, ?)", t, "homebridge_stopped")
    _record_change(t + 100, "devices", "unknown", old=None)
    _record_change(t + 160, "devices", "ok", old="unknown")
    monkeypatch.setattr(records, "get", lambda id: {"id": id, "state": "ok"})
    out = system.outages()[0]
    assert (out["end"], out["ongoing"]) == (None, False)
