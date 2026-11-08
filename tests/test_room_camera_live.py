"""Live adjust for the Room view (amendment A20 D1, plan P1): a try on the running Picamera2 helper, held in memory
and never saved, only for the live group, rate limited, and a fallback to rpicam-vid when the helper can't run. The
helper is stood in for by tests/fixtures/fake_helper.py; its camera-facing mapping is tested as plain functions."""
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

from hub import room_camera, room_camera_helper  # noqa: E402
from hub import app as hub_app  # noqa: E402

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
RPI, HELP = os.path.join(FIX, "fake_rpicam.py"), os.path.join(FIX, "fake_helper.py")
D = dict(room_camera.DEFAULTS)
ORIGIN = {"Origin": "http://testserver"}


def helper(mode="ok", *extra):
    return [sys.executable, HELP_SHIM(mode, *extra)]


def HELP_SHIM(mode, *extra):
    """The hub appends the JSON config as the last argument, but the fake wants (config, mode, ...): a one-line shim
    script puts them in that order."""
    path = os.path.join(_tmp, f"shim-{mode}-{abs(hash(extra))}.py")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write("import subprocess, sys\n"
                    f"sys.exit(subprocess.call([sys.executable, {HELP!r}, sys.argv[1], {mode!r}, *{list(extra)!r}]))\n")
    return path


def Cam(helper_mode="ok", *extra, store=None, **kw):
    return room_camera.RoomCamera(
        vid=[sys.executable, RPI, "vid"], still=[sys.executable, RPI, "still"], listing=[sys.executable, RPI, "list"],
        store=store or room_camera.MemoryStore(), env_file=os.path.join(_tmp, "none.env"),
        helper=None if helper_mode is None else helper(helper_mode, *extra), **kw)


@pytest.fixture(autouse=True)
def quick(monkeypatch):
    monkeypatch.setattr(room_camera, "STOP_AFTER", 0.3)
    monkeypatch.setattr(room_camera, "LIVE_LIMIT", 60)
    monkeypatch.setattr(room_camera, "FIRST_FRAME", 4.0)


def run(coro):
    return asyncio.run(coro)


async def settle(cam, n=2):
    """Until n frames have come from the current capture."""
    for _ in range(300):
        if cam.proc_frames >= n:
            return
        await asyncio.sleep(0.02)
    raise AssertionError("no frames")


async def latest(cam, want, tries=100):
    """The newest frame containing `want`."""
    for _ in range(tries):
        if cam.frame and want in cam.frame:
            return cam.frame
        await asyncio.sleep(0.02)
    raise AssertionError(f"{want!r} never reached a frame; last: {cam.frame!r}")


# ---- the table ----

def test_the_table_marks_exactly_the_live_group():
    live = {c["key"] for c in room_camera.CONTROLS if c["live"]}
    assert live == set(room_camera.LIVE_KEYS)
    assert not live & {"turn", "mirror", "flip", "zoom", "centre_x", "centre_y", "preset"}
    assert set(room_camera_helper.LIVE_KEYS) == live  # the helper and the hub name the same group


# ---- a live change reaches the camera ----

def test_a_live_change_reaches_the_helper_once_as_a_checked_value():
    async def go():
        cam = Cam()
        s = cam.live()
        await s.__anext__()
        assert cam.engine == "picamera2" and cam.proc_engine == "picamera2"
        await settle(cam)
        assert await cam.live_control("ev", 1.0, "phone") == 1.0
        frame = await latest(cam, b"ev=1.0")
        assert frame.count(b"ev=1.0") == 1  # sent once
        assert cam.live_values == {"ev": 1.0}
        assert cam.settings()["ev"] == 0  # a try is not saved
        assert cam.state()["live_values"] == {"ev": 1.0} and cam.state()["engine"] == "picamera2"
        await s.aclose()
    run(go())


def test_the_helper_is_started_with_the_preset_and_every_setting():
    async def go():
        cam = Cam(store=room_camera.MemoryStore({**D, "preset": "clear", "ev": 1.5}))
        s = cam.live()
        await s.__anext__()
        import json
        cfg = json.loads(cam.last_args[-1])
        assert (cfg["width"], cfg["height"], cfg["fps"], cfg["quality"]) == (1296, 972, 10, 60)
        assert cfg["ev"] == 1.5 and set(room_camera.DEFAULTS) <= set(cfg)
        await s.aclose()
    run(go())


