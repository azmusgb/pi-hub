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


BAMBUDDY_SPOOLS = [
    {"id": 1, "material": "PLA", "subtype": "Matte", "color_name": "Dusty Rose", "rgba": "D4A5A5FF", "brand": "PlastKyro",
     "label_weight": 1000, "weight_used": 0, "archived_at": None},
    {"id": 2, "material": "PLA", "subtype": None, "color_name": "Grey", "rgba": None, "brand": None,
     "label_weight": 1000, "weight_used": 900, "low_stock_threshold_pct": 20, "archived_at": None},
    {"id": 3, "material": "PETG", "color_name": "Old", "label_weight": 1000, "weight_used": 0, "archived_at": "2026-10-01T00:00:00"},
]


def _bambuddy(monkeypatch, spools=None, projects=None, down=False):
    from hub import bambuddy, sources
    sources._cache.clear()
    def get(url, headers=None, **kw):
        if down:
            raise OSError("refused")
        return spools if "/inventory/spools" in url else projects
    monkeypatch.setattr(sources, "_get_json", get)
    return bambuddy


def test_spools_come_from_bambuddy_in_the_hub_shape(monkeypatch):
    _bambuddy(monkeypatch, BAMBUDDY_SPOOLS)
    s = filament.spools()
    assert [x["id"] for x in s] == [1, 2]  # archived spools are left out
    assert s[0] == {"id": 1, "material": "PLA Matte", "colour": "Dusty Rose", "hex": "#D4A5A5", "brand": "PlastKyro",
                    "grams_total": 1000, "grams_left": 1000, "low": False, "cost_per_kg": None, "measured": False}
    assert s[1]["grams_left"] == 100 and s[1]["low"] and s[1]["measured"] and s[1]["hex"] is None


def test_bambuddy_down_is_not_an_empty_shelf(monkeypatch):
    bambuddy = _bambuddy(monkeypatch, down=True)
    assert bambuddy.spools() is None and bambuddy.projects() is None
    assert filament.spools() == []


def test_a_spool_newly_low_in_bambuddy_alerts_once(monkeypatch, fresh_db):
    events.ready()
    spools = [dict(BAMBUDDY_SPOOLS[1], weight_used=500)]
    _bambuddy(monkeypatch, spools)
    w = events.Watcher()
    w._check_spools()  # first reading: nothing new
    from hub import sources
    sources._cache.clear()
    spools[0]["weight_used"] = 850
    w._check_spools()
    sources._cache.clear()
    w._check_spools()
    assert [e["kind"] for e in events.recent()] == ["filament_low"]
    assert fresh_db and fresh_db[0][0] == "Filament running low" and "Grey PLA, 150 g left" in fresh_db[0][1]


def test_projects_api_lists_bambuddy_projects(monkeypatch):
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    _bambuddy(monkeypatch, projects=[{"id": 1, "name": "Ballerina studio", "status": "active", "archive_count": 2},
                                     {"id": 2, "name": "Done", "status": "archived"}])
    r = TestClient(hub_app.app).get("/api/projects").json()
    assert r["available"] and [p["name"] for p in r["projects"]] == ["Ballerina studio"] and r["projects"][0]["prints"] == 2


def test_print_photo_endpoint():
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    c = TestClient(hub_app.app)
    assert c.get("/api/prints/999/photo.jpg").status_code == 404
    prints_dir = recorder.photos_dir()
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


def test_bambuddy_webhook_refuses_strangers(monkeypatch):
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    fired = []
    monkeypatch.setattr(hub_app.events, "fire", lambda *a, **k: fired.append(a))
    monkeypatch.delenv("HUB_WEBHOOK_TOKEN", raising=False)
    c = TestClient(hub_app.app)
    event = {"event": "print_complete", "variables": {"filament_used": 99}}
    assert c.post("/api/webhook/bambuddy", json=event).status_code == 401  # no token set, not Bambuddy's address
    monkeypatch.setenv("HUB_WEBHOOK_TOKEN", "s3cret")
    assert c.post("/api/webhook/bambuddy", json=event, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.post("/api/webhook/bambuddy?token=wrong", json=event).status_code == 401
    assert fired == []  # none of the refused posts reached the rules
    assert c.post("/api/webhook/bambuddy", json=event, headers={"X-Hub-Token": "s3cret"}).status_code == 200
    assert len(fired) == 1
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


def test_bambuddy_reads_send_the_api_key_when_there_is_one(monkeypatch, tmp_path):
    from hub import bambuddy, sources
    sources._cache.clear()
    seen = []
    monkeypatch.setattr(sources, "_get_json", lambda url, headers=None, **kw: seen.append(headers) or [])
    monkeypatch.setattr(bambuddy, "KEY_FILE", str(tmp_path / "missing"))
    bambuddy.spools()
    key = tmp_path / "key"
    key.write_text("bb_secret\n")
    monkeypatch.setattr(bambuddy, "KEY_FILE", str(key))
    sources._cache.clear()
    bambuddy.projects()
    assert seen == [{}, {"X-API-Key": "bb_secret"}]
