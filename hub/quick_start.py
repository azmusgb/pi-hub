"""Quick Print, Prepare and Start (A19 P6; plan decisions 9-13). The only place Quick Print talks to Bambuddy or the printer.

Prepare puts the finished slice into Bambuddy's `quick-print` folder, reads it back and compares the bytes; it never starts
anything. Start is its own tap: the checks of S5 read now, both ticks, the stored file and Bambuddy's copy re-hashed, then
`lab_start`'s order through the one gateway (one command at a time, `printer_control.BUSY`). A Start carries a start
attempt id written to hub.db before any Bambuddy call. A start that was lost, timed out or contradicted becomes Outcome
uncertain and is never retried by anything but the owner, after the printer and queue are read. A restart while a start is
in flight also ends as uncertain (fail closed, never resumed).

Credentials: staging uses its own Bambuddy key (a Library key; Bambuddy has no folder scope, plan decision 9), so this
module enforces the rest: one folder name, an allow-list of calls, and deleting only a file this hub recorded uploading.
Every Bambuddy call goes through `_bb`, so tests use a fake. Nothing here runs G-code or opens a path outside a job's own
slice."""
import hashlib
import http.client
import os
import re
import secrets
import time
import urllib.parse
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from . import auth, bambuddy, db, lab_start, printer_control, quick

router = APIRouter(prefix="/api/quick")

KEY_FILE = os.environ.get("HUB_BAMBUDDY_STAGING_KEY_FILE", "/etc/pi-hub/secrets/bambuddy_staging_key")
FOLDER = "quick-print"  # the only Bambuddy folder Quick Print names (a test keeps it so)
SUPPORTED_VERSION = lab_start.SUPPORTED_VERSION
UPLOAD_TIMEOUT = 600  # seconds for the whole upload; a slice can be tens of MB
CONFIRM_SECONDS = 300  # a start accepted but not seen printing by then is Outcome uncertain (decision 12)
EVERY = 10  # seconds between reconcile passes, only while a start is in flight
RUNNING = ("RUNNING", "PREPARE")
# Every Bambuddy call Quick Print may make; anything else is refused before it leaves this module.
CALLS = [("GET", r"/updates/version"), ("GET", r"/library/folders"), ("POST", r"/library/folders"),
         ("GET", r"/library/files/\d+/download"), ("DELETE", r"/library/files/\d+"), ("GET", r"/queue/\d+"),
         ("POST", r"/queue/"), ("POST", r"/queue/\d+/start"), ("DELETE", r"/queue/\d+")]
FILAMENT_TYPE = re.compile(rb'<filament\b[^>]*?\btype="([A-Za-z0-9 +-]{1,20})"')
SCHEMA = """
CREATE TABLE IF NOT EXISTS quick_bb_files (
  file_id INTEGER PRIMARY KEY, job TEXT NOT NULL, filename TEXT NOT NULL, sha256 TEXT NOT NULL, created INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quick_starts (
  attempt TEXT PRIMARY KEY, job TEXT NOT NULL, device TEXT, tapped INTEGER NOT NULL, phase TEXT NOT NULL,
  queue_item INTEGER, accepted INTEGER, result TEXT, ended INTEGER
);
CREATE INDEX IF NOT EXISTS quick_starts_job ON quick_starts(job);
"""
_ready_dbs: set = set()


def ready():
    quick.ready()
    path = os.environ.get("HUB_DB", "")
    if path not in _ready_dbs:
        db.conn().executescript(SCHEMA)
        _ready_dbs.add(path)


def staging_key() -> str:
    try:
        with open(KEY_FILE) as f:
            return f.read().strip()
    except OSError:
        return ""


def _bb(method: str, path: str, key: str, body=None, call=None):
    """One allow-listed Bambuddy call: (status, bytes), status 0 when it doesn't answer. Raises PermissionError for a call
    Quick Print isn't allowed to make, before anything is sent."""
    if not any(method == m and re.fullmatch(p, path) for m, p in CALLS):
        raise PermissionError(f"Quick Print may not call {method} {path}")
    return (call or lab_start._call)(method, path, key, body)


def _json(raw):
    return lab_start._json(raw)


