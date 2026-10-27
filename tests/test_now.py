import os

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(__import__("tempfile").mkdtemp(), "hub.db"))

from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app  # noqa: E402
from hub import now, records, sources  # noqa: E402
from tests.helpers_records import bud, records_from  # noqa: E402

HEALTHY = {
    "x2d_state": "Printing", "x2d_progress": 42, "x2d_left": "1 h 05 min", "x2d_minutes_left": 65,
    "x2d_error": "", "display_state": "Online", "display_firmware": "12.4.5", "ai_state": "Ready",
    "ai_models": 1, "ai_waiting": 0, "drive_state": "Connected", "drive_free": "160.2 GB",
    "drive_resets": 2, "drive_errors": 0, "movies": 151, "pi_temp": 55.0, "pi_power": "Good",
    "pi_uptime_h": 3.0, "updates": 0,
    "services": {"plex": True, "homebridge": True, "docker": True, "cockpit": True},
    "mirror": {"last_ok": 1000},
}
RUNNING = bud("RUNNING", progress=42)


def recs(s=HEALTHY, b=RUNNING, **kw):
    return records_from(s, b, **kw)


def test_healthy_house_says_everything_is_running():
    d = now.build(recs(), [], {}, 12.0)
    assert d["summary"] == "Everything's running"
    assert d["issues"] == []
    assert d["printer"]["headline"] == "Printing HEX_TILE_v72, 42%"
    assert d["printer"]["progress"] == 42
    assert d["printer"]["left"] == ""  # Bambuddy gives no time left; the record doesn't guess one
    assert d["movies"]["count"] == 151


def test_missing_drive_and_down_pc_are_issues_with_instructions():
    s = dict(HEALTHY, drive_state="Missing", ai_state="Down", movies=None)
    d = now.build(recs(s), [], {}, 12.0)
    say = {i["what"]: i["say"] for i in d["issues"]}
    assert set(say) == {"Movies drive", "Local AI"}
    assert all(i["tone"] == "bad" for i in d["issues"])
    assert "plug it back in" in say["Movies drive"]
    assert "the PC may be off" in say["Local AI"]  # NETMON gave no PC reading
    assert d["summary"] == "2 things need a look"


def test_stopped_service_is_named():
    s = dict(HEALTHY, services={"plex": False, "homebridge": True})
    d = now.build(recs(s), [], {}, 12.0)
    assert d["summary"] == "Movies need a look"
    assert d["movies"]["tone"] == "bad"


def test_no_status_service_still_builds_a_page():
    d = now.build({}, None, {}, None)
    assert d["printer"]["state"] == "none"
    assert d["issues"][0]["what"] == "Home status unavailable"


def test_network_metrics_included_when_available():
    net = {"status": "ok", "orbi_ms": 2.1, "wan_ms": 8.3}
    d = now.build(recs(), [], {}, 12.0, network=net)
    assert d["network"] == net


def test_printer_states_read_as_plain_words():
    assert now.printer(dict(HEALTHY, x2d_state="Paused"))["headline"] == "Paused at 42%"
    err = now.printer(dict(HEALTHY, x2d_state="Error", x2d_error="0300_0100"))
    assert err["headline"] == "Needs attention" and "0300_0100" in err["detail"]
    assert now.printer(dict(HEALTHY, x2d_state="No status"))["headline"] == "No status right now"


def test_api_now_and_pages(monkeypatch):
    held = recs()
    monkeypatch.setattr(records, "all", lambda: held)
    monkeypatch.setattr(sources, "pi_status", lambda: (_ for _ in ()).throw(AssertionError("/api/now reads the records")))
    monkeypatch.setattr(sources, "bambuddy_printer", lambda: (_ for _ in ()).throw(AssertionError("records")))
    monkeypatch.setattr(sources, "plex_sessions", lambda: [{"title": "Alien", "who": "Bill", "device": "TV",
                                                            "state": "playing", "progress": 30, "minutes_left": 80}])
    c = TestClient(hub_app.app)
    r = c.get("/api/now")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["movies"]["playing"][0]["title"] == "Alien"
    assert "temp_series" in body["pi"] and body["pi"]["temp"] == 55.0
    assert c.get("/").status_code == 200
    assert c.get("/sw.js").headers["content-type"].startswith("text/javascript")
    assert c.get("/static/manifest.webmanifest").status_code == 200
    assert c.get("/healthz").json() == {"ok": True}


def test_missing_status_does_not_claim_devices_are_offline():
    d = now.build({}, None, {}, None)
    assert d["status_available"] is False
    assert d["issues"][0]["href"] == "/pi"
    assert "Restart" not in d["issues"][0]["say"]
    assert now.build(recs(), [], {}, 12)["status_available"] is True


