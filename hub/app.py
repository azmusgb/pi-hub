"""Pi Hub: the home hub web app."""
import asyncio
import json
import os
import queue
import re
import hmac
import sqlite3
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import movie_night, room_camera, bambuddy, lab_start, freshness, gate, actions, ask, auth, db, digest, events, filament, needs, paperless, printer_control, records, reminders, homecontrol, laundry, now, outside, plex, printing, recorder, sources, system, wifi, lab, lab_hold, lab_guard, quick, quick_layers, quick_monitor, quick_start, quick_worker, uploads, display_pairing, display_routes, devices, releases, notify_routes, systems, today

STATIC = Path(__file__).parent / "static"
LISTS = {"shopping": "Shopping", "todo": "To do", "notes": "Notes", "requests": "Movie requests"}

app = FastAPI(title="Pi Hub", docs_url=None, redoc_url=None, openapi_url=None)
QUICK = os.environ.get("HUB_QUICK", "1") != "0"  # HUB_QUICK=0 is Quick Print's off switch: no route, loop or worker answer (docs/quick-print.md)
if QUICK:
    app.include_router(quick_worker.worker_router)  # before lab: its /api/lab/quick/worker paths are the Mac's
app.include_router(lab.router)
app.include_router(uploads.router)
if QUICK:
    for _router in (quick.router, quick_worker.owner_router, quick_layers.router, quick_start.router, quick_monitor.router):
        app.include_router(_router)
app.include_router(display_routes.router)
app.include_router(notify_routes.router)
sampler = sources.Sampler()

if os.environ.get("HUB_NO_SAMPLER") != "1":
    try:
        records.load()  # the last known state, marked stale, before the loop's first refresh
    except Exception:
        import traceback
        traceback.print_exc()
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
    unsafe = request.method not in ("GET", "HEAD", "OPTIONS")
    # The Mac's lab calls are exempt only when they carry the hub's lab key and that key verifies, never for the path alone.
    # A key that is sent but wrong is refused as such; with no key header the normal same-origin check applies.
    mac = False
    # The Mac may also post a banner to the display (/api/display/notify), on the same terms.
    mac_path = request.url.path.startswith("/api/lab/") or request.url.path == "/api/display/notify"
    if unsafe and mac_path and "x-hub-mac-key" in request.headers:
        if not lab_guard.mac_key_ok(request):
            return JSONResponse({"detail": "The Mac's lab key is missing or wrong."}, status_code=401)
        mac = True
    # The display's calls likewise: exempt only with a verified display key (a wrong one is 401). Redeeming a pairing
    # code is open to the display, which has no hub page to come from; the six-digit code is its credential.
    display = False
    if unsafe and request.url.path.startswith("/api/display/"):
        if "x-hub-display-key" in request.headers:
            if not display_pairing.key_ok(request):
                return JSONResponse({"detail": "Pair the display first."}, status_code=401)
            display = True
        elif request.url.path == "/api/display/pair":
            # Only JSON is exempt: a cross-site JSON POST needs a CORS preflight the hub never grants, whereas a form or
            # text/plain POST would let any page burn the code's tries.
            if not request.headers.get("content-type", "").lower().startswith("application/json"):
                return JSONResponse({"detail": "Send the code as JSON."}, status_code=415)
            display = True
    # A deploy reporting its release (platform step 3): exempt only with a deploy key that verifies for that target.
    deploy = False
    if unsafe and request.url.path.startswith("/api/releases/") and "x-hub-deploy-key" in request.headers:
        if not releases.key_ok(request, request.url.path[len("/api/releases/"):]):
            return JSONResponse({"detail": "That deploy key is missing or wrong."}, status_code=401)
        deploy = True
    # Another system's phone notice (platform step 5): exempt only with that source's own key, verified.
    if unsafe and request.url.path.startswith("/api/notify/") and (
            "x-hub-deploy-key" in request.headers or "x-hub-mac-key" in request.headers):
        if not notify_routes.key_ok(request, request.url.path[len("/api/notify/"):]):
            return JSONResponse({"detail": notify_routes.WRONG_KEY}, status_code=401)
        deploy = True
    if unsafe and not shortcut and not webhook and not mac and not display and not deploy:
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
                                     "calendar": bool(auth.get("calendar_url"))}, records.all()))


# ---- Now ----

@app.get("/api/now")
def api_now():
    try:
        disk = sources.disk_free_gb("/")
    except OSError:
        disk = None
    data = now.build(records.all(), sources.plex_sessions(), sampler.snapshot(), disk, sources.network_metrics())
    data["reminders"] = reminders.due_today()
    data["setup_left"] = sum(1 for k in ("homebridge_login", "place", "wifi", "calendar_url") if not auth.get(k)) \
        if not auth.setup_needed() else None
    return fresh(data)


@app.get("/api/today")
def api_today():
    """The house's day for Home's band (amendment A8 D7)."""
    return fresh(today.body())


# ---- Records ----

STREAM_PING = 15  # seconds of quiet before the stream sends a comment, so proxies keep it open
STREAM_SLICE = 1  # how often the stream looks for a vanished client


