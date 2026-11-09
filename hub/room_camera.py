"""The Room view (amendment A17): the Pi's own camera, a fixed view of the printer from outside. Never "the camera":
that is the printer's, through the camera bridge (sources.CAMERA).

The camera runs only while someone looks (R5). A still with nothing running is one short capture, shared by everyone
for SHARE_FOR seconds and taken one at a time, so two open pages never fight over the camera (plan decision 3). Live is
one rpicam-vid shared by at most MAX_VIEWERS open responses; it stops STOP_AFTER seconds after the last one leaves, and
each response ends itself after LIVE_LIMIT. A capture that dies is restarted once, then reported. Frames live only in
memory: nothing is written to disk or logged. The service's own cgroup takes the capture down with the hub.

The state (R7) is one of not_checked, ready, live, or unavailable with a reason (not_detected, capture_failed); busy is
only ever an answer to the live request that found four already watching.

The owner sets the picture from the page (amendment A18): CONTROLS is the one table of what can be set, the hub checks
every value against it, and the page draws its form from it. Settings live in Pi Hub's database; applying them restarts
the capture once.

The live group (amendment A20 D1) changes on the running camera instead: the live capture is a child process using
Picamera2 (hub/room_camera_helper.py) that takes one change at a time on its stdin. A change is a try: it is held in
memory, shown to everyone watching (there is one camera), and gone when the capture stops or an apply saves. If the
helper can't run, the hub falls back to rpicam-vid for good (until it restarts) and A18's Apply covers every control."""
import asyncio
import collections
import json
import math
import os
import re
import sys
import threading
import time

SOI, EOI = b"\xff\xd8", b"\xff\xd9"
SHARE_FOR = 2.0      # a still this young is served to everyone instead of taking another
WAIT_FOR = 3.0       # how long a still waits for one being taken before it answers with the previous one
MAX_AGE = 30.0       # never serve a frame older than this as if it were current
STOP_AFTER = 10.0    # the capture keeps running this long after the last viewer leaves
LIVE_LIMIT = 300.0   # a live response ends itself after this, so a forgotten tab can't hold the camera (R4)
MAX_VIEWERS = 4
MAX_FRAME = 2 * 1024 * 1024
STILL_TIMEOUT = 10.0
FIRST_FRAME = 13.0   # a live capture with no frame by then has failed, even if the process still runs
STALL = 5.0          # a live capture with no new frame for this long has failed
KILL_AFTER = 2.0     # SIGTERM, then SIGKILL after this

# Size, frame rate and quality come from the live preset; the picture's settings from CONTROLS (capture_args).
VID = ["rpicam-vid", "-n", "-t", "0", "--codec", "mjpeg", "-o", "-"]
# About 1.5 s, most of it the exposure settling. No thumbnail, so stdout is exactly one JPEG.
STILL = ["rpicam-still", "-n", "-t", "1500", "-e", "jpg", "--thumb", "none", "-q", "70", "-o", "-"]
LISTING = ["rpicam-vid", "--list-cameras"]

# The live presets (A18 C2). Bandwidth measured on the Pi on 7 Nov 2026 in the dark room, straight from rpicam-vid;
# a lit room makes larger frames.
PRESETS = {
    "saver": {"label": "Data saver", "width": 640, "height": 480, "fps": 10, "quality": 50, "bandwidth": "about 1.4 Mbit/s"},
    "clear": {"label": "Clear", "width": 1296, "height": 972, "fps": 10, "quality": 60, "bandwidth": "about 5.6 Mbit/s"},
    "sharp": {"label": "Sharp", "width": 1920, "height": 1080, "fps": 15, "quality": 70, "bandwidth": "about 22 Mbit/s"},
}
SHUTTERS = [(1000, "1/1000 s"), (2000, "1/500 s"), (4000, "1/250 s"), (8000, "1/125 s"), (16667, "1/60 s"),
            (33333, "1/30 s"), (66667, "1/15 s"), (125000, "1/8 s"), (250000, "1/4 s"), (500000, "1/2 s"),
            (1000000, "1 s")]


def _choice(key, label, group, options, default):
    return {"key": key, "label": label, "group": group, "kind": "choice",
            "options": [{"value": v, "label": t} for v, t in options], "default": default}


def _number(key, label, group, lo, hi, step, default, unit=""):
    return {"key": key, "label": label, "group": group, "kind": "number", "min": lo, "max": hi, "step": step,
            "default": default, "unit": unit}


def _switch(key, label, group, default=False):
    return {"key": key, "label": label, "group": group, "kind": "switch", "default": default}


