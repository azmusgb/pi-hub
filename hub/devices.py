"""The owner's own devices (docs/superpowers/specs/2026-11-01-device-owner-design.md): a request from a Tailscale machine
on the owner list is the owner, with no sign-in. Tailscale proves the machine (its `whois` names the node behind a
tailnet address); this module only keeps the list and asks.

The address must be the one Caddy saw: Caddy sends it as X-Hub-Peer with X-Hub-Proxy, a secret only Caddy and the hub
read (/etc/pi-hub/secrets/hub_proxy.env), so no other process on the Pi can name an address. Anything that doesn't
check out (no secret, a wrong one, an address outside 100.64.0.0/10, a whois that fails, a tagged node, another
login) is simply not a device, and the cookie sign-in decides as before."""
import hmac
import http.client
import ipaddress
import json
import os
import socket
import threading
import time
from urllib.parse import quote

from . import db

PEER_HEADER = "x-hub-peer"
SECRET_HEADER = "x-hub-proxy"
TAILNET = ipaddress.ip_network("100.64.0.0/10")
SOCKET = "/var/run/tailscale/tailscaled.sock"
CACHE_SECONDS = 60
MAX_DEVICES = 12

SCHEMA = """
CREATE TABLE IF NOT EXISTS owner_devices (
  stable_id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL, added INTEGER NOT NULL, last_seen INTEGER
);
"""

_cache = {}
_cache_lock = threading.Lock()


def _ready():
    db.conn().executescript(SCHEMA)


def _secret():
    """The shared secret, from HUB_PROXY_SECRET_FILE (an env file: HUB_PROXY_SECRET=…). None when it can't be read."""
    path = os.environ.get("HUB_PROXY_SECRET_FILE", "/etc/pi-hub/secrets/hub_proxy.env")
    try:
        with open(path) as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k == "HUB_PROXY_SECRET" and len(v) >= 32:
                    return v
    except OSError:
        pass
    return None


def peer(request):
    """The tailnet address Caddy saw for this request, or None."""
    secret = _secret()
    sent = request.headers.get(SECRET_HEADER, "")
    if not secret or not sent or not hmac.compare_digest(sent.encode(), secret.encode()):
        return None
    try:
        ip = ipaddress.ip_address(request.headers.get(PEER_HEADER, "").strip())
    except ValueError:
        return None
    return str(ip) if ip.version == 4 and ip in TAILNET else None


class _UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path, timeout):
        super().__init__("local-tailscaled.sock", timeout=timeout)
        self._path = path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self._path)
        self.sock = s


def _whois_raw(addr):
    """tailscaled's own answer for an address (its local API, which any local user may read). Raises on failure."""
    c = _UnixHTTP(os.environ.get("HUB_TAILSCALED_SOCKET", SOCKET), timeout=2)
    try:
        c.request("GET", f"/localapi/v0/whois?addr={quote(addr)}:1", headers={"Host": "local-tailscaled.sock"})
        r = c.getresponse()
        body = r.read(64 * 1024)
        if r.status != 200:
            raise OSError(f"whois answered {r.status}")
        return json.loads(body)
    finally:
        c.close()


def whois(addr):
    """{stable_id, name, login, tagged} for a tailnet address, or None when Tailscale can't say. Cached a minute."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(addr)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    try:
        d = _whois_raw(addr)
        node, user = d.get("Node") or {}, d.get("UserProfile") or {}
        name = (node.get("ComputedName") or node.get("Name") or "").split(".")[0]
        ans = {"stable_id": str(node.get("StableID") or ""), "name": name or "A device",
               "login": str(user.get("LoginName") or ""), "tagged": bool(node.get("Tags"))}
        if not ans["stable_id"] or not ans["login"]:
            ans = None
    except (OSError, ValueError, http.client.HTTPException):
        ans = None
    with _cache_lock:
        _cache[addr] = (now, ans)
    return ans


def this_device(request):
    """What Tailscale says about the device making this request, or None (not over Tailscale, or not provable)."""
    addr = peer(request)
    return whois(addr) if addr else None


def owner_login():
    from . import auth  # auth imports this module
    return auth.get("owner_login")


def owner_device(request):
    """The listed device's name when this request comes from one of the owner's devices, else None."""
    d = this_device(request)
    if not d or d["tagged"] or d["login"] != owner_login():
        return None
    _ready()
    row = db.one("SELECT name, last_seen FROM owner_devices WHERE stable_id = ? AND login = ?", d["stable_id"], d["login"])
    if not row:
        return None
    now = int(time.time())
    if not row["last_seen"] or now - row["last_seen"] > 300:
        db.run("UPDATE owner_devices SET last_seen = ? WHERE stable_id = ?", now, d["stable_id"])
    return row["name"]


def listed():
    _ready()
    return db.rows("SELECT stable_id, name, added, last_seen FROM owner_devices ORDER BY added")


def add(request):
    """Lists the device making this request. The first one also fixes the owner's Tailscale login. Returns its name."""
    from . import auth
    d = this_device(request)
    if not d:
        raise ValueError("This device isn't reaching the hub over Tailscale, so it can't be added. Turn Tailscale on "
                         "and open the hub again.")
    if d["tagged"]:
        raise ValueError("This is a tagged Tailscale machine, not one of your own devices.")
    login = owner_login()
    if login and d["login"] != login:
        raise ValueError(f"This device is signed in to Tailscale as {d['login']}, not {login}.")
    _ready()
    if db.one("SELECT COUNT(*) AS n FROM owner_devices")["n"] >= MAX_DEVICES:
        raise ValueError("That's the most devices the hub keeps. Remove one first.")
    if not login:
        auth.put("owner_login", d["login"])
    now = int(time.time())
    db.run("INSERT INTO owner_devices (stable_id, name, login, added, last_seen) VALUES (?, ?, ?, ?, ?) "
           "ON CONFLICT(stable_id) DO UPDATE SET name = excluded.name, login = excluded.login",
           d["stable_id"], d["name"][:40], d["login"], now, now)
    return d["name"]


def remove(stable_id):
    _ready()
    db.run("DELETE FROM owner_devices WHERE stable_id = ?", str(stable_id))


def forget_cache():
    with _cache_lock:
        _cache.clear()
