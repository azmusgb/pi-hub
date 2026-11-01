"""What the workshop display calls: pairing, the feed and its long poll, banners, the heartbeat, and its two actions,
Clear plate and Judge it, which need no PC."""
import asyncio
import json
import queue
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from . import (auth, bambuddy, db, display_ai, display_feed, display_messages, display_pairing, lab, lab_guard, needs,
               now as now_, printer_control, records, sources)

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


PAIR_MAX = 256
NOTIFY_MAX = 4 * 1024


async def _body(request, cap):
    """The body, read as it arrives and never past `cap` (413, also at once for a Content-Length over it)."""
    declared = request.headers.get("content-length", "")
    if declared.isascii() and declared.isdigit() and int(declared) > cap:
        raise HTTPException(413, "That's too big.")
    try:
        return bytes(await lab_guard.read_capped(request, cap))
    except HTTPException as e:
        if e.status_code == 413:
            raise HTTPException(413, "That's too big.")
        raise


async def _json(request, cap):
    raw = await _body(request, cap)
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


@router.post("/pair")
async def pair(request: Request):
    """Open to the display (no key yet): the body is capped, and a refusal is logged only when it spent a try on an
    open code, so a caller with no code to guess at can't fill the action log."""
    body = await _json(request, PAIR_MAX)
    key, counted = display_pairing.try_redeem(str(body.get("code") or ""), time.time())
    if not key:
        if counted:
            auth.log("display", DEVICE, "display:pair", "refused")
        raise HTTPException(403, "That code isn't right or has run out. Ask for a new one.")
    auth.log("display", DEVICE, "display:pair", "ok")
    return {"key": key, "tlsName": TLS_NAME}


def feed_now():
    """The feed as it stands: Pi Hub's records and Needs you, Plex, Bambuddy's spools, Local AI's cached AI cards."""
    now = time.time()
    recs = records.all()
    needs_list, lab_items = _needs_now(recs)
    ai = display_ai.cards(now)
    messages = [*ai["messages"], *display_messages.pending(now)]  # build orders them (display_ai keeps only sortable ones)
    return display_feed.build(now, ai, recs, needs_list, lab_items, messages,
                              sessions=sources.plex_sessions(), spools=bambuddy.spools())


def _needs_now(recs):
    """Needs you and its Print lab items, as the feed shows them (it never waits on the PC)."""
    needs_list = needs.current(recs, fetch=False)
    return needs_list, [i for i in needs_list["items"] if i.get("source") == needs.LAB]


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
    body = await _json(request, NOTIFY_MAX)
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
    raw = await _body(request, HEARTBEAT_MAX)
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


# ---- Clear plate ----

CLEAR_RUNNING = "Clear plate is already running."
PRINTER_BUSY = "The printer is busy with another command."
# Local AI's banners for the same button (app/bambuddy-control.js clearPlateMessage), so the display reads the same.
CLEAR_BANNERS = {
    "confirmed": ("Plate confirmed", "Bambuddy accepted the plate confirmation.", "ok"),
    "errors": ("Check printer errors", "Plate confirmed. The printer error list did not clear; check its screen.",
               "warning"),
    "failed": ("Plate not confirmed", "The confirmation did not go through. Check the printer before trying again.",
               "warning"),
}


def _clear_outcome(r):
    if not r["ok"]:
        return "failed"
    return "confirmed" if all(v == "ok" for v in r["steps"].values()) else "errors"


