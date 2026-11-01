"""Who may do what. Viewing is open on the home network; everything that acts, and settings, needs the owner: one of
the owner's own devices (hub/devices.py) or the owner password, which is set once with a setup code from the Pi."""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time

from fastapi import HTTPException, Request

from . import db, devices

COOKIE = "hub_session"
OWNER_LIFETIME = 30 * 86400
# Only the owner signs in now. "household" stays for what acts without a sign-in (the Siri Shortcut keys log as it);
# "kid" is what routes ask for when switching lights and plugs is enough. The owner passes every check.
RANK = {"none": 0, "kid": 1, "household": 2, "owner": 3}
MAX_TRIES, LOCK_SECONDS = 5, 600
GATE_CODE_SECONDS = 30

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, device TEXT
);
CREATE TABLE IF NOT EXISTS action_log (ts INTEGER NOT NULL, role TEXT, device TEXT, action TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS shortcut_keys (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, last_used INTEGER
);
CREATE TABLE IF NOT EXISTS gate_codes (
  code_hash TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, host TEXT NOT NULL, expires INTEGER NOT NULL
);
"""

_tries = {}
_tries_lock = threading.Lock()


def _ready():
    db.conn().executescript(SCHEMA)


def get(key, default=None):
    _ready()
    row = db.one("SELECT value FROM settings WHERE key = ?", key)
    return json.loads(row["value"]) if row else default


def put(key, value):
    _ready()
    db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
           key, json.dumps(value))


def _hash(secret, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(secret.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return {"salt": salt.hex(), "hash": digest.hex()}


def _check(secret, stored):
    if not stored:
        return False
    digest = hashlib.scrypt(secret.encode(), salt=bytes.fromhex(stored["salt"]), n=2 ** 14, r=8, p=1, dklen=32)
    return hmac.compare_digest(digest.hex(), stored["hash"])


def setup_needed():
    return get("owner_password") is None


def _setup_code():
    try:
        with open(os.environ.get("HUB_SETUP_CODE_FILE", "/etc/pi-hub/setup-code")) as f:
            return f.read().strip()
    except OSError:
        return None


def valid_password(pw):
    return isinstance(pw, str) and 8 <= len(pw) <= 128


def setup(code, owner_password):
    if not setup_needed():
        raise PermissionError("The hub is already set up.")
    expected = _setup_code()
    if not expected or not hmac.compare_digest(str(code).strip().upper(), expected.upper()):
        raise PermissionError("That setup code isn't right.")
    if not valid_password(owner_password):
        raise ValueError("The owner password needs at least 8 characters.")
    put("owner_password", _hash(owner_password))


def set_owner_password(pw):
    if not valid_password(pw):
        raise ValueError("The owner password needs at least 8 characters.")
    put("owner_password", _hash(pw))


def _locked(who):
    with _tries_lock:
        t = _tries.get(who)
        return bool(t and t["count"] >= MAX_TRIES and time.time() - t["first"] < LOCK_SECONDS)


def _fail(who):
    with _tries_lock:
        t = _tries.get(who)
        if not t or time.time() - t["first"] > LOCK_SECONDS:
            t = _tries[who] = {"count": 0, "first": time.time()}
        t["count"] += 1


def sign_in(who, device, password):
    """Returns (token, "owner"). `who` is the caller's address, used for the try limit."""
    if _locked(who) or _locked("*"):
        raise PermissionError("Too many wrong tries. Wait 10 minutes and try again.")
    if not _check(password, get("owner_password")):
        _fail(who)
        _fail("*")
        raise PermissionError("That password isn't right.")
    with _tries_lock:
        _tries.pop(who, None)
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    _ready()
    db.run("INSERT INTO sessions (token_hash, role, created, expires, device) VALUES (?, 'owner', ?, ?, ?)",
           hashlib.sha256(token.encode()).hexdigest(), now, now + OWNER_LIFETIME, (device or "")[:80])
    # Household and kid sign-ins from the PIN days are refused by session(); this clears their rows.
    db.run("DELETE FROM sessions WHERE expires < ? OR role IN ('household', 'kid')", now)
    return token, "owner"


def session(token, gate=False):
    """The hub session for a token; with gate=True, the front gate's token instead. Neither works as the other."""
    if not token:
        return None
    _ready()
    row = db.one("SELECT role, device, expires FROM sessions WHERE token_hash = ?", hashlib.sha256(token.encode()).hexdigest())
    if not row or row["expires"] < time.time() or (row["role"] == "gate") != gate:
        return None
    if row["role"] not in ("owner", "gate"):
        return None  # a household or kid sign-in made with the old PIN: it ended when the PIN did
    return row


def gate_session(owner_token):
    """A token only the front gate accepts (role "gate"): it is the cookie every *.home.arpa tool sees, so it must
    never work as a hub session. It belongs to the owner sign-in that made it (device "gate:<that session's hash>"),
    ends when that sign-in ends, and goes when it signs out. None when owner_token isn't a live owner session."""
    owner = session(owner_token)
    if not owner or owner["role"] != "owner":
        return None
    token = secrets.token_urlsafe(32)
    db.run("INSERT INTO sessions (token_hash, role, created, expires, device) VALUES (?, 'gate', ?, ?, ?)",
           hashlib.sha256(token.encode()).hexdigest(), int(time.time()), owner["expires"],
           "gate:" + hashlib.sha256(owner_token.encode()).hexdigest())
    return token


def gate_code(owner_token, host):
    """A one-time code (good GATE_CODE_SECONDS) that `host`'s tool trades for its own gate token. Browsers won't share
    a cookie across *.home.arpa, so each tool redeems this on its own host. None when owner_token isn't a live owner."""
    owner = session(owner_token)
    if not owner or owner["role"] != "owner":
        return None
    code = secrets.token_urlsafe(32)
    now = int(time.time())
    db.run("INSERT INTO gate_codes (code_hash, owner_hash, host, expires) VALUES (?, ?, ?, ?)",
           hashlib.sha256(code.encode()).hexdigest(), hashlib.sha256(owner_token.encode()).hexdigest(), host,
           now + GATE_CODE_SECONDS)
    db.run("DELETE FROM gate_codes WHERE expires < ?", now)
    return code


def redeem_gate_code(code, host):
    """Spends a gate code for a new gate token, same as gate_session makes. A code is refused, and kept, on any other
    host; on its own host it is spent whatever follows. None when expired or its owner sign-in has ended."""
    if not code:
        return None
    _ready()
    h = hashlib.sha256(code.encode()).hexdigest()
    row = db.one("SELECT owner_hash, host, expires FROM gate_codes WHERE code_hash = ?", h)
    if not row or row["host"] != host:
        return None
    if db.run("DELETE FROM gate_codes WHERE code_hash = ?", h).rowcount != 1:
        return None  # a concurrent redeem spent it first
    now = int(time.time())
    owner = db.one("SELECT role, expires FROM sessions WHERE token_hash = ?", row["owner_hash"])
    if row["expires"] < now or not owner or owner["role"] != "owner" or owner["expires"] < now:
        return None
    token = secrets.token_urlsafe(32)
    db.run("INSERT INTO sessions (token_hash, role, created, expires, device) VALUES (?, 'gate', ?, ?, ?)",
           hashlib.sha256(token.encode()).hexdigest(), now, owner["expires"], "gate:" + row["owner_hash"])
    return token


def sign_out(token):
    """Ends a session; for an owner sign-in, also every gate token and unspent gate code it made."""
    if token:
        _ready()
        h = hashlib.sha256(token.encode()).hexdigest()
        db.run("DELETE FROM gate_codes WHERE owner_hash = ?", h)
        db.run("DELETE FROM sessions WHERE token_hash = ? OR (role = 'gate' AND device = ?)", h, "gate:" + h)


def allowed(role, need):
    return RANK.get(role or "none", 0) >= RANK[need]


def who(request: Request):
    """The cookie sign-in first; else, one of the owner's own Tailscale devices is the owner (hub/devices.py)."""
    s = session(request.cookies.get(COOKIE))
    if s:
        return s["role"], s["device"]
    name = devices.owner_device(request)
    return ("owner", name) if name else ("none", "")


def need(request: Request, role):
    have, device = who(request)
    if not allowed(have, role):
        raise HTTPException(401, "Sign in as the owner first.")
    return have, device


def log(role, device, action, result):
    _ready()
    db.run("INSERT INTO action_log (ts, role, device, action, result) VALUES (?, ?, ?, ?, ?)",
           int(time.time()), role, (device or "")[:80], action, result[:200])
    db.run("DELETE FROM action_log WHERE ts < ?", int(time.time()) - 90 * 86400)


def recent_actions(limit=30):
    _ready()
    return db.rows("SELECT ts, role, device, action, result FROM action_log ORDER BY ts DESC, rowid DESC LIMIT ?", limit)


# ---- Keys for Siri Shortcuts: one per phone, shown once, stored only as a hash ----

def add_shortcut_key(name):
    name = " ".join(str(name or "").split())[:30] or "Phone"
    _ready()
    if db.one("SELECT COUNT(*) AS n FROM shortcut_keys")["n"] >= 12:
        raise ValueError("That's the most Shortcut keys the hub keeps. Remove one first.")
    key = "hub_" + secrets.token_urlsafe(24)
    db.run("INSERT INTO shortcut_keys (name, key_hash, created) VALUES (?, ?, ?)",
           name, hashlib.sha256(key.encode()).hexdigest(), int(time.time()))
    return key


def shortcut_keys():
    _ready()
    return db.rows("SELECT id, name, created, last_used FROM shortcut_keys ORDER BY created")


def remove_shortcut_key(key_id):
    _ready()
    db.run("DELETE FROM shortcut_keys WHERE id = ?", key_id)


def shortcut_check(header):
    """Returns the key's name for a valid 'Bearer hub_…' header, else None."""
    if not header or not header.startswith("Bearer hub_"):
        return None
    _ready()
    row = db.one("SELECT id, name FROM shortcut_keys WHERE key_hash = ?", hashlib.sha256(header[7:].strip().encode()).hexdigest())
    if row:
        db.run("UPDATE shortcut_keys SET last_used = ? WHERE id = ?", int(time.time()), row["id"])
        return row["name"]
    return None
