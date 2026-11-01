"""The house's records: PC, Local AI, display, Pi, movies, devices, paper printer, weather.

Pure: give each builder what its source said and get the record, or None when the source
didn't answer (so the hub marks the last record stale). A source that answers without the
field we need gives an "unknown" record rather than an error.
"""
import time

from .. import display_messages, records

PC_DOWN_AFTER = 300  # seconds a failing probe may go on before the PC counts as off
HOT_AT = 75  # degrees C
COPY_BEHIND_AFTER = 2 * 86400  # seconds since the last good movie copy


def _clock(ts):
    return time.strftime("%H:%M", time.localtime(ts))


def _rec(id, state, headline, **kw):
    return records.make(id, state, headline, records.SOURCE[id], **kw)


def _unknown(id):
    return _rec(id, "unknown", "No reading")


def _get(s, key):
    return s.get(key) if isinstance(s, dict) else None


def _restart(name, label):
    return [{"name": name, "label": label, "confirm": True}]


def _pc_state(prev):
    """The last state the PC record said something about; an unknown record remembers the one before it."""
    if not prev:
        return None
    return prev["detail"].get("last_state") if prev["state"] == "unknown" else prev["state"]


def pc(net, prev, now):
    if net is None:
        return None
    ok = _get(net, "win_ok")
    was = _pc_state(prev)
    if ok is None:
        # one odd reading mustn't restart (or skip) the 5-minute grace: keep what was known
        detail = {"last_state": was} if was in ("on", "off") else {}
        if detail and prev["detail"].get("down_since"):
            detail["down_since"] = prev["detail"]["down_since"]
        return _rec("pc", "unknown", "No reading", detail=detail)
    if ok:
        return _rec("pc", "on", "The PC is on")
    since = (prev["detail"].get("down_since") if was in ("on", "off") else None) or now
    if was == "on" and now - since < PC_DOWN_AFTER:
        return _rec("pc", "on", "The PC is on", detail={"down_since": since},
                    cause=f"Not answering on the network for {int((now - since) // 60)} min")
    return _rec("pc", "off", "The PC is off", detail={"down_since": since},
                cause=f"Not answering on the network since {_clock(since)}.")


def local_ai(s, pc_rec):
    if s is None:
        return None
    state = {"Ready": "ready", "Busy": "busy", "Down": "down"}.get(_get(s, "ai_state"))
    if not state:
        return _unknown("local_ai")
    detail = {"models": _get(s, "ai_models"), "waiting": _get(s, "ai_waiting")}
    if state != "down":
        return _rec("local_ai", state, "Local AI is " + state, detail=detail)
    cause = ("The PC is on; Local AI itself isn't answering." if pc_rec and pc_rec["state"] == "on"
             else "Local AI isn't answering; the PC may be off.")
    return _rec("local_ai", "down", "Local AI isn't answering", cause=cause, detail=detail)


PC_OFF_PRINT_AFTER = 120  # seconds the PC may be down during a print before it matters


def pc_printing(printer_rec, local_ai_rec, now):
    """The PC is off while a print runs: Obico runs on the PC, so nothing is watching the print."""
    if not printer_rec or not local_ai_rec:  # a source is quiet; its own records say so
        return _rec("pc_printing", "fine", "Can't tell while a source is quiet")
    printing = bool(printer_rec) and printer_rec["state"] in ("printing", "paused")
    down = bool(local_ai_rec) and local_ai_rec["state"] == "down"
    if printing and down and now - local_ai_rec.get("since", now) >= PC_OFF_PRINT_AFTER:
        return _rec("pc_printing", "off_while_printing", "The PC is off during a print",
                    cause="Failure detection has stopped until it's back.")
    return _rec("pc_printing", "fine", "The PC is fine during prints")


def workshop_display(s):
    """The display's own heartbeat (newer than 10 minutes) wins; else what the Pi's status service says."""
    try:
        beat = display_messages.last_heartbeat()
    except Exception:
        beat = None
    if beat is not None:
        return _rec("workshop_display", "online", "The touchscreen is online", detail={"firmware": beat.get("version")})
    if s is None:
        return None
    state = {"Online": "online", "Offline": "offline"}.get(_get(s, "display_state"))
    if not state:
        return _unknown("workshop_display")
    return _rec("workshop_display", state,
                "The touchscreen is online" if state == "online" else "The touchscreen is offline.",
                detail={"firmware": _get(s, "display_firmware")})


