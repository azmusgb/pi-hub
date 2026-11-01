import hashlib
import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import actions, auth, db, homecontrol, wifi  # noqa: E402
from hub import app as hub_app  # noqa: E402

SAME = {"Origin": "http://testserver"}


@pytest.fixture
def c():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    return TestClient(hub_app.app)


def setup_hub(c):
    r = c.post("/api/setup", json={"code": "abcd-1234", "owner_password": "correct horse"}, headers=SAME)
    assert r.status_code == 200, r.text
    return r


def test_setup_needs_the_code_and_only_works_once(c):
    assert c.get("/api/me").json() == {"role": "none", "setup_needed": True, "device": "", "tailscale": False}
    bad = c.post("/api/setup", json={"code": "nope", "owner_password": "correct horse"}, headers=SAME)
    assert bad.status_code == 403
    weak = c.post("/api/setup", json={"code": "ABCD-1234", "owner_password": "short"}, headers=SAME)
    assert weak.status_code == 400
    setup_hub(c)
    assert c.get("/api/me").json()["role"] == "owner"
    again = c.post("/api/setup", json={"code": "ABCD-1234", "owner_password": "another one"}, headers=SAME)
    assert again.status_code == 403


def test_secrets_are_hashed_not_stored(c):
    setup_hub(c)
    raw = " ".join(r["value"] for r in db.rows("SELECT value FROM settings"))
    assert "correct horse" not in raw and "123456" not in raw


def test_owner_sign_in_unlocks_actions_and_settings(c, monkeypatch):
    setup_hub(c)
    c.post("/api/signout", headers=SAME)
    assert c.post("/api/actions/restart:plex", headers=SAME).status_code == 401
    assert c.get("/api/settings").status_code == 401
    assert c.post("/api/signin", json={"password": "correct horse"}, headers=SAME).json()["role"] == "owner"
    monkeypatch.setattr(actions, "helper", lambda name, timeout=0: {"ok": True, "message": "Done."})
    r = c.post("/api/actions/restart:plex", headers=SAME)
    assert r.status_code == 200 and r.json()["message"] == "Plex restarted."
    assert c.get("/api/settings").status_code == 200
    assert auth.recent_actions()[0]["action"] == "restart:plex"


def test_unknown_actions_are_refused(c):
    setup_hub(c)
    assert c.post("/api/actions/rm-rf", headers=SAME).status_code == 400


def test_failed_action_explains_itself(c, monkeypatch):
    setup_hub(c)
    monkeypatch.setattr(actions, "helper", lambda name, timeout=0: {"ok": False, "message": "unit not found"})
    r = c.post("/api/actions/restart:homebridge", headers=SAME)
    assert r.status_code == 502 and r.json()["detail"].startswith("Restart Homebridge didn't work.")


def test_wrong_passwords_lock_out_after_five_tries(c):
    setup_hub(c)
    c.post("/api/signout", headers=SAME)
    for _ in range(5):
        assert c.post("/api/signin", json={"password": "wrong password"}, headers=SAME).status_code == 403
    r = c.post("/api/signin", json={"password": "correct horse"}, headers=SAME)
    assert r.status_code == 429 and "10 minutes" in r.json()["detail"]


def test_session_cookie_is_http_only_and_strict(c):
    r = setup_hub(c)
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie


def test_owner_sessions_last_30_days(c):
    r = setup_hub(c)
    assert "max-age=2592000" in r.headers["set-cookie"].lower()
    (row,) = db.rows("SELECT created, expires FROM sessions WHERE role = 'owner'")
    assert row["expires"] - row["created"] == 30 * 86400


def test_the_household_pin_is_gone(c):
    setup_hub(c)
    c.post("/api/signout", headers=SAME)
    # a PIN is just a wrong password now, and counts toward the lock-out
    r = c.post("/api/signin", json={"pin": "123456"}, headers=SAME)
    assert r.status_code == 403 and "password" in r.json()["detail"]
    assert c.post("/api/settings/pin", json={"pin": "999999"}, headers=SAME).status_code == 401
    assert c.post("/api/settings/person-add", json={"name": "Sam", "kind": "adult", "pin": "222222"},
                  headers=SAME).status_code == 401
    assert c.post("/api/setup", json={"code": "ABCD-1234", "owner_password": "another one"}, headers=SAME).status_code == 403


def test_pin_day_household_and_kid_sessions_are_refused_and_cleared(c):
    setup_hub(c)
    c.post("/api/signout", headers=SAME)
    for token, role in (("old-household", "household"), ("old-kid", "kid")):
        db.run("INSERT INTO sessions (token_hash, role, created, expires) VALUES (?, ?, 0, ?)",
               hashlib.sha256(token.encode()).hexdigest(), role, int(time.time()) + 86400)
        assert c.get("/api/me", cookies={"hub_session": token}).json()["role"] == "none"
        assert c.post("/api/actions/restart:plex", headers=SAME, cookies={"hub_session": token}).status_code == 401
    c.post("/api/signin", json={"password": "correct horse"}, headers=SAME)  # the next sign-in clears their rows
    assert db.rows("SELECT role FROM sessions WHERE role IN ('household', 'kid')") == []


def test_wifi_qr_and_password_visibility(c):
    setup_hub(c)
    assert c.post("/api/settings/wifi", json={"ssid": "Home;Net", "password": "hunter2hunter2", "security": "WPA"},
                  headers=SAME).status_code == 200
    assert c.get("/api/wifi").json()["password"] == "hunter2hunter2"
    anon = TestClient(hub_app.app)
    assert anon.get("/api/wifi").json() == {"set": True, "ssid": "Home;Net", "security": "WPA", "password": None}
    assert anon.get("/api/wifi/qr.svg").status_code == 401  # the code holds the password
    svg = c.get("/api/wifi/qr.svg")
    assert svg.status_code == 200 and svg.headers["content-type"].startswith("image/svg+xml")
    assert wifi._escape("Home;Net") == "Home\\;Net"
    assert c.post("/api/settings/wifi", json={"ssid": "x", "password": "short", "security": "WPA"}, headers=SAME).status_code == 400


def test_home_control_says_how_to_connect(c):
    r = c.get("/api/home").json()
    assert r["connected"] is False and "Settings" in r["message"]


def test_home_control_validates_before_calling_homebridge():
    with pytest.raises(ValueError):
        homecontrol.set_value("../../etc", "On", True)
    with pytest.raises(ValueError):
        homecontrol.set_value("a" * 40, "TargetTemperature", 30)
