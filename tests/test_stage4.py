import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import db, events, filament, recorder  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    filament.ready()
    return sent


def test_add_spool_and_validation():
    sid = filament.add({"material": "PLA", "colour": "  Jade   white ", "hex": "#e8f0ea", "price": "19.99"})
    s = filament.spools()[0]
    assert s["id"] == sid and s["colour"] == "Jade white" and s["grams_left"] == 1000 and s["cost_per_kg"] == 19.99
    with pytest.raises(ValueError):
        filament.add({"material": "Cheese", "colour": "x"})
    with pytest.raises(ValueError):
        filament.add({"material": "PLA", "colour": ""})
    filament.add({"material": "PETG", "colour": "Black", "hex": "javascript:alert(1)"})
    assert filament.spools()[0]["hex"] is None  # PETG sorts first; a bad colour is dropped


def test_logging_a_print_takes_filament_off_and_costs_it():
    sid = filament.add({"material": "PLA", "colour": "Red", "price": 20, "grams_total": 1000})
    now = int(__import__("time").time())
    recorder.record_print("Printing", 50, now - 4000)
    recorder.record_print("Idle", 0, now)
    pid = db.one("SELECT id FROM prints")["id"]
    assert filament.log_print(pid, sid, 120) == {"cost": 2.4}
    assert db.one("SELECT grams_left FROM spools")["grams_left"] == 880
    filament.log_print(pid, sid, 100)  # corrected: the first 120 g go back first
    assert db.one("SELECT grams_left FROM spools")["grams_left"] == 900
    assert filament.summary()["grams"] == 100


def test_running_low_fires_once_and_the_default_rule_alerts(fresh_db):
    events.ready()
    sid = filament.add({"material": "PLA", "colour": "Blue", "grams_total": 1000})
    filament.update(sid, {"grams_left": 400})
    filament.update(sid, {"grams_left": 120})
    filament.update(sid, {"grams_left": 100})
    assert [e["kind"] for e in events.recent()] == ["filament_low"]
    assert fresh_db and fresh_db[0][0] == "Filament running low" and "Blue PLA, 120 g left" in fresh_db[0][1]
    assert filament.spools()[0]["low"]


def test_failed_print_keeps_the_error_code():
    recorder.record_print("Printing", 20, 1000)
    recorder.record_print("Error", 20, 2000, "0300_0100_0001_0007")
    assert db.one("SELECT outcome, error FROM prints") == {"outcome": "failed", "error": "0300_0100_0001_0007"}


def test_used_up_spools_leave_the_shelf():
    sid = filament.add({"material": "PLA", "colour": "Grey"})
    filament.update(sid, {"finished": True})
    assert filament.spools() == [] and len(filament.spools(include_finished=True)) == 1


def test_print_photo_endpoint():
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    c = TestClient(hub_app.app)
    assert c.get("/api/prints/999/photo.jpg").status_code == 404
    prints_dir = os.path.join(os.path.dirname(os.environ["HUB_DB"]), "prints")
    os.makedirs(prints_dir, exist_ok=True)
    with open(os.path.join(prints_dir, "999.jpg"), "wb") as f:
        f.write(b"\xff\xd8\xff\xe0testjpeg")
    res = c.get("/api/prints/999/photo.jpg")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    assert res.content == b"\xff\xd8\xff\xe0testjpeg"


def test_bambuddy_webhook_triggers_completion_and_rules(monkeypatch):
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    monkeypatch.setenv("HUB_WEBHOOK_TOKEN", "s3cret")
    c = TestClient(hub_app.app, headers={"Authorization": "Bearer s3cret"})
    # Start a print
    r = c.post("/api/webhook/bambuddy", json={"event": "print_start", "title": "Bambu P1S", "message": "Started printing Cube"})
    assert r.status_code == 200
    assert r.json()["handled"] == "print_started"
    # Complete print
    r = c.post("/api/webhook/bambuddy", json={
        "event": "print_complete",
        "title": "Bambu P1S",
        "message": "Cube finished",
        "variables": {"filament_used": 15.2}
    })
    assert r.status_code == 200
    assert r.json()["handled"] == "print_finished"
    assert db.one("SELECT outcome, grams FROM prints") == {"outcome": "finished", "grams": 15.2}


def test_bambuddy_webhook_refuses_strangers(monkeypatch):
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    monkeypatch.delenv("HUB_WEBHOOK_TOKEN", raising=False)
    c = TestClient(hub_app.app)
    event = {"event": "print_complete", "variables": {"filament_used": 99}}
    assert c.post("/api/webhook/bambuddy", json=event).status_code == 401  # no token set, not Bambuddy's address
    monkeypatch.setenv("HUB_WEBHOOK_TOKEN", "s3cret")
    assert c.post("/api/webhook/bambuddy", json=event, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.post("/api/webhook/bambuddy?token=wrong", json=event).status_code == 401
    assert db.one("SELECT COUNT(*) AS n FROM prints")["n"] == 0
    assert c.post("/api/webhook/bambuddy", json=event, headers={"X-Hub-Token": "s3cret"}).status_code == 200
    assert c.post("/api/webhook/bambuddy?token=s3cret", content=b"[1]").status_code == 400
    big = b'{"image": "' + b"A" * (9 * 1024 * 1024) + b'"}'
    assert c.post("/api/webhook/bambuddy?token=s3cret", content=big).status_code == 413


def test_bambuddy_webhook_trusts_listed_addresses(monkeypatch):
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    monkeypatch.delenv("HUB_WEBHOOK_TOKEN", raising=False)
    monkeypatch.setattr(hub_app, "WEBHOOK_HOSTS", {"172.18.0.2"})
    assert TestClient(hub_app.app, client=("172.18.0.2", 5000)).post(
        "/api/webhook/bambuddy", json={"event": "print_start"}).json()["handled"] == "print_started"
    assert TestClient(hub_app.app, client=("10.0.0.99", 5000)).post(
        "/api/webhook/bambuddy", json={"event": "print_start"}).status_code == 401
