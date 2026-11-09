"""Start a staged lab print (or a prepared Quick Print, A19 P6) once the bed is cool (amendment A12b, docs/superpowers/specs/2026-11-07-amendment-a12b-bed-hold.md).

When the bed temperature is the only thing S5 refuses, the owner's tap becomes a hold: the request waits in memory,
S5 is read again every EVERY seconds, and the print is sent by lab_start.start when nothing refuses. Anything else
that refuses, a changed staged build, or HOLD_MINUTES passing ends the hold without sending. One hold at a time. A
restart drops it (fail closed). Every end is logged and kept as `last` for the sheet to read.

`run` takes the way to read the printer as it is now, so this module doesn't import the app."""
import threading
import time

from . import auth, lab, lab_start, printer_control, quick, quick_start

HOLD_MINUTES = 45
EVERY = 10  # seconds between checks
_lock = threading.Lock()
_hold = None
_last = None


def _end(h, status, say, queue_item=None):
    """Record how a hold ended: `last` for the sheet, a row in the action log."""
    global _hold, _last
    with _lock:
        if _hold is h:
            _hold = None
        _last = {"project": h["project"], "experiment": h["experiment"], "status": status, "say": say,
                 "queue_item": queue_item, "at": int(time.time())}
    auth.log(h["role"], h["device"], f"printer:hold:{status}:{h['project']}:{h['experiment']}", say)


def place(project, experiment, x, role, device, now=time.time):
    """Hold a start for the bed; the public hold. Raises ValueError (with the owner's words) when it can't."""
    global _hold, _last
    staged = (x or {}).get("staged") if isinstance((x or {}).get("staged"), dict) else {}
    with _lock:
        if _hold is not None:
            raise ValueError(f"Already waiting to start {_hold['experiment'] if _hold['kind'] == 'experiment' else 'a Quick Print'}. "
                             "Cancel that first.")
        t = now()
        _hold = {"kind": "experiment", "project": project, "experiment": experiment, "build": (x or {}).get("shown_build"),
                 "sha": staged.get("sha256"), "role": role, "device": device, "at": t,
                 "expires": t + HOLD_MINUTES * 60, "bed": None}
        _last = None
        h = _hold
    auth.log(role, device, f"printer:hold:placed:{project}:{experiment}",
             f"Waiting for the bed to cool, then starting {experiment} (up to {HOLD_MINUTES} min).")
    return _public(h)


def place_quick(job_id, ticks, role, device, now=time.time):
    """The one hold, for a prepared Quick Print (A19 Q9). The ticks the owner gave at the tap travel with it. Raises
    ValueError (with the owner's words) when it can't."""
    global _hold, _last
    job = quick.get(job_id)
    with _lock:
        if _hold is not None:
            raise ValueError(f"Already waiting to start {_hold['experiment'] if _hold['kind'] == 'experiment' else 'a Quick Print'}. "
                             "Cancel that first.")
        t = now()
        _hold = {"kind": "quick", "project": "quick", "experiment": job_id, "build": None, "sha": job["slice_sha256"],
                 "role": role, "device": device, "at": t, "expires": t + HOLD_MINUTES * 60, "bed": None,
                 "ticks": {"plate_clear": ticks.get("plate_clear"), "filament_ok": ticks.get("filament_ok")}}
        _last = None
        h = _hold
    auth.log(role, device, f"printer:hold:placed:quick:{job_id}",
             f"Waiting for the bed to cool, then starting Quick Print {job_id} (up to {HOLD_MINUTES} min).")
    return _public(h)


def quick_state(job_id):
    return state("quick", job_id)


def cancel_quick(job_id, role, device):
    return cancel("quick", job_id, role, device)


