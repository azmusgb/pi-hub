"""Start a staged lab print (amendment A12; plan docs/superpowers/plans/2026-11-06-a12-one-tap-print.md, P3).

The lab stages a checked build in Bambuddy's print-lab folder and the mirror names it under the experiment's `staged`.
Starting it is one route, owner only, one printer command at a time (printer_control.BUSY):

1. S5, read at the tap (plan decision 3): the printer connected, idle (IDLE or FINISH), no HMS error, bed below 35 °C;
   the experiment ready or approved in the mirror with a staged build; Bambuddy the version this was proven on.
2. S4: the owner ticked "Plate is clear and dry" and "Filament matches".
3. S3: the library file, downloaded with the hub's read key, has the staged sha256.
4. A queue item with manual_start (an item without it would start on its own), then its start, with the control key.
   Any failure after the queue item exists deletes it, so nothing waits in Bambuddy's queue to start later.
5. The device goes in the action log, and a `one_tap` request tells lab pull who started it (S6).

Every Bambuddy call is here, behind `call`, so tests use a fake."""
import hashlib
import json
import urllib.error
import urllib.request

from . import bambuddy, db, printer_control

SUPPORTED_VERSION = "1.3.0"  # the one-tap probe passed on it (print-lab spec, "Probe")
PRINTER = 1
IDLE = ("IDLE", "FINISH")
BED_MAX_C = 35.0
TIMEOUT = 10  # seconds per Bambuddy call; the library file is a few hundred KB


def _call(method, path, key, body=None):
    """(HTTP status, bytes). Status 0 when Bambuddy doesn't answer. Never raises."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{bambuddy.URL}/api/v1{path}", data=data, method=method,
                                 headers={"X-API-Key": key, **({"Content-Type": "application/json"} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() or b""
    except Exception:
        return 0, b""


def _json(raw):
    try:
        return json.loads(raw or b"null")
    except ValueError:
        return None


def mirror(project, experiment):
    """The experiment as the lab's mirror has it, or None."""
    try:
        row = db.one("SELECT index_json FROM lab_projects WHERE project = ?", project)
        idx = json.loads(row["index_json"]) if row else {}
    except Exception:
        return None
    return next((x for x in idx.get("experiments") or [] if isinstance(x, dict) and x.get("id") == experiment), None)


def refusals(printer, x):
    """Why Start can't run now (S5), in the owner's words; empty when it can."""
    out = []
    if not x:
        return ["The print lab has no such experiment."]
    staged = x.get("staged") if isinstance(x.get("staged"), dict) else None
    if x.get("status") not in ("ready", "approved") or not staged:
        out.append(f"{x.get('id')} isn't staged: approve it, then the lab uploads it when the printer has been idle "
                   "10 minutes.")
    elif not isinstance(staged.get("library_file"), int) or not isinstance(staged.get("sha256"), str):
        out.append("The lab's record of the staged file is incomplete. Stage it again on the Mac.")
    if not printer or not printer.get("connected"):
        out.append("Bambuddy can't see the printer.")
        return out
    if printer.get("bambuddy_state") not in IDLE:
        out.append(f"The printer isn't idle ({str(printer.get('bambuddy_state') or 'unknown').lower()}).")
    if printer.get("hms"):
        out.append("The printer has an error. Clear it on the printer first.")
    bed = printer.get("bed_temp")
    if not isinstance(bed, (int, float)):
        out.append("The bed temperature is unknown.")
    elif bed >= BED_MAX_C:
        out.append(f"The bed is {bed:.0f} °C; wait until it is below {BED_MAX_C:.0f} °C.")
    return out


def start(x, control_key, read_key, call=_call):
    """Steps 3-4 for a mirror experiment that passed refusals(): {"ok", "say", "queue_item", "library_file"}."""
    staged = x["staged"]
    fid, want = staged["library_file"], staged["sha256"]
    st, raw = call("GET", "/updates/version", read_key)
    version = (_json(raw) or {}).get("version") if st == 200 else None
    if version != SUPPORTED_VERSION:
        return {"ok": False, "say": f"Bambuddy is {version or 'not answering'}; Start is proven on "
                                    f"{SUPPORTED_VERSION} only. Nothing was sent."}
    st, raw = call("GET", f"/library/files/{int(fid)}/download", read_key)
    if st != 200:
        return {"ok": False, "say": f"Bambuddy no longer has the staged file ({st or 'no answer'}). Stage it again."}
    if hashlib.sha256(raw).hexdigest() != want:
        return {"ok": False, "say": "Bambuddy's copy isn't the build the lab checked. Nothing was sent; stage it "
                                    "again on the Mac."}
    st, raw = call("POST", "/queue/", control_key,
                   {"printer_id": PRINTER, "library_file_id": int(fid), "manual_start": True})
    item = (_json(raw) or {}).get("id") if st in (200, 201) else None
    if not isinstance(item, int):
        return {"ok": False, "say": "Bambuddy refused the hub's control key (it needs Queue)." if st in (401, 403)
                else f"Bambuddy didn't queue it ({st or 'no answer'}). Nothing was sent."}
    st, raw = call("POST", f"/queue/{item}/start", control_key)
    if st not in (200, 201, 204):
        call("DELETE", f"/queue/{item}", control_key)
        detail = (_json(raw) or {}).get("detail")
        why = ("the assigned spool doesn't have enough filament" if st == 409 else
               f"{st or 'no answer'}" + (f": {detail}" if isinstance(detail, str) else ""))
        return {"ok": False, "say": f"Bambuddy didn't start it ({why}). The queue item was removed."}
    return {"ok": True, "say": f"Sent. {x['id']} starts on the printer in a moment.", "queue_item": item,
            "library_file": int(fid)}


def queue_item(item, read_key, call=_call):
    """A queue item as the sheet shows it: {"status", "waiting"} (Bambuddy's own reason it hasn't started, e.g. the
    printer refused the upload), or None when it can't be read."""
    if not isinstance(item, int) or isinstance(item, bool) or item < 1:
        return None
    st, raw = call("GET", f"/queue/{item}", read_key)
    d = _json(raw) if st == 200 else None
    if not isinstance(d, dict):
        return None
    waiting = d.get("waiting_reason")
    return {"status": d.get("status") if isinstance(d.get("status"), str) else None,
            "waiting": waiting[:300] if isinstance(waiting, str) and waiting else None}


def control_key():
    return printer_control._key()


def read_key():
    return (bambuddy.headers() or {}).get("X-API-Key", "")
