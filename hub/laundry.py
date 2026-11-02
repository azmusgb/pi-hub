"""The washer, dryer and dishwasher, each read from its maker's cloud. Read-only: the hub never starts or stops a cycle.

- LG washer: LG's own ThinQ Connect API with a personal access token (2 Nov). The community Homebridge plugin's sign-in
  is blocked by LG (403), so laundry doesn't come through Homebridge. The token is made at
  smartsolution.developer.lge.com (ThinQ Connect, Personal Access Token).
- GE dryer: GE SmartHQ, the cloud behind GE's app, with a refresh token from one sign-in on the Mac.
- Bosch dishwasher: Bosch's official Home Connect API, with a refresh token from one device-flow sign-in that asked only
  to identify and monitor appliances.

Each token is kept root:pi-hub 640 like the Plex token, and each source is shown only once its file exists. Without any
of them the hub shows no laundry card at all.
"""
import base64
import json
import math
import os
import threading
import time
import urllib.error
import urllib.parse
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


def _lg_status():
    tok = token()
    if not tok:
        return None
    return sources.cached("thinq_state", STATE_TTL, lambda: _read(tok)) or {
        "available": False, "message": "Laundry isn't answering."}


# ---------- Shared by the GE and Bosch readers: OAuth refresh tokens ----------
_access = {}  # source -> (access token, good until)
_lists = {}  # source -> (when asked, appliance list); asked hourly, only a good answer is kept


def _read_secret(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def _http_json(url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403):
            raise Refused() from e
        raise


def _bearer(source, fetch):
    """A cached access token for source; fetch() returns (token, seconds it lasts)."""
    with _lock:
        tok, until = _access.get(source, ("", 0))
    if tok and time.time() < until:
        return tok
    tok, lasts = fetch()
    with _lock:
        _access[source] = (tok, time.time() + max(60, lasts - 300))
    return tok


def _listed(source, fetch):
    with _lock:
        at, items = _lists.get(source, (0, None))
    if items is None or time.time() - at >= DEVICES_TTL:
        items = fetch()
        with _lock:
            _lists[source] = (time.time(), items)
    return items


def _forget(source):
    with _lock:
        _access.pop(source, None)
        _lists.pop(source, None)


def _machine(source, ident, kind, name, state, left):
    key = f"{source}:{ident}"
    return {"id": key, "kind": kind, "name": name, "state": state, "minutes_left": left,
            "ended_at": _ended_at(key, state, time.time())}


def _kind(word):
    word = str(word or "").lower()
    return "dishwasher" if "dishwasher" in word else "dryer" if "dryer" in word else "washer" if "washer" in word else None


# ---------- GE SmartHQ (the GE Profile dryer) ----------
# GE has no public API. These are the credentials GE's own app uses, as published in gehomesdk (clients/const.py), the
# library Home Assistant's GE integration is built on. The refresh token comes from one sign-in on the Mac; GE hands
# back the same token on every refresh (checked 2 Nov), so the hub never has to write the file.
GE_TOKEN_FILE = os.environ.get("HUB_SMARTHQ_TOKEN_FILE", "/etc/pi-hub/secrets/smarthq_refresh")
GE_LOGIN = "https://accounts.brillion.geappliances.com"
GE_API = "https://api.brillion.geappliances.com"
GE_CLIENT_ID = "564c31616c4f7474434b307435412b4d2f6e7672"
GE_CLIENT_SECRET = "6476512b5246446d452f697154444941387052645938466e5671746e5847593d"
GE_REDIRECT = "brillion.4e617a766474657344444e562b5935566e51324a://oauth/redirect"
# ERD 0x2000, GE's laundry machine state (gehomesdk ErdMachineState): idle, standby, run, pause, end of cycle,
# two kinds of delayed start, delay paused, drain timeout.
GE_STATES = {0: "idle", 1: "idle", 2: "running", 3: "paused", 4: "done", 5: "scheduled", 6: "scheduled",
             7: "scheduled", 8: "fault"}


def ge_machine(erds):
    """One GE machine's ERD values to (state, minutes left). Values are hex strings; 0x2007 is seconds left."""
    rows = erds.get("items", []) if isinstance(erds, dict) else erds if isinstance(erds, list) else []
    values = {str(e.get("erd", "")).lower(): str(e.get("value") or "") for e in rows if isinstance(e, dict)}
    try:
        state = GE_STATES.get(int(values.get("0x2000", ""), 16), "unknown")
    except ValueError:
        return "unknown", None
    try:
        seconds = int(values.get("0x2007", ""), 16)
    except ValueError:
        seconds = 0
    left = math.ceil(seconds / 60) if state in ("running", "paused") and 0 < seconds < 65535 else None
    return state, left


def _ge_token(refresh):
    basic = base64.b64encode(f"{GE_CLIENT_ID}:{GE_CLIENT_SECRET}".encode()).decode()
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": refresh, "client_id": GE_CLIENT_ID,
                                   "client_secret": GE_CLIENT_SECRET, "redirect_uri": GE_REDIRECT}).encode()
    tok = _http_json(f"{GE_LOGIN}/oauth2/token", {"Authorization": "Basic " + basic,
                                                  "Content-Type": "application/x-www-form-urlencoded"}, body)
    return tok["access_token"], int(tok.get("expires_in") or 3600)


