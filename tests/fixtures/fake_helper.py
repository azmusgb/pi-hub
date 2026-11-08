"""A stand-in for hub/room_camera_helper.py in tests/test_room_camera.py. argv[1] is the real helper's JSON config;
argv[2] picks the part played: ok (frames until killed or stdin closes; each frame names the live changes received so
far, so a test can see what reached the camera), import (exit 2 at once, as a missing Picamera2), silent (runs, never
writes), once (a few frames, then exit 2), flaky (a few frames then exit 2, but only on the first run: the marker file
named by argv[3] is created). Writes nothing anywhere but stdout (and the marker for flaky)."""
import json
import os
import sys
import threading
import time

cfg, mode = json.loads(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "ok"
out = sys.stdout.buffer
seen = []


def reader():
    for line in sys.stdin:
        try:
            m = json.loads(line)
            seen.append(f"{m['key']}={m['value']}")
        except ValueError:
            seen.append("bad")
    os._exit(0)


def frame(n):
    return b"\xff\xd8\xff\xe0helper-%d|%s|ev0=%s" % (n, ",".join(seen).encode(), str(cfg["ev"]).encode()) + b"\xff\xd9"


if mode == "import":
    sys.exit(2)
if mode == "silent":
    time.sleep(3600)
threading.Thread(target=reader, daemon=True).start()
if mode == "flaky":
    marker = sys.argv[3]
    first = not os.path.exists(marker)
    open(marker, "w").close()
    mode = "once" if first else "ok"
n = 0
while True:
    out.write(frame(n))
    out.flush()
    n += 1
    if mode == "once" and n >= 3:
        sys.exit(2)
    time.sleep(0.02)
