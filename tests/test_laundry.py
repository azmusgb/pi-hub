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
    laundry._access.clear()
    laundry._lists.clear()
    token = tmp_path / "thinq_pat"
    token.write_text("tok\n")
    monkeypatch.setattr(laundry, "TOKEN_FILE", str(token))
    # GE and Bosch stay unconfigured unless a test saves their files
    monkeypatch.setattr(laundry, "GE_TOKEN_FILE", str(tmp_path / "smarthq_refresh"))
    monkeypatch.setattr(laundry, "HC_FILE", str(tmp_path / "homeconnect.json"))
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


# ---------- GE SmartHQ and Bosch Home Connect ----------

def _erds(state, seconds):
    return {"items": [{"erd": "0x2000", "value": f"{state:02X}"}, {"erd": "0x2007", "value": f"{seconds:04X}"}]}


def test_ge_values_reduce_to_card_words():
    assert laundry.ge_machine(_erds(2, 2078)) == ("running", 35)  # 34 min 38 s, as the dryer showed on 2 Nov
    assert laundry.ge_machine(_erds(3, 600)) == ("paused", 10)
    assert laundry.ge_machine(_erds(0, 2669)) == ("idle", None)  # time left from the last cycle is ignored
    assert laundry.ge_machine(_erds(4, 0)) == ("done", None)
    assert laundry.ge_machine(_erds(6, 3600)) == ("scheduled", None)
    assert laundry.ge_machine(_erds(2, 65535)) == ("running", None)  # GE's "no value"
    assert laundry.ge_machine(_erds(99, 0)) == ("unknown", None)
    assert laundry.ge_machine({"items": []}) == ("unknown", None)
    assert laundry.ge_machine([{"erd": "0x2000", "value": "02"}]) == ("running", None)  # a bare list works too


def test_bosch_status_and_time_left():
    st = lambda v: {"data": {"status": [{"key": "BSH.Common.Status.DoorState", "value": "x"},
                                        {"key": "BSH.Common.Status.OperationState", "value": f"BSH.Common.EnumType.OperationState.{v}"}]}}
    assert laundry.hc_state(st("Ready")) == "idle"
    assert laundry.hc_state(st("Run")) == "running"
    assert laundry.hc_state(st("Finished")) == "done"
    assert laundry.hc_state(st("DelayedStart")) == "scheduled"
    assert laundry.hc_state(st("Error")) == "fault"
    assert laundry.hc_state({}) == "unknown"
    prog = lambda s: {"data": {"options": [{"key": "BSH.Common.Option.RemainingProgramTime", "value": s, "unit": "seconds"}]}}
    assert laundry.hc_minutes_left(prog(4081)) == 69
    assert laundry.hc_minutes_left(prog(0)) is None
    assert laundry.hc_minutes_left({}) is None


def _all_three(monkeypatch, tmp_path, ge_erds=None, hc_op="Run", calls=None, ge_refuse=False):
    (tmp_path / "smarthq_refresh").write_text("ge-refresh\n")
    (tmp_path / "homeconnect.json").write_text('{"client_id": "cid", "refresh_token": "hc-refresh"}')
    _serve(monkeypatch, {"w1": {"runState": {"currentState": "RUNNING"}, "timer": {"remainMinute": 24}}}, devices=(WASHER,))

    def fake(url, headers=None, data=None):
        if calls is not None:
            calls.append(url)
        if url.endswith("/oauth2/token"):
            if ge_refuse:
                raise laundry.Refused()
            assert b"refresh_token=ge-refresh" in data
            return {"access_token": "ge-access", "expires_in": 3600}
        if url.endswith("/security/oauth/token"):
            assert b"client_id=cid" in data and b"refresh_token=hc-refresh" in data
            return {"access_token": "hc-access", "expires_in": 86400}
        if url.endswith("/v1/appliance"):
            assert headers["Authorization"] == "Bearer ge-access"
            return {"items": [{"applianceId": "0200004B89ED", "type": "Clothes Dryer", "nickname": "Dryer", "online": "ONLINE"}]}
        if url.endswith("/erd"):
            return ge_erds or _erds(2, 2078)
        if url.endswith("/api/homeappliances"):
            assert headers["Authorization"] == "Bearer hc-access"
            return {"data": {"homeappliances": [{"haId": "BOSCH-1", "type": "Dishwasher", "name": "Dishwasher", "connected": True},
                                                {"haId": "BOSCH-2", "type": "Oven", "name": "Oven", "connected": True}]}}
        if url.endswith("/status"):
            return {"data": {"status": [{"key": "BSH.Common.Status.OperationState", "value": f"BSH.Common.EnumType.OperationState.{hc_op}"}]}}
        if url.endswith("/programs/active"):
            return {"data": {"options": [{"key": "BSH.Common.Option.RemainingProgramTime", "value": 4081}]}}
        raise AssertionError(url)
    monkeypatch.setattr(laundry, "_http_json", fake)


