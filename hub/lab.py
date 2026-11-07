"""Print Lab backend engine: stores index projections, specimen photos, and operator requests.
Compatible with print-lab sync and pull (schema print-lab-index/1)."""
import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from . import db, sources
from .auth import need
from .lab_guard import mac_key_ok, read_capped, require_mac

router = APIRouter(prefix="/api/lab")

SCHEMA_VERSION = "print-lab-index/1"
PROJECT_RE = re.compile(r"^[a-z0-9-]{1,40}$")
ID_RE = re.compile(r"^[A-Z]{1,4}-\d{1,6}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
REQUEST_ID_RE = re.compile(r"^rq-[0-9a-f]{16}$")
EXPERIMENT_ID_RE = re.compile(r"^[A-Z]{1,4}-\d{1,6}(-\d{2})?$")
RUN_ID_RE = re.compile(r"^[A-Z]{1,4}-\d{1,6}(-\d{2})?$")

MAX_SYNC = 4 * 1024 * 1024       # 4 MiB
MAX_PHOTO = 8 * 1024 * 1024      # 8 MiB
MAX_REQUEST = 64 * 1024          # 64 KiB
MAX_KIND_REQUEST = 4 * 1024      # any other request, as compact JSON (Local AI's MAX_REQUEST)
MAX_OBS_REQUEST = 16 * 1024      # an observation session, as compact JSON (Local AI's MAX_OBS_REQUEST)
MAX_RECORDS = 2000
MAX_PENDING = 20
MAX_PENDING_TOTAL = 100          # pending requests across all projects
MAX_REASON = 500
MAX_PHOTOS = 50
MAX_INCOMING_FILES = 200
MAX_INCOMING_BYTES = 500 * 1024 * 1024   # 500 MiB across all projects
INCOMING_DAYS = 7
MIN_FREE_GB = 1024 ** 3 / 1e9            # 1 GiB, in the units of sources.disk_free_gb

# The kinds Local AI queues (app/print-lab.js): the phone's verdict and photos, the page's buttons (start = It's
# printing now, approve, abandon = Drop), an observation session and a correction to one.
DATA_KINDS = ("verdict", "photos")
ACT_KINDS = ("start", "approve", "abandon")
OBS_KINDS = ("observation", "observation_correction")
KINDS = DATA_KINDS + ACT_KINDS + OBS_KINDS
# Sent only by Pi Hub itself, never through POST /requests: Start a staged lab print (A12), for lab pull's S6.
HUB_KINDS = ("one_tap",)
ACT_EXPERIMENT_RE = re.compile(r"^E-\d{1,6}$")
BUILD_ID_RE = re.compile(r"^[A-Z]{1,4}-\d{1,6}-\d{1,4}$")
GUARD_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
TAB_RE = re.compile(r"^[A-Za-z0-9_.-]{1,16}$")
OBS_ID_RE = re.compile(r"^OBS-\d{4,}$")

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS lab_projects (
    project TEXT PRIMARY KEY,
    meta TEXT NOT NULL,
    index_json TEXT NOT NULL,
    synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_records (
    project TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT,
    file TEXT,
    sha256 TEXT,
    payload TEXT,
    received_at TEXT NOT NULL,
    PRIMARY KEY (project, id)
);

CREATE TABLE IF NOT EXISTS lab_requests (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    kind TEXT NOT NULL,
    experiment TEXT NOT NULL,
    run TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    by_device TEXT
);
CREATE INDEX IF NOT EXISTS lab_requests_proj_status ON lab_requests(project, status);
"""

_ready_dbs = set()


def ready():
    path = os.environ.get("HUB_DB", "")
    if path not in _ready_dbs:
        db.conn().executescript(DB_SCHEMA)
        db.ensure_columns("lab_requests", {"run_seen": "TEXT"})
        _ready_dbs.add(path)


def lab_dir() -> Path:
    return Path(os.environ.get("HUB_LAB_DIR", "/var/lib/pi-hub/lab"))


def photo_dir(project: str) -> Path:
    return lab_dir() / project / "photos"


def incoming_dir(project: str) -> Path:
    return lab_dir() / project / "incoming"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(ts_str: str) -> Optional[float]:
    try:
        dt = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def _check_disk():
    """507 when the disk is nearly full, so a lab upload can't starve the rest of the hub."""
    path = lab_dir()
    while not path.exists() and path != path.parent:
        path = path.parent
    try:
        free = sources.disk_free_gb(str(path))
    except OSError:
        return
    if free < MIN_FREE_GB:
        raise HTTPException(507, "The Pi's disk is nearly full (under 1 GiB free); free some space and try again.")


def _pending_shas() -> set:
    """Photos that a pending request still names, in any project; the prune must leave them."""
    keep = set()
    for r in db.rows("SELECT payload FROM lab_requests WHERE status = 'pending'"):
        try:
            photos = (json.loads(r["payload"] or "{}") or {}).get("photos")
        except (ValueError, AttributeError):
            continue
        for p in photos if isinstance(photos, list) else []:
            if isinstance(p, dict) and isinstance(p.get("sha256"), str):
                keep.add(p["sha256"])
    return keep


def _incoming_files() -> list:
    return [f for f in lab_dir().glob("*/incoming/*") if f.is_file()]


def _prune_incoming():
    """Incoming photos nobody applied within INCOMING_DAYS are removed, in every project, unless a pending request
    still names them."""
    cutoff = datetime.now(timezone.utc).timestamp() - INCOMING_DAYS * 86400
    keep = None
    for f in _incoming_files():
        try:
            if f.stat().st_mtime < cutoff:
                if keep is None:
                    keep = _pending_shas()
                if f.stem not in keep:
                    f.unlink()
        except OSError:
            pass


def check_project(project: str):
    if not _full(PROJECT_RE, project):
        raise HTTPException(400, "Invalid project name")


_needs_cache: dict = {}  # project -> (synced_key, (project, generated_at, needs) or None)


def stored_needs() -> list:
    """(project, generated_at, needs) for every stored project, for Needs you. Never raises: a missing table, bad JSON
    or a stripped index gives nothing for that project. Each index is parsed once per sync (about 100 KB, and Home
    polls this), so only the small key columns are read each time."""
    try:
        ready()
        keys = db.rows("SELECT project, synced_at, length(index_json) AS n FROM lab_projects ORDER BY project")
    except Exception:
        return []
    out, seen = [], set()
    for k in keys:
        project, key = k["project"], (k["synced_at"], k["n"])
        seen.add(project)
        hit = _needs_cache.get(project)
        if not hit or hit[0] != key:
            entry = None
            try:
                row = db.one("SELECT index_json FROM lab_projects WHERE project = ?", project)
                idx = json.loads(row["index_json"])
                needs = idx.get("needs")
                if isinstance(needs, list):
                    # A staged build can start from Pi Hub (A12): its need says so, from the experiment's `staged`.
                    staged = {x.get("id") for x in idx.get("experiments") or []
                              if isinstance(x, dict) and isinstance(x.get("staged"), dict)
                              and x.get("status") in ("ready", "approved")}
                    needs = [dict(n, staged=True) if isinstance(n, dict) and n.get("id") in staged else n
                             for n in needs]
                    entry = (project, str(idx.get("generated_at") or ""), needs)
            except Exception:
                entry = None
            hit = _needs_cache[project] = (key, entry)
        if hit[1]:
            out.append(hit[1])
    for gone in set(_needs_cache) - seen:
        del _needs_cache[gone]
    return out


def workshop_summary() -> Optional[dict]:
    """Summary of the stored Print Lab projects for Workshop & Control Room, independent of the Windows PC."""
    try:
        ready()
        rows = db.rows("SELECT project, meta, index_json, synced_at FROM lab_projects ORDER BY synced_at DESC, project")
    except Exception:
        return None
    if not rows:
        return None
    projects = []
    all_needs = []
    active_exps = []
    open_questions = []
    latest_sync = None
    for r in rows:
        proj = r["project"]
        synced = r["synced_at"]
        if synced and (latest_sync is None or synced > latest_sync):
            latest_sync = synced
        try:
            ix = json.loads(r["index_json"] or "{}")
        except Exception:
            continue
        exps = [e for e in (ix.get("experiments") or []) if isinstance(e, dict)]
        by_id = {e.get("id"): e for e in exps if e.get("id")}
        for n in (ix.get("needs") or []):
            if not isinstance(n, dict) or not n.get("id"):
                continue
            exp_id = str(n["id"])
            exp = by_id.get(exp_id) or {}
            action = str(n.get("action") or "Needs you")
            href = f"/lab?p={proj}&e={exp_id}&do=judge" if action == "Judge the print" else f"/lab?p={proj}&e={exp_id}"
            all_needs.append({
                "project": proj,
                "id": exp_id,
                "action": action,
                "why": str(n.get("why") or ""),
                "due_at": n.get("due_at"),
                "question_text": str(exp.get("question_text") or ""),
                "judge_on": str(exp.get("judge_on") or ""),
                "href": href,
            })
        for e in exps:
            st = e.get("status")
            if st in ("printing", "ready", "needs_approval", "approved", "built"):
                active_exps.append({
                    "project": proj,
                    "id": e.get("id"),
                    "status": st,
                    "question_text": e.get("question_text") or "",
                    "filament": e.get("filament") or "",
                    "estimate": e.get("estimate"),
                    "href": f"/lab?p={proj}&e={e.get('id')}",
                })
        for q in (ix.get("questions") or []):
            if isinstance(q, dict) and q.get("status") not in ("answered", "stopped"):
                open_questions.append({
                    "project": proj,
                    "id": q.get("id"),
                    "question": q.get("question") or "",
                    "answered": q.get("answered") or 0,
                    "total": len(q.get("experiments") or []),
                })
        projects.append(proj)
    try:
        pending_reqs = db.one("SELECT COUNT(*) AS c FROM lab_requests WHERE status = 'pending'")["c"]
    except Exception:
        pending_reqs = 0
    return {
        "projects": projects,
        "synced_at": latest_sync,
        "needs": all_needs[:6],
        "active": active_exps[:6],
        "questions": open_questions[:4],
        "pending_requests": pending_reqs,
    }


@router.get("/projects")
def list_projects(request: Request):
    need(request, "household")
    ready()
    rows = db.rows("SELECT project, meta FROM lab_projects ORDER BY project")
    projects = []
    for r in rows:
        meta = json.loads(r["meta"]) if r["meta"] else {}
        projects.append({"name": r["project"], **meta})
    return JSONResponse({"projects": projects})


@router.get("/{project}")
def get_project(project: str, request: Request):
    need(request, "household")
    ready()
    check_project(project)
    row = db.one("SELECT meta, index_json FROM lab_projects WHERE project = ?", project)
    if not row:
        raise HTTPException(404, "No lab data yet. Run `lab sync` on the Mac.")
    return JSONResponse({
        "meta": json.loads(row["meta"]),
        "index": json.loads(row["index_json"])
    })


@router.post("/{project}/sync")
async def sync_project(project: str, request: Request):
    require_mac(request)
    ready()
    check_project(project)

    body = await read_capped(request, MAX_SYNC)
    ix = _load_request_json(body)

    if not isinstance(ix, dict) or ix.get("schema") != SCHEMA_VERSION:
        raise HTTPException(422, f"Expected schema {SCHEMA_VERSION}; update the lab on the Mac.")
    if ix.get("project") != project:
        raise HTTPException(422, f"The push is for {ix.get('project')}, not {project}.")

    gen_at = parse_iso(ix.get("generated_at"))
    if gen_at is None:
        raise HTTPException(422, "generated_at is missing or not a date.")

    records = ix.get("records")
    if not isinstance(records, dict):
        raise HTTPException(422, "records must be an object; nothing changed.")
    ids = list(records.keys())
    if len(ids) > MAX_RECORDS or any(not _full(ID_RE, i) for i in ids):
        raise HTTPException(422, "Record ids must look like E-001 or Q-001.")

    if any(not isinstance(v, dict) for v in records.values()):
        raise HTTPException(422, "Each record must be an object.")
    experiments = ix.get("experiments")
    if experiments is not None and not isinstance(experiments, list):
        raise HTTPException(422, "experiments must be a list.")

    meta_row = db.one("SELECT meta FROM lab_projects WHERE project = ?", project)
    old_meta = json.loads(meta_row["meta"]) if meta_row and meta_row["meta"] else None

    fingerprint = ix.get("fingerprint")
    if old_meta and old_meta.get("fingerprint") == fingerprint:
        old_meta["synced_at"] = now_iso()
        db.run("UPDATE lab_projects SET meta = ?, synced_at = ? WHERE project = ?",
               json.dumps(old_meta), old_meta["synced_at"], project)
        return JSONResponse({"ok": True, "upserted": 0, "removed": 0, "unchanged": len(ids)})

    if old_meta and old_meta.get("generated_at"):
        old_gen = parse_iso(old_meta["generated_at"])
        if old_gen and old_gen > gen_at:
            raise HTTPException(409, f"An older push than the one stored ({old_meta['generated_at']}); nothing changed.")

    upserted, unchanged = 0, 0
    now_str = now_iso()

    with db.transaction():
        existing_records = {r["id"]: r["sha256"] for r in db.rows("SELECT id, sha256 FROM lab_records WHERE project = ?", project)}
        # A push with no records would delete every stored one; that is a broken index on the Mac, not a real change.
        if existing_records and not records:
            raise HTTPException(409, f"The push has no records but the hub has {len(existing_records)}; nothing changed.")
        for rec_id, r in records.items():
            sha = r.get("sha256")
            if existing_records.get(rec_id) == sha:
                unchanged += 1
                continue
            payload_json = json.dumps(r.get("payload")) if r.get("payload") is not None else None
            db.run(
                "INSERT OR REPLACE INTO lab_records (project, id, type, file, sha256, payload, received_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                project, rec_id, r.get("type"), r.get("file"), sha, payload_json, now_str
            )
            upserted += 1

        to_remove = set(existing_records.keys()) - set(records.keys())
        for rec_id in to_remove:
            db.run("DELETE FROM lab_records WHERE project = ? AND id = ?", project, rec_id)
        removed = len(to_remove)

        saved_index = {k: v for k, v in ix.items() if k not in ("records", "colours")}
        new_meta = {
            "generated_at": ix.get("generated_at"),
            "fingerprint": fingerprint,
            "synced_at": now_str,
            "counts": {
                "records": len(ids),
                "experiments": len(ix.get("experiments") or [])
            }
        }
        db.run(
            "INSERT OR REPLACE INTO lab_projects (project, meta, index_json, synced_at) VALUES (?, ?, ?, ?)",
            project, json.dumps(new_meta), json.dumps(saved_index), now_str
        )

    return JSONResponse({"ok": True, "upserted": upserted, "removed": removed, "unchanged": unchanged})


@router.get("/{project}/photos")
def list_photos(project: str, request: Request):
    # People see which photos are here; the Mac, with its key, asks the same before every push.
    if not mac_key_ok(request):
        need(request, "household")
    check_project(project)
    pdir = photo_dir(project)
    if not pdir.exists():
        return JSONResponse({"have": []})
    have = [f.stem for f in pdir.glob("*.jpg") if _full(SHA_RE, f.stem)]
    return JSONResponse({"have": have})


@router.put("/{project}/photos/{sha_ext}")
async def upload_photo(project: str, sha_ext: str, request: Request):
    require_mac(request)
    check_project(project)
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(400, "Name a photo by its sha256: <sha256>.jpg")
    sha = sha_ext[:-4]
    if not _full(SHA_RE, sha):
        raise HTTPException(400, "Name a photo by its sha256: <sha256>.jpg")
    _check_disk()

    body = await read_capped(request, MAX_PHOTO)
    if len(body) < 2 or body[0] != 0xFF or body[1] != 0xD8:
        raise HTTPException(415, "Only JPEG photos.")
    if hashlib.sha256(body).hexdigest() != sha:
        raise HTTPException(422, "The photo doesn't match its sha256.")

    pdir = photo_dir(project)
    pdir.mkdir(parents=True, exist_ok=True)
    target = pdir / f"{sha}.jpg"
    if not target.exists():
        tmp = pdir / f"{sha}.tmp"
        tmp.write_bytes(body)
        tmp.replace(target)

    return JSONResponse({"ok": True})


@router.get("/{project}/photo/{sha_ext}")
def get_photo(project: str, sha_ext: str, request: Request):
    need(request, "household")
    check_project(project)
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(404, "No such photo.")
    sha = sha_ext[:-4]
    if not _full(SHA_RE, sha):
        raise HTTPException(404, "No such photo.")
    target = photo_dir(project) / f"{sha}.jpg"
    if not target.exists():
        raise HTTPException(404, "No such photo.")
    return FileResponse(target, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})


@router.get("/{project}/record/{rec_id}")
def get_record(project: str, rec_id: str, request: Request):
    need(request, "household")
    ready()
    check_project(project)
    if not _full(ID_RE, rec_id):
        raise HTTPException(404, f"No record {rec_id}.")
    row = db.one("SELECT id, type, file, sha256, payload, received_at FROM lab_records WHERE project = ? AND id = ?", project, rec_id)
    if not row:
        raise HTTPException(404, f"No record {rec_id}.")
    return JSONResponse({
        "id": row["id"],
        "type": row["type"],
        "file": row["file"],
        "sha256": row["sha256"],
        "payload": json.loads(row["payload"]) if row["payload"] else None,
        "received_at": row["received_at"]
    })


def _no_constant(name):
    raise ValueError(f"{name} is not JSON")


def _load_request_json(body: bytes):
    """The request body as JSON, or 400. NaN and Infinity are refused (stored, they would break every later read of
    the queue), as is a number too big for a float (1e999 parses to inf, so allow_nan=False catches it), and so is
    any string that can't be UTF-8 (a lone surrogate such as "\\ud800")."""
    try:
        data = json.loads(body.decode("utf-8"), parse_constant=_no_constant)
        json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError, RecursionError):
        raise HTTPException(400, "Invalid JSON request body")
    return data


