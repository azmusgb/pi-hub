"""The Mac's way into the print lab: the hub's own lab key, sent as X-Hub-Mac-Key and nothing else.
The Pi keeps only the key's SHA-256; with no hash on file, every Mac route is refused."""
import hashlib
import hmac
import os

from fastapi import HTTPException, Request

KEY_HASH_FILE = os.environ.get("HUB_LAB_KEY_HASH_FILE", "/etc/pi-hub/secrets/lab_mac_key.sha256")


def _expected():
    try:
        with open(KEY_HASH_FILE) as f:
            return f.read().strip().lower()
    except OSError:
        return ""


def mac_key_ok(request: Request) -> bool:
    key = request.headers.get("x-hub-mac-key")
    expected = _expected()  # read each time, so a new key takes effect without a restart
    if not key or not expected:
        return False
    return hmac.compare_digest(hashlib.sha256(key.encode()).hexdigest().encode(), expected.encode())


def require_mac(request: Request) -> None:
    if not mac_key_ok(request):
        raise HTTPException(401, "The Mac's lab key is missing or wrong.")
