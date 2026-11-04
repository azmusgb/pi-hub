"""Home control through the Homebridge web UI's API: list lights, plugs and switches, and set them."""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

from . import auth, freshness

HB_URL = os.environ.get("HUB_HOMEBRIDGE_URL", "http://127.0.0.1:8581")
CONTROLLABLE = {"Lightbulb", "Switch", "Outlet", "Fan", "Fanv2"}
UID = re.compile(r"^[0-9a-f]{20,80}$")
ALIASES = {
    # The Govee H6076 "Floor Lamp", in the master bedroom (it was labelled the workshop light until 1 Nov).
    "27e5e4f8f7746b97a91a0a24384bd30696d4f76a751d582e35a0a4bb767547f6": ("Floor Lamp", "Master Bedroom"),
}
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
        raise NotConnected("Homebridge isn't connected yet. Connect it in Settings to control lights and plugs from here.")
    with _lock:
        if _token["value"] and _token["expires"] > time.time() + 60:
            return _token["value"]
        try:
            r = _call("POST", "/api/auth/login", {"username": creds["username"], "password": creds["password"]})
        except urllib.error.HTTPError as e:
            raise NotConnected("Homebridge turned down the saved login, so lights and plugs can't be controlled from here. Update the login in Settings.") from e
        _token["value"] = r["access_token"]
        _token["expires"] = time.time() + int(r.get("expires_in", 3600))
        return _token["value"]


def login_state():
    """For the devices record: "ok", "rejected" (the saved login was turned down), "not_set", or None when
    Homebridge didn't answer (its service record says why)."""
    try:
        _login()
        return "ok"
    except NotConnected:
        return "not_set" if not auth.get("homebridge_login") else "rejected"
    except (OSError, ValueError, KeyError):
        return None


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
    return freshness.observe("home", 20, _accessories)


def _accessories():
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
        uid = a.get("uniqueId")
        alias_name, alias_room = ALIASES.get(uid, (None, None))
        name = alias_name or (a.get("serviceName") or (a.get("accessoryInformation") or {}).get("Name") or "Accessory")[:60]
        room = alias_room or ((a.get("accessoryInformation") or {}).get("Manufacturer") or "")[:40]
        out.append({
            "id": uid,
            "name": name,
            "room": room,
            "kind": {"Lightbulb": "light", "Outlet": "plug", "Switch": "switch"}.get(kind, "fan"),
            # A value Homebridge didn't report is unknown, never Off: None, and the tile says "No answer".
            "on": None if not on or on.get("value") is None else bool(on.get("value")),
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