def _full(rx, v) -> bool:
    """rx matches all of v, a str. (`$` alone would also let a trailing newline through.)"""
    return isinstance(v, str) and rx.fullmatch(v) is not None


def _photos_problem(payload: dict) -> Optional[str]:
    # Local AI's photosProblem: each photo is named by its sha256 (the clean-up after it is applied deletes
    # incoming/<sha256>.jpg, so nothing else may reach a path) with a short plain tab or none.
    photos = payload.get("photos")
    if not isinstance(photos, list) or not 1 <= len(photos) <= MAX_PHOTOS:
        return f"photos must list 1 to {MAX_PHOTOS} photos"
    for p in photos:
        if not isinstance(p, dict) or not _full(SHA_RE, p.get("sha256")) \
                or not (p.get("tab") is None or _full(TAB_RE, p.get("tab"))):
            return "Each photo needs its sha256 and at most a short tab name."
    return None


def _act_problem(kind: str, payload: dict, runs_seen: set) -> Optional[str]:
    # Local AI's actProblem: only the fields lab pull reads pass, and only in the shapes it expects.
    if kind == "start":
        t = payload.get("tapped_at")
        if not isinstance(t, str) or len(t) > 40 or parse_iso(t) is None:
            return "tapped_at must be a date"
        if any(not _full(RUN_ID_RE, r) for r in runs_seen):
            return "Invalid run id"
        return None
    reason = payload.get("reason").strip() if isinstance(payload.get("reason"), str) else ""
    if not reason:
        return "Dropping needs a reason." if kind == "abandon" else "Approving needs a reason."
    if len(reason) > MAX_REASON:
        return f"Keep the reason to {MAX_REASON} characters."
    if kind == "approve":
        if not _full(BUILD_ID_RE, payload.get("build_seen")):
            return "build_seen must be a build id"
        seen = payload.get("reasons_seen")
        if not isinstance(seen, list) or len(seen) > 30 or not all(_full(GUARD_CODE_RE, c) for c in seen):
            return "reasons_seen must be a list of guard codes"
    return None


