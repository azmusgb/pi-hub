"""GET /api/today: the house's day for Home's band (amendment A8 D7, plan 2026-11-05-a8-home-dashboard P1)."""
import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hubapp, db, records, today  # noqa: E402

client = TestClient(hubapp.app)


@pytest.fixture(autouse=True)
def eastern():
    """A fixed local zone, so local midnight is known: 5 Nov 2026 00:00 EST is 05:00 UTC."""
    old = os.environ.get("TZ")
    os.environ["TZ"] = "America/New_York"
    time.tzset()
    yield
    if old is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = old
    time.tzset()


@pytest.fixture(autouse=True)
def no_cache():
    today._cache.update(at=0.0, body=None)
    yield
    today._cache.update(at=0.0, body=None)


MIDNIGHT = 1793854800  # 2026-11-05 00:00 America/New_York
NOW = MIDNIGHT + 15 * 3600 + 30 * 60  # 3:30 PM


def at(h, m=0):
    return MIDNIGHT + h * 3600 + m * 60


def inputs(**over):
    base = {"prints": [], "events": [], "selfcheck": None, "backups": {}, "releases": [], "printer": None}
    base.update(over)
    return base


def lane(body, id):
    return next(l for l in body["lanes"] if l["id"] == id)


def pr(name, status, started, ended):
    return {"id": started, "name": name, "status": status, "started": started, "ended": ended}


# ---- the day ----

def test_day_is_local_midnight_to_midnight():
    body = today.build(NOW, inputs())
    assert body["day"] == "2026-11-05"
    assert body["start"] == MIDNIGHT and body["end"] == MIDNIGHT + 24 * 3600
    assert body["now"] == NOW
    assert [l["id"] for l in body["lanes"]] == ["printer", "workshop_display", "pi", "backups", "updates"]
    assert all(l["available"] and l["marks"] == [] for l in body["lanes"])
    assert body["counts"] == {"finished": 0, "failed": 0, "power": 0, "updates": 0}


def test_day_across_a_dst_change_is_25_hours():
    fallback = MIDNIGHT - 4 * 24 * 3600  # 1 Nov 2026, clocks go back at 2 AM
    body = today.build(fallback + 12 * 3600, inputs())
    assert body["day"] == "2026-11-01"
    assert body["end"] - body["start"] == 25 * 3600


# ---- X2D ----

def test_print_from_yesterday_starts_at_midnight():
    p = pr("Coaster", "completed", MIDNIGHT - 2 * 3600, at(1, 50))
    marks = lane(today.build(NOW, inputs(prints=[p])), "printer")["marks"]
    assert marks == [{"start": MIDNIGHT, "end": at(1, 50), "kind": "ok", "title": "Coaster: Finished"}]


def test_print_words_and_kinds():
    ps = [pr("A", "completed", at(1), at(2)), pr("B", "failed", at(3), at(4)), pr("C", "cancelled", at(5), at(6))]
    body = today.build(NOW, inputs(prints=ps))
    marks = lane(body, "printer")["marks"]
    assert [(m["kind"], m["title"]) for m in marks] == [("ok", "A: Finished"), ("bad", "B: Failed"), ("bad", "C: Cancelled")]
    assert body["counts"]["finished"] == 1 and body["counts"]["failed"] == 1  # cancelled is drawn, not counted


def test_prints_are_in_time_order_whatever_the_source_order():
    ps = [pr("Late", "completed", at(9), at(10)), pr("Early", "completed", at(1), at(2))]
    marks = lane(today.build(NOW, inputs(prints=ps)), "printer")["marks"]
    assert [m["title"] for m in marks] == ["Early: Finished", "Late: Finished"]


def test_prints_outside_the_day_are_left_out():
    ps = [pr("Yesterday", "completed", MIDNIGHT - 5 * 3600, MIDNIGHT - 3600)]
    assert lane(today.build(NOW, inputs(prints=ps)), "printer")["marks"] == []


def test_running_print_runs_to_now_with_its_remaining_time():
    p = pr("Tile", "printing", at(14, 47), None)
    printer = {"state": "printing", "detail": {"progress": 81, "minutes_left": 9}}
    marks = lane(today.build(NOW, inputs(prints=[p], printer=printer)), "printer")["marks"]
    assert marks == [{"start": at(14, 47), "end": NOW, "until": NOW + 9 * 60, "kind": "run", "title": "Tile: Printing, 81%"}]


def test_running_print_without_a_start_draws_only_its_remaining_time():
    p = pr("Tile", "printing", None, None)
    printer = {"state": "printing", "detail": {"progress": 50, "minutes_left": 20}}
    marks = lane(today.build(NOW, inputs(prints=[p], printer=printer)), "printer")["marks"]
    assert marks == [{"start": NOW, "end": NOW, "until": NOW + 20 * 60, "kind": "run", "title": "Tile: Printing, 50%"}]


