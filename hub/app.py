"""Pi Hub: the home hub web app."""
import os
import re
import base64
import hmac
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import movie_night, bambuddy, freshness, gate, actions, ask, auth, db, digest, events, filament, needs, paperless, reminders, homecontrol, now, outside, plex, printing, recorder, sources, system, wifi

STATIC = Path(__file__).parent / "static"
LISTS = {"shopping": "Shopping", "todo": "To do", "notes": "Notes", "requests": "Movie requests"}

app = FastAPI(title="Pi Hub", docs_url=None, redoc_url=None, openapi_url=None)
sampler = sources.Sampler()

if os.environ.get("HUB_NO_SAMPLER") != "1":
    threading.Thread(target=sampler.run, daemon=True).start()
    threading.Thread(target=recorder.run, args=(sampler,), daemon=True).start()
    threading.Thread(target=events.run, daemon=True).start()
    threading.Thread(target=digest.run, daemon=True).start()
    threading.Thread(target=reminders.run, daemon=True).start()


def fresh(data):
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@app.middleware("http")
async def guard(request: Request, call_next):
    # Changes must come from the hub's own pages, not from another site in the browser.
    # Siri Shortcuts carry their own key instead of coming from the hub's page; the key is checked by the route.
    # Server-to-server webhooks (/api/webhook/) are machine endpoints.
    shortcut = request.url.path.startswith("/api/shortcut/") and request.headers.get("authorization", "").startswith("Bearer hub_")
    webhook = request.url.path.startswith("/api/webhook/")
    if request.method not in ("GET", "HEAD", "OPTIONS") and not shortcut and not webhook:
        origin = request.headers.get("origin") or request.headers.get("referer") or ""
        if urlparse(origin).netloc != request.headers.get("host", ""):
            return JSONResponse({"error": "This change has to come from the hub's own page."}, status_code=403)
    resp = await call_next(request)
    # The page's own files are checked with the Pi on every load (a quick "not changed" reply),
    # so a new hub version shows at once instead of the browser keeping an old stylesheet for hours.
    if request.url.path.startswith("/static/"):
        resp.headers.setdefault("Cache-Control", "no-cache")
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


@app.get("/api/freshness")
def api_freshness():
    return fresh(freshness.snapshot({"home": bool(auth.get("homebridge_login")),
                                     "weather": bool(auth.get("place")),
                                     "calendar": bool(auth.get("calendar_url"))}))


# ---- Now ----

@app.get("/api/now")
def api_now():
    try:
        disk = sources.disk_free_gb("/")
    except OSError:
        disk = None
    data = now.build(sources.pi_status(), sources.plex_sessions(), sampler.snapshot(), disk, sources.network_metrics(), sources.bambuddy_printer())
    data["reminders"] = reminders.due_today()
    data["setup_left"] = sum(1 for k in ("homebridge_login", "place", "wifi", "calendar_url") if not auth.get(k)) \
        + (0 if auth.people() else 1) if not auth.setup_needed() else None
    return fresh(data)


@app.get("/api/needs")
def api_needs():
    return fresh(needs.build(system.alerts(), events.recent(40), sources.localai_feed(), int(time.time())))


