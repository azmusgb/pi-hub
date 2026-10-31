"""Add a movie from the site (Media › Add a movie).

The browser sends the file in CHUNK-sized pieces, each with the offset it starts at; the hub appends it to a hidden
`.uploading-<id><ext>` file in the PC's Movies share (mounted on the Pi), which Plex ignores. A dropped connection
costs one chunk: the page asks for the offset the hub has and continues. When the last byte arrives the file is renamed
to "Title (Year).ext" (never over an existing file) and Plex rescans. Abandoned uploads are removed after a day.
Owner only."""
import json
import os
import re
import secrets
import time
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import auth, sources

router = APIRouter(prefix="/api/movies/uploads")

MOVIES_DIR = Path(os.environ.get("HUB_MOVIES_DIR", "/mnt/windows-movies"))
STATE_DIR = Path(os.environ.get("HUB_UPLOAD_STATE", "/var/lib/pi-hub/uploads"))
CHUNK = 8 * 1024 * 1024  # under the gate's per-request cap, and one chunk is all a dropped connection costs
MAX_SIZE = 20 * 1024 ** 3
# The share is mounted with nofail: with the PC off, the folder is an empty local directory on the SD card. Writing
# there would fill the Pi, so the folder must be a live mount.
REQUIRE_MOUNT = os.environ.get("HUB_MOVIES_REQUIRE_MOUNT", "1") != "0"
VIDEO = {".mkv", ".mp4", ".m4v", ".avi"}
STALE_SECONDS = 24 * 3600
ID_RE = re.compile(r"^[0-9a-f]{16}$")
# Release tags that follow the year in a download's name ("1080p WEB-DL HEVC x265 5.1 BONE").
_YEAR = re.compile(r"^(?P<title>.+?)[\s._(\[-]+(?P<year>(?:19|20)\d{2})(?:[\s._)\]-]|$)")


def guess(filename: str):
    """Title and year from a download's file name; year None when there isn't one."""
    stem = Path(filename).stem
    m = _YEAR.match(stem)
    if m:
        return clean_title(m.group("title").replace(".", " ").replace("_", " ")), int(m.group("year"))
    return clean_title(stem.replace("_", " ")), None


def clean_title(title) -> str:
    """A title safe as a file name on Windows and the Pi: no path parts, reserved characters or control characters."""
    t = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", str(title or ""))
    t = re.sub(r"\.{2,}", " ", t)          # no '..' left to climb with
    t = re.sub(r"\s+", " ", t).strip(" .")  # Windows drops trailing dots and spaces
    return t[:120]


def _state(uid: str) -> Path:
    return STATE_DIR / f"{uid}.json"


def _partial(uid: str, ext: str) -> Path:
    return MOVIES_DIR / f".uploading-{uid}{ext}"


def _load(uid: str) -> dict:
    if not ID_RE.match(uid or ""):
        raise HTTPException(404, "No such upload.")
    try:
        return json.loads(_state(uid).read_text())
    except (OSError, ValueError):
        raise HTTPException(404, "No such upload (finished, cancelled or expired).")


def _have(up: dict) -> int:
    try:
        return _partial(up["id"], up["ext"]).stat().st_size
    except FileNotFoundError:
        return 0


def _share_ready() -> None:
    if not MOVIES_DIR.is_dir() or (REQUIRE_MOUNT and not os.path.ismount(MOVIES_DIR)):
        raise HTTPException(503, "The PC's Movies folder isn't reachable. Is the PC on? Try again later.")


def sweep(now=None) -> None:
    """Remove uploads untouched for a day: their state and their hidden partial file."""
    now = now or time.time()
    if not STATE_DIR.is_dir():
        return
    for st in STATE_DIR.glob("*.json"):
        try:
            if now - st.stat().st_mtime < STALE_SECONDS:
                continue
            up = json.loads(st.read_text())
            _partial(up["id"], up["ext"]).unlink(missing_ok=True)
        except (OSError, ValueError, KeyError):
            pass
        st.unlink(missing_ok=True)