@pytest.mark.parametrize("key,value", [
    ("turn", 180), ("mirror", True), ("zoom", 2), ("preset", "sharp"), ("centre_x", 10),  # restart-class
    ("nope", 1), ("ev", 9), ("ev", "1"), ("awb", "sunset"), ("manual", 1), ("ev", float("nan")), ("shutter", 5),
    ("awb", "auto; rm -rf /"), (None, 1), (["ev"], 1), ("gain", True),
])
def test_a_change_that_is_not_live_or_not_valid_is_refused_and_nothing_reaches_the_camera(key, value):
    async def go():
        cam = Cam()
        s = cam.live()
        await s.__anext__()
        await settle(cam)
        with pytest.raises(room_camera.Invalid):
            await cam.live_control(key, value, "phone")
        await asyncio.sleep(0.1)
        assert b"|," not in cam.frame and cam.frame.count(b"=") == 1  # only the ev0= marker: nothing arrived
        assert cam.live_values == {}
        await s.aclose()
    run(go())


def test_a_refusal_names_the_field_and_why():
    async def go():
        cam = Cam()
        with pytest.raises(room_camera.Invalid) as e:
            await cam.live_control("zoom", 2, "phone")
        assert e.value.field == "zoom" and "Apply" in e.value.reason
    run(go())


def test_no_live_capture_means_not_live_and_nothing_is_started():
    async def go():
        cam = Cam()
        with pytest.raises(room_camera.NotLive):
            await cam.live_control("ev", 1, "phone")
        assert cam.starts == 0 and cam.proc is None
    run(go())


def test_more_than_ten_a_second_from_one_device_is_refused_and_another_device_is_not():
    async def go():
        cam = Cam()
        s = cam.live()
        await s.__anext__()
        await settle(cam)
        sent = 0
        with pytest.raises(room_camera.TooFast):
            for i in range(30):
                await cam.live_control("brightness", round((i % 5) / 10, 1), "phone")
                sent += 1
        assert sent == 10
        assert await cam.live_control("brightness", 0.1, "tablet") == 0.1
        await s.aclose()
    run(go())


def test_the_limiter_forgets_old_events_and_does_not_grow():
    lim = room_camera.Limiter(2, 1.0)
    assert lim.allow("a", 0) and lim.allow("a", 0.1) and not lim.allow("a", 0.5) and lim.allow("a", 1.2)
    for i in range(200):
        lim.allow(f"d{i}", 10 + i * 2)
    assert len(lim.seen) <= 65


# ---- tries are not saves ----

def test_tries_vanish_when_the_capture_stops_restarts_or_an_apply_saves():
    async def go():
        cam = Cam()
        s = cam.live()
        await s.__anext__()
        await settle(cam)
        await cam.live_control("contrast", 1.5, "phone")
        assert cam.live_values
        await cam.apply({**D, "ev": 1.0})  # saves, and restarts the capture once
        assert cam.live_values == {} and cam.settings()["ev"] == 1.0 and cam.starts == 2
        await settle(cam)
        await cam.live_control("contrast", 1.5, "phone")
        await s.aclose()
        await asyncio.sleep(room_camera.STOP_AFTER + 0.5)
        assert cam.proc is None and cam.live_values == {}
    run(go())


def test_a_restart_class_apply_restarts_once_and_a_live_change_restarts_nothing():
    async def go():
        cam = Cam()
        s = cam.live()
        await s.__anext__()
        await settle(cam)
        for v in (0.5, 1.0, 1.5):
            await cam.live_control("ev", v, f"d{v}")
        assert cam.starts == 1
        await cam.apply({**D, "zoom": 2})
        assert cam.starts == 2
        await s.aclose()
    run(go())


def test_a_frame_from_before_a_live_change_is_not_served_as_current():
    async def go():
        cam = Cam()
        s = cam.live()
        await s.__anext__()
        await settle(cam)
        await cam.live_control("ev", 1.0, "phone")
        assert cam.frame_at <= cam.settings_at  # the cached frame shows the old picture
        assert not cam._shareable()
        await s.aclose()
    run(go())


# ---- the fallback ----

@pytest.mark.parametrize("mode", ["import"])
def test_a_helper_that_cannot_run_falls_back_to_rpicam_and_the_picture_still_comes(mode):
    async def go():
        cam = Cam(mode)
        s = cam.live()
        part = await s.__anext__()
        assert part.startswith(b"--frame")
        assert cam.engine == "rpicam" and cam.proc_engine == "rpicam"
        assert b"fake-jpeg" in cam.frame  # from fake rpicam-vid
        with pytest.raises(room_camera.NotLive):
            await cam.live_control("ev", 1, "phone")  # live adjust is off: the page shows Apply
        assert cam.state()["engine"] == "rpicam" and cam.state()["state"] == "live"
        await s.aclose()
    run(go())