@app.get("/api/system/backups")
def api_system_backups():
    """When the Pi and the Mac last backed up (newest restic snapshot), through the root helper."""
    report = sources.cached("helper-backups", 300, lambda: actions.helper("backups:ages", timeout=20))
    now = int(time.time())
    ages = (report or {}).get("ages") or {}
    return fresh({"repos": [{"name": n, "last": t, "hours": (now - t) // 3600 if t else None} for n, t in ages.items()],
                  "available": bool(report and report.get("ok")), "open": "https://backups.home.arpa/"})


@app.get("/api/network/adguard")
def api_network_adguard():
    """Today's DNS queries and blocks from AdGuard, through the root helper (which holds the password)."""
    report = sources.cached("helper-adguard", 300, lambda: actions.helper("adguard:stats", timeout=20))
    if not report or not report.get("ok"):
        return fresh({"available": False})
    return fresh({"available": True, "queries": report["queries"], "blocked": report["blocked"],
                  "open": "https://adguard.home.arpa/"})


@app.get("/api/documents")
def api_documents(request: Request, q: str = ""):
    need(request, "owner")  # titles of tax and medical papers: the owner only
    try:
        results = paperless.search(q)
    except Exception:  # noqa: BLE001 — Paperless off or refusing: say so, don't fail the page
        results = None
    return fresh({"query": q[:paperless.MAX_QUERY], "results": results or [], "available": results is not None,
                  "open": paperless.OPEN})


# ---- Movies ----

@app.get("/api/movies")
def api_movies(section: str = "all"):
    s = sources.pi_status() or {}
    return fresh({
        "machine": sources.cached("plex-id-safe", 3600, plex.machine_id),
        "sections": plex.movie_sections(),
        "active_section": section,
        "playing": sources.plex_sessions(),
        "continue": plex.on_deck(),
        "recent": plex.recently_added(section),
        "drive": {
            "source": s.get("drive_source", "Pi drive (/mnt/usb1)"),
            "state": s.get("drive_state", "Unknown"),
            "free": s.get("drive_free"),
            "used": s.get("drive_used", ""),
            "total": s.get("drive_total", ""),
            "count": s.get("movies"),
            "resets": s.get("drive_resets", 0),
            "errors": s.get("drive_errors", 0),
            "mirror": s.get("mirror"),
        },
        "drive_events": system.drive_events(),
        "history": plex.history(),
        "watching": sources.cached("plex-watching", 600, lambda: plex.watch_stats(90)),
        "stats": {k: v for k, v in ((plex.library_stats(section) if section else plex.library_stats()) or {}).items() if not k.startswith("_")} or None,
        "requests": db.rows("SELECT id, text, done, created FROM items WHERE list = 'requests' AND (done = 0 OR done_at > ?) "
                            "ORDER BY done, created DESC", int(time.time()) - 14 * 86400),
        "genres": plex.genres(section),
    })


@app.get("/api/movies/catalog")
def api_movies_catalog(section: str = "all"):
    return fresh({
        "movies": plex.catalog(section),
        "genres": plex.genres(section),
    })


# ---- Drives: health, and the copy of the PC's movies on the Pi's drive ----

@app.get("/api/drives")
def api_drives():
    report = actions.helper("drives:report", timeout=120)
    return fresh({"drives": report.get("drives") or [], "mirror": (sources.pi_status() or {}).get("mirror"),
                  "ok": report.get("ok", False), "message": report.get("message")})


@app.get("/api/now/poster/{n}.jpg")
def api_now_poster(n: int):
    """The poster of the n-th thing playing, as a small baseline JPEG that a microcontroller can decode."""
    sessions = sources.plex_sessions() or []
    if not 0 <= n < len(sessions) or not sessions[n].get("_thumb"):
        raise HTTPException(404, "Nothing playing there")
    try:
        data, _ = plex.thumb(sessions[n]["_thumb"])
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((300, 450))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=82, progressive=False, optimize=False)
        return Response(buf.getvalue(), media_type="image/jpeg", headers={"Cache-Control": "max-age=60"})
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "Plex didn't send the poster")


@app.get("/api/movies/pick")
def api_movies_pick(kids: bool = False, short: bool = False, skip: str = "", section: str = "all", genre: str = ""):
    choice = plex.pick(kids, 105 if short else None, tuple(skip.split(",")[:30]), section=section, genre=genre)
    return fresh({"pick": choice})


@app.get("/api/movies/search")
def api_movies_search(q: str = ""):
    return fresh({"results": _say(plex.search, q) or []})


@app.get("/api/plex/thumb")
def api_thumb(path: str, wide: bool = False):
    got = None
    try:
        got = plex.thumb(path, wide)
    except Exception:
        pass
    if not got:
        raise HTTPException(404, "No picture")
    data, kind = got
    return Response(data, media_type=kind, headers={"Cache-Control": "public, max-age=86400"})


# ---- Movie night: shared shortlist and votes ----

