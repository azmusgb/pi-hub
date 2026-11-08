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


def test_the_hub_may_open_the_pis_camera_and_read_its_rotation():
    # The Room view (A17): rpicam needs /dev/video*, /dev/media* and /dev/dma_heap/*, all root:video, mode 0660.
    assert re.search(r"^SupplementaryGroups=video$", UNIT, re.M)
    # Optional: without the file the hub still starts, and the picture isn't turned.
    assert re.search(r"^EnvironmentFile=-/etc/pi-hub/room-camera\.env$", UNIT, re.M)
    # Still nothing outside its own state is writable: frames never reach disk.
    assert "ProtectSystem=strict" in UNIT and "PrivateTmp=yes" in UNIT
