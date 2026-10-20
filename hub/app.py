"""Pi Hub: the home hub web app."""
import os
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import db, now, plex, printing, recorder, sources, system

STATIC = Path(__file__).parent / "static"
LISTS = {"shopping": "Shopping", "todo": "To do", "notes": "Notes"}

app = FastAPI(title="Pi Hub", docs_url=None, redoc_url=None, openapi_url=None)
sampler = sources.Sampler()

if os.environ.get("HUB_NO_SAMPLER") != "1":
    threading.Thread(target=sampler.run, daemon=True).start()
    threading.Thread(target=recorder.run, args=(sampler,), daemon=True).start()


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
    })


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
        "ai": {"state": (s or {}).get("ai_state", "Down"),
               "models": [str(m.get("name") if isinstance(m, dict) else m)[:60] for m in models.get("loaded") or []],
               "waiting": ((models.get("queue") or {}).get("waiting"))},
    })


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
