"""The Room view's live camera, through Picamera2 (amendment A20 D1, plan decision 2). Started and stopped by
hub/room_camera.py as a child process, never imported by the hub: a libcamera fault or a stuck camera ends this
process, not the hub.

Protocol. argv[1] is one JSON object: the live preset (width, height, fps, quality) and every camera setting, already
validated by the hub. stdin carries one JSON object per line, {"key": ..., "value": ...}, a live change to one setting
(only the keys the hub marks live). stdout carries JPEG frames, back to back. Nothing else is read or written; the
process ends when stdin closes (the hub is gone), on SIGTERM, or when the camera fails (exit code 2)."""
import io
import json
import sys
import threading
import time

# The sensor runs at this rate whatever the preset sends. A change takes about seven frames to reach the picture, so a
# faster camera shows it sooner (0.74 s at 10 fps, measured on the Pi, 8 Nov 2026); only the preset's rate is sent.
CAMERA_FPS = 30
LIVE_KEYS = ("ev", "brightness", "contrast", "saturation", "sharpness", "awb", "metering", "exposure", "manual",
             "shutter", "gain", "denoise")
# The hub's words for each choice, as Picamera2/libcamera names them (libcamera controls: AwbModeEnum etc.).
AWB = {"auto": "Auto", "incandescent": "Incandescent", "tungsten": "Tungsten", "fluorescent": "Fluorescent",
       "indoor": "Indoor", "daylight": "Daylight", "cloudy": "Cloudy"}
METERING = {"centre": "CentreWeighted", "spot": "Spot", "average": "Matrix"}
EXPOSURE = {"normal": "Normal", "sport": "Short"}
DENOISE = {"auto": "Fast", "off": "Off", "fast": "Fast", "hq": "HighQuality"}


def controls_from(s, fps):
    """Picamera2 controls for settings s, as plain names and numbers (enum members are looked up by the caller, so this
    is testable without libcamera). Manual exposure turns auto exposure off and holds the frame time open for a shutter
    longer than one frame, which lowers the frame rate rather than clamping the shutter. Auto exposure may do the same, down
    to the preset's own rate, so a dim room gets the exposure the preset always had."""
    c = {"Brightness": float(s["brightness"]), "Contrast": float(s["contrast"]), "Saturation": float(s["saturation"]),
         "Sharpness": float(s["sharpness"]), "AwbMode": AWB[s["awb"]], "AeMeteringMode": METERING[s["metering"]],
         "AeExposureMode": EXPOSURE[s["exposure"]], "NoiseReductionMode": DENOISE[s["denoise"]]}
    frame_us = int(1_000_000 / fps)
    if s["manual"]:
        shutter = int(s["shutter"])
        c.update(AeEnable=False, ExposureTime=shutter, AnalogueGain=float(s["gain"]),
                 FrameDurationLimits=(max(frame_us, shutter), max(frame_us, shutter)))
    else:
        slowest_us = max(frame_us, int(1_000_000 / s["fps"])) if s.get("fps") else frame_us
        c.update(AeEnable=True, ExposureValue=float(s["ev"]), FrameDurationLimits=(frame_us, slowest_us))
    return c


def transform_from(s):
    """(hflip, vflip). A half turn is both flips, so it combines with Mirror and Flip by exclusive-or."""
    half = s["turn"] == 180
    return bool(s["mirror"]) != half, bool(s["flip"]) != half


def scaler_crop(s, full, size):
    """(x, y, w, h) in sensor pixels for Zoom and the centre, keeping the output's shape so it is never stretched, or
    None at 1×. `full` is the sensor's widest crop (x, y, w, h); `size` the output (width, height)."""
    if s["zoom"] <= 1:
        return None
    fx, fy, fw, fh = full
    w = fw / s["zoom"]
    h = w * size[1] / size[0]
    if h > fh:
        h, w = fh / s["zoom"], fh / s["zoom"] * size[0] / size[1]
    x = min(max(fx + fw * s["centre_x"] / 100 - w / 2, fx), fx + fw - w)
    y = min(max(fy + fh * s["centre_y"] / 100 - h / 2, fy), fy + fh - h)
    return int(x), int(y), int(w), int(h)


def parse_line(line):
    """(key, value) from one stdin line, or None for anything that isn't a live change this process accepts."""
    try:
        msg = json.loads(line)
    except ValueError:
        return None
    if not isinstance(msg, dict) or msg.get("key") not in LIVE_KEYS or "value" not in msg:
        return None
    return msg["key"], msg["value"]


def main(argv, stdin, stdout):
    cfg = json.loads(argv[1])
    from libcamera import Transform, controls as lc  # imported here: the hub never imports this module's camera side
    from picamera2 import Picamera2

    def to_libcamera(c):
        out = dict(c)
        for name, enum in (("AwbMode", lc.AwbModeEnum), ("AeMeteringMode", lc.AeMeteringModeEnum),
                           ("AeExposureMode", lc.AeExposureModeEnum),
                           ("NoiseReductionMode", lc.draft.NoiseReductionModeEnum)):
            if name in out:
                out[name] = getattr(enum, out[name])
        return out

    state = dict(cfg)
    lock = threading.Lock()
    stop = threading.Event()
    pending = []

    def read_stdin():
        for line in stdin:
            parsed = parse_line(line)
            if parsed:
                with lock:
                    pending.append(parsed)
        stop.set()  # the hub closed our stdin: it is gone, so the camera is released

    threading.Thread(target=read_stdin, daemon=True).start()
    size = (int(cfg["width"]), int(cfg["height"]))
    cam = Picamera2()
    hflip, vflip = transform_from(cfg)
    # Few buffers, so a frame is never older than the queue it waited in (six made a change show 1.4 s late).
    cam.configure(cam.create_video_configuration(main={"size": size, "format": "RGB888"}, buffer_count=2,
                                                 transform=Transform(hflip=hflip, vflip=vflip)))
    crop = scaler_crop(cfg, cam.camera_properties["ScalerCropMaximum"], size)
    cam.set_controls(to_libcamera(controls_from(state, CAMERA_FPS)))
    cam.start()
    if crop:
        cam.set_controls({"ScalerCrop": crop})
    period, last = 1 / cfg["fps"], 0.0
    try:
        while not stop.is_set():
            with lock:
                changes, pending[:] = list(pending), []
            if changes:
                for key, value in changes:
                    state[key] = value
                cam.set_controls(to_libcamera(controls_from(state, CAMERA_FPS)))
            request = cam.capture_request()
            try:
                now = time.monotonic()
                if now - last < period - 0.5 / CAMERA_FPS:
                    continue  # the camera is faster than the preset sends: this frame is only a quicker pipeline
                last = now  # from the start of the encode, so the preset's rate holds when encoding is quick enough
                buf = io.BytesIO()
                request.make_image("main").save(buf, format="JPEG", quality=int(cfg["quality"]))
            finally:
                request.release()
            stdout.write(buf.getvalue())
            stdout.flush()
    finally:
        cam.stop()
        cam.close()


if __name__ == "__main__":
    try:
        main(sys.argv, sys.stdin, sys.stdout.buffer)
    except Exception as e:  # the hub reads this as "no frames": it falls back to rpicam (plan decision 5)
        print(f"room_camera_helper: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