def _sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def upload_file(path: Path, folder_id: int, key: str, filename: str) -> tuple[int, bytes]:
    """The slice as a multipart upload into one folder, streamed from disk. (status, body); status 0 on no answer."""
    boundary = secrets.token_hex(16)
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n").encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    u = urllib.parse.urlsplit(bambuddy.URL)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=UPLOAD_TIMEOUT)
    try:
        conn.putrequest("POST", f"/api/v1/library/files/?folder_id={int(folder_id)}")
        conn.putheader("X-API-Key", key)
        conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        conn.putheader("Content-Length", str(len(head) + path.stat().st_size + len(tail)))
        conn.endheaders()
        conn.send(head)
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                conn.send(chunk)
        conn.send(tail)
        r = conn.getresponse()
        return r.status, r.read()
    except Exception:
        return 0, b""
    finally:
        conn.close()


def filament_types(path: Path) -> list[str]:
    """The filament types the slice uses, as Studio wrote them in the 3MF's own slice_info.config; [] if it doesn't say."""
    try:
        with zipfile.ZipFile(path) as z:
            info = z.getinfo("Metadata/slice_info.config")
            if info.file_size > 1 << 20:
                return []
            raw = z.read(info)
    except (OSError, KeyError, zipfile.BadZipFile):
        return []
    seen: list[str] = []
    for m in FILAMENT_TYPE.finditer(raw):
        t = m.group(1).decode().strip().upper()
        if t and t not in seen:
            seen.append(t)
    return seen


def material_refusals(job: dict, printer: dict | None) -> list[str]:
    """No filament named in the slice, or none of it loaded in the printer, blocks Start; the owner still ticks that
    the filament matches."""
    path = quick.slice_path(job)
    types = filament_types(path) if path else []
    if not types:
        return ["The sliced file doesn't say what filament it needs. Slice it again."]
    trays = [str(t.get("type") or "").strip().upper() for t in (printer or {}).get("ams_trays") or [] if isinstance(t, dict)]
    if not trays:
        return ["The hub can't see what filament is loaded."]
    missing = [t for t in types if t not in trays]
    if missing:
        return [f"The slice needs {', '.join(missing)}; the printer has {', '.join(sorted(set(trays)))} loaded."]
    return []


def refusals(job: dict, printer: dict | None, ignore_bed: bool = False) -> list[str]:
    out = []
    if job["state"] != "staged":
        out.append("This job isn't prepared: Prepare it first.")
    return out + lab_start.printer_refusals(printer, ignore_bed) + material_refusals(job, printer)


def bed_only(job: dict, printer: dict | None) -> bool:
    bed = (printer or {}).get("bed_temp")
    return (isinstance(bed, (int, float)) and not isinstance(bed, bool) and bed >= lab_start.BED_MAX_C
            and bool(refusals(job, printer)) and not refusals(job, printer, ignore_bed=True))


# ---- Prepare ---------------------------------------------------------------------------------------------------------

def _folder(key: str, call) -> tuple[int | None, str]:
    """The id of the `quick-print` folder, made if there is none; (None, why) when it can't be told."""
    st, raw = _bb("GET", "/library/folders", key, call=call)
    folders = _json(raw) if st == 200 else None
    if not isinstance(folders, list):
        return None, "Bambuddy's folder list isn't readable." if st else "Bambuddy isn't answering."
    mine = [f for f in folders if isinstance(f, dict) and f.get("name") == FOLDER and not f.get("is_external")
            and f.get("parent_id") is None]
    if len(mine) > 1:
        return None, f"Bambuddy has more than one '{FOLDER}' folder; remove the extra one."
    if mine and isinstance(mine[0].get("id"), int):
        return mine[0]["id"], ""
    st, raw = _bb("POST", "/library/folders", key, {"name": FOLDER}, call=call)
    made = _json(raw) if st in (200, 201) else None
    if isinstance(made, dict) and isinstance(made.get("id"), int):
        return made["id"], ""
    return None, "Bambuddy refused the staging key a folder." if st in (401, 403) else f"Bambuddy couldn't make the '{FOLDER}' folder."


