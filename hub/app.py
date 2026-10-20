"""Pi Hub: the home hub web app. Step 1 serves the Now screen and its API."""
import os
import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import now, sources

STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Pi Hub", docs_url=None, redoc_url=None, openapi_url=None)
sampler = sources.Sampler()

if os.environ.get("HUB_NO_SAMPLER") != "1":
    threading.Thread(target=sampler.run, daemon=True).start()


@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return resp


@app.get("/api/now")
def api_now():
    try:
        disk = sources.disk_free_gb("/")
    except OSError:
        disk = None
    data = now.build(sources.pi_status(), sources.plex_sessions(), sampler.snapshot(), disk)
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/sw.js")
def service_worker():
    # Served from the root so it can look after the whole site.
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