# Every control A18 C2 lists, in its groups and order, with the camera's own defaults.
CONTROLS = [
    _choice("turn", "Turn", "Orientation", [(0, "0°"), (90, "90°"), (180, "180°"), (270, "270°")], 0),
    _switch("mirror", "Mirror", "Orientation"),
    _switch("flip", "Flip", "Orientation"),
    _number("zoom", "Zoom", "Framing", 1, 4, 0.5, 1, "×"),
    _number("centre_x", "Centre across", "Framing", 0, 100, 1, 50, "%"),
    _number("centre_y", "Centre down", "Framing", 0, 100, 1, 50, "%"),
    _number("ev", "Exposure compensation", "Light", -2, 2, 0.5, 0, "EV"),
    _number("brightness", "Brightness", "Light", -0.5, 0.5, 0.05, 0),
    _number("contrast", "Contrast", "Light", 0.5, 2, 0.05, 1),
    _choice("metering", "Metering", "Light", [("centre", "Centre"), ("spot", "Spot"), ("average", "Average")], "centre"),
    _choice("exposure", "Exposure mode", "Light", [("normal", "Normal"), ("sport", "Sport")], "normal"),
    _switch("manual", "Manual exposure", "Light"),
    _choice("shutter", "Shutter", "Light", SHUTTERS, 33333),
    _number("gain", "Gain", "Light", 1, 16, 0.5, 1),
    _choice("awb", "White balance", "Colour", [("auto", "Auto"), ("incandescent", "Incandescent"),
                                               ("tungsten", "Tungsten"), ("fluorescent", "Fluorescent"),
                                               ("indoor", "Indoor"), ("daylight", "Daylight"), ("cloudy", "Cloudy")],
            "auto"),
    _number("saturation", "Saturation", "Colour", 0, 2, 0.05, 1),
    _number("sharpness", "Sharpness", "Detail", 0, 2, 0.05, 1),
    _choice("denoise", "Noise reduction", "Detail", [("auto", "Auto"), ("off", "Off"), ("fast", "Fast"),
                                                     ("hq", "High quality")], "auto"),
    _choice("preset", "Live quality", "Live quality",
            [(k, f"{p['label']} ({p['width']}×{p['height']}, {p['fps']} fps, {p['bandwidth']})") for k, p in PRESETS.items()],
            "saver"),
]
BY_KEY = {c["key"]: c for c in CONTROLS}
DEFAULTS = {c["key"]: c["default"] for c in CONTROLS}
DENOISE = {"auto": "auto", "off": "off", "fast": "cdn_fast", "hq": "cdn_hq"}
SETTINGS_KEY = "room_camera"
LOOKS_KEY = "room_camera_looks"
SNAPSHOT_DIR = os.environ.get("HUB_SNAPSHOT_DIR", "/var/lib/pi-hub/room-snapshots")
MAX_SNAPSHOTS = 200

# The three built-in looks (amendment A20 D2, plan decision 7).
BUILTIN_LOOKS = [
    {"name": "Night", "builtin": True,
     "values": {"ev": 1.5, "brightness": 0.1, "denoise": "hq", "metering": "average"}},
    {"name": "Bright", "builtin": True,
     "values": {"ev": -0.5, "contrast": 1.2}},
    {"name": "Bed close-up", "builtin": True,
     "values": {"zoom": 2.0, "centre_x": 50, "centre_y": 50, "ev": 0.5}},
]
BUILTIN_NAMES = frozenset(b["name"].lower() for b in BUILTIN_LOOKS)
FORBIDDEN_LOOK_KEYS = frozenset(("turn", "mirror", "flip", "preset"))

# Every control changes on the running camera (A20 D1; the owner asked for all of them). The helper rebuilds its
# stream itself for Turn, Mirror, Flip and the preset, so the capture process keeps running. Save only stores them.
LIVE_KEYS = frozenset(c["key"] for c in CONTROLS)
for _c in CONTROLS:
    _c["live"] = True
HELPER = [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "room_camera_helper.py")]
LIVE_RATE = (10, 1.0)  # changes allowed per device in this many seconds
ENV_FILE = "/etc/pi-hub/room-camera.env"  # A17's rotation setting: read once, to seed "Turn" (plan decision 6)

WORDS = {
    "not_detected": "The Pi's camera isn't detected. Check its ribbon cable.",
    "capture_failed": "The Pi's camera isn't giving pictures right now.",
    "busy": "Live is busy: four people are already watching.",
}


class Unavailable(Exception):
    def __init__(self, reason):
        super().__init__(WORDS.get(reason, reason))
        self.reason = reason


class Invalid(ValueError):
    """A setting the hub refuses, with the field it concerns (None for the whole request)."""

    def __init__(self, field, reason):
        super().__init__(reason)
        self.field, self.reason = field, reason


class Applying(Exception):
    pass