def _obs_problem(kind: str, payload: dict) -> Optional[str]:
    # Local AI's obsProblem: shape checks only; lab pull checks every field against the spec.
    def is_snap(x):
        return isinstance(x, dict) and all(isinstance(x.get(k), dict) for k in ("subject", "outcomes", "source"))
    if kind == "observation":
        snaps = payload.get("snapshots")
        if not isinstance(snaps, list) or not 1 <= len(snaps) <= 8:
            return "An observation session has 1 to 8 snapshots."
        if not all(is_snap(x) for x in snaps):
            return "Each snapshot has a subject, outcomes and a source."
        return None
    if not _full(OBS_ID_RE, payload.get("observation")):
        return "The observation id looks like OBS-0001."
    rev = payload.get("expected_rev")
    if not isinstance(rev, int) or isinstance(rev, bool) or not 1 <= rev <= 2 ** 53 - 1:
        return "expected_rev is the revision you corrected."
    if not is_snap(payload.get("snapshot")):
        return "A correction carries a complete snapshot."
    reason = payload.get("reason")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > MAX_REASON:
        return f"A correction needs a reason of at most {MAX_REASON} characters."
    return None


def request_problem(kind: str, payload: dict, runs_seen: set) -> Optional[str]:
    """What is wrong with a request's payload, or None. A port of Local AI's actProblem / photosProblem / obsProblem.
    runs_seen holds the run ids the request names besides its own run (start's run_seen); each must be a run id."""
    if kind not in KINDS:
        return "kind must be " + ", ".join(KINDS[:-1]) + " or " + KINDS[-1]
    if not isinstance(payload, dict):
        return "payload must be an object"
    if kind in ACT_KINDS:
        return _act_problem(kind, payload, runs_seen)
    if kind == "photos":
        return _photos_problem(payload)
    if kind in OBS_KINDS:
        return _obs_problem(kind, payload)
    return None


