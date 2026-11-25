"""The Assistant adapter (amendment A34, P2 and P2n): Pi Hub's server asks Local AI for what its own pages draw.

The browser never reaches Local AI through Pi Hub. It asks /api/ai/<name> here, as the owner; this module maps each name
to exactly one of six Local AI paths (A34 D1) and calls it with the hub key (hub/display_ai.forward, its own allow-list).
Nothing the browser sends reaches Local AI except the goal, an optional project id and a run id that passed a strict
pattern; the key and the owner flag are added here and a browser's copy of either is never read.

  status, models   the P1a contract reads. Last known is kept (cache: owner, D10) as a labelled mirror, in a file outside
                   the off-site backup. While the PC sleeps they answer from it with its age.
  tasks            a Mission: submit, follow (the run and its mission), cancel. cache: none, so nothing about a task is
                   stored here, and a task's answer is never kept (D10). While the PC sleeps a submit is refused with
                   "needs the PC" (D13) and following a task says `unreachable`, never `failed`.

Every answer carries `fetched_at`. Local AI's text is passed as plain strings in JSON; the pages set it as text."""
import asyncio
import json
import os
import re
import threading
import time
import urllib.parse
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import auth, display_ai, lab_guard, records

router = APIRouter(prefix="/api/ai")

STATUS, MODELS = "/api/contract/status", "/api/contract/models"
START, RUNS, MISSION, CANCEL = "/api/agents/missions/start", "/api/runs", "/api/agents/mission", "/api/runs/cancel"
# The six paths, with the method each takes. Anything else is refused before a request is made.
PATHS = {STATUS: "GET", MODELS: "GET", START: "POST", RUNS: "GET", MISSION: "GET", CANCEL: "POST"}

MIN_CONTRACT_VERSION = 1  # the oldest contract_version of the status and models reads this adapter draws (A34: "out of date" below it)
GOAL_MAX = 2000
BODY_MAX = 16 * 1024
RUN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{2,79}")
MISSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}")
PROJECT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}")
RUN_STATUSES = ("queued", "running", "streaming", "awaiting_approval", "completed", "failed", "cancelled")
SOURCE_STATES = ("ok", "failed", "unknown")

TIMEOUT = {"read": 6, "submit": 10, "follow": 6, "cancel": 8}
PC_OFF_TIMEOUT = 2   # seconds a call may take while the `pc` record says the PC is off (A34: a 1-2 s connect timeout)
PROBE_EVERY = 30     # seconds between probes while the PC is off (the breaker)
CAP = {"read": 128 * 1024, "run": 256 * 1024, "mission": 512 * 1024, "small": 32 * 1024}
INFLIGHT = {"status": 2, "models": 2, "submit": 2, "follow": 4, "cancel": 2}
ANSWER_MAX, ERROR_MAX, SUMMARY_MAX, WORKERS_MAX, NAME_MAX = 64 * 1024, 4000, 1200, 40, 200

MIRROR_FILE = os.environ.get("HUB_AI_MIRROR", "/var/lib/pi-hub/assistant-mirror.json")
MIRROR_MAX = 48 * 1024        # bytes kept per read; a bigger answer isn't stored
MIRROR_EVERY = 60             # seconds: the longest an unchanged read goes unwritten
VOLATILE = {"as_of", "checked_at", "checkedAt", "latencyMs"}  # change on every read, so they don't count as a change

_now = time.time
FETCH = None  # tests only: fetch(method, url, headers, body, timeout) -> (status, body, content type)
_lock = threading.Lock()
_inflight = {k: 0 for k in INFLIGHT}
_breaker = {"probe": 0.0, "ok": 0.0}  # when the last probe went out, and when Local AI last answered


def _json(data, status=200):
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


def _reply(state, status=200, **more):
    return _json({"state": state, "fetched_at": int(_now()), **more}, status)


# ---- Whether to call at all: the `pc` record, the breaker and the per-route cap ----

def pc_state():
    return (records.get("pc") or {}).get("state") or "unknown"


