"""Pi Hub's own check of the workshop display, and a day of its heartbeats (hub/display_watch.py)."""
import os
import socket
import urllib.error

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import display_watch  # noqa: E402
from hub import app as hub_app  # noqa: E402

T = 1_800_000_000


@pytest.fixture
def env(tmp_path):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    return TestClient(hub_app.app)


def test_reasons_name_the_failure():
    assert display_watch._why(urllib.error.URLError(socket.timeout("timed out"))) == "timeout"
    assert display_watch._why(urllib.error.URLError(ConnectionRefusedError())) == "refused"
    assert display_watch._why(urllib.error.URLError(OSError(113, "No route to host"))) == "unreachable"
    assert display_watch._why(TimeoutError()) == "timeout"
    assert display_watch._why(urllib.error.HTTPError("u", 503, "x", {}, None)) == "http 503"


def test_check_of_nothing_listening_is_a_failure_not_a_crash():
    ok, ms, reason = display_watch.check("http://127.0.0.1:9", timeout=1)
    assert (ok, ms) == (False, None) and reason in ("refused", "unreachable", "timeout")


def test_outages_are_runs_of_failed_checks_and_logged_once(env, capsys):
    script = [True, False, False, False, True, True, False]
    for i, ok in enumerate(script):
        display_watch.probe(T + 60 * i, (ok, 80 if ok else None, "" if ok else "timeout"))
    err = capsys.readouterr().err.splitlines()
    assert err == ["display: not answering Pi Hub (timeout)", "display: answering Pi Hub again after 3 min (80 ms)",
                   "display: not answering Pi Hub (timeout)"]
    s = display_watch.summary(now=T + 400)
    assert (s["checks"], s["failed"]) == (7, 4)
    assert s["outages"] == [{"start": T + 360, "end": None, "checks": 1, "reason": "timeout"},
                            {"start": T + 60, "end": T + 240, "checks": 3, "reason": "timeout"}]
    assert s["answer_ms"] == {"median": 80, "slowest": 80}


def test_old_checks_and_beats_are_dropped(env):
    display_watch.probe(T, (True, 50, ""))
    display_watch.record_beat({"uptimeS": 10}, T)
    display_watch.probe(T + display_watch.KEEP_S + 60, (True, 50, ""))
    display_watch.record_beat({"uptimeS": 20}, T + display_watch.KEEP_S + 60)
    s = display_watch.summary(hours=48, now=T + display_watch.KEEP_S + 60)
    assert s["checks"] == 1 and len(s["beats"]) == 1


def test_a_restart_shows_with_its_reason(env, capsys):
    display_watch.record_beat({"uptimeS": 30000, "rssi": -60}, T)
    display_watch.record_beat({"uptimeS": 30300, "rssi": -72}, T + 300)
    display_watch.record_beat({"uptimeS": 120, "rssi": -70, "resetReason": 9}, T + 600)
    assert "display: restarted (brownout), up 2 min; signal -70 dBm" in capsys.readouterr().err
    s = display_watch.summary(now=T + 700)
    assert s["restarts"] == [{"at": T + 480, "reason": "brownout"}]
    assert s["signal"] == {"latest": -70, "weakest": -72, "strongest": -60}


def test_heartbeat_keeps_the_restart_fields_and_diagnostics_is_open(env):
    from tests.test_display_messages import CODE_FILE, SAME, paired
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    assert env.post("/api/setup", json={"code": "DISP-4321", "owner_password": "long enough"},
                    headers=SAME).status_code == 200
    body = {"version": "12.9.0", "uptimeS": 99, "rssi": -70, "heapMin": 4000, "heapLargest": 900, "resetReason": 4,
            "extra": "dropped"}
    assert TestClient(hub_app.app).post("/api/display/heartbeat", json=body, headers=paired(env)).status_code == 200
    d = TestClient(hub_app.app).get("/api/display/diagnostics").json()
    assert d["beats"][-1]["heapMin"] == 4000 and d["signal"]["latest"] == -70
    assert "extra" not in d["beats"][-1]
