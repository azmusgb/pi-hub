import importlib.util
import os
import tempfile
from pathlib import Path

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import actions  # noqa: E402
from hub import app as hub_app  # noqa: E402

spec = importlib.util.spec_from_file_location("helper", Path(__file__).parent.parent / "deploy" / "pi-hub-helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

SAME = {"Origin": "http://testserver"}
OLD = {"name": "sda", "size": 500_000_000_000, "tran": "usb", "type": "disk", "model": "SSK",
       "children": [{"uuid": "old-uuid", "mountpoint": "/mnt/usb1"}]}
NEW = {"name": "sdb", "size": 1_000_000_000_000, "tran": "usb", "type": "disk", "model": "Samsung T7", "children": []}


def test_drives_report_marks_the_movies_drive(monkeypatch):
    monkeypatch.setattr(helper, "movies_uuid", lambda: "old-uuid")
    monkeypatch.setattr(helper, "_disks", lambda: [OLD, NEW])
    monkeypatch.setattr(helper, "_smart", lambda name: None)
    r = helper.drives_report()
    assert [(d["name"], d["is_movies"], d["mounted"]) for d in r["drives"]] == [("sda", True, True), ("sdb", False, False)]


def test_the_drive_wiping_move_is_gone():
    # The Pi's drive is now a copy of the PC's movies; there is nothing to move and nothing to wipe.
    c = TestClient(hub_app.app)
    assert c.post("/api/drives/move", json={"device": "sdb", "confirm": "ERASE"}, headers=SAME).status_code in (404, 405)
    assert c.post("/api/drives/switch", headers=SAME).status_code in (404, 405)
    assert not hasattr(helper, "move_start") and "mkfs" not in Path(helper.__file__).read_text()


def test_copy_now_runs_through_the_helper(monkeypatch):
    assert helper.ACTIONS["mirror:movies"][0] == ["systemctl", "start", "--no-block", "pi-hub-movies-mirror.service"]
    calls = []
    monkeypatch.setattr(actions, "helper", lambda a, timeout=1900: calls.append(a) or {"ok": True})
    assert "Copying new movies" in actions.run("mirror:movies")["message"] and calls == ["mirror:movies"]


def test_drives_api_includes_the_copy_state(monkeypatch):
    monkeypatch.setattr(actions, "helper", lambda a, timeout=1900: {"ok": True, "drives": []})
    monkeypatch.setattr(hub_app.sources, "pi_status", lambda: {"mirror": {"state": "ok", "last_ok": 1, "count": 149}})
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("household", None))
    d = TestClient(hub_app.app).get("/api/drives").json()
    assert d["mirror"]["count"] == 149 and d["drives"] == []


def test_drives_api_needs_a_household_sign_in(monkeypatch):
    monkeypatch.setattr(actions, "helper", lambda a, timeout=1900: pytest.fail("ran smartctl for a signed-out caller"))
    assert TestClient(hub_app.app).get("/api/drives").status_code == 401
