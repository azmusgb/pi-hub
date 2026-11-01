"""What the workshop display calls. Pairing here; the feed and actions join it later."""
import time

from fastapi import APIRouter, HTTPException, Request

from . import auth, display_pairing

router = APIRouter(prefix="/api/display")
TLS_NAME = "home.home.arpa"
DEVICE = "Workshop display"


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
