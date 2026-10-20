"""Pi Hub: the home hub web app."""
import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import actions, ask, auth, db, digest, events, filament, homecontrol, now, outside, plex, printing, recorder, sources, system, wifi

STATIC = Path(__file__).parent / "static"
LISTS = {"shopping": "Shopping", "todo": "To do", "notes": "Notes", "requests": "Movie requests"}

app = FastAPI(title="Pi Hub", docs_url=None, redoc_url=None, openapi_url=None)
sampler = sources.Sampler()

if os.environ.get("HUB_NO_SAMPLER") != "1":
    threading.Thread(target=sampler.run, daemon=True).start()
    threading.Thread(target=recorder.run, args=(sampler,), daemon=True).start()
    threading.Thread(target=events.run, daemon=True).start()
    threading.Thread(target=digest.run, daemon=True).start()


def fresh(data):
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@app.middleware("http")
async def guard(request: Request, call_next):
    # Changes must come from the hub's own pages, not from another site in the browser.
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin") or request.headers.get("referer") or ""
        if urlparse(origin).netloc != request.headers.get("host", ""):
            return JSONResponse({"error": "This change has to come from the hub's own page."}, status_code=403)
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return resp


def _say(fn, *args):
    try:
        return fn(*args)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# ---- Now ----

@app.get("/api/now")
def api_now():
    try:
        disk = sources.disk_free_gb("/")
    except OSError:
        disk = None
    return fresh(now.build(sources.pi_status(), sources.plex_sessions(), sampler.snapshot(), disk))


# ---- Movies ----

@app.get("/api/movies")
def api_movies():
    s = sources.pi_status() or {}
    return fresh({
        "machine": sources.cached("plex-id-safe", 3600, plex.machine_id),
        "playing": sources.plex_sessions(),
        "continue": plex.on_deck(),
        "recent": plex.recently_added(),
        "drive": {"state": s.get("drive_state", "Unknown"), "free": s.get("drive_free"), "count": s.get("movies"),
                  "resets": s.get("drive_resets"), "errors": s.get("drive_errors")},
        "drive_events": system.drive_events(),
        "history": plex.history(),
        "stats": plex.library_stats(),
        "requests": db.rows("SELECT id, text, done, created FROM items WHERE list = 'requests' AND (done = 0 OR done_at > ?) "
                            "ORDER BY done, created DESC", int(time.time()) - 14 * 86400),
    })


# ---- Drives: health, and moving the movies to a new drive ----

@app.get("/api/drives")
def api_drives():
    report = actions.helper("drives:report", timeout=120)
    move = actions.helper("move:status", timeout=10)
    return fresh({"drives": report.get("drives") or [], "move": move, "ok": report.get("ok", False),
                  "message": report.get("message")})


@app.post("/api/drives/move")
async def api_drives_move(request: Request):
    role, device = need(request, "owner")
    b = await request.json()
    dev = str(b.get("device", ""))
    if str(b.get("confirm", "")).strip().upper() != "ERASE":
        raise HTTPException(400, "Type ERASE to confirm. Everything on the new drive is wiped.")
    r = actions.helper_with("move:start", {"device": dev})
    auth.log(role, device, "drives:move", r.get("message", ""))
    if not r.get("ok"):
        raise HTTPException(400, r.get("message") or "The move didn't start.")
    return fresh(r)


@app.post("/api/drives/switch")
def api_drives_switch(request: Request):
    role, device = need(request, "owner")
    r = actions.helper("move:switch", timeout=180)
    auth.log(role, device, "drives:switch", r.get("message", ""))
    if not r.get("ok"):
        raise HTTPException(400, r.get("message") or "The switch didn't work.")
    sources._cache.clear()
    try:
        actions.run("rescan:plex")
    except Exception:  # noqa: BLE001
        pass
    return fresh(r)


@app.get("/api/movies/search")
def api_movies_search(q: str = ""):
    return fresh({"results": _say(plex.search, q) or []})


@app.get("/api/plex/thumb")
def api_thumb(path: str):
    got = None
    try:
        got = plex.thumb(path)
    except Exception:
        pass
    if not got:
        raise HTTPException(404, "No picture")
    data, kind = got
    return Response(data, media_type=kind, headers={"Cache-Control": "public, max-age=86400"})