@app.get("/api/movie-night")
def api_movie_night(request: Request, minutes: int = 0, kids: bool = False):
    return fresh(_say(movie_night.view, movie_night.voter(request.cookies.get(auth.COOKIE)), minutes, kids))


@app.post("/api/movie-night")
async def api_movie_nominate(request: Request):
    need(request, "kid")
    body = await request.json()
    return fresh(_say(movie_night.add, str(body.get("key", ""))))


@app.post("/api/movie-night/{key}/{op}")
async def api_movie_vote(key: str, op: str, request: Request):
    need(request, "kid" if op == "vote" else "household")
    if op == "vote":
        body = await request.json()
        _say(movie_night.vote, key, movie_night.voter(request.cookies.get(auth.COOKIE)), body.get("vote"))
    elif op == "choose":
        _say(movie_night.choose, key)
    elif op == "remove":
        movie_night.remove(key)
    else:
        raise HTTPException(404, "Unknown change")
    return fresh({"ok": True})


# ---- Workshop projects: Bambuddy holds them (since 24 Oct 2026); the hub only lists them ----

@app.get("/api/projects")
def api_projects():
    items = bambuddy.projects()
    return fresh({"projects": items or [], "available": items is not None})


# ---- Workshop ----

@app.get("/api/workshop")
def api_workshop():
    s = sources.pi_status()
    w = sources.world() or {}
    models = (w.get("models") or {})
    filament.ready()
    prints = db.rows("SELECT * FROM prints ORDER BY id DESC LIMIT 20")
    week = int(time.time()) - 7 * 86400
    return fresh({
        "printer": now.printer(s),
        "prints": prints,
        "week": {
            "finished": sum(1 for p in prints if p["outcome"] == "finished" and (p["ended"] or 0) >= week),
            "hours": round(sum(((p["ended"] or time.time()) - p["started"]) for p in prints if p["started"] >= week) / 3600, 1),
        },
        "display": {"state": (s or {}).get("display_state", "Unknown"), "firmware": (s or {}).get("display_firmware")},
        "spools": bambuddy.spools(),  # None when Bambuddy doesn't answer
        "filament_month": filament.summary(30),
        "ai": {"state": (s or {}).get("ai_state", "Unknown"),
               "models": [str(m.get("name") if isinstance(m, dict) else m)[:60] for m in models.get("loaded") or []],
               "waiting": ((models.get("queue") or {}).get("waiting"))},
    })


