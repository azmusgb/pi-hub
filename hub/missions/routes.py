"""The mission ledger's machine route (A35 §7.4): `POST /api/missions/events/{source}`, a batch of 1-50 events from
one source, with that source's own key and the contract version header. Every refusal is one of the contract's
`errors`, as {"error": code, "detail": …}; the detail names the event and field, never a value.

The owner's side (M1b plan H3): `GET /api/missions`, `GET /api/missions/{id}?view=`, `GET /api/missions/{id}/changes`
and `POST /api/missions/{id}/owner`, all for the owner's session; the write also needs `Sec-Fetch-Site: same-origin`.
Reads poll with an ETag and never stream (§13). A ledger that can't be read is a 503, never an empty body."""
import hashlib
import json
import sqlite3
import sys

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from .. import auth, db
from . import keys, log, owner, project, store, views
from .contract import CURRENT, Refused

router = APIRouter(prefix="/api/missions")
EVENTS = "/api/missions/events/"
MAX_BODY = 2 * CURRENT.limits["batch_events"] * CURRENT.limits["event_bytes"]  # room for the client's whitespace


def refusal(source, refused, count=True):
    """The contract's error response for `refused`, counted against `source` (plan decision 7) when `count`: only a
    request that carried the source's own key is counted, so a caller without one can't raise the owner's item."""
    if count:
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
        return refusal(source, Refused(401, "bad_key", "the source's key is missing or wrong"), count=False)
    return None


def _batch(source, raw):
    if len(raw) > MAX_BODY:
        raise Refused(413, "too_large", f"the batch is over {MAX_BODY} bytes")
    try:
        events = json.loads(raw)
    except (ValueError, RecursionError):  # a body nested past the parser's stack is not JSON this hub reads
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


# ---- the owner's reads and writes ----

OWNER_BODY_MAX = 1024
NO_CACHE = {"Cache-Control": "private, no-cache"}


def _owner(request):
    return auth.need(request, "owner")


def _slug(initiative):
    if not CURRENT.valid_slug(initiative):
        raise HTTPException(404, "There is no such mission.")


def _unavailable(e):
    print(f"missions: the ledger can't be read: {e}", file=sys.stderr, flush=True)
    return JSONResponse({"error": "unavailable", "detail": "The ledger can't be read. Try again."}, status_code=503,
                        headers={"Cache-Control": "no-store"})


def _matches(request, tag):
    """Whether If-None-Match names `tag` (weak or strong, one or a list, or `*`)."""
    have = request.headers.get("if-none-match", "")
    return bool(have) and (have.strip() == "*" or tag in [t.strip().removeprefix("W/") for t in have.split(",")])


def _answer(request, body, tag=None):
    """`body` as JSON with an ETag, or a 304 when the caller already has it. Without `tag`, the tag is a hash of the
    body less `as_of`, so a view that only moved its clock is not a change."""
    if tag is None:
        stable = {k: v for k, v in body.items() if k != "as_of"}
        tag = '"' + hashlib.sha256(project.json_text(stable).encode()).hexdigest()[:16] + '"'
    headers = {**NO_CACHE, "ETag": tag}
    if _matches(request, tag):
        return Response(status_code=304, headers=headers)
    return JSONResponse(body, headers=headers)


def _read(fn, *args, **kwargs):
    """`fn(connection, …)` on this thread's connection: (result, None), or (None, the failure's response)."""
    try:
        store.ready()
        return fn(db.conn(), *args, **kwargs), None
    except views.Unreadable as e:
        return None, _unavailable(e)
    except sqlite3.Error as e:
        return None, _unavailable(e)
    except views.Missing:
        raise HTTPException(404, "There is no such mission.")


@router.get("")
def list_missions(request: Request):
    _owner(request)
    body, failed = _read(lambda c: views.listing(c, log.clock()))
    return failed or _answer(request, body)


@router.get("/{initiative}")
def one_mission(initiative: str, request: Request, view: str = "overview", limit: int = Query(views.PAGE, ge=1,
                le=views.MAX_PAGE), offset: int = Query(0, ge=0), before: int | None = Query(None, ge=1),
                group: str | None = None):
    _owner(request)
    _slug(initiative)
    if view == "summary":
        raise HTTPException(400, "The summary view comes later (A35 M1b step H8).")
    if view not in views.VIEWS:
        raise HTTPException(400, f"view is one of {', '.join(views.VIEWS)}.")
    if group is not None and group not in views.GROUPS:
        raise HTTPException(400, f"group is one of {', '.join(views.GROUPS)}.")
    now = log.clock()
    read = {"overview": lambda c: views.overview(c, initiative, now),
            "decisions": lambda c: views.decisions_view(c, initiative, now, offset, limit),
            "evidence": lambda c: views.evidence_view(c, initiative, now, offset, limit, before, group)}[view]
    body, failed = _read(read)
    return failed or _answer(request, body)


@router.get("/{initiative}/changes")
def mission_changes(initiative: str, request: Request, after: int = Query(..., ge=0)):
    """What changed after `after` (plan decision 9). The ETag is the log's last seq, so a poll with nothing new is a
    304; a mark of the newest unlogged tool event follows it, so a running tool still reaches the page."""
    _owner(request)
    _slug(initiative)
    now = log.clock()

    def read(c):
        if not views.exists(c, initiative):
            raise views.Missing(initiative)
        tag = views.etag(c, initiative)
        return tag, None if _matches(request, tag) else views.changes(c, initiative, after, now)

    got, failed = _read(read)
    if failed:
        return failed
    tag, body = got
    headers = {**NO_CACHE, "ETag": tag}
    return Response(status_code=304, headers=headers) if body is None else JSONResponse(body, headers=headers)


@router.post("/{initiative}/owner")
async def owner_write(initiative: str, request: Request):
    """The owner's tap. Only the owner's session, and only from the hub's own page: a missing Sec-Fetch-Site is
    refused here (A35 §13), where A33's answer route lets it through."""
    if (request.headers.get("sec-fetch-site") or "").lower() != "same-origin":
        raise HTTPException(403, "This change has to come from the hub's own page.")
    role, device = _owner(request)
    _slug(initiative)
    raw = await request.body()
    if len(raw) > OWNER_BODY_MAX:
        raise HTTPException(413, "That is too big for an owner action.")
    body = owner.body_of(raw)
    try:
        status, answer = owner.write(initiative, body, log.clock())
    except sqlite3.Error as e:
        print(f"missions: the ledger can't be written: {e}", file=sys.stderr, flush=True)
        return JSONResponse({"error": "unavailable", "detail": "Not recorded: the ledger can't be written. Try again."},
                            status_code=503, headers={"Cache-Control": "no-store"})
    if status == 200:
        _audit(role, device, initiative, body, answer["changed"])
    return JSONResponse(answer, status_code=status, headers={"Cache-Control": "no-store"})


def _audit(role, device, initiative, body, changed):
    """The action log's line for a write that was recorded or was a repeat. The event is the record; a log that
    can't be written is said on stderr and never turns a recorded write into an error."""
    try:
        auth.log(role, device, f"mission:{initiative}", f"{body['verb']} {'recorded' if changed else 'no change'}")
    except sqlite3.Error as e:
        print(f"missions: the action log can't be written: {e}", file=sys.stderr, flush=True)
