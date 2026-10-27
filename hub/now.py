"""Builds the Now screen's data: one plain-words summary plus each area's state.

Every area says what's wrong in words a person can act on, and copes with a
missing source (it says so instead of guessing). Home, the wall and the Workshop page
read the records (build, printer_from); printer() and issues() read pi-status directly
for the morning digest and Ask, which don't read the records yet.
"""
import time


def _tone(ok, warn=False):
    return "ok" if ok else ("warn" if warn else "bad")


def printer_actions(b):
    """The buttons that fit Bambuddy's state now: clear the plate, pause or resume (one home, step 3)."""
    if not b or not b.get("connected"):
        return []
    state = b.get("bambuddy_state")
    # Bambuddy keeps awaiting_plate_clear while a print started from the printer runs, so only after one ends
    done = state in ("FINISH", "FAILED") and b.get("awaiting_plate_clear")
    return [a for a, fits in (("clear", done), ("pause", state == "RUNNING"),
                                ("resume", state == "PAUSE")) if fits]


def printer(s, b=None, lab=None):
    if s is None and b is None:
        return {"state": "none", "headline": "No status yet",
                "detail": "The Pi's status service isn't answering."}
    state = (s or {}).get("x2d_state")
    pct = (s or {}).get("x2d_progress") or 0
    left = (s or {}).get("x2d_left") or ""

    # Fall back to Bambuddy when Local AI has no useful printer state.
    # Bambuddy is already the source for live X2D telemetry and controls.
    known_local_states = {"Printing", "Paused", "Error", "Stopped", "Idle"}
    if state not in known_local_states and isinstance(b, dict) and b.get("connected"):
        bambuddy_state = b.get("bambuddy_state") or b.get("state")
        state = {
            "RUNNING": "Printing",
            "PAUSE": "Paused",
            "FINISH": "Idle",
            "FAILED": "Error",
            "IDLE": "Idle",
        }.get(bambuddy_state, state)

        if b.get("progress") is not None:
            pct = b.get("progress")
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

    # Local AI's Print lab, while one of its experiments is the print running now.
    if lab and res["state"] in ("printing", "paused"):
        res["lab"] = lab

    res["actions"] = printer_actions(b)
    if "resume" in res["actions"]:
        res["detail"] = "Resume it here or on the printer."
    if "clear" in res["actions"] and res["state"] not in ("printing", "paused"):
        failed = b.get("bambuddy_state") == "FAILED" or res["state"] == "error"
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


# ---- From the records (control room, piece 1): Home, the wall and Needs you read the same records ----

HREF = {"printer": "/workshop", "camera": "/workshop", "workshop_display": "/workshop", "local_ai": "/workshop",
        "pc": "/workshop", "movies_drive": "/drives", "movie_copy": "/drives", "internet": "/network",
        "adguard": "/network", "backups": "/system"}

UNAVAILABLE = {"tone": "bad", "what": "Home status unavailable",
               "say": "The hub can’t check your devices right now. Open Help & system to check the hub and find recovery options.",
               "href": "/pi", "link_label": "Check the hub"}


def _say(rec):
    """The headline, then the cause, as sentences."""
    head, cause = rec["headline"], rec.get("cause") or ""
    if not cause:
        return head
    return f"{head}{'' if head.endswith(('.', '!', '?', ':')) else '.'} {cause}"


def _left(minutes):
    """Bambuddy's minutes left as the page's words ("1 h 5 min", "12 min"); the page puts "Done in about" first."""
    if minutes is None:
        return ""
    h, m = divmod(int(minutes), 60)
    return " ".join(x for x in (f"{h} h" if h else "", f"{m} min" if m or not h else "") if x)


def issue_from(rec):
    """One record that needs a look, as an issue on Home and a row in Needs you."""
    from .records import LABELS
    out = {"tone": "bad" if rec["severity"] == "problem" else "warn", "what": LABELS.get(rec["id"], rec["id"]),
           "say": _say(rec), "href": HREF.get(rec["id"], "/pi")}
    fix = next((a for a in rec.get("actions") or [] if ":" in a.get("name", "")), None)
    if fix:
        out.update(fix=fix["name"], fix_label=fix.get("label") or "")
    return out


def quiet_source(source, recs):
    """One issue for a source that has gone quiet with two or more of its records stale."""
    from .records import LABELS, SOURCE_NAMES
    since = time.strftime("%H:%M", time.localtime(max(r["as_of"] for r in recs)))
    labels = ", ".join(LABELS.get(r["id"], r["id"]) for r in recs)
    return {"tone": "warn", "what": SOURCE_NAMES.get(source, source), "href": "/pi",
            "say": f"Isn't answering since {since}. Last readings for {labels} are shown as they were."}


def issue_items(problems):
    """(key, issue) per row, in the order of `problems`: key is the record's id, or "source:<source>" for one row
    standing for every stale record of a source that has gone quiet (two or more of them)."""
    stale = {}
    for r in problems:
        if r.get("stale"):
            stale.setdefault(r["source"], []).append(r)
    out, done = [], set()
    for r in problems:
        group = stale.get(r["source"], []) if r.get("stale") else []
        if len(group) < 2:
            out.append((r["id"], issue_from(r)))
        elif r["source"] not in done:
            done.add(r["source"])
            out.append(("source:" + r["source"], quiet_source(r["source"], group)))
    return out


