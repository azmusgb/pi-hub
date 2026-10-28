"""Print Lab backend engine: stores index projections, specimen photos, and operator requests.
Compatible with print-lab sync and pull (schema print-lab-index/1)."""
import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from . import db

router = APIRouter(prefix="/api/lab")

SCHEMA_VERSION = "print-lab-index/1"
PROJECT_RE = re.compile(r"^[a-z0-9-]{1,40}$")
ID_RE = re.compile(r"^[A-Z]{1,4}-\d{1,6}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
REQUEST_ID_RE = re.compile(r"^rq-[0-9a-f]{16}$")
EXPERIMENT_ID_RE = re.compile(r"^[A-Z]{1,4}-\d{1,6}(-\d{2})?$")
RUN_ID_RE = re.compile(r"^[A-Z]{1,4}-\d{1,6}(-\d{2})?$")

MAX_SYNC = 4 * 1024 * 1024       # 4 MB
MAX_PHOTO = 8 * 1024 * 1024      # 8 MB
MAX_REQUEST = 4 * 1024           # 4 KB
MAX_RECORDS = 2000
MAX_PENDING = 20

KEY_FILE = os.environ.get("HUB_MAC_KEY_FILE", "/etc/pi-hub/secrets/mac_key")

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
        _ready_dbs.add(path)


def lab_dir() -> Path:
    return Path(os.environ.get("HUB_LAB_DIR", "/var/lib/pi-hub/lab"))


def photo_dir(project: str) -> Path:
    return lab_dir() / project / "photos"


def incoming_dir(project: str) -> Path:
    return lab_dir() / project / "incoming"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expected_key_hash() -> Optional[str]:
    env_hash = os.environ.get("HUB_MAC_KEY_SHA256")
    if env_hash:
        return env_hash.strip().lower()
    if os.path.exists(KEY_FILE):
        try:
            with open(KEY_FILE) as f:
                content = f.read().strip()
                if content:
                    return hashlib.sha256(content.encode()).hexdigest().lower()
        except OSError:
            pass
    # Local development fallback
    home_key = Path.home() / ".claude" / "localai-chat" / "mac.key"
    if home_key.exists():
        try:
            raw = home_key.read_text().strip()
            if raw:
                return hashlib.sha256(raw.encode()).hexdigest().lower()
        except OSError:
            pass
    return None


def verify_mac_key(request: Request) -> bool:
    key = request.headers.get("x-localai-mac-key") or request.headers.get("x-hub-mac-key")
    if not key:
        return False
    expected = _expected_key_hash()
    if not expected:
        return False
    h = hashlib.sha256(key.strip().encode()).hexdigest().lower()
    return hmac.compare_digest(h, expected)


def parse_iso(ts_str: str) -> Optional[float]:
    try:
        dt = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def check_project(project: str):
    if not PROJECT_RE.match(project):
        raise HTTPException(400, "Invalid project name")


@router.get("/projects")
def list_projects():
    ready()
    rows = db.rows("SELECT project, meta FROM lab_projects ORDER BY project")
    projects = []
    for r in rows:
        meta = json.loads(r["meta"]) if r["meta"] else {}
        projects.append({"name": r["project"], **meta})
    return JSONResponse({"projects": projects})


@router.get("/{project}")
def get_project(project: str):
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
    ready()
    check_project(project)
    if not verify_mac_key(request):
        raise HTTPException(401, "Only the Mac (lab sync) writes the print lab.")

    body = await request.body()
    if len(body) > MAX_SYNC:
        raise HTTPException(413, "Too large for the print lab.")
    try:
        ix = json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Invalid JSON request body")

    if not isinstance(ix, dict) or ix.get("schema") != SCHEMA_VERSION:
        raise HTTPException(422, f"Expected schema {SCHEMA_VERSION}; update the lab on the Mac.")
    if ix.get("project") != project:
        raise HTTPException(422, f"The push is for {ix.get('project')}, not {project}.")

    gen_at = parse_iso(ix.get("generated_at"))
    if gen_at is None:
        raise HTTPException(422, "generated_at is missing or not a date.")

    records = ix.get("records")
    if not isinstance(records, dict):
        records = {}
    ids = list(records.keys())
    if len(ids) > MAX_RECORDS or any(not ID_RE.match(i) for i in ids):
        raise HTTPException(422, "Record ids must look like E-001 or Q-001.")

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
def list_photos(project: str):
    check_project(project)
    pdir = photo_dir(project)
    if not pdir.exists():
        return JSONResponse({"have": []})
    have = [f.stem for f in pdir.glob("*.jpg") if SHA_RE.match(f.stem)]
    return JSONResponse({"have": have})


@router.put("/{project}/photos/{sha_ext}")
async def upload_photo(project: str, sha_ext: str, request: Request):
    check_project(project)
    if not verify_mac_key(request):
        raise HTTPException(401, "Only the Mac (lab sync) writes the print lab.")
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(400, "Name a photo by its sha256: <sha256>.jpg")
    sha = sha_ext[:-4]
    if not SHA_RE.match(sha):
        raise HTTPException(400, "Name a photo by its sha256: <sha256>.jpg")

    body = await request.body()
    if len(body) > MAX_PHOTO:
        raise HTTPException(413, "Too large for the print lab.")
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
def get_photo(project: str, sha_ext: str):
    check_project(project)
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(404, "No such photo.")
    sha = sha_ext[:-4]
    if not SHA_RE.match(sha):
        raise HTTPException(404, "No such photo.")
    target = photo_dir(project) / f"{sha}.jpg"
    if not target.exists():
        raise HTTPException(404, "No such photo.")
    return FileResponse(target, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})


