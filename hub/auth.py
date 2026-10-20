"""Who may do what. Viewing is open on the home network; actions need the household PIN;
settings need the owner password. Both are set once with a setup code from the Pi."""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time

from . import db

COOKIE = "hub_session"
LIFETIME = {"kid": 30 * 86400, "household": 30 * 86400, "owner": 12 * 3600}
# kid: switch lights and plugs; household: everything that acts (fixes, rules, filament, Ask); owner: settings.
RANK = {"none": 0, "kid": 1, "household": 2, "owner": 3}
PERSON_ROLE = {"adult": "household", "kid": "kid"}
MAX_TRIES, LOCK_SECONDS = 5, 600

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, device TEXT
);
CREATE TABLE IF NOT EXISTS action_log (ts INTEGER NOT NULL, role TEXT, device TEXT, action TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, pin TEXT NOT NULL, created INTEGER NOT NULL
);
"""

_tries = {}
_tries_lock = threading.Lock()


def _ready():
    db.conn().executescript(SCHEMA)
    if "person_id" not in {r["name"] for r in db.rows("PRAGMA table_info(sessions)")}:
        db.conn().execute("ALTER TABLE sessions ADD COLUMN person_id INTEGER")


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


def valid_pin(pin):
    return isinstance(pin, str) and len(pin) == 6 and pin.isdigit()


def valid_password(pw):
    return isinstance(pw, str) and 8 <= len(pw) <= 128


def setup(code, owner_password, pin):
    if not setup_needed():
        raise PermissionError("The hub is already set up.")
    expected = _setup_code()
    if not expected or not hmac.compare_digest(str(code).strip().upper(), expected.upper()):
        raise PermissionError("That setup code isn't right.")
    if not valid_password(owner_password):
        raise ValueError("The owner password needs at least 8 characters.")
    if not valid_pin(pin):
        raise ValueError("The household PIN needs exactly 6 digits.")
    put("owner_password", _hash(owner_password))
    put("household_pin", _hash(pin))


def set_pin(pin):
    if not valid_pin(pin):
        raise ValueError("The household PIN needs exactly 6 digits.")
    put("household_pin", _hash(pin))
    db.run("DELETE FROM sessions WHERE role = 'household' AND person_id IS NULL")


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


def people():
    _ready()
    return db.rows("SELECT id, name, kind, created FROM people ORDER BY name")


def _pin_taken(pin):
    _ready()
    if _check(pin, get("household_pin")):
        return True
    return any(_check(pin, json.loads(r["pin"])) for r in db.rows("SELECT pin FROM people"))


def add_person(name, kind, pin):
    name = " ".join(str(name or "").split())[:30]
    if not name:
        raise ValueError("Give the person a name.")
    if kind not in PERSON_ROLE:
        raise ValueError("Choose adult or kid.")
    if not valid_pin(pin):
        raise ValueError("Their PIN needs exactly 6 digits.")
    if _pin_taken(pin):
        raise ValueError("Someone already uses that PIN. Choose another.")
    if db.one("SELECT COUNT(*) AS n FROM people")["n"] >= 12:
        raise ValueError("That's the most people the hub keeps.")
    return db.run("INSERT INTO people (name, kind, pin, created) VALUES (?, ?, ?, ?)",
                  name, kind, json.dumps(_hash(pin)), int(time.time())).lastrowid


def remove_person(person_id):
    _ready()
    db.run("DELETE FROM sessions WHERE person_id = ?", person_id)
    db.run("DELETE FROM people WHERE id = ?", person_id)


def sign_in(who, device, pin=None, password=None):
    """Returns (token, role). `who` is the caller's address, used for the try limit."""
    if _locked(who) or _locked("*"):
        raise PermissionError("Too many wrong tries. Wait 10 minutes and try again.")
    person = None
    if password is not None:
        ok, role = _check(password, get("owner_password")), "owner"
    else:
        ok, role = _check(str(pin or ""), get("household_pin")), "household"
        if not ok:
            _ready()
            for r in db.rows("SELECT id, name, kind, pin FROM people"):
                if _check(str(pin or ""), json.loads(r["pin"])):
                    ok, role, person = True, PERSON_ROLE[r["kind"]], r
                    break
    if not ok:
        _fail(who)
        _fail("*") if role == "owner" else None
        raise PermissionError("That password isn't right." if role == "owner" else "That PIN isn't right.")
    with _tries_lock:
        _tries.pop(who, None)
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    _ready()
    label = f"{person['name']} on {device}" if person else device
    db.run("INSERT INTO sessions (token_hash, role, created, expires, device, person_id) VALUES (?, ?, ?, ?, ?, ?)",
           hashlib.sha256(token.encode()).hexdigest(), role, now, now + LIFETIME[role], (label or "")[:80],
           person["id"] if person else None)
    db.run("DELETE FROM sessions WHERE expires < ?", now)
    return token, role


def session(token):
    if not token:
        return None
    _ready()
    row = db.one("SELECT role, device, expires FROM sessions WHERE token_hash = ?", hashlib.sha256(token.encode()).hexdigest())
    if not row or row["expires"] < time.time():
        return None
    return row


def sign_out(token):
    if token:
        db.run("DELETE FROM sessions WHERE token_hash = ?", hashlib.sha256(token.encode()).hexdigest())


def allowed(role, need):
    return RANK.get(role or "none", 0) >= RANK[need]


def log(role, device, action, result):
    _ready()
    db.run("INSERT INTO action_log (ts, role, device, action, result) VALUES (?, ?, ?, ?, ?)",
           int(time.time()), role, (device or "")[:80], action, result[:200])
    db.run("DELETE FROM action_log WHERE ts < ?", int(time.time()) - 90 * 86400)


def recent_actions(limit=30):
    _ready()
    return db.rows("SELECT ts, role, device, action, result FROM action_log ORDER BY ts DESC, rowid DESC LIMIT ?", limit)
