"""The printer's record: Bambuddy decides the state; pi-status can only disagree.

Pure: give it what the sources said and the last record, get the new record (or None when
Bambuddy didn't answer, so the hub marks the last one stale).
"""
import re
import time

from .. import records
from ..bambuddy import LAB_NAME
from ..now import printer_actions

FINISHED_AT = 97  # percent; an idle printer that stopped below this didn't finish
FAILED_HOLD = 24 * 3600  # seconds an inferred failure stays failed while Bambuddy keeps saying idle
ATTEMPT_WINDOW = 15 * 60  # seconds in which the same job starting again is another attempt

LABELS = {"clear": "Clear the plate", "pause": "Pause the print", "resume": "Resume the print"}
BAMBUDDY = {"RUNNING": "printing", "PAUSE": "paused", "IDLE": "idle",
            "PREPARE": "printing", "SLICING": "printing", "INIT": "printing"}  # the last three: starting
STARTING = {"PREPARE", "SLICING", "INIT"}  # heating, levelling or slicing before the first layer
UNSURE = ("unknown", "offline")
# what a record carries about its print attempt chain; an unknown or offline record keeps them
CHAIN = ("job", "attempt", "started", "last_progress", "failed_at", "after_failure", "inferred", "from_finished")
CAMERA_ERROR = re.compile(r"snapshot|camera|frame", re.I)  # Bambuddy's failure detection got no picture
PI_STATUS = {"Printing": "printing", "Paused": "paused", "Idle": "idle", "Stopped": "idle", "Error": "failed"}


def _clock(ts):
    return time.strftime("%H:%M", time.localtime(ts))


def _job(name):
    for end in (".gcode.3mf", ".3mf", ".gcode"):
        if name and name.endswith(end):
            return name[:-len(end)]
    return name


def _whole(v):
    """Bambuddy sends progress as a float: 16.0 reads as 16."""
    return int(v) if isinstance(v, float) and v.is_integer() else v


def _pct(v):
    return _whole(v) if isinstance(v, (int, float)) else 0


def _minutes(v):
    """Bambuddy's remaining_time (minutes), or None when it gives none."""
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None


def _raw(b):
    return b.get("bambuddy_state") or b.get("state")


def _state(b, prev, now):
    if not b.get("connected"):
        return "offline"
    raw = _raw(b)
    done = bool(b.get("awaiting_plate_clear"))
    if raw == "FINISH":
        return "finished" if done else "idle"
    if raw == "FAILED":
        return "failed" if done else "idle"
    state = BAMBUDDY.get(raw, "unknown")
    if raw == "INIT" and not b.get("job_name"):  # the printer powering on, not a print starting
        state = "idle"
    if state == "idle" and prev and prev["state"] == "failed" and prev["detail"].get("inferred") \
            and now - _failed_at(prev) < FAILED_HOLD:
        return "failed"
    if state == "idle" and prev and prev["state"] in ("printing", "paused") \
            and _pct(prev["detail"].get("last_progress")) < FINISHED_AT:
        return "failed"
    return state


def _chained(prev):
    """The previous record belongs to a print attempt chain: a print under way, a failure, or the idle
    that directly followed a failure. A plain idle (or a finished plate) never starts a chain."""
    if not prev or prev["detail"].get("from_finished"):
        return False
    return prev["state"] in ("printing", "paused", "failed") or \
        (prev["state"] == "idle" and bool(prev["detail"].get("after_failure")))


def _failed_at(prev):
    return prev["detail"].get("failed_at") or prev["since"]


def _attempt(job, state, prev, now):
    if not _chained(prev) or state not in ("printing", "paused", "failed", "idle"):
        return 1
    count = prev["detail"].get("attempt") or 1
    if state in ("failed", "idle") or prev["state"] in ("printing", "paused"):
        return count
    again = prev["detail"].get("job") == job and now - _failed_at(prev) < ATTEMPT_WINDOW
    return count + 1 if again else 1


def _known(prev):
    """The last record that knew the printer's state: an unknown or offline record carries it in last_known."""
    if prev and prev["state"] in UNSURE:
        return prev["detail"].get("last_known")
    return prev


def _remember(known):
    """What an unknown or offline record keeps of the last known one."""
    if not known:
        return None
    return {"state": known["state"], "since": known["since"], "cause": known.get("cause", ""),
            "detail": {k: known["detail"][k] for k in CHAIN if k in known["detail"]}}


def _headline(state, job, pct, attempt, starting=False):
    again = f", attempt {attempt}" if attempt > 1 else ""
    if state == "printing" and starting:
        return f"Starting {job or 'a print'}" + again
    if state == "printing":
        return f"Printing {job or 'a print'}, {pct}%" + again
    return {"paused": f"Paused at {pct}%", "finished": "Done: clear the plate",
            "failed": f"Stopped at {pct}%: clear the plate", "idle": "Idle",
            "offline": "The printer isn't connected to Bambuddy"}.get(state, "The printer's state isn't known")


def _disagree(s, state):
    said = s.get("x2d_state") if isinstance(s, dict) else None  # an odd answer from pi-status says nothing
    if not said or PI_STATUS.get(said) == state:
        return ""
    if said not in PI_STATUS and state not in ("printing", "paused"):
        return ""  # "No status" while the printer is idle or away isn't a contradiction
    return f"pi-status reports {said}; Bambuddy reports {state}"


def _is_lab_print(job, lab):
    """Local AI's lab names the experiment it last sent to the printer, and keeps calling it live while any print runs
    (IMG_1047, 28 Oct: "Print lab: E-022" over a RIFT print). Only the print's own name says it is that experiment:
    the lab names its prints <project>_<experiment>_<build>."""
    m = LAB_NAME.match(job or "")
    return isinstance(lab, dict) and bool(m) and m["exp"] == lab.get("experiment")