class NotLive(Exception):
    """A live change with no live Picamera2 capture to take it."""


class TooFast(Exception):
    pass


class Limiter:
    """At most `n` events per device in `per` seconds."""

    def __init__(self, n, per):
        self.n, self.per, self.seen = n, per, {}

    def allow(self, who, now=None):
        now = time.monotonic() if now is None else now
        q = self.seen.setdefault(who, collections.deque())
        while q and now - q[0] >= self.per:
            q.popleft()
        if len(q) >= self.n:
            return False
        q.append(now)
        if len(self.seen) > 64:  # devices come and go; never grow without end
            for k in [k for k, v in self.seen.items() if not v or now - v[-1] >= self.per]:
                del self.seen[k]
        return True


def _check(c, v):
    """v for control c, or Invalid. Types are strict: a choice of 90 is not "90", and a switch is a real true/false."""
    key = c["key"]
    if c["kind"] == "switch":
        if not isinstance(v, bool):
            raise Invalid(key, f"{c['label']} is on or off.")
        return v
    if c["kind"] == "choice":
        for o in c["options"]:
            if type(v) is type(o["value"]) and v == o["value"]:
                return v
        raise Invalid(key, f"{c['label']} is one of: {', '.join(o['label'] for o in c['options'])}.")
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
        raise Invalid(key, f"{c['label']} is a number.")
    if not c["min"] <= v <= c["max"]:  # before any float arithmetic, so a huge integer is refused, not an overflow
        raise Invalid(key, f"{c['label']} is from {c['min']:g} to {c['max']:g}.")
    steps = (v - c["min"]) / c["step"]
    if abs(steps - round(steps)) > 1e-6:
        raise Invalid(key, f"{c['label']} goes in steps of {c['step']:g}.")
    return round(c["min"] + round(steps) * c["step"], 4)


def validate(values):
    """The whole settings object (plan decision 3): every key in CONTROLS, nothing else, each value checked."""
    if not isinstance(values, dict):
        raise Invalid(None, "Send every camera setting, as one object.")
    unknown = sorted(set(values) - set(BY_KEY))
    if unknown:
        raise Invalid(unknown[0], f"There is no camera setting called {unknown[0][:40]!r}.")
    missing = [c["key"] for c in CONTROLS if c["key"] not in values]
    if missing:
        raise Invalid(missing[0], f"{BY_KEY[missing[0]]['label']} is missing.")
    return {c["key"]: _check(c, values[c["key"]]) for c in CONTROLS}


def _stored(raw):
    """Settings read back from the database: each valid value kept, anything else its default. A control added in a
    later release starts at its default rather than refusing what was stored before it existed."""
    out = dict(DEFAULTS)
    if isinstance(raw, dict):
        for c in CONTROLS:
            try:
                out[c["key"]] = _check(c, raw[c["key"]])
            except (KeyError, Invalid):
                pass
    return out


def seed_turn(path=None):
    """ROOM_CAMERA_ROTATE from A17's file, read directly (not from the environment: the unit no longer loads it)."""
    try:
        with open(path or ENV_FILE) as f:
            for line in f:
                k, _, v = line.partition("=")
                if k.strip() == "ROOM_CAMERA_ROTATE":
                    v = v.strip().strip("\"'")
                    return int(v) if v in ("0", "90", "180", "270") else 0
    except OSError:
        pass
    return 0


class DbStore:
    """Pi Hub's settings table (A18 C4)."""

    def get(self):
        from hub import auth
        return auth.get(SETTINGS_KEY)

    def put(self, value):
        from hub import auth
        auth.put(SETTINGS_KEY, value)


class MemoryStore:
    def __init__(self, value=None):
        self.value = value

    def get(self):
        return self.value

    def put(self, value):
        self.value = dict(value)


def _num(v):
    return f"{v:g}"


def capture_args(cmd, s, still=False):
    """The command line for settings s (plan decision 2). Every value is a number formatted here or a word from
    CONTROLS, in an argument list: nothing from a request reaches it as text. A quarter turn is left to the page."""
    p = PRESETS[s["preset"]]
    args = [*cmd, "--width", str(p["width"]), "--height", str(p["height"])]
    if not still:
        args += ["--framerate", str(p["fps"]), "--quality", str(p["quality"])]
    if s["turn"] == 180:
        args += ["--rotation", "180"]
    if s["mirror"]:
        args.append("--hflip")
    if s["flip"]:
        args.append("--vflip")
    if s["zoom"] > 1:
        size = 1 / s["zoom"]
        x = min(max(s["centre_x"] / 100 - size / 2, 0), 1 - size)
        y = min(max(s["centre_y"] / 100 - size / 2, 0), 1 - size)
        args += ["--roi", ",".join(f"{v:.4f}" for v in (x, y, size, size))]
    args += ["--ev", _num(s["ev"]), "--brightness", _num(s["brightness"]), "--contrast", _num(s["contrast"]),
             "--metering", s["metering"], "--exposure", s["exposure"], "--awb", s["awb"],
             "--saturation", _num(s["saturation"]), "--sharpness", _num(s["sharpness"]),
             "--denoise", DENOISE[s["denoise"]]]
    if s["manual"]:
        args += ["--shutter", str(s["shutter"]), "--gain", _num(s["gain"])]
    return args