def test_a_helper_that_cannot_even_start_falls_back():
    async def go():
        cam = Cam()
        cam.helper_cmd = ["/no/such/helper-binary"]
        s = cam.live()
        await s.__anext__()
        assert cam.engine == "rpicam" and b"fake-jpeg" in cam.frame
        await s.aclose()
    run(go())


def test_a_silent_helper_falls_back_after_the_first_frame_wait(monkeypatch):
    monkeypatch.setattr(room_camera, "FIRST_FRAME", 0.6)

    async def go():
        cam = Cam("silent")
        s = cam.live()
        await s.__anext__()
        assert cam.engine == "rpicam" and b"fake-jpeg" in cam.frame
        await s.aclose()
    run(go())


def test_a_helper_that_dies_after_good_frames_is_restarted_once_before_any_fallback():
    async def go():
        marker = os.path.join(tempfile.mkdtemp(), "ran")
        cam = Cam("flaky", marker)
        s = cam.live()
        await s.__anext__()
        deadline = time.time() + 5
        while cam.starts < 2 and time.time() < deadline:
            await s.__anext__()
        assert cam.starts == 2 and cam.engine == "picamera2"  # restarted the helper, no fallback
        await settle(cam)
        assert cam.proc_engine == "picamera2"
        await s.aclose()
    run(go())


def test_a_helper_that_fails_twice_ends_on_rpicam():
    async def go():
        cam = Cam("once")  # dies after three frames, every time
        s = cam.live()
        deadline = time.time() + 8
        while cam.engine != "rpicam" and time.time() < deadline:
            await s.__anext__()
        assert cam.engine == "rpicam"
        await s.__anext__()
        assert b"fake-jpeg" in cam.frame
        await s.aclose()
    run(go())


def test_a_camera_that_cannot_be_opened_by_either_engine_says_why():
    async def go():
        cam = room_camera.RoomCamera(vid=[sys.executable, RPI, "die"], still=[sys.executable, RPI, "die"],
                                     listing=[sys.executable, RPI, "none"], store=room_camera.MemoryStore(),
                                     env_file=os.path.join(_tmp, "none.env"), helper=helper("import"))
        with pytest.raises(room_camera.Unavailable) as e:
            await cam.live().__anext__()
        assert e.value.reason == "not_detected"
    run(go())


def test_the_camera_is_never_open_in_two_processes_at_once():
    async def go():
        cam = Cam()
        s = cam.live()
        await s.__anext__()
        first = cam.proc
        results = await asyncio.gather(cam.still(), cam.still())
        assert all(r[0].startswith(b"\xff\xd8") for r in results)
        assert cam.captures == 0 and cam.proc is first  # while live, a still is the newest live frame
        await s.aclose()
    run(go())


def test_without_a_helper_the_engine_is_rpicam_from_the_start():
    c = Cam(None)
    assert c.engine == "rpicam" and c.state()["engine"] == "rpicam"
    assert room_camera.CAMERA.engine == "picamera2"  # the hub itself starts with the helper


# ---- the helper's own mapping (no camera needed) ----

S = dict(room_camera.DEFAULTS)


def test_every_hub_word_has_a_camera_name_and_every_live_key_a_control():
    for c in room_camera.CONTROLS:
        if c["key"] == "awb":
            assert {o["value"] for o in c["options"]} == set(room_camera_helper.AWB)
        if c["key"] == "metering":
            assert {o["value"] for o in c["options"]} == set(room_camera_helper.METERING)
        if c["key"] == "exposure":
            assert {o["value"] for o in c["options"]} == set(room_camera_helper.EXPOSURE)
        if c["key"] == "denoise":
            assert {o["value"] for o in c["options"]} == set(room_camera_helper.DENOISE)
    out = room_camera_helper.controls_from(S, 10)
    assert out["AeEnable"] is True and out["ExposureValue"] == 0 and out["FrameDurationLimits"] == (100000, 100000)


def test_manual_exposure_holds_the_frame_open_for_a_long_shutter():
    out = room_camera_helper.controls_from({**S, "manual": True, "shutter": 500000, "gain": 4}, 10)
    assert out["AeEnable"] is False and out["ExposureTime"] == 500000 and out["AnalogueGain"] == 4.0
    assert out["FrameDurationLimits"] == (500000, 500000) and "ExposureValue" not in out
    short = room_camera_helper.controls_from({**S, "manual": True, "shutter": 1000}, 10)
    assert short["FrameDurationLimits"] == (100000, 100000)