def _stored_payload(kind: str, payload: dict) -> dict:
    # As Local AI stores them: the buttons keep only what lab pull reads, the reason trimmed.
    if kind == "start":
        return {"tapped_at": payload["tapped_at"]}
    if kind == "abandon":
        return {"reason": payload["reason"].strip()}
    if kind == "approve":
        return {"reason": payload["reason"].strip(), "build_seen": payload["build_seen"],
                "reasons_seen": payload["reasons_seen"]}
    return payload


@router.post("/{project}/requests")
async def create_request(project: str, request: Request):
    # `by` is who signed in (the person and device need() knows), never what the browser says it is.
    _, by = need(request, "household")
    ready()
    check_project(project)
    if not db.one("SELECT 1 FROM lab_projects WHERE project = ?", project):
        raise HTTPException(404, "No such project.")

    data = _load_request_json(await read_capped(request, MAX_REQUEST))
    if isinstance(data, dict) and data.get("kind") in ACT_KINDS:
        need(request, "owner")  # start, approve and abandon spend the lab's budget or move the printer
    return JSONResponse(queue_request(project, data, by))


def queue_request(project: str, data: dict, by: str) -> dict:
    """Checks one request as Local AI's queueRequest does and queues it for the Mac's lab pull: {ok, id, status}, or
    HTTPException. An id sent again is one request: its stored status comes back and nothing else changes. Used by
    the lab page's route and the workshop display's Judge it; the caller checks who may send and that the project
    exists. `by` is who sent it (the signed-in device, or "display")."""
    ready()
    if not isinstance(data, dict):
        raise HTTPException(400, "Invalid JSON request body")

    req_id = data.get("id")
    kind = data.get("kind")
    experiment = data.get("experiment")
    run = data.get("run")
    run_seen = data.get("run_seen")
    payload = data.get("payload")

    # Local AI's limits, measured on the request as compact JSON before anything else (as Local AI does): 16 KB for
    # observations, 4 KB for the rest, whatever else is wrong with it.
    observing = isinstance(kind, str) and kind in OBS_KINDS
    if len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()) > \
            (MAX_OBS_REQUEST if observing else MAX_KIND_REQUEST):
        raise HTTPException(413, "Too large for the print lab: " + ("16 KB" if observing else "4 KB") + " at most.")
    if not isinstance(kind, str) or kind not in KINDS:
        raise HTTPException(400, request_problem("", {}, set()))
    acting = kind in ACT_KINDS
    if not _full(REQUEST_ID_RE, req_id):
        raise HTTPException(400, "Request id must look like rq-0123456789abcdef")
    if not _full(ACT_EXPERIMENT_RE if acting else EXPERIMENT_ID_RE, experiment):
        raise HTTPException(400, "Invalid experiment id")
    # The buttons' requests are about the experiment, not a run: lab pull refuses any run that isn't a print run id.
    if acting:
        run = None
    elif not _full(RUN_ID_RE, run):
        raise HTTPException(400, "Invalid run id")
    if kind == "start" and run_seen is not None and not isinstance(run_seen, str):
        raise HTTPException(400, "Invalid run id")
    runs_seen = {run_seen} if kind == "start" and run_seen is not None else set()
    problem = request_problem(kind, payload, runs_seen)
    if problem:
        raise HTTPException(400, problem)

    existing = db.one("SELECT id, status FROM lab_requests WHERE id = ?", req_id)
    if existing:
        return {"ok": True, "id": req_id, "status": existing["status"]}

    pending_count = db.one("SELECT COUNT(*) as c FROM lab_requests WHERE project = ? AND status = 'pending'", project)["c"]
    if pending_count >= MAX_PENDING:
        raise HTTPException(429, "The Mac hasn't picked up the last 20 requests. Check that the Mac is awake.")
    total_pending = db.one("SELECT COUNT(*) as c FROM lab_requests WHERE status = 'pending'")["c"]
    if total_pending >= MAX_PENDING_TOTAL:
        raise HTTPException(429, f"The Mac hasn't picked up the last {MAX_PENDING_TOTAL} requests across all projects. "
                                 "Check that the Mac is awake.")

    try:
        db.run(
            "INSERT INTO lab_requests (id, project, kind, experiment, run, run_seen, payload, status, created_at, "
            "by_device) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            req_id, project, kind, experiment, run or "", run_seen if kind == "start" else None,
            json.dumps(_stored_payload(kind, payload)), now_iso(), (by or "")[:80]
        )
    except sqlite3.IntegrityError:  # the same id, sent twice at once from another thread: still one request
        existing = db.one("SELECT status FROM lab_requests WHERE id = ?", req_id)
        if not existing:
            raise
        return {"ok": True, "id": req_id, "status": existing["status"]}

    return {"ok": True, "id": req_id, "status": "pending"}