def helper_config(s):
    """The one JSON object the helper is started with: the live preset and every setting, as the hub validated them."""
    p = PRESETS[s["preset"]]
    return {**s, "width": p["width"], "height": p["height"], "fps": p["fps"], "quality": p["quality"]}


def _shown(c, v):
    if c["kind"] == "switch":
        return "on" if v else "off"
    if c["kind"] == "choice":
        return next(o["label"] for o in c["options"] if o["value"] == v).split(" (")[0]
    return f"{v:g}{c.get('unit') and ' ' + c['unit'] or ''}"


LOG_ROOM = 200  # auth.log keeps this much of a result


def describe_changes(old, new):
    """For the action log (plan decision 9): "Exposure compensation 0 EV → 1 EV, White balance Auto → Tungsten". Past
    what the log keeps, it ends with how many more changed rather than being cut mid-word."""
    parts = [f"{c['label']} {_shown(c, old[c['key']])} → {_shown(c, new[c['key']])}"
             for c in CONTROLS if old[c["key"]] != new[c["key"]]]
    if not parts:
        return "No change"
    line = ", ".join(parts)
    for n in range(len(parts) - 1, 0, -1):
        if len(line) <= LOG_ROOM:
            break
        line = f"{', '.join(parts[:n])}, and {len(parts) - n} more"
    return line[:LOG_ROOM]


class FrameSplitter:
    """Whole JPEGs out of an MJPEG byte stream, however it is chunked. A JPEG's data never holds FF D9 (0xFF is
    stuffed), so a frame runs from FF D8 to the next FF D9. A runaway frame with no end is dropped, not grown."""

    def __init__(self):
        self.buf = b""

    def feed(self, data):
        self.buf += data
        out = []
        while True:
            s = self.buf.find(SOI)
            if s < 0:
                self.buf = self.buf[-1:]  # it may be the first byte of a start marker
                return out
            e = self.buf.find(EOI, s + 2)
            if e < 0:
                self.buf = b"" if len(self.buf) - s > MAX_FRAME else self.buf[s:]
                return out
            out.append(self.buf[s:e + 2])
            self.buf = self.buf[e + 2:]


def part(jpg):
    return b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n%s\r\n" % (len(jpg), jpg)


async def _kill(p):
    """Terminate, then kill; returns once the process has exited. Callers shield it, so a cancelled caller never leaves
    a capture holding the camera."""
    try:
        if p.returncode is None:
            p.terminate()
            try:
                await asyncio.wait_for(p.wait(), KILL_AFTER)
            except asyncio.TimeoutError:
                pass
    finally:
        if p.returncode is None:
            p.kill()
        await p.wait()


