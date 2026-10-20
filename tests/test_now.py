import os

os.environ["HUB_NO_SAMPLER"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app  # noqa: E402
from hub import now, sources  # noqa: E402

HEALTHY = {
    "x2d_state": "Printing", "x2d_progress": 42, "x2d_left": "1 h 05 min", "x2d_minutes_left": 65,
    "x2d_error": "", "display_state": "Online", "display_firmware": "12.4.5", "ai_state": "Ready",
    "ai_models": 1, "ai_waiting": 0, "drive_state": "Connected", "drive_free": "160.2 GB",
    "drive_resets": 2, "drive_errors": 0, "movies": 151, "pi_temp": 55.0, "pi_power": "Good",
    "pi_uptime_h": 3.0, "updates": 0,
    "services": {"plex": True, "homebridge": True, "docker": True, "cockpit": True},
}


def test_healthy_house_says_everything_is_running():
    d = now.build(HEALTHY, [], {}, 12.0)
    assert d["summary"] == "Everything's running"
    assert d["issues"] == []
    assert d["printer"]["headline"] == "Printing, 42%"
    assert d["printer"]["left"] == "1 h 05 min"
    assert d["movies"]["count"] == 151


def test_missing_drive_and_down_pc_are_issues_with_instructions():
    s = dict(HEALTHY, drive_state="Missing", ai_state="Down", movies=None)
    d = now.build(s, [], {}, 12.0)
    whats = [i["what"] for i in d["issues"]]
    assert whats == ["Movies drive", "Windows PC"]
    assert "plug it back in" in d["issues"][0]["say"]
    assert "breaker" in d["issues"][1]["say"]
    assert d["summary"] == "2 things need a look"


def test_stopped_service_is_named():
    s = dict(HEALTHY, services={"plex": False, "homebridge": True})
    d = now.build(s, [], {}, 12.0)
    assert d["summary"] == "Plex needs a look"
    assert d["movies"]["tone"] == "bad"


def test_no_status_service_still_builds_a_page():
    d = now.build(None, None, {}, None)
    assert d["printer"]["state"] == "none"
    assert d["issues"][0]["what"] == "Status service"
    assert d["movies"]["playing"] is None


def test_printer_states_read_as_plain_words():
    assert now.printer(dict(HEALTHY, x2d_state="Paused"))["headline"] == "Paused at 42%"
    err = now.printer(dict(HEALTHY, x2d_state="Error", x2d_error="0300_0100"))
    assert err["headline"] == "Needs attention" and "0300_0100" in err["detail"]
    assert now.printer(dict(HEALTHY, x2d_state="No status"))["headline"] == "No status right now"


def test_api_now_and_pages(monkeypatch):
    monkeypatch.setattr(sources, "pi_status", lambda: HEALTHY)
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
