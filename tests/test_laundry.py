import io
import urllib.error

import pytest

from hub import laundry, sources

WASHER = {"deviceId": "w1", "deviceInfo": {"deviceType": "DEVICE_WASHER", "alias": "Washer"}}
DRYER = {"deviceId": "d1", "deviceInfo": {"deviceType": "DEVICE_DRYER", "alias": "Dryer"}}
FRIDGE = {"deviceId": "f1", "deviceInfo": {"deviceType": "DEVICE_REFRIGERATOR", "alias": "Fridge"}}


@pytest.fixture(autouse=True)
def clean(tmp_path, monkeypatch):
    sources._cache.clear()
    laundry._ended.clear()
    laundry._devices.clear()
    token = tmp_path / "thinq_pat"
    token.write_text("tok\n")
    monkeypatch.setattr(laundry, "TOKEN_FILE", str(token))
    yield
    sources._cache.clear()


def _serve(monkeypatch, states, devices=(DRYER, WASHER, FRIDGE), seen=None):
    def fake(path, tok):
        assert tok == "tok"
        if seen is not None:
            seen.append(path)
        return list(devices) if path == "devices" else states[path.split("/")[1]]
    monkeypatch.setattr(laundry, "_get", fake)


def test_states_reduce_to_card_words():
    def st(cur, h=0, m=0):
        return laundry.machine_state({"runState": {"currentState": cur}, "timer": {"remainHour": h, "remainMinute": m}})
    assert st("POWER_OFF") == ("idle", None)
    assert st("INITIAL", 0, 50) == ("idle", None)
    assert st("RINSING", 1, 5) == ("running", 65)
    assert st("PAUSE", 0, 12) == ("paused", 12)
    assert st("END") == ("done", None)
    assert st("ERROR") == ("fault", None)
    assert st("RESERVED", 3, 0) == ("scheduled", None)
    assert laundry.machine_state({}) == ("unknown", None)
    assert laundry.machine_state(None) == ("unknown", None)
    # A washtower answers one entry per part
    assert laundry.machine_state([{"runState": {"currentState": "SPINNING"}, "timer": {"remainMinute": 4}}]) == ("running", 4)


def test_no_token_means_no_card(monkeypatch, tmp_path):
    monkeypatch.setattr(laundry, "TOKEN_FILE", str(tmp_path / "missing"))
    assert laundry.status() == {"configured": False, "available": False, "machines": []}


def test_washer_and_dryer_only_washer_first(monkeypatch):
    _serve(monkeypatch, {"w1": {"runState": {"currentState": "RUNNING"}, "timer": {"remainMinute": 32}},
                         "d1": {"runState": {"currentState": "POWER_OFF"}}})
    s = laundry.status()
    assert s["configured"] and s["available"]
    assert [(m["name"], m["kind"], m["state"], m["minutes_left"]) for m in s["machines"]] == [
        ("Washer", "washer", "running", 32), ("Dryer", "dryer", "idle", None)]


def test_done_time_is_when_first_seen_and_clears(monkeypatch):
    states = {"w1": {"runState": {"currentState": "END"}}, "d1": {}}
    _serve(monkeypatch, states, devices=(WASHER,))
    monkeypatch.setattr(laundry.time, "time", lambda: 1000.0)
    assert laundry.status()["machines"][0]["ended_at"] == 1000.0
    sources._cache.clear()
    monkeypatch.setattr(laundry.time, "time", lambda: 1300.0)
    assert laundry.status()["machines"][0]["ended_at"] == 1000.0
    sources._cache.clear()
    states["w1"] = {"runState": {"currentState": "POWER_OFF"}}
    assert laundry.status()["machines"][0]["ended_at"] is None


def test_device_list_asked_hourly_state_each_minute(monkeypatch):
    seen = []
    _serve(monkeypatch, {"w1": {}, "d1": {}}, seen=seen)
    laundry.status()
    laundry.status()  # within the state ttl: nothing asked
    sources._cache.clear()
    laundry.status()
    assert seen.count("devices") == 1
    assert seen.count("devices/w1/state") == 2


def test_refused_token_says_so(monkeypatch):
    def refuse(path, tok):
        raise laundry.Refused()
    monkeypatch.setattr(laundry, "_get", refuse)
    s = laundry.status()
    assert s["configured"] and not s["available"]
    assert "refused" in s["message"]


def test_lg_down_is_not_answering(monkeypatch):
    def down(path, tok):
        raise OSError("timed out")
    monkeypatch.setattr(laundry, "_get", down)
    assert laundry.status()["message"] == "Laundry isn't answering."


def test_http_401_becomes_refused(monkeypatch):
    def urlopen(req, timeout):
        assert req.get_header("Authorization") == "Bearer tok"
        assert req.get_header("X-country") == "US"
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, io.BytesIO(b"{}"))
    monkeypatch.setattr(laundry.urllib.request, "urlopen", urlopen)
    with pytest.raises(laundry.Refused):
        laundry._get("devices", "tok")


def test_api_route(monkeypatch):
    from fastapi.testclient import TestClient
    from hub import app as app_mod
    _serve(monkeypatch, {"w1": {"runState": {"currentState": "END"}}, "d1": {}})
    r = TestClient(app_mod.app).get("/api/laundry")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert [m["state"] for m in r.json()["machines"]] == ["done", "unknown"]