@router.post("/printer/clear")
def printer_clear(request: Request):
    """Pi Hub's own Clear plate (printer_control.run, its control key and steps), for the display: one command at a
    time across the hub (printer_control.BUSY; a second tap is refused, never queued), only while the printer is
    finished or failed and waiting for it, and never sent again after a timeout. One banner says how it went."""
    display_pairing.require(request)
    holder = printer_control.hold("clear")
    if holder is not None:
        auth.log("display", DEVICE, "display:clear-plate", f"refused: {holder or 'busy'} running")
        raise HTTPException(409, CLEAR_RUNNING if holder == "clear" else PRINTER_BUSY)
    try:
        # The printer's state now, not the display's last feed: a stale screen must not clear a running print.
        sources._cache.pop("bambuddy_printer", None)
        b = sources.bambuddy_printer(timeout=3)
        if not b or not b.get("connected"):
            auth.log("display", DEVICE, "display:clear-plate", "refused: offline")
            raise HTTPException(503, "Bambuddy can't see the printer just now, so the hub didn't send anything.")
        if "clear" not in now_.printer_actions(b):
            auth.log("display", DEVICE, "display:clear-plate", "refused: not waiting")
            raise HTTPException(409, "The printer can't clear the plate right now; its state has changed. "
                                     "Nothing was sent.")
        r = printer_control.run("clear")
    finally:
        printer_control.release()
    if "no key" not in r["steps"].values():  # Bambuddy was asked: the next read sees its state again
        sources._cache.pop("bambuddy_printer", None)
    outcome = _clear_outcome(r)
    title, text, tone = CLEAR_BANNERS[outcome]
    try:
        display_messages.post(title, text, tone, False, {"type": "show", "page": "printer"})
    except (display_messages.Refused, ValueError):
        pass  # the banner is feedback: it must never retry or undo a command Bambuddy took
    first = next(iter(r["steps"].values()), "")
    auth.log("display", DEVICE, "display:clear-plate",
             {"confirmed": "ok", "errors": "errors not cleared"}.get(outcome) or f"failed: {first}")
    status = 200 if r["ok"] else 503 if "no key" in r["steps"].values() else 502
    return JSONResponse(r, status_code=status, headers={"Cache-Control": "no-store"})


# ---- Judge it ----
# Local AI's /api/display/lab/verdict (app/display-lab.js), with Pi Hub's judge card: its `run` is the experiment id
# (E-021); the verdict is queued for that experiment's print run, the one the lab page's Judge it sends (the index's
# experiments[].run). The grades are checked against the experiment's stored record, as Local AI's sheetOf does.

MOVED = "This print has changed. Open it again."
PHONE_ONLY = "Judge it on your phone: this test compares A and B"
VERDICT_MAX = 4 * 1024
MAX_REASON = 500
VERDICT_RETRY_S = 24 * 3600  # Local AI's JUDGE_FOR_MS: a retry after the card has gone still gets its answer


def _text(v):
    return isinstance(v, str) and len(v) > 0


def sheet_of(record):
    """{tabs, criteria} from an experiment's record: the Mac grades only role "variant" strips, by tab (else id)."""
    record = record if isinstance(record, dict) else {}
    tabs = []
    for v in record.get("variants") if isinstance(record.get("variants"), list) else []:
        if not isinstance(v, dict) or ("role" in v and v["role"] != "variant"):
            continue
        tab = v.get("tab") if _text(v.get("tab")) else v.get("id")
        if _text(tab) and tab not in tabs:
            tabs.append(tab)
    criteria = [{"key": c["key"], "label": c["label"], "choices": list(c["choices"])}
                for c in (record.get("criteria") if isinstance(record.get("criteria"), list) else [])
                if isinstance(c, dict) and _text(c.get("key")) and _text(c.get("label"))
                and isinstance(c.get("choices"), list) and c["choices"] and all(_text(x) for x in c["choices"])]
    return {"tabs": tabs, "criteria": criteria}


def grades_problem(grades, sheet, inconclusive):
    """What is wrong with the grades, or None. Every strip and criterion must be the record's and every value one of
    the criterion's choices or null ("–", not judged). Without an inconclusive reason every strip is graded on every
    criterion, as the phone's Send requires."""
    shape = "grades must be {strip: {criterion: choice}}."
    if not isinstance(grades, dict):
        return shape
    by_key = {c["key"]: c for c in sheet["criteria"]}
    for tab, g in grades.items():
        if tab not in sheet["tabs"]:
            return f"{tab} isn't a strip of this test."
        if not isinstance(g, dict):
            return shape
        for k, choice in g.items():
            c = by_key.get(k)
            if not c:
                return f"{k} isn't a criterion of this test."
            if choice is not None and (not isinstance(choice, str) or choice not in c["choices"]):
                return f"{choice if isinstance(choice, str) else json.dumps(choice)} isn't a choice for {c['label']}."
    if inconclusive is None:
        for tab in sheet["tabs"]:
            for c in sheet["criteria"]:
                if tab not in grades or c["key"] not in grades[tab]:
                    return f"Judge strip {tab} on {c['label']}, or mark it inconclusive."
    return None


