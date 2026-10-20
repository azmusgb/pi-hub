"""Home control through the Homebridge web UI's API: list lights, plugs and switches, and set them."""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

from . import auth

HB_URL = os.environ.get("HUB_HOMEBRIDGE_URL", "http://127.0.0.1:8581")
CONTROLLABLE = {"Lightbulb", "Switch", "Outlet", "Fan", "Fanv2"}
UID = re.compile(r"^[0-9a-f]{20,80}$")
_token = {"value": None, "expires": 0}
_lock = threading.Lock()


class NotConnected(Exception):
    pass


def _call(method, path, body=None, token=None, timeout=8):
    req = urllib.request.Request(f"{HB_URL}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def _login():
    creds = auth.get("homebridge_login")
    if not creds:
        raise NotConnected("Homebridge isn't connected yet. The owner can connect it in Settings.")
    with _lock:
        if _token["value"] and _token["expires"] > time.time() + 60:
            return _token["value"]
        try:
            r = _call("POST", "/api/auth/login", {"username": creds["username"], "password": creds["password"]})
        except urllib.error.HTTPError as e:
            raise NotConnected("Homebridge turned down the saved login. The owner can update it in Settings.") from e
        _token["value"] = r["access_token"]
        _token["expires"] = time.time() + int(r.get("expires_in", 3600))
        return _token["value"]


def test_login(username, password):
    try:
        _call("POST", "/api/auth/login", {"username": username, "password": password})
        return True
    except urllib.error.HTTPError:
        return False


def forget_token():
    with _lock:
        _token["value"] = None


def _value(svc, kind):
    for c in svc.get("serviceCharacteristics") or []:
        if c.get("type") == kind:
            return c
    return None


def accessories():
    token = _login()
    try:
        items = _call("GET", "/api/accessories", token=token, timeout=12) or []
    except urllib.error.HTTPError as e:
        if e.code in (400, 403, 404):
            raise NotConnected("Homebridge needs “insecure mode” switched on before the hub can control accessories. "
                               "Turn it on in Homebridge, Settings, then restart Homebridge.") from e
        raise
    out = []
    for a in items:
        kind = a.get("type")
        if kind not in CONTROLLABLE:
            continue
        on = _value(a, "On") or _value(a, "Active")
        bright = _value(a, "Brightness")
        out.append({
            "id": a.get("uniqueId"),
            "name": (a.get("serviceName") or (a.get("accessoryInformation") or {}).get("Name") or "Accessory")[:60],
            "room": ((a.get("accessoryInformation") or {}).get("Manufacturer") or "")[:40],
            "kind": {"Lightbulb": "light", "Outlet": "plug", "Switch": "switch"}.get(kind, "fan"),
            "on": bool(on and on.get("value")),
            "control": on.get("type") if on else None,
            "brightness": bright.get("value") if bright else None,
        })
    return sorted(out, key=lambda x: (x["kind"], x["name"].lower()))


def set_value(uid, characteristic, value):
    if not UID.match(uid or ""):
        raise ValueError("Unknown accessory.")
    if characteristic not in ("On", "Active", "Brightness"):
        raise ValueError("That can't be changed from the hub.")
    if characteristic == "Brightness":
        value = max(0, min(int(value), 100))
    else:
        value = 1 if value else 0 if characteristic == "Active" else bool(value)
    _call("PUT", f"/api/accessories/{uid}", {"characteristicType": characteristic, "value": value}, token=_login())
