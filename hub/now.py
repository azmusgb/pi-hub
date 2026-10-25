"""Builds the Now screen's data: one plain-words summary plus each area's state.

Every area says what's wrong in words a person can act on, and copes with a
missing source (it says so instead of guessing).
"""


def _tone(ok, warn=False):
    return "ok" if ok else ("warn" if warn else "bad")


def printer_actions(b):
    """The buttons that fit Bambuddy's state now: clear the plate, pause or resume (one home, step 3)."""
    if not b or not b.get("connected"):
        return []
    state = b.get("bambuddy_state")
    return [a for a, fits in (("clear", b.get("awaiting_plate_clear")), ("pause", state == "RUNNING"),
                                ("resume", state == "PAUSE")) if fits]


def printer(s, b=None):
    if s is None and b is None:
        return {"state": "none", "headline": "No status yet",
                "detail": "The Pi's status service isn't answering."}
    state = (s or {}).get("x2d_state")
    pct = (s or {}).get("x2d_progress") or 0
    left = (s or {}).get("x2d_left") or ""
    if state == "Printing":
        res = {"state": "printing", "progress": pct, "headline": f"Printing, {pct}%",
               "left": left, "minutes_left": (s or {}).get("x2d_minutes_left")}
    elif state == "Paused":
        res = {"state": "paused", "progress": pct, "headline": f"Paused at {pct}%",
               "detail": "Resume it from the printer or Bambu Handy."}
    elif state == "Error":
        code = (s or {}).get("x2d_error")
        res = {"state": "error", "progress": pct, "headline": "Needs attention",
               "detail": f"The printer reports {code}. Check its screen." if code else "Check the printer's screen."}
    elif state == "Stopped":
        res = {"state": "stopped", "headline": "Last print stopped", "detail": "Ready for the next one."}
    elif state == "Idle":
        res = {"state": "idle", "headline": "Idle", "detail": "Ready for the next print."}
    elif state == "Not set up":
        res = {"state": "none", "headline": "Not connected", "detail": "Local AI isn't set up to read the printer."}
    else:
        res = {"state": "none", "headline": "No status right now",
               "detail": "Local AI isn't reporting the printer. It may be off, or between prints."}

    if b and isinstance(b, dict):
        res["temperatures"] = {
            "nozzle": b.get("nozzle_temp"),
            "nozzle_target": b.get("nozzle_target"),
            "bed": b.get("bed_temp"),
            "bed_target": b.get("bed_target"),
        }
        res["nozzle_temp"] = b.get("nozzle_temp")
        res["bed_temp"] = b.get("bed_temp")
        res["nozzle_target"] = b.get("nozzle_target")
        res["bed_target"] = b.get("bed_target")
        res["ams_humidity"] = b.get("ams_humidity")
        res["ams_temp"] = b.get("ams_temp")
        res["layer_num"] = b.get("layer_num")
        res["total_layers"] = b.get("total_layers")
        res["job_name"] = b.get("job_name")
        res["filament_type"] = b.get("filament_type")
        res["filament_color"] = b.get("filament_color")
        res["bambuddy_connected"] = b.get("connected")

    res["actions"] = printer_actions(b)
    if "resume" in res["actions"]:
        res["detail"] = "Resume it here or on the printer."
    if "clear" in res["actions"] and res["state"] not in ("printing", "paused"):
        failed = b.get("bambuddy_state") == "FAILED"
        res["headline"] = "Print failed — clear the plate" if failed else "Print done — clear the plate"
    return res


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


def build(s, sessions, sampler, disk_free, network=None, bambuddy=None):
    found = issues(s)
    svc = (s or {}).get("services") or {}
    drive_ok = (s or {}).get("drive_state") == "Connected"
    movies = (s or {}).get("movies")
    movie_known = isinstance(svc.get("plex"), bool) and (s or {}).get("drive_state") in ("Connected", "Missing", "Not mounted")
    home_known = isinstance(svc.get("homebridge"), bool)
    return {
        "status_available": s is not None or bambuddy is not None,
        "summary": summary(found),
        "issues": found,
        "printer": printer(s, bambuddy),
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
