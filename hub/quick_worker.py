"""Quick Print's worker channel (A19 P3a): how the Mac slices a job, and how the hub refuses anything that isn't the one
current, live attempt. The hub owns the job and the file; the worker only reports (plan decision 6).

An attempt is the durable ownership record in `quick_attempts`: attempt id, the job's attempt number (generation), lease,
heartbeat, phase and one terminal state. A job has at most one live attempt (a unique index). Every worker message names
job, attempt and generation and is accepted only through `_live`: the attempt is the current non-terminal one, its lease
hasn't lapsed, the job is unchanged since the claim (request hash) and nothing canceled it. Only a heartbeat extends the
lease. Completion is one transaction. Late results are refused (409 with a reason) and their file deleted.

Wire contract (all under /api/lab/quick/worker, which Caddy already passes to the hub for the Mac; every call carries
`X-Hub-Mac-Key`): POST claim; GET jobs/{job}/attempts/{attempt}/model; POST .../heartbeat; GET and PUT .../artifact
(chunks of at most 8 MiB, because Caddy caps lab bodies at 9 MB); POST .../complete. Owner routes (the page, P4):
POST /api/quick/jobs/{id}/slice, GET /api/quick/worker, GET /api/quick/jobs/{id}/attempts."""
import hashlib
import json
import os
import re
import secrets
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from . import auth, db, lab, mac_lab, quick, quick_check
from .lab_guard import require_mac

worker_router = APIRouter(prefix="/api/lab/quick/worker")
owner_router = APIRouter(prefix="/api/quick")

LEASE = 90  # seconds without a heartbeat before the attempt ends (provisional: six of the worker's 15 s beats)
BEAT = 15
TIMEOUT = 1800  # the lab's own slice timeout (lab/jobs.py)
GRACE = 120  # on top, for the upload and the check
ALLOWED_STUDIO = ("02.09.01.70",)
PHASES = ("preparing", "slicing", "uploading")
OUTCOMES = ("sliced", "failed", "needs_attention")
CAUSES = ("slice_failed", "slice_timeout", "studio_version", "missing_binary", "output_invalid", "worker_ended",
          "start_sequence")
PENDING_CAP = 100
ARTIFACT_CHUNK = 8 * 1024 * 1024
REASONS = {
    "canceled": "Canceled.",
    "heartbeat_stale": f"The Mac stopped reporting during the slice (no heartbeat for {LEASE} s).",
    "slice_timeout": f"The slice ran longer than {TIMEOUT // 60} minutes.",
    "attempt_expired": "The hub restarted while this was slicing and the slice's lease had lapsed.",
    "stale": "The model, transform or settings changed while this was slicing.",
    "slice_failed": "Bambu Studio couldn't slice this model.",
    "studio_version": "The Mac's Bambu Studio isn't a version the hub allows.",
    "missing_binary": "Bambu Studio isn't installed on the Mac.",
    "output_invalid": "Bambu Studio's output wasn't a usable sliced file.",
    "worker_ended": "The Mac's slicing worker ended before it finished.",
    "start_sequence": "Refused: this slice doesn't have the X2D start sequence.",
    "storage": "There wasn't room to slice this.",
}
EXPIRED = {"heartbeat_stale", "slice_timeout", "attempt_expired"}
_reconciled: set = set()


def _now() -> int:
    return int(time.time())


def _scratch(job_id: str) -> Path:
    return quick.QUICK_DIR / "scratch" / job_id


def _part(job_id: str, attempt: str) -> Path:
    """One partial file per attempt, so a late message from an old attempt can never touch the current one's."""
    return _scratch(job_id) / f"{attempt}.part"


