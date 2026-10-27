"""The night of 26-27 October 2026, replayed through the records loop: every view tells one story."""
import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, db, events, records, sources  # noqa: E402
from tests.fixtures import night_2026_10_26 as night  # noqa: E402


@pytest.fixture(autouse=True)
def env(monkeypatch):
    old = os.environ.get("TZ")
    os.environ["TZ"] = "America/New_York"
    time.tzset()
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    events._forget()
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    monkeypatch.setattr(events, "quiet_now", lambda *a: True)
    monkeypatch.setattr(sources, "localai_feed", lambda: {"cards": []})
    monkeypatch.setattr(sources, "plex_sessions", lambda: [])
    monkeypatch.setattr(sources, "network_metrics", lambda: None)
    for name in ("pi_status", "bambuddy_printer", "localai_lab"):
        monkeypatch.setattr(sources, name, lambda name=name: pytest.fail(f"{name} polled: the views read the records"))
    events.ready()
    yield sent
    if old is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = old
    time.tzset()


def replay(until):
    """Drives the loop as events.run does: first=True only on the first cycle."""
    for i, (t, inp) in enumerate(night.night(until)):
        events.on_changes(records.refresh(t, inputs=inp), first=(i == 0))


@pytest.fixture
def client():
    return TestClient(hub_app.app)


def hhmm(ts):
    return time.strftime("%H:%M", time.localtime(ts))


def test_one_story_for_the_printer(client):
    replay(night.at(2, 1))
    card = client.get("/api/now").json()["printer"]
    rec = next(r for r in client.get("/api/records").json()["records"] if r["id"] == "printer")
    row = next(r for r in client.get("/api/freshness").json()["readings"] if r["key"] == "printer")
    assert card["state"] == "printing" and card["progress"] == 11
    assert rec["state"] == "printing" and rec["detail"]["progress"] == 11 and rec["detail"]["attempt"] == 2
    assert row["reading"] == card["headline"] == rec["headline"] == "Printing HEX_TILE_v72, 11%, attempt 2"
    rows = db.rows("SELECT ts, old, new, headline FROM record_events WHERE thing = 'printer' ORDER BY ts")
    failed = [r for r in rows if r["new"] == "failed"]
    assert [hhmm(r["ts"]) for r in failed] == ["01:31"]
    attempt2 = [r for r in rows if r["new"] == "printing" and "attempt 2" in r["headline"]]
    assert attempt2 and hhmm(attempt2[0]["ts"]) == "01:36"


def test_the_stop_is_recorded_despite_quiet_hours(env):
    replay(night.at(1, 40))
    # the events table is stamped with the wall clock (fire() doesn't take the replayed time), so count, not clock
    assert len(db.rows("SELECT ts FROM events WHERE kind = 'print_failed'")) == 1
    rows = db.rows("SELECT ts FROM record_events WHERE thing = 'printer' AND new = 'failed'")
    assert [hhmm(r["ts"]) for r in rows] == ["01:31"]
    assert env == []  # the phone alert was held
    assert db.one("SELECT status FROM rule_runs WHERE trigger = 'print_failed'")["status"] == "skipped"


def test_needs_home_and_wall_agree(client):
    replay(night.at(2, 3))  # Local AI went down at 02:02 and needs two checks to count
    issues = client.get("/api/now").json()["issues"]
    items = client.get("/api/needs").json()["items"]
    home = {i["what"] for i in issues}
    needs = {i["title"] for i in items}
    assert needs == home
    assert {records.LABELS["adguard"], records.LABELS["workshop_display"], records.LABELS["local_ai"]} <= needs
    assert records.LABELS["pc"] not in needs


def test_the_hub_flags_the_disagreement():
    replay(night.at(1, 25))
    hub = records.get("hub")
    assert (hub["state"], hub["severity"]) == ("disagreement", "attention")
    assert hub["headline"] == "Two sources disagree about the printer"
    assert hub["cause"] == "pi-status reports No status; Bambuddy reports printing"
