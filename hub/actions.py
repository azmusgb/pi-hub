"""Fix-it buttons. Each one is a named action; admin ones go through the root helper."""
import json
import os
import socket
import urllib.request

from . import sources, system, homecontrol, freshness

SOCKET = os.environ.get("HUB_HELPER_SOCKET", "/run/pi-hub-helper/helper.sock")

# name -> (label shown on the button, what it says when done, minimum role)
ACTIONS = {
    "restart:plex": ("Restart Plex", "Plex restarted.", "household"),
    "restart:homebridge": ("Restart Homebridge", "Homebridge restarted.", "household"),
    "remount:movies": ("Remount the movies drive", "The movies drive is mounted.", "household"),
    "rescan:plex": ("Rescan the Plex library", "Plex is looking for new movies.", "household"),
    "updates:install": ("Install updates", "Updates are installing. This can take a few minutes.", "household"),
    "restart:pi": ("Restart the Pi", "The Pi is restarting. The hub is back in about a minute.", "household"),
    "selfcheck:run": ("Run a self-check", "Self-check finished. The result is on this page.", "household"),
    "mirror:movies": ("Copy new movies from the PC", "Copying new movies from the PC. Movies shows when it's finished.", "household"),
    "restart:ntfy": ("Restart ntfy", "ntfy alert service restarted.", "household"),
    "restart:bambuddy": ("Restart Bambuddy", "Bambuddy restarted.", "household"),
    "restart:homebox": ("Restart Homebox", "Homebox restarted.", "household"),
    "restart:backrest": ("Restart Backrest", "Backrest restarted.", "household"),
    "restart:adguard": ("Restart AdGuard", "AdGuard restarted.", "household"),
    "restart:scanserv": ("Restart Scanner", "Scanner service restarted.", "household"),
}


def helper(action, timeout=1900):
    return helper_with(action, {}, timeout)


def helper_with(action, extra, timeout=60):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(SOCKET)
        s.sendall((json.dumps({**extra, "action": action}) + "\n").encode())
        return json.loads(s.makefile().readline() or "{}")
    except OSError:
        return {"ok": False, "message": "The hub's helper isn't running."}
    finally:
        s.close()


def _rescan():
    req = urllib.request.Request(f"{sources.PLEX_URL}/library/sections/all/refresh",
                                 headers={"X-Plex-Token": sources._plex_token()})
    try:
        urllib.request.urlopen(req, timeout=10).close()
        return {"ok": True, "message": "Done."}
    except OSError:
        return {"ok": False, "message": "Plex didn't answer."}


def run(name):
    if name not in ACTIONS:
        raise ValueError("Unknown action.")
    if name == "rescan:plex":
        result = _rescan()
    else:
        result = helper(name)
    label, done, _ = ACTIONS[name]
    if result.get("ok"):
        sources._cache.clear()
        return {"ok": True, "message": done}
    detail = result.get("message") or "It didn't work."
    if name == "remount:movies" and not system.movies_present():
        detail = "The drive isn't plugged in. Unplug it, wait 10 seconds and plug it back in, then try again."
    raise RuntimeError(f"{label} didn't work. {detail}")


def updates_status():
    return helper("status:updates:install", timeout=5)


def containers():
    """List containers running on the Pi with their status."""
    return helper("docker:ps", timeout=8).get("containers", [])


def available(role):
    from .auth import allowed
    return [{"name": n, "label": a[0], "allowed": allowed(role, a[2])} for n, a in ACTIONS.items()]



VERIFIABLE = {"restart:plex", "remount:movies", "restart:homebridge"}


def verify(name):
    """Read the affected integration directly; never repeat the fix or trust a cache."""
    if name not in ACTIONS:
        raise ValueError("Unknown action.")
    if name not in VERIFIABLE:
        return {"state": "not_supported", "message": "This action needs its own completion check.",
                "next_step": "Check its progress in System checks & advanced fixes."}
    try:
        if name == "restart:homebridge":
            devices = homecontrol.accessories()
            if not devices:
                return {"state": "needs_attention", "message": "Homebridge responds, but no controllable devices were returned.",
                        "next_step": "Check the Homebridge configuration and the Devices page before trying the light again."}
            return {"state": "recovered", "message": f"Smart-home controls responded with {len(devices)} devices.",
                    "next_step": "Try the light or plug again; this check does not switch a device."}
        if not system.movies_mounted():
            return {"state": "needs_attention", "message": "The movies drive is still not mounted.",
                    "next_step": "Check its cable and power, then open Drives before trying another fix."}
        sessions = freshness.observe("plex", 15, sources._plex_sessions)
        if sessions is None:
            raise OSError("No Plex response")
        return {"state": "recovered", "message": "Plex responds and the movies drive is mounted.",
                "next_step": "Try the movie again; playback on the TV still needs checking."}
    except homecontrol.NotConnected as e:
        return {"state": "needs_setup", "message": "Smart-home controls need setup.", "next_step": str(e)}
    except Exception:
        return {"state": "unavailable", "message": "The hub could not confirm recovery yet.",
                "next_step": "Check the connection and follow the relevant guide. You can check again without repeating the fix."}
