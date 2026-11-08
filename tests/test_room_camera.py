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


NOWHERE = os.path.join(_tmp, "no-such-room-camera.env")


def Cam(store=None, env_file=NOWHERE, **cmds):
    """A RoomCamera with fake capture commands, its settings in memory, and no A17 file unless one is given."""
    return room_camera.RoomCamera(store=store or room_camera.MemoryStore(), env_file=env_file, **cmds)


@pytest.fixture
def cam(monkeypatch):
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.3)
    monkeypatch.setattr(room_camera, "LIVE_LIMIT", 60)
    return Cam(vid=fake("vid"), still=fake("still"), listing=fake("list"))


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


def test_180_is_turned_at_capture_and_90_is_left_to_the_page():
    s = dict(room_camera.DEFAULTS)
    assert "--rotation" not in room_camera.capture_args(["rpicam-vid"], s)
    s["turn"] = 180
    args = room_camera.capture_args(["rpicam-vid"], s)
    assert args[args.index("--rotation") + 1] == "180"
    for turn in (90, 270):
        s["turn"] = turn
        assert "--rotation" not in room_camera.capture_args(["rpicam-vid"], s)


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
    c = Cam(vid=fake("die"), still=fake("die"), listing=fake("none"))

    async def go():
        with pytest.raises(room_camera.Unavailable) as e:
            await c.still()
        assert e.value.reason == "not_detected"
        assert c.state() | {"frame_at": None} == {"state": "unavailable", "reason": "not_detected", "viewers": 0,
                                                  "frame_at": None, "rotate": 0,
                                                  "size": [640, 480], "engine": "rpicam", "live_values": {}}
    run(go())


def test_a_capture_that_fails_twice_is_capture_failed():
    c = Cam(vid=fake("die"), still=fake("die"), listing=fake("list"))

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
    c = Cam(vid=fake("die"), still=fake("die"), listing=fake("list"))

    async def go():
        with pytest.raises(room_camera.Unavailable) as e:
            async for _ in c.live():
                pass
        assert e.value.reason == "capture_failed"
        assert c.starts == 2
        assert c.state()["reason"] == "capture_failed"
    run(go())


def test_a_capture_that_never_sends_a_frame_fails_instead_of_hanging(monkeypatch):
    monkeypatch.setattr(room_camera, "FIRST_FRAME", 0.3)
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.2)
    c = Cam(vid=fake("silent"), still=fake("die"), listing=fake("list"))

    async def go():
        t = time.monotonic()
        with pytest.raises(room_camera.Unavailable) as e:
            async for _ in c.live():
                pass
        assert e.value.reason == "capture_failed"
        assert time.monotonic() - t < 5
        assert c.starts == 2 and c.proc is None and c.viewers == 0
        await asyncio.sleep(0.4)
        assert c.proc is None
    run(go())


def test_a_capture_that_freezes_mid_stream_is_restarted_once_then_ends(monkeypatch):
    monkeypatch.setattr(room_camera, "STALL", 0.3)
    monkeypatch.setattr(room_camera, "FIRST_FRAME", 0.5)
    c = Cam(vid=fake("freeze"), still=fake("die"), listing=fake("list"))

    async def go():
        n = 0
        with pytest.raises(room_camera.Unavailable):
            async for _ in c.live():
                n += 1
        assert n >= 2  # frames from both runs reached the viewer
        assert c.starts == 2 and c.proc is None and c.viewers == 0
        assert c.state()["reason"] == "capture_failed"
    run(go())


def test_a_viewer_arriving_while_the_capture_stops_never_overlaps_it(monkeypatch):
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.1)
    monkeypatch.setattr(room_camera, "KILL_AFTER", 0.5)
    c = Cam(vid=fake("stubborn"), still=fake("still"), listing=fake("list"))
    spawned = []
    spawn = c._spawn

    async def watched():
        assert all(p.returncode is not None for p in spawned), "a capture started while another still ran"
        await spawn()
        if c.proc:
            spawned.append(c.proc)
    c._spawn = watched

    async def go():
        await take(c.live(), 2)
        await asyncio.sleep(0.15)  # the stop has begun: SIGTERM ignored, the kill is due at KILL_AFTER
        parts = await take(c.live(), 2)
        assert len(parts) == 2
        assert c.starts in (1, 2)
        await c._stop()
        assert all(p.returncode is not None for p in spawned)
    run(go())