def _gate():
    """(go, timeout): a call goes out at once while the PC isn't off, or while Local AI has answered in the last 30 s
    (a stale "off" never beats a live answer, as in sections.js assistantButton); otherwise one probe per 30 s, short."""
    if pc_state() != "off":
        return True, None
    now = _now()
    with _lock:
        if now - _breaker["ok"] < PROBE_EVERY:
            return True, PC_OFF_TIMEOUT
        if now - _breaker["probe"] >= PROBE_EVERY:
            _breaker["probe"] = now
            return True, PC_OFF_TIMEOUT
    return False, None


class _Slot:
    def __init__(self, name):
        self.name, self.ok = name, False

    def __enter__(self):
        with _lock:
            if _inflight[self.name] < INFLIGHT[self.name]:
                _inflight[self.name] += 1
                self.ok = True
        return self.ok

    def __exit__(self, *exc):
        if self.ok:
            with _lock:
                _inflight[self.name] -= 1


def _configured():
    """None when the hub key and Local AI's CA are in place, else the reason (a refusal of this adapter's own)."""
    if not display_ai._key():
        return "Pi Hub has no key for the Assistant yet."
    if not display_ai._tls_ok():
        return "Pi Hub can't verify the Assistant's certificate yet."
    return None


# ---- One call to Local AI ----

class Result:
    """kind: ok (2xx, a JSON object), http (another status; `status`, `data` if JSON), unreachable (no answer, or an
    answer that isn't a JSON object)."""
    def __init__(self, kind, status=0, data=None):
        self.kind, self.status, self.data = kind, status, data

    def error(self):
        e = self.data.get("error") if isinstance(self.data, dict) else None
        return _text(e, ERROR_MAX) if isinstance(e, str) and e.strip() else ""


def call(method, path, *, query="", body=None, timeout, cap, fetch=None):
    ok, short = _gate()
    if not ok:
        return Result("blocked")
    raw = json.dumps(body).encode() if body is not None else None
    status, data, _ctype = display_ai.forward(
        method, path, query=query, body=raw, timeout=min(timeout, short or timeout), cap=cap, fetch=fetch or FETCH,
        paths=PATHS, methods=PATHS, headers={"X-Hub-Owner": "1"})
    try:
        parsed = json.loads(data) if data else None
    except ValueError:
        parsed = None
    if status < 200 or status >= 300:
        return Result("unreachable" if status in (502, 504) else "http", status, parsed if isinstance(parsed, dict) else None)
    if not isinstance(parsed, dict):
        return Result("unreachable", status)
    with _lock:
        _breaker["ok"] = _now()
    return Result("ok", status, parsed)


def _text(v, limit):
    """Plain text of at most `limit` characters: no control characters but the line break and the tab. Never HTML:
    nothing here escapes or builds markup, and the pages set it with textContent."""
    s = v if isinstance(v, str) else ("" if v is None else str(v))
    s = "".join(c for c in s if c in "\n\t" or (ord(c) >= 32 and ord(c) != 127))
    return s[:limit]


# ---- The mirror: last known status and models, in a file of their own (not in hub.db, so not in the backup) ----

def _mirror():
    """{name: {"at", "body"}} from the file; an unreadable or wrong-shaped file is an empty mirror."""
    try:
        d = json.loads(Path(MIRROR_FILE).read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(d, dict):
        return {}
    return {k: v for k, v in d.items() if k in ("status", "models") and isinstance(v, dict)
            and isinstance(v.get("body"), dict) and isinstance(v.get("at"), (int, float))}


def _stable(v):
    if isinstance(v, dict):
        return {k: _stable(x) for k, x in v.items() if k not in VOLATILE}
    if isinstance(v, list):
        return [_stable(x) for x in v]
    return v


def _keep(name, body):
    """Store a live read when it changed, or when the stored one is over a minute old. Never a read in which no source
    answered (it would replace the last good one with nothing), and never one past MIRROR_MAX."""
    if not any(isinstance(s, dict) and s.get("state") == "ok" for s in body["sources"].values()):
        return
    if len(json.dumps(body)) > MIRROR_MAX:
        return
    with _lock:
        have = _mirror()
        old = have.get(name)
        now = _now()
        if old and now - old["at"] < MIRROR_EVERY and _stable(old["body"]) == _stable(body):
            return
        have[name] = {"at": now, "body": body}
        try:
            tmp = Path(MIRROR_FILE + ".tmp")
            tmp.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(have))
            os.chmod(tmp, 0o600)
            os.replace(tmp, MIRROR_FILE)
        except OSError:
            pass  # the read stands; only its copy for a sleeping PC is lost


