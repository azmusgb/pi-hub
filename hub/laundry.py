"""The LG washer and dryer, read from LG's own ThinQ Connect API with a personal access token (2 Nov). The community
Homebridge plugin's sign-in is blocked by LG (403), so laundry doesn't come through Homebridge. Read-only: the hub
never starts or stops a cycle.

The token is made at smartsolution.developer.lge.com (ThinQ Connect, Personal Access Token) and kept root:pi-hub 640
like the Plex token. Without the file the hub shows no laundry at all.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid

from . import sources

TOKEN_FILE = os.environ.get("HUB_THINQ_TOKEN_FILE", "/etc/pi-hub/secrets/thinq_pat")
COUNTRY = os.environ.get("HUB_THINQ_COUNTRY", "US")
URL = os.environ.get("HUB_THINQ_URL", "https://api-aic.lgthinq.com")  # LG's Americas region, which serves the US
# The public API key LG ships in its own ThinQ Connect SDK (thinqconnect/const.py); every client sends it.
API_KEY = "v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3"
# LG asks each client to keep one id, so it is derived, not random per start.
CLIENT_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "laundry.pi-hub.local"))

KINDS = {"DEVICE_WASHER": "washer", "DEVICE_DRYER": "dryer",
         "DEVICE_WASHTOWER_WASHER": "washer", "DEVICE_WASHTOWER_DRYER": "dryer"}
STATE_TTL = 60
DEVICES_TTL = 3600

# LG's runState.currentState words, reduced to what the card says. Anything else is a cycle in progress
# (DETECTING, RINSING, SPINNING, DRYING, COOLING, STEAM_SOFTENING and the rest).
STATES = {"POWER_OFF": "idle", "SLEEP": "idle", "INITIAL": "idle", "END": "done", "ERROR": "fault",
          "PAUSE": "paused", "RESERVED": "scheduled"}

_ended = {}  # device id -> when the hub first saw that cycle finished
_devices = {}  # "at", "list": LG's device list, asked for hourly; only a good answer is kept
_lock = threading.Lock()


class Refused(Exception):
    pass


def token():
    try:
        with open(TOKEN_FILE) as f:
            return f.read().strip()
    except OSError:
        return ""


def _get(path, tok):
    req = urllib.request.Request(f"{URL}/{path}", headers={
        "Accept": "application/json", "Authorization": f"Bearer {tok}", "x-country": COUNTRY,
        "x-message-id": uuid.uuid4().hex[:22], "x-client-id": CLIENT_ID, "x-api-key": API_KEY,
        "x-service-phase": "OP"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r).get("response")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise Refused() from e
        raise


def machine_state(raw):
    """One machine's /state answer to (state, minutes left). A washtower or combo answers a list, one per part."""
    if isinstance(raw, list):
        raw = raw[0] if raw else {}
    raw = raw if isinstance(raw, dict) else {}
    current = str((raw.get("runState") or {}).get("currentState") or "").upper()
    state = STATES.get(current, "running" if current else "unknown")
    timer = raw.get("timer") or {}
    try:
        left = int(timer.get("remainHour") or 0) * 60 + int(timer.get("remainMinute") or 0)
    except (TypeError, ValueError):
        left = 0
    return state, (left if state in ("running", "paused") and left > 0 else None)


def _ended_at(device_id, state, now):
    with _lock:
        if state != "done":
            _ended.pop(device_id, None)
            return None
        return _ended.setdefault(device_id, now)


def _read(tok):
    try:
        with _lock:
            devices = _devices.get("list") if time.time() - _devices.get("at", 0) < DEVICES_TTL else None
        if devices is None:
            devices = _get("devices", tok) or []
            with _lock:
                _devices.update(at=time.time(), list=devices)
        machines = []
        for d in devices:
            info = d.get("deviceInfo") or {}
            kind = KINDS.get(str(info.get("deviceType")))
            if not kind or not d.get("deviceId"):
                continue
            state, left = machine_state(_get(f"devices/{d['deviceId']}/state", tok))
            machines.append({"id": d["deviceId"], "kind": kind, "name": info.get("alias") or kind.title(),
                             "state": state, "minutes_left": left,
                             "ended_at": _ended_at(d["deviceId"], state, time.time())})
        machines.sort(key=lambda m: (m["kind"] != "washer", m["name"]))
        return {"available": True, "machines": machines}
    except Refused:
        with _lock:
            _devices.clear()
        return {"available": False, "message": "LG refused the hub's ThinQ token. Make a new one and save it on the Pi."}
    except (OSError, ValueError, AttributeError, TypeError):
        return {"available": False, "message": "Laundry isn't answering."}


def status():
    tok = token()
    if not tok:
        return {"configured": False, "available": False, "machines": []}
    read = sources.cached("thinq_state", STATE_TTL, lambda: _read(tok))
    return {"configured": True, "machines": [], **(read or {"available": False, "message": "Laundry isn't answering."})}