def _worker(w) -> dict:
    """The worker's fact record (decision 7): a small, bounded object, never trusted for anything but display."""
    if not isinstance(w, dict):
        raise quick.QuickError(422, "Send the worker's id, os, studio_version and presets.")
    wid = w.get("id")
    if not isinstance(wid, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,40}", wid):
        raise quick.QuickError(422, "The worker id must be 1 to 40 letters, digits, dots, dashes or underscores.")
    presets = w.get("presets", [])
    if not isinstance(presets, list) or len(presets) > 20 or not all(isinstance(x, str) and len(x) <= 80 for x in presets):
        raise quick.QuickError(422, "presets must be a short list of names.")
    return {"id": wid, "os": str(w.get("os") or "")[:40], "studio_version": str(w.get("studio_version") or "")[:40],
            "presets": presets}


def _note_worker(w: dict, phase: str, now: int) -> None:
    db.run("INSERT INTO quick_workers (id, os, studio_version, presets, phase, last_seen) VALUES (?, ?, ?, ?, ?, ?) "
           "ON CONFLICT(id) DO UPDATE SET os = excluded.os, studio_version = excluded.studio_version, "
           "presets = excluded.presets, phase = excluded.phase, last_seen = excluded.last_seen",
           w["id"], w["os"], w["studio_version"], json.dumps(w["presets"]), phase, now)


# ---- Ending an attempt ----------------------------------------------------------------------------------------

def _resolve_requests(job_id: str, status: str, message: str | None) -> None:
    lab.ready()
    db.run("UPDATE lab_requests SET status = ?, message = ?, resolved_at = ? WHERE project = ? AND experiment = ? "
           "AND status = 'pending'", status, message, lab.now_iso(), quick.RESERVED_PROJECT, job_id)


def _end(a: dict, terminal: str, cause: str | None, to: str | None, reason: str | None = None, **fields) -> None:
    """End a live attempt and, in the same transaction, move its job (when `to`) and free its reservation and scratch.
    Call inside a transaction."""
    now = _now()
    db.run("UPDATE quick_attempts SET terminal = ?, cause = ?, ended_at = ? WHERE attempt = ? AND terminal IS NULL",
           terminal, cause, now, a["attempt"])
    if to:
        quick.transition(a["job"], to, reason=reason or REASONS.get(cause or "", cause), slice_reserved=0, **fields)
    else:
        db.run("UPDATE quick_jobs SET slice_reserved = 0 WHERE id = ?", a["job"])
    shutil.rmtree(_scratch(a["job"]), ignore_errors=True)
    if to == "failed":
        _resolve_requests(a["job"], "refused", reason or REASONS.get(cause or "", cause))
    elif to == "needs_attention":
        _resolve_requests(a["job"], "refused", reason)
    elif to == "canceled":
        _resolve_requests(a["job"], "refused", "Canceled.")
    elif to == "sliced":
        _resolve_requests(a["job"], "applied", None)


def _check_copy(job_id: str, attempt: str) -> Path:
    """The file complete() judges and publishes: a private name no upload can reach."""
    return _scratch(job_id) / f"{attempt}.check"


def _drop(job_id: str, attempt: str) -> None:
    _part(job_id, attempt).unlink(missing_ok=True)
    _check_copy(job_id, attempt).unlink(missing_ok=True)


def _sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _to_validating(job_id: str) -> None:
    """Preparing and Slicing both lead to Validating; a worker that skips its slicing beat is not refused for it."""
    state = quick.get(job_id)["state"]
    if state == "preparing":
        quick.transition(job_id, "slicing", expect="preparing")
        state = "slicing"
    if state == "slicing":
        quick.transition(job_id, "validating", expect="slicing")


def reap(now: float | None = None) -> None:
    """End every live attempt whose lease lapsed or whose slice ran past its limit. The first call in a process (a
    restart) ends a lapsed attempt as "attempt_expired", before any claim is accepted; a worker that comes back later
    finds its attempt refused. Nothing is retried."""
    quick.ready()
    now = int(now if now is not None else _now())
    first = os.environ.get("HUB_DB", "") not in _reconciled
    _reconciled.add(os.environ.get("HUB_DB", ""))
    for a in db.rows("SELECT * FROM quick_attempts WHERE terminal IS NULL"):
        job = db.one("SELECT request_hash FROM quick_jobs WHERE id = ?", a["job"])
        if now > a["claimed_at"] + TIMEOUT + GRACE:
            cause = "slice_timeout"
        elif now > a["lease_end"]:
            cause = "attempt_expired" if first else "heartbeat_stale"
        elif not job or job["request_hash"] != a["request_hash"]:
            cause = "stale"  # the job changed since the claim: its result could never be accepted
        else:
            continue
        with quick._tx():
            fresh = db.one("SELECT * FROM quick_attempts WHERE attempt = ? AND terminal IS NULL", a["attempt"])
            if fresh:
                _end(fresh, cause, cause, "failed")