@router.get("/{project}/record/{rec_id}")
def get_record(project: str, rec_id: str):
    ready()
    check_project(project)
    if not ID_RE.match(rec_id):
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


@router.post("/{project}/requests")
async def create_request(project: str, request: Request):
    ready()
    check_project(project)

    body = await request.body()
    if len(body) > MAX_REQUEST:
        raise HTTPException(413, "Too large for the print lab.")
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Invalid JSON request body")

    if not isinstance(data, dict):
        raise HTTPException(400, "Invalid JSON request body")

    req_id = data.get("id") or ""
    kind = data.get("kind") or ""
    experiment = data.get("experiment") or ""
    run = data.get("run") or ""
    payload = data.get("payload")

    if not REQUEST_ID_RE.match(req_id):
        raise HTTPException(422, "Request id must look like rq-0123456789abcdef")
    if kind not in ("verdict", "photos"):
        raise HTTPException(422, "kind must be verdict or photos")
    if not EXPERIMENT_ID_RE.match(experiment):
        raise HTTPException(422, "Invalid experiment id")
    if not RUN_ID_RE.match(run):
        raise HTTPException(422, "Invalid run id")
    if not isinstance(payload, dict) or isinstance(payload, list):
        raise HTTPException(422, "payload must be an object")

    existing = db.one("SELECT id, status FROM lab_requests WHERE id = ?", req_id)
    if existing:
        return JSONResponse({"ok": True, "id": req_id, "status": existing["status"]})

    pending_count = db.one("SELECT COUNT(*) as c FROM lab_requests WHERE project = ? AND status = 'pending'", project)["c"]
    if pending_count >= MAX_PENDING:
        raise HTTPException(429, "The Mac hasn't picked up the last 20 requests. Check that the Mac is awake.")

    device = request.headers.get("user-agent", "Browser")[:50]
    now_str = now_iso()

    db.run(
        "INSERT INTO lab_requests (id, project, kind, experiment, run, payload, status, created_at, by_device) "
        "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
        req_id, project, kind, experiment, run, json.dumps(payload), now_str, device
    )

    return JSONResponse({"ok": True, "id": req_id, "status": "pending"})