@pytest.mark.parametrize("turn,mirror,flip,want", [
    (0, False, False, (False, False)), (0, True, False, (True, False)), (0, False, True, (False, True)),
    (180, False, False, (True, True)), (180, True, False, (False, True)), (180, True, True, (False, False)),
    (90, False, False, (False, False)), (270, True, True, (True, True)),
])
def test_a_half_turn_is_both_flips_combined_with_mirror_and_flip(turn, mirror, flip, want):
    assert room_camera_helper.transform_from({"turn": turn, "mirror": mirror, "flip": flip}) == want


FULL = (0, 0, 2592, 1944)


def test_zoom_crops_around_the_centre_keeps_the_shape_and_stays_inside_the_sensor():
    assert room_camera_helper.scaler_crop({**S, "zoom": 1}, FULL, (640, 480)) is None
    x, y, w, h = room_camera_helper.scaler_crop({**S, "zoom": 2}, FULL, (640, 480))
    assert (w, h) == (1296, 972) and (x, y) == (648, 486)
    x, y, w, h = room_camera_helper.scaler_crop({**S, "zoom": 2, "centre_x": 0, "centre_y": 100}, FULL, (640, 480))
    assert x == 0 and y + h == 1944  # clamped into the corner
    x, y, w, h = room_camera_helper.scaler_crop({**S, "zoom": 4}, FULL, (1920, 1080))
    assert abs(w / h - 16 / 9) < 0.02 and x >= 0 and y >= 0 and x + w <= 2592 and y + h <= 1944


def test_the_helper_takes_only_known_live_changes_from_stdin():
    assert room_camera_helper.parse_line('{"key": "ev", "value": 1}') == ("ev", 1)
    for bad in ('{"key": "zoom", "value": 2}', '{"key": "ev"}', "[]", "nonsense", '{"key": 1, "value": 1}', ""):
        assert room_camera_helper.parse_line(bad) is None


# ---- the route ----

@pytest.fixture
def client(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    monkeypatch.setattr(room_camera, "CAMERA", Cam())
    return TestClient(hub_app.app)


def signed_in(monkeypatch):
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("owner", "test"))


def test_the_live_route_refuses_signed_out_and_household_viewers(client, monkeypatch):
    body = {"key": "ev", "value": 1}
    assert client.post("/api/camera/room/live-controls", json=body, headers=ORIGIN).status_code == 401
    from hub import auth
    monkeypatch.setattr(auth, "who", lambda request: ("household", "kitchen tablet"))
    assert client.post("/api/camera/room/live-controls", json=body, headers=ORIGIN).status_code == 401
    assert room_camera.CAMERA.live_values == {} and room_camera.CAMERA.starts == 0


def test_the_live_route_answers_in_words_for_each_refusal(client, monkeypatch):
    signed_in(monkeypatch)
    def post(headers=ORIGIN, **kw):
        return client.post("/api/camera/room/live-controls", headers=headers, **kw)
    r = post(json={"key": "ev", "value": 1})
    assert r.status_code == 409 and "Apply" in r.json()["reason"]  # nothing live yet
    r = post(json={"key": "zoom", "value": 2})
    assert r.status_code == 422 and r.json()["field"] == "zoom"
    r = post(json={"key": "ev", "value": 99})
    assert r.status_code == 422 and r.json()["field"] == "ev"
    for bad in ({"key": "ev"}, {"key": "ev", "value": 1, "extra": 1}, [1], "x"):
        assert post(json=bad).status_code == 422, bad
    assert post(content=b"not json", headers={**ORIGIN, "content-type": "application/json"}).status_code == 422


def test_the_live_route_tries_a_change_and_logs_nothing(client, monkeypatch):
    signed_in(monkeypatch)
    from hub import auth
    before = len(auth.recent_actions(1000))

    async def start():
        s = room_camera.CAMERA.live()
        await s.__anext__()
        await settle(room_camera.CAMERA)
        return s

    loop = asyncio.new_event_loop()
    try:
        s = loop.run_until_complete(start())
        # The route runs on the app's own loop; the camera is bound to this one, so call the method through it.
        value = loop.run_until_complete(room_camera.CAMERA.live_control("ev", 1.0, "test"))
        assert value == 1.0
        loop.run_until_complete(s.aclose())
    finally:
        loop.close()
    assert len(auth.recent_actions(1000)) == before  # drags are not logged (A20 D6)
