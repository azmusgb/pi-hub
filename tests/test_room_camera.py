"""The Room view's camera (amendment A17, plan P1): one capture at a time, only while someone looks, never stored, at
most four live viewers, one restart, and a state that says why in words. The real rpicam tools are stood in for by
tests/fixtures/fake_rpicam.py."""
import asyncio
import os
import sys
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import room_camera  # noqa: E402
from hub import app as hub_app  # noqa: E402

FAKE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "fake_rpicam.py")


def fake(mode):
    return [sys.executable, FAKE, mode]


@pytest.fixture
def cam(monkeypatch):
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.3)
    monkeypatch.setattr(room_camera, "LIVE_LIMIT", 60)
    return room_camera.RoomCamera(vid=fake("vid"), still=fake("still"), listing=fake("list"))


def run(coro):
    return asyncio.run(coro)


async def take(stream, n):
    """The first n frames of a live stream, then let it go (as a browser closing the tab)."""
    got = []
    async for part in stream:
        got.append(part)
        if len(got) >= n:
            break
    await stream.aclose()
    return got


# ---- state ----

def test_state_before_anything_is_not_checked(cam):
    assert cam.state()["state"] == "not_checked"


def test_rotation_setting(monkeypatch):
    for raw, want in (("90", 90), ("180", 180), ("270", 270), ("0", 0), ("45", 0), ("", 0), ("ninety", 0), (None, 0)):
        if raw is None:
            monkeypatch.delenv("ROOM_CAMERA_ROTATE", raising=False)
        else:
            monkeypatch.setenv("ROOM_CAMERA_ROTATE", raw)
        assert room_camera.rotation() == want, raw


def test_180_is_turned_at_capture_and_90_is_left_to_the_page(monkeypatch):
    monkeypatch.setenv("ROOM_CAMERA_ROTATE", "180")
    assert room_camera.capture_args(["rpicam-vid"])[-2:] == ["--rotation", "180"]
    monkeypatch.setenv("ROOM_CAMERA_ROTATE", "90")
    assert "--rotation" not in room_camera.capture_args(["rpicam-vid"])


# ---- stills ----

def test_a_still_with_nothing_running_is_one_capture(cam):
    async def go():
        jpg, at = await cam.still()
        assert jpg.startswith(b"\xff\xd8") and jpg.endswith(b"\xff\xd9")
        assert time.time() - at < 5
        assert cam.state()["state"] == "ready"
        assert cam.proc is None  # one-shot: nothing left running
    run(go())


def test_two_stills_at_once_take_one_capture_and_a_young_still_is_shared(cam):
    async def go():
        a, b = await asyncio.gather(cam.still(), cam.still())
        assert a == b
        c = await cam.still()
        assert c == a
        assert cam.captures == 1
    run(go())


def test_a_still_older_than_its_sharing_window_is_taken_again(cam, monkeypatch):
    monkeypatch.setattr(room_camera, "SHARE_FOR", 0.05)

    async def go():
        await cam.still()
        await asyncio.sleep(0.1)
        await cam.still()
        assert cam.captures == 2
    run(go())


def test_no_camera_listed_is_not_detected():
    c = room_camera.RoomCamera(vid=fake("die"), still=fake("die"), listing=fake("none"))

    async def go():
        with pytest.raises(room_camera.Unavailable) as e:
            await c.still()
        assert e.value.reason == "not_detected"
        assert c.state() | {"frame_at": None} == {"state": "unavailable", "reason": "not_detected", "viewers": 0,
                                                  "frame_at": None, "rotate": 0}
    run(go())


def test_a_capture_that_fails_twice_is_capture_failed():
    c = room_camera.RoomCamera(vid=fake("die"), still=fake("die"), listing=fake("list"))

    async def go():
        with pytest.raises(room_camera.Unavailable) as e:
            await c.still()
        assert e.value.reason == "capture_failed"
        assert c.captures == 2  # the one retry R5 allows, no more
    run(go())


def test_an_old_frame_is_never_served_as_current(cam, monkeypatch):
    async def go():
        await cam.still()
        cam.frame_at -= room_camera.MAX_AGE + 1  # the last good still is now too old to show
        cam.still_cmd = fake("die")
        with pytest.raises(room_camera.Unavailable):
            await cam.still()
    run(go())


# ---- live ----

def test_first_viewer_starts_the_capture_and_last_leaving_stops_it(cam):
    async def go():
        parts = await take(cam.live(), 3)
        assert all(p.startswith(b"--frame\r\nContent-Type: image/jpeg\r\n") for p in parts)
        assert cam.starts == 1
        assert cam.state()["viewers"] == 0
        assert cam.proc is not None  # still running during the grace period
        await asyncio.sleep(room_camera.STOP_AFTER + 0.4)
        assert cam.proc is None
        assert cam.state()["state"] == "ready"
    run(go())


def test_viewers_share_one_capture(cam):
    async def go():
        await asyncio.gather(take(cam.live(), 3), take(cam.live(), 3))
        assert cam.starts == 1
    run(go())


def test_a_viewer_returning_within_the_grace_period_keeps_the_same_capture(cam):
    async def go():
        await take(cam.live(), 2)
        await take(cam.live(), 2)
        assert cam.starts == 1
    run(go())


def test_a_fifth_live_viewer_is_busy_and_a_leaving_one_frees_its_place(cam):
    async def go():
        streams = [cam.live() for _ in range(4)]
        for s in streams:
            await s.__anext__()
        assert cam.state()["state"] == "live" and cam.state()["viewers"] == 4
        with pytest.raises(room_camera.Unavailable) as e:
            await cam.live().__anext__()
        assert e.value.reason == "busy"
        await streams[0].aclose()
        fifth = cam.live()
        await fifth.__anext__()
        for s in [*streams[1:], fifth]:
            await s.aclose()
    run(go())