# ---- Claim ----------------------------------------------------------------------------------------------------

def claim(w: dict) -> dict | None:
    """Move the oldest queued job to Preparing for this worker, or None (with `why` in the second return). One
    transaction, so two claimers can't both win (the unique index backs it up)."""
    quick.ready()
    reap()
    now = _now()
    why = None
    if w["studio_version"] not in ALLOWED_STUDIO:
        why = f"Bambu Studio {w['studio_version'] or '(unknown)'} isn't allowed; the hub accepts {', '.join(ALLOWED_STUDIO)}."
    with quick._tx():
        _note_worker(w, "idle" if not why else "refused", now)
        if not why and db.one("SELECT 1 AS x FROM quick_attempts WHERE worker = ? AND terminal IS NULL", w["id"]):
            why = "This worker already holds a live attempt."
        job = None if why else db.one("SELECT * FROM quick_jobs WHERE state = 'queued' ORDER BY updated, created LIMIT 1")
        if not job:
            return {"job": None, "why": why}
        try:
            quick.admit(quick.MAX_SLICED)
        except quick.QuickError as e:
            quick.transition(job["id"], "failed", reason=f"{REASONS['storage']} {e.message}")
            _resolve_requests(job["id"], "refused", e.message)
            return {"job": None, "why": e.message}
        gen = db.one("SELECT COUNT(*) AS n FROM quick_attempts WHERE job = ?", job["id"])["n"] + 1
        aid = secrets.token_hex(8)
        db.run("INSERT INTO quick_attempts (attempt, job, generation, worker, claimed_at, lease_end, last_heartbeat, phase, "
               "studio_version, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?)",
               aid, job["id"], gen, w["id"], now, now + LEASE, now, w["studio_version"], job["request_hash"])
        quick.transition(job["id"], "preparing", expect="queued", slice_reserved=quick.MAX_SLICED)
        _note_worker(w, "preparing", now)
    return {"job": {"id": job["id"], "attempt": aid, "generation": gen, "lease_seconds": LEASE, "heartbeat_every": BEAT,
                    "timeout_s": TIMEOUT, "max_artifact_bytes": quick.MAX_SLICED,
                    "model": {"name": job["name"], "ext": Path(job["model_file"]).suffix, "sha256": job["model_sha256"],
                              "bytes": job["model_bytes"]},
                    "transform": json.loads(job["transform"]) if job["transform"] else None,
                    "settings": json.loads(job["settings"]), "request_hash": job["request_hash"]}}


# ---- The fence ------------------------------------------------------------------------------------------------

def _refuse(reason: str, message: str, **extra):
    raise quick.QuickError(409, message, reason=reason, **extra)