def queue_one_tap(project: str, experiment: str, payload: dict, by: str) -> str:
    """Queue Pi Hub's own record of a one-tap start for lab pull (A12 plan, decision 6): the request id. The caller
    has already started the print; this only tells the lab, so it never refuses for the pending caps."""
    import secrets
    ready()
    check_project(project)
    if not _full(ACT_EXPERIMENT_RE, experiment):
        raise ValueError("Invalid experiment id")
    req_id = "rq-" + secrets.token_hex(8)
    db.run(
        "INSERT INTO lab_requests (id, project, kind, experiment, run, run_seen, payload, status, created_at, "
        "by_device) VALUES (?, ?, 'one_tap', ?, '', NULL, ?, 'pending', ?, ?)",
        req_id, project, experiment, json.dumps(payload), now_iso(), (by or "")[:80])
    return req_id


@router.get("/{project}/requests")
def list_requests(project: str, request: Request, status: Optional[str] = None):
    # The pending queue is the Mac's (its key only); the recent history is for people, or the Mac with its key.
    if status == "pending":
        require_mac(request)
    elif not mac_key_ok(request):
        need(request, "household")
    ready()
    check_project(project)
    if status == "pending":
        rows = db.rows(
            "SELECT id, kind, experiment, run, run_seen, payload, status, created_at, by_device "
            "FROM lab_requests WHERE project = ? AND status = 'pending' ORDER BY created_at ASC",
            project
        )
        items = []
        for r in rows:
            item = {
                "id": r["id"],
                "kind": r["kind"],
                "experiment": r["experiment"],
                "run": None if r["kind"] in ACT_KINDS + HUB_KINDS else r["run"],
                "payload": json.loads(r["payload"]) if r["payload"] else {},
                "status": r["status"],
                "at": r["created_at"],
                "by": r["by_device"]
            }
            if r["kind"] == "start":
                item["run_seen"] = r["run_seen"]
            items.append(item)
        return JSONResponse({"items": items})

    rows = db.rows(
        "SELECT id, kind, experiment, status, message, created_at "
        "FROM lab_requests WHERE project = ? ORDER BY created_at DESC LIMIT 50",
        project
    )
    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "kind": r["kind"],
            "experiment": r["experiment"],
            "status": r["status"],
            "message": r["message"],
            "at": r["created_at"]
        })
    return JSONResponse({"items": items})