def test_the_last_viewer_leaving_during_a_restart_still_stops_the_capture(monkeypatch):
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.1)
    c = Cam(vid=fake("vid"), still=fake("still"), listing=fake("list"))

    async def go():
        s = c.live()
        await s.__anext__()
        first = c.proc
        first.kill()  # dies: the reader restarts it while the viewer is leaving
        await s.aclose()
        await asyncio.sleep(1.0)
        assert c.proc is None
        assert first.returncode is not None
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
                        Cam(vid=fake("vid"), still=fake("still"), listing=fake("list")))
    return TestClient(hub_app.app)


def test_each_route_refuses_a_viewer_who_isnt_signed_in(client):
    for path in ("/api/camera/room", "/api/camera/room.jpg", "/api/camera/room/live"):
        r = client.get(path)
        assert r.status_code == 401, path
    assert room_camera.CAMERA.captures == 0 and room_camera.CAMERA.starts == 0


def test_each_route_refuses_a_household_viewer(client, monkeypatch):
    # The owner's call (2026-11-07): the Room view shows the room, so only the owner sees it.
    from hub import auth
    monkeypatch.setattr(auth, "who", lambda request: ("household", "kitchen tablet"))
    for path in ("/api/camera/room", "/api/camera/room.jpg", "/api/camera/room/live"):
        assert client.get(path).status_code == 401, path
    assert room_camera.CAMERA.captures == 0 and room_camera.CAMERA.starts == 0


def signed_in(monkeypatch):
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("owner", "test"))


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
                        Cam(vid=fake("die"), still=fake("die"), listing=fake("none")))
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


# ---- settings (amendment A18, plan P1) ----

D = room_camera.DEFAULTS


def with_(**kw):
    return {**D, **kw}


def test_the_table_holds_every_control_a18_lists_in_its_groups():
    keys = [c["key"] for c in room_camera.CONTROLS]
    assert keys == ["turn", "mirror", "flip", "zoom", "centre_x", "centre_y", "ev", "brightness", "contrast",
                    "metering", "exposure", "manual", "shutter", "gain", "awb", "saturation", "sharpness", "denoise",
                    "preset"]
    groups = list(dict.fromkeys(c["group"] for c in room_camera.CONTROLS))
    assert groups == ["Orientation", "Framing", "Light", "Colour", "Detail", "Live quality"]
    assert D["turn"] == 0 and D["zoom"] == 1 and D["ev"] == 0 and D["contrast"] == 1 and D["awb"] == "auto"
    assert D["preset"] == "saver" and D["manual"] is False
    shutters = [o["value"] for o in room_camera.BY_KEY["shutter"]["options"]]
    assert shutters[0] == 1000 and shutters[-1] == 1_000_000  # 1/1000 s to 1 s (C2)
    for key in ("saver", "clear", "sharp"):
        assert "Mbit/s" in room_camera.PRESETS[key]["bandwidth"]  # each preset says what it costs


def test_defaults_and_every_number_control_at_its_edges_are_accepted():
    assert room_camera.validate(dict(D)) == D
    for c in room_camera.CONTROLS:
        if c["kind"] == "number":
            for v in (c["min"], c["max"]):
                assert room_camera.validate(with_(**{c["key"]: v}))[c["key"]] == v, c["key"]
        if c["kind"] == "choice":
            for o in c["options"]:
                assert room_camera.validate(with_(**{c["key"]: o["value"]}))[c["key"]] == o["value"]


@pytest.mark.parametrize("key,value", [
    ("zoom", 4.5), ("zoom", 0.5), ("zoom", 1.25), ("ev", -2.5), ("ev", 0.3), ("brightness", 0.6), ("contrast", 0.4),
    ("saturation", 2.05), ("sharpness", -0.05), ("gain", 17), ("centre_x", 101), ("centre_y", -1),
    ("zoom", 10**400), ("gain", -10**400), ("zoom", "2"), ("zoom", True), ("zoom", None), ("zoom", float("nan")), ("ev", float("inf")),
    ("turn", "90"), ("turn", 45), ("turn", 90.5), ("mirror", 1), ("mirror", "yes"), ("manual", None),
    ("awb", "sunset"), ("awb", "auto; rm -rf /"), ("awb", "auto --output /tmp/x"), ("metering", "Centre"),
    ("denoise", "cdn_hq"), ("shutter", 1500), ("shutter", "33333"), ("preset", "4k"), ("exposure", ["normal"]),
])
def test_a_bad_value_is_refused_with_its_field(key, value):
    with pytest.raises(room_camera.Invalid) as e:
        room_camera.validate(with_(**{key: value}))
    assert e.value.field == key
    assert room_camera.BY_KEY[key]["label"] in e.value.reason


