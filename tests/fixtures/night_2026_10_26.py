"""The night of 26-27 October 2026 as the hub saw it: the inputs of each 30 s refresh, 00:02 (the workshop display already offline) to 02:03:30.

Times are local (the test module pins TZ to America/New_York around its use). Each step is
(epoch, gather()-style inputs); the first step is the first cycle after a start.
"""
import time

from tests.helpers_records import bud, inputs

START, END = (0, 2, 0), (2, 3, 30)  # the printer idle, not after a failure, well before 01:20


def at(h, m, s=0):
    """Epoch seconds of h:m:s local time on 2026-10-27."""
    return time.mktime((2026, 10, 27, h, m, s, 0, 0, -1))


def _printer(t):
    """Bambuddy's reading at epoch t."""
    hm = lambda h, m: at(h, m)  # noqa: E731
    if t < hm(1, 20):
        return bud("IDLE", 0, job="HEX_TILE_v72")
    if t < hm(1, 31):
        return bud("RUNNING", min(10, 1 + int((t - hm(1, 20)) // 66)), job="HEX_TILE_v72")
    if t < hm(1, 36):
        return bud("IDLE", 10, job="HEX_TILE_v72")  # stopped at 10%: a failure
    if t < hm(2, 1):
        return bud("RUNNING", min(11, 1 + int((t - hm(1, 36)) // 150)), job="HEX_TILE_v72")
    if t < hm(2, 3):
        return bud("RUNNING", 11, job="HEX_TILE_v72")
    return bud("RUNNING", 12, job="HEX_TILE_v72")


def reading(t):
    """Every source's answer at epoch t."""
    ai = "Down" if t >= at(2, 2) else "Ready"
    pi = {"x2d_state": "No status", "display_state": "Offline", "ai_state": ai, "drive_state": "Connected",
          "pi_temp": 66, "mirror": {"last_ok": t}, "services": {"plex": True, "homebridge": True}}
    camera = {"ok": True} if t >= at(1, 57) else {"ok": False, "message": "no picture"}
    return inputs(pi=pi, bambuddy=_printer(t), adguard={"ok": False, "message": "AdGuard isn't answering"},
                  camera=camera, netmon={"win_ok": True, "status": "ok", "wan_ms": 20, "dns_ms": 10},
                  backups={"ok": True, "ages": {"pi": t}})


def night(until=None):
    """(epoch, inputs) every 30 s from the start of the night up to `until` (epoch, inclusive; default the end)."""
    t, end = at(*START), at(*END) if until is None else until
    while t <= end:
        yield t, reading(t)
        t += 30