def _delete_own(file_id: int, key: str, call) -> bool:
    """Delete one Bambuddy file, only if this hub recorded uploading it. True once it is gone (or already was)."""
    row = db.one("SELECT file_id, deleted FROM quick_bb_files WHERE file_id = ?", file_id)
    if not row:
        return False  # not ours: never deleted
    if row["deleted"]:
        return True
    st, _ = _bb("DELETE", f"/library/files/{int(file_id)}", key, call=call)
    if st in (200, 204, 404):
        db.run("UPDATE quick_bb_files SET deleted = 1 WHERE file_id = ?", file_id)
        return True
    return False


def prepare(job_id: str, role: str, device: str, call=None, uploader=None) -> dict:
    """Upload, read back, compare. {"ok", "say", "job"}; the job is Prepared (staged) only when every check passed."""
    ready()
    uploader = uploader or upload_file
    job = quick.get(job_id)
    if job["state"] != "sliced":
        raise quick.QuickError(409, f"A {job['state']} job can't be prepared.", state=job["state"])
    key = staging_key()
    if not key:
        raise quick.QuickError(503, "The hub can't stage files yet: its Bambuddy staging key isn't set up (docs/operations.md).")
    path = quick.slice_path(job)
    if not path or not path.is_file():
        raise quick.QuickError(409, "The stored slice is gone; slice again.")
    if _sha_file(path) != job["slice_sha256"]:
        raise quick.QuickError(409, "The stored slice doesn't match the hash recorded when it was sliced. Slice again.")
    st, raw = _bb("GET", "/updates/version", lab_start.read_key(), call=call)
    version = (_json(raw) or {}).get("version") if st == 200 and isinstance(_json(raw), dict) else None
    if version != SUPPORTED_VERSION:
        raise quick.QuickError(409, f"Bambuddy is {version or 'not answering'}; Quick Print is proven on {SUPPORTED_VERSION} only. "
                                    "Nothing was sent.")
    job = quick.transition(job_id, "staging", expect="sliced", reason=None)  # also refuses a stale or removed slice
    file_id = None
    why = ""
    try:
        folder, why = _folder(key, call)
        if folder is None:
            raise RuntimeError(why)
        name = f"quick_{job_id}.gcode.3mf"
        st, raw = uploader(path, folder, key, name)
        up = _json(raw) if st in (200, 201) else None
        if not isinstance(up, dict) or not isinstance(up.get("id"), int):
            raise RuntimeError("Bambuddy refused the staging key a file." if st in (401, 403)
                               else f"Bambuddy didn't accept the upload ({st or 'no answer'}).")
        if up.get("duplicate_of") is not None:
            raise RuntimeError("Bambuddy already holds an identical file. Nothing of Bambuddy's was changed; "
                               "remove it in Bambuddy, then Prepare again.")
        file_id = up["id"]
        db.run("INSERT OR REPLACE INTO quick_bb_files (file_id, job, filename, sha256, created, deleted) VALUES (?, ?, ?, ?, ?, 0)",
               file_id, job_id, name, job["slice_sha256"], int(time.time()))
        st, raw = _bb("GET", f"/library/files/{file_id}/download", lab_start.read_key(), call=call)
        if st != 200:
            raise RuntimeError(f"Bambuddy wouldn't give the file back to compare ({st or 'no answer'}).")
        if hashlib.sha256(raw).hexdigest() != job["slice_sha256"]:
            raise RuntimeError("Bambuddy's copy isn't the file that was uploaded.")
    except (RuntimeError, PermissionError) as e:
        gone = True if file_id is None else _delete_own(file_id, key, call)
        say = str(e) + ("" if gone else f" The uploaded file (Bambuddy library id {file_id}) is still in Bambuddy: "
                                       "remove it there.")
        quick.transition(job_id, "sliced", expect="staging", reason=say[:300], bambuddy_file_id=None if gone else str(file_id),
                         awaiting_cleanup=0 if gone else 1)
        auth.log(role, device, f"quick:prepare:{job_id}", f"failed: {say}")
        return {"ok": False, "say": say, "job": quick.public(quick.get(job_id))}
    quick.transition(job_id, "staged", expect="staging", reason=None, bambuddy_file_id=str(file_id), awaiting_cleanup=0)
    auth.log(role, device, f"quick:prepare:{job_id}", f"prepared as Bambuddy file {file_id}")
    return {"ok": True, "say": "Prepared. The file is in Bambuddy and matches the slice byte for byte; nothing has started.",
            "job": quick.public(quick.get(job_id))}


