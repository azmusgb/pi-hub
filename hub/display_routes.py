"""What the workshop display calls: pairing, the feed and its long poll; actions join it later."""
import asyncio
import json
import queue
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import (auth, bambuddy, display_ai, display_feed, display_messages, display_pairing, lab_guard, needs, records,
               sources)

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
    needs_list = needs.current(recs, fetch=False)  # the feed never waits on the PC
    ai = display_ai.cards(now)
    lab = [i for i in needs_list["items"] if i.get("source") == needs.LAB]
    messages = sorted([*ai["messages"], *display_messages.pending(now)], key=lambda m: m.get("at") or 0)
    return display_feed.build(now, ai, recs, needs_list, lab, messages,
                              sessions=sources.plex_sessions(), spools=bambuddy.spools())


async def _json(request):
    try:
        body = await request.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


@router.post("/notify")
async def notify(request: Request):
    """A banner on the display. The owner, the display's own key or the Mac's lab key may send one."""
    role, device = auth.who(request)
    if auth.allowed(role, "owner"):
        sender = (role, device)
    elif display_pairing.key_ok(request):
        sender = ("display", DEVICE)
    elif lab_guard.mac_key_ok(request):
        sender = ("mac", "Mac")
    else:
        raise HTTPException(401, "Sign in as the owner, or use the display or Mac key.")
    body = await _json(request)
    try:
        seq = display_messages.post(body.get("title"), body.get("text") or "", body.get("tone") or "info",
                                    body.get("chime") is not False, body.get("action"))
    except display_messages.Refused as e:
        auth.log(sender[0], DEVICE, "display:notify", "refused: rate limit")
        raise HTTPException(e.status, e.message)
    except ValueError as e:
        raise HTTPException(400, str(e))
    auth.log(sender[0], DEVICE, "display:notify", "ok")
    return {"ok": True, "seq": seq}


HEARTBEAT_MAX = 2048


def _int(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return int(v)


def clean_heartbeat(body):
    """Only the known fields, each coerced: strings cut to 64, numbers as ints, camera a short string or a bool."""
    out = {}
    for k in ("version", "sourceSha"):
        if isinstance(body.get(k), (str, int, float)) and not isinstance(body.get(k), bool):
            out[k] = str(body[k])[:64]
    for k in ("uptimeS", "rssi", "heapFree", "psramFree"):
        n = _int(body.get(k))
        if n is not None:
            out[k] = n
    cam = body.get("camera")
    if isinstance(cam, bool):
        out["camera"] = cam
    elif isinstance(cam, str):
        out["camera"] = cam[:32]
    return out


@router.post("/heartbeat")
async def heartbeat(request: Request):
    display_pairing.require(request)
    raw = await request.body()
    if len(raw) > HEARTBEAT_MAX:
        raise HTTPException(413, "That heartbeat is too big.")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        body = {}
    display_messages.store_heartbeat(clean_heartbeat(body if isinstance(body, dict) else {}), time.time())
    return {"ok": True}  # not logged: a heartbeat is the display's pulse, not an action


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