class RoomCamera:
    def __init__(self, vid=None, still=None, listing=None, store=None, env_file=None, helper=None):
        self.vid_cmd, self.still_cmd, self.list_cmd = vid or VID, still or STILL, listing or LISTING
        self.helper_cmd = helper  # the Picamera2 helper's command, or None for rpicam-vid only (the tests' default)
        self.engine = "picamera2" if helper else "rpicam"
        self.proc_engine, self.proc_frames = None, 0
        self.helper_values = {}  # what the running helper holds, by key: its start settings, then every change sent
        self.live_values = {}   # tried, unsaved changes to the live group; gone when the capture stops or an apply saves
        self.limiter = Limiter(*LIVE_RATE)
        self.store, self.env_file = store or DbStore(), env_file
        self._settings = None
        self._seed_lock = threading.Lock()  # the settings route runs in a worker thread, apply on the event loop
        self.settings_at = 0.0  # a frame older than the last apply is never shared as current
        self.applying = False
        self.last_args = None   # the newest capture's command line, for tests
        self.frame, self.frame_at = None, 0.0
        self.reason, self.checked = None, False
        self.viewers = 0
        self.proc = None
        self.started_at = 0.0
        self.restarts_left = 1
        self.captures = 0  # one-shot stills taken, for tests and the acceptance count
        self.starts = 0    # live captures started
        self._loop = self._lock = self._event = self._stopper = None

    def _bind(self):
        loop = asyncio.get_running_loop()
        if self._loop is not loop:  # one event loop in the hub; tests run several
            self._loop, self._lock, self._event = loop, asyncio.Lock(), asyncio.Event()
            self.proc, self._stopper = None, None

    def settings(self):
        """The stored settings; on the very first read, the defaults with "Turn" seeded from A17's file, stored at once
        so the file is never read again (plan decision 6)."""
        with self._seed_lock:
            if self._settings is None:
                raw = self.store.get()
                if raw is None:
                    raw = {**DEFAULTS, "turn": seed_turn(self.env_file)}
                    self.store.put(raw)
                self._settings = _stored(raw)
            return dict(self._settings)

    async def apply(self, values):
        """Check, store, and restart the capture once if it is running (A18 C3). Returns the new settings. Raises
        Invalid, or Applying while a previous apply is still under way (409)."""
        new = validate(values)
        self._bind()
        if self.applying:
            raise Applying()
        self.applying = True
        try:
            async with self._lock:  # a still being taken finishes first; no capture starts or stops meanwhile
                self.settings()  # any first-read seed lands before, never over, this change
                with self._seed_lock:
                    self.store.put(new)
                    self._settings = new
                self.live_values = {}
                p = self.proc
                if p is not None and self.proc_engine == "picamera2" and p.stdin is not None and self.proc_frames:
                    # A running Picamera2 helper already shows the tries: tell it only what differs from what it holds,
                    # so Save stores the settings without restarting the picture.
                    try:
                        for key in [k for k in new if new[k] != self.helper_values.get(k)]:
                            await self._tell_helper(p, key, new[key])
                            self.settings_at = time.time()
                        self._wake()
                        return dict(new)
                    except Unavailable:
                        pass  # the helper is gone: restart it below with the saved settings
                self.settings_at = time.time()
                p, self.proc = self.proc, None
                if p is not None:
                    await asyncio.shield(_kill(p))
                    if self.viewers:
                        self.restarts_left = 1
                        await self._spawn()
            self._wake()
            return dict(new)
        finally:
            self.applying = False

    def _shareable(self):
        return self.frame and time.time() - self.frame_at < SHARE_FOR and self.frame_at > self.settings_at

    def state(self):
        if self.proc is not None and self.viewers:
            state = "live"
        elif self.reason:
            state = "unavailable"
        else:
            state = "ready" if self.checked else "not_checked"
        s = {**self.settings(), **self.live_values}
        p = PRESETS[s["preset"]]
        return {"state": state, "reason": self.reason if state == "unavailable" else None, "viewers": self.viewers,
                "frame_at": self.frame_at or None, "rotate": s["turn"] if s["turn"] in (90, 270) else 0,
                "size": [p["width"], p["height"]], "engine": self.engine, "live_values": dict(self.live_values)}

    def _got(self, jpg):
        self.frame, self.frame_at = jpg, time.time()
        self.reason, self.checked = None, True
        self._wake()

    def _recent(self):
        # Never a frame from before the last apply: it shows the old settings (A18 C3).
        if self.frame and time.time() - self.frame_at < MAX_AGE and self.frame_at > self.settings_at:
            return self.frame, self.frame_at
        raise Unavailable(self.reason or "capture_failed")

    async def _why(self):
        """After a failed capture: is there a camera on the bus at all?"""
        try:
            p = await asyncio.create_subprocess_exec(*self.list_cmd, stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.STDOUT)
        except OSError:
            return "capture_failed"
        try:
            out, _ = await asyncio.wait_for(p.communicate(), STILL_TIMEOUT)
        except asyncio.TimeoutError:
            await asyncio.shield(_kill(p))
            return "capture_failed"
        return "not_detected" if b"No cameras available" in out else "capture_failed"

    async def _one_shot(self):
        self.captures += 1
        try:
            self.last_args = capture_args(self.still_cmd, self.settings(), still=True)
            p = await asyncio.create_subprocess_exec(*self.last_args, stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.DEVNULL)
        except OSError:
            return None
        try:
            out, _ = await asyncio.wait_for(p.communicate(), STILL_TIMEOUT)
        except asyncio.TimeoutError:
            p.kill()
            await p.wait()
            return None
        out = out.rstrip(b"\r\n")
        return out if p.returncode == 0 and out.startswith(SOI) and out.endswith(EOI) and len(out) <= MAX_FRAME else None

    async def still(self):
        """(jpeg, taken_at): the newest live frame, a still younger than SHARE_FOR, or a fresh capture."""
        self._bind()
        if self.proc is not None:
            return await self._live_frame()
        if self._shareable():
            return self.frame, self.frame_at
        try:
            await asyncio.wait_for(self._lock.acquire(), WAIT_FOR)
        except asyncio.TimeoutError:
            return self._recent()
        try:
            if self._shareable():
                return self.frame, self.frame_at  # taken while this one waited
            if self.proc is not None:
                return await self._live_frame()
            for _ in range(2):  # the one retry R5 allows
                jpg = await self._one_shot()
                if jpg:
                    self._got(jpg)
                    return jpg, self.frame_at
            self.reason, self.checked = await self._why(), True
            return self._recent()
        finally:
            self._lock.release()

    async def _live_frame(self):
        if not self._shareable():
            # A capture just (re)started, after an apply, gets as long for its first frame as a fresh start does.
            first = self.frame_at < self.started_at
            await self._next_frame(self.frame_at, FIRST_FRAME if first else WAIT_FOR)
        return self._recent()

    async def _next_frame(self, after, timeout):
        """The first frame newer than `after`, or None on timeout or when the capture has ended."""
        end = asyncio.get_running_loop().time() + timeout
        while self.frame_at <= after:
            left = end - asyncio.get_running_loop().time()
            if left <= 0 or (self.proc is None and self.reason):
                return None
            try:
                await asyncio.wait_for(self._event.wait(), left)
            except asyncio.TimeoutError:
                return None
        return self.frame

    # Every start and stop of the live capture happens under self._lock, so two never overlap and a dying one has
    # exited before the next (or a one-shot still) opens the camera.

    async def _spawn(self):
        """Start the live capture. The caller holds the lock."""
        self.starts += 1
        self.started_at = time.time()
        self.live_values, self.proc_frames, self.proc_engine = {}, 0, self.engine
        self.helper_values = dict(self.settings())
        try:
            if self.engine == "picamera2":
                self.last_args = [*self.helper_cmd, json.dumps(helper_config(self.settings()))]
                self.proc = await asyncio.create_subprocess_exec(
                    *self.last_args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL)
            else:
                self.last_args = capture_args(self.vid_cmd, self.settings())
                self.proc = await asyncio.create_subprocess_exec(*self.last_args, stdout=asyncio.subprocess.PIPE,
                                                                 stderr=asyncio.subprocess.DEVNULL)
        except OSError:
            self.proc = None
            if self.engine == "picamera2":
                self.engine = "rpicam"  # the helper can't even start: A18's path takes over (plan decision 5)
                await self._spawn()
                return
            self.reason, self.checked = "capture_failed", True
            self._wake()
            return
        asyncio.create_task(self._read(self.proc))

    def _wake(self):
        ev, self._event = self._event, asyncio.Event()
        ev.set()

    async def _read(self, proc):
        split = FrameSplitter()
        try:
            while chunk := await proc.stdout.read(65536):
                for jpg in split.feed(chunk):
                    if self.proc is proc:
                        self.proc_frames += 1
                        self._got(jpg)
        except Exception:
            pass
        await self._failed(proc)

    async def _failed(self, proc):
        """The capture ended by itself or stalled: restart it once while someone watches, else say why."""
        async with self._lock:
            if self.proc is not proc:
                await asyncio.shield(_kill(proc))  # already stopped or replaced; make sure it is gone
                return
            self.proc = None
            await asyncio.shield(_kill(proc))
            if self.viewers and self.proc_engine == "picamera2" and (self.proc_frames == 0 or not self.restarts_left):
                # The helper never gave a frame, or failed again after its one restart: stay on rpicam-vid from now
                # on, so a fault never leaves the owner without a picture (plan decision 5).
                self.engine, self.restarts_left = "rpicam", 1
                await self._spawn()
                return
            if self.viewers and self.restarts_left:
                self.restarts_left -= 1
                await self._spawn()
                return
            if self.viewers:
                self.reason, self.checked = await self._why(), True
        self._wake()  # the viewers see it ended

    async def _ensure_running(self):
        async with self._lock:
            if self.proc is None:
                self.restarts_left = 1
                await self._spawn()
        while True:
            p = self.proc
            if p is None:
                raise Unavailable(self.reason or "capture_failed")
            if self.frame_at >= self.started_at:
                return
            if await self._next_frame(self.frame_at, FIRST_FRAME) is None and self.proc is p \
                    and self.frame_at < self.started_at:
                await self._failed(p)  # running but silent: a failure, not a wait without end

    async def live_control(self, key, value, who):
        """Try one live change on the running camera (A20 D1). Raises Invalid (not a live key, or a bad value), TooFast
        (more than LIVE_RATE per device), NotLive (no Picamera2 capture is running), or Unavailable. The value goes to
        the helper as a number or a word from CONTROLS, checked here; it is held until the capture stops or an apply."""
        c = BY_KEY.get(key) if isinstance(key, str) else None
        if c is None or not c["live"]:
            raise Invalid(key if isinstance(key, str) else None,
                          "That setting changes with Apply, not while you adjust." if c else "There is no such camera setting.")
        value = _check(c, value)
        self._bind()
        if not self.limiter.allow(who):
            raise TooFast()
        p = self.proc
        if p is None or self.proc_engine != "picamera2" or p.stdin is None or self.proc_frames == 0:
            raise NotLive()
        await self._tell_helper(p, key, value)
        if self.proc is p:
            self.live_values[key] = value
            self.settings_at = time.time()  # a frame from before this change shows the old picture
        return value

    async def _tell_helper(self, p, key, value):
        """One change to the helper's stdin. The preset goes as its numbers, so the helper holds no table of its own."""
        sent = value
        if key == "preset":
            q = PRESETS[value]
            sent = {"width": q["width"], "height": q["height"], "fps": q["fps"], "quality": q["quality"]}
        try:
            p.stdin.write(json.dumps({"key": key, "value": sent}).encode() + b"\n")
            await asyncio.wait_for(p.stdin.drain(), 1.0)
        except (OSError, asyncio.TimeoutError):
            raise Unavailable("capture_failed")
        if self.proc is p:
            self.helper_values[key] = value

    async def _stop(self):
        async with self._lock:
            if self.viewers:
                return  # someone arrived while this waited for the lock
            p, self.proc = self.proc, None
            self.live_values = {}
            if p is not None:
                await asyncio.shield(_kill(p))

    async def _stop_later(self):
        await asyncio.sleep(STOP_AFTER)
        self._stopper = None  # past its wait: a new viewer no longer cancels it, and _stop re-checks for viewers
        await self._stop()

    async def live(self):
        """Multipart parts of the live view, at most the preset's frame rate, for LIVE_LIMIT seconds. Raises Unavailable
        (busy, or why the capture failed) before the first part, or ends early when the capture fails mid-stream."""
        self._bind()
        if self.viewers >= MAX_VIEWERS:
            raise Unavailable("busy")
        self.viewers += 1
        if self._stopper:
            self._stopper.cancel()
            self._stopper = None
        try:
            await self._ensure_running()
            loop = asyncio.get_running_loop()
            end = loop.time() + LIVE_LIMIT
            sent, sent_at = 0.0, 0.0
            while (left := end - loop.time()) > 0:
                fps = PRESETS[self.settings()["preset"]]["fps"]
                await asyncio.sleep(max(0.0, sent_at + 1 / fps - loop.time()))  # at most the preset's rate, not slower
                # Restarted by an apply and no frame yet: the first frame gets FIRST_FRAME, as at a fresh start.
                quiet = FIRST_FRAME if self.frame_at < self.started_at else STALL
                jpg = await self._next_frame(sent, min(left, quiet))
                if jpg is None:
                    p = self.proc
                    if p is None:
                        raise Unavailable(self.reason or "capture_failed")
                    if time.time() - max(self.frame_at, self.started_at) >= quiet:
                        await self._failed(p)  # frozen: restart once, or end with the reason
                    continue
                sent, sent_at = self.frame_at, loop.time()
                yield part(jpg)
        finally:
            self.viewers -= 1
            if not self.viewers and not self._stopper:  # even mid-restart, so a capture never runs unwatched
                self._stopper = asyncio.create_task(self._stop_later())