def judge_target(run):
    """{project, experiment, run, record} for the judge card on the display now, when `run` is its run; else None (the
    card has gone, names another experiment, or the experiment has no print run to record a verdict on)."""
    if not isinstance(run, str) or not run:
        return None
    _, lab_items = _needs_now(records.all())
    card = display_feed._lab_card(lab_items)
    if not card or card.get("ask") != "lab-judge" or card.get("run") != run:
        return None
    parts = str(lab_items[0].get("id") or "").split(":")
    if len(parts) != 4 or parts[3] != run:
        return None
    project, eid = parts[2], parts[3]
    lab.ready()
    row = db.one("SELECT index_json FROM lab_projects WHERE project = ?", project)
    try:
        ix = json.loads(row["index_json"]) if row else {}
    except ValueError:
        return None
    exps = ix.get("experiments") if isinstance(ix, dict) and isinstance(ix.get("experiments"), list) else []
    x = next((e for e in exps if isinstance(e, dict) and e.get("id") == eid), None)
    print_run = x.get("run") if x else None
    if not lab._full(lab.RUN_ID_RE, print_run):
        return None
    return {"project": project, "experiment": eid, "run": print_run, "exp": x, "record": _record(project, eid),
            "requests": _verdict_requests(project, eid, print_run)}


def _record(project, eid):
    rec = db.one("SELECT payload FROM lab_records WHERE project = ? AND id = ?", project, eid)
    try:
        return json.loads(rec["payload"]) if rec and rec["payload"] else None
    except ValueError:
        return None


def _verdict_requests(project, eid, print_run, since=None):
    """The verdict requests for this experiment's print run, newest first (since: only those sent after it)."""
    rows = db.rows("SELECT id, status, message, created_at, by_device FROM lab_requests WHERE project = ? AND "
                   "kind = 'verdict' AND experiment = ? AND run = ? ORDER BY created_at DESC, rowid DESC",
                   project, eid, print_run)
    if since is not None:
        rows = [r for r in rows if (lab.parse_iso(r["created_at"]) or 0) >= since]
    return rows


def recent_target(run):
    """Once the card has gone (the Mac applied the verdict and lab pull synced): for 24 h after a verdict request for
    this experiment, its project, experiment, stored record and that print run's verdict requests (newest first), as
    Local AI's recentVerdict. Else None."""
    if not lab._full(lab.RUN_ID_RE, run):
        return None
    lab.ready()
    since = time.time() - VERDICT_RETRY_S
    for r in db.rows("SELECT project, run, created_at FROM lab_requests WHERE kind = 'verdict' AND experiment = ? "
                     "ORDER BY created_at DESC, rowid DESC", run):
        if (lab.parse_iso(r["created_at"]) or 0) < since:
            continue
        project = r["project"]
        row = db.one("SELECT index_json FROM lab_projects WHERE project = ?", project)
        try:
            ix = json.loads(row["index_json"]) if row else {}
        except ValueError:
            ix = {}
        exps = ix.get("experiments") if isinstance(ix, dict) and isinstance(ix.get("experiments"), list) else []
        x = next((e for e in exps if isinstance(e, dict) and e.get("id") == run), None) or {"id": run}
        return {"project": project, "experiment": run, "run": r["run"], "exp": x, "record": _record(project, run),
                "requests": _verdict_requests(project, run, r["run"], since)}
    return None