def _live(job_id: str, attempt: str, generation) -> dict:
    """The attempt, only if this message may act on it. Raises 404 (unknown) or 409 with a reason the worker acts on:
    canceled, expired, superseded, terminal, generation or stale. Call inside the transaction that then writes."""
    if not quick.ID_RE.fullmatch(job_id or "") or not quick.ID_RE.fullmatch(attempt or ""):
        raise quick.QuickError(404, "No such attempt.")
    a = db.one("SELECT * FROM quick_attempts WHERE attempt = ? AND job = ?", attempt, job_id)
    if not a:
        raise quick.QuickError(404, "No such attempt.")
    if a["terminal"]:
        newer = db.one("SELECT 1 AS x FROM quick_attempts WHERE job = ? AND generation > ?", job_id, a["generation"])
        if newer:
            _refuse("superseded", "A newer attempt has replaced this one.")
        if a["cause"] == "canceled":
            _refuse("canceled", "This job was canceled.")
        if a["cause"] in EXPIRED:
            _refuse("expired", "This attempt expired.")
        _refuse("terminal", "This attempt has already ended.")
    if isinstance(generation, bool) or generation != a["generation"]:
        _refuse("generation", f"This attempt is generation {a['generation']}.")
    now = _now()
    if now > a["claimed_at"] + TIMEOUT + GRACE or now > a["lease_end"]:
        cause = "slice_timeout" if now > a["claimed_at"] + TIMEOUT + GRACE else "heartbeat_stale"
        _end(a, cause, cause, "failed")
        _refuse("expired", "This attempt expired.")
    job = db.one("SELECT request_hash, state FROM quick_jobs WHERE id = ?", job_id)
    if not job or job["request_hash"] != a["request_hash"]:
        _end(a, "stale", "stale", "failed")
        _refuse("stale", "The job changed after it was claimed.")
    return a


async def _json(request: Request, cap: int = 64 * 1024) -> dict:
    from .lab_guard import read_capped
    try:
        b = json.loads(bytes(await read_capped(request, cap)) or b"null")
    except ValueError:
        raise HTTPException(400, "Send JSON.")
    if not isinstance(b, dict):
        raise HTTPException(400, "Send a JSON object.")
    return b


def _err(e: quick.QuickError) -> JSONResponse:
    return JSONResponse({"detail": e.message, **e.extra}, status_code=e.status)


# ---- Worker routes --------------------------------------------------------------------------------------------

@worker_router.post("/claim")
async def route_claim(request: Request):
    require_mac(request)
    body = await _json(request)
    try:
        return claim(_worker(body.get("worker")))
    except quick.QuickError as e:
        return _err(e)


@worker_router.get("/jobs/{job_id}/attempts/{attempt}/model")
def route_model(job_id: str, attempt: str, generation: int, request: Request):
    require_mac(request)
    quick.ready()
    reap()
    try:
        with quick._tx():
            _live(job_id, attempt, generation)
        job = quick.get(job_id)
    except quick.QuickError as e:
        return _err(e)
    path = quick.model_path(job)
    if not path or not path.exists():
        return JSONResponse({"detail": "The model file is gone.", "reason": "missing"}, status_code=410)
    return FileResponse(path, media_type="application/octet-stream", headers={"X-Sha256": job["model_sha256"]})


@worker_router.post("/jobs/{job_id}/attempts/{attempt}/heartbeat")
async def route_heartbeat(job_id: str, attempt: str, request: Request):
    require_mac(request)
    quick.ready()
    reap()
    body = await _json(request)
    try:
        w = _worker(body.get("worker"))
        phase = body.get("phase")
        if phase not in PHASES:
            raise quick.QuickError(422, f"phase must be one of {', '.join(PHASES)}.")
        now = _now()
        with quick._tx():
            a = _live(job_id, attempt, body.get("generation"))
            db.run("UPDATE quick_attempts SET last_heartbeat = ?, lease_end = ?, phase = ? WHERE attempt = ?",
                   now, now + LEASE, phase, attempt)
            if phase == "slicing" and quick.get(job_id)["state"] == "preparing":
                quick.transition(job_id, "slicing", expect="preparing")
            _note_worker(w, phase, now)
        return {"ok": True, "cancel": False, "lease_seconds": LEASE}
    except quick.QuickError as e:
        return _err(e)


def _artifact_offset(job_id: str, attempt: str) -> int:
    try:
        return _part(job_id, attempt).stat().st_size
    except FileNotFoundError:
        return 0


