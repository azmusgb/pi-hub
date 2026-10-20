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


@pytest.fixture
def drives(monkeypatch):
    monkeypatch.setattr(helper, "movies_uuid", lambda: "old-uuid")
    monkeypatch.setattr(helper, "_disks", lambda: [OLD, NEW])
    monkeypatch.setattr(helper, "_real_mount", lambda p: p == "/mnt/usb1")

    class St:
        f_blocks, f_bfree, f_frsize = 100, 40, 5_000_000_000  # 300 GB used
    monkeypatch.setattr(helper.os, "statvfs", lambda p: St)
    monkeypatch.setattr(helper, "MOVE_STATE", os.path.join(tempfile.mkdtemp(), "move.json"))
    started = []
    monkeypatch.setattr(helper.threading, "Thread", lambda target, daemon: type("T", (), {"start": lambda self: started.append(1)})())
    return started


def test_move_refuses_unsafe_targets(drives):
    assert "Unknown drive" in helper.move_start("mmcblk0")["message"]
    assert "Unknown drive" in helper.move_start("sdb; reboot")["message"]
    assert "current movies drive" in helper.move_start("sda")["message"]
    assert "isn't plugged in" in helper.move_start("sdc")["message"]
    assert drives == []


def test_move_refuses_a_drive_that_is_too_small(drives, monkeypatch):
    small = dict(NEW, size=200_000_000_000)
    monkeypatch.setattr(helper, "_disks", lambda: [OLD, small])
    assert "too small" in helper.move_start("sdb")["message"]


def test_move_starts_on_a_good_new_drive(drives):
    r = helper.move_start("sdb")
    assert r["ok"] and drives == [1]


def test_move_needs_the_old_drive_mounted(drives, monkeypatch):
    monkeypatch.setattr(helper, "_real_mount", lambda p: False)
    assert "has to be plugged in" in helper.move_start("sdb")["message"]


def test_switch_needs_a_finished_copy(drives):
    assert "Finish the copy" in helper.move_switch()["message"]


def test_move_route_needs_owner_and_erase(monkeypatch):
    c = TestClient(hub_app.app)
    assert c.post("/api/drives/move", json={"device": "sdb", "confirm": "ERASE"}, headers=SAME).status_code == 401
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("owner", "Mac"))
    r = c.post("/api/drives/move", json={"device": "sdb", "confirm": "yes"}, headers=SAME)
    assert r.status_code == 400 and "Type ERASE" in r.json()["detail"]
    monkeypatch.setattr(actions, "helper_with", lambda a, extra, timeout=60: {"ok": True, "message": f"{a} {extra['device']}"})
    assert c.post("/api/drives/move", json={"device": "sdb", "confirm": "erase"}, headers=SAME).json()["message"] == "move:start sdb"