@app.get("/api/prints/{pid}/photo.jpg")
def api_print_photo(pid: int):
    default_dir = os.path.join(os.path.dirname(os.environ.get("HUB_DB", "/var/lib/pi-hub/hub.db")), "prints")
    prints_dir = os.environ.get("HUB_PRINTS_DIR", default_dir)
    path = os.path.join(prints_dir, f"{pid}.jpg")
    if not os.path.exists(path):
        raise HTTPException(404, "No photo for this print.")
    with open(path, "rb") as f:
        return Response(f.read(), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


# ---- Bambuddy 3D printer event webhook ----

# Only Bambuddy may post here: with the shared webhook token (HUB_WEBHOOK_TOKEN, or the "webhook_token"
# setting) as "Authorization: Bearer …", "X-Hub-Token" or "?token=", or from an address in HUB_WEBHOOK_HOSTS.
# Bambuddy runs in Docker on the Pi, so its requests arrive from the container network, not 10.0.0.30.
WEBHOOK_HOSTS = {h.strip() for h in os.environ.get("HUB_WEBHOOK_HOSTS", "").split(",") if h.strip()}
WEBHOOK_MAX_BYTES = 8 * 1024 * 1024


def _webhook_allowed(request: Request):
    token = os.environ.get("HUB_WEBHOOK_TOKEN") or auth.get("webhook_token")
    if token:
        given = request.headers.get("x-hub-token") or request.query_params.get("token") or ""
        bearer = request.headers.get("authorization", "")
        if bearer.lower().startswith("bearer "):
            given = given or bearer[7:].strip()
        if given and hmac.compare_digest(given.encode(), token.encode()):
            return True
    return bool(request.client and request.client.host in WEBHOOK_HOSTS)


@app.post("/api/webhook/bambuddy")
async def api_webhook_bambuddy(request: Request):
    """Instant event webhook from Bambuddy for 3D printer events."""
    if not _webhook_allowed(request):
        raise HTTPException(401, "This webhook only accepts Bambuddy.")
    raw = await request.body()
    if len(raw) > WEBHOOK_MAX_BYTES:
        raise HTTPException(413, "Webhook payload is too large")
    try:
        import json as _json
        body = _json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    event_type = (body.get("event") or body.get("event_type") or "").lower().strip()
    title = body.get("title") or "Bambu 3D Printer"
    msg = body.get("message") or ""
    image_b64 = body.get("image")
    variables = body.get("variables") if isinstance(body.get("variables"), dict) else {}

    now_ts = int(time.time())

    # Handle completion
    if event_type in ("print_complete", "print_finished", "completed"):
        recorder.record_print("Printing", 100, now_ts)
        recorder.record_print("Idle", 0, now_ts)
        open_print = db.one("SELECT id FROM prints WHERE ended IS NOT NULL ORDER BY id DESC LIMIT 1")
        print_id = open_print["id"] if open_print else None

        # If an image was attached in base64, save it directly
        if image_b64 and print_id:
            try:
                img_data = base64.b64decode(image_b64)
                if img_data.startswith(b"\xff\xd8"):
                    default_dir = os.path.join(os.path.dirname(os.environ.get("HUB_DB", "/var/lib/pi-hub/hub.db")), "prints")
                    prints_dir = os.environ.get("HUB_PRINTS_DIR", default_dir)
                    os.makedirs(prints_dir, exist_ok=True)
                    target = os.path.join(prints_dir, f"{print_id}.jpg")
                    with open(target, "wb") as f:
                        f.write(img_data)
                    db.run("UPDATE prints SET has_photo = 1 WHERE id = ?", print_id)
            except Exception:
                pass

        # If filament usage is provided by Bambuddy, record it
        filament_used = variables.get("filament_used") or variables.get("filament_used_grams")
        if filament_used and print_id:
            try:
                grams = float(filament_used)
                db.run("UPDATE prints SET grams = ? WHERE id = ?", grams, print_id)
            except Exception:
                pass

        events.fire("print_finished", detail=msg or title, dedupe=events.PRINT_DEDUPE)
        return fresh({"ok": True, "event": event_type, "handled": "print_finished"})

    # Handle failures / cancelled
    elif event_type in ("print_failed", "print_stopped", "failed", "cancelled", "stopped"):
        progress = variables.get("progress") or 0
        error_code = variables.get("error_code") or variables.get("hms_code")
        recorder.record_print("Error", progress, now_ts, error=error_code)
        events.fire("print_failed", detail=msg or title, dedupe=events.PRINT_DEDUPE)
        return fresh({"ok": True, "event": event_type, "handled": "print_failed"})

    # Handle print started
    elif event_type in ("print_start", "print_started", "started"):
        recorder.record_print("Printing", 0, now_ts)
        events.fire("print_started", detail=msg or title, dedupe=events.PRINT_DEDUPE)
        return fresh({"ok": True, "event": event_type, "handled": "print_started"})

    # Handle filament low
    elif event_type in ("filament_low",):
        events.fire("filament_low", detail=msg or title)
        return fresh({"ok": True, "event": event_type, "handled": "filament_low"})

    return fresh({"ok": True, "event": event_type, "handled": False})


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
    reminders.ready()
    out = {}
    for key, name in LISTS.items():
        out[key] = {"name": name, "items": db.rows(
            "SELECT id, text, done, created, done_at, due, repeat FROM items WHERE list = ? AND (done = 0 OR done_at > ?) "
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
    due, repeat = body.get("due"), str(body.get("repeat") or "")
    if due not in (None, ""):
        try:
            due = int(due)
        except (TypeError, ValueError):
            raise HTTPException(400, "Choose a time for the reminder.")
        if repeat not in ("", "daily", "weekly"):
            raise HTTPException(400, "Choose how often it repeats.")
    else:
        due, repeat = None, ""
    reminders.ready()
    cur = db.run("INSERT INTO items (list, text, created, due, repeat) VALUES (?, ?, ?, ?, ?)",
                 key, text, int(time.time()), due, repeat or None)
    return fresh({"id": cur.lastrowid})


@app.post("/api/lists/{key}/print")
def api_list_print(key: str, request: Request):
    role, device = need(request, "kid")
    if key not in LISTS:
        raise HTTPException(404, "No such list")
    items = db.rows("SELECT text FROM items WHERE list = ? AND done = 0 ORDER BY created", key)
    if not items:
        raise HTTPException(400, "The list is empty.")
    text = f"{LISTS[key]}, {time.strftime('%A %-d %B')}\n\n" + "\n".join(f"[  ]  {i['text']}" for i in items) + "\n"
    r = _say(printing.submit, text.encode(), f"{LISTS[key]}.txt", 1, True)
    auth.log(role, device, f"lists:print:{key}", f"Printed the {LISTS[key].lower()} list.")
    return fresh({**r, "count": len(items)})


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
        "selfcheck": system.selfcheck(),
        "outages": system.outages(),
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
        if have == "kid":
            raise HTTPException(403, "Kids' PINs can switch devices, use lists and vote for movies. Ask a grown-up for this change.")
        raise HTTPException(401, "Sign in as the owner first." if role == "owner" else "Enter the household PIN first.")
    return have, device


def _device(request: Request):
    ua = request.headers.get("user-agent", "")
    for key, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android phone"),
                      ("Macintosh", "Mac"), ("Windows", "Windows PC")):
        if key in ua:
            return name
    return "A browser"


def _signed_in(token, role, host=""):
    resp = fresh({"role": role})
    resp.set_cookie(auth.COOKIE, token, max_age=auth.LIFETIME[role], httponly=True, samesite="strict", path="/")
    shared = gate.cookie_kwargs(host, auth.LIFETIME[role])
    if shared and role == "owner":  # signed in through the front gate: a gate-only token for every *.home.arpa tool
        resp.set_cookie(gate.COOKIE, auth.gate_session(token), **shared)
    return resp


@app.post("/api/gate/renew")
def api_gate_renew(request: Request):
    """A signed-in owner on home.home.arpa whose gate cookie is missing or stale gets a new one, so the sign-in
    hand-back never bounces between a tool and the hub."""
    need(request, "owner")
    shared = gate.cookie_kwargs(request.headers.get("host", ""), auth.LIFETIME["owner"])
    if not shared:
        raise HTTPException(400, "Open the hub at https://home.home.arpa to sign in to the other tools.")
    auth.sign_out(request.cookies.get(gate.COOKIE))  # the stale one, if any
    resp = fresh({"ok": True})
    resp.set_cookie(gate.COOKIE, auth.gate_session(request.cookies.get(auth.COOKIE)), **shared)
    return resp


@app.get("/api/gate")
def api_gate(request: Request):
    """Caddy's forward_auth check for every *.home.arpa tool: only the owner passes."""
    h = auth.session(request.cookies.get(auth.COOKIE))
    if auth.session(request.cookies.get(gate.COOKIE), gate=True) or (h and h["role"] == "owner"):
        return Response(status_code=200, headers={"X-Remote-User": "bill", "Cache-Control": "no-store"})
    return Response(status_code=302, headers={"Location": gate.signin_url(request.headers), "Cache-Control": "no-store"})


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
    return _signed_in(token, role, request.headers.get("host", ""))


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
    return _signed_in(token, role, request.headers.get("host", ""))


@app.post("/api/signout")
def api_signout(request: Request):
    auth.sign_out(request.cookies.get(auth.COOKIE))
    auth.sign_out(request.cookies.get(gate.COOKIE))
    resp = fresh({"role": "none"})
    resp.delete_cookie(auth.COOKIE, path="/")
    resp.delete_cookie(gate.COOKIE, path="/", domain=gate.DOMAIN, secure=True, httponly=True, samesite="lax")
    return resp


# ---- Fix it ----

@app.get("/api/actions")
def api_actions(request: Request):
    role, _ = who(request)
    return fresh({"actions": actions.available(role), "updates": actions.updates_status(),
                  "log": auth.recent_actions(12) if auth.allowed(role, "household") else []})


@app.get("/api/actions/{name}/verification")
def api_action_verification(name: str, request: Request):
    need(request, "household")
    return fresh(_say(actions.verify, name))


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
    role, device = need(request, "kid")
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


# ---- Siri Shortcuts: plain-text answers Siri can read out ----

from fastapi.responses import PlainTextResponse  # noqa: E402

LIST_WORDS = {"shopping": "shopping", "groceries": "shopping", "grocery": "shopping", "todo": "todo", "to do": "todo",
              "to-do": "todo", "jobs": "todo", "notes": "notes", "note": "notes", "movies": "requests", "movie": "requests"}


def _shortcut(request: Request):
    name = auth.shortcut_check(request.headers.get("authorization"))
    if not name:
        raise HTTPException(401, "That Shortcut key isn't valid. Make a new one in the hub's Settings.")
    return name


async def _shortcut_body(request: Request):
    raw = (await request.body()).decode("utf-8", "replace").strip()
    if raw.startswith("{"):
        import json as _json
        try:
            return _json.loads(raw)
        except ValueError:
            pass
    return {"text": raw}


def say(text):
    return PlainTextResponse(text, headers={"Cache-Control": "no-store"})


@app.get("/api/shortcut/status")
def api_shortcut_status(request: Request):
    _shortcut(request)
    d = now.build(sources.pi_status(), sources.plex_sessions(), {}, None)
    parts = [d["summary"] + "."]
    parts += [f"{i['what']}: {i['say']}" for i in d["issues"][:2]]
    p = d["printer"]
    if p["state"] == "printing":
        parts.append(f"The printer is {p['headline'].lower()}" + (f", {p['left']} to go." if p.get("left") else "."))
    w = outside.weather()
    if w:
        parts.append(f"It's {w['now']['temp']} degrees and {w['now']['sky'].lower()}.")
    return say(" ".join(parts))


@app.post("/api/shortcut/add")
async def api_shortcut_add(request: Request):
    who_name = _shortcut(request)
    b = await _shortcut_body(request)
    key = LIST_WORDS.get(str(b.get("list") or "shopping").strip().lower(), "shopping")
    text = " ".join(str(b.get("text", "")).split())[:200]
    if not text:
        return say("What should I add?")
    db.run("INSERT INTO items (list, text, created) VALUES (?, ?, ?)", key, text, int(time.time()))
    auth.log("household", f"Siri ({who_name})", f"lists:add:{key}", f"Added {text}.")
    return say(f"Added {text} to the {LISTS[key].lower()} list.")


@app.get("/api/shortcut/list")
def api_shortcut_list(request: Request, list: str = "shopping"):
    _shortcut(request)
    key = LIST_WORDS.get(list.strip().lower(), "shopping")
    items = [r["text"] for r in db.rows("SELECT text FROM items WHERE list = ? AND done = 0 ORDER BY created", key)]
    if not items:
        return say(f"The {LISTS[key].lower()} list is empty.")
    return say(f"{len(items)} on the {LISTS[key].lower()} list: " + ", ".join(items[:15]) + ".")


@app.post("/api/shortcut/ask")
async def api_shortcut_ask(request: Request):
    who_name = _shortcut(request)
    b = await _shortcut_body(request)
    try:
        return say(ask.ask(str(b.get("question") or b.get("text") or ""))["answer"])
    except ValueError:
        return say("What would you like to know about the house?")
    except RuntimeError as e:
        return say(str(e))


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
        "runs": events.history(),
    })


