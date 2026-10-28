import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app  # noqa: E402
from hub import ask, auth, db, digest, events, outside, records, sources  # noqa: E402
from tests.helpers_records import GOOD, bud, inputs  # noqa: E402

SAME = {"Origin": "http://testserver"}
BASE = {"x2d_state": "Idle", "x2d_progress": 0, "drive_state": "Connected", "ai_state": "Ready",
        "display_state": "Online", "pi_temp": 50, "pi_power": "Good", "updates": 0, "movies": 151,
        "services": {"plex": True, "homebridge": True}}


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    events._forget()
    fired = []
    monkeypatch.setattr(events, "push", lambda *a, **k: fired.append(a) or "Sent.")
    yield fired


def kinds():
    return [e["kind"] for e in events.recent()][::-1]


def feed(*readings, start=1000, step=30):
    """Each reading is what the sources say on one 30 s refresh; the first refresh of a test is the hub starting."""
    for i, r in enumerate(readings):
        at = start + i * step
        events.on_changes(records.refresh(at, inputs=r), first=not records.all())


def printing(pct, job="Cube.3mf"):
    return inputs(bambuddy=bud("RUNNING", pct, job=job))


IDLE = inputs()
FINISHED = inputs(bambuddy=bud("FINISH", 100, awaiting=True))
PC_OFF = inputs(netmon=dict(GOOD["netmon"], win_ok=False))


def test_a_change_must_hold_for_two_checks():
    dropped = inputs(pi={"drive_state": "Missing"})
    feed(IDLE, dropped, IDLE, IDLE)
    assert kinds() == []
    feed(dropped, dropped, IDLE, IDLE, start=2000)
    assert kinds() == ["drive_dropped", "drive_back"]


def test_print_finish_and_early_stop_are_told_apart():
    # Bambuddy says FINISH (waiting for the plate to be cleared) for a finish; IDLE below 97% is an early stop
    feed(IDLE, printing(40), printing(99), FINISHED, IDLE, start=1000)
    feed(printing(12, job="Other.3mf"), inputs(bambuddy=bud("IDLE", 0, job="Other.3mf")), start=3000)
    assert kinds() == ["print_started", "print_finished", "print_started", "print_failed"]


def test_pc_has_to_be_down_five_minutes():
    feed(IDLE, *[PC_OFF] * 10)  # off the network for 4.5 minutes
    assert "pc_down" not in kinds()
    feed(PC_OFF, PC_OFF, start=1000 + 11 * 30)
    assert kinds().count("pc_down") == 1
    feed(IDLE, start=2000)
    assert kinds()[-1] == "pc_back"


def test_rules_run_when_their_trigger_fires(fresh_db, monkeypatch):
    from hub import actions
    events.ready()
    monkeypatch.setattr(actions, "run", lambda name: {"ok": True, "message": f"ran {name}"})
    events.add_rule("print_finished", "notify")
    events.fire("print_finished")
    events.fire("drive_back")  # the default rule rescans Plex
    assert fresh_db and fresh_db[0][0] == "X2D print finished"
    results = {r["trigger"]: r["last_result"] for r in events.rules()}
    assert results["drive_back"] == "ran rescan:plex"
    assert results["print_finished"] == "Sent."


def test_network_alerts_trigger_rules(fresh_db):
    events.ready()
    w = events.Watcher()
    w.check_network(["PacketLossDetected"])
    assert "wan_loss" not in kinds()
    w.check_network(["PacketLossDetected"])
    assert kinds()[-1] == "wan_loss"


def test_rule_validation():
    with pytest.raises(ValueError):
        events.add_rule("someone_rings", "notify")
    with pytest.raises(ValueError):
        events.add_rule("print_finished", "turn_on")  # needs an accessory
    with pytest.raises(ValueError):
        events.add_rule("print_finished", "flash")  # needs an accessory
    with pytest.raises(ValueError):
        events.add_rule("print_finished", "format_disk")


def test_quiet_hours_cross_midnight():
    auth.put("quiet_hours", {"on": True, "from": "22:00", "to": "07:00"})
    at = lambda h, m=0: time.mktime((2026, 10, 20, h, m, 0, 0, 0, -1))  # noqa: E731
    assert events.quiet_now(at(23)) and events.quiet_now(at(3)) and not events.quiet_now(at(12))
    auth.put("quiet_hours", {"on": False, "from": "22:00", "to": "07:00"})
    assert not events.quiet_now(at(23))


def test_digest_is_due_once_after_its_time():
    auth.put("digest", {"on": True, "at": "08:00"})
    at = lambda h: time.mktime((2026, 10, 20, h, 5, 0, 0, 0, -1))  # noqa: E731
    assert not digest.due(None, at(7))
    assert digest.due(None, at(8))
    assert not digest.due("2026-10-20", at(9))
    assert not digest.due(None, at(13))  # too late; don't send a "morning" digest in the afternoon


def test_digest_reads_like_a_morning_message(monkeypatch):
    monkeypatch.setattr(sources, "pi_status", lambda: dict(BASE, drive_state="Missing", updates=3))
    monkeypatch.setattr(outside, "weather", lambda: {"now": {"sky": "Clear", "temp": 51}, "days": [{"high": 63, "rain": 40}]})
    monkeypatch.setattr(outside, "calendar", lambda: [])
    db.run("INSERT INTO items (list, text, created) VALUES ('shopping', 'Milk', 1)")
    title, body = digest.build()
    assert title == "Good morning"
    assert "Clear, 51°F now, high 63°, 40% chance of rain." in body
    assert "Needs a look: Movies drive." in body and "3 updates" in body and "1 thing on the shopping list" in body