def _step_quick(h, printer_now, now):
    if now() >= h["expires"]:
        return _end(h, "expired", f"Waited {HOLD_MINUTES} minutes for the bed to cool. Nothing was sent.")
    job, b = quick.get(h["experiment"]), printer_now()
    if job["state"] != "staged" or job["slice_sha256"] != h["sha"]:
        return _end(h, "cancelled", "The prepared file changed. Nothing was sent; open Start again.")
    reasons = quick_start.refusals(job, b)
    if reasons:
        if quick_start.bed_only(job, b):
            h["bed"] = b.get("bed_temp")
            return
        return _end(h, "refused", " ".join(reasons) + " Nothing was sent.")
    if printer_control.BUSY.locked():  # another command is in flight; the next pass tries again
        return
    global _hold
    with _lock:
        if _hold is not h:  # cancelled while this pass was checking
            return
        _hold = None  # claimed: a cancel from here on finds nothing to cancel
    try:
        r = quick_start.start(h["experiment"], h["role"], h["device"], printer_now=printer_now, ticks=h["ticks"])
    except quick.QuickError as e:
        return _end(h, "failed", e.message)
    _end(h, "sent" if r["ok"] else "failed", r["say"], r.get("queue_item"))


def _public(h):
    return {"project": h["project"], "experiment": h["experiment"], "build": h["build"], "expires": int(h["expires"]),
            "bed": h["bed"], "minutes": HOLD_MINUTES}


def state(project, experiment):
    """What the sheet reads for one experiment: {"hold": the hold or None, "last": how the last one ended or None}."""
    with _lock:
        h = _hold if _hold and (_hold["project"], _hold["experiment"]) == (project, experiment) else None
        last = _last if _last and (_last["project"], _last["experiment"]) == (project, experiment) else None
        return {"hold": _public(h) if h else None, "last": dict(last) if last else None}


def cancel(project, experiment, role, device):
    """Cancel the hold for this experiment: True when there was one."""
    with _lock:
        h = _hold if _hold and (_hold["project"], _hold["experiment"]) == (project, experiment) else None
    if not h:
        return False
    _end(h, "cancelled", "Cancelled. Nothing was sent.")
    return True


def step(printer_now, now=time.time, start=None):
    """One check of the hold: wait, end it, or send. Never raises past its caller's boundary."""
    global _hold
    with _lock:
        h = _hold
    if not h:
        return
    if now() >= h["expires"]:
        return _end(h, "expired", f"Waited {HOLD_MINUTES} minutes for the bed to cool. Nothing was sent.")
    if h.get("kind") == "quick":
        return _step_quick(h, printer_now, now)
    x, b = lab_start.mirror(h["project"], h["experiment"]), printer_now()
    staged = (x or {}).get("staged") if isinstance((x or {}).get("staged"), dict) else {}
    if staged.get("sha256") != h["sha"] or (x or {}).get("shown_build") != h["build"]:
        return _end(h, "cancelled", "The lab staged a different build. Nothing was sent; open Start again.")
    reasons = lab_start.refusals(b, x)
    if reasons:
        if lab_start.bed_only(b, x):
            h["bed"] = b.get("bed_temp")
            return
        return _end(h, "refused", " ".join(reasons) + " Nothing was sent.")
    if printer_control.hold("start") is not None:  # another command is in flight; the next pass tries again
        return
    try:
        ck = lab_start.control_key()
        if not ck:
            return _end(h, "failed", printer_control._say("no key"))
        with _lock:
            if _hold is not h:  # cancelled while this pass was checking
                return
            _hold = None  # claimed: a cancel from here on finds nothing to cancel
        tapped = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        r = (start or lab_start.start)(x, ck, lab_start.read_key())
    finally:
        printer_control.release()
    if not r["ok"]:
        return _end(h, "failed", r["say"])
    lab.queue_one_tap(h["project"], h["experiment"], {"tapped_at": tapped, "build": x.get("shown_build"),
                                                      "queue_item": r["queue_item"], "library_file": r["library_file"]},
                      h["device"])
    _end(h, "sent", r["say"], r["queue_item"])


def run(printer_now):
    """The loop: one pass every EVERY seconds, one exception boundary per pass."""
    while True:
        try:
            step(printer_now)
        except Exception:
            import traceback
            traceback.print_exc()
        time.sleep(EVERY)