def records_body():
    recs = records.all()
    return {"as_of": time.time(), "records": [recs[k] for k in [*records.KINDS, *releases.ids()] if k in recs]}


@app.get("/api/systems")
def api_systems():
    return fresh(systems.body())


@app.get("/api/records")
def api_records(since: int = 0):
    body = records_body()
    body["events"] = records.recent_events(since=since, limit=40)
    return fresh(body)


async def records_stream(request, ping=None):
    """The snapshot, then each change as it happens, a ping when quiet; unsubscribes when the client leaves."""
    ping = STREAM_PING if ping is None else ping
    q = records.subscribe()
    try:
        yield "event: snapshot\ndata: " + json.dumps(records_body()) + "\n\n"
        quiet = 0.0
        while True:
            if await request.is_disconnected():
                return
            wait = min(STREAM_SLICE, max(ping - quiet, 0.01))
            try:
                change = await asyncio.to_thread(q.get, True, wait)
            except queue.Empty:
                quiet += wait
                if quiet >= ping:
                    quiet = 0.0
                    yield ": ping\n\n"
                continue
            quiet = 0.0
            yield "event: change\ndata: " + json.dumps(change) + "\n\n"
    finally:
        records.unsubscribe(q)


@app.get("/api/records/stream")
async def api_records_stream(request: Request):
    return StreamingResponse(records_stream(request), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/api/releases/{target}")
async def api_release_report(target: str, request: Request):
    """A deploy off the Pi reports how it went; the hub keeps it as release:<target> (releases.py). Only a deploy key
    for this target may write, never an owner's session: what is live is the deploy's fact, not a person's."""
    if not releases.key_ok(request, target):
        raise HTTPException(401, "That deploy key is missing or wrong.")
    raw = await request.body()
    if len(raw) > releases.MAX_BODY:
        raise HTTPException(413, "That release report is too big.")
    try:
        body = json.loads(raw)
    except ValueError:
        body = None
    now = time.time()
    report = releases.valid(target, body, now)
    if report is None:
        raise HTTPException(400, releases.INVALID)
    rec = releases.put(target, report, now)
    return {"ok": True, "id": rec["id"], "state": rec["state"], "commit": rec["detail"].get("commit")}


@app.get("/api/needs")
def api_needs():
    return fresh(needs.current())


@app.get("/api/system/backups")
def api_system_backups():
    """When the Pi and the Mac last backed up (newest restic snapshot), through the root helper."""
    report = sources.cached("helper-backups", 300, lambda: actions.helper("backups:ages", timeout=5))
    now = int(time.time())
    ages = (report or {}).get("ages") or {}
    return fresh({"repos": [{"name": n, "last": t, "hours": (now - t) // 3600 if t else None} for n, t in ages.items()],
                  "available": bool(report and report.get("ok")), "open": "tool:backups"})


@app.get("/api/network/adguard")
def api_network_adguard():
    """Today's DNS queries and blocks from AdGuard, through the root helper (which holds the password)."""
    report = sources.cached("helper-adguard", 300, lambda: actions.helper("adguard:stats", timeout=5))
    if not report or not report.get("ok"):
        return fresh({"available": False})
    return fresh({"available": True, "queries": report["queries"], "blocked": report["blocked"],
                  "protection": report.get("protection"), "open": "tool:adguard"})


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

@app.get("/api/movies/latest")
def api_movies_latest():
    recent = plex.recently_added()
    return fresh({"title": recent[0]["title"] if recent else None})


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
def api_drives(request: Request):
    need(request, "household")  # model and serial, and a smartctl run on the Pi: not for anyone on the network
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
    log = bambuddy.prints(20)  # None when Bambuddy doesn't answer
    prints = [dict(p, has_photo=os.path.exists(os.path.join(recorder.photos_dir(), f"{p['id']}.jpg"))) for p in log or []]
    this_week = [p for p in prints if (p["started"] or 0) >= int(time.time()) - 7 * 86400]
    p_rec = records.get("printer")
    return fresh({
        "printer": now.printer_from(p_rec),  # the same card /api/now gives
        "prints": prints,
        "prints_available": log is not None,
        "week": None if log is None else {  # None, not zeros, when Bambuddy's log isn't there
            "finished": sum(1 for p in this_week if p["status"] == "completed"),
            "hours": round(sum((p["seconds"] if p["seconds"] is not None else (p["ended"] or time.time()) - p["started"])
                               for p in this_week) / 3600, 1),
        },
        "display": {"state": (s or {}).get("display_state", "Unknown"), "firmware": (s or {}).get("display_firmware")},
        "spools": bambuddy.spools(),  # None when Bambuddy doesn't answer
        "queue": bambuddy.queue(),  # None when Bambuddy doesn't answer; [] when nothing is waiting
        "ams_trays": (p_rec.get("detail") or {}).get("ams_trays") or [] if p_rec else [],
        "lab": lab.workshop_summary(),
        "filament_month": filament.summary(30),
        "ai": {"state": (s or {}).get("ai_state", "Unknown"),
               "models": [str(m.get("name") if isinstance(m, dict) else m)[:60] for m in models.get("loaded") or []],
               "waiting": ((models.get("queue") or {}).get("waiting"))},
    })


_printer_busy = printer_control.BUSY  # shared with the workshop display's Clear plate
PRINTER_WORDS = {"clear": "clear the plate", "pause": "pause", "resume": "resume"}


LAB_PROJECT_RE = re.compile(r"^[a-z0-9-]{1,40}$")
LAB_EXPERIMENT_RE = re.compile(r"^E-\d{1,6}$")


def _start_target(project, experiment):
    if not isinstance(project, str) or not LAB_PROJECT_RE.match(project) or project == lab.RESERVED_PROJECT or \
            not isinstance(experiment, str) or not LAB_EXPERIMENT_RE.match(experiment):
        raise HTTPException(400, "Name a print lab project and experiment.")


def _printer_now():
    sources._cache.pop("bambuddy_printer", None)  # the printer as it is now, not as the page last saw it
    return sources.bambuddy_printer(timeout=3)


if os.environ.get("HUB_NO_SAMPLER") != "1":
    threading.Thread(target=lab_hold.run, args=(_printer_now,), daemon=True).start()
    if QUICK:
        quick_start.boot()  # a start that was in flight when the hub stopped is uncertain, never resumed (A19)
        threading.Thread(target=quick_start.run, args=(_printer_now,), daemon=True).start()


@app.get("/api/printer/start/{project}/{experiment}")
def api_printer_start_check(project: str, experiment: str, request: Request, item: int | None = None):
    """Whether a staged lab build can start now (S5), for the sheet: {"reasons", "staged", "build", "printer": {"state",
    "trays"}, "queue"} (owner only). The sheet also reads it after Start, with `?item=<queue item>`, to see the printer
    begin and Bambuddy's reason if the item is waiting."""
    need(request, "owner")
    _start_target(project, experiment)
    x, b = lab_start.mirror(project, experiment), _printer_now()
    return fresh({"reasons": lab_start.refusals(b, x), "bed_only": lab_start.bed_only(b, x),
                  **lab_hold.state(project, experiment), "staged": (x or {}).get("staged"),
                  "build": (x or {}).get("shown_build"),
                  "printer": {"state": (b or {}).get("bambuddy_state"), "trays": (b or {}).get("ams_trays") or []},
                  "queue": lab_start.queue_item(item, lab_start.read_key()) if item else None})


@app.post("/api/printer/start")
async def api_printer_start(request: Request):
    """Start a staged lab print (A12): owner only, both ticks, the checks at the tap, then Bambuddy's queue with the
    control key. The device is logged and lab pull is told who started it."""
    role, device = need(request, "owner")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Send the project, the experiment and both ticks.")
    if not isinstance(body, dict):
        raise HTTPException(400, "Send the project, the experiment and both ticks.")
    project, experiment = body.get("project"), body.get("experiment")
    _start_target(project, experiment)
    if body.get("plate_clear") is not True or body.get("filament_ok") is not True:
        raise HTTPException(400, "Tick both: the plate is clear and dry, and the filament matches.")
    if printer_control.hold("start") is not None:
        raise HTTPException(409, "The hub is already sending the printer a command. Wait a moment.")
    try:
        x = lab_start.mirror(project, experiment)
        b = await asyncio.to_thread(_printer_now)
        reasons = lab_start.refusals(b, x)
        if reasons and body.get("wait_for_bed") is True and lab_start.bed_only(b, x):  # A12b: hold it for the bed
            try:
                h = lab_hold.place(project, experiment, x, role, device)
            except ValueError as e:
                raise HTTPException(409, str(e))
            return fresh({"ok": True, "held": True, "hold": h,
                          "say": f"Waiting for the bed to cool (it is {b.get('bed_temp'):.0f} °C), then {experiment} "
                                 f"starts by itself."})
        if reasons:
            raise HTTPException(409, " ".join(reasons) + " Nothing was sent.")
        ck = lab_start.control_key()
        if not ck:
            raise HTTPException(503, printer_control._say("no key"))
        tapped = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        r = await asyncio.to_thread(lab_start.start, x, ck, lab_start.read_key())
    finally:
        printer_control.release()
    sources._cache.pop("bambuddy_printer", None)
    auth.log(role, device, f"printer:start:{project}:{experiment}", r["say"])
    if not r["ok"]:
        raise HTTPException(502, r["say"])
    lab.queue_one_tap(project, experiment, {"tapped_at": tapped, "build": x.get("shown_build"),
                                            "queue_item": r["queue_item"], "library_file": r["library_file"]}, device)
    return fresh({"ok": True, "say": r["say"], "queue_item": r["queue_item"]})


@app.delete("/api/printer/start/{project}/{experiment}")
def api_printer_start_cancel(project: str, experiment: str, request: Request):
    """Cancel a start that is waiting for the bed (A12b): owner only, logged."""
    role, device = need(request, "owner")
    _start_target(project, experiment)
    return fresh({"ok": True, "cancelled": lab_hold.cancel(project, experiment, role, device)})


@app.post("/api/printer/{action}")
def api_printer_action(action: str, request: Request):
    """Clear the plate, pause or resume, through Bambuddy with the hub's control key (owner only)."""
    role, device = need(request, "owner")
    if action not in printer_control.STEPS:
        raise HTTPException(404, "The printer can clear, pause or resume.")
    if printer_control.hold(action) is not None:
        raise HTTPException(409, "The hub is already sending the printer a command. Wait a moment.")
    try:
        # Check the printer's state now, not the page's: a stale tab must not pause or clear the wrong print.
        sources._cache.pop("bambuddy_printer", None)
        b = sources.bambuddy_printer(timeout=3)
        if not b or not b.get("connected"):
            raise HTTPException(503, "Bambuddy can't see the printer just now, so the hub didn't send anything.")
        if action not in now.printer_actions(b):
            raise HTTPException(409, f"The printer can't {PRINTER_WORDS[action]} right now; its state has changed. "
                                     "Nothing was sent.")
        r = printer_control.run(action)
    finally:
        printer_control.release()
    if "no key" not in r["steps"].values():  # Bambuddy was asked: the next refresh reads its state again
        sources._cache.pop("bambuddy_printer", None)
    auth.log(role, device, f"printer:{action}", r["say"])  # every action logs the device (baseline; A12 plan 9)
    if not r["ok"]:
        raise HTTPException(503 if "no key" in r["steps"].values() else 502, r["say"])
    return fresh({"ok": True, "say": r["say"]})


@app.get("/api/prints/{pid}/photo.jpg")
def api_print_photo(pid: int):
    path = os.path.join(recorder.photos_dir(), f"{pid}.jpg")
    if not os.path.exists(path):
        raise HTTPException(404, "No photo for this print.")
    with open(path, "rb") as f:
        return Response(f.read(), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


# ---- Bambuddy 3D printer event webhook ----

# Only Bambuddy may post here: with the shared webhook token (HUB_WEBHOOK_TOKEN, or the "webhook_token"
# setting) as "Authorization: Bearer …", "X-Hub-Token" or "?token=", or from an address in HUB_WEBHOOK_HOSTS.
# Bambuddy runs in Docker on the Pi, so its requests arrive from the container network, not 10.0.0.80.
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

    # Handle completion
    if event_type in ("print_complete", "print_finished", "completed"):
        events.fire("print_finished", detail=msg or title, dedupe=events.PRINT_DEDUPE)
        return fresh({"ok": True, "event": event_type, "handled": "print_finished"})

    # Handle failures / cancelled
    elif event_type in ("print_failed", "print_stopped", "failed", "cancelled", "stopped"):
        events.fire("print_failed", detail=msg or title, dedupe=events.PRINT_DEDUPE)
        return fresh({"ok": True, "event": event_type, "handled": "print_failed"})

    # Handle print started
    elif event_type in ("print_start", "print_started", "started"):
        events.fire("print_started", detail=msg or title, dedupe=events.PRINT_DEDUPE)
        return fresh({"ok": True, "event": event_type, "handled": "print_started"})

    # Handle filament low
    elif event_type in ("filament_low",):
        events.fire("filament_low", detail=msg or title)
        return fresh({"ok": True, "event": event_type, "handled": "filament_low"})

    return fresh({"ok": True, "event": event_type, "handled": False})


# ---- Workshop camera (through the failover service) ----

@app.get("/api/camera.jpg")
def api_camera():
    import urllib.request
    try:
        with urllib.request.urlopen(f"{sources.CAMERA}/x2d/frame.jpg", timeout=4) as r:
            return Response(r.read(400 * 1024), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    except OSError:
        raise HTTPException(503, "The camera isn't sending pictures right now.")


@app.get("/api/camera")
def api_camera_health():
    return fresh(sources.camera_health())


# ---- Room view: the Pi's own camera (amendment A17), for the owner only: it shows the room, not just the printer ----

def _room_unavailable(e):
    return JSONResponse({"reason": e.reason, "detail": str(e)}, status_code=429 if e.reason == "busy" else 503,
                        headers={"Cache-Control": "no-store"})


@app.get("/api/camera/room")
def api_room_camera(request: Request):
    need(request, "owner")
    return fresh(room_camera.CAMERA.state())


@app.get("/api/camera/room.jpg")
async def api_room_camera_still(request: Request):
    need(request, "owner")
    try:
        jpg, at = await room_camera.CAMERA.still()
    except room_camera.Unavailable as e:
        return _room_unavailable(e)
    return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Frame-At": f"{at:.3f}"})


@app.get("/api/camera/room/live")
async def api_room_camera_live(request: Request):
    need(request, "owner")
    stream = room_camera.CAMERA.live()
    try:
        first = await stream.__anext__()  # busy or a failed capture answers in words, before any part is sent
    except room_camera.Unavailable as e:
        return _room_unavailable(e)

    async def parts():
        try:
            yield first
            async for p in stream:
                yield p
        except room_camera.Unavailable:
            pass  # the capture failed mid-stream: the stream just ends, and the page falls back to the still
        finally:
            await stream.aclose()

    return StreamingResponse(parts(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


# The owner sets the picture (amendment A18). The page draws its form from the hub's own table of controls.

def _room_settings_body(cam):
    return {"settings": cam.settings(), "defaults": dict(room_camera.DEFAULTS), "controls": room_camera.CONTROLS,
            "applying": cam.applying}


@app.get("/api/camera/room/settings")
def api_room_camera_settings(request: Request):
    need(request, "owner")
    return fresh(_room_settings_body(room_camera.CAMERA))


async def _room_apply(request, values, action):
    role, device = need(request, "owner")
    cam = room_camera.CAMERA
    old = cam.settings()
    try:
        new = await cam.apply(values)
    except room_camera.Invalid as e:
        return JSONResponse({"field": e.field, "reason": e.reason}, status_code=422, headers={"Cache-Control": "no-store"})
    except room_camera.Applying:
        return JSONResponse({"field": None, "reason": "The camera is still applying the last change."}, status_code=409,
                            headers={"Cache-Control": "no-store"})
    auth.log(role, device, action, room_camera.describe_changes(old, new))
    return fresh({**_room_settings_body(cam), "state": cam.state()})


@app.post("/api/camera/room/settings")
async def api_room_camera_apply(request: Request):
    need(request, "owner")
    try:
        values = await request.json()
    except ValueError:
        return JSONResponse({"field": None, "reason": "Send every camera setting, as one object."}, status_code=422,
                            headers={"Cache-Control": "no-store"})
    return await _room_apply(request, values, "room-camera:settings")


@app.post("/api/camera/room/live-controls")
async def api_room_camera_live_control(request: Request):
    """A live change to the running Room view camera (amendment A20 D1): {"key": ..., "value": ...} for one setting, or
    {"values": {...}} for several applied as one change (a look, Auto or Fit; A23 plan decision 2)."""
    role, device = need(request, "owner")
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or set(body) not in ({"key", "value"}, {"values"}):
        return JSONResponse({"field": None, "reason": "Send one setting as {key, value}, or several as {values}."},
                            status_code=422, headers={"Cache-Control": "no-store"})
    try:
        if "values" in body:
            values = await room_camera.CAMERA.live_controls(body["values"], device)
            return fresh({"values": values, "live_values": dict(room_camera.CAMERA.live_values),
                          "state": room_camera.CAMERA.state()})
        value = await room_camera.CAMERA.live_control(body["key"], body["value"], device)
    except room_camera.Invalid as e:
        return JSONResponse({"field": e.field, "reason": e.reason}, status_code=422, headers={"Cache-Control": "no-store"})
    except room_camera.TooFast:
        return JSONResponse({"field": None, "reason": "Slow down: the camera takes ten changes a second."}, status_code=429,
                            headers={"Cache-Control": "no-store"})
    except room_camera.NotLive:
        return JSONResponse({"field": None, "reason": "Live adjust isn't running. Use Apply."}, status_code=409,
                            headers={"Cache-Control": "no-store"})
    except room_camera.Unavailable as e:
        return _room_unavailable(e)
    return fresh({"key": body["key"], "value": value, "live_values": dict(room_camera.CAMERA.live_values),
                  "state": room_camera.CAMERA.state()})


@app.post("/api/camera/room/settings/reset")
async def api_room_camera_reset(request: Request):
    return await _room_apply(request, dict(room_camera.DEFAULTS), "room-camera:reset")


# --- Quick Looks and Snapshots (amendment A20 D2/D3, plan P2) ---

@app.get("/api/camera/room/looks")
def api_room_camera_looks(request: Request):
    need(request, "owner")
    return fresh({"looks": room_camera.get_looks()})


@app.post("/api/camera/room/looks")
async def api_room_camera_save_look(request: Request):
    role, device = need(request, "owner")
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or "name" not in body or "values" not in body:
        return JSONResponse({"field": None, "reason": "Send look as {name, values}."}, status_code=422,
                            headers={"Cache-Control": "no-store"})
    try:
        look = room_camera.save_look(body["name"], body["values"])
    except room_camera.Invalid as e:
        return JSONResponse({"field": e.field, "reason": e.reason}, status_code=422,
                            headers={"Cache-Control": "no-store"})
    auth.log(role, device, "room-camera:look", f"saved '{look['name']}'")
    return fresh({"look": look, "looks": room_camera.get_looks()})


@app.delete("/api/camera/room/looks/{name}")
def api_room_camera_delete_look(name: str, request: Request):
    role, device = need(request, "owner")
    try:
        room_camera.delete_look(name)
    except room_camera.Invalid as e:
        return JSONResponse({"field": e.field, "reason": e.reason}, status_code=422,
                            headers={"Cache-Control": "no-store"})
    auth.log(role, device, "room-camera:look", f"deleted '{name}'")
    return fresh({"deleted": name, "looks": room_camera.get_looks()})


@app.get("/api/camera/room/snapshots")
def api_room_camera_list_snapshots(request: Request):
    need(request, "owner")
    return fresh({"snapshots": room_camera.list_snapshots()})


@app.post("/api/camera/room/snapshots")
async def api_room_camera_take_snapshot(request: Request):
    role, device = need(request, "owner")
    try:
        meta = await room_camera.save_snapshot()
    except room_camera.Invalid as e:
        return JSONResponse({"field": e.field, "reason": e.reason}, status_code=422,
                            headers={"Cache-Control": "no-store"})
    except room_camera.Unavailable as e:
        return _room_unavailable(e)
    auth.log(role, device, "room-camera:snapshot", f"saved snapshot '{meta['id']}'")
    return fresh({"snapshot": meta, "snapshots": room_camera.list_snapshots()})


@app.get("/api/camera/room/snapshots/{snapshot_id}.jpg")
def api_room_camera_get_snapshot_jpg(snapshot_id: str, request: Request):
    need(request, "owner")
    try:
        path = room_camera.get_snapshot_path(snapshot_id, "jpg")
    except room_camera.Invalid:
        return Response(status_code=404)
    if not os.path.exists(path):
        return Response(status_code=404)
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return Response(status_code=404)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.delete("/api/camera/room/snapshots/{snapshot_id}")
def api_room_camera_delete_snapshot(snapshot_id: str, request: Request):
    role, device = need(request, "owner")
    try:
        room_camera.delete_snapshot(snapshot_id)
    except room_camera.Invalid as e:
        return JSONResponse({"field": e.field, "reason": e.reason}, status_code=422,
                            headers={"Cache-Control": "no-store"})
    auth.log(role, device, "room-camera:snapshot", f"deleted snapshot '{snapshot_id}'")
    return fresh({"deleted": snapshot_id, "snapshots": room_camera.list_snapshots()})



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
    both = system.alerts() + notify_routes.history()  # pi-status's file, then the other systems' notices
    return fresh({"alerts": sorted(both, key=lambda a: a["ts"], reverse=True)[:200]})


# ---- Sign-in ----

# who and need live in auth so routers (the print lab) can use them without importing the app.
who, need = auth.who, auth.need


def _device(request: Request):
    ua = request.headers.get("user-agent", "")
    for key, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android phone"),
                      ("Macintosh", "Mac"), ("Windows", "Windows PC")):
        if key in ua:
            return name
    return "A browser"


def _signed_in(token, role):
    resp = fresh({"role": role})
    resp.set_cookie(auth.COOKIE, token, max_age=auth.OWNER_LIFETIME, httponly=True, samesite="strict", path="/")
    return resp


@app.post("/api/gate/renew")
async def api_gate_renew(request: Request):
    """A signed-in owner on the hub asks to open a tool: hand back its address with a one-time code that the gate
    spends on that tool's own host (its cookie is host-only), so the sign-in hand-back never bounces."""
    need(request, "owner")
    if not gate.on_house_name(request.headers.get("host", "")):
        raise HTTPException(400, f"Open the hub at {gate.HOME} to sign in to the other tools.")
    b = await request.json()
    nxt = gate.safe_next(b.get("next") if isinstance(b, dict) else None)
    host = urlsplit(nxt).hostname
    if nxt == gate.HOME or host == gate.HUB_HOST:
        raise HTTPException(400, "That isn't one of the other tools.")
    if devices.owner_device(request):  # the gate lets the owner's own devices through without a code
        return fresh({"next": nxt})
    code = auth.gate_code(request.cookies.get(auth.COOKIE), host)
    if not code:
        raise HTTPException(401, "Sign in as the owner first.")
    return fresh({"next": gate.with_code(nxt, code)})


@app.get("/api/gate")
def api_gate(request: Request):
    """Caddy's forward_auth check for every gated tool: only the owner passes. A hand-off code in the address is
    spent here for that tool's host-only cookie, and the browser is sent on to the address without it."""
    url, code = gate.split_code(gate.original_url(request.headers))
    h = auth.session(request.cookies.get(auth.COOKIE))
    # Every pass needs a request a Lax cookie would allow across sites: every tool shares one site, so SameSite=Lax alone
    # would let a page on one tool post to another with that tool's cookie.
    ok = gate.lax_like(request.headers) and bool(
        auth.session(request.cookies.get(gate.COOKIE), gate=True) or (h and h["role"] == "owner")
        or devices.owner_device(request))
    if code:
        host = request.headers.get("x-forwarded-host", "").lower().split(":")[0]
        loc = gate.safe_next(url)  # the redirect target must be the very host the code is spent on
        same = urlsplit(loc).hostname == host
        token = auth.redeem_gate_code(code, host) if same else None
        if token:
            auth.sign_out(request.cookies.get(gate.COOKIE))  # this tool's previous token, if the browser sent one
            resp = Response(status_code=302, headers={"Location": loc, "Cache-Control": "no-store"})
            resp.set_cookie(gate.COOKIE, token, **gate.cookie_kwargs(auth.OWNER_LIFETIME))
            return resp
        if ok and same:  # a spent code on an already signed-in visit: drop it from the tool's address
            return Response(status_code=302, headers={"Location": loc, "Cache-Control": "no-store"})
    if ok:
        return Response(status_code=200, headers={"X-Remote-User": "bill", "Cache-Control": "no-store"})
    return Response(status_code=302, headers={"Location": gate.signin_url(request.headers), "Cache-Control": "no-store"})


@app.get("/api/assistant")
def api_assistant():
    """Whether Local AI answers and whether the PC is on, for the Assistant button's `assistant_down` and `pc_off`."""
    pc = (records.get("pc") or {}).get("state") or "unknown"
    return fresh({"state": (sources.pi_status() or {}).get("ai_state") or "Unknown", "pc": pc})


@app.get("/api/me")
def api_me(request: Request):
    role, device = who(request)
    return fresh({"role": role, "setup_needed": auth.setup_needed(), "device": device,
                  "tailscale": bool(devices.this_device(request))})


@app.post("/api/setup")
async def api_setup(request: Request):
    b = await request.json()
    try:
        auth.setup(b.get("code", ""), b.get("owner_password", ""))
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
        token, role = auth.sign_in(request.client.host, _device(request), str(b.get("password", "")))
    except PermissionError as e:
        raise HTTPException(429 if "Too many" in str(e) else 403, str(e))
    if b.get("remember") and devices.this_device(request):
        try:
            name = devices.add(request)
            auth.log(role, _device(request), "settings:device-add", f"Remembered {name} as your device.")
        except ValueError:
            pass  # signed in all the same; Settings › Your devices says why
    return _signed_in(token, role)


@app.post("/api/signout")
def api_signout(request: Request):
    auth.sign_out(request.cookies.get(auth.COOKIE))
    auth.sign_out(request.cookies.get(gate.COOKIE))
    resp = fresh({"role": "none"})
    resp.delete_cookie(auth.COOKIE, path="/")
    return resp


# ---- Fix it ----

@app.get("/api/actions")
def api_actions(request: Request):
    role, _ = who(request)
    return fresh({"actions": actions.available(role), "updates": actions.updates_status(),
                  "containers": actions.containers() if auth.allowed(role, "household") else [],
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


@app.get("/api/laundry")
def api_laundry():
    return fresh(laundry.status())


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
def api_wifi_qr(request: Request):
    need(request, "household")  # the code holds the password, which /api/wifi keeps from anyone signed out
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
    d = now.build(records.all(), sources.plex_sessions(), {}, None)
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


# Read-only: the same machines as /api/laundry, for a Shortcut or the family-room panel, which carry a key, not a cookie.
@app.get("/api/shortcut/laundry")
def api_shortcut_laundry(request: Request):
    _shortcut(request)
    return fresh(laundry.status())


@app.post("/api/shortcut/ask")
async def api_shortcut_ask(request: Request):
    _shortcut(request)
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
        "releases": system.releases(),
        "shortcut_keys": auth.shortcut_keys(),
        "devices": _devices_view(request),
        "digest": auth.get("digest", {"on": True, "at": "08:00"}),
        "quiet": auth.get("quiet_hours", {"on": False, "from": "22:00", "to": "07:00"}),
        "place": (auth.get("place") or {}).get("name"),
        "units": outside.units(),
        "calendar_set": bool(auth.get("calendar_url")),
        "alerts_ready": events.topic_ready(),
    })


def _devices_view(request: Request):
    me = devices.this_device(request)
    return {"listed": devices.listed(), "this": me and {"stable_id": me["stable_id"], "name": me["name"]},
            "login": devices.owner_login()}


@app.post("/api/settings/{what}")
async def api_settings_save(what: str, request: Request):
    role, device = need(request, "owner")
    b = await request.json()
    try:
        if what == "password":
            auth.set_owner_password(str(b.get("password", "")), keep=request.cookies.get(auth.COOKIE))
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
        elif what == "device-add":
            name = devices.add(request)
            auth.log(role, device, "settings:device-add", f"Added {name} as your device.")
            return fresh({"ok": True, "message": f"{name} is now one of your devices. It opens the hub as the owner."})
        elif what == "device-remove":
            sid = str(b.get("stable_id", ""))
            me = devices.this_device(request)
            if me and me["stable_id"] == sid and not auth.session(request.cookies.get(auth.COOKIE)):
                raise ValueError("Sign in with the owner password on this device before removing it, so you aren't "
                                 "locked out.")
            devices.remove(sid)
            msg = "Device removed. It needs the owner password from now on."
        elif what == "shortcut-add":
            key = auth.add_shortcut_key(b.get("name"))
            auth.log(role, device, "settings:shortcut-add", "Made a Siri Shortcut key.")
            return fresh({"ok": True, "message": "Key made. Copy it now; it won't be shown again.", "key": key})
        elif what == "shortcut-remove":
            auth.remove_shortcut_key(int(b.get("id", 0)))
            msg = "Shortcut key removed. That phone's Shortcuts stop working."
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
    """Open and cheap: 200 only when the hub can read its own database. The outside heartbeat relies on this."""
    try:
        db.one("SELECT count(*) AS n FROM sqlite_master")
    except (sqlite3.Error, OSError):
        return JSONResponse({"ok": False, "error": "database"}, status_code=503, headers={"Cache-Control": "no-store"})
    return {"ok": True}


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


# ---- Scanning (platform step 7, PR 7.4; amendment A22 section 10). Scan is its own tool at scan.<house> behind the
# gate. GET /scan is Pi Hub's Scan page, in the shell (step 12). Everything else that used to be the old scanner keeps
# moving to the tool with its path and query (308 keeps the method too): /scan/..., and any POST, PUT or DELETE.
SCAN_HOST = "https://scan.rahe-home.duckdns.org"


@app.api_route("/scan", methods=["POST", "PUT", "DELETE"])
@app.api_route("/scan/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
def scan_moved(request: Request, path: str = ""):
    query = f"?{request.url.query}" if request.url.query else ""
    return Response(status_code=308, headers={"Location": f"{SCAN_HOST}/{path}{query}"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _shell_paths() -> frozenset:
    """Every address the shell answers, from the kit's one page list (hub/static/ui/pages.json; A22 section 3): Pi
    Hub's own built pages, their old addresses, and the Assistant's door. A page the server writes itself (the Privacy
    note, role standalone) has its own route, and a view at a #fragment has no address of its own here."""
    pages = json.loads((STATIC / "ui" / "pages.json").read_text())["pages"]
    mine = [p for p in pages if p["system"] == "hub" and p.get("built") is not False and "#" not in p["path"]]
    drawn = {p["path"] for p in mine if p["role"] != "standalone"}
    return frozenset(drawn | {a for p in mine for a in p.get("aliases", [])} | {"/assistant"})


SHELL_PATHS = _shell_paths()

# Any other address: a real 404, not the shell (§5.6 "Any other path"). Standalone, in the kit's look.
NOT_FOUND_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Pi Hub</title>
<script src="/static/js/saved-theme.js"></script>
<link rel="stylesheet" href="/static/ui/tokens.css"><link rel="stylesheet" href="/static/ui/components.css">
<style>body{margin:0;padding:24px 16px;background:var(--ui-bg);color:var(--ui-text);font:400 var(--ui-fs-4)/1.5 var(--ui-font)}
main{max-width:32rem;margin:10vh auto 0}h1{margin:0 0 8px;font-size:var(--ui-fs-5);line-height:1.25}
p{margin:0 0 16px;color:var(--ui-muted)}nav{display:flex;flex-wrap:wrap;gap:12px}</style>
</head><body><main>
<h1>Page not found</h1>
<p>There’s no page at this address on Pi Hub.</p>
<nav aria-label="Ways back"><a class="ui-btn ui-btn--primary" href="/">Open Home</a><a class="ui-btn" href="/system">System</a></nav>
</main></body></html>"""


# The privacy note Google's consent screen links to for pi-offsite, the owner's own OAuth app that writes the off-site
# backup to Google Drive (amendment A5). Standalone, like the 404 page.
PRIVACY_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy note · Pi Hub</title>
<script src="/static/js/saved-theme.js"></script>
<link rel="stylesheet" href="/static/ui/tokens.css"><link rel="stylesheet" href="/static/ui/components.css">
<style>body{margin:0;background:var(--ui-bg);color:var(--ui-text);font:400 var(--ui-fs-4)/1.5 var(--ui-font)}
main{max-width:36rem;margin:10vh auto 0;padding:var(--ui-s-5) var(--ui-s-4)}
h1{margin:0 0 var(--ui-s-2);font-size:var(--ui-fs-5);line-height:1.25}
p{margin:0 0 var(--ui-s-4);color:var(--ui-muted)}</style>
<script src="/static/ui/backbar.js" defer></script>
</head><body>
<nav class="ui-backbar" aria-label="Pi Hub"><a href="/" aria-label="Back to Pi Hub"><span aria-hidden="true">←</span>Pi Hub</a></nav>
<main>
<h1>Privacy note</h1>
<p>Pi Hub and its “pi-offsite” Google app are a personal system used by one household. They have no other users.</p>
<p>The app asks Google only for <code>drive.file</code>: it can see and change only the files it created itself, never
anything else in the Drive. It stores the household’s own backups there, encrypted on the household’s computer before
upload, so Google holds only data it cannot read. Nothing is shared, sold or sent anywhere else.</p>
<p>Access can be removed at any time from the Google account’s “Third-party apps &amp; services” page.</p>
</main></body></html>"""


@app.get("/privacy")
def privacy():
    return Response(PRIVACY_PAGE, media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/{page:path}")
def index(page: str):
    # Every page is the same shell; the browser picks the view from the address. Paths it doesn't have get a 404.
    if page.startswith("api/"):
        raise HTTPException(404)
    if f"/{page}" not in SHELL_PATHS:
        return Response(NOT_FOUND_PAGE, status_code=404, media_type="text/html", headers={"Cache-Control": "no-cache"})
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