def test_running_print_with_no_remaining_time_has_no_ghost():
    p = pr("Tile", "printing", at(14), None)
    marks = lane(today.build(NOW, inputs(prints=[p], printer=None)), "printer")["marks"]
    assert marks == [{"start": at(14), "end": NOW, "kind": "run", "title": "Tile: Printing"}]


def test_only_the_newest_printing_row_is_the_running_print():
    orphan = pr("Old", "printing", MIDNIGHT - 3 * 86400, None)  # a row Bambuddy never closed
    current = pr("Tile", "printing", at(14, 47), None)
    printer = {"state": "printing", "detail": {"progress": 50, "minutes_left": 30}}
    marks = lane(today.build(NOW, inputs(prints=[current, orphan], printer=printer)), "printer")["marks"]
    assert [m["title"] for m in marks] == ["Tile: Printing, 50%"]


def test_a_stale_printer_record_gives_no_remaining_time():
    p = pr("Tile", "printing", at(14), None)
    printer = {"state": "printing", "stale": True, "detail": {"progress": 50, "minutes_left": 30}}
    marks = lane(today.build(NOW, inputs(prints=[p], printer=printer)), "printer")["marks"]
    assert marks == [{"start": at(14), "end": NOW, "kind": "run", "title": "Tile: Printing"}]


def test_an_unknown_print_status_is_drawn_neutral_and_not_counted():
    body = today.build(NOW, inputs(prints=[pr("Odd", "aborted", at(9), at(10))]))
    assert lane(body, "printer")["marks"] == [{"start": at(9), "end": at(10), "kind": "other", "title": "Odd: Aborted"}]
    assert body["counts"]["finished"] == 0 and body["counts"]["failed"] == 0


def test_bambuddy_down_is_unavailable_not_an_empty_day():
    body = today.build(NOW, inputs(prints=None))
    x2d = lane(body, "printer")
    assert x2d["available"] is False and x2d["marks"] == [] and x2d["source"] == "Bambuddy"
    assert body["counts"]["finished"] is None and body["counts"]["failed"] is None


# ---- Workshop display and the Pi, from the hub's history ----

def ev(ts, thing, new):
    return {"ts": ts, "thing": thing, "new": new}


def test_display_offline_then_online_is_one_span():
    events = [ev(at(2), "workshop_display", "offline"), ev(at(3), "workshop_display", "online")]
    marks = lane(today.build(NOW, inputs(events=events)), "workshop_display")["marks"]
    assert marks == [{"start": at(2), "end": at(3), "kind": "bad", "title": "Workshop display offline"}]


def test_display_offline_since_yesterday_starts_at_midnight():
    events = [ev(MIDNIGHT - 3600, "workshop_display", "offline"), ev(at(1, 31), "workshop_display", "online")]
    marks = lane(today.build(NOW, inputs(events=events)), "workshop_display")["marks"]
    assert marks == [{"start": MIDNIGHT, "end": at(1, 31), "kind": "bad", "title": "Workshop display offline"}]


def test_display_still_offline_runs_to_now():
    events = [ev(at(9), "workshop_display", "offline")]
    marks = lane(today.build(NOW, inputs(events=events)), "workshop_display")["marks"]
    assert marks == [{"start": at(9), "end": NOW, "kind": "bad", "title": "Workshop display offline"}]


def test_display_events_out_of_order_still_pair():
    events = [ev(at(5), "workshop_display", "online"), ev(at(4), "workshop_display", "offline"),
              ev(at(7), "workshop_display", "offline"), ev(at(8), "workshop_display", "online")]
    marks = lane(today.build(NOW, inputs(events=events)), "workshop_display")["marks"]
    assert [(m["start"], m["end"]) for m in marks] == [(at(4), at(5)), (at(7), at(8))]


def test_unknown_ends_an_offline_span():
    events = [ev(at(2), "workshop_display", "offline"), ev(at(3), "workshop_display", "unknown"),
              ev(at(6), "workshop_display", "online")]
    marks = lane(today.build(NOW, inputs(events=events)), "workshop_display")["marks"]
    assert [(m["start"], m["end"]) for m in marks] == [(at(2), at(3))]


def test_power_seen_today_is_a_warn_point():
    body = today.build(NOW, inputs(events=[ev(at(5, 17), "pi", "power")]))
    assert lane(body, "pi")["marks"] == [{"at": at(5, 17), "kind": "warn", "title": "Low voltage seen"}]
    assert body["counts"]["power"] == 1


