"""What the workshop display calls: pairing, the feed and its long poll; actions join it later."""
import asyncio
import queue
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import auth, bambuddy, display_ai, display_feed, display_pairing, needs, records, sources

router = APIRouter(prefix="/api/display")
TLS_NAME = "home.home.arpa"
DEVICE = "Workshop display"
EVENTS_WAIT = 25   # seconds the long poll holds an unchanged feed
EVENTS_SLICE = 2   # how often it looks again without a record change (the AI cache, Plex, spools)


@router.post("/pair/start")
def pair_start(request: Request):
    role, device = auth.need(request, "owner")
    auth.log(role, device, "display:pair-start", "ok")
    return display_pairing.start(time.time())


@router.get("/pair/status")
def pair_status(request: Request):
    auth.need(request, "owner")
    return display_pairing.status()


@router.post("/pair")
async def pair(request: Request):
    try:
        body = await request.json()
    except ValueError:
        body = {}
    code = body.get("code") if isinstance(body, dict) else None
    key = display_pairing.redeem(str(code or ""), time.time())
    if not key:
        auth.log("display", DEVICE, "display:pair", "refused")
        raise HTTPException(403, "That code isn't right or has run out. Ask for a new one.")
    auth.log("display", DEVICE, "display:pair", "ok")
    return {"key": key, "tlsName": TLS_NAME}


def feed_now():
    """The feed as it stands: Pi Hub's records and Needs you, Plex, Bambuddy's spools, Local AI's cached AI cards."""
    now = time.time()
    recs = records.all()
    needs_list = needs.current(recs)
    ai = display_ai.cards(now)
    lab = [i for i in needs_list["items"] if i.get("source") == needs.LAB]
    # Task 5 merges Pi Hub's own banners here; for now the display's messages are Local AI's.
    return display_feed.build(now, ai, recs, needs_list, lab, ai["messages"],
                              sessions=sources.plex_sessions(), spools=bambuddy.spools())


@router.get("/feed")
def feed(request: Request):
    display_pairing.require(request)
    return JSONResponse(feed_now(), headers={"Cache-Control": "no-store"})


@router.get("/events")
async def events(request: Request, since: str = ""):
    """{sig, changed}: at once when `since` isn't the feed's signature now (or is empty or from before a restart),
    else as soon as it changes (a record change wakes it; the rest is looked at every EVENTS_SLICE s), else after
    EVENTS_WAIT s."""
    display_pairing.require(request)
    since = since[:64]
    q = records.subscribe()
    try:
        deadline = time.monotonic() + EVENTS_WAIT
        while True:
            sig = display_feed.signature(await asyncio.to_thread(feed_now))
            left = deadline - time.monotonic()
            if sig != since or left <= 0 or await request.is_disconnected():
                return {"sig": sig, "changed": sig != since}
            try:
                await asyncio.to_thread(q.get, True, min(EVENTS_SLICE, left))
                while True:  # one look covers a burst of changes
                    q.get_nowait()
            except queue.Empty:
                pass
    finally:
        records.unsubscribe(q)