def test_ask_sends_the_hubs_facts(monkeypatch):
    stamp = int(time.time())
    monkeypatch.setattr(records, "all", lambda: {
        "printer": {"id": "printer", "state": "printing", "headline": "Printing panel, 40%", "source": "bambuddy",
                    "as_of": stamp, "since": stamp, "stale": False, "severity": "ok", "detail": {"progress": 40, "minutes_left": 65}},
        "movies_drive": {"id": "movies_drive", "state": "connected", "headline": "The movies drive is connected", "source": "pi_status",
                         "as_of": stamp, "since": stamp, "stale": False, "severity": "ok", "detail": {}},
    })
    monkeypatch.setattr(sources, "plex_sessions", lambda: None)
    monkeypatch.setattr(ask.bambuddy, "prints", lambda n: None)
    text = ask.context()
    assert "Printing panel, 40%" in text and "minutes_left=65" in text
    assert "The movies drive is connected" in text and "source: Bambuddy" in text
    with pytest.raises(ValueError):
        ask.ask("?")


def test_rule_routes_need_the_pin():
    c = TestClient(hub_app.app)
    assert c.post("/api/rules", json={"trigger": "print_finished", "action": "notify"}, headers=SAME).status_code == 401
    assert c.post("/api/ask", json={"question": "Is Plex up?"}, headers=SAME).status_code == 401
    r = c.get("/api/rules").json()
    assert {t["key"] for t in r["triggers"]} >= {"print_finished", "drive_dropped", "pc_down"}
    assert r["rules"][0]["text"] == "When the movies drive comes back, rescan the Plex library."


def test_wan_down_and_recovery_fire_once(fresh_db):
    events.ready()
    w = events.Watcher()
    w.check_network(["InternetDown"])
    w.check_network(["InternetDown"])
    w.check_network(["InternetDown"])
    assert kinds().count("wan_down") == 1
    w.check_network([])
    w.check_network([])
    w.check_network(None)  # Prometheus unreachable: no change either way
    assert kinds().count("wan_down") == 1


def test_webhook_and_printer_status_report_a_print_once(fresh_db):
    events.ready()
    events.fire("print_started", "Cube", dedupe=events.PRINT_DEDUPE)  # Bambuddy's webhook arrives first
    feed(IDLE, printing(99), FINISHED)
    events.fire("print_finished", "Cube finished", dedupe=events.PRINT_DEDUPE)  # ...or second
    assert kinds() == ["print_started", "print_finished"]


def test_print_under_way_when_the_hub_starts_is_not_a_new_print(fresh_db):
    events.ready()
    feed(printing(30), printing(30), printing(99), FINISHED)
    assert kinds() == ["print_finished"]


def test_stale_movie_copy_is_told_once(fresh_db):
    events.ready()
    w = events.Watcher()
    day = 86400
    w.check(dict(BASE, mirror={"last_ok": 1000}), now=1000 + day)
    assert "mirror_stale" not in kinds()
    for t in (3 * day, 3 * day + 30, 4 * day):
        w.check(dict(BASE, mirror={"last_ok": 1000, "message": "The PC's movie share isn't mounted"}), now=1000 + t)
    assert kinds().count("mirror_stale") == 1
    w.check(dict(BASE, mirror={"last_ok": 1000 + 4 * day}), now=1000 + 4 * day + 60)  # copied again
    w.check(dict(BASE, mirror={"last_ok": 1000 + 4 * day}), now=1000 + 7 * day)
    assert kinds().count("mirror_stale") == 2
    w.check(dict(BASE, mirror={}), now=1000 + 9 * day)  # never copied: no alert until a first good copy
    assert kinds().count("mirror_stale") == 2


def test_stale_paperless_backup_is_told_once(fresh_db):
    events.ready()
    w = events.Watcher()
    day = 86400
    w.check(dict(BASE, paperless_backup={"last_ok": 1000}), now=1000 + day)
    assert "paperless_stale" not in kinds()
    for t in (3 * day, 3 * day + 30):
        w.check(dict(BASE, paperless_backup={"last_ok": 1000}), now=1000 + t)
    assert kinds().count("paperless_stale") == 1
    w.check(dict(BASE, paperless_backup={"last_ok": 1000 + 4 * day}), now=1000 + 4 * day + 60)  # backed up again
    w.check(dict(BASE, paperless_backup={"last_ok": 1000 + 4 * day}), now=1000 + 7 * day)
    assert kinds().count("paperless_stale") == 2
    w.check(dict(BASE, paperless_backup={}), now=1000 + 9 * day)  # never backed up: no alert
    assert kinds().count("paperless_stale") == 2


def test_push_goes_to_every_ntfy_server(monkeypatch, tmp_path):
    import importlib
    import urllib.request
    real_push = importlib.reload(importlib.import_module("hub.events")).push  # the autouse fixture stubs push
    topic = tmp_path / "topic"; topic.write_text("house-abc\n")
    servers = tmp_path / "servers"; servers.write_text("# both while the phone moves over\nhttp://127.0.0.1:8093/\nhttps://ntfy.sh\n")
    monkeypatch.setattr(events, "TOPIC_FILE", str(topic))
    monkeypatch.setattr(events, "SERVERS_FILE", str(servers))
    monkeypatch.setattr(events, "quiet_now", lambda now=None: False)
    urls = []
    class R:
        def close(self): pass
    def fake(req, timeout=10):
        urls.append(req.full_url)
        if "ntfy.sh" in req.full_url:
            raise OSError("down")
        return R()
    monkeypatch.setattr(urllib.request, "urlopen", fake)
    assert real_push("Title", "Body") == "Sent."  # one server answered
    assert urls == ["http://127.0.0.1:8093/house-abc", "https://ntfy.sh/house-abc"]
    servers.write_text("")
    assert events.ntfy_servers() == ["https://ntfy.sh"]