def _sent_before(run, request_id):
    """A verdict request with this id, sent in the last 24 h for this experiment, once the card has gone; else None."""
    t = recent_target(run)
    return next((r for r in t["requests"] if r["id"] == request_id), None) if t else None


@router.get("/lab/judge")
def lab_judge(request: Request, run: str = ""):
    """The Judge it sheet for the run on the judge card, in Local AI's shape (app/display-lab.js judge):
    {experiment, run, judgeOn, tabs, criteria, judged, pending}, or {experiment, run, judgeOn, phoneOnly, reason} for a
    test without criteria. After the card has gone, a run with a verdict request in the last 24 h still gets its sheet
    (so the display shows Done); anything else is 409. `run` is the card's (the experiment id), as the display posts
    it back."""
    display_pairing.require(request)
    run = run[:64]
    t = judge_target(run) or recent_target(run)
    if not t:
        raise HTTPException(409, MOVED)
    record, x = t["record"] if isinstance(t["record"], dict) else {}, t["exp"] if isinstance(t["exp"], dict) else {}
    judge_on = record.get("judge_on") if _text(record.get("judge_on")) else x.get("judge_on") if _text(x.get("judge_on")) else ""
    base = {"experiment": t["experiment"], "run": run, "judgeOn": judge_on}
    sheet = sheet_of(t["record"])
    if not sheet["criteria"] or not sheet["tabs"]:
        return JSONResponse({**base, "phoneOnly": True, "reason": PHONE_ONLY}, headers={"Cache-Control": "no-store"})
    reqs = t["requests"]
    # JavaScript's `a || b`, as Local AI picks the verdict: an object counts even when empty
    v = next((c for c in (x.get("verdict"), x.get("owner_verdict"), record.get("verdict"), record.get("owner_verdict"))
              if isinstance(c, (dict, list)) or c), None)
    waiting = next((r for r in reqs if r["status"] == "pending"), None)
    judged = ({"at": v.get("at") if _text(v.get("at")) else None, "by": v.get("by") if _text(v.get("by")) else None}
              if isinstance(v, dict) else
              {"at": waiting["created_at"], "by": "display" if waiting["by_device"] == "display" else "phone"}
              if waiting else None)
    last = reqs[0] if reqs else None
    pending = {"id": last["id"], "status": last["status"], "message": last["message"]} if last else None
    return JSONResponse({**base, **sheet, "judged": judged, "pending": pending}, headers={"Cache-Control": "no-store"})


def _refuse(status, message, why):
    auth.log("display", DEVICE, "display:verdict", f"refused: {why}")
    raise HTTPException(status, message)


@router.post("/lab/verdict")
async def lab_verdict(request: Request):
    """{run, requestId, grades, inconclusive, replace} → 202 {id, status}: the phone's verdict request, queued for the
    Mac's lab pull with lighting "diagnostic" and no note. A requestId sent again is one request (its stored status);
    replace true is Change it."""
    display_pairing.require(request)
    data = lab._load_request_json(await lab_guard.read_capped(request, VERDICT_MAX))
    # Nothing below awaits: the check and the queueing run as one step on the event loop.
    if not isinstance(data, dict):
        raise HTTPException(400, "Send {run, requestId, grades, inconclusive}.")
    t = judge_target(data.get("run"))
    if not t:
        sent = _sent_before(data.get("run"), data.get("requestId"))
        if sent:
            auth.log("display", DEVICE, "display:verdict", "sent again")
            return JSONResponse({"id": sent["id"], "status": sent["status"]}, status_code=202)
        _refuse(409, MOVED, "moved")
    sheet = sheet_of(t["record"])
    if not sheet["criteria"] or not sheet["tabs"]:
        _refuse(409, PHONE_ONLY, "phone only")
    inconclusive = None
    if data.get("inconclusive") is not None:
        inconclusive = data["inconclusive"].strip() if isinstance(data["inconclusive"], str) else ""
        if not inconclusive or len(inconclusive) > MAX_REASON:
            _refuse(400, f"An inconclusive reason is up to {MAX_REASON} characters of text, or null.", "reason")
    problem = grades_problem(data.get("grades"), sheet, inconclusive)
    if problem:
        _refuse(400, problem, "grades")
    body = {"id": data.get("requestId"), "kind": "verdict", "experiment": t["experiment"], "run": t["run"],
            "payload": {"grades": data["grades"], "lighting": "diagnostic", "note": None, "inconclusive": inconclusive,
                        "replace": data.get("replace") is True}}
    try:
        answer = lab.queue_request(t["project"], body, "display")
    except HTTPException as e:
        _refuse(e.status_code, e.detail, str(e.status_code))
    auth.log("display", DEVICE, "display:verdict", "queued")
    return JSONResponse({"id": answer["id"], "status": answer["status"]}, status_code=202)


