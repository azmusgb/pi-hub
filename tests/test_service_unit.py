"""The hub's systemd unit: a release restart must not wait out systemd's stop timeout."""
import pathlib
import re

UNIT = (pathlib.Path(__file__).resolve().parent.parent / "deploy/pi-hub.service").read_text()


def test_uvicorn_stops_within_seconds_even_with_open_streams():
    # /api/records/stream (EventSource) never closes on its own; without a bound, uvicorn waits for it and
    # systemd kills the hub after 90 s, so every release had ~1.5 min of downtime (31 Oct 2026).
    m = re.search(r"--timeout-graceful-shutdown (\d+)", UNIT)
    assert m and 1 <= int(m.group(1)) <= 10


def test_systemd_backstop_is_shorter_than_its_default():
    m = re.search(r"^TimeoutStopSec=(\d+)$", UNIT, re.M)
    assert m and int(m.group(1)) <= 20


def test_the_hub_may_open_the_pis_camera_and_no_longer_loads_a17s_rotation_file():
    # The Room view (A17): rpicam needs /dev/video*, /dev/media* and /dev/dma_heap/*, all root:video, mode 0660.
    assert re.search(r"^SupplementaryGroups=video$", UNIT, re.M)
    # A18 C4: the owner sets the camera from the page; the file only seeds "Turn" once, read by the hub itself.
    assert "room-camera.env" not in UNIT and "ROOM_CAMERA_ROTATE" not in UNIT
    # Still nothing outside its own state is writable: frames never reach disk.
    assert "ProtectSystem=strict" in UNIT and "PrivateTmp=yes" in UNIT


def test_install_lists_picamera2_so_a_rebuilt_pi_has_the_room_view_helper_dependency():
    # A20 plan decision 12: the OS image brought it today; a rebuild must not depend on that, or the Room view falls
    # back to rpicam-vid without anyone seeing why.
    install = (pathlib.Path(__file__).resolve().parent.parent / "deploy/install.sh").read_text()
    assert "python3-picamera2" in install
