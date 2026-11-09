"""Snapshots for the Room view camera (amendment A20 D3, plan P2):
Files stored in /var/lib/pi-hub/room-snapshots/ as <epoch-ms>.jpg and <epoch-ms>.json.
FIFO retention cap of 200 snapshots.
Atomic write (temp then rename) under lock.
Routes: POST /api/camera/room/snapshots, GET .../snapshots, GET .../snapshots/<id>.jpg, DELETE .../snapshots/<id>."""
import asyncio
import json
import os
import re
import tempfile
import time
import pytest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")

from hub import room_camera, app as hub_app, auth, db  # noqa: E402

ORIGIN = {"Origin": "http://testserver"}
FAKE_JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00C\x00\xff\xd9"


@pytest.fixture(autouse=True)
def setup_env(monkeypatch, tmp_path):
    monkeypatch.setenv("HUB_SETUP_CODE_FILE", CODE_FILE)
    db_file = tmp_path / "test.db"
    monkeypatch.setenv("HUB_DB", str(db_file))
    auth._ready()
    auth._tries.clear()
    auth.setup("ABCD-1234", "correct-horse-battery")

    snap_dir = tmp_path / "snapshots"
    snap_dir.mkdir()
    monkeypatch.setattr(room_camera, "SNAPSHOT_DIR", str(snap_dir))
    yield snap_dir


def owner_client(monkeypatch):
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("owner", "test-device"))
    return TestClient(hub_app.app)


def household_client(monkeypatch):
    from hub import auth
    monkeypatch.setattr(auth, "who", lambda request: ("household", "test-tablet"))
    return TestClient(hub_app.app)


def test_snapshot_write_pair(setup_env):
    """Saving a snapshot creates both <id>.jpg and <id>.json."""
    cam = room_camera.CAMERA
    with patch.object(cam, "still", AsyncMock(return_value=(FAKE_JPG, time.time()))):
        meta = asyncio.run(room_camera.save_snapshot())

    assert re.match(r"^\d{13}$", meta["id"])
    jpg_path = os.path.join(room_camera.SNAPSHOT_DIR, f"{meta['id']}.jpg")
    json_path = os.path.join(room_camera.SNAPSHOT_DIR, f"{meta['id']}.json")

    assert os.path.exists(jpg_path)
    assert os.path.exists(json_path)
    with open(jpg_path, "rb") as f:
        assert f.read() == FAKE_JPG

    with open(json_path, "r") as f:
        data = json.load(f)
        assert data["id"] == meta["id"]
        assert "preset" in data
        assert "settings" in data


def test_snapshot_fifo_retention_200(setup_env):
    """The 200 limit holds; writing the 201st snapshot deletes the oldest."""
    cam = room_camera.CAMERA
    snap_dir = setup_env

    # Seed 200 dummy snapshots
    base_time = 1700000000000
    for i in range(200):
        s_id = str(base_time + i)
        with open(os.path.join(snap_dir, f"{s_id}.jpg"), "wb") as f:
            f.write(b"jpg")
        with open(os.path.join(snap_dir, f"{s_id}.json"), "w") as f:
            json.dump({"id": s_id, "created_at": (base_time + i) / 1000}, f)

    snaps = room_camera.list_snapshots()
    assert len(snaps) == 200

    # Save 201st
    with patch.object(cam, "still", AsyncMock(return_value=(FAKE_JPG, time.time()))):
        new_meta = asyncio.run(room_camera.save_snapshot())

    snaps = room_camera.list_snapshots()
    assert len(snaps) == 200
    # Oldest (1700000000000) should be gone
    oldest_id = str(base_time)
    assert not os.path.exists(os.path.join(snap_dir, f"{oldest_id}.jpg"))
    assert not os.path.exists(os.path.join(snap_dir, f"{oldest_id}.json"))
    assert snaps[0]["id"] == new_meta["id"]  # Newest first


