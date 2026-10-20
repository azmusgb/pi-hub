"""Fix-it buttons. Each one is a named action; admin ones go through the root helper."""
import json
import os
import socket
import urllib.request

from . import sources, system

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


def available(role):
    from .auth import allowed
    return [{"name": n, "label": a[0], "allowed": allowed(role, a[2])} for n, a in ACTIONS.items()]