def unprepare(job_id: str, role: str, device: str, call=None) -> dict:
    """Take a prepared file back out of Bambuddy (only one this hub uploaded) and return the job to Sliced."""
    ready()
    job = quick.get(job_id)
    if job["state"] != "staged":
        raise quick.QuickError(409, f"A {job['state']} job isn't prepared.", state=job["state"])
    fid = int(job["bambuddy_file_id"]) if str(job["bambuddy_file_id"] or "").isdigit() else None
    gone = fid is None or _delete_own(fid, staging_key(), call)
    quick.transition(job_id, "sliced", expect="staged", reason=None if gone else "The file is still in Bambuddy: remove it there.",
                     bambuddy_file_id=None if gone else job["bambuddy_file_id"], awaiting_cleanup=0 if gone else 1)
    auth.log(role, device, f"quick:unprepare:{job_id}", "removed from Bambuddy" if gone else "still in Bambuddy")
    return {"ok": gone, "say": "Removed from Bambuddy." if gone else "Bambuddy wouldn't delete it; remove it there.",
            "job": quick.public(quick.get(job_id))}


# ---- Start -----------------------------------------------------------------------------------------------------------

def _attempt(job_id: str, device: str) -> str:
    a = secrets.token_hex(8)
    db.run("INSERT INTO quick_starts (attempt, job, device, tapped, phase) VALUES (?, ?, ?, ?, 'recorded')",
           a, job_id, (device or "")[:80], int(time.time()))
    return a


def _end_attempt(a: str, phase: str, result: str, **cols):
    sets = {"phase": phase, "result": result[:300], "ended": int(time.time()), **cols}
    db.run(f"UPDATE quick_starts SET {', '.join(k + ' = ?' for k in sets)} WHERE attempt = ?", *sets.values(), a)


def start(job_id: str, role: str, device: str, *, printer_now, ticks: dict, call=None, now=time.time) -> dict:
    """The tap. Raises QuickError (409/400/503) with nothing sent; otherwise {"ok", "say", "state"} after Bambuddy was asked.
    The caller holds no lock: this takes printer_control.BUSY itself."""
    ready()
    if ticks.get("plate_clear") is not True or ticks.get("filament_ok") is not True:
        raise quick.QuickError(400, "Tick both: the plate is clear and dry, and the filament matches.")
    job = quick.get(job_id)
    if job["state"] != "staged":
        raise quick.QuickError(409, f"The job is {job['state']}, not prepared. Nothing was sent.", state=job["state"])
    busy = printer_control.hold("quick start")
    if busy is not None:
        raise quick.QuickError(409, "The hub is already sending the printer a command. Wait a moment.")
    try:
        job = quick.get(job_id)  # read again under the lock: two taps, one winner
        if job["state"] != "staged":
            raise quick.QuickError(409, f"The job is {job['state']}, not prepared. Nothing was sent.", state=job["state"])
        reasons = refusals(job, printer_now())
        if reasons:
            raise quick.QuickError(409, " ".join(reasons) + " Nothing was sent.")
        ck, rk = lab_start.control_key(), lab_start.read_key()
        if not ck:
            raise quick.QuickError(503, printer_control._say("no key"))
        st, raw = _bb("GET", "/updates/version", rk, call=call)
        d = _json(raw)
        version = d.get("version") if st == 200 and isinstance(d, dict) else None
        if version != SUPPORTED_VERSION:
            raise quick.QuickError(409, f"Bambuddy is {version or 'not answering'}; Start is proven on {SUPPORTED_VERSION} only. "
                                        "Nothing was sent.")
        path = quick.slice_path(job)
        if not path or not path.is_file() or _sha_file(path) != job["slice_sha256"]:
            raise quick.QuickError(409, "The stored slice isn't the one that was prepared. Nothing was sent.")
        fid = job["bambuddy_file_id"]
        if not str(fid or "").isdigit():
            raise quick.QuickError(409, "The job has no Bambuddy file. Prepare it again. Nothing was sent.")
        st, raw = _bb("GET", f"/library/files/{int(fid)}/download", rk, call=call)
        if st != 200:
            raise quick.QuickError(409, f"Bambuddy no longer has the prepared file ({st or 'no answer'}). Prepare again. Nothing was sent.")
        if hashlib.sha256(raw).hexdigest() != job["slice_sha256"]:
            raise quick.QuickError(409, "Bambuddy's copy isn't the file that was prepared. Nothing was sent; Prepare again.")
        return _send(job, int(fid), ck, role, device, call, now)
    finally:
        printer_control.release()