def test_washer_dryer_dishwasher_in_one_card(monkeypatch, tmp_path):
    _all_three(monkeypatch, tmp_path)
    s = laundry.status()
    assert s["configured"] and s["available"] and "message" not in s
    assert [(m["name"], m["kind"], m["state"], m["minutes_left"]) for m in s["machines"]] == [
        ("Washer", "washer", "running", 24), ("Dryer", "dryer", "running", 35), ("Dishwasher", "dishwasher", "running", 69)]
    assert [m["id"] for m in s["machines"]][1:] == ["ge:0200004B89ED", "bosch:BOSCH-1"]


def test_tokens_and_lists_are_reused(monkeypatch, tmp_path):
    calls = []
    _all_three(monkeypatch, tmp_path, hc_op="Ready", calls=calls)
    laundry.status()
    sources._cache.clear()
    laundry.status()
    tail = lambda end: sum(1 for c in calls if c.endswith(end))
    assert tail("/oauth2/token") == 1 and tail("/security/oauth/token") == 1  # access tokens kept until near expiry
    assert tail("/v1/appliance") == 1 and tail("/api/homeappliances") == 1  # lists asked hourly
    assert tail("/erd") == 2 and tail("/status") == 2
    assert tail("/programs/active") == 0  # only asked while a program runs


def test_bosch_reads_are_cached_three_minutes(monkeypatch, tmp_path):
    calls = []
    _all_three(monkeypatch, tmp_path, calls=calls)
    now = [1000.0]
    monkeypatch.setattr(laundry.sources.time, "time", lambda: now[0])
    laundry.status()
    now[0] += 120
    laundry.status()
    assert sum(1 for c in calls if c.endswith("/status")) == 1
    now[0] += 61
    laundry.status()
    assert sum(1 for c in calls if c.endswith("/status")) == 2


def test_one_source_failing_keeps_the_others(monkeypatch, tmp_path):
    _all_three(monkeypatch, tmp_path, ge_refuse=True)
    s = laundry.status()
    assert s["available"]
    assert [m["kind"] for m in s["machines"]] == ["washer", "dishwasher"]
    assert "GE refused" in s["message"]


def test_offline_and_unknown_appliances(monkeypatch, tmp_path):
    (tmp_path / "smarthq_refresh").write_text("ge-refresh")
    monkeypatch.setattr(laundry, "TOKEN_FILE", str(tmp_path / "no-lg"))

    def fake(url, headers=None, data=None):
        if url.endswith("/oauth2/token"):
            return {"access_token": "a", "expires_in": 3600}
        if url.endswith("/v1/appliance"):
            return {"items": [{"applianceId": "D", "type": "Clothes Dryer", "online": "OFFLINE"},
                              {"applianceId": "F", "type": "Refrigerator", "online": "ONLINE"}]}
        raise AssertionError(url)
    monkeypatch.setattr(laundry, "_http_json", fake)
    s = laundry.status()
    assert [(m["name"], m["state"]) for m in s["machines"]] == [("Dryer", "offline")]


def test_bad_bosch_file_is_unconfigured(tmp_path, monkeypatch):
    monkeypatch.setattr(laundry, "TOKEN_FILE", str(tmp_path / "no-lg"))
    (tmp_path / "homeconnect.json").write_text("not json")
    assert laundry.status() == {"configured": False, "available": False, "machines": []}
    (tmp_path / "homeconnect.json").write_text('{"client_id": "cid"}')
    assert laundry.status()["configured"] is False


def test_http_400_on_refresh_is_refused(monkeypatch):
    def urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(b"{}"))
    monkeypatch.setattr(laundry.urllib.request, "urlopen", urlopen)
    with pytest.raises(laundry.Refused):
        laundry._http_json("https://x/oauth2/token", {}, b"")