@worker_router.get("/jobs/{job_id}/attempts/{attempt}/artifact")
def route_artifact_offset(job_id: str, attempt: str, generation: int, request: Request):
    require_mac(request)
    quick.ready()
    reap()
    try:
        with quick._tx():
            _live(job_id, attempt, generation)
    except quick.QuickError as e:
        return _err(e)
    return {"offset": _artifact_offset(job_id, attempt)}


@worker_router.put("/jobs/{job_id}/attempts/{attempt}/artifact")
async def route_artifact(job_id: str, attempt: str, generation: int, offset: int, request: Request):
    require_mac(request)
    quick.ready()
    reap()
    try:
        size, sha = request.headers.get("x-size", ""), request.headers.get("x-sha256", "").lower()
        if not size.isdigit() or not 0 < int(size) <= quick.MAX_SLICED or not quick.SHA_RE.fullmatch(sha):
            raise quick.QuickError(422, f"Send X-Size (1 to {quick.MAX_SLICED} bytes) and X-Sha256.")
        size = int(size)
        with quick._tx():
            a = _live(job_id, attempt, generation)
            if a["artifact_sha"]:
                raise quick.QuickError(409, "This attempt's artifact is already complete.", reason="uploaded")
            _to_validating(job_id)
        have = _artifact_offset(job_id, attempt)
        if offset != have:
            raise quick.QuickError(409, "Out of step; continue from offset.", reason="offset", offset=have)
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > ARTIFACT_CHUNK:
            raise quick.QuickError(413, f"A piece can be at most {ARTIFACT_CHUNK} bytes.")
        part, wrote = _part(job_id, attempt), 0
        part.parent.mkdir(parents=True, exist_ok=True)
        with open(part, "ab") as f:
            async for data in request.stream():
                wrote += len(data)
                if wrote > ARTIFACT_CHUNK or have + wrote > size:
                    f.truncate(have)
                    raise quick.QuickError(413, f"A piece can be at most {ARTIFACT_CHUNK} bytes and the file {size}.")
                f.write(data)
            f.flush()
            os.fsync(f.fileno())
        have += wrote
        with quick._tx():  # still the live attempt after the bytes arrived? Cancel during publication ends it here.
            _live(job_id, attempt, generation)
        if have < size:
            return {"done": False, "offset": have}
        got = _sha_file(part)
        if got != sha:
            part.unlink(missing_ok=True)
            raise quick.QuickError(422, "The file's sha256 doesn't match what you declared. Send it again from offset 0.",
                                   reason="sha")
        with quick._tx():
            _live(job_id, attempt, generation)
            db.run("UPDATE quick_attempts SET artifact_sha = ?, artifact_bytes = ? WHERE attempt = ?", got, have, attempt)
        return {"done": True, "sha256": got, "bytes": have}
    except quick.QuickError as e:
        if e.status == 409 and e.extra.get("reason") != "offset":
            _drop(job_id, attempt)  # a refused attempt leaves no partial file behind
        return _err(e)


@worker_router.post("/jobs/{job_id}/attempts/{attempt}/complete")
async def route_complete(job_id: str, attempt: str, request: Request):
    require_mac(request)
    quick.ready()
    reap()
    body = await _json(request)
    try:
        return complete(job_id, attempt, body)
    except quick.QuickError as e:
        if e.status == 409:
            _drop(job_id, attempt)
        return _err(e)