def test_unknown_missing_and_non_object_settings_are_refused():
    with pytest.raises(room_camera.Invalid) as e:
        room_camera.validate(with_(hdr="auto"))
    assert e.value.field == "hdr"
    partial = dict(D)
    del partial["ev"]
    with pytest.raises(room_camera.Invalid) as e:
        room_camera.validate(partial)
    assert e.value.field == "ev" and "missing" in e.value.reason
    for bad in (None, [], "turn=90", 90):
        with pytest.raises(room_camera.Invalid) as e:
            room_camera.validate(bad)
        assert e.value.field is None


def args_of(s, still=False):
    return room_camera.capture_args(["rpicam-vid"], s, still=still)


def opt(args, name):
    return args[args.index(name) + 1] if name in args else None


def test_each_preset_sets_size_rate_and_quality_and_stills_take_its_size():
    for key, p in room_camera.PRESETS.items():
        a = args_of(with_(preset=key))
        assert (opt(a, "--width"), opt(a, "--height"), opt(a, "--framerate"), opt(a, "--quality")) == \
            (str(p["width"]), str(p["height"]), str(p["fps"]), str(p["quality"]))
        still = args_of(with_(preset=key), still=True)
        assert (opt(still, "--width"), opt(still, "--height")) == (str(p["width"]), str(p["height"]))
        assert "--framerate" not in still and "--quality" not in still


def test_zoom_becomes_a_region_kept_inside_the_picture():
    assert "--roi" not in args_of(with_(zoom=1, centre_x=0, centre_y=0))
    assert opt(args_of(with_(zoom=2)), "--roi") == "0.2500,0.2500,0.5000,0.5000"
    assert opt(args_of(with_(zoom=2, centre_x=0, centre_y=0)), "--roi") == "0.0000,0.0000,0.5000,0.5000"
    assert opt(args_of(with_(zoom=2, centre_x=100, centre_y=100)), "--roi") == "0.5000,0.5000,0.5000,0.5000"
    assert opt(args_of(with_(zoom=4, centre_x=90, centre_y=10)), "--roi") == "0.7500,0.0000,0.2500,0.2500"


def test_light_colour_detail_and_flips_reach_the_command_line():
    a = args_of(with_(mirror=True, flip=True, ev=-1.5, brightness=0.25, contrast=1.5, metering="spot",
                      exposure="sport", awb="tungsten", saturation=0, sharpness=2, denoise="hq"))
    assert "--hflip" in a and "--vflip" in a
    assert (opt(a, "--ev"), opt(a, "--brightness"), opt(a, "--contrast")) == ("-1.5", "0.25", "1.5")
    assert (opt(a, "--metering"), opt(a, "--exposure"), opt(a, "--awb")) == ("spot", "sport", "tungsten")
    assert (opt(a, "--saturation"), opt(a, "--sharpness"), opt(a, "--denoise")) == ("0", "2", "cdn_hq")
    assert opt(args_of(with_(denoise="fast")), "--denoise") == "cdn_fast"
    assert "--hflip" not in args_of(dict(D)) and "--vflip" not in args_of(dict(D))


def test_manual_exposure_only_when_it_is_on():
    assert "--shutter" not in args_of(with_(shutter=1000, gain=8))
    a = args_of(with_(manual=True, shutter=250000, gain=8))
    assert (opt(a, "--shutter"), opt(a, "--gain")) == ("250000", "8")


def test_every_argument_is_a_plain_string():
    a = args_of(with_(zoom=3, manual=True, mirror=True))
    assert all(isinstance(x, str) and x and " " not in x and ";" not in x for x in a)


def test_the_first_read_seeds_turn_from_a17s_file_once(tmp_path):
    env = tmp_path / "room-camera.env"
    env.write_text("# A17\nROOM_CAMERA_ROTATE=90\n")
    store = room_camera.MemoryStore()
    c = Cam(store=store, env_file=str(env))
    assert c.settings()["turn"] == 90
    assert store.value["turn"] == 90  # stored at once
    env.write_text("ROOM_CAMERA_ROTATE=180\n")
    assert Cam(store=store, env_file=str(env)).settings()["turn"] == 90  # the file is never read again


@pytest.mark.parametrize("text,want", [("ROOM_CAMERA_ROTATE=270\n", 270), ('ROOM_CAMERA_ROTATE="180"\n', 180),
                                       ("ROOM_CAMERA_ROTATE=45\n", 0), ("ROOM_CAMERA_ROTATE=\n", 0),
                                       ("OTHER=90\n", 0), (None, 0)])