def _ge_read(refresh):
    try:
        auth = {"Authorization": "Bearer " + _bearer("smarthq", lambda: _ge_token(refresh))}
        listed = _listed("smarthq", lambda: _http_json(f"{GE_API}/v1/appliance", auth).get("items") or [])
        machines = []
        for a in listed:
            kind, mac = _kind(a.get("type")), a.get("applianceId")
            if not kind or not mac:
                continue
            if str(a.get("online") or "").upper() != "ONLINE":
                state, left = "offline", None
            else:
                state, left = ge_machine(_http_json(f"{GE_API}/v1/appliance/{mac}/erd", auth))
            machines.append(_machine("ge", mac, kind, a.get("nickname") or kind.title(), state, left))
        return {"available": True, "machines": machines}
    except Refused:
        _forget("smarthq")
        return {"available": False, "message": "GE refused the hub's SmartHQ sign-in. Sign in again and save the new token on the Pi."}
    except (OSError, ValueError, KeyError, AttributeError, TypeError):
        return {"available": False, "message": "GE SmartHQ isn't answering."}


def _ge_status():
    refresh = _read_secret(GE_TOKEN_FILE)
    if not refresh:
        return None
    return sources.cached("smarthq_state", STATE_TTL, lambda: _ge_read(refresh)) or {
        "available": False, "message": "GE SmartHQ isn't answering."}


# ---------- Bosch Home Connect (the dishwasher) ----------
# The file holds {"client_id": ..., "refresh_token": ...} from a device-flow sign-in with the IdentifyAppliance and
# Monitor scopes only. The app is private, so no client secret is needed, and Home Connect hands back the same refresh
# token on every refresh (checked 2 Nov).
HC_FILE = os.environ.get("HUB_HOMECONNECT_FILE", "/etc/pi-hub/secrets/homeconnect.json")
HC_API = "https://api.home-connect.com"
HC_ACCEPT = "application/vnd.bsh.sdk.v1+json"
# Home Connect allows 1000 calls a day per app and user. A status read every 3 minutes is 480 a day, plus one more per
# read while a program runs, plus the hourly appliance list.
HC_TTL = 180
HC_STATES = {"Inactive": "idle", "Ready": "idle", "Aborting": "idle", "DelayedStart": "scheduled", "Run": "running",
             "Pause": "paused", "Finished": "done", "ActionRequired": "fault", "Error": "fault"}


def hc_state(status):
    """Home Connect's status list to the card's state word."""
    rows = ((status or {}).get("data") or {}).get("status") or []
    for row in rows:
        if row.get("key") == "BSH.Common.Status.OperationState":
            return HC_STATES.get(str(row.get("value") or "").rsplit(".", 1)[-1], "unknown")
    return "unknown"


def hc_minutes_left(program):
    for o in ((program or {}).get("data") or {}).get("options") or []:
        if o.get("key") == "BSH.Common.Option.RemainingProgramTime" and isinstance(o.get("value"), (int, float)):
            return math.ceil(o["value"] / 60) if o["value"] > 0 else None
    return None


def _hc_token(cfg):
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": cfg["refresh_token"],
                                   "client_id": cfg["client_id"]}).encode()
    tok = _http_json(f"{HC_API}/security/oauth/token", {"Content-Type": "application/x-www-form-urlencoded"}, body)
    return tok["access_token"], int(tok.get("expires_in") or 86400)


def _hc_read(cfg):
    try:
        auth = {"Authorization": "Bearer " + _bearer("homeconnect", lambda: _hc_token(cfg)), "Accept": HC_ACCEPT}
        listed = _listed("homeconnect", lambda: (_http_json(f"{HC_API}/api/homeappliances", auth).get("data") or {})
                         .get("homeappliances") or [])
        machines = []
        for a in listed:
            kind, ha = _kind(a.get("type")), a.get("haId")
            if not kind or not ha:
                continue
            state, left = "offline", None
            if a.get("connected"):
                try:
                    state = hc_state(_http_json(f"{HC_API}/api/homeappliances/{ha}/status", auth))
                except urllib.error.HTTPError:
                    state = "offline"  # 409 while the appliance can't be reached; the others still show
                if state in ("running", "paused"):
                    try:
                        left = hc_minutes_left(_http_json(f"{HC_API}/api/homeappliances/{ha}/programs/active", auth))
                    except urllib.error.HTTPError:
                        left = None  # 404 between programs; the state is still right
            machines.append(_machine("bosch", ha, kind, a.get("name") or kind.title(), state, left))
        return {"available": True, "machines": machines}
    except Refused:
        _forget("homeconnect")
        return {"available": False, "message": "Home Connect refused the hub's sign-in. Approve it again and save the new token on the Pi."}
    except (OSError, ValueError, KeyError, AttributeError, TypeError):
        return {"available": False, "message": "Home Connect isn't answering."}


def _hc_status():
    try:
        cfg = json.loads(_read_secret(HC_FILE) or "null")
    except ValueError:
        cfg = None
    if not isinstance(cfg, dict) or not cfg.get("client_id") or not cfg.get("refresh_token"):
        return None
    return sources.cached("homeconnect_state", HC_TTL, lambda: _hc_read(cfg)) or {
        "available": False, "message": "Home Connect isn't answering."}


ORDER = {"washer": 0, "dryer": 1, "dishwasher": 2}


def status():
    """Every configured source in one card. A source that fails says so without hiding the others."""
    parts = [p for p in (_lg_status(), _ge_status(), _hc_status()) if p]
    if not parts:
        return {"configured": False, "available": False, "machines": []}
    machines = [m for p in parts if p.get("available") for m in p.get("machines") or []]
    machines.sort(key=lambda m: (ORDER.get(m["kind"], 9), m["name"]))
    out = {"configured": True, "available": any(p.get("available") for p in parts), "machines": machines}
    problems = [p["message"] for p in parts if not p.get("available") and p.get("message")]
    if problems:
        out["message"] = " ".join(problems)
    return out