def complete(job_id: str, attempt: str, body: dict) -> dict:
    outcome, cause = body.get("outcome"), body.get("cause")
    msg = body.get("message")
    if outcome not in OUTCOMES:
        raise quick.QuickError(422, f"outcome must be one of {', '.join(OUTCOMES)}.")
    if cause is not None and cause not in CAUSES:
        raise quick.QuickError(422, f"cause must be one of {', '.join(CAUSES)}.")
    if msg is not None and (not isinstance(msg, str) or len(msg) > 300):
        raise quick.QuickError(422, "message must be text of at most 300 characters.")
    gen = body.get("generation")
    if outcome != "sliced":
        with quick._tx():
            a = _live(job_id, attempt, gen)
            reason = (msg or REASONS.get(cause or "", "The slice didn't finish."))[:300]
            if outcome == "needs_attention":
                _to_validating(job_id)
            _end(a, outcome, cause or outcome, outcome, reason)
        return {"ok": True, "state": quick.get(job_id)["state"]}
    # sliced: verify the file outside the transaction (it can take a while), then decide inside one
    art = body.get("artifact")
    res = body.get("result") if isinstance(body.get("result"), dict) else {}
    if not isinstance(art, dict):
        raise quick.QuickError(422, "A sliced result names its artifact (sha256, bytes).")
    with quick._tx():
        a = _live(job_id, attempt, gen)
    if not a["artifact_sha"] or art.get("sha256") != a["artifact_sha"] or art.get("bytes") != a["artifact_bytes"]:
        raise quick.QuickError(422, "The artifact wasn't uploaded, or it isn't the one named.", reason="artifact")
    studio = str(res.get("studio_version") or a["studio_version"] or "")
    if studio not in ALLOWED_STUDIO:
        with quick._tx():
            _end(_live(job_id, attempt, gen), "needs_attention", "studio_version", "needs_attention",
                 f"{REASONS['studio_version']} ({studio or 'unknown'})")
        return {"ok": True, "state": "needs_attention"}
    part, copy = _part(job_id, attempt), _check_copy(job_id, attempt)
    try:
        os.replace(part, copy)  # from here no upload can reach what is judged and published
    except FileNotFoundError:
        raise quick.QuickError(422, "The artifact wasn't uploaded.", reason="artifact") from None
    if _sha_file(copy) != a["artifact_sha"]:
        raise quick.QuickError(422, "The stored artifact doesn't match its sha256.", reason="artifact")
    seen = copy.stat()
    ok, reasons, block_lines = quick_check.check_artifact(copy, quick_check.load_reference())
    final = quick.QUICK_DIR / "slices" / f"{job_id}.gcode.3mf"
    with quick._tx():
        a = _live(job_id, attempt, gen)
        if not ok:
            _end(a, "needs_attention", "start_sequence", "needs_attention",
                 f"{REASONS['start_sequence']} {'; '.join(reasons)}"[:300])
            return {"ok": True, "state": "needs_attention"}
        job = quick.get(job_id)
        now_stat = copy.stat()
        if (now_stat.st_ino, now_stat.st_size, now_stat.st_mtime_ns) != (seen.st_ino, seen.st_size, seen.st_mtime_ns):
            raise quick.QuickError(409, "The artifact changed after it was checked.", reason="terminal")
        info = {k: res.get(k) for k in ("minutes", "grams", "layers", "studio_version", "base_sha256", "project_sha256")}
        info.update({"start_block_lines": block_lines, "settings": json.loads(job["settings"]), "attempt": attempt,
                     "sliced_at": _now()})
        final.parent.mkdir(parents=True, exist_ok=True)
        backup = final.with_name(final.name + ".old")
        if final.exists():
            os.replace(final, backup)  # a re-slice replaces the earlier slice only if this commit succeeds
        os.replace(copy, final)
        try:
            _end(a, "completed", None, "sliced", None, slice_sha256=a["artifact_sha"], slice_file=final.name,
                 slice_bytes=a["artifact_bytes"], sliced_hash=a["request_hash"], slice_info=json.dumps(info))
            db.run("UPDATE quick_jobs SET reason = NULL WHERE id = ?", job_id)
        except BaseException:
            final.unlink(missing_ok=True)
            if backup.exists():
                os.replace(backup, final)
            raise
        backup.unlink(missing_ok=True)
    return {"ok": True, "state": "sliced"}


# ---- Owner routes ---------------------------------------------------------------------------------------------