CAMERA = RoomCamera(helper=HELPER)


# --- Quick Looks (amendment A20 D2, plan P2) ---

def validate_look_name(name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 24:
        raise Invalid("name", "Look name must be 1 to 24 characters.")
    cleaned = name.strip()
    if any(ord(c) < 32 or ord(c) == 127 for c in cleaned):
        raise Invalid("name", "Look name cannot contain control characters.")
    if cleaned.lower() in BUILTIN_NAMES:
        raise Invalid("name", f"{cleaned!r} is a built-in look and cannot be modified.")
    return cleaned


def validate_look_values(values):
    if not isinstance(values, dict) or not values:
        raise Invalid(None, "Send at least one setting for a look.")
    for k in sorted(values):
        if k in FORBIDDEN_LOOK_KEYS:
            raise Invalid(k, f"{k!r} cannot be saved in a look.")
        if k not in BY_KEY:
            raise Invalid(k, f"There is no camera setting called {k!r}.")
        _check(BY_KEY[k], values[k])
    return {k: _check(BY_KEY[k], values[k]) for k in values}


def get_looks(store=None):
    from hub import auth
    custom = (store or auth).get(LOOKS_KEY, [])
    # Always built-ins first, then custom
    return [dict(b) for b in BUILTIN_LOOKS] + [dict(c) for c in custom]


def save_look(name, values, store=None):
    from hub import auth
    s = store or auth
    cleaned_name = validate_look_name(name)
    cleaned_values = validate_look_values(values)
    custom = s.get(LOOKS_KEY, [])
    for existing in custom:
        if existing["name"].lower() == cleaned_name.lower():
            raise Invalid("name", f"A look called {cleaned_name!r} already exists.")
    if len(custom) >= 8:
        raise Invalid(None, "You can save at most 8 custom looks.")
    look = {"name": cleaned_name, "values": cleaned_values}
    custom.append(look)
    s.put(LOOKS_KEY, custom)
    return look


def delete_look(name, store=None):
    from hub import auth
    s = store or auth
    if not isinstance(name, str):
        raise Invalid("name", "Look name required.")
    if name.strip().lower() in BUILTIN_NAMES:
        raise Invalid("name", "Built-in looks cannot be deleted.")
    custom = s.get(LOOKS_KEY, [])
    kept = [l for l in custom if l["name"].lower() != name.strip().lower()]
    if len(kept) == len(custom):
        raise Invalid("name", f"No look called {name!r} found.")
    s.put(LOOKS_KEY, kept)


# --- Snapshots (amendment A20 D3, plan P2) ---

_SNAPSHOT_ID_RE = re.compile(r"^\d{13}$")


def validate_snapshot_id(snapshot_id):
    if not isinstance(snapshot_id, str) or not _SNAPSHOT_ID_RE.match(snapshot_id):
        raise Invalid("id", "Invalid snapshot id.")
    return snapshot_id


def get_snapshot_path(snapshot_id, ext="jpg"):
    s_id = validate_snapshot_id(snapshot_id)
    return os.path.join(SNAPSHOT_DIR, f"{s_id}.{ext}")


def list_snapshots():
    if not os.path.isdir(SNAPSHOT_DIR):
        return []
    items = []
    try:
        filenames = os.listdir(SNAPSHOT_DIR)
    except OSError:
        return []
    for fn in filenames:
        if fn.endswith(".jpg") and len(fn) == 17 and fn[:13].isdigit():
            s_id = fn[:13]
            meta_path = os.path.join(SNAPSHOT_DIR, f"{s_id}.json")
            meta = {}
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r") as f:
                        meta = json.load(f)
                except Exception:
                    pass
            items.append({
                "id": s_id,
                "created_at": meta.get("created_at", int(s_id) / 1000.0),
                "preset": meta.get("preset"),
                "settings": meta.get("settings", {}),
            })
    items.sort(key=lambda x: x["id"], reverse=True)
    return items


def delete_snapshot(snapshot_id):
    s_id = validate_snapshot_id(snapshot_id)
    jpg_path = get_snapshot_path(s_id, "jpg")
    json_path = get_snapshot_path(s_id, "json")
    removed = False
    for p in (jpg_path, json_path):
        try:
            os.remove(p)
            removed = True
        except FileNotFoundError:
            pass
    if not removed:
        raise Invalid("id", f"Snapshot {snapshot_id!r} not found.")


def _enforce_snapshot_limit(limit=MAX_SNAPSHOTS):
    snaps = list_snapshots()
    if len(snaps) >= limit:
        # list_snapshots is newest first; oldest are at the end
        to_remove = snaps[limit - 1:]
        for s in to_remove:
            try:
                delete_snapshot(s["id"])
            except Exception:
                pass


async def save_snapshot(cam=None):
    c = cam or CAMERA
    # Check running stream frame or take one-shot still under lock
    jpg, at = await c.still()
    if len(jpg) > MAX_FRAME:
        raise Invalid(None, f"Snapshot frame too large ({len(jpg)} bytes).")

    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    _enforce_snapshot_limit(MAX_SNAPSHOTS)

    s_id = str(int(time.time() * 1000))
    # Ensure uniqueness if called in the same millisecond
    while os.path.exists(os.path.join(SNAPSHOT_DIR, f"{s_id}.jpg")):
        time.sleep(0.001)
        s_id = str(int(time.time() * 1000))

    settings = c.settings()
    meta = {
        "id": s_id,
        "created_at": at,
        "preset": settings.get("preset"),
        "settings": settings,
    }

    tmp_jpg = os.path.join(SNAPSHOT_DIR, f".tmp-{s_id}.jpg")
    tmp_json = os.path.join(SNAPSHOT_DIR, f".tmp-{s_id}.json")

    with open(tmp_jpg, "wb") as f:
        f.write(jpg)
    with open(tmp_json, "w") as f:
        json.dump(meta, f)

    os.replace(tmp_jpg, os.path.join(SNAPSHOT_DIR, f"{s_id}.jpg"))
    os.replace(tmp_json, os.path.join(SNAPSHOT_DIR, f"{s_id}.json"))

    return meta