def printer(b, s, lab, prev, now):
    if b is None:
        return None
    prev = _known(prev)  # judge by the last known record: an unknown or offline one in between says nothing
    state = _state(b, prev, now)
    live = state in ("printing", "paused")
    was_live = bool(prev) and prev["state"] in ("printing", "paused")
    was_failed = bool(prev) and prev["state"] == "failed"
    old = prev["detail"] if prev else {}
    job = _job(b.get("job_name")) or (old.get("job") if state in ("failed", "idle") else None)
    pct = _pct(b.get("progress"))
    inferred = state == "failed" and _raw(b) == "IDLE" and (was_live or was_failed)
    if state == "failed" and was_failed:  # still the same stop: keep what we said the first time
        inferred, started, last = bool(old.get("inferred")), old.get("started"), old.get("last_progress", pct)
    elif state == "failed" and was_live:
        inferred, started, last = _raw(b) == "IDLE", old.get("started"), old.get("last_progress", pct)
    else:
        started = (old.get("started") if was_live else None) or (now if live else None)
        last = pct
    attempt = _attempt(job, state, prev, now)
    detail = {"job": job, "progress": _whole(b.get("progress")), "layer": b.get("layer_num"),
              "total_layers": b.get("total_layers"), "nozzle": b.get("nozzle_temp"),
              "nozzle_target": b.get("nozzle_target"), "bed": b.get("bed_temp"),
              "bed_target": b.get("bed_target"), "ams_humidity": b.get("ams_humidity"),
              "filament_type": b.get("filament_type"), "filament_color": b.get("filament_color"),
              "attempt": attempt, "started": started, "last_progress": last, "bambuddy_state": _raw(b),
              "minutes_left": _minutes(b.get("remaining_time"))}
    if inferred:
        detail["inferred"] = True
    if state == "failed":
        detail["failed_at"] = _failed_at(prev) if was_failed else now
    elif state == "idle" and prev and prev["state"] in ("failed", "idle") and (
            prev["state"] == "failed" or prev["detail"].get("after_failure")):
        detail["after_failure"] = True
        detail["failed_at"] = _failed_at(prev)
    # a reprint after a normal finish (cleared or not) is a new print, attempt 1
    if _raw(b) == "FINISH" or (state == "idle" and prev and (prev["state"] == "finished" or (
            prev["state"] == "idle" and old.get("from_finished")))):
        detail["from_finished"] = True
    if state == "printing" and _raw(b) in STARTING:
        detail["starting"] = True
    if state in UNSURE and prev:  # the chain goes on through a gap: keep it, and the record it came from
        for k in CHAIN:
            detail.pop(k, None)
        detail.update({k: old[k] for k in CHAIN if k in old})
        detail["last_known"] = _remember(prev)
    if live and _is_lab_print(job, lab):
        detail["lab"] = lab
    if state == "failed" and was_failed:
        cause = prev["cause"]
    elif state == "failed":
        mins = int((now - started) // 60) if started else 0
        cause = f"Stopped at {_clock(now)} after {mins} min; the printer gave no reason."
    else:
        cause = ""
    actions = [{"name": a, "label": LABELS[a], "confirm": False} for a in printer_actions(b)]
    pct_said = last if state == "failed" else pct
    return records.make("printer", state, _headline(state, job, pct_said, attempt, detail.get("starting", False)),
                        "bambuddy", cause=cause, actions=actions, detail=detail,
                        disagree=_disagree(s, state))


def obico(o, printer_rec):
    """Failure detection for the X2D (Bambuddy's printer 1); None when Bambuddy didn't answer."""
    if o is None:
        return None
    if not o.get("enabled"):
        return records.make("obico", "off", "Failure detection is off", "bambuddy")
    mine = (o.get("per_printer") or {}).get("1") or {}
    cls = mine.get("class")
    if cls == "failure":
        return records.make("obico", "failure", "Failure detected on the X2D", "bambuddy", detail={"score": mine.get("score")})
    if cls == "warning":
        return records.make("obico", "warning", "Possible print problem", "bambuddy", detail={"score": mine.get("score")})
    if cls == "error" and printer_rec and printer_rec["state"] in ("printing", "paused"):
        # Bambuddy's own words ("Failed to capture snapshot for printer 1") stay in detail, never in what's said
        error = str(mine.get("error") or "")
        camera = not error or CAMERA_ERROR.search(error)
        return records.make("obico", "blind", "Failure detection is blind", "bambuddy",
                            cause="The camera isn't sending frames to Bambuddy." if camera
                            else "Bambuddy's failure detection reports an error.", detail={"error": error[:200]})
    return records.make("obico", "watching", "Watching for failures", "bambuddy")


def hms(b):
    """The printer's own fault codes (severity 1 stop, 2 pause, 3 notice); None when Bambuddy didn't answer."""
    if b is None:
        return None
    errors = list(b.get("hms") or [])
    if not errors:
        return records.make("hms", "clear", "No printer alerts", "bambuddy", detail={"errors": errors})
    stopping = [e for e in errors if stops(e)]  # any other severity (3, unknown, odd) stays visible as a notice
    first = (stopping or errors)[0]
    return records.make("hms", "stopped" if stopping else "notice", f"Printer needs attention ({first['code']})",
                        "bambuddy", detail={"errors": errors})


def stops(error):
    """An HMS fault that stops or pauses the print: severity 1 or 2, as a whole number."""
    sev = error.get("severity")
    return isinstance(sev, int) and not isinstance(sev, bool) and sev in (1, 2)
