"""The Room view (amendment A17): the Pi's own camera, a fixed view of the printer from outside. Never "the camera":
that is the printer's, through the camera bridge (sources.CAMERA).

The camera runs only while someone looks (R5). A still with nothing running is one short capture, shared by everyone
for SHARE_FOR seconds and taken one at a time, so two open pages never fight over the camera (plan decision 3). Live is
one rpicam-vid shared by at most MAX_VIEWERS open responses; it stops STOP_AFTER seconds after the last one leaves, and
each response ends itself after LIVE_LIMIT. A capture that dies is restarted once, then reported. Frames live only in
memory: nothing is written to disk or logged. The service's own cgroup takes the capture down with the hub.

The state (R7) is one of not_checked, ready, live, or unavailable with a reason (not_detected, capture_failed); busy is
only ever an answer to the live request that found four already watching."""
import asyncio
import os
import time

SOI, EOI = b"\xff\xd8", b"\xff\xd9"
SHARE_FOR = 2.0      # a still this young is served to everyone instead of taking another
WAIT_FOR = 3.0       # how long a still waits for one being taken before it answers with the previous one
MAX_AGE = 30.0       # never serve a frame older than this as if it were current
STOP_AFTER = 10.0    # the capture keeps running this long after the last viewer leaves
LIVE_LIMIT = 300.0   # a live response ends itself after this, so a forgotten tab can't hold the camera (R4)
MAX_VIEWERS = 4
MAX_FPS = 10
MAX_FRAME = 2 * 1024 * 1024
STILL_TIMEOUT = 10.0
FIRST_FRAME = 13.0   # a live capture with no frame by then has failed, even if the process still runs
STALL = 5.0          # a live capture with no new frame for this long has failed
KILL_AFTER = 2.0     # SIGTERM, then SIGKILL after this

# 640x480 at 10 frames a second, quality 50: about 1.4 Mbit/s and 6% of one core, measured on the Pi on 7 Nov 2026.
VID = ["rpicam-vid", "-n", "-t", "0", "--codec", "mjpeg", "--quality", "50", "--width", "640", "--height", "480",
       "--framerate", str(MAX_FPS), "-o", "-"]
# About 1.5 s, most of it the exposure settling. No thumbnail, so stdout is exactly one JPEG.
STILL = ["rpicam-still", "-n", "-t", "1500", "--width", "640", "--height", "480", "-e", "jpg", "--thumb", "none",
         "-q", "70", "-o", "-"]
LISTING = ["rpicam-vid", "--list-cameras"]

WORDS = {
    "not_detected": "The Pi's camera isn't detected. Check its ribbon cable.",
    "capture_failed": "The Pi's camera isn't giving pictures right now.",
    "busy": "Live is busy: four people are already watching.",
}


class Unavailable(Exception):
    def __init__(self, reason):
        super().__init__(WORDS.get(reason, reason))
        self.reason = reason


def rotation():
    """ROOM_CAMERA_ROTATE from /etc/pi-hub/room-camera.env (R8): 0, 90, 180 or 270; anything else is 0."""
    raw = (os.environ.get("ROOM_CAMERA_ROTATE") or "").strip()
    return int(raw) if raw in ("0", "90", "180", "270") else 0


def capture_args(cmd):
    """The camera turns pictures only by 180; a quarter turn is left to the page's CSS (plan decision 6)."""
    return [*cmd, "--rotation", "180"] if rotation() == 180 else list(cmd)


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
    def __init__(self, vid=None, still=None, listing=None):
        self.vid_cmd, self.still_cmd, self.list_cmd = vid or VID, still or STILL, listing or LISTING
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

    def state(self):
        if self.proc is not None and self.viewers:
            state = "live"
        elif self.reason:
            state = "unavailable"
        else:
            state = "ready" if self.checked else "not_checked"
        return {"state": state, "reason": self.reason if state == "unavailable" else None, "viewers": self.viewers,
                "frame_at": self.frame_at or None, "rotate": rotation()}

    def _got(self, jpg):
        self.frame, self.frame_at = jpg, time.time()
        self.reason, self.checked = None, True
        self._wake()

    def _recent(self):
        if self.frame and time.time() - self.frame_at < MAX_AGE:
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
            p = await asyncio.create_subprocess_exec(*capture_args(self.still_cmd), stdout=asyncio.subprocess.PIPE,
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
        if self.frame and time.time() - self.frame_at < SHARE_FOR:
            return self.frame, self.frame_at
        try:
            await asyncio.wait_for(self._lock.acquire(), WAIT_FOR)
        except asyncio.TimeoutError:
            return self._recent()
        try:
            if self.frame and time.time() - self.frame_at < SHARE_FOR:
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
        if not (self.frame and time.time() - self.frame_at < SHARE_FOR):
            await self._next_frame(self.frame_at, WAIT_FOR)
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
        try:
            self.proc = await asyncio.create_subprocess_exec(*capture_args(self.vid_cmd), stdout=asyncio.subprocess.PIPE,
                                                             stderr=asyncio.subprocess.DEVNULL)
        except OSError:
            self.proc = None
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

    async def _stop(self):
        async with self._lock:
            if self.viewers:
                return  # someone arrived while this waited for the lock
            p, self.proc = self.proc, None
            if p is not None:
                await asyncio.shield(_kill(p))

    async def _stop_later(self):
        await asyncio.sleep(STOP_AFTER)
        self._stopper = None  # past its wait: a new viewer no longer cancels it, and _stop re-checks for viewers
        await self._stop()

    async def live(self):
        """Multipart parts of the live view, at most MAX_FPS a second, for LIVE_LIMIT seconds. Raises Unavailable
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
                await asyncio.sleep(max(0.0, sent_at + 1 / MAX_FPS - loop.time()))  # at most MAX_FPS, not slower
                jpg = await self._next_frame(sent, min(left, STALL))
                if jpg is None:
                    p = self.proc
                    if p is None:
                        raise Unavailable(self.reason or "capture_failed")
                    if time.time() - max(self.frame_at, self.started_at) >= STALL:
                        await self._failed(p)  # frozen: restart once, or end with the reason
                    continue
                sent, sent_at = self.frame_at, loop.time()
                yield part(jpg)
        finally:
            self.viewers -= 1
            if not self.viewers and not self._stopper:  # even mid-restart, so a capture never runs unwatched
                self._stopper = asyncio.create_task(self._stop_later())


CAMERA = RoomCamera()
