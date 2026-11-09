"""A19 P8: watching a Quick Print job after Start, how it ends, and Reprint.

The printer's figures are passed on only as it reports them: a missing one is None (never zero), a printer the hub
can't read or that is disconnected is said so, and the figures are shown only while the printer's job name carries this
job's `quick_<id>`. How a print ends comes from Bambuddy's print-log entry for that name (plan decision 14): completed
is `finished` only once the log says so, a failed or cancelled entry is `failed`, two entries for one job or a printer
that has stopped printing it with no entry at all is `outcome_uncertain`, and a log that can't be read changes nothing.
Reprint copies a finished job's stored files into a new `sliced` job after the same checks the slice passed, and says
plainly when retention has removed the files. Nothing here starts, pauses or stops a printer; the page uses the
existing printer actions for that."""
import json
import math
import re
import secrets
import shutil
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import auth, db, quick, quick_check, quick_start
from .quick_worker import _sha_file

END_SECONDS = 600  # the printer stopped printing this job and Bambuddy has logged nothing for this long
FIGURES = (("state", "bambuddy_state"), ("progress", "progress"), ("layer", "layer_num"), ("total_layers", "total_layers"),
           ("remaining_minutes", "remaining_time"), ("nozzle", "nozzle_temp"), ("nozzle_target", "nozzle_target"),
           ("bed", "bed_temp"), ("bed_target", "bed_target"))
ENDED_OK = {"completed"}
ENDED_BAD = {"failed", "cancelled"}
_idle: dict[str, float] = {}  # job id -> first time seen not printing it (this process only; a restart restarts the wait)

router = APIRouter(prefix="/api/quick")


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def names(job_id: str) -> re.Pattern:
    return re.compile(rf"(?<![0-9a-f])quick_{re.escape(job_id)}(?![0-9a-f])")


def entries(job_id: str, prints) -> list[dict]:
    pat = names(job_id)
    return [e for e in prints or [] if pat.search(str(e.get("name") or ""))]


def outcome_of(e: dict) -> dict:
    return {"log_id": e.get("id"), "status": e.get("status"), "word": e.get("word"), "started": e.get("started"),
            "ended": e.get("ended"), "seconds": _num(e.get("seconds")), "grams": _num(e.get("grams")), "error": e.get("error")}


def printing_it(printer, job_id: str) -> bool:
    return (bool(printer) and bool(printer.get("connected")) and str(printer.get("bambuddy_state")) in (*quick_start.RUNNING, "PAUSE")
            and bool(names(job_id).search(str(printer.get("job_name") or ""))))


def step(printer, prints, now=time.time) -> None:
    """One pass over the jobs the printer is printing: end each from its print-log entry, or call it uncertain."""
    quick.ready()
    for j in db.rows("SELECT id FROM quick_jobs WHERE state = 'printing_confirmed'"):
        if prints is None:
            continue  # Bambuddy's log can't be read: nothing is decided from that
        found = entries(j["id"], prints)
        if len(found) > 1:
            quick.transition(j["id"], "outcome_uncertain", expect="printing_confirmed",
                             reason=f"Bambuddy's print log has {len(found)} entries for this job. Look at the printer and the log.")
        elif found and found[0].get("status") in ENDED_OK:
            _idle.pop(j["id"], None)
            quick.transition(j["id"], "finished", expect="printing_confirmed", reason=None, outcome=json.dumps(outcome_of(found[0])))
        elif found and found[0].get("status") in ENDED_BAD:
            _idle.pop(j["id"], None)
            e = found[0]
            quick.transition(j["id"], "failed", expect="printing_confirmed", outcome=json.dumps(outcome_of(e)),
                             reason=f"Bambuddy logged this print as {e.get('word') or e.get('status')}" + (f": {e['error']}" if e.get("error") else "."))
        elif not found and printer and printer.get("connected"):
            if printing_it(printer, j["id"]):
                _idle.pop(j["id"], None)
            else:
                first = _idle.setdefault(j["id"], now())
                if now() - first >= END_SECONDS:
                    _idle.pop(j["id"], None)
                    quick.transition(j["id"], "outcome_uncertain", expect="printing_confirmed",
                                     reason="The printer isn't printing this job and Bambuddy has no print-log entry for it. Look at the printer.")


def figures(printer, job_id: str, now=time.time) -> dict:
    """What the printer reports, as reported. `source` is ok, unavailable (the hub can't read it) or disconnected."""
    base = {"observed": int(now()), "this_job": None, **{k: None for k, _ in FIGURES}}
    if not printer:
        return {**base, "source": "unavailable"}
    if not printer.get("connected"):
        return {**base, "source": "disconnected"}
    mine = printing_it(printer, job_id)
    out = {**base, "source": "ok", "this_job": mine, "state": printer.get("bambuddy_state")}
    if mine:
        for k, src in FIGURES[1:]:
            out[k] = _num(printer.get(src))
    return out