def _send(job: dict, fid: int, ck: str, role: str, device: str, call, now) -> dict:
    jid = job["id"]
    attempt = _attempt(jid, device)  # on disk before any Bambuddy call that could start something
    st, raw = _bb("POST", "/queue/", ck, {"printer_id": lab_start.PRINTER, "library_file_id": fid, "manual_start": True}, call=call)
    d = _json(raw) if st in (200, 201) else None
    item = d.get("id") if isinstance(d, dict) else None
    if not isinstance(item, int):
        say = ("Bambuddy refused the hub's control key (it needs Queue)." if st in (401, 403)
               else f"Bambuddy didn't queue it ({st or 'no answer'}). Nothing was sent.")
        _end_attempt(attempt, "not_queued", say)
        auth.log(role, device, f"quick:start:{jid}", f"refused: {say}")
        raise quick.QuickError(502, say)
    db.run("UPDATE quick_starts SET phase = 'queued', queue_item = ? WHERE attempt = ?", item, attempt)
    quick.transition(jid, "queued_in_bambuddy", expect="staged", queue_item_id=str(item))
    quick.transition(jid, "start_requested", expect="queued_in_bambuddy")  # recorded before the start call
    st, raw = _bb("POST", f"/queue/{item}/start", ck, call=call)
    if 200 <= st < 300:
        db.run("UPDATE quick_starts SET phase = 'accepted', accepted = ? WHERE attempt = ?", int(now()), attempt)
        quick.transition(jid, "start_accepted", expect="start_requested")
        say = "Sent. Bambuddy accepted it; the page says Printing only once the printer shows it."
        auth.log(role, device, f"quick:start:{jid}", f"accepted, queue item {item}, attempt {attempt}")
        return {"ok": True, "say": say, "state": "start_accepted", "queue_item": item}
    refused = 400 <= st < 500 and st not in (408, 429)  # a definite no; anything else may have happened
    if refused:
        gone, _ = _bb("DELETE", f"/queue/{item}", ck, call=call)
        detail = (_json(raw) or {}).get("detail") if isinstance(_json(raw), dict) else None
        why = "the assigned spool doesn't have enough filament" if st == 409 else f"{st}" + (f": {detail}" if isinstance(detail, str) else "")
        if gone in (200, 204, 404):
            _end_attempt(attempt, "refused", why)
            quick.transition(jid, "staged", expect="start_requested", reason=f"Bambuddy didn't start it ({why}).",
                             queue_item_id=None)
            auth.log(role, device, f"quick:start:{jid}", f"refused: {why}")
            raise quick.QuickError(502, f"Bambuddy didn't start it ({why}). The queue item was removed.")
        why += f". Queue item {item} may still be waiting in Bambuddy: cancel it there"
    else:
        why = f"no answer from Bambuddy" if st == 0 else f"Bambuddy answered {st}"
    say = (f"Not sure whether it started ({why}). Look at the printer. Nothing will be retried for you.")
    _end_attempt(attempt, "uncertain", why)
    quick.transition(jid, "outcome_uncertain", expect="start_requested", reason=say[:300])
    auth.log(role, device, f"quick:start:{jid}", f"uncertain: {why}")
    return {"ok": False, "say": say, "state": "outcome_uncertain", "queue_item": item}