def test_printer_error_links_to_workshop_instead_of_system_restart():
    issue = next(i for i in now.issues(dict(HEALTHY, x2d_state="Error")) if i["what"] == "Bambu X2D")
    assert issue["href"] == "/workshop"
    assert "screen" in issue["say"]
    assert "fix" not in issue


def test_bambuddy_telemetry_enriches_printer_status():
    b = {
        "connected": True,
        "nozzle_temp": 215.0,
        "nozzle_target": 220.0,
        "bed_temp": 60.0,
        "bed_target": 60.0,
        "ams_humidity": 35,
        "layer_num": 42,
        "total_layers": 660,
        "job_name": "test_bracket.3mf",
        "filament_type": "PETG",
        "filament_color": "161616FF",
    }
    d = now.build(recs(b=b), [], {}, 12.0)
    p = d["printer"]
    assert p["nozzle_temp"] == 215.0
    assert p["temperatures"] == {"nozzle": 215.0, "nozzle_target": 220.0, "bed": 60.0, "bed_target": 60.0}
    assert p["bed_temp"] == 60.0
    assert p["layer_num"] == 42
    assert p["total_layers"] == 660
    assert p["job_name"] == "test_bracket"  # the record keeps the job's name without the file ending
    assert p["filament_type"] == "PETG"
    assert p["bambuddy_connected"] is True


def _prometheus(monkeypatch, success):
    def fake(url, headers=None, timeout=4):
        if "probe_duration_seconds" in url:
            return {"data": {"result": [{"metric": {"instance": "10.0.0.1"}, "value": [0, "0.0021"]},
                                        {"metric": {"instance": "10.0.0.136"}, "value": [0, "0.004"]}]}}
        if "probe_success" in url:
            return {"data": {"result": [{"metric": {"instance": i}, "value": [0, v]} for i, v in success.items()]}}
        raise OSError("router status not running")
    monkeypatch.setattr(sources, "_get_json", fake)
    return sources._netmon()


def test_network_status_reads_wan_probes(monkeypatch):
    ok = _prometheus(monkeypatch, {"10.0.0.1": "1", "1.1.1.1": "0", "8.8.8.8": "1"})
    assert ok["status"] == "ok" and ok["orbi_ms"] == 2.1 and ok["printer_ms"] == 4.0 and ok["orbi_uptime"] is None
    # One WAN probe missing must not hide the other one failing.
    assert _prometheus(monkeypatch, {"10.0.0.1": "1", "8.8.8.8": "0"})["status"] == "bad"
    assert _prometheus(monkeypatch, {"10.0.0.1": "0", "1.1.1.1": "1"})["status"] == "bad"
    # No probe results at all is unknown, not healthy.
    assert _prometheus(monkeypatch, {})["status"] == "unknown"


def test_network_metrics_absent_when_prometheus_is_down(monkeypatch):
    def down(*a, **k):
        raise OSError("connection refused")
    monkeypatch.setattr(sources, "_get_json", down)
    assert sources._netmon() is None


# ---- One home, step 3: which printer actions fit now ----

B = {"connected": True, "bambuddy_state": "FINISH", "awaiting_plate_clear": True}


def test_actions_follow_bambuddy():
    assert now.printer_actions(None) == []
    assert now.printer_actions({**B, "connected": False}) == []
    assert now.printer_actions(B) == ["clear"]
    assert now.printer_actions({**B, "bambuddy_state": "RUNNING", "awaiting_plate_clear": False}) == ["pause"]
    assert now.printer_actions({**B, "bambuddy_state": "PAUSE", "awaiting_plate_clear": False}) == ["resume"]


def test_finished_and_failed_headlines_ask_to_clear():
    assert now.printer({"x2d_state": "Idle"}, B)["headline"] == "Print done — clear the plate"
    assert now.printer({"x2d_state": "Idle"}, {**B, "bambuddy_state": "FAILED"})["headline"] == "Print failed — clear the plate"


def test_paused_detail_points_here_when_resume_is_possible():
    p = now.printer({"x2d_state": "Paused", "x2d_progress": 40},
                    {**B, "bambuddy_state": "PAUSE", "awaiting_plate_clear": False})
    assert p["actions"] == ["resume"] and p["detail"] == "Resume it here or on the printer."


def test_no_bambuddy_means_no_actions():
    assert now.printer({"x2d_state": "Printing", "x2d_progress": 5}, None)["actions"] == []


def test_bambuddy_status_carries_state_and_plate_flag(monkeypatch):
    monkeypatch.setattr(sources, "_get_json", lambda *a, **k: {"connected": True, "state": "FINISH", "awaiting_plate_clear": True})
    b = sources._bambuddy()
    assert b["bambuddy_state"] == "FINISH" and b["awaiting_plate_clear"] is True


