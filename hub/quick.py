"""Quick Print (A19): an ordinary STL or 3MF goes from the phone to the X2D. This module owns the job record, the model
upload, the allowed state changes and the storage rules. It never slices (the Mac does, P3), never talks to Bambuddy and
never touches the printer (P6); no page yet (P4). Owner only.

Files live under QUICK_DIR on the SD card: models/, slices/, scratch/<job>/ for a running slice, tmp/ for uploads in
flight. Everything written is counted against one quota; the OS keeps a free-space reserve the quota never uses."""
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import stat
import struct
import time
import zipfile
import zlib
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import auth, db

router = APIRouter(prefix="/api/quick")

QUICK_DIR = Path(os.environ.get("HUB_QUICK_DIR", "/var/lib/pi-hub/quick"))
CHUNK = 8 * 1024 * 1024  # under the gate's per-request cap; one chunk is all a dropped connection costs
MAX_MODEL = 50 * 1024 ** 2
MAX_EXPANDED = 200 * 1024 ** 2  # what a 3MF may unpack to
MAX_ENTRIES = 200
MAX_SLICED = 200 * 1024 ** 2  # a slice reserves this when it is claimed
QUOTA = 4 * 1024 ** 3
RESERVE = 3 * 1024 ** 3  # free space on / that Quick Print never uses
TMP_SECONDS = 3600  # an abandoned upload or scratch folder is removed after an hour
DRAFT_SECONDS = 24 * 3600  # an untouched draft is "abandoned" after a day
SLICED_SECONDS = 7 * 24 * 3600
ID_RE = re.compile(r"^[0-9a-f]{16}$")
KEY_RE = re.compile(r"^[a-z_]{1,40}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
RESERVED_PROJECT = "quick"  # a project name no experiment route accepts; Quick Print's requests use it (P3a)

STATES = ("draft", "ready_to_slice", "queued", "preparing", "slicing", "validating", "sliced", "needs_attention",
          "failed", "canceled", "stale", "staging", "staged", "queued_in_bambuddy", "start_requested",
          "start_accepted", "printing_confirmed", "outcome_uncertain", "finished")
# A19 Q7. `preparing` is the claim of a slice (plan decision 6) and `staging` is Prepare's upload (decision 10).
ALLOWED = {
    "draft": {"ready_to_slice", "canceled"},
    "ready_to_slice": {"queued", "draft", "canceled"},
    "queued": {"preparing", "failed", "canceled"},
    "preparing": {"slicing", "failed", "canceled"},
    "slicing": {"validating", "failed", "canceled"},
    "validating": {"sliced", "needs_attention", "failed", "canceled"},
    "sliced": {"staging", "stale", "queued", "canceled"},
    "needs_attention": {"queued", "canceled"},
    "failed": {"queued", "canceled"},
    "stale": {"queued", "canceled"},
    "canceled": set(),
    "staging": {"staged", "sliced", "failed"},
    "staged": {"queued_in_bambuddy", "sliced", "stale", "canceled"},
    "queued_in_bambuddy": {"start_requested", "staged", "failed"},
    "start_requested": {"start_accepted", "outcome_uncertain", "failed", "staged"},  # staged: Bambuddy refused and the queue item is confirmed gone
    "start_accepted": {"printing_confirmed", "outcome_uncertain", "failed"},
    "printing_confirmed": {"finished", "failed", "outcome_uncertain"},  # from the printer's print-log entry (P8)
    "outcome_uncertain": {"staged", "printing_confirmed", "failed"},
    "finished": set(),
}
# Retention never removes the files of a job in one of these, or with any live reference (Q11, decision 8).
PROTECTED = {"queued", "preparing", "slicing", "validating", "staging", "staged", "queued_in_bambuddy",
             "start_requested", "start_accepted", "printing_confirmed", "outcome_uncertain"}
# Inputs (transform, settings) may change only where no slice is in flight and nothing was started.
EDITABLE = {"draft", "ready_to_slice", "sliced", "needs_attention", "failed", "stale", "staged"}
STALES = {"sliced", "staged"}  # an edit here makes the slice stale

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS quick_jobs (
  id TEXT PRIMARY KEY, state TEXT NOT NULL, name TEXT NOT NULL,
  model_sha256 TEXT NOT NULL, model_file TEXT, model_bytes INTEGER NOT NULL,
  transform TEXT, settings TEXT NOT NULL DEFAULT '{}', request_hash TEXT NOT NULL, sliced_hash TEXT,
  slice_sha256 TEXT, slice_file TEXT, slice_bytes INTEGER, slice_reserved INTEGER NOT NULL DEFAULT 0,
  reason TEXT, file_removed INTEGER NOT NULL DEFAULT 0,
  bambuddy_file_id TEXT, queue_item_id TEXT, hold INTEGER NOT NULL DEFAULT 0, awaiting_cleanup INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quick_jobs_sha ON quick_jobs(model_sha256);
CREATE TABLE IF NOT EXISTS quick_uploads (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, ext TEXT NOT NULL, size INTEGER NOT NULL, started INTEGER NOT NULL,
  touched INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quick_attempts (
  attempt TEXT PRIMARY KEY, job TEXT NOT NULL, generation INTEGER NOT NULL, worker TEXT NOT NULL,
  claimed_at INTEGER NOT NULL, lease_end INTEGER NOT NULL, last_heartbeat INTEGER NOT NULL, phase TEXT NOT NULL,
  studio_version TEXT, request_hash TEXT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0,
  artifact_sha TEXT, artifact_bytes INTEGER, terminal TEXT, cause TEXT, ended_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS quick_attempts_live ON quick_attempts(job) WHERE terminal IS NULL;
CREATE TABLE IF NOT EXISTS quick_workers (
  id TEXT PRIMARY KEY, os TEXT, studio_version TEXT, presets TEXT, phase TEXT, last_seen INTEGER NOT NULL
);
"""
_ready_dbs: set = set()


def ready():
    path = os.environ.get("HUB_DB", "")
    if path not in _ready_dbs:
        db.conn().executescript(DB_SCHEMA)
        db.ensure_columns("quick_jobs", {"slice_info": "TEXT", "outcome": "TEXT"})
        _ready_dbs.add(path)


class QuickError(Exception):
    """A refusal with a status and a reason the page can show."""

    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


def _http(e: QuickError) -> HTTPException:
    return HTTPException(e.status, e.message)


@contextmanager
def _tx():
    """A write transaction, or the caller's own when one is already open (admit runs inside the upload's)."""
    c = db.conn()
    if c.in_transaction:
        yield c
    else:
        with db.transaction() as c2:
            yield c2


# ---- Paths and storage ----------------------------------------------------------------------------------------

def _dir(name: str) -> Path:
    d = QUICK_DIR / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def model_path(job: dict) -> Path | None:
    return QUICK_DIR / "models" / job["model_file"] if job.get("model_file") and not job["file_removed"] else None


def slice_path(job: dict) -> Path | None:
    return QUICK_DIR / "slices" / job["slice_file"] if job.get("slice_file") and not job["file_removed"] else None


def _layer_files(job: dict) -> list[Path]:
    """The layer reader's sidecars (P5) beside a slice; they go with it."""
    p = slice_path(job)
    return [p.with_name(p.name + ext) for ext in (".layers", ".layers.json", ".layers.part")] if p else []


def _tree_bytes(path: Path) -> int:
    total = 0
    if path.is_file():
        return path.stat().st_size
    for p in path.rglob("*") if path.is_dir() else ():
        try:
            if p.is_file() and not p.is_symlink():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def free_bytes() -> int:
    QUICK_DIR.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(QUICK_DIR).free


def usage() -> dict:
    """Bytes Quick Print holds or has promised: finished files, plus for each upload in flight the larger of what it
    declared and what is on disk, plus for each claimed slice the larger of its ceiling and its scratch folder."""
    ready()
    files = _tree_bytes(QUICK_DIR / "models") + _tree_bytes(QUICK_DIR / "slices")
    uploads = sum(max(u["size"], _tree_bytes(QUICK_DIR / "tmp" / f"up-{u['id']}.part"))
                  for u in db.rows("SELECT id, size FROM quick_uploads"))
    slices = sum(max(j["slice_reserved"], _tree_bytes(QUICK_DIR / "scratch" / j["id"]))
                 for j in db.rows("SELECT id, slice_reserved FROM quick_jobs WHERE slice_reserved > 0"))
    used = files + uploads + slices
    return {"used": used, "files": files, "uploads": uploads, "slices": slices, "quota": QUOTA,
            "free": free_bytes(), "reserve": RESERVE}


def _gib(n: int) -> str:
    return f"{n / 1024 ** 3:.1f} GiB"


def admit(need: int) -> None:
    """Make room for `need` more bytes, or raise QuickError(507) saying why. Room is made only by evicting inactive
    jobs' files (see evict); anything in flight stays. Call inside the transaction that records the reservation."""
    u = usage()
    short_quota = u["used"] + need - QUOTA
    short_free = RESERVE + need - u["free"]
    short = max(short_quota, short_free)
    if short > 0:
        evict(short)
        u = usage()
        if u["used"] + need > QUOTA:
            raise QuickError(507, f"Quick Print's storage is full ({_gib(u['used'])} of {_gib(QUOTA)}) and everything "
                                  "in it is in use. Finish or cancel a print first.")
        if u["free"] - need < RESERVE:
            raise QuickError(507, f"The Pi has {_gib(u['free'])} free and keeps {_gib(RESERVE)} for itself, so this "
                                  "can't be stored.")


def sweep(now: float | None = None) -> None:
    """Remove uploads and slice scratch untouched for an hour. Never touches a finished file or an active slice's
    reservation row (only its scratch folder, once it has been idle that long)."""
    ready()
    now = now or time.time()
    from . import quick_worker
    quick_worker.reap()  # a lapsed attempt ends (and frees its reservation) before anything is judged in flight
    for u in db.rows("SELECT id, touched FROM quick_uploads"):
        if now - u["touched"] >= TMP_SECONDS:
            (QUICK_DIR / "tmp" / f"up-{u['id']}.part").unlink(missing_ok=True)
            db.run("DELETE FROM quick_uploads WHERE id = ?", u["id"])
    tmp = QUICK_DIR / "tmp"
    if tmp.is_dir():
        known = {f"up-{r['id']}.part" for r in db.rows("SELECT id FROM quick_uploads")}
        for p in tmp.iterdir():
            try:
                if p.name not in known and now - p.stat().st_mtime >= TMP_SECONDS:
                    p.unlink()
            except OSError:
                pass
    slices = QUICK_DIR / "slices"
    if slices.is_dir():  # layer sidecars (P5): one whose slice is gone, or a half-written one gone cold
        for p in slices.iterdir():
            base = re.sub(r"\.layers(\.json|\.part)?$", "", p.name)
            try:
                if base != p.name and (not (slices / base).exists() or (p.name.endswith(".part") and now - p.stat().st_mtime >= TMP_SECONDS)):
                    p.unlink(missing_ok=True)
            except OSError:
                pass
    scratch = QUICK_DIR / "scratch"
    if scratch.is_dir():
        for p in scratch.iterdir():
            job = db.one("SELECT state FROM quick_jobs WHERE id = ?", p.name)
            try:
                if (not job or job["state"] not in PROTECTED) and now - p.stat().st_mtime >= TMP_SECONDS:
                    shutil.rmtree(p, ignore_errors=True)
            except OSError:
                pass


# ---- Retention ------------------------------------------------------------------------------------------------

def protected(job: dict) -> bool:
    """A job whose files must not be removed: it is in a live state, or something outside refers to it (a Bambuddy
    library file or queue item, a hold, an unfinished clean-up), whatever its state says."""
    return (job["state"] in PROTECTED or bool(job["bambuddy_file_id"]) or bool(job["queue_item_id"])
            or bool(job["hold"]) or bool(job["awaiting_cleanup"]) or job["slice_reserved"] > 0)


def _tier(job: dict, now: float) -> int | None:
    """Eviction order among inactive jobs (decision 8); None = not eligible."""
    if protected(job) or job["file_removed"]:
        return None
    age = now - job["updated"]
    if job["state"] in ("draft", "ready_to_slice") and age >= DRAFT_SECONDS:
        return 1
    if job["state"] in ("canceled", "failed", "needs_attention", "stale"):
        return 2
    if job["state"] == "finished":  
        return 3
    if job["state"] == "sliced" and age >= SLICED_SECONDS:
        return 4
    return None


def evict(need: int, now: float | None = None) -> int:
    """Remove files of inactive jobs, in order, until `need` bytes are freed or none remain. The record, hashes, name and
    outcome stay; the job says its file was removed. Returns bytes freed."""
    ready()
    now = now or time.time()
    jobs = db.rows("SELECT * FROM quick_jobs WHERE file_removed = 0")
    order = sorted((j for j in jobs if _tier(j, now) is not None), key=lambda j: (_tier(j, now), j["updated"]))
    freed = 0
    for j in order:
        if freed >= need:
            break
        with _tx() as c:
            fresh = c.execute("SELECT * FROM quick_jobs WHERE id = ?", (j["id"],)).fetchone()
            if not fresh or _tier(dict(fresh), now) is None:  # became active meanwhile
                continue
            for p in (model_path(j), slice_path(j), *_layer_files(j)):
                if p and p.exists():
                    freed += p.stat().st_size
                    p.unlink(missing_ok=True)
            state = "stale" if j["state"] == "sliced" else "canceled" if j["state"] in ("draft", "ready_to_slice") else j["state"]
            c.execute("UPDATE quick_jobs SET file_removed = 1, state = ?, reason = ?, updated = ? WHERE id = ?",
                      (state, "File removed to make room; a new slice needs the model uploaded again.", int(now), j["id"]))
    return freed


# ---- The job record and its allowed changes ---------------------------------------------------------------------

def request_hash(model_sha256: str, transform, settings: dict) -> str:
    body = json.dumps({"model": model_sha256, "transform": transform, "settings": settings}, sort_keys=True,
                      separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def get(job_id: str) -> dict:
    ready()
    j = db.one("SELECT * FROM quick_jobs WHERE id = ?", job_id) if ID_RE.fullmatch(job_id or "") else None
    if not j:
        raise QuickError(404, "No such Quick Print job.")
    return j


def transition(job_id: str, to: str, *, expect: str | None = None, reason: str | None = None, **fields) -> dict:
    """The one place a job's state changes. Allowed moves only (ALLOWED); `expect` makes it a compare-and-set, so two
    callers can't both move the same job. Staging or starting needs the stored slice still present."""
    ready()
    allowed_fields = {"slice_sha256", "slice_file", "slice_bytes", "slice_reserved", "sliced_hash", "bambuddy_file_id",
                      "queue_item_id", "hold", "awaiting_cleanup", "slice_info", "outcome"}
    if to not in STATES or set(fields) - allowed_fields:
        raise QuickError(500, "Bad state change.")
    with _tx() as c:
        row = c.execute("SELECT * FROM quick_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise QuickError(404, "No such Quick Print job.")
        job = dict(row)
        if expect and job["state"] != expect:
            raise QuickError(409, f"The job is {job['state']}, not {expect}.", state=job["state"])
        if to not in ALLOWED[job["state"]]:
            raise QuickError(409, f"A {job['state']} job can't become {to}.", state=job["state"])
        if to in ("staging", "queued_in_bambuddy", "start_requested") and (
                job["file_removed"] or not job["slice_sha256"] or job["request_hash"] != job["sliced_hash"]):
            raise QuickError(409, "The stored slice isn't current; it needs a new slice.", state=job["state"])
        sets = {"state": to, "updated": int(time.time()), "reason": reason, **fields}
        c.execute(f"UPDATE quick_jobs SET {', '.join(k + ' = ?' for k in sets)} WHERE id = ?", (*sets.values(), job_id))
    return get(job_id)


_UNSET = object()


def set_inputs(job_id: str, *, transform=_UNSET, settings=None) -> dict:
    """Change a job's transform or settings. A slice made from other inputs becomes Stale and can't be staged or started;
    a draft just takes them. While a slice is in flight or after a start, the answer is 409."""
    ready()
    with db.transaction() as c:
        row = c.execute("SELECT * FROM quick_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise QuickError(404, "No such Quick Print job.")
        job = dict(row)
        if job["state"] not in EDITABLE:
            raise QuickError(409, f"A {job['state']} job can't be changed. Cancel it first.", state=job["state"])
        tf = json.loads(job["transform"]) if job["transform"] else None
        st = json.loads(job["settings"])
        if transform is not _UNSET:
            tf = transform
        if settings is not None:
            st = settings
        h = request_hash(job["model_sha256"], tf, st)
        state, reason = job["state"], job["reason"]
        if h != job["request_hash"] and state in STALES:
            state, reason = "stale", "The model, transform or settings changed after this was sliced."
        c.execute("UPDATE quick_jobs SET transform = ?, settings = ?, request_hash = ?, state = ?, reason = ?, "
                  "updated = ? WHERE id = ?", (json.dumps(tf) if tf is not None else None, json.dumps(st, sort_keys=True),
                                                h, state, reason, int(time.time()), job_id))
    return get(job_id)


def public(job: dict) -> dict:
    """What the page may see: no server paths."""
    keep = ("id", "state", "name", "model_sha256", "model_bytes", "request_hash", "slice_sha256", "slice_bytes", "reason",
            "file_removed", "created", "updated")
    out = {k: job[k] for k in keep}
    out["transform"] = json.loads(job["transform"]) if job["transform"] else None
    out["settings"] = json.loads(job["settings"])
    out["slice_info"] = json.loads(job["slice_info"]) if job.get("slice_info") else None
    out["outcome"] = json.loads(job["outcome"]) if job.get("outcome") else None
    out["can_reprint_file"] = not job["file_removed"] and bool(job["slice_sha256"])
    return out


# ---- What a model upload must be --------------------------------------------------------------------------------

def check_model(path: Path, ext: str) -> None:
    """Structure only (the Pi never measures a mesh): STL framing, or a 3MF archive that is safe to hand to Studio."""
    if ext == ".stl":
        return _check_stl(path)
    return _check_3mf(path)


def _check_stl(path: Path) -> None:
    size = path.stat().st_size
    with open(path, "rb") as f:
        head = f.read(84)
    if len(head) >= 84:
        n = struct.unpack("<I", head[80:84])[0]
        if n > 0 and 84 + 50 * n == size:  # binary: the framing must match exactly
            with open(path, "rb") as f:
                f.seek(84)
                while block := f.read(50 * 4096):
                    for rec in struct.iter_unpack("<12fH", block):
                        if not all(math.isfinite(x) for x in rec[:12]):
                            raise QuickError(422, "The STL has coordinates that aren't numbers.")
            return
    if head[:5].lower() == b"solid":  # ASCII: it must at least be facets, closed with endsolid
        text = path.read_bytes().decode("ascii", "ignore")
        if "facet" in text and "vertex" in text and "endsolid" in text.lower():
            return
    raise QuickError(422, "That isn't a valid STL (truncated, empty, or not an STL file).")


def _check_3mf(path: Path) -> None:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise QuickError(422, "That isn't a valid 3MF (not a zip archive).") from None
    with z:
        infos = z.infolist()
        if not infos:
            raise QuickError(422, "The 3MF is empty.")
        if len(infos) > MAX_ENTRIES:
            raise QuickError(422, f"The 3MF has more than {MAX_ENTRIES} files.")
        if sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise QuickError(422, f"The 3MF would unpack to more than {MAX_EXPANDED >> 20} MiB.")
        for i in infos:
            n = i.filename
            if n.startswith("/") or "\\" in n or ".." in n.split("/") or re.match(r"^[A-Za-z]:", n):
                raise QuickError(422, f"The 3MF has an unsafe path ({n[:60]}).")
            if stat.S_ISLNK(i.external_attr >> 16):
                raise QuickError(422, "The 3MF contains a symbolic link.")
        if not any(i.filename.lower().endswith(".model") for i in infos):
            raise QuickError(422, "The 3MF has no 3D model in it.")
        # The declared sizes are the archive's own claim, so they prove nothing: unpack every entry in chunks under one
        # running budget (what Studio will really unpack), and read the references only from what actually came out.
        budget = MAX_EXPANDED
        try:
            for i in infos:
                keep = i.filename.endswith(".rels") or i.filename.lower().endswith(".model")
                text = bytearray()
                with z.open(i) as f:
                    while chunk := f.read(1 << 20):
                        budget -= len(chunk)
                        if budget < 0:
                            raise QuickError(422, f"The 3MF unpacks to more than {MAX_EXPANDED >> 20} MiB.")
                        if keep:
                            text += chunk
                            if len(text) > 64 * 1024 ** 2:
                                raise QuickError(422, "The 3MF is too large to check.")
                if keep:
                    for ref in re.findall(r'(?:Target|p:path)="([^"]*)"', text.decode("utf-8", "ignore")):
                        if "://" in ref or ref.startswith("//") or ".." in ref.split("/") or "\\" in ref:
                            raise QuickError(422, "The 3MF refers to a file outside itself.")
        except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError):
            raise QuickError(422, "The 3MF is damaged or its sizes don't match its contents.") from None


# ---- Routes (owner only) --------------------------------------------------------------------------------------

def _owner(request: Request):
    return auth.need(request, "owner")


def _upload(uid: str) -> dict:
    ready()
    u = db.one("SELECT * FROM quick_uploads WHERE id = ?", uid) if ID_RE.fullmatch(uid or "") else None
    if not u:
        raise HTTPException(404, "No such upload (finished, canceled or expired).")
    return u


def _part(uid: str) -> Path:
    return QUICK_DIR / "tmp" / f"up-{uid}.part"


def _have(uid: str) -> int:
    try:
        return _part(uid).stat().st_size
    except FileNotFoundError:
        return 0


@router.post("/uploads")
async def start_upload(request: Request):
    who, device = _owner(request)
    try:
        b = await request.json()
    except ValueError:
        raise HTTPException(400, "Send JSON.")
    if not isinstance(b, dict):
        raise HTTPException(400, "Send JSON.")
    name = os.path.basename(str(b.get("filename") or "").replace("\\", "/"))
    ext = Path(name).suffix.lower()
    if ext not in (".stl", ".3mf"):
        raise HTTPException(400, "Only STL and 3MF models can be printed here.")
    size = b.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0 or size > MAX_MODEL:
        raise HTTPException(400, f"The file size must be between 1 byte and {MAX_MODEL >> 20} MiB.")
    ready()
    sweep()
    uid = secrets.token_hex(8)
    _dir("tmp")
    try:
        with db.transaction() as c:  # the reservation and the check are one step, so two uploads can't both pass the cap
            admit(size)
            c.execute("INSERT INTO quick_uploads (id, filename, ext, size, started, touched) VALUES (?, ?, ?, ?, ?, ?)",
                      (uid, name[:120], ext, size, int(time.time()), int(time.time())))
    except QuickError as e:
        raise _http(e)
    _part(uid).touch()
    auth.log(who, device, "quick print", f"upload started {name[:60]} ({size} bytes)")
    return {"id": uid, "offset": 0, "size": size, "chunk": CHUNK}


@router.get("/uploads/{uid}")
def upload_status(uid: str, request: Request):
    _owner(request)
    u = _upload(uid)
    return {"id": uid, "offset": _have(uid), "size": u["size"], "chunk": CHUNK, "done": False}


@router.put("/uploads/{uid}")
async def upload_chunk(uid: str, offset: int, request: Request):
    who, device = _owner(request)
    u = _upload(uid)
    have = _have(uid)
    if offset != have:
        return JSONResponse({"detail": "Out of step; continue from offset.", "offset": have}, status_code=409)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > CHUNK:
        raise HTTPException(413, f"A piece can be at most {CHUNK} bytes.")
    part, wrote = _part(uid), 0
    with open(part, "ab") as f:
        async for data in request.stream():
            wrote += len(data)
            if wrote > CHUNK or have + wrote > u["size"]:
                f.truncate(have)
                raise HTTPException(413, f"A piece can be at most {CHUNK} bytes and the file {u['size']} bytes.")
            f.write(data)
        f.flush()
        os.fsync(f.fileno())
    db.run("UPDATE quick_uploads SET touched = ? WHERE id = ?", int(time.time()), uid)
    have += wrote
    if have < u["size"]:
        return {"id": uid, "offset": have, "size": u["size"], "done": False}
    try:
        job = _finish(u, part)
    except QuickError as e:
        part.unlink(missing_ok=True)
        db.run("DELETE FROM quick_uploads WHERE id = ?", uid)
        return JSONResponse({"detail": e.message, **e.extra}, status_code=e.status)
    auth.log(who, device, "quick print", f"uploaded {u['filename'][:60]} as {job['id']}")
    return {"id": uid, "offset": have, "size": u["size"], "done": True, "job": public(job)}


def _finish(u: dict, part: Path) -> dict:
    check_model(part, u["ext"])
    h = hashlib.sha256()
    with open(part, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    sha = h.hexdigest()
    dup = db.one("SELECT id, state FROM quick_jobs WHERE model_sha256 = ? AND file_removed = 0 AND state != 'canceled' "
                 "ORDER BY created DESC", sha)
    if dup:
        raise QuickError(409, "That exact model is already uploaded.", duplicate_of=dup["id"], state=dup["state"])
    jid = secrets.token_hex(8)
    fname = f"{jid}{u['ext']}"
    _dir("models")
    os.replace(part, QUICK_DIR / "models" / fname)
    now = int(time.time())
    try:
        with db.transaction() as c:
            c.execute("INSERT INTO quick_jobs (id, state, name, model_sha256, model_file, model_bytes, settings, "
                      "request_hash, created, updated) VALUES (?, 'draft', ?, ?, ?, ?, '{}', ?, ?, ?)",
                      (jid, u["filename"], sha, fname, u["size"], request_hash(sha, None, {}), now, now))
            c.execute("DELETE FROM quick_uploads WHERE id = ?", (u["id"],))
    except BaseException:
        (QUICK_DIR / "models" / fname).unlink(missing_ok=True)
        raise
    return get(jid)


@router.delete("/uploads/{uid}")
def cancel_upload(uid: str, request: Request):
    who, device = _owner(request)
    u = _upload(uid)
    _part(uid).unlink(missing_ok=True)
    db.run("DELETE FROM quick_uploads WHERE id = ?", uid)
    auth.log(who, device, "quick print", f"upload canceled {u['filename'][:60]}")
    return {"ok": True}


@router.get("/storage")
def storage(request: Request):
    _owner(request)
    return usage()


@router.get("/jobs")
def list_jobs(request: Request):
    _owner(request)
    ready()
    return {"jobs": [public(j) for j in db.rows("SELECT * FROM quick_jobs ORDER BY created DESC LIMIT 100")]}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    _owner(request)
    try:
        return public(get(job_id))
    except QuickError as e:
        raise _http(e)


def _clean_settings(v) -> dict:
    if not isinstance(v, dict) or len(v) > 20:
        raise HTTPException(400, "Settings must be an object of at most 20 values.")
    out = {}
    for k, x in v.items():
        if not isinstance(k, str) or not KEY_RE.fullmatch(k):
            raise HTTPException(400, f"Bad setting name {str(k)[:30]!r}.")
        if isinstance(x, bool) or isinstance(x, (int, float)) and math.isfinite(x) or isinstance(x, str) and len(x) <= 40:
            out[k] = x
        else:
            raise HTTPException(400, f"Bad value for {k}.")
    return out


def _clean_transform(v):
    if v is None:
        return None
    if (not isinstance(v, list) or len(v) != 16 or
            not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and abs(x) < 1e6 for x in v)):
        raise HTTPException(400, "A transform is 16 numbers or null.")
    return [float(x) for x in v]


@router.patch("/jobs/{job_id}")
async def edit_job(job_id: str, request: Request):
    who, device = _owner(request)
    try:
        b = await request.json()
    except ValueError:
        raise HTTPException(400, "Send JSON.")
    if not isinstance(b, dict) or not ({"transform", "settings"} & set(b)):
        raise HTTPException(400, "Send a transform or settings.")
    try:
        job = set_inputs(job_id, transform=_clean_transform(b["transform"]) if "transform" in b else _UNSET,
                         settings=_clean_settings(b["settings"]) if "settings" in b else None)
    except QuickError as e:
        raise _http(e)
    auth.log(who, device, "quick print", f"edited {job_id}")
    return public(job)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request):
    who, device = _owner(request)
    from . import quick_worker
    try:
        job = quick_worker.cancel(job_id)
    except QuickError as e:
        raise _http(e)
    auth.log(who, device, "quick print", f"canceled {job_id}")
    return public(job)
