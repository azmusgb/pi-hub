"""A stand-in for rpicam-vid and rpicam-still in tests/test_room_camera.py. argv[1] picks the part played:
vid (JPEG frames on stdout until killed), still (one JPEG, then exit), list (the camera list), die (exit at once with no
frame), none (the list with no camera). Writes nothing anywhere but stdout."""
import sys
import time

FRAME = b"\xff\xd8\xff\xe0" + b"fake-jpeg-%d" + b"\xff\xd9"


def frame(n):
    return FRAME.replace(b"%d", str(n).encode())


mode = sys.argv[1]
out = sys.stdout.buffer
if mode == "vid":
    n = 0
    while True:
        out.write(frame(n))
        out.flush()
        n += 1
        time.sleep(0.02)
elif mode == "still":
    out.write(frame(0))
    out.flush()
elif mode == "list":
    print("Available cameras\n-----------------\n0 : ov5647 [2592x1944 10-bit GBRG]")
elif mode == "none":
    print("No cameras available!")
else:
    sys.exit(1)