def test_power_flag_from_an_earlier_day_draws_nothing():
    body = today.build(NOW, inputs(events=[ev(MIDNIGHT - 3600, "pi", "power")]))
    assert lane(body, "pi")["marks"] == [] and body["counts"]["power"] == 0


def test_self_check_today_and_yesterday():
    ok = {"ts": at(4, 15), "passed": True, "total": 49, "failed": 0}
    assert lane(today.build(NOW, inputs(selfcheck=ok)), "pi")["marks"] == [
        {"at": at(4, 15), "kind": "ok", "title": "Self-check passed, 49 of 49"}]
    bad = {"ts": at(4, 15), "passed": False, "total": 49, "failed": 2}
    assert lane(today.build(NOW, inputs(selfcheck=bad)), "pi")["marks"] == [
        {"at": at(4, 15), "kind": "bad", "title": "Self-check: 2 of 49 failed"}]
    old = {"ts": MIDNIGHT - 3600, "passed": True, "total": 49, "failed": 0}
    assert lane(today.build(NOW, inputs(selfcheck=old)), "pi")["marks"] == []


def test_pi_marks_are_in_time_order():
    sc = {"ts": at(4, 15), "passed": True, "total": 49, "failed": 0}
    marks = lane(today.build(NOW, inputs(selfcheck=sc, events=[ev(at(3), "pi", "power")])), "pi")["marks"]
    assert [m["at"] for m in marks] == [at(3), at(4, 15)]


def test_history_down_makes_both_history_lanes_unavailable():
    body = today.build(NOW, inputs(events=None))
    for id in ("workshop_display", "pi"):
        assert lane(body, id)["available"] is False and lane(body, id)["marks"] == []
    assert body["counts"]["power"] is None


def test_history_read_failure_is_none_not_empty(monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("database is locked")
    monkeypatch.setattr(db, "rows", broken)
    assert today.history_events(MIDNIGHT) is None


# ---- Backups and Updates ----

def test_backups_today_only():
    body = today.build(NOW, inputs(backups={"Pi": at(3, 30), "Mac": MIDNIGHT - 600}))
    assert lane(body, "backups")["marks"] == [{"at": at(3, 30), "kind": "ok", "title": "Pi backed up"}]


def test_backup_names_read_as_names():
    body = today.build(NOW, inputs(backups={"mac": at(1, 30)}))
    assert lane(body, "backups")["marks"][0]["title"] == "Mac backed up"


def test_backups_unknown_is_unavailable():
    assert lane(today.build(NOW, inputs(backups=None)), "backups")["available"] is False


def test_updates_today_only_and_counted():
    rels = [{"label": "Pi Hub", "at": at(14, 6)}, {"label": "Local AI", "at": at(13, 3)},
            {"label": "netmon", "at": MIDNIGHT - 86400}]
    body = today.build(NOW, inputs(releases=rels))
    assert lane(body, "updates")["marks"] == [
        {"at": at(13, 3), "kind": "deployed", "title": "Local AI updated"},
        {"at": at(14, 6), "kind": "deployed", "title": "Pi Hub updated"}]
    assert body["counts"]["updates"] == 2


def test_releases_unreadable_is_unavailable_not_quiet():
    body = today.build(NOW, inputs(releases=None))
    assert lane(body, "updates")["available"] is False and body["counts"]["updates"] is None


# ---- gathering and the route ----

def test_releases_from_records(monkeypatch):
    recs = {"release:pi-hub": {"id": "release:pi-hub", "detail": {"deployed_at": at(14, 6)}},
            "release:netmon": {"id": "release:netmon", "detail": {}},
            "printer": {"id": "printer"}}
    monkeypatch.setattr(records, "all", lambda: recs)
    assert today.release_times() == [{"label": "Pi Hub", "at": at(14, 6)}]


def test_route_answers_with_every_source_down(monkeypatch):
    monkeypatch.setattr(today, "gather", lambda start, now: inputs(prints=None, events=None, backups=None))
    r = client.get("/api/today")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert [l["available"] for l in body["lanes"]] == [False, False, False, False, True]


def test_one_build_serves_every_page_for_ten_seconds(monkeypatch):
    calls = []
    monkeypatch.setattr(today, "gather", lambda start, now: calls.append(now) or inputs())
    today.body(NOW)
    today.body(NOW + 9)
    assert len(calls) == 1
    today.body(NOW + 11)
    assert len(calls) == 2


def test_route_reads_the_hub_history(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    records.ready()
    t = int(time.time())
    db.run("INSERT INTO record_events (ts, thing, old, new, severity, headline, cause) VALUES (?,?,?,?,?,?,?)",
           t - 60, "pi", "ok", "power", "attention", "Power problem", "")
    rows = today.history_events(t - 3600)
    assert rows == [{"ts": t - 60, "thing": "pi", "new": "power"}]