def resolve(job_id: str, role: str, device: str, *, printer_now, call=None) -> dict:
    """Owner's way out of Outcome uncertain (decision 13): only when the printer shows nothing of this job running and the
    queue item is gone (or its removal is confirmed). The job goes back to Prepared; the next Start needs a fresh attempt
    and two fresh ticks."""
    ready()
    job = quick.get(job_id)
    if job["state"] != "outcome_uncertain":
        raise quick.QuickError(409, f"The job is {job['state']}, not uncertain.", state=job["state"])
    b = printer_now()
    if not b or not b.get("connected"):
        raise quick.QuickError(409, "The hub can't see the printer, so it can't tell whether anything is running.")
    if str(b.get("bambuddy_state")) in RUNNING or f"quick_{job_id}" in str(b.get("job_name") or ""):
        raise quick.QuickError(409, "The printer is running, or shows this job. Check the printer; if it is printing, confirm it there.")
    item = job["queue_item_id"]
    if str(item or "").isdigit():
        ck = lab_start.control_key()
        st, _ = _bb("GET", f"/queue/{int(item)}", lab_start.read_key(), call=call)
        if st == 200:
            if not ck:
                raise quick.QuickError(503, printer_control._say("no key"))
            gone, _ = _bb("DELETE", f"/queue/{int(item)}", ck, call=call)
            if gone not in (200, 204, 404):
                raise quick.QuickError(409, f"Queue item {item} is still in Bambuddy and couldn't be removed. Cancel it there.")
        elif st not in (404,):
            raise quick.QuickError(409, f"Bambuddy didn't say whether queue item {item} is gone ({st or 'no answer'}).")
    quick.transition(job_id, "staged", expect="outcome_uncertain", reason=None, queue_item_id=None)
    auth.log(role, device, f"quick:resolve:{job_id}", "back to Prepared")
    return {"ok": True, "say": "Back to Prepared. Starting again needs both ticks again.", "job": quick.public(quick.get(job_id))}


# ---- Reconcile -------------------------------------------------------------------------------------------------------

def boot() -> int:
    """A start found in flight when the hub starts is Outcome uncertain, never resumed. Returns how many."""
    ready()
    n = 0
    for j in db.rows("SELECT id FROM quick_jobs WHERE state IN ('start_requested', 'start_accepted')"):
        try:
            quick.transition(j["id"], "outcome_uncertain", reason="The hub restarted while this was starting. Look at the printer.")
            n += 1
        except quick.QuickError:
            pass
    for j in db.rows("SELECT id FROM quick_jobs WHERE state = 'staging'"):  # an upload cut off by the restart
        files = db.rows("SELECT file_id FROM quick_bb_files WHERE job = ? AND deleted = 0", j["id"])
        gone = all(_delete_own(f["file_id"], staging_key(), None) for f in files) if files else True
        try:
            quick.transition(j["id"], "sliced", expect="staging", reason="The hub restarted during Prepare." + ("" if gone else
                             " A file may still be in Bambuddy: remove it there."), awaiting_cleanup=0 if gone else 1)
        except quick.QuickError:
            pass
    return n


def step(printer, now=time.time) -> None:
    """One reconcile pass: a start accepted and seen printing is confirmed; one not seen by CONFIRM_SECONDS is uncertain."""
    ready()
    for j in db.rows("SELECT id, state FROM quick_jobs WHERE state IN ('start_accepted', 'outcome_uncertain')"):
        seen = bool(printer) and str(printer.get("bambuddy_state")) in RUNNING and f"quick_{j['id']}" in str(printer.get("job_name") or "")
        if seen:
            quick.transition(j["id"], "printing_confirmed", reason=None)
            db.run("UPDATE quick_starts SET phase = 'printing', ended = ? WHERE job = ? AND ended IS NULL", int(now()), j["id"])
            continue
        if j["state"] == "start_accepted":
            a = db.one("SELECT accepted FROM quick_starts WHERE job = ? ORDER BY tapped DESC LIMIT 1", j["id"])
            if not a or not a["accepted"] or now() - a["accepted"] >= CONFIRM_SECONDS:
                quick.transition(j["id"], "outcome_uncertain", expect="start_accepted",
                                 reason="Bambuddy accepted the start but the printer wasn't seen printing it. Look at the printer.")


def in_flight() -> bool:
    ready()
    return bool(db.one("SELECT 1 AS x FROM quick_jobs WHERE state IN ('start_accepted', 'outcome_uncertain') LIMIT 1"))


