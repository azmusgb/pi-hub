"""The printer's record: Bambuddy decides the state; pi-status can only disagree.

Pure: give it what the sources said and the last record, get the new record (or None when
Bambuddy didn't answer, so the hub marks the last one stale).
"""
import time

from .. import records
from ..now import printer_actions

FINISHED_AT = 97  # percent; an idle printer that stopped below this didn't finish
ATTEMPT_WINDOW = 15 * 60  # seconds in which the same job starting again is another attempt

LABELS = {"clear": "Clear the plate", "pause": "Pause the print", "resume": "Resume the print"}
BAMBUDDY = {"RUNNING": "printing", "PAUSE": "paused", "IDLE": "idle"}
PI_STATUS = {"Printing": "printing", "Paused": "paused", "Idle": "idle", "Stopped": "idle", "Error": "failed"}


def _clock(ts):
    return time.strftime("%H:%M", time.localtime(ts))


def _job(name):
    for end in (".gcode.3mf", ".3mf", ".gcode"):
        if name and name.endswith(end):
            return name[:-len(end)]
    return name


def _pct(v):
    return v if isinstance(v, (int, float)) else 0


def _state(b, prev):
    if not b.get("connected"):
        return "offline"
    raw = b.get("bambuddy_state") or b.get("state")
    done = bool(b.get("awaiting_plate_clear"))
    if raw == "FINISH":
        return "finished" if done else "idle"
    if raw == "FAILED":
        return "failed" if done else "idle"
    state = BAMBUDDY.get(raw, "unknown")
    if state == "idle" and prev and prev["state"] in ("printing", "paused") \
            and _pct(prev["detail"].get("last_progress")) < FINISHED_AT:
        return "failed"
    return state


def _attempt(job, state, prev, now):
    if state != "printing" or not prev or prev["state"] == "printing":
        return prev["detail"].get("attempt", 1) if prev and state == "printing" else 1
    again = prev["state"] in ("failed", "idle") and prev["detail"].get("job") == job \
        and now - prev["since"] < ATTEMPT_WINDOW
    return prev["detail"].get("attempt", 1) + 1 if again else 1


def _headline(state, job, pct, attempt):
    if state == "printing":
        return f"Printing {job}, {pct}%" + (f", attempt {attempt}" if attempt > 1 else "")
    return {"paused": f"Paused at {pct}%", "finished": "Done: clear the plate",
            "failed": f"Stopped at {pct}%: clear the plate", "idle": "Idle",
            "offline": "The printer isn't connected to Bambuddy"}.get(state, "The printer's state isn't known")


def _disagree(s, state):
    said = (s or {}).get("x2d_state")
    if not said or PI_STATUS.get(said) == state:
        return ""
    return f"pi-status reports {said}; Bambuddy reports {state}"


def printer(b, s, lab, prev, now):
    if b is None:
        return None
    state = _state(b, prev)
    job = _job(b.get("job_name"))
    live = state in ("printing", "paused")
    was_live = bool(prev) and prev["state"] in ("printing", "paused")
    inferred = state == "failed" and was_live and b.get("bambuddy_state") == "IDLE"
    pct = _pct(b.get("progress"))
    last = prev["detail"].get("last_progress", pct) if inferred else pct
    carried = prev["detail"].get("started") if was_live else None
    started = carried if (carried and (live or state == "failed")) else (now if live else None)
    attempt = _attempt(job, state, prev, now)
    detail = {"job": job, "progress": b.get("progress"), "layer": b.get("layer_num"),
              "total_layers": b.get("total_layers"), "nozzle": b.get("nozzle_temp"),
              "nozzle_target": b.get("nozzle_target"), "bed": b.get("bed_temp"),
              "bed_target": b.get("bed_target"), "ams_humidity": b.get("ams_humidity"),
              "filament_type": b.get("filament_type"), "filament_color": b.get("filament_color"),
              "attempt": attempt, "started": started, "last_progress": last}
    if live and lab is not None:
        detail["lab"] = lab
    cause = ""
    if state == "failed":
        mins = int((now - started) // 60) if started else 0
        cause = f"Stopped at {_clock(now)} after {mins} min; the printer gave no reason."
    actions = [{"name": a, "label": LABELS[a], "confirm": False} for a in printer_actions(b)]
    return records.make("printer", state, _headline(state, job, last if state == "failed" else pct, attempt),
                        "bambuddy", cause=cause, actions=actions, detail=detail,
                        disagree=_disagree(s, state))