# ---- Workshop ----

@app.get("/api/workshop")
def api_workshop():
    s = sources.pi_status()
    w = sources.world() or {}
    models = (w.get("models") or {})
    filament.ready()
    prints = db.rows("SELECT p.*, s.colour, s.material, s.hex FROM prints p LEFT JOIN spools s ON s.id = p.spool_id "
                     "ORDER BY p.id DESC LIMIT 20")
    week = int(time.time()) - 7 * 86400
    return fresh({
        "printer": now.printer(s),
        "prints": prints,
        "week": {
            "finished": sum(1 for p in prints if p["outcome"] == "finished" and (p["ended"] or 0) >= week),
            "hours": round(sum(((p["ended"] or time.time()) - p["started"]) for p in prints if p["started"] >= week) / 3600, 1),
        },
        "display": {"state": (s or {}).get("display_state", "Unknown"), "firmware": (s or {}).get("display_firmware")},
        "spools": filament.spools(),
        "materials": filament.MATERIALS,
        "low_at": filament.low_at(),
        "filament_month": filament.summary(30),
        "ai": {"state": (s or {}).get("ai_state", "Down"),
               "models": [str(m.get("name") if isinstance(m, dict) else m)[:60] for m in models.get("loaded") or []],
               "waiting": ((models.get("queue") or {}).get("waiting"))},
    })


# ---- Filament ----

@app.post("/api/filament")
async def api_filament_add(request: Request):
    role, device = need(request, "household")
    try:
        sid = filament.add(await request.json())
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e) or "Check the spool's details.")
    auth.log(role, device, "filament:add", "Added a spool.")
    return fresh({"id": sid})


@app.post("/api/filament/{sid}")
async def api_filament_update(sid: int, request: Request):
    role, device = need(request, "household")
    b = await request.json()
    try:
        if b.get("remove"):
            filament.remove(sid)
        else:
            filament.update(sid, b)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e) or "Check the numbers.")
    return fresh({"ok": True})


@app.post("/api/prints/{pid}/filament")
async def api_print_filament(pid: int, request: Request):
    role, device = need(request, "household")
    b = await request.json()
    try:
        return fresh(filament.log_print(pid, int(b.get("spool_id", 0)), b.get("grams", 0)))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e) or "Enter the grams used.")


# ---- Workshop camera (through the failover service) ----

CAMERA = os.environ.get("HUB_CAMERA_URL", "http://127.0.0.1:8091")


