"""Clear the plate, pause and resume the X2D through Bambuddy (one home, step 3).

The hub's read key (bambuddy.KEY_FILE) stays read-only; printer actions use a separate Bambuddy API key with only
"Control printer" for printer 1, kept root:pi-hub 640 and made once by deploy/bambuddy-control-key.py. Clear plate
makes the same two calls as Local AI's /api/display/printer/clear, so the display and the hub agree."""
import os
import threading
import urllib.error
import urllib.request

from . import bambuddy

KEY_FILE = os.environ.get("HUB_BAMBUDDY_CONTROL_KEY_FILE", "/etc/pi-hub/secrets/bambuddy_control_key")
PRINTER = 1
TIMEOUT = 5  # seconds per Bambuddy call
STEPS = {"clear": ("clear-plate", "hms/clear"), "pause": ("print/pause",), "resume": ("print/resume",)}
# One printer command at a time, from any surface (the hub's own buttons and the workshop display): acquired without
# waiting, so a second tap is refused, never queued behind the first.
BUSY = threading.Lock()
DONE = {"clear": "Plate cleared. Ready for the next print.", "pause": "Paused. Resume it here or on the printer.",
        "resume": "Resumed."}


def _key():
    try:
        with open(KEY_FILE) as f:
            return f.read().strip()
    except OSError:
        return ""


def _post(path, key):
    """One Bambuddy call, in Local AI's words: ok, refused, no answer or HTTP <n>."""
    req = urllib.request.Request(f"{bambuddy.URL}/api/v1/printers/{PRINTER}/{path}", data=b"", method="POST",
                                 headers={"X-API-Key": key})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT):
            return "ok"
    except urllib.error.HTTPError as e:
        return "refused" if e.code in (401, 403) else f"HTTP {e.code}"
    except Exception:
        return "no answer"


def _say(result):
    if result == "no key":
        return "The hub can't control the printer yet: its Bambuddy control key isn't set up."
    if result == "refused":
        return "Bambuddy refused the hub's control key. Make a new one (docs/operations.md)."
    if result == "no answer":
        return "Bambuddy isn't answering. Check the Pi, or use the printer's screen."
    return f"Bambuddy couldn't do that ({result})."


def run(action, post=None):
    """{"ok", "say", "steps"}. Stops when the first step fails; once the plate is cleared it counts as done even if
    the error list doesn't clear (the queue may already be starting). Never raises."""
    post = post or _post
    key = _key()  # read on every call, so a newly made key works without a restart
    steps = {}
    for i, path in enumerate(STEPS[action]):
        steps[path] = post(path, key) if key else "no key"
        if steps[path] != "ok" and i:  # the plate is cleared; only its error list didn't go
            return {"ok": True, "say": "Plate cleared. The printer's error list didn't clear; check its screen.",
                    "steps": steps}
        if steps[path] != "ok":
            return {"ok": False, "say": _say(steps[path]), "steps": steps}
    return {"ok": True, "say": DONE[action], "steps": steps}