@router.post("/{project}/requests/{req_id}/result")
async def post_request_result(project: str, req_id: str, request: Request):
    require_mac(request)
    ready()
    check_project(project)

    if not _full(REQUEST_ID_RE, req_id):
        raise HTTPException(404, "No such request.")

    data = _load_request_json(await read_capped(request, MAX_REQUEST))
    if not isinstance(data, dict):
        raise HTTPException(400, "Invalid JSON request body")

    result_status = data.get("status")
    if result_status not in ("applied", "refused", "duplicate"):
        raise HTTPException(422, "status must be applied, refused, or duplicate")
    message = data.get("message")
    if message is not None and not isinstance(message, str):
        raise HTTPException(400, "message must be text")

    row = db.one("SELECT id, kind, payload FROM lab_requests WHERE id = ? AND project = ?", req_id, project)
    if not row:
        raise HTTPException(404, f"No request {req_id}.")

    db.run(
        "UPDATE lab_requests SET status = ?, message = ?, resolved_at = ? WHERE id = ? AND project = ?",
        result_status, message or None, now_iso(), req_id, project
    )

    if result_status == "applied" and row["kind"] == "photos":
        _remove_incoming(project, row["payload"])

    return JSONResponse({"ok": True})


def _remove_incoming(project: str, payload_json: Optional[str]):
    """Deletes incoming/<sha256>.jpg for each photo of an applied request. The sha256 is checked again here, whatever
    the stored row says, and the path must still sit directly in incoming/: nothing else can be reached."""
    try:
        photos = (json.loads(payload_json or "{}") or {}).get("photos")
    except (ValueError, AttributeError):
        return
    if not isinstance(photos, list):
        return
    idir = incoming_dir(project)
    for p in photos:
        sha = p.get("sha256") if isinstance(p, dict) else None
        if not _full(SHA_RE, sha):
            continue
        target = idir / f"{sha}.jpg"
        if target.parent != idir:
            continue
        try:
            target.unlink()
        except OSError:
            pass


