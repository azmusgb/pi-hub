"""The mission ledger's machine route (A35 §7.4): `POST /api/missions/events/{source}`, a batch of 1-50 events from
one source, with that source's own key and the contract version header. Every refusal is one of the contract's
`errors`, as {"error": code, "detail": …}; the detail names the event and field, never a value. Owner reads and the
owner route are later steps (M1b plan H3)."""
import json
import sqlite3
import sys

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import keys, log
from .contract import CURRENT, Refused

router = APIRouter(prefix="/api/missions")
EVENTS = "/api/missions/events/"
MAX_BODY = 2 * CURRENT.limits["batch_events"] * CURRENT.limits["event_bytes"]  # room for the client's whitespace


def refusal(source, refused):
    """The contract's error response for `refused`, counted against `source` (plan decision 7)."""
    log.REFUSALS.note(source, refused.code, log.clock())
    print(f"missions: refused {refused.code} from {source}: {refused.detail}", file=sys.stderr, flush=True)
    headers = {"Cache-Control": "no-store"}
    if refused.retry_after:
        headers["Retry-After"] = str(refused.retry_after)
    return JSONResponse({"error": refused.code, "detail": refused.detail}, status_code=refused.status,
                        headers=headers)


def key_refusal(request, source):
    """None when `request` carries `source`'s own key; else 404 for a source the contract doesn't have, or the
    contract's 401 bad_key. The front-door guard (app.py) and the route both ask."""
    if source not in CURRENT.sources or source not in keys.KEYS:
        return JSONResponse({"error": "unknown_source", "detail": "There is no such source."}, status_code=404)
    if not keys.key_ok(request, source):
        return refusal(source, Refused(401, "bad_key", "the source's key is missing or wrong"))
    return None


def _batch(source, raw):
    if len(raw) > MAX_BODY:
        raise Refused(413, "too_large", f"the batch is over {MAX_BODY} bytes")
    try:
        events = json.loads(raw)
    except ValueError:
        raise Refused(400, "bad_json", "the body is not JSON")
    if not isinstance(events, list) or not 1 <= len(events) <= CURRENT.limits["batch_events"]:
        raise Refused(400, "bad_batch", f"not a list of 1 to {CURRENT.limits['batch_events']} events")
    for i, event in enumerate(events):
        CURRENT.check(source, event, i)
    return events


@router.post("/events/{source}")
async def post_events(source: str, request: Request):
    refused = key_refusal(request, source)
    if refused:
        return refused
    try:
        if not CURRENT.accepts_version(request.headers.get("x-mission-contract")):
            raise Refused(409, "version", f"this hub accepts contract version {CURRENT.version}")
        accepted, duplicates, seq_max = log.ingest(source, _batch(source, await request.body()))
    except Refused as e:
        return refusal(source, e)
    except sqlite3.Error as e:
        print(f"missions: the ledger can't be written: {e}", file=sys.stderr, flush=True)
        return JSONResponse({"error": "unavailable", "detail": "The ledger can't be written. Try again."},
                            status_code=503)
    return JSONResponse({"accepted": accepted, "duplicates": duplicates, "seq_max": seq_max},
                        headers={"Cache-Control": "no-store"})