# ---- status and models ----

def _contract_body(d):
    """Local AI's contract read as the pages draw it, or None when it isn't the shape the contract says (an older Local AI).
    Each source's state is one of ok, failed, unknown; anything else is unknown, never ok."""
    v = d.get("contract_version") if isinstance(d, dict) else None
    if not isinstance(v, int) or isinstance(v, bool) or v < MIN_CONTRACT_VERSION:
        return None
    if not isinstance(d, dict) or "as_of" not in d or not isinstance(d.get("sources"), dict) or not d["sources"]:
        return None
    sources = {}
    for k, s in d["sources"].items():
        s = s if isinstance(s, dict) else {}
        state = s.get("state") if s.get("state") in SOURCE_STATES else "unknown"
        sources[str(k)[:NAME_MAX]] = {"state": state, "checked_at": s.get("checked_at"),
                                      **({"error": _text(s["error"], ERROR_MAX)} if s.get("error") else {})}
    return {**d, "sources": sources}


def _read(name, path):
    cfg = _configured()
    if cfg:
        return _reply("refused", error=cfg)
    mirror = _mirror().get(name)

    def stale(why, **more):
        if mirror:
            return _reply("mirror", why=why, mirror=True, stored_at=int(mirror["at"]),
                          age=max(0, int(_now() - mirror["at"])), data=mirror["body"], **more)
        # Pi Hub's own cap (`busy`) says nothing about the Assistant: it is not `unreachable`, which the page draws as down.
        return _reply({"pc_off": "needs_pc", "busy": "busy"}.get(why, "unreachable"), why=why, data=None, **more)

    with _Slot(name) as slot:
        if not slot:
            return stale("busy")
        r = call("GET", path, timeout=TIMEOUT["read"], cap=CAP["read"])
    if r.kind == "blocked":
        return stale("pc_off")
    if r.kind == "http" and r.status in (404, 405):
        return _reply("out_of_date", data=None, error="The Assistant is older than this page needs.")
    if r.kind == "http" and r.status in (401, 403):
        return _reply("refused", data=None, error=r.error() or "The Assistant refused Pi Hub's key.")
    if r.kind != "ok":
        return stale("pc_off" if pc_state() == "off" else "unreachable")
    body = _contract_body(r.data)
    if body is None:
        return _reply("out_of_date", data=None, error="The Assistant is older than this page needs.")
    _keep(name, body)
    return _reply("live", mirror=False, data=body)


@router.get("/status")
def api_status(request: Request):
    auth.need(request, "owner")
    return _read("status", STATUS)


@router.get("/models")
def api_models(request: Request):
    auth.need(request, "owner")
    return _read("models", MODELS)


# ---- tasks ----

def _clean_goal(v):
    """The goal as Local AI gets it: trimmed text, at most GOAL_MAX characters; ValueError says why not."""
    if not isinstance(v, str):
        raise ValueError("Say what the task is.")
    goal = _text(v, len(v)).strip()
    if not goal:
        raise ValueError("Say what the task is.")
    if len(goal) > GOAL_MAX:
        raise ValueError(f"Keep the task under {GOAL_MAX:,} characters ({len(goal):,} now).")
    return goal


def _ts(v):
    return _text(v, 40) if isinstance(v, str) and v else None


def _run(item):
    """The run as the task page needs it: a known status, or None (a status this page doesn't know is out of date)."""
    if not isinstance(item, dict) or item.get("status") not in RUN_STATUSES:
        return None
    p = item.get("progress")
    meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
    mid = meta.get("missionId")
    out = item.get("output") if isinstance(item.get("output"), dict) else {}
    inp = item.get("input") if isinstance(item.get("input"), dict) else {}
    return {"id": _text(item.get("id"), 80), "status": item["status"], "goal": _text(inp["goal"], GOAL_MAX) or None if isinstance(inp.get("goal"), str) else None,
            "progress": int(p) if isinstance(p, (int, float)) and not isinstance(p, bool) and 0 <= p <= 100 else None,
            "summary": _text(item.get("summary"), SUMMARY_MAX), "error": _text(item.get("error"), ERROR_MAX) or None,
            "cancellable": item.get("cancellable") is True,
            "createdAt": _ts(item.get("createdAt")), "startedAt": _ts(item.get("startedAt")),
            "updatedAt": _ts(item.get("updatedAt")), "finishedAt": _ts(item.get("finishedAt")),
            "missionId": mid if isinstance(mid, str) and MISSION_ID.fullmatch(mid) else None,
            "outcome": _text(out.get("outcome"), 40) or None}