def run(printer_now):
    """The loop: one pass every EVERY seconds while a start is in flight, one exception boundary per pass."""
    while True:
        try:
            if in_flight():
                step(printer_now())
        except Exception:
            import traceback
            traceback.print_exc()
        time.sleep(EVERY)


# ---- Routes (owner only) ---------------------------------------------------------------------------------------------

def _job(job_id: str) -> dict:
    try:
        return quick.get(job_id)
    except quick.QuickError as e:
        raise quick._http(e)


def printer_now():
    from . import sources
    sources._cache.pop("bambuddy_printer", None)  # the printer as it is now, not as the page last saw it
    return sources.bambuddy_printer(timeout=3)


def _fresh(obj, status=200):
    from fastapi.responses import JSONResponse
    return JSONResponse(obj, status_code=status, headers={"Cache-Control": "no-store"})


@router.get("/jobs/{job_id}/start")
def check(job_id: str, request: Request):
    """What the sheet shows before Start: why it can't run now, the hold, the printer and the filament the slice needs."""
    auth.need(request, "owner")
    from . import lab_hold
    ready()
    job, b = _job(job_id), printer_now()
    path = quick.slice_path(job)
    return _fresh({"reasons": refusals(job, b), "bed_only": bed_only(job, b), **lab_hold.quick_state(job_id),
                   "needs": filament_types(path) if path and path.is_file() else [],
                   "printer": {"state": (b or {}).get("bambuddy_state"), "trays": (b or {}).get("ams_trays") or []},
                   "job": quick.public(job)})


@router.post("/jobs/{job_id}/prepare")
def prepare_route(job_id: str, request: Request):
    role, device = auth.need(request, "owner")
    try:
        r = prepare(job_id, role, device)
    except quick.QuickError as e:
        raise quick._http(e)
    return _fresh(r, 200 if r["ok"] else 502)


@router.delete("/jobs/{job_id}/prepare")
def unprepare_route(job_id: str, request: Request):
    role, device = auth.need(request, "owner")
    try:
        return _fresh(unprepare(job_id, role, device))
    except quick.QuickError as e:
        raise quick._http(e)


@router.post("/jobs/{job_id}/start")
async def start_route(job_id: str, request: Request):
    """The tap: owner only, both ticks, the checks now, then Bambuddy's queue. With `wait_for_bed`, when the bed is the only
    thing in the way, it becomes the one hold (A12b) and starts by itself."""
    import asyncio
    from . import lab_hold
    role, device = auth.need(request, "owner")
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise HTTPException(400, "Send both ticks.")
    try:
        if body.get("wait_for_bed") is True:
            job, b = _job(job_id), await asyncio.to_thread(printer_now)
            if refusals(job, b) and bed_only(job, b):
                if body.get("plate_clear") is not True or body.get("filament_ok") is not True:
                    raise quick.QuickError(400, "Tick both: the plate is clear and dry, and the filament matches.")
                try:
                    h = lab_hold.place_quick(job_id, body, role, device)
                except ValueError as e:
                    raise quick.QuickError(409, str(e))
                return _fresh({"ok": True, "held": True, "hold": h,
                               "say": f"Waiting for the bed to cool (it is {b.get('bed_temp'):.0f} °C), then it starts by itself."})
        r = await asyncio.to_thread(lambda: start(job_id, role, device, printer_now=printer_now,
                                                    ticks={"plate_clear": body.get("plate_clear"), "filament_ok": body.get("filament_ok")}))
    except quick.QuickError as e:
        raise quick._http(e)
    return _fresh(r, 200 if r["ok"] else 502)


@router.delete("/jobs/{job_id}/start")
def cancel_hold(job_id: str, request: Request):
    from . import lab_hold
    role, device = auth.need(request, "owner")
    _job(job_id)
    return _fresh({"ok": True, "cancelled": lab_hold.cancel_quick(job_id, role, device)})


@router.post("/jobs/{job_id}/resolve")
def resolve_route(job_id: str, request: Request):
    role, device = auth.need(request, "owner")
    try:
        return _fresh(resolve(job_id, role, device, printer_now=printer_now))
    except quick.QuickError as e:
        raise quick._http(e)
