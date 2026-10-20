"""Builds the Now screen's data: one plain-words summary plus each area's state.

Every area says what's wrong in words a person can act on, and copes with a
missing source (it says so instead of guessing).
"""


def _tone(ok, warn=False):
    return "ok" if ok else ("warn" if warn else "bad")


def printer(s):
    if s is None:
        return {"state": "none", "headline": "No status yet",
                "detail": "The Pi's status service isn't answering."}
    state = s.get("x2d_state")
    pct = s.get("x2d_progress") or 0
    left = s.get("x2d_left") or ""
    if state == "Printing":
        return {"state": "printing", "progress": pct, "headline": f"Printing, {pct}%",
                "left": left, "minutes_left": s.get("x2d_minutes_left")}
    if state == "Paused":
        return {"state": "paused", "progress": pct, "headline": f"Paused at {pct}%",
                "detail": "Resume it from the printer or Bambu Handy."}
    if state == "Error":
        code = s.get("x2d_error")
        return {"state": "error", "progress": pct, "headline": "Needs attention",
                "detail": f"The printer reports {code}. Check its screen." if code else "Check the printer's screen."}
    if state == "Stopped":
        return {"state": "stopped", "headline": "Last print stopped", "detail": "Ready for the next one."}
    if state == "Idle":
        return {"state": "idle", "headline": "Idle", "detail": "Ready for the next print."}
    if state == "Not set up":
        return {"state": "none", "headline": "Not connected", "detail": "Local AI isn't set up to read the printer."}
    return {"state": "none", "headline": "No status right now",
            "detail": "Local AI isn't reporting the printer. It may be off, or between prints."}


def issues(s):
    """Things that need a person, most urgent first."""
    if s is None:
        return [{"tone": "bad", "what": "Status service",
                 "say": "The Pi's status service isn't answering. Restart the Pi if this lasts."}]
    out = []
    svc = s.get("services") or {}
    if s.get("drive_state") == "Missing":
        out.append({"tone": "bad", "what": "Movies drive",
                    "say": "It dropped out. Unplug it, wait 10 seconds, plug it back in."})
    elif s.get("drive_state") == "Not mounted":
        out.append({"tone": "warn", "what": "Movies drive",
                    "say": "It's plugged in but not mounted yet. Give it a minute."})
    for key, name in (("plex", "Plex"), ("homebridge", "Homebridge")):
        if not svc.get(key):
            out.append({"tone": "bad", "what": name, "say": f"{name} has stopped. Restart it from Cockpit."})
    if s.get("ai_state") == "Down":
        out.append({"tone": "bad", "what": "Windows PC",
                    "say": "Local AI isn't answering. The PC may be off, or the room's breaker tripped."})
    if s.get("display_state") == "Offline":
        out.append({"tone": "warn", "what": "Workshop display", "say": "The touchscreen is offline."})
    if (s.get("pi_temp") or 0) >= 80:
        out.append({"tone": "warn", "what": "Raspberry Pi", "say": f"Running hot at {s['pi_temp']:.0f} °C."})
    if s.get("pi_power") not in (None, "Good"):
        out.append({"tone": "warn", "what": "Raspberry Pi power", "say": s["pi_power"] + "."})
    if s.get("x2d_state") == "Error":
        out.append({"tone": "bad", "what": "Bambu X2D", "say": "The printer needs attention."})
    return out


def summary(found):
    bad = [i for i in found if i["tone"] == "bad"]
    if not found:
        return "Everything's running"
    if len(found) == 1:
        return f"{found[0]['what']} needs a look"
    return f"{len(found)} things need a look" if bad else f"{len(found)} small things to check"


def build(s, sessions, sampler, disk_free):
    found = issues(s)
    svc = (s or {}).get("services") or {}
    drive_ok = (s or {}).get("drive_state") == "Connected"
    movies = (s or {}).get("movies")
    return {
        "summary": summary(found),
        "issues": found,
        "printer": printer(s),
        "movies": {
            "tone": _tone(svc.get("plex") and drive_ok, warn=svc.get("plex")),
            "plex_running": bool(svc.get("plex")),
            "drive": (s or {}).get("drive_state", "Unknown"),
            "count": movies,
            "free": (s or {}).get("drive_free") or "",
            "resets": (s or {}).get("drive_resets"),
            "playing": sessions if sessions is not None else None,
        },
        "home": {"tone": _tone(svc.get("homebridge")), "homebridge_running": bool(svc.get("homebridge"))},
        "workshop": {
            "display": (s or {}).get("display_state", "Unknown"),
            "display_firmware": (s or {}).get("display_firmware") or "",
            "ai": (s or {}).get("ai_state", "Down"),
            "ai_models": (s or {}).get("ai_models"),
            "ai_waiting": (s or {}).get("ai_waiting"),
        },
        "pi": {
            "tone": _tone((s or {}).get("pi_power") == "Good" and ((s or {}).get("pi_temp") or 0) < 75, warn=True),
            "temp": (s or {}).get("pi_temp"),
            "power": (s or {}).get("pi_power"),
            "updates": (s or {}).get("updates"),
            "uptime_h": (s or {}).get("pi_uptime_h"),
            "disk_free_gb": disk_free,
            **(sampler or {}),
        },
    }