@router.get("/{project}/requests")
def list_requests(project: str, request: Request, status: Optional[str] = None):
    ready()
    check_project(project)
    if status == "pending":
        if not verify_mac_key(request):
            raise HTTPException(401, "Only the Mac reads pending requests.")
        rows = db.rows(
            "SELECT id, kind, experiment, run, payload, status, created_at, by_device "
            "FROM lab_requests WHERE project = ? AND status = 'pending' ORDER BY created_at ASC",
            project
        )
        items = []
        for r in rows:
            items.append({
                "id": r["id"],
                "kind": r["kind"],
                "experiment": r["experiment"],
                "run": r["run"],
                "payload": json.loads(r["payload"]) if r["payload"] else {},
                "status": r["status"],
                "at": r["created_at"],
                "by": r["by_device"]
            })
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
    ready()
    check_project(project)
    if not verify_mac_key(request):
        raise HTTPException(401, "Only the Mac writes request results.")

    body = await request.body()
    if len(body) > MAX_REQUEST:
        raise HTTPException(413, "Too large for the print lab.")
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Invalid JSON request body")

    result_status = data.get("status")
    if result_status not in ("applied", "refused", "duplicate"):
        raise HTTPException(422, "status must be applied, refused, or duplicate")

    row = db.one("SELECT id, kind, payload FROM lab_requests WHERE id = ? AND project = ?", req_id, project)
    if not row:
        raise HTTPException(404, f"No request {req_id}.")

    now_str = now_iso()
    message = data.get("message")
    db.run(
        "UPDATE lab_requests SET status = ?, message = ?, resolved_at = ? WHERE id = ? AND project = ?",
        result_status, message, now_str, req_id, project
    )

    if result_status == "applied" and row["kind"] == "photos" and row["payload"]:
        try:
            p_obj = json.loads(row["payload"])
            for p in p_obj.get("photos") or []:
                if p and p.get("sha256"):
                    inc = incoming_dir(project) / f"{p['sha256']}.jpg"
                    if inc.exists():
                        inc.unlink()
        except Exception:
            pass

    return JSONResponse({"ok": True})


@router.put("/{project}/incoming/{sha_ext}")
async def upload_incoming_photo(project: str, sha_ext: str, request: Request):
    check_project(project)
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(400, "Name an incoming photo by its sha256: <sha256>.jpg")
    sha = sha_ext[:-4]
    if not SHA_RE.match(sha):
        raise HTTPException(400, "Name an incoming photo by its sha256: <sha256>.jpg")

    body = await request.body()
    if len(body) > MAX_PHOTO:
        raise HTTPException(413, "Too large for the print lab.")
    if len(body) < 2 or body[0] != 0xFF or body[1] != 0xD8:
        raise HTTPException(415, "Only JPEG photos.")
    if hashlib.sha256(body).hexdigest() != sha:
        raise HTTPException(422, "The photo doesn't match its sha256.")

    idir = incoming_dir(project)
    idir.mkdir(parents=True, exist_ok=True)
    target = idir / f"{sha}.jpg"
    if not target.exists():
        tmp = idir / f"{sha}.tmp"
        tmp.write_bytes(body)
        tmp.replace(target)

    return JSONResponse({"ok": True})


@router.get("/{project}/incoming/{sha_ext}")
def get_incoming_photo(project: str, sha_ext: str, request: Request):
    check_project(project)
    if not verify_mac_key(request):
        raise HTTPException(401, "Only the Mac reads incoming photos.")
    if not sha_ext.endswith(".jpg"):
        raise HTTPException(404, "No such photo.")
    sha = sha_ext[:-4]
    if not SHA_RE.match(sha):
        raise HTTPException(404, "No such photo.")
    target = incoming_dir(project) / f"{sha}.jpg"
    if not target.exists():
        raise HTTPException(404, "No such photo.")
    return FileResponse(target, media_type="image/jpeg")