def compare(job: dict, outcome: dict | None) -> dict | None:
    """The slice's estimate beside what the log says happened; each missing figure stays None."""
    if not outcome:
        return None
    info = json.loads(job["slice_info"]) if job.get("slice_info") else {}
    est_min, est_g = _num(info.get("minutes")), _num(info.get("grams"))
    act_s = _num(outcome.get("seconds"))
    return {"estimate_minutes": est_min, "actual_minutes": round(act_s / 60, 1) if act_s is not None else None,
            "estimate_grams": est_g, "actual_grams": _num(outcome.get("grams"))}


def _job(job_id: str, request: Request) -> dict:
    quick._owner(request)
    try:
        return quick.get(job_id)
    except quick.QuickError as e:
        raise quick._http(e)


@router.get("/jobs/{job_id}/monitor")
def monitor(job_id: str, request: Request):
    from . import now
    job = _job(job_id, request)
    printer = quick_start.printer_now()
    fig = figures(printer, job_id)
    outcome = json.loads(job["outcome"]) if job.get("outcome") else None
    live = job["state"] in ("printing_confirmed", "outcome_uncertain")
    return JSONResponse({"job": quick.public(job), "printer": fig if live else None,
                         "actions": now.printer_actions(printer) if live and fig["this_job"] else [],
                         "outcome": outcome, "compare": compare(job, outcome)},
                        headers={"Cache-Control": "no-store"})


@router.post("/jobs/{job_id}/reprint")
def reprint(job_id: str, request: Request):
    who, device = quick._owner(request)
    try:
        src = quick.get(job_id)
    except quick.QuickError as e:
        raise quick._http(e)
    if src["state"] not in ("finished", "failed") or not src.get("outcome"):
        raise HTTPException(409, "Only a job that has printed can be reprinted.")
    mp, sp = quick.model_path(src), quick.slice_path(src)
    if src["file_removed"] or not mp or not sp or not mp.is_file() or not sp.is_file():
        raise HTTPException(409, "Its files were removed to make room, so a reprint needs a new slice: upload the model again.")
    if _sha_file(sp) != src["slice_sha256"] or _sha_file(mp) != src["model_sha256"]:
        raise HTTPException(409, "The stored files no longer match their recorded hashes, so they won't be printed. Upload the model again.")
    ok, reasons, _ = quick_check.check_artifact(sp, quick_check.load_reference())
    if not ok:
        raise HTTPException(409, f"The stored slice no longer passes the start check ({'; '.join(reasons)[:200]}). Slice it again.")
    jid = secrets.token_hex(8)
    mname, sname = f"{jid}{mp.suffix}", f"{jid}.gcode.3mf"
    info = json.loads(src["slice_info"]) if src.get("slice_info") else {}
    info["reprint_of"] = src["id"]
    now_ = int(time.time())
    try:
        with quick._tx() as c:
            quick.admit(src["model_bytes"] + (src["slice_bytes"] or 0))
            quick._dir("models"), quick._dir("slices")
            shutil.copyfile(mp, quick.QUICK_DIR / "models" / mname)
            shutil.copyfile(sp, quick.QUICK_DIR / "slices" / sname)
            c.execute("INSERT INTO quick_jobs (id, state, name, model_sha256, model_file, model_bytes, transform, settings, "
                      "request_hash, sliced_hash, slice_sha256, slice_file, slice_bytes, slice_info, created, updated) "
                      "VALUES (?, 'sliced', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (jid, src["name"], src["model_sha256"], mname, src["model_bytes"], src["transform"], src["settings"],
                       src["request_hash"], src["sliced_hash"], src["slice_sha256"], sname, src["slice_bytes"],
                       json.dumps(info), now_, now_))
    except quick.QuickError as e:
        raise quick._http(e)
    except FileNotFoundError:  # making room removed the very files being copied
        raise HTTPException(409, "Its files were removed to make room, so a reprint needs a new slice: upload the model again.") from None
    except BaseException:
        for p in (quick.QUICK_DIR / "models" / mname, quick.QUICK_DIR / "slices" / sname):
            p.unlink(missing_ok=True)
        raise
    auth.log(who, device, "quick print", f"reprint of {src['id']} as {jid}")
    return JSONResponse({"job": quick.public(quick.get(jid))}, headers={"Cache-Control": "no-store"})
