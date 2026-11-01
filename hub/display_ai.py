"""Local AI's AI-only display cards, fetched server-to-server (display on Pi Hub, step 1).

Local AI answers /api/display/ai-cards for the hub key in X-LocalAI-Hub-Key. This module never raises and never
holds up the household: any failure (no key, timeout, refused, non-200, non-JSON, wrong shape) is "unavailable"."""
import json
import math
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
METHODS = {"/api/display/approvals/decide": "POST"}  # every other forwarded path is GET only
ANSWER_MAX = 256 * 1024  # bytes read of an ai-cards, approvals or Ask answer; more is "unavailable" (pictures pass their own)
_TEST_ALLOW_HTTP = False  # tests only (a local plain-HTTP fake); nothing in production sets it, so the key needs HTTPS

_cache = (0.0, None)  # (at, value)


def _key():
    try:
        with open(KEY_FILE) as f:
            return f.read().strip()
    except OSError:
        return ""


def _https():
    return URL.lower().startswith("https://")


def _tls_ok():
    """Fail closed: the hub key goes only over HTTPS (any case), and only once Local AI's CA is installed to verify it.
    A plain http:// URL is "unavailable" and the key is never sent (tests alone may lift that, via _TEST_ALLOW_HTTP)."""
    if _https():
        return os.path.exists(CA_FILE)
    return _TEST_ALLOW_HTTP and URL.lower().startswith("http://")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A 3xx comes back as itself (an HTTPError): following it would send the hub key wherever it points."""

    def redirect_request(self, *args, **kwargs):
        return None


def _opener():
    handlers = [_NoRedirect()]
    if _https():
        handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=CA_FILE)))
    return urllib.request.build_opener(*handlers)


def _read(stream, cap):
    """At most cap + 1 bytes, so an answer past the cap is seen without ever holding more."""
    return stream.read(cap + 1) if stream is not None else b""


def _fetch(url, key, timeout=BUDGET):
    req = urllib.request.Request(url, headers={"X-LocalAI-Hub-Key": key, "Accept": "application/json"})
    try:
        with _opener().open(req, timeout=timeout) as r:
            data = _read(r, ANSWER_MAX)
            return (502, b"") if len(data) > ANSWER_MAX else (r.status, data)
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


def _number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _messages(messages):
    """Only banners the feed can order: objects whose `at` and `seq` are real numbers."""
    return [m for m in messages if isinstance(m, dict) and _number(m.get("at")) and _number(m.get("seq"))]


def _images(images):
    """Only pictures with an address, so the feed's numbering and the images route's always agree."""
    return [i for i in images if isinstance(i, dict) and isinstance(i.get("imageUrl"), str) and i["imageUrl"]]


def _load(now, fetch):
    key = _key()
    if not key or not _tls_ok():
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
    if not box or not isinstance(box[0], tuple) or box[0][0] != 200 or len(box[0][1]) > ANSWER_MAX:
        return _empty(now)
    try:
        d = json.loads(box[0][1])
    except Exception:
        return _empty(now)
    if not _valid(d):
        return _empty(now)
    return {"available": True, "checkedAt": int(now), "cards": d["cards"],
            "approvals": {"count": d["approvals"]["count"], "speech": str(d["approvals"].get("speech") or "")},
            "images": _images(d["images"]), "messages": _messages(d["messages"])}


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


def _bad(text):
    return any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in text)


def _allowed(path, query):
    if path not in FORWARD_PATHS and path != "/api/images/view":
        return False
    if any(x in path for x in ("..", "//", "?", "#", "%")) or _bad(path):
        return False
    return not (query and ("#" in query or _bad(query)))


def _too_big():
    return _err(502, "Local AI's answer is too big")


def _send(method, url, headers, body, timeout, cap=ANSWER_MAX):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with _opener().open(req, timeout=timeout) as r:
            status, data, ctype = r.status, _read(r, cap), r.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as e:
        status, data, ctype = e.code, _read(e, cap), (e.headers.get("Content-Type") if e.headers else None) or "application/json"
    return _too_big() if len(data) > cap else (status, data, ctype)


def forward(method, path, *, query="", body=None, timeout=10, fetch=None, cap=ANSWER_MAX):
    """Pass one display request through to Local AI with the hub key: (status, body, content type). Never more than
    `cap` bytes of answer: past it, 502. A 3xx is never followed (it comes back as its status).
    fetch(method, url, headers, body, timeout) -> (status, body, content type) is injectable for tests."""
    if not _allowed(path, query):
        return _err(403, "not forwarded")
    if method != METHODS.get(path, "GET"):
        return _err(405, "method not allowed")
    key = _key()
    if not key:
        return _err(502, "Local AI hub key isn't set up")
    if not _tls_ok():
        return _err(502, "Local AI's address must be https with its CA certificate installed")
    url = f"{URL}{path}" + (f"?{query}" if query else "")
    headers = {"X-LocalAI-Hub-Key": key}
    if body is not None:
        headers["Content-Type"] = "application/json"
    try:
        status, data, ctype = (fetch or (lambda *a: _send(*a, cap=cap)))(method, url, headers, body, timeout)
    except urllib.error.HTTPError as e:
        status, data, ctype = e.code, _read(e, cap), "application/json"
    except Exception:
        return _err(502, "Local AI isn't answering")
    return _too_big() if len(data) > cap else (status, data, ctype)