@router.put("/{project}/incoming/{sha_ext}")
async def upload_incoming_photo(project: str, sha_ext: str, request: Request):
    need(request, "household")
    check_project(project)
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(400, "Name an incoming photo by its sha256: <sha256>.jpg")
    sha = sha_ext[:-4]
    if not _full(SHA_RE, sha):
        raise HTTPException(400, "Name an incoming photo by its sha256: <sha256>.jpg")
    ready()
    if not db.one("SELECT 1 FROM lab_projects WHERE project = ?", project):
        raise HTTPException(404, "No such project.")
    _check_disk()

    body = await read_capped(request, MAX_PHOTO)
    if len(body) < 2 or body[0] != 0xFF or body[1] != 0xD8:
        raise HTTPException(415, "Only JPEG photos.")
    if hashlib.sha256(body).hexdigest() != sha:
        raise HTTPException(422, "The photo doesn't match its sha256.")

    idir = incoming_dir(project)
    idir.mkdir(parents=True, exist_ok=True)
    _prune_incoming()
    target = idir / f"{sha}.jpg"
    if target.exists():
        try:
            os.utime(target)   # a re-upload keeps it for another week
        except OSError:
            pass
    else:
        files = _incoming_files()
        if len(files) >= MAX_INCOMING_FILES:
            raise HTTPException(413, f"Too many waiting photos in all ({MAX_INCOMING_FILES} at most); apply or wait a week for old ones to clear.")
        used = sum(f.stat().st_size for f in files)
        if used + len(body) > MAX_INCOMING_BYTES:
            raise HTTPException(413, "The waiting photos would pass 500 MiB in all; apply or wait a week for old ones to clear.")
        tmp = idir / f"{sha}.tmp"
        tmp.write_bytes(body)
        tmp.replace(target)

    return JSONResponse({"ok": True})


@router.get("/{project}/incoming/{sha_ext}")
def get_incoming_photo(project: str, sha_ext: str, request: Request):
    require_mac(request)
    check_project(project)
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(404, "No such photo.")
    sha = sha_ext[:-4]
    if not _full(SHA_RE, sha):
        raise HTTPException(404, "No such photo.")
    target = incoming_dir(project) / f"{sha}.jpg"
    if not target.exists():
        raise HTTPException(404, "No such photo.")
    return FileResponse(target, media_type="image/jpeg")
