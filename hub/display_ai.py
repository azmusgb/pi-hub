"""Local AI's AI-only display cards, fetched server-to-server (display on Pi Hub, step 1).

Local AI answers /api/display/ai-cards for the hub key in X-LocalAI-Hub-Key. This module never raises and never
holds up the household: any failure (no key, timeout, refused, non-200, non-JSON, wrong shape) is "unavailable"."""
import json
import os
import ssl
import threading
import urllib.error
import urllib.request

URL = os.environ.get("HUB_LOCALAI_URL", "https://10.0.0.21").rstrip("/")
KEY_FILE = os.environ.get("HUB_LOCALAI_KEY_FILE", "/etc/pi-hub/secrets/localai_hub_key")
CA_FILE = os.environ.get("HUB_LOCALAI_CA_FILE", "/etc/pi-hub/secrets/localai-ca.crt")
TTL = 15      # seconds a good or bad answer is reused
BUDGET = 3    # seconds cards() may take, however Local AI behaves
FORWARD_PATHS = {"/api/display/approvals", "/api/display/approvals/decide", "/api/display/ask"}

_cache = (0.0, None)  # (at, value)


def _key():
    try:
        with open(KEY_FILE) as f:
            return f.read().strip()
    except OSError:
        return ""


def _context():
    """Verify against Local AI's CA when it is installed; otherwise skip verification for this host only."""
    if not URL.startswith("https"):
        return None
    if os.path.exists(CA_FILE):
        return ssl.create_default_context(cafile=CA_FILE)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # Local AI uses its own certificate on the home network
    return ctx


def _fetch(url, key, timeout=BUDGET):
    req = urllib.request.Request(url, headers={"X-LocalAI-Hub-Key": key, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_context()) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""


def _empty(now):
    return {"available": False, "checkedAt": int(now), "cards": [], "approvals": {"count": 0, "speech": ""},
            "images": [], "messages": []}


def _valid(d):
    a = d.get("approvals") if isinstance(d, dict) else None
    return (isinstance(a, dict) and isinstance(a.get("count"), int) and not isinstance(a.get("count"), bool)
            and isinstance(d.get("cards"), list) and isinstance(d.get("images"), list)
            and isinstance(d.get("messages"), list))


def _load(now, fetch):
    key = _key()
    if not key:
        return _empty(now)
    box = []

    def run():
        try:
            box.append(fetch(f"{URL}/api/display/ai-cards", key))
        except Exception:
            pass
    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(BUDGET)
    if not box or not isinstance(box[0], tuple) or box[0][0] != 200:
        return _empty(now)
    try:
        d = json.loads(box[0][1])
    except Exception:
        return _empty(now)
    if not _valid(d):
        return _empty(now)
    return {"available": True, "checkedAt": int(now), "cards": d["cards"],
            "approvals": {"count": d["approvals"]["count"], "speech": str(d["approvals"].get("speech") or "")},
            "images": d["images"], "messages": d["messages"]}


def cards(now, fetch=None):
    global _cache
    at, value = _cache
    if value is not None and 0 <= now - at < TTL:
        return value
    value = _load(now, fetch or _fetch)
    _cache = (now, value)
    return value


def _err(status, msg):
    return status, json.dumps({"error": msg}).encode(), "application/json"


def forward(method, path, *, query="", body=None, timeout=10):
    """Pass one display request through to Local AI with the hub key: (status, body, content type)."""
    if path not in FORWARD_PATHS and not path.startswith("/api/images/view"):
        return _err(403, "not forwarded")
    key = _key()
    if not key:
        return _err(502, "Local AI hub key isn't set up")
    url = f"{URL}{path}" + (f"?{query}" if query else "")
    headers = {"X-LocalAI-Hub-Key": key}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_context()) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "application/json")
    except Exception:
        return _err(502, "Local AI isn't answering")