def test_snapshot_id_validation(setup_env):
    """Invalid ids like ../x, 1, 14 digits, slashes are refused before disk access."""
    with pytest.raises(room_camera.Invalid):
        room_camera.get_snapshot_path("../x")
    with pytest.raises(room_camera.Invalid):
        room_camera.get_snapshot_path("1")
    with pytest.raises(room_camera.Invalid):
        room_camera.get_snapshot_path("12345678901234")  # 14 digits
    with pytest.raises(room_camera.Invalid):
        room_camera.get_snapshot_path("123456789012/a")


def test_delete_snapshot(setup_env):
    """Deleting a snapshot removes both jpg and json files."""
    snap_dir = setup_env
    s_id = "1700000000000"
    jpg_path = os.path.join(snap_dir, f"{s_id}.jpg")
    json_path = os.path.join(snap_dir, f"{s_id}.json")
    with open(jpg_path, "wb") as f:
        f.write(b"jpg")
    with open(json_path, "w") as f:
        json.dump({"id": s_id}, f)

    assert os.path.exists(jpg_path)
    assert os.path.exists(json_path)

    room_camera.delete_snapshot(s_id)
    assert not os.path.exists(jpg_path)
    assert not os.path.exists(json_path)


def test_missing_sidecar_still_lists(setup_env):
    """A snapshot with a missing .json sidecar still appears in list_snapshots."""
    snap_dir = setup_env
    s_id = "1700000000001"
    with open(os.path.join(snap_dir, f"{s_id}.jpg"), "wb") as f:
        f.write(b"jpg")

    snaps = room_camera.list_snapshots()
    assert any(s["id"] == s_id for s in snaps)


def test_frame_over_max_frame_refused(setup_env):
    """A frame larger than MAX_FRAME (2 MiB) is refused."""
    cam = room_camera.CAMERA
    big_frame = b"x" * (room_camera.MAX_FRAME + 1)
    with patch.object(cam, "still", AsyncMock(return_value=(big_frame, time.time()))):
        with pytest.raises(room_camera.Invalid) as exc:
            asyncio.run(room_camera.save_snapshot())
        assert "too large" in exc.value.reason.lower()


def test_snapshots_api_routes(setup_env, monkeypatch):
    """GET, POST, DELETE /api/camera/room/snapshots routes with auth."""
    anon = household_client(monkeypatch)

    # Refuse unauthenticated/household
    assert anon.get("/api/camera/room/snapshots").status_code in (401, 403)
    assert anon.post("/api/camera/room/snapshots").status_code in (401, 403)
    assert anon.get("/api/camera/room/snapshots/1700000000000.jpg").status_code in (401, 403)
    assert anon.delete("/api/camera/room/snapshots/1700000000000").status_code in (401, 403)

    # POST snapshot as owner
    owner = owner_client(monkeypatch)
    with patch.object(room_camera.CAMERA, "still", AsyncMock(return_value=(FAKE_JPG, time.time()))):
        r = owner.post("/api/camera/room/snapshots", headers=ORIGIN)
        assert r.status_code == 200
        snap = r.json()["snapshot"]
        s_id = snap["id"]

    # Verify log
    logs = db.rows("SELECT * FROM action_log WHERE action = 'room-camera:snapshot'")
    assert len(logs) == 1
    assert f"saved snapshot '{s_id}'" in logs[0]["result"]

    # GET list
    r = owner.get("/api/camera/room/snapshots")
    assert r.status_code == 200
    assert any(s["id"] == s_id for s in r.json()["snapshots"])

    # GET image
    r = owner.get(f"/api/camera/room/snapshots/{s_id}.jpg")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.content == FAKE_JPG

    # DELETE snapshot
    r = owner.delete(f"/api/camera/room/snapshots/{s_id}", headers=ORIGIN)
    assert r.status_code == 200

    logs = db.rows("SELECT * FROM action_log WHERE action = 'room-camera:snapshot'")
    assert len(logs) == 2
    assert f"deleted snapshot '{s_id}'" in logs[1]["result"]

    # Image is now 404
    assert owner.get(f"/api/camera/room/snapshots/{s_id}.jpg").status_code == 404