def cancel(job_id: str) -> dict:
    """Cancel a job. A live attempt ends in the same transaction, so a later result from it is refused."""
    quick.ready()
    with quick._tx():
        a = db.one("SELECT * FROM quick_attempts WHERE job = ? AND terminal IS NULL", job_id)
        if a:
            db.run("UPDATE quick_attempts SET cancel_requested = 1 WHERE attempt = ?", a["attempt"])
            _end(a, "canceled", "canceled", "canceled", REASONS["canceled"])
            return quick.get(job_id)
        job = quick.transition(job_id, "canceled", reason=REASONS["canceled"])
        _resolve_requests(job_id, "refused", "Canceled.")
    return job


@owner_router.post("/jobs/{job_id}/slice")
def route_slice(job_id: str, request: Request):
    who, device = auth.need(request, "owner")
    quick.ready()
    lab.ready()
    reap()
    try:
        with quick._tx():
            job = quick.get(job_id)
            if job["file_removed"]:
                raise quick.QuickError(409, "The model was removed to make room; upload it again.")
            if job["state"] == "draft":
                quick.transition(job_id, "ready_to_slice", expect="draft")
            elif job["state"] not in ("ready_to_slice", "sliced", "needs_attention", "failed", "stale"):
                raise quick.QuickError(409, f"A {job['state']} job can't be sliced.", state=job["state"])
            pending = db.one("SELECT COUNT(*) AS n FROM lab_requests WHERE status = 'pending'")["n"]
            if db.one("SELECT COUNT(*) AS n FROM lab_requests WHERE project = ? AND status = 'pending'",
                      quick.RESERVED_PROJECT)["n"] >= PENDING_CAP or pending >= 4 * PENDING_CAP:
                raise quick.QuickError(429, "Too many slices are waiting for the Mac.")
            quick.transition(job_id, "queued", reason=None)
            db.run("INSERT INTO lab_requests (id, project, kind, experiment, run, payload, status, created_at, by_device) "
                   "VALUES (?, ?, 'slice', ?, '', ?, 'pending', ?, ?)",
                   f"rq-{secrets.token_hex(8)}", quick.RESERVED_PROJECT, job_id,
                   json.dumps({"job": job_id, "request_hash": quick.get(job_id)["request_hash"]}), lab.now_iso(),
                   (device or "")[:80])
    except quick.QuickError as e:
        raise quick._http(e)
    auth.log(who, device, "quick print", f"slice requested {job_id}")
    return quick.public(quick.get(job_id))


@owner_router.get("/worker")
def route_worker(request: Request):
    """The worker as the hub knows it. Never "idle" for a worker that hasn't asked lately: that reads "asleep"."""
    auth.need(request, "owner")
    quick.ready()
    reap()
    w = db.one("SELECT * FROM quick_workers ORDER BY last_seen DESC LIMIT 1")
    now = _now()
    live = db.one("SELECT job, phase, last_heartbeat FROM quick_attempts WHERE terminal IS NULL LIMIT 1")
    if not w:
        return {"state": "none", "text": "No worker yet. The Mac hasn't asked for a slice.", "allowed_versions": ALLOWED_STUDIO}
    ago = now - w["last_seen"]
    state = "asleep" if ago > mac_lab.SILENT_AFTER else "busy" if live else "idle"
    return {"state": state, "last_seen": w["last_seen"], "seconds_ago": ago, "id": w["id"], "os": w["os"],
            "studio_version": w["studio_version"], "presets": json.loads(w["presets"] or "[]"),
            "phase": live["phase"] if live and state == "busy" else w["phase"],
            "job": live["job"] if live and state == "busy" else None, "allowed_versions": ALLOWED_STUDIO,
            "text": f"Mac asleep, last seen {ago // 60} min ago" if state == "asleep" else state}


@owner_router.get("/jobs/{job_id}/attempts")
def route_attempts(job_id: str, request: Request):
    auth.need(request, "owner")
    quick.ready()
    reap()
    try:
        quick.get(job_id)
    except quick.QuickError as e:
        raise quick._http(e)
    keep = "attempt, generation, worker, claimed_at, last_heartbeat, phase, terminal, cause, ended_at"
    return {"attempts": db.rows(f"SELECT {keep} FROM quick_attempts WHERE job = ? ORDER BY generation DESC", job_id)}