def test_the_seed_takes_only_a_valid_turn(tmp_path, text, want):
    env = tmp_path / "room-camera.env"
    if text is not None:
        env.write_text(text)
    assert Cam(env_file=str(env)).settings()["turn"] == want


def test_stored_settings_that_no_longer_fit_fall_back_to_defaults():
    c = Cam(store=room_camera.MemoryStore({"turn": 90, "ev": 9, "awb": "sunset", "old_key": 1}))
    s = c.settings()
    assert s["turn"] == 90 and s["ev"] == 0 and s["awb"] == "auto" and "old_key" not in s
    assert s["zoom"] == 1  # a control the store didn't have yet starts at its default


def test_the_state_carries_the_pictures_size_and_quarter_turn():
    c = Cam(store=room_camera.MemoryStore(with_(preset="sharp", turn=270)))
    assert c.state()["size"] == [1920, 1080] and c.state()["rotate"] == 270
    c = Cam(store=room_camera.MemoryStore(with_(turn=180)))
    assert c.state()["rotate"] == 0  # turned at capture, so the page turns nothing


def test_apply_while_live_restarts_the_capture_once_with_the_new_settings(cam):
    async def go():
        s = cam.live()
        await s.__anext__()
        assert cam.starts == 1
        first = cam.proc
        saved = await cam.apply(with_(ev=1.5, preset="clear"))
        assert saved["ev"] == 1.5
        assert cam.starts == 2 and cam.proc is not first and first.returncode is not None
        assert opt(cam.last_args, "--ev") == "1.5" and opt(cam.last_args, "--width") == "1296"
        for _ in range(3):  # the viewer keeps getting frames from the new capture
            await s.__anext__()
        assert cam.starts == 2
        await s.aclose()
    run(go())


def test_apply_with_nothing_running_starts_nothing_and_the_next_still_is_fresh(cam):
    async def go():
        await cam.still()
        assert cam.captures == 1
        await cam.apply(with_(awb="daylight"))
        assert cam.proc is None and cam.starts == 0
        await cam.still()  # within SHARE_FOR of the first, but taken before the change
        assert cam.captures == 2
        assert opt(cam.last_args, "--awb") == "daylight"
    run(go())


def test_a_second_apply_while_the_first_is_applying_is_refused(cam):
    async def go():
        cam._bind()
        await cam._lock.acquire()  # as if a still were being taken
        first = asyncio.create_task(cam.apply(with_(ev=1)))
        await asyncio.sleep(0.05)
        with pytest.raises(room_camera.Applying):
            await cam.apply(with_(ev=2))
        cam._lock.release()
        assert (await first)["ev"] == 1
        assert cam.settings()["ev"] == 1 and not cam.applying
    run(go())


def test_a_refused_apply_changes_nothing(cam):
    async def go():
        with pytest.raises(room_camera.Invalid):
            await cam.apply(with_(ev=5))
        assert cam.settings() == D and not cam.applying
    run(go())


def test_the_log_line_names_what_changed():
    assert room_camera.describe_changes(D, with_(ev=1, awb="tungsten")) == \
        "Exposure compensation 0 EV → 1 EV, White balance Auto → Tungsten"
    assert room_camera.describe_changes(D, with_(preset="sharp", mirror=True)) == "Mirror off → on, Live quality Data saver → Sharp"
    assert room_camera.describe_changes(D, dict(D)) == "No change"


# ---- settings routes ----

ORIGIN = {"Origin": "http://testserver"}  # writes must come from the hub's own page (the guard middleware)

SETTINGS_ROUTES = (("GET", "/api/camera/room/settings"), ("POST", "/api/camera/room/settings"),
                   ("POST", "/api/camera/room/settings/reset"))


def test_settings_routes_refuse_household_and_signed_out_viewers(client, monkeypatch):
    for method, path in SETTINGS_ROUTES:
        assert client.request(method, path, json=dict(D), headers=ORIGIN).status_code == 401, path
    from hub import auth
    monkeypatch.setattr(auth, "who", lambda request: ("household", "kitchen tablet"))
    for method, path in SETTINGS_ROUTES:
        assert client.request(method, path, json=dict(D), headers=ORIGIN).status_code == 401, path
    assert room_camera.CAMERA.settings() == D


def test_settings_route_gives_the_settings_defaults_and_table(client, monkeypatch):
    signed_in(monkeypatch)
    r = client.get("/api/camera/room/settings")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["settings"] == D and body["defaults"] == D and body["applying"] is False
    assert [c["key"] for c in body["controls"]] == [c["key"] for c in room_camera.CONTROLS]


