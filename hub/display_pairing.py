"""Pairing the workshop display: the owner opens a six-digit code (good ten minutes, five tries), the display trades
it for a key sent as X-Hub-Display-Key. The Pi keeps only the key's SHA-256; a new pairing replaces the old key."""
import hashlib
import hmac
import secrets
import threading
import time

from fastapi import HTTPException, Request

from . import db

CODE_SECONDS = 600
MAX_TRIES = 5
_lock = threading.Lock()
_open = {}  # {"hash": sha256 of the code, "expires": int, "tries": int}; in memory, a restart just closes it

SCHEMA = "CREATE TABLE IF NOT EXISTS display_keys (key_hash TEXT PRIMARY KEY, created INTEGER NOT NULL)"


def _ready():
    db.conn().execute(SCHEMA)


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def start(now):
    code = f"{secrets.randbelow(10 ** 6):06d}"
    expires = int(now) + CODE_SECONDS
    with _lock:
        _open.clear()
        _open.update(hash=_sha(code), expires=expires, tries=0)
    return {"code": code, "expires": expires}


def _code_open(now):
    return bool(_open) and _open["expires"] > now and _open["tries"] < MAX_TRIES


def status():
    _ready()
    row = db.one("SELECT created FROM display_keys ORDER BY created DESC LIMIT 1")
    with _lock:
        open_ = _code_open(time.time())
    return {"paired": bool(row), "paired_at": row["created"] if row else None, "code_open": open_}


def redeem(code, now):
    """A new key for the right open code (spent at once), else None. Five wrong codes close the code."""
    return try_redeem(code, now)[0]


def try_redeem(code, now):
    """(key or None, counted): counted is True when a code was open, so the attempt was a try against it."""
    with _lock:
        if not _code_open(now):
            return None, False
        if not hmac.compare_digest(_sha(str(code or "").strip()), _open["hash"]):
            _open["tries"] += 1
            return None, True
        _open.clear()
    _ready()
    key = "hubd_" + secrets.token_urlsafe(24)[:32]
    db.run("DELETE FROM display_keys")
    db.run("INSERT INTO display_keys (key_hash, created) VALUES (?, ?)", _sha(key), int(now))
    return key, True


def key_ok(request: Request) -> bool:
    if request.headers.get("x-forwarded-proto", "").lower() == "http":
        return False
    key = request.headers.get("x-hub-display-key")
    if not key:
        return False
    _ready()
    return db.one("SELECT 1 AS ok FROM display_keys WHERE key_hash = ?", _sha(key)) is not None


def require(request: Request) -> None:
    if not key_ok(request):
        raise HTTPException(401, "Pair the display first.")