def test_workshop_printer_has_bambuddy_actions(monkeypatch):
    monkeypatch.setattr(sources, "pi_status", lambda: {"x2d_state": "Idle"})
    monkeypatch.setattr(sources, "bambuddy_printer", lambda: B)
    r = TestClient(hub_app.app).get("/api/workshop")
    assert r.json()["printer"]["actions"] == ["clear"]


def test_a_printer_error_with_the_plate_waiting_still_says_so():
    p = now.printer({"x2d_state": "Error", "x2d_error": "0300-4000"}, B)
    assert p["state"] == "error" and p["actions"] == ["clear"]
    assert p["headline"] == "Print failed — clear the plate"
    assert p["detail"] == "The printer reports 0300-4000. Check its screen."


def test_no_clear_while_a_new_print_runs_even_if_bambuddy_still_flags_the_plate():
    # seen live 25 Oct: E-012 started from the printer, Bambuddy kept awaiting_plate_clear true while RUNNING
    assert now.printer_actions({**B, "bambuddy_state": "RUNNING"}) == ["pause"]
    assert now.printer_actions({**B, "bambuddy_state": "PAUSE"}) == ["resume"]
    assert now.printer_actions({**B, "bambuddy_state": "IDLE"}) == []


def test_assistant_state_follows_the_status_service(monkeypatch):
    c = TestClient(hub_app.app)
    monkeypatch.setattr(sources, "pi_status", lambda: {"ai_state": "Down"})
    assert c.get("/api/assistant").json() == {"state": "Down"}
    monkeypatch.setattr(sources, "pi_status", lambda: None)
    assert c.get("/api/assistant").json() == {"state": "Unknown"}


def test_camera_says_why_when_the_printer_shares_no_video(monkeypatch):
    import urllib.request as ur

    def down(*a, **k):
        raise OSError("no bridge")
    monkeypatch.setattr(ur, "urlopen", down)
    c = TestClient(hub_app.app)
    sources._cache.clear()
    monkeypatch.setattr(sources, "_printer_port_open", lambda port: port != 322)
    assert c.get("/api/camera").json()["reason"] == "liveview_off"
    sources._cache.clear()
    monkeypatch.setattr(sources, "_printer_port_open", lambda port: False)
    assert c.get("/api/camera").json()["reason"] == "printer_unreachable"
    sources._cache.clear()
    monkeypatch.setattr(sources, "_printer_port_open", lambda port: True)
    assert c.get("/api/camera").json()["reason"] is None


# ---- Print lab link: the printer card links Local AI's Print lab while a lab experiment is printing ----

def test_lab_link_only_while_a_lab_experiment_prints():
    lab = {"experiment": "E-020"}
    assert now.printer(HEALTHY, None, lab)["lab"] == lab
    paused = {**HEALTHY, "x2d_state": "Paused"}
    assert now.printer(paused, None, lab)["lab"] == lab
    idle = {**HEALTHY, "x2d_state": "Idle"}
    assert "lab" not in now.printer(idle, None, lab)
    assert "lab" not in now.printer(HEALTHY, None, None)


def test_localai_lab_reads_the_projects_feed(monkeypatch):
    feed = {"projects": [{"name": "other", "live": None}, {"name": "hex-tile", "live": {"experiment": "E-020", "state": "printing"}}]}
    monkeypatch.setattr(sources, "_localai_lab_projects", lambda: feed)
    sources._cache.pop("localai-lab", None)
    assert sources.localai_lab() == {"experiment": "E-020"}
    for bad in ({"projects": [{"live": {"experiment": "<img src=x>"}}]}, {"projects": [{"live": None}]}, {"projects": "x"}, None):
        monkeypatch.setattr(sources, "_localai_lab_projects", lambda bad=bad: bad)
        sources._cache.pop("localai-lab", None)
        assert sources.localai_lab() is None

    def down():
        raise OSError("no route")
    monkeypatch.setattr(sources, "_localai_lab_projects", down)
    sources._cache.pop("localai-lab", None)
    assert sources.localai_lab() is None


def test_now_and_workshop_carry_the_lab_link(monkeypatch):
    held = recs(lab={"experiment": "E-020"})
    monkeypatch.setattr(records, "all", lambda: held)
    monkeypatch.setattr(sources, "pi_status", lambda: HEALTHY)
    monkeypatch.setattr(sources, "bambuddy_printer", lambda: None)
    monkeypatch.setattr(sources, "localai_lab", lambda: {"experiment": "E-020"})
    c = TestClient(hub_app.app)
    assert c.get("/api/now").json()["printer"]["lab"] == {"experiment": "E-020"}
    idle = recs(b=bud("IDLE"), lab={"experiment": "E-020"})
    assert "lab" not in now.build(idle, [], {}, None)["printer"]
    assert c.get("/api/workshop").json()["printer"]["lab"] == {"experiment": "E-020"}