def pi(s):
    if s is None:
        return None
    temp, power = _get(s, "pi_temp"), _get(s, "pi_power")
    if not isinstance(temp, (int, float)) or power is None:
        return _unknown("pi")
    headline = f"Pi {temp:.0f} °C"
    detail = {"temp": temp, "power": power, "updates": _get(s, "updates"), "uptime_h": _get(s, "pi_uptime_h")}
    # pi-status says "Slowed by heat" while hot, and "... earlier" flags stick until a reboot: heat wins over those
    heat_flag = power == "Slowed by heat" or str(power).endswith("earlier")
    if temp >= HOT_AT and heat_flag:
        return _rec("pi", "hot", headline, cause=f"Running hot at {temp:.0f} °C.", detail=detail)
    if power != "Good":
        return _rec("pi", "power", headline, cause=f"Power problem: {power}.", detail=detail)
    if temp >= HOT_AT:
        return _rec("pi", "hot", headline, cause=f"Running hot at {temp:.0f} °C.", detail=detail)
    return _rec("pi", "ok", headline, detail=detail)


def movies_drive(s):
    if s is None:
        return None
    state = {"Connected": "connected", "Not mounted": "not_mounted", "Missing": "missing"}.get(
        _get(s, "drive_state"))
    if not state:
        return _unknown("movies_drive")
    # what Home's movies block shows besides the state (pi-status's library count, free space, resets)
    detail = {"movies": _get(s, "movies"), "free": _get(s, "drive_free"), "resets": _get(s, "drive_resets")}
    if state == "not_mounted":
        return _rec("movies_drive", state, "The movies drive isn't mounted", detail=detail,
                    actions=[{"name": "remount:movies", "label": "Remount it", "confirm": False}])
    if state == "missing":
        return _rec("movies_drive", state, "The movies drive is missing", detail=detail,
                    cause="Unplug it, wait 10 seconds and plug it back in.")
    return _rec("movies_drive", state, "The movies drive is connected", detail=detail)


def movie_copy(s, now):
    if s is None:
        return None
    mirror = _get(s, "mirror")
    last = _get(mirror, "last_ok")
    if not isinstance(last, (int, float)):
        return _unknown("movie_copy")
    detail = {"last_ok": last}
    if now - last > COPY_BEHIND_AFTER:
        days = int((now - last) // 86400)
        return _rec("movie_copy", "behind", f"Movies not copied from the PC for {days} days", detail=detail)
    return _rec("movie_copy", "up_to_date", f"Movies copied {_clock(last)}", detail=detail)


def plex(s, sessions):
    if s is None:
        return None
    up = _get(_get(s, "services"), "plex")
    if up is None:
        return _unknown("plex")
    if not up:
        return _rec("plex", "stopped", "The movie service has stopped",
                    actions=_restart("restart:plex", "Restart movie service"))
    if sessions:
        first = sessions[0].get("title") if isinstance(sessions[0], dict) else None
        return _rec("plex", "playing", f"Playing {first or 'something'}", detail={"sessions": len(sessions)})
    return _rec("plex", "idle", "Nothing playing")


def devices(s):
    if s is None:
        return None
    up = _get(_get(s, "services"), "homebridge")
    if up is None:
        return _unknown("devices")
    if not up:
        return _rec("devices", "stopped", "The smart-home service has stopped",
                    actions=_restart("restart:homebridge", "Restart smart-home service"))
    return _rec("devices", "ok", "Smart-home controls are running")


def paper_printer(p):
    if p is None:
        return None
    said = _get(p, "state")
    if said == "Ready":
        return _rec("paper_printer", "ready", "The document printer is ready")
    if said == "Printing":
        return _rec("paper_printer", "busy", "The document printer is printing")
    if said == "Paused":
        return _rec("paper_printer", "problem", "The document printer has a problem",
                    cause="The printer is paused.")
    if said == "Not found":
        return _rec("paper_printer", "problem", "The document printer has a problem",
                    cause="The printer isn't set up on the Pi.")
    return _unknown("paper_printer")


def weather(w):
    if w is None:
        return None
    now = _get(w, "now")
    temp = _get(now, "temp")
    if temp is None:
        return _unknown("weather")
    alerts = [a for a in (_get(w, "alerts") or []) if isinstance(a, dict)]
    if alerts:
        first = alerts[0]
        return _rec("weather", "warning", first.get("headline") or first.get("event") or "Weather alert",
                    detail={"alerts": len(alerts), "temp": temp})
    days = _get(w, "days") or []
    high = days[0].get("high") if days and isinstance(days[0], dict) else None
    headline = f"{temp}° {now.get('sky') or ''}".strip()
    if high is not None:
        headline += f", high {high}°"
    return _rec("weather", "ok", headline, detail={"temp": temp, "high": high, "sky": now.get("sky") or ""})
