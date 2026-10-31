"""Pairing the workshop display: a six-digit code from the owner trades for a key kept only as a hash."""
import importlib
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("DISP-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, db, display_pairing  # noqa: E402
from hub import app as hub_app  # noqa: E402

SAME = {"Origin": "http://testserver"}


@pytest.fixture
def env(tmp_path):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "DISP-4321", "owner_password": "long enough", "pin": "123456"},
                  headers=SAME).status_code == 200
    return c  # setup signs the owner in


def pair(c):
    code = c.post("/api/display/pair/start", headers=SAME).json()["code"]
    anon = TestClient(hub_app.app)
    r = anon.post("/api/display/pair", json={"code": code}, headers=SAME)
    assert r.status_code == 200
    return r.json()["key"]


def test_code_is_six_digits_and_expires_in_ten_minutes():
    out = display_pairing.start(1000.0)
    assert len(out["code"]) == 6 and out["code"].isdigit()
    assert out["expires"] == 1600


def test_redeem_gives_a_key_and_stores_only_its_hash(env):
    key = pair(env)
    assert key.startswith("hubd_") and len(key) == 5 + 32
    stored = repr(db.rows("SELECT * FROM display_keys"))
    assert key not in stored
    assert display_pairing.status()["paired"] is True
    r = env.post("/api/display/pair/start", headers=SAME)
    code = r.json()["code"]
    assert TestClient(hub_app.app).post("/api/display/pair", json={"code": code}, headers=SAME).json()["tlsName"] == "home.home.arpa"


def test_five_wrong_codes_close_the_attempt(env):
    code = display_pairing.start(1000.0)["code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert display_pairing.redeem(wrong, 1001.0) is None
    assert display_pairing.redeem(code, 1002.0) is None
    assert display_pairing.status()["code_open"] is False


def test_expired_code_is_refused(env):
    code = display_pairing.start(1000.0)["code"]
    assert display_pairing.redeem(code, 1601.0) is None


def test_code_is_single_use(env):
    code = display_pairing.start(1000.0)["code"]
    assert display_pairing.redeem(code, 1001.0)
    assert display_pairing.redeem(code, 1002.0) is None


def test_new_pairing_replaces_the_old_key(env):
    old = pair(env)
    new = pair(env)
    assert old != new
    assert env.post("/api/display/feed", headers={"X-Hub-Display-Key": old}).status_code == 401
    assert env.post("/api/display/feed", headers={"X-Hub-Display-Key": new}).status_code != 401
    assert db.one("SELECT COUNT(*) AS n FROM display_keys")["n"] == 1


def test_key_opens_display_routes_only(env):
    key = pair(env)
    anon = TestClient(hub_app.app)
    h = {"X-Hub-Display-Key": key}
    # passes the same-origin check on display routes (no Origin header), unlike other routes
    assert anon.post("/api/display/pair/start", headers=h).status_code == 401  # owner route, key is not the owner
    assert anon.post("/api/display/feed", headers=h).status_code not in (401, 403)
    # on other routes the key is ignored: same-origin check, then owner check
    assert anon.post("/api/settings/pin", json={}, headers=h).status_code == 403
    assert anon.post("/api/settings/pin", json={}, headers={**h, **SAME}).status_code == 401
    # a wrong key is 401
    assert anon.post("/api/display/feed", headers={"X-Hub-Display-Key": "hubd_nope"}).status_code == 401


def test_key_survives_restart(env):
    key = pair(env)
    importlib.reload(display_pairing)
    anon = TestClient(hub_app.app)
    assert anon.post("/api/display/feed", headers={"X-Hub-Display-Key": key}).status_code not in (401, 403)


def test_start_needs_the_owner(env):
    anon = TestClient(hub_app.app)
    assert anon.post("/api/display/pair/start", headers=SAME).status_code == 401
    assert anon.get("/api/display/pair/status").status_code == 401
    assert env.get("/api/display/pair/status").json()["code_open"] is False
