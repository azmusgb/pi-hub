"""The Mac's way into the print lab: the hub's own lab key, sent as X-Hub-Mac-Key and nothing else.
The Pi keeps only the key's SHA-256; with no hash on file, every Mac route is refused."""
import hashlib
import hmac
import os

from fastapi import HTTPException, Request

KEY_HASH_FILE = os.environ.get("HUB_LAB_KEY_HASH_FILE", "/etc/pi-hub/secrets/lab_mac_key.sha256")


def _expected() -> bytes:
    """The stored SHA-256 as 64 hex characters, or b"" when there is no usable key (missing, unreadable or not hex).
    Never raises, so the file can never turn a lab request into a 500."""
    try:
        with open(KEY_HASH_FILE, "rb") as f:
            raw = f.read(4096).strip().lower()
        bytes.fromhex(raw.decode("ascii"))
        return raw if len(raw) == 64 else b""
    except (OSError, ValueError):
        return b""


def mac_key_ok(request: Request) -> bool:
    if request.headers.get("x-forwarded-proto", "").lower() == "http":
        return False
    key = request.headers.get("x-hub-mac-key")
    expected = _expected()  # read each time, so a new key takes effect without a restart
    if not key or not expected:
        return False
    return hmac.compare_digest(hashlib.sha256(key.encode()).hexdigest().encode(), expected)


def require_mac(request: Request) -> None:
    if not mac_key_ok(request):
        raise HTTPException(401, "The Mac's lab key is missing or wrong.")


def _limit_text(cap: int) -> str:
    return f"{cap // (1024 * 1024)} MB" if cap >= 1024 * 1024 else f"{cap // 1024} KB"


async def read_capped(request: Request, cap: int) -> bytearray:
    """Read the body as it arrives and refuse with 413 as soon as it passes `cap`, never holding more than cap plus one chunk."""
    too_big = HTTPException(413, f"That's too big for the lab (limit {_limit_text(cap)}).")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > cap:
        raise too_big
    buf = bytearray()
    async for chunk in request.stream():
        if len(buf) + len(chunk) > cap:
            raise too_big
        buf += chunk
    return buf