def _mission(m):
    if not isinstance(m, dict):
        return None
    workers = [{"id": _text(w.get("id"), 80), "name": _text(w.get("name"), NAME_MAX), "state": _text(w.get("state"), 40),
                "model": _text(w.get("model"), NAME_MAX), "error": _text(w.get("error"), ERROR_MAX) or None}
               for w in (m.get("workers") if isinstance(m.get("workers"), list) else [])[:WORKERS_MAX] if isinstance(w, dict)]
    return {"workers": workers, "answer": _text(m.get("answer"), ANSWER_MAX) if m.get("answer") else None}


def _valid_run_id(run_id):
    if not RUN_ID.fullmatch(run_id or ""):
        raise HTTPException(400, "That isn't a task id.")
    return run_id


async def _json_body(request):
    ctype = request.headers.get("content-type", "").lower()
    if not ctype.startswith("application/json"):
        raise HTTPException(415, "Send JSON.")
    try:
        data = json.loads(bytes(await lab_guard.read_capped(request, BODY_MAX)))
    except HTTPException as e:
        raise HTTPException(e.status_code, "That's too big." if e.status_code == 413 else e.detail)
    except ValueError:
        raise HTTPException(400, "That isn't JSON.")
    if not isinstance(data, dict):
        raise HTTPException(400, "That isn't a JSON object.")
    return data


UNSURE = "Pi Hub couldn't reach the Assistant, so it doesn't know whether the task started. Check Work before trying again."
MAYBE = "Pi Hub doesn't know whether the task started. Check Work before trying again."


def _maybe(said, otherwise):
    """An answer that doesn't say whether a task started: Local AI's words (or ours), then that a task may exist."""
    return f"{(said or otherwise).rstrip('.')}. {MAYBE}"


@router.post("/tasks")
async def api_task_start(request: Request):
    role, device = auth.need(request, "owner")
    data = await _json_body(request)
    try:
        goal = _clean_goal(data.get("goal"))
    except ValueError as e:
        return _reply("refused", 400, error=str(e))
    body = {"goal": goal, "async": True}
    project = data.get("projectId")
    if project not in (None, ""):
        if not isinstance(project, str) or not PROJECT_ID.fullmatch(project):
            return _reply("refused", 400, error="That isn't a project id.")
        body["projectId"] = project
    cfg = _configured()
    if cfg:
        return _reply("refused", 503, error=cfg)
    out = await asyncio.to_thread(_submit, body)
    auth.log(role, device, "ai:task-start", out[0])
    return _json(out[1], out[2])


def _submit(body):
    """(outcome word for the log, reply body, status): the goal is never logged."""
    def say(state, status, **more):
        return state, {"state": state, "fetched_at": int(_now()), **more}, status

    with _Slot("submit") as slot:
        if not slot:
            return say("busy", 429, error="A task is already being started. Try again in a moment.")
        r = call("POST", START, body=body, timeout=TIMEOUT["submit"], cap=CAP["small"])
    if r.kind == "blocked":
        return say("needs_pc", 503, error="Starting a task needs the PC.")
    if r.kind == "unreachable":
        return say("unreachable", 503, error=UNSURE)
    if r.kind == "http":
        if r.status == 400:
            installed = r.data.get("installed") if isinstance(r.data, dict) else None
            return say("refused", 400, error=r.error() or "The Assistant didn't accept that task.",
                       **({"code": _text(r.data.get("code"), 40), "installed": [_text(m, NAME_MAX) for m in installed[:50]]}
                          if isinstance(installed, list) else {}))
        if r.status in (404, 405):
            return say("out_of_date", 502, error="The Assistant is older than this page needs.")
        if r.status in (401, 403):
            return say("refused", 502, error=r.error() or "The Assistant refused Pi Hub's key.")
        if r.status == 503 and r.error():  # Local AI's own refusal (its models aren't checked yet): nothing started
            return say("unavailable", 503, error=r.error())
        # A 5xx, a 429 or anything else may have come after the run was made: never "nothing started".
        return say("unavailable", 503 if r.status == 503 else 502, error=_maybe(r.error(), "The Assistant answered with an error"))
    run_id, thread = r.data.get("runId"), r.data.get("threadId")
    if r.status != 202 or not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
        return say("out_of_date", 502, error="The Assistant answered in a way this page doesn't know.")
    return say("submitted", 202, runId=run_id, **({"threadId": _text(thread, 80)} if isinstance(thread, str) else {}))