def test_live_ends_itself_at_its_limit(cam, monkeypatch):
    monkeypatch.setattr(room_camera, "LIVE_LIMIT", 0.3)

    async def go():
        n = 0
        async for _ in cam.live():
            n += 1
        assert n > 0
        assert cam.state()["viewers"] == 0
    run(go())


def test_a_capture_that_dies_is_restarted_once_then_capture_failed(monkeypatch):
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.3)
    c = room_camera.RoomCamera(vid=fake("die"), still=fake("die"), listing=fake("list"))

    async def go():
        with pytest.raises(room_camera.Unavailable) as e:
            async for _ in c.live():
                pass
        assert e.value.reason == "capture_failed"
        assert c.starts == 2
        assert c.state()["reason"] == "capture_failed"
    run(go())


def test_a_still_during_live_is_the_newest_live_frame(cam):
    async def go():
        s = cam.live()
        await s.__anext__()
        await asyncio.sleep(0.1)
        await cam.still()
        assert cam.captures == 0  # no one-shot while live runs
        await s.aclose()
    run(go())


def test_nothing_is_written_to_disk(cam, monkeypatch):
    scratch = tempfile.mkdtemp()  # the temporary directory, for this module and the capture it starts
    monkeypatch.setattr(tempfile, "tempdir", scratch)
    monkeypatch.setenv("TMPDIR", scratch)

    def files():
        out = set()
        for root in (os.getcwd(), scratch):
            for d, _, names in os.walk(root):
                if "node_modules" in d or ".git" in d:
                    continue
                out.update(os.path.join(d, n) for n in names)
        return out

    before = files()

    async def go():
        await cam.still()
        await take(cam.live(), 5)
        await asyncio.sleep(room_camera.STOP_AFTER + 0.4)
    run(go())
    new = {p for p in files() - before if "__pycache__" not in p and not p.endswith((".pyc", ".db", "-journal"))}
    assert new == set()


def test_frame_splitting_survives_chunks_cut_anywhere():
    frames = [b"\xff\xd8a1\xff\xd9", b"\xff\xd8bb22\xff\xd9", b"\xff\xd8c\xff\xd9"]
    data = b"".join(frames)
    for cut in range(1, len(data)):
        s = room_camera.FrameSplitter()
        got = s.feed(data[:cut]) + s.feed(data[cut:])
        assert got == frames, cut


def test_frame_splitting_drops_a_runaway_buffer():
    s = room_camera.FrameSplitter()
    assert s.feed(b"\xff\xd8" + b"x" * (room_camera.MAX_FRAME + 10)) == []
    assert s.feed(b"\xff\xd8ok\xff\xd9") == [b"\xff\xd8ok\xff\xd9"]


# ---- routes ----

@pytest.fixture
def client(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.3)
    monkeypatch.setattr(room_camera, "CAMERA",
                        room_camera.RoomCamera(vid=fake("vid"), still=fake("still"), listing=fake("list")))
    return TestClient(hub_app.app)


def test_each_route_refuses_a_viewer_who_isnt_signed_in(client):
    for path in ("/api/camera/room", "/api/camera/room.jpg", "/api/camera/room/live"):
        r = client.get(path)
        assert r.status_code == 401, path
    assert room_camera.CAMERA.captures == 0 and room_camera.CAMERA.starts == 0


def signed_in(monkeypatch):
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("household", "test"))


def test_still_route_serves_a_jpeg_with_its_time(client, monkeypatch):
    signed_in(monkeypatch)
    r = client.get("/api/camera/room.jpg")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "no-store"
    assert float(r.headers["x-frame-at"]) > 0
    assert r.content.startswith(b"\xff\xd8")


def test_still_route_says_why_when_unavailable(client, monkeypatch):
    signed_in(monkeypatch)
    monkeypatch.setattr(room_camera, "CAMERA",
                        room_camera.RoomCamera(vid=fake("die"), still=fake("die"), listing=fake("none")))
    r = client.get("/api/camera/room.jpg")
    assert r.status_code == 503
    assert r.json()["reason"] == "not_detected"
    assert "detected" in r.json()["detail"]


def test_state_route(client, monkeypatch):
    signed_in(monkeypatch)
    r = client.get("/api/camera/room")
    assert r.status_code == 200
    assert r.json()["state"] == "not_checked"
    client.get("/api/camera/room.jpg")
    assert client.get("/api/camera/room").json()["state"] == "ready"


def test_live_route_streams_frames(client, monkeypatch):
    signed_in(monkeypatch)
    monkeypatch.setattr(room_camera, "LIVE_LIMIT", 0.5)  # the test client reads a response only once it has ended
    with client.stream("GET", "/api/camera/room/live") as r:
        assert r.status_code == 200
        assert r.headers["content-type"] == "multipart/x-mixed-replace; boundary=frame"
        assert r.headers["cache-control"] == "no-store"
        buf = b""
        for chunk in r.iter_bytes():
            buf += chunk
            if buf.count(b"--frame") >= 2:
                break
    assert b"Content-Type: image/jpeg" in buf


def test_live_route_busy_is_429(client, monkeypatch):
    signed_in(monkeypatch)
    monkeypatch.setattr(room_camera.CAMERA, "viewers", room_camera.MAX_VIEWERS)
    r = client.get("/api/camera/room/live")
    assert r.status_code == 429
    assert r.json()["reason"] == "busy"