def test_apply_route_saves_logs_and_answers_with_the_state(client, monkeypatch):
    signed_in(monkeypatch)
    r = client.post("/api/camera/room/settings", headers=ORIGIN, json=with_(ev=1, preset="sharp"))
    assert r.status_code == 200
    assert r.json()["settings"]["ev"] == 1 and r.json()["state"]["size"] == [1920, 1080]
    assert room_camera.CAMERA.settings()["preset"] == "sharp"
    from hub import auth
    last = auth.recent_actions(1)[0]
    assert last["action"] == "room-camera:settings"
    assert last["result"] == "Exposure compensation 0 EV → 1 EV, Live quality Data saver → Sharp"


def test_apply_route_refuses_with_the_field_and_logs_nothing(client, monkeypatch):
    signed_in(monkeypatch)
    from hub import auth
    before = len(auth.recent_actions(1000))
    r = client.post("/api/camera/room/settings", headers=ORIGIN, json=with_(gain=40))
    assert r.status_code == 422 and r.json()["field"] == "gain"
    r = client.post("/api/camera/room/settings", content=b"not json",
                    headers={**ORIGIN, "content-type": "application/json"})
    assert r.status_code == 422 and r.json()["field"] is None
    assert len(auth.recent_actions(1000)) == before
    assert room_camera.CAMERA.settings() == D


def test_apply_route_while_applying_is_409(client, monkeypatch):
    signed_in(monkeypatch)
    monkeypatch.setattr(room_camera.CAMERA, "applying", True)
    r = client.post("/api/camera/room/settings", headers=ORIGIN, json=with_(ev=1))
    assert r.status_code == 409 and "still applying" in r.json()["reason"]


def test_reset_route_restores_the_defaults_and_logs_it(client, monkeypatch):
    signed_in(monkeypatch)
    client.post("/api/camera/room/settings", headers=ORIGIN, json=with_(zoom=2, awb="cloudy"))
    r = client.post("/api/camera/room/settings/reset", headers=ORIGIN)
    assert r.status_code == 200 and r.json()["settings"] == D
    from hub import auth
    last = auth.recent_actions(1)[0]
    assert last["action"] == "room-camera:reset" and "Zoom 2 × → 1 ×" in last["result"]


# ---- review fixes ----

def test_after_an_apply_a_failed_still_is_unavailable_not_the_old_picture():
    c = Cam(vid=fake("vid"), still=fake("die"), listing=fake("list"))

    async def go():
        c.frame, c.frame_at = b"\xff\xd8old\xff\xd9", time.time()  # taken with the old settings
        await c.apply(with_(awb="tungsten"))
        with pytest.raises(room_camera.Unavailable):
            await c.still()
    run(go())


def test_a_capture_restarted_by_apply_gets_the_first_frame_wait_not_the_stall_one(cam, monkeypatch):
    monkeypatch.setattr(room_camera, "STALL", 0.3)
    monkeypatch.setattr(room_camera, "FIRST_FRAME", 4.0)

    async def go():
        s = cam.live()
        await s.__anext__()
        cam.vid_cmd = fake("slow")  # the new settings' capture takes a second for its first frame
        await cam.apply(with_(preset="sharp"))
        await s.__anext__()
        assert cam.starts == 2  # exactly the one restart the apply made, none spent on a slow start
        await s.aclose()
    run(go())


def test_the_log_line_fits_the_log_and_says_how_many_more():
    changed = {c["key"]: (c["options"][-1]["value"] if c["kind"] == "choice" else
                          (not c["default"]) if c["kind"] == "switch" else c["max"]) for c in room_camera.CONTROLS}
    line = room_camera.describe_changes(D, changed)
    assert len(line) <= 200 and line.endswith("more")
    assert line.startswith("Turn 0° → 270°")


def test_a_first_read_seed_never_lands_over_an_apply(tmp_path):
    import threading
    env = tmp_path / "room-camera.env"
    env.write_text("ROOM_CAMERA_ROTATE=90\n")
    reading, go_on = threading.Event(), threading.Event()

    class SlowStore(room_camera.MemoryStore):
        def get(self):
            value = super().get()  # nothing stored yet: this thread will seed
            reading.set()
            go_on.wait(5)  # the settings route's thread, paused between reading and seeding
            return value

    store = SlowStore()
    c = Cam(store=store, env_file=str(env))
    t = threading.Thread(target=c.settings)
    t.start()
    reading.wait(5)

    async def apply():
        threading.Timer(0.2, go_on.set).start()
        await c.apply(with_(ev=1))
    run(apply())
    t.join(5)
    assert store.value["ev"] == 1 and c.settings()["ev"] == 1