def refresh_plex() -> bool:
    try:
        req = urllib.request.Request(f"{sources.PLEX_URL}/library/sections/all/refresh",
                                     headers={"X-Plex-Token": sources._plex_token()})
        urllib.request.urlopen(req, timeout=10).close()
        return True
    except Exception:
        return False  # the file is in place; Plex's own scan finds it later


@router.post("")
async def start(request: Request):
    who, device = auth.need(request, "owner")
    try:
        b = await request.json()
    except ValueError:
        raise HTTPException(400, "Send JSON.")
    name = str(b.get("filename") or "")
    ext = Path(name).suffix.lower()
    if ext not in VIDEO:
        raise HTTPException(400, f"Only video files ({', '.join(sorted(VIDEO))}) can be added.")
    size = b.get("size")
    if not isinstance(size, int) or size <= 0 or size > MAX_SIZE:
        raise HTTPException(400, "The file size must be between 1 byte and 20 GB.")
    title = clean_title(b.get("title"))
    if not title:
        raise HTTPException(400, "The title is empty.")
    year = b.get("year")
    if year is not None and (not isinstance(year, int) or not 1888 <= year <= 2100):
        raise HTTPException(400, "The year must be between 1888 and 2100.")
    _share_ready()
    sweep()
    final = f"{title} ({year}){ext}" if year else f"{title}{ext}"
    if (MOVIES_DIR / final).exists():
        raise HTTPException(409, f'"{final}" is already in the library.')
    uid = secrets.token_hex(8)
    up = {"id": uid, "ext": ext, "size": size, "final": final, "started": int(time.time())}
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    _partial(uid, ext).touch()
    _state(uid).write_text(json.dumps(up))
    auth.log(who, device, "movie upload", f"started {final} ({size} bytes)")
    return {"id": uid, "offset": 0, "size": size, "chunk": CHUNK, "final": final}


@router.get("/{uid}")
def status(uid: str, request: Request):
    auth.need(request, "owner")
    up = _load(uid)
    return {"id": uid, "offset": _have(up), "size": up["size"], "chunk": CHUNK, "final": up["final"], "done": False}


@router.put("/{uid}")
async def chunk(uid: str, offset: int, request: Request):
    who, device = auth.need(request, "owner")
    up = _load(uid)
    _share_ready()
    have = _have(up)
    if offset != have:
        # Never write a chunk twice or leave a gap: the page continues from what the hub has.
        return JSONResponse({"detail": "Out of step; continue from offset.", "offset": have}, status_code=409)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > CHUNK:
        raise HTTPException(413, f"A piece can be at most {CHUNK} bytes.")
    part = _partial(uid, up["ext"])
    wrote = 0
    with open(part, "ab") as f:
        async for data in request.stream():
            wrote += len(data)
            if wrote > CHUNK or have + wrote > up["size"]:
                f.truncate(have)  # drop the oversize piece entirely
                raise HTTPException(413, f"A piece can be at most {CHUNK} bytes and the file {up['size']} bytes.")
            f.write(data)
        f.flush()
        os.fsync(f.fileno())
    _state(uid).touch()  # still in progress: not swept
    have += wrote
    if have < up["size"]:
        return {"id": uid, "offset": have, "size": up["size"], "done": False}
    final = MOVIES_DIR / up["final"]
    if final.exists():
        raise HTTPException(409, f'"{up["final"]}" appeared in the library meanwhile; the upload is kept for a day.')
    os.replace(part, final)
    _state(uid).unlink(missing_ok=True)
    rescanned = refresh_plex()
    auth.log(who, device, "movie upload", f"added {up['final']}")
    return {"id": uid, "offset": have, "size": up["size"], "done": True, "final": up["final"], "rescanned": rescanned}


@router.delete("/{uid}")
def cancel(uid: str, request: Request):
    who, device = auth.need(request, "owner")
    up = _load(uid)
    _partial(uid, up["ext"]).unlink(missing_ok=True)
    _state(uid).unlink(missing_ok=True)
    auth.log(who, device, "movie upload", f"cancelled {up['final']}")
    return {"ok": True}