def issues_from(recs):
    """Things that need a person, most urgent first; with no records at all, the hub can't check anything."""
    from .records import problems
    if not recs:
        return [dict(UNAVAILABLE)]
    return [i for _, i in issue_items(problems(recs))]


# record state -> the printer card's state words (now.js, home-cards.js, printer-actions.js)
PRINTER_STATE = {"printing": "printing", "paused": "paused", "finished": "stopped", "failed": "error", "idle": "idle"}


def _printer_detail(rec, actions):
    if rec.get("stale") or rec.get("cause"):
        return rec.get("cause") or ""
    state = rec["state"]
    if state == "paused":
        return "Resume it here or on the printer." if "resume" in actions else "Resume it from the printer or Bambu Handy."
    if state == "printing":
        d = rec["detail"]
        return f"Layer {d['layer']} / {d.get('total_layers') or '?'}" if d.get("layer") else ""
    return {"finished": "Ready for the next one once the plate is clear.", "idle": "Ready for the next print.",
            "offline": "Check that the printer is on and Bambuddy can reach it."}.get(state, "")


def printer_from(rec):
    """The printer card from the printer record, in the keys the page has always read."""
    if rec is None:
        return {"state": "none", "headline": "No status yet", "detail": "Bambuddy hasn't answered yet.",
                "left": "", "minutes_left": None, "actions": []}
    d = rec["detail"]
    stale = bool(rec.get("stale"))
    actions = [] if stale else [a["name"] for a in rec.get("actions") or []]
    state = PRINTER_STATE.get(rec["state"], "none")
    pct = d.get("last_progress") if rec["state"] == "failed" else d.get("progress")
    minutes = d.get("minutes_left") if state == "printing" and not stale else None
    res = {"state": state, "headline": rec["headline"], "progress": pct if isinstance(pct, (int, float)) else 0,
           "left": _left(minutes), "minutes_left": minutes,
           "detail": _printer_detail(rec, actions), "stale": stale,
           "temperatures": {"nozzle": d.get("nozzle"), "nozzle_target": d.get("nozzle_target"),
                            "bed": d.get("bed"), "bed_target": d.get("bed_target")},
           "nozzle_temp": d.get("nozzle"), "bed_temp": d.get("bed"), "nozzle_target": d.get("nozzle_target"),
           "bed_target": d.get("bed_target"), "ams_humidity": d.get("ams_humidity"), "ams_temp": None,
           "layer_num": d.get("layer"), "total_layers": d.get("total_layers"), "job_name": d.get("job"),
           "filament_type": d.get("filament_type"), "filament_color": d.get("filament_color"),
           "bambuddy_connected": rec["state"] != "offline" and not stale, "actions": actions}
    if d.get("lab") and state in ("printing", "paused"):
        res["lab"] = d["lab"]
    return res


def _known(rec):
    return rec is not None and rec["state"] != "unknown"


def _word(rec, words):
    return words.get(rec["state"], "Unknown") if rec else "Unknown"


def build(recs, sessions, sampler, disk_free, network=None):
    recs = recs or {}
    found = issues_from(recs)
    get = recs.get
    plex, drive, devices, pi, display, ai = (get(k) for k in ("plex", "movies_drive", "devices", "pi",
                                                               "workshop_display", "local_ai"))
    plex_up = bool(plex) and plex["state"] in ("playing", "idle")
    drive_ok = bool(drive) and drive["state"] == "connected"
    movie_known = _known(plex) and _known(drive)
    drive_d = drive["detail"] if _known(drive) else {}
    pi_d = pi["detail"] if _known(pi) else {}
    ai_d = ai["detail"] if _known(ai) else {}
    return {
        "status_available": any(not r.get("stale") for r in recs.values()),
        "summary": summary(found),
        "issues": found,
        "printer": printer_from(get("printer")),
        "network": network,
        "movies": {
            "tone": _tone(plex_up and drive_ok, warn=plex_up) if movie_known else "warn",
            "status_known": movie_known,
            "plex_running": plex_up,
            "drive": _word(drive, {"connected": "Connected", "not_mounted": "Not mounted", "missing": "Missing"}),
            "count": drive_d.get("movies"),
            "free": drive_d.get("free") or "",
            "resets": drive_d.get("resets"),
            "playing": [{k: v for k, v in x.items() if not k.startswith("_")} for x in sessions] if sessions is not None else None,
        },
        "home": {"tone": _tone(devices["state"] == "ok") if _known(devices) else "warn",
                 "status_known": _known(devices), "homebridge_running": bool(devices) and devices["state"] == "ok"},
        "workshop": {
            "display": _word(display, {"online": "Online", "offline": "Offline"}),
            "display_firmware": (display["detail"].get("firmware") if _known(display) else None) or "",
            "ai": _word(ai, {"ready": "Ready", "busy": "Busy", "down": "Down"}),
            "ai_models": ai_d.get("models"),
            "ai_waiting": ai_d.get("waiting"),
        },
        "pi": {
            "tone": _tone(bool(pi) and pi["state"] == "ok", warn=True),
            "temp": pi_d.get("temp"),
            "power": pi_d.get("power"),
            "updates": pi_d.get("updates"),
            "uptime_h": pi_d.get("uptime_h"),
            "disk_free_gb": disk_free,
            **(sampler or {}),
        },
    }