@app.post("/api/rules/preview")
async def api_rules_preview(request: Request):
    need(request, "household")
    return fresh(_say(events.preview, await request.json(), _accessory_names()))


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
        "pc_copy": system.pc_copy(),
        "log": auth.recent_actions(30),
        "people": auth.people(),
        "releases": system.releases(),
        "shortcut_keys": auth.shortcut_keys(),
        "digest": auth.get("digest", {"on": True, "at": "08:00"}),
        "quiet": auth.get("quiet_hours", {"on": False, "from": "22:00", "to": "07:00"}),
        "place": (auth.get("place") or {}).get("name"),
        "units": outside.units(),
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
        elif what == "rollback":
            r = actions.helper_with("release:rollback", {"to": str(b.get("to", ""))}, timeout=20)
            if not r.get("ok"):
                raise ValueError(r.get("message") or "Couldn't go back to that version.")
            msg = r["message"]
        elif what == "shortcut-add":
            key = auth.add_shortcut_key(b.get("name"))
            auth.log(role, device, "settings:shortcut-add", "Made a Siri Shortcut key.")
            return fresh({"ok": True, "message": "Key made. Copy it now; it won't be shown again.", "key": key})
        elif what == "shortcut-remove":
            auth.remove_shortcut_key(int(b.get("id", 0)))
            msg = "Shortcut key removed. That phone's Shortcuts stop working."
        elif what == "person-add":
            auth.add_person(b.get("name"), str(b.get("kind", "")), str(b.get("pin", "")))
            msg = f"Added {' '.join(str(b.get('name', '')).split())[:30]}."
        elif what == "person-remove":
            auth.remove_person(int(b.get("id", 0)))
            msg = "Removed that person, and signed out their devices."
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
        elif what == "units":
            u = str(b.get("units", "F")).upper()
            if u not in ("F", "C"):
                raise ValueError("Choose °F or °C.")
            auth.put("units", u)
            sources._cache.pop("weather", None)
            msg = f"Weather now in °{u}."
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


