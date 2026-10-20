import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("WXYZ-2345\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import actions, auth, db, homecontrol  # noqa: E402
from hub import app as hub_app  # noqa: E402

SAME = {"Origin": "http://testserver"}


@pytest.fixture
def owner():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "WXYZ-2345", "owner_password": "long enough", "pin": "111111"}, headers=SAME).status_code == 200
    return c


def test_people_get_their_own_pins_and_names_in_the_log(owner, monkeypatch):
    assert owner.post("/api/settings/person-add", json={"name": "Sam", "kind": "adult", "pin": "222222"}, headers=SAME).status_code == 200
    assert owner.post("/api/settings/person-add", json={"name": "Max", "kind": "kid", "pin": "333333"}, headers=SAME).status_code == 200
    dup = owner.post("/api/settings/person-add", json={"name": "Ann", "kind": "adult", "pin": "111111"}, headers=SAME)
    assert dup.status_code == 400 and "already uses" in dup.json()["detail"]
    sam = TestClient(hub_app.app)
    assert sam.post("/api/signin", json={"pin": "222222"}, headers=SAME).json()["role"] == "household"
    monkeypatch.setattr(actions, "helper", lambda name, timeout=0: {"ok": True, "message": "Done."})
    assert sam.post("/api/actions/restart:plex", headers=SAME).status_code == 200
    assert auth.recent_actions()[0]["device"].startswith("Sam on")


def test_kids_can_switch_lights_but_not_restart_things(owner, monkeypatch):
    owner.post("/api/settings/person-add", json={"name": "Max", "kind": "kid", "pin": "333333"}, headers=SAME)
    kid = TestClient(hub_app.app)
    assert kid.post("/api/signin", json={"pin": "333333"}, headers=SAME).json()["role"] == "kid"
    r = kid.post("/api/actions/restart:plex", headers=SAME)
    assert r.status_code == 403 and "grown-up" in r.json()["detail"]
    assert kid.post("/api/rules", json={"trigger": "print_finished", "action": "notify"}, headers=SAME).status_code == 403
    monkeypatch.setattr(homecontrol, "set_value", lambda *a: None)
    assert kid.post("/api/home/" + "a" * 40, json={"characteristic": "On", "value": True}, headers=SAME).status_code == 200


def test_removing_a_person_signs_out_their_devices(owner):
    owner.post("/api/settings/person-add", json={"name": "Sam", "kind": "adult", "pin": "222222"}, headers=SAME)
    sam = TestClient(hub_app.app)
    sam.post("/api/signin", json={"pin": "222222"}, headers=SAME)
    pid = auth.people()[0]["id"]
    owner.post("/api/settings/person-remove", json={"id": pid}, headers=SAME)
    assert sam.get("/api/me").json()["role"] == "none"
    assert db.rows("SELECT * FROM people") == []