@app.get("/api/camera.jpg")
def api_camera():
    import urllib.request
    try:
        with urllib.request.urlopen(f"{CAMERA}/x2d/frame.jpg", timeout=4) as r:
            return Response(r.read(400 * 1024), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    except OSError:
        raise HTTPException(503, "The camera isn't sending pictures right now.")


@app.get("/api/camera")
def api_camera_health():
    import json as _json
    import urllib.request
    try:
        with urllib.request.urlopen(f"{CAMERA}/x2d/health.json", timeout=3) as r:
            h = _json.load(r)
        return fresh({"ok": bool(h.get("ok")), "source": h.get("source"), "since": h.get("since"),
                      "sources": {k: {"up": v.get("up"), "fresh": v.get("fresh")} for k, v in (h.get("sources") or {}).items()}})
    except OSError:
        return fresh({"ok": False, "source": None, "sources": {}})


# ---- Print ----

@app.get("/api/print")
def api_print():
    return fresh({"printer": printing.printer_state(), "ink": printing.ink(), "jobs": printing.jobs()})


@app.post("/api/print")
async def api_print_submit(request: Request, filename: str, copies: int = 1, mono: bool = False):
    data = await request.body()
    return fresh(_say(printing.submit, data, filename, copies, mono))


@app.post("/api/print/{job_id}/cancel")
def api_print_cancel(job_id: str):
    _say(printing.cancel, job_id)
    return fresh({"ok": True})


# ---- Lists ----

@app.get("/api/lists")
def api_lists():
    out = {}
    for key, name in LISTS.items():
        out[key] = {"name": name, "items": db.rows(
            "SELECT id, text, done, created, done_at FROM items WHERE list = ? AND (done = 0 OR done_at > ?) "
            "ORDER BY done, created DESC", key, int(time.time()) - 3 * 86400)}
    return fresh(out)


@app.post("/api/lists/{key}")
async def api_list_add(key: str, request: Request):
    if key not in LISTS:
        raise HTTPException(404, "No such list")
    body = await request.json()
    text = " ".join(str(body.get("text", "")).split())[:200]
    if not text:
        raise HTTPException(400, "Type something to add.")
    cur = db.run("INSERT INTO items (list, text, created) VALUES (?, ?, ?)", key, text, int(time.time()))
    return fresh({"id": cur.lastrowid})


@app.post("/api/lists/{key}/{item_id}/toggle")
def api_list_toggle(key: str, item_id: int):
    db.run("UPDATE items SET done = 1 - done, done_at = CASE WHEN done = 0 THEN ? ELSE NULL END "
           "WHERE id = ? AND list = ?", int(time.time()), item_id, key)
    return fresh({"ok": True})


@app.post("/api/lists/{key}/{item_id}/delete")
def api_list_delete(key: str, item_id: int):
    db.run("DELETE FROM items WHERE id = ? AND list = ?", item_id, key)
    return fresh({"ok": True})


@app.post("/api/lists/{key}/clear-done")
def api_list_clear(key: str):
    db.run("DELETE FROM items WHERE list = ? AND done = 1", key)
    return fresh({"ok": True})


# ---- Pi ----

@app.get("/api/pi")
def api_pi(hours: int = 24):
    s = sources.pi_status() or {}
    return fresh({
        "health": {"temp": s.get("pi_temp"), "power": s.get("pi_power"), "uptime_h": s.get("pi_uptime_h")},
        "live": sampler.snapshot(),
        "services": system.services(),
        "updates": system.updates(),
        "storage": system.storage(),
        "network": system.network(),
        "history": system.history(max(1, min(hours, 168))),
    })


# ---- Alerts ----

@app.get("/api/alerts")
def api_alerts():
    return fresh({"alerts": system.alerts()})


# ---- Sign-in ----

def who(request: Request):
    s = auth.session(request.cookies.get(auth.COOKIE))
    return (s["role"], s["device"]) if s else ("none", "")


def need(request: Request, role):
    have, device = who(request)
    if not auth.allowed(have, role):
        raise HTTPException(401, "Enter the household PIN first." if role == "household" else "Sign in as the owner first.")
    return have, device


def _device(request: Request):
    ua = request.headers.get("user-agent", "")
    for key, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android phone"),
                      ("Macintosh", "Mac"), ("Windows", "Windows PC")):
        if key in ua:
            return name
    return "A browser"


def _signed_in(token, role):
    resp = fresh({"role": role})
    resp.set_cookie(auth.COOKIE, token, max_age=auth.LIFETIME[role], httponly=True, samesite="strict", path="/")
    return resp


@app.get("/api/me")
def api_me(request: Request):
    role, device = who(request)
    return fresh({"role": role, "setup_needed": auth.setup_needed(), "device": device})


@app.post("/api/setup")
async def api_setup(request: Request):
    b = await request.json()
    try:
        auth.setup(b.get("code", ""), b.get("owner_password", ""), str(b.get("pin", "")))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    token, role = auth.sign_in(request.client.host, _device(request), password=b.get("owner_password"))
    auth.log(role, _device(request), "setup", "The hub was set up.")
    return _signed_in(token, role)


@app.post("/api/signin")
async def api_signin(request: Request):
    b = await request.json()
    try:
        if "password" in b:
            token, role = auth.sign_in(request.client.host, _device(request), password=str(b["password"]))
        else:
            token, role = auth.sign_in(request.client.host, _device(request), pin=str(b.get("pin", "")))
    except PermissionError as e:
        raise HTTPException(429 if "Too many" in str(e) else 403, str(e))
    return _signed_in(token, role)


@app.post("/api/signout")
def api_signout(request: Request):
    auth.sign_out(request.cookies.get(auth.COOKIE))
    resp = fresh({"role": "none"})
    resp.delete_cookie(auth.COOKIE, path="/")
    return resp


# ---- Fix it ----

@app.get("/api/actions")
def api_actions(request: Request):
    role, _ = who(request)
    return fresh({"actions": actions.available(role), "updates": actions.updates_status(),
                  "log": auth.recent_actions(12) if auth.allowed(role, "household") else []})