# ---- Scanning: scanservjs (Docker on the Pi), only through the hub so it needs the household PIN ----
# scanservjs listens on 127.0.0.1:8095 only; its page and API are served here under /scan/ (its paths are relative).
# Every request needs a household sign-in, because a scan goes straight into Paperless. scanservjs runs on the hub's own
# address, so the hub's cookie and Authorization are never forwarded and only content headers come back.
SCAN_URL = os.environ.get("HUB_SCAN_URL", "http://127.0.0.1:8095")
_HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authenticate", "proxy-authorization", "te",
        "trailers", "content-length", "content-encoding", "host"}
_SCAN_PASS = {"content-type", "content-disposition", "cache-control", "etag", "last-modified", "content-language"}


@app.api_route("/scan", methods=["GET"])
def scan_root():
    return Response(status_code=307, headers={"Location": "/scan/"})


@app.api_route("/scan/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def scan_proxy(path: str, request: Request):
    import httpx
    from fastapi.responses import StreamingResponse
    try:
        need(request, "household")
    except HTTPException as e:
        if request.method == "GET" and not path.startswith("api/"):
            return Response("<!doctype html><meta name=viewport content='width=device-width'><title>Scan</title>"
                            "<body style='font:16px system-ui;padding:2rem'><p>Enter the household PIN in Pi Hub first, "
                            "then open Scan again.</p><p><a href='/apps/scan' target='_top'>Open Pi Hub</a></p>",
                            status_code=e.status_code, media_type="text/html")
        raise
    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0))
    # No cookie (the hub's session stays here) and no accept-encoding (the body is passed through as is).
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP | {"cookie", "accept-encoding", "authorization"}}
    try:
        upstream = await client.send(client.build_request(request.method, f"{SCAN_URL}/{path}", params=request.query_params,
                                                          headers=headers, content=await request.body()), stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(502, "The scanner page isn't answering.")

    async def body():
        try:
            async for chunk in upstream.aiter_bytes():  # decoded, so dropping content-encoding is right
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()
    # Only content headers come back: never Set-Cookie or anything that could weaken the hub's own security headers.
    out = {k: v for k, v in upstream.headers.items() if k.lower() in _SCAN_PASS}
    return StreamingResponse(body(), status_code=upstream.status_code, headers=out)


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/{page:path}")
def index(page: str):
    # Every page is the same shell; the browser picks the view from the address.
    if page.startswith("api/"):
        raise HTTPException(404)
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