@router.get("/tasks/{run_id}")
def api_task_follow(run_id: str, request: Request):
    auth.need(request, "owner")
    _valid_run_id(run_id)
    cfg = _configured()
    if cfg:
        return _reply("refused", error=cfg)
    with _Slot("follow") as slot:
        if not slot:
            return _reply("busy")
        r = call("GET", RUNS, query=f"id={urllib.parse.quote(run_id, safe='')}", timeout=TIMEOUT["follow"], cap=CAP["run"])
        if r.kind == "blocked":
            return _reply("unreachable", why="pc_off")
        if r.kind == "unreachable":
            return _reply("unreachable", why="pc_off" if pc_state() == "off" else "unreachable")
        if r.kind == "http":
            if r.status == 404:
                return _reply("not_found", error=r.error() or "The Assistant has no task with this id.")
            if r.status == 405:
                return _reply("out_of_date", error="The Assistant is older than this page needs.")
            if r.status in (401, 403):
                return _reply("refused", error=r.error() or "The Assistant refused to show this task.")
            # A 5xx, a 429 or any other status says nothing about the task: it may still be running, so the page keeps asking.
            return _reply("unreachable", why="unreachable")
        run = _run(r.data.get("item"))
        if run is None:
            return _reply("out_of_date", error="The Assistant sent a task state this page doesn't know.")
        mission, read = None, "none"
        if run["missionId"]:
            m = call("GET", MISSION, query=f"id={urllib.parse.quote(run['missionId'], safe='')}", timeout=TIMEOUT["follow"],
                     cap=CAP["mission"])
            mission = _mission(m.data.get("mission")) if m.kind == "ok" else None
            read = "ok" if mission is not None else "failed"
    return _reply("ok", run=run, mission=mission, mission_read=read)


@router.post("/tasks/{run_id}/cancel")
async def api_task_cancel(run_id: str, request: Request):
    role, device = auth.need(request, "owner")
    _valid_run_id(run_id)
    cfg = _configured()
    if cfg:
        return _reply("refused", 503, error=cfg)
    out = await asyncio.to_thread(_cancel, run_id)
    auth.log(role, device, "ai:task-cancel", out[0])
    return _json(out[1], out[2])


def _cancel(run_id):
    def say(state, status, **more):
        return state, {"state": state, "fetched_at": int(_now()), **more}, status

    with _Slot("cancel") as slot:
        if not slot:
            return say("busy", 429, error="A cancel is already on its way.")
        r = call("POST", CANCEL, body={"id": run_id}, timeout=TIMEOUT["cancel"], cap=CAP["small"])
    if r.kind == "blocked":
        return say("needs_pc", 503, error="Cancelling needs the PC.")
    if r.kind == "unreachable":
        return say("unreachable", 503, error="Pi Hub couldn't reach the Assistant. The task wasn't cancelled as far as it knows.")
    if r.kind == "http":
        if r.status == 404:
            return say("not_found", 404, error=r.error() or "The Assistant has no task with this id.")
        if r.status == 409:
            return say("not_cancellable", 409, error=r.error() or "This task can't be cancelled now.")
        if r.status in (401, 403):
            return say("refused", 502, error=r.error() or "The Assistant didn't cancel the task.")
        return say("unavailable", 503 if r.status == 503 else 502,
                   error="The Assistant answered with an error, so Pi Hub doesn't know whether the task was cancelled.")
    return say("ok", 200, run=_run(r.data.get("item")))