# ---- Local AI through Pi Hub: approvals, Ask and pictures, live, only while the PC answers ----
# Nothing here caches, queues or retries; display_ai.forward holds the allow-list and the TLS rule.

AI_DOWN = {"error": "AI unavailable — PC asleep"}
IMAGE_MAX = 5 * 1024 * 1024
DECIDE_MAX = 8 * 1024


def _down():
    return JSONResponse(AI_DOWN, status_code=503, headers={"Cache-Control": "no-store"})


def _through(method, path, query="", body=None, cap=None):
    """Forward once. Local AI's 2xx and other 4xx (a 409 stale approval) go back unchanged. A 5xx, an exception, or
    a 401/403 (Local AI refusing the hub key, which the display would read as "Pair the display first") is the display's
    "AI unavailable" (503); a 3xx is a 502 that never carries Local AI's address; past `cap`, a 502."""
    try:
        kw = {"cap": cap} if cap is not None else {}
        status, data, ctype = display_ai.forward(method, path, query=query, body=body, **kw)
    except Exception:  # noqa: BLE001
        return _down(), 503
    if status >= 500 or status in (401, 403):
        return _down(), status
    if 300 <= status < 400:
        return JSONResponse({"error": "Local AI answered with a redirect."}, status_code=502,
                            headers={"Cache-Control": "no-store"}), 502
    if cap is not None and len(data) > cap:
        return JSONResponse({"error": "That picture is too big."}, status_code=502), 502
    return Response(data, status_code=status, media_type=ctype, headers={"Cache-Control": "no-store"}), status


@router.get("/approvals")
def approvals(request: Request):
    display_pairing.require(request)
    return _through("GET", "/api/display/approvals")[0]


@router.post("/approvals/decide")
async def approvals_decide(request: Request):
    display_pairing.require(request)
    raw = await _body(request, DECIDE_MAX)
    response, status = await asyncio.to_thread(_through, "POST", "/api/display/approvals/decide", "", raw)
    auth.log("display", DEVICE, "display:approval", "sent" if status < 400 else f"refused: {status}")
    return response


@router.get("/ask")
def ask(request: Request):
    display_pairing.require(request)
    return _through("GET", "/api/display/ask", request.url.query)[0]


def _poster_jpeg():
    """The poster of what Plex is playing now, as Pi Hub's own /api/now/poster serves it (404 when nothing plays)."""
    from . import app as app_
    return app_.api_now_poster(0).body


@router.get("/images/poster")
def image_poster(request: Request):
    display_pairing.require(request)
    return Response(_poster_jpeg(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/images/{n}")
def image(request: Request, n: str):
    """The n-th AI picture of the feed, fetched from Local AI's original URL (only ever /api/images/view)."""
    display_pairing.require(request)
    if not (n.isascii() and n.isdigit()):
        raise HTTPException(404, "No such picture.")
    pics = display_ai.cards(time.time()).get("images") or []
    if int(n) >= len(pics):
        raise HTTPException(404, "No such picture.")
    url = pics[int(n)]["imageUrl"]  # display_ai keeps only pictures with a string address
    path, _, query = url.partition("?")
    if path != "/api/images/view":
        raise HTTPException(404, "No such picture.")
    return _through("GET", path, query, cap=IMAGE_MAX)[0]