@app.post("/api/actions/{name}")
def api_action(name: str, request: Request):
    role, device = need(request, "household")
    try:
        result = actions.run(name)
        auth.log(role, device, name, result["message"])
        return fresh(result)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        auth.log(role, device, name, str(e))
        raise HTTPException(502, str(e))


# ---- Home control ----

@app.get("/api/home")
def api_home():
    try:
        return fresh({"connected": True, "accessories": homecontrol.accessories(),
                      "favourites": auth.get("favourites", [])})
    except homecontrol.NotConnected as e:
        return fresh({"connected": False, "message": str(e), "accessories": [], "favourites": []})
    except OSError:
        return fresh({"connected": False, "message": "Homebridge isn't answering.", "accessories": [], "favourites": []})


@app.post("/api/home/{uid}")
async def api_home_set(uid: str, request: Request):
    role, device = need(request, "household")
    b = await request.json()
    try:
        homecontrol.set_value(uid, str(b.get("characteristic", "")), b.get("value"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except homecontrol.NotConnected as e:
        raise HTTPException(409, str(e))
    except OSError:
        raise HTTPException(502, "Homebridge didn't take the change. Try again.")
    return fresh({"ok": True})


@app.post("/api/home/{uid}/favourite")
def api_home_favourite(uid: str, request: Request):
    need(request, "household")
    favs = auth.get("favourites", [])
    favs = [f for f in favs if f != uid] if uid in favs else (favs + [uid])[-12:]
    auth.put("favourites", favs)
    return fresh({"favourites": favs})


# ---- Wi-Fi ----

@app.get("/api/wifi")
def api_wifi(request: Request):
    w = wifi.details()
    role, _ = who(request)
    if not w:
        return fresh({"set": False})
    return fresh({"set": True, "ssid": w["ssid"], "security": w["security"],
                  "password": w["password"] if auth.allowed(role, "household") else None})


@app.get("/api/wifi/qr.svg")
def api_wifi_qr():
    svg = wifi.qr_svg()
    if not svg:
        raise HTTPException(404, "No Wi-Fi saved")
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


# ---- Outside: weather and calendar ----

@app.get("/api/outside")
def api_outside():
    return fresh({"weather": outside.weather(), "calendar": outside.calendar(),
                  "place_set": bool(auth.get("place")), "calendar_set": bool(auth.get("calendar_url"))})


# ---- Ask Local AI ----

@app.post("/api/ask")
async def api_ask(request: Request):
    role, device = need(request, "household")
    b = await request.json()
    try:
        return fresh(ask.ask(str(b.get("question", ""))))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# ---- Rules ----

def _accessory_names():
    try:
        return {a["id"]: a["name"] for a in homecontrol.accessories()}
    except Exception:  # noqa: BLE001
        return {}


@app.get("/api/rules")
def api_rules():
    names = _accessory_names()
    return fresh({
        "rules": [{**r, "text": events.describe(r, names)} for r in events.rules()],
        "triggers": [{"key": k, "label": v} for k, v in events.TRIGGERS.items()],
        "actions": [{"key": k, "label": v[0], "needs_target": v[1]} for k, v in events.ACTIONS.items()],
        "accessories": [{"id": k, "name": v} for k, v in names.items()],
        "events": [{**e, "text": events.TRIGGERS.get(e["kind"], e["kind"])} for e in events.recent(30)],
        "alerts_ready": events.topic_ready(),
    })


@app.post("/api/rules")
async def api_rules_add(request: Request):
    role, device = need(request, "household")
    b = await request.json()
    try:
        rid = events.add_rule(str(b.get("trigger", "")), str(b.get("action", "")), b.get("target") or None)
    except ValueError as e:
        raise HTTPException(400, str(e))
    auth.log(role, device, "rules:add", "Added a rule.")
    return fresh({"id": rid})


@app.post("/api/rules/{rid}/{op}")
def api_rules_change(rid: int, op: str, request: Request):
    role, device = need(request, "household")
    events.ready()
    if op == "toggle":
        db.run("UPDATE rules SET enabled = 1 - enabled WHERE id = ?", rid)
    elif op == "delete":
        db.run("DELETE FROM rules WHERE id = ?", rid)
    else:
        raise HTTPException(404, "Unknown change")
    auth.log(role, device, f"rules:{op}", "Turned a rule on or off." if op == "toggle" else "Removed a rule.")
    return fresh({"ok": True})


# ---- Settings (owner) ----

@app.get("/api/settings")
def api_settings(request: Request):
    need(request, "owner")
    hb = auth.get("homebridge_login")
    w = wifi.details()
    return fresh({
        "homebridge": {"connected": bool(hb), "username": hb["username"] if hb else ""},
        "wifi": {"ssid": w["ssid"], "security": w["security"]} if w else None,
        "backups": system.backups(),
        "log": auth.recent_actions(30),
        "digest": auth.get("digest", {"on": True, "at": "08:00"}),
        "quiet": auth.get("quiet_hours", {"on": False, "from": "22:00", "to": "07:00"}),
        "place": (auth.get("place") or {}).get("name"),
        "calendar_set": bool(auth.get("calendar_url")),
        "alerts_ready": events.topic_ready(),
    })


@app.post("/api/settings/{what}")
async def api_settings_save(what: str, request: Request):
    role, device = need(request, "owner")
    b = await request.json()
    try:
        if what == "pin":
            auth.set_pin(str(b.get("pin", "")))
            msg = "Household PIN changed. Everyone needs the new PIN next time."
        elif what == "password":
            auth.set_owner_password(str(b.get("password", "")))
            msg = "Owner password changed."
        elif what == "homebridge":
            user, pw = str(b.get("username", "")).strip(), str(b.get("password", ""))
            if not homecontrol.test_login(user, pw):
                raise ValueError("Homebridge didn't accept that login. Tap Show to check the password, and make sure "
                                 "the username has no capital letter. It's the login for Homebridge's page at port 8581.")
            auth.put("homebridge_login", {"username": user, "password": pw})
            homecontrol.forget_token()
            msg = "Homebridge connected."
        elif what == "wifi":
            if b.get("clear"):
                wifi.clear()
                msg = "Wi-Fi details removed."
            else:
                wifi.save(str(b.get("ssid", "")), str(b.get("password", "")), str(b.get("security", "WPA")))
                msg = "Wi-Fi saved. The QR code is on the Now page."
        elif what == "digest":
            at = str(b.get("at", "08:00"))
            if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", at):
                raise ValueError("Choose a time for the morning digest.")
            auth.put("digest", {"on": bool(b.get("on")), "at": at})
            msg = f"Morning digest {'on, at ' + at if b.get('on') else 'off'}."
        elif what == "digest-test":
            msg = f"Test digest: {digest.send()}"
        elif what == "quiet":
            f, t = str(b.get("from", "22:00")), str(b.get("to", "07:00"))
            if not all(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", x) for x in (f, t)):
                raise ValueError("Choose a start and end time.")
            auth.put("quiet_hours", {"on": bool(b.get("on")), "from": f, "to": t})
            msg = f"Quiet hours {'on, ' + f + ' to ' + t if b.get('on') else 'off'}."
        elif what == "place":
            if b.get("clear"):
                auth.put("place", None)
                msg = "Location removed."
            else:
                try:
                    place = outside.find_place(str(b.get("name", "")))
                except OSError:
                    raise ValueError("Couldn't reach the weather service. Try again in a minute.")
                auth.put("place", place)
                sources._cache.pop("weather", None)
                msg = f"Weather set for {place['name']}."
        elif what == "calendar":
            if b.get("clear"):
                auth.put("calendar_url", None)
                msg = "Calendar removed."
            else:
                auth.put("calendar_url", outside.check_calendar(str(b.get("url", ""))))
                sources._cache.pop("calendar", None)
                msg = "Calendar connected. Today's items show on Now and the wall display."
        else:
            raise HTTPException(404, "Unknown setting")
    except ValueError as e:
        raise HTTPException(400, str(e))
    auth.log(role, device, f"settings:{what}", msg)
    return fresh({"ok": True, "message": msg})


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/{page:path}")
def index(page: str):
    # Every page is the same shell; the browser picks the view from the address.
    if page.startswith("api/"):
        raise HTTPException(404)
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
