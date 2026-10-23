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
        return [{"tone": "bad", "what": "Home status unavailable",
                 "say": "The hub can’t check your devices right now. Open Help & system to check the hub and find recovery options.",
                 "href": "/pi", "link_label": "Check the hub"}]
    out = []
    svc = s.get("services") or {}
    if s.get("drive_state") not in ("Connected", "Missing", "Not mounted") or any(not isinstance(svc.get(key), bool) for key in ("plex", "homebridge")):
        out.append({"tone": "warn", "what": "Some device status unavailable",
                    "say": "Some checks returned no reading. This does not confirm that those devices are offline.",
                    "href": "/pi", "link_label": "Check source responses"})
    if s.get("drive_state") == "Missing":
        out.append({"tone": "bad", "what": "Movies drive",
                    "say": "Movies may not play because the storage drive disconnected. Unplug it, wait 10 seconds, plug it back in.",
                    "href": "/drives", "link_label": "Check movie storage"})
    elif s.get("drive_state") == "Not mounted":
        out.append({"tone": "warn", "what": "Movies drive",
                    "say": "It's plugged in but not mounted.", "fix": "remount:movies", "fix_label": "Remount it"})
    for key, name, impact in (("plex", "Movies", "Movie playback is unavailable."),
                              ("homebridge", "Smart-home controls", "Lights and plugs may not respond from the hub.")):
        if svc.get(key) is False:
            out.append({"tone": "bad", "what": name, "say": impact,
                        "fix": f"restart:{key}", "fix_label": "Restart movie service" if key == "plex" else "Restart smart-home service"})
    if s.get("ai_state") == "Down":
        out.append({"tone": "bad", "what": "Windows PC",
                    "say": "Local AI isn't answering. The PC may be off, or the room's breaker tripped.",
                    "href": "/workshop", "link_label": "Check the workshop"})
    if s.get("display_state") == "Offline":
        out.append({"tone": "warn", "what": "Workshop display", "say": "The touchscreen is offline.",
                    "href": "/workshop", "link_label": "Check the workshop"})
    if (s.get("pi_temp") or 0) >= 80:
        out.append({"tone": "warn", "what": "Raspberry Pi", "say": f"Running hot at {s['pi_temp']:.0f} °C."})
    if s.get("pi_power") not in (None, "Good"):
        out.append({"tone": "warn", "what": "Raspberry Pi power", "say": s["pi_power"] + "."})
    if s.get("x2d_state") == "Error":
        out.append({"tone": "bad", "what": "Bambu X2D", "say": "Check the printer’s screen for the error and recovery steps.",
                    "href": "/workshop", "link_label": "Check the printer"})
    return out


def summary(found):
    bad = [i for i in found if i["tone"] == "bad"]
    if not found:
        return "Everything's running"
    if len(found) == 1 and found[0]["what"] == "Home status unavailable":
        return "Home status is unavailable"
    if len(found) == 1:
        return "Movies need a look" if found[0]["what"] == "Movies" else f"{found[0]['what']} needs a look"
    return f"{len(found)} things need a look" if bad else f"{len(found)} small things to check"


def build(s, sessions, sampler, disk_free, network=None):
    found = issues(s)
    svc = (s or {}).get("services") or {}
    drive_ok = (s or {}).get("drive_state") == "Connected"
    movies = (s or {}).get("movies")
    movie_known = isinstance(svc.get("plex"), bool) and (s or {}).get("drive_state") in ("Connected", "Missing", "Not mounted")
    home_known = isinstance(svc.get("homebridge"), bool)
    return {
        "status_available": s is not None,
        "summary": summary(found),
        "issues": found,
        "printer": printer(s),
        "network": network,
        "movies": {
            "tone": _tone(svc.get("plex") and drive_ok, warn=svc.get("plex")) if movie_known else "warn",
            "status_known": movie_known,
            "plex_running": bool(svc.get("plex")),
            "drive": (s or {}).get("drive_state", "Unknown"),
            "count": movies,
            "free": (s or {}).get("drive_free") or "",
            "resets": (s or {}).get("drive_resets"),
            "playing": [{k: v for k, v in x.items() if not k.startswith("_")} for x in sessions] if sessions is not None else None,
        },
        "home": {"tone": _tone(svc.get("homebridge")) if home_known else "warn",
                 "status_known": home_known, "homebridge_running": bool(svc.get("homebridge"))},
        "workshop": {
            "display": (s or {}).get("display_state", "Unknown"),
            "display_firmware": (s or {}).get("display_firmware") or "",
            "ai": (s or {}).get("ai_state", "Unknown"),
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
