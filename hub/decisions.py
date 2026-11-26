"""Owner decisions (amendment A33; plan docs/superpowers/plans/2026-11-21-a33-owner-decisions.md, decisions 1-9):
questions a session on the Mac asks the owner, kept as rows and answered by a tap in Needs you. A session adds one with
the Mac's deploy key (X-Hub-Deploy-Key, plan decision 1) and reads the answers back with the same key; only the owner
answers. A tap records an answer and nothing else.

Decisions are not conditions of the house: they never enter Needs you's count or items, the wall, the display feed or
the printer folding (A33 owner call 2). /api/needs carries them beside its items for an owner caller only (attach()).
A table that can't be read is said so (Unreadable), never shown as an empty list.

A35 M1b (plan docs/superpowers/plans/2026-11-25-a35-m1b-pi-side.md, decision 11) extends the record additively: nullable
columns for an initiative's decisions, the kinds `multi` and `yesno`, D7's wider limits for a row with an initiative,
and `GET /api/decisions?v=2` for every row. The plain read keeps returning only rows an A33 client can read."""
import json
import re
import sqlite3
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import auth, db, releases
from .missions import mirror
from .notify_routes import CLICK_HOSTS, _click, _line

router = APIRouter(prefix="/api/decisions")

# source -> key check. "claude": the sessions on the Mac, with the Mac's deploy key (plan decisions 1 and 7).
SOURCES = {"claude": lambda r: releases.host_key_ok(r, "mac")}
ID = re.compile(r"[a-z0-9][a-z0-9-]{2,63}")
KINDS = ("choice", "text")  # A33's: the only kinds the plain read returns
V2_KINDS = KINDS + ("multi", "yesno")  # A35 M1b
LATER_KINDS = ("rank", "number", "approve")  # A35 M2
LATER_FIELDS = ("number", "affects", "delegable", "default_if_delegated", "digest")  # A35 M2: refused, never dropped
YESNO = ["Yes", "No"]
QUESTION, OPTION, ANSWER = 280, 60, 500  # characters (plan decision 8)
CONTEXT, WHY_NEEDED, RATIONALE, REQUESTED_BY = 2000, 500, 1000, 80  # characters (A35 §9.1)
MIN_OPTIONS, MAX_OPTIONS = 2, 4
MAX_OPTIONS_V2, MAX_BODY_V2 = 8, 32768  # D7: a row with an initiative only
MAX_EVIDENCE = 10
EVIDENCE_ID = re.compile(r"[a-z0-9][a-z0-9:_-]{0,79}")  # as home-mcp reads evidence ids
ENUMS = {"confidence": ("low", "medium", "high"), "reversibility": ("reversible", "costly", "irreversible"),
         "status": ("open", "investigating", "deferred", "superseded")}  # "answered" is set by the answer
KEEP_ANSWERED = 50  # answered rows kept, newest first (decision 9); open rows stay until answered
NEEDS_ANSWERED = 5  # answered rows /api/needs shows the owner
MAX_BODY = 8192
WRONG_KEY = "That key is missing or wrong for this source."
# Who is asking can't be read (the sign-in records fail): its own fault, worded without naming decisions, so a caller
# who isn't the owner learns nothing about them from it.
WHO_UNREADABLE = {"id": "pi:who:unreadable", "source": "Pi Hub", "tone": "bad", "title": "Sign-in can't be checked",
                  "detail": "Pi Hub couldn't read its sign-in records, so parts of this page for the owner are hidden."}
UNREADABLE = {"id": "pi:decisions:unreadable", "source": "Pi Hub", "tone": "bad", "title": "Decisions can't be read",
              "detail": "Pi Hub couldn't read its list of open decisions, so none are shown."}

# Decision links may also point at a spec or PR on GitHub (owner, 23 Nov); notify links stay on the hub hosts.
LINK_HOSTS = CLICK_HOSTS | {"github.com"}
COLUMNS = "id, source, kind, question, options, recommended, link, created_at, answered_at, answer, supersedes"
# A35 §9.1, all nullable so A33 rows are unchanged. affects, number, delegable, default_if_delegated and digest stay
# empty until M2; they are added now so M2 needs no second migration.
V2_COLUMNS = {"initiative": "TEXT", "context": "TEXT", "why_needed": "TEXT", "requested_by": "TEXT",
              "rationale": "TEXT", "evidence": "TEXT", "confidence": "TEXT", "reversibility": "TEXT", "affects": "TEXT",
              "blocking": "INTEGER", "status": "TEXT", "number": "TEXT", "delegable": "INTEGER",
              "default_if_delegated": "TEXT", "digest": "TEXT"}
ALL_COLUMNS = COLUMNS + ", " + ", ".join(V2_COLUMNS)
# What add() writes, in this order: A33's fields, then the M1b ones.
STORED = ("question", "options", "recommended", "link", "kind", "supersedes", "initiative", "context", "why_needed",
          "requested_by", "rationale", "evidence", "confidence", "reversibility", "blocking", "status")
A33_SHAPE = "kind IN ('choice', 'text') AND initiative IS NULL"
SCHEMA = ("CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, source TEXT NOT NULL, question TEXT NOT NULL, "
          "options TEXT NOT NULL, recommended TEXT, link TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL, "
          "answered_at INTEGER, answer TEXT, answer_note TEXT, supersedes TEXT)")
# An initiative's decisions are its record and are never trimmed (A35 §6.2); the 50 kept are of the rest.
TRIM = ("DELETE FROM decisions WHERE answered_at IS NOT NULL AND initiative IS NULL AND id NOT IN (SELECT id "
        "FROM decisions WHERE answered_at IS NOT NULL AND initiative IS NULL ORDER BY answered_at DESC, rowid DESC "
        "LIMIT ?)")

_ready = set()


class Unreadable(Exception):
    """The decisions table can't be read: its own state, never an empty list."""


class Changed(Exception):
    """The decision was asked again between reading it and recording the answer; `row` is the question as it is now."""

    def __init__(self, row):
        super().__init__(row["id"])
        self.row = row


class Answered(Exception):
    """The decision was already answered; `row` holds the answer."""

    def __init__(self, row):
        super().__init__(row["id"])
        self.row = row


def ready():
    path = db.conn().execute("PRAGMA database_list").fetchone()[2]
    if path not in _ready:
        db.run(SCHEMA)
        db.ensure_columns("decisions", V2_COLUMNS)  # additive on a database from before A35
        _ready.add(path)


def key_refusal(request, source):
    """None when `request` carries `source`'s own key, else the refusal: 404 for a source not on the list, 401 for a
    missing or wrong key. The front-door guard (app.py) and the route both ask."""
    if source not in SOURCES:
        return JSONResponse({"detail": "There is no such source."}, status_code=404)
    if not SOURCES[source](request):
        return JSONResponse({"detail": WRONG_KEY}, status_code=401)
    return None


def added_by(path):
    """The source named by an add path (/api/decisions/{source}), else None (an answer path is never one)."""
    rest = path[len("/api/decisions/"):] if path.startswith("/api/decisions/") else ""
    return rest if rest and "/" not in rest else None


def _text(v, limit):
    """One line of 1..limit characters, or None: whitespace collapsed (as notify's titles), too long refused, never cut."""
    t = _line(v, limit + 1)
    return t if t and len(t) <= limit else None


def _prose(v, limit):
    """Text of 1..limit characters with its newlines kept (a text answer, a context), or None."""
    t = v.replace("\r", "").strip() if isinstance(v, str) else ""
    return t if 1 <= len(t) <= limit else None


def _option_list(kind, options, most):
    """The options as stored, or a ValueError naming the limit they break."""
    if not isinstance(options, list) or not MIN_OPTIONS <= len(options) <= most:
        raise ValueError(f"A {kind} needs {MIN_OPTIONS} to {most} options.")
    if any(isinstance(o, dict) for o in options):
        raise ValueError("Options are text for now; option objects come with A35 M2.")
    options = [_text(o, OPTION) for o in options]
    if None in options:
        raise ValueError(f"Each option is one line of 1 to {OPTION} characters.")
    if len({o.casefold() for o in options}) != len(options):
        raise ValueError("Two options are the same.")
    return options


def _choices(kind, body, most=MAX_OPTIONS):
    """(options, recommended) for a body, or a ValueError naming the limit it breaks. `most` is D7's: 8 for a row with
    an initiative, else A33's 4."""
    options, recommended = body.get("options"), body.get("recommended")
    if kind == "text":
        if options not in (None, []) or recommended is not None:
            raise ValueError("A text decision has no options.")
        return [], None
    if kind == "yesno":
        if options not in (None, []):
            raise ValueError("A yesno decision's options are always Yes and No; send none.")
        options = list(YESNO)
    else:
        options = _option_list(kind, options, most)
    if recommended is not None:
        recommended = _text(recommended, OPTION)
        if recommended not in options:
            raise ValueError("recommended must be one of the options.")
    return options, recommended


def _evidence(v):
    """The evidence ids as stored, None when absent, or a ValueError."""
    if v is None:
        return None
    if not isinstance(v, list) or len(v) > MAX_EVIDENCE or not all(
            isinstance(e, str) and EVIDENCE_ID.fullmatch(e) for e in v):
        raise ValueError(f"evidence is a list of at most {MAX_EVIDENCE} evidence ids.")
    return v


def _extended(body):
    """The A35 M1b fields of a body, cleaned, or a ValueError naming what is wrong. M2's fields are refused, not
    dropped, so a session learns they did nothing."""
    later = [k for k in LATER_FIELDS if body.get(k) is not None]
    if later:
        raise ValueError(f"{', '.join(later)}: not taken yet; that comes with A35 M2.")
    initiative = body.get("initiative")
    if initiative is not None and not (isinstance(initiative, str) and ID.fullmatch(initiative)):
        raise ValueError("initiative must be an initiative id: 3 to 64 lower-case letters, digits or dashes.")
    out = {"initiative": initiative, "evidence": _evidence(body.get("evidence"))}
    for field, limit in (("context", CONTEXT), ("why_needed", WHY_NEEDED), ("rationale", RATIONALE)):
        out[field] = None if body.get(field) is None else _prose(body[field], limit)
        if body.get(field) is not None and out[field] is None:
            raise ValueError(f"{field} is 1 to {limit} characters.")
    out["requested_by"] = None if body.get("requested_by") is None else _text(body["requested_by"], REQUESTED_BY)
    if body.get("requested_by") is not None and out["requested_by"] is None:
        raise ValueError(f"requested_by is one line of 1 to {REQUESTED_BY} characters.")
    for field, allowed in ENUMS.items():
        if body.get(field) is not None and body[field] not in allowed:
            raise ValueError(f"{field} must be one of {', '.join(allowed)}.")
        out[field] = body.get(field)
    if body.get("blocking") is not None and not isinstance(body["blocking"], bool):
        raise ValueError("blocking must be true or false.")
    out["blocking"] = body.get("blocking")
    return out


def valid(body):
    """The decision, cleaned, or a ValueError naming what is wrong (plan decisions 7 and 8). Nothing is stored for a
    refused body."""
    if not isinstance(body, dict):
        raise ValueError("Send the decision as a JSON object.")
    did = body.get("id")
    if not isinstance(did, str) or not ID.fullmatch(did):
        raise ValueError("id must be 3 to 64 lower-case letters, digits or dashes, starting with a letter or digit.")
    kind = body.get("kind", "choice")
    if kind in LATER_KINDS:
        raise ValueError(f"kind {kind} isn't taken yet; that comes with A35 M2.")
    if kind not in V2_KINDS:
        raise ValueError("kind must be choice, text, multi or yesno.")
    question = _text(body.get("question"), QUESTION)
    if not question:
        raise ValueError(f"The question is one line of 1 to {QUESTION} characters.")
    extended = _extended(body)
    options, recommended = _choices(kind, body, MAX_OPTIONS_V2 if extended["initiative"] else MAX_OPTIONS)
    link = body.get("link")
    if link is not None and _click(link, LINK_HOSTS) is None:
        raise ValueError("link must be an https address on the hub, the Assistant or github.com.")
    supersedes = body.get("supersedes")
    if supersedes is not None and (not isinstance(supersedes, str) or not ID.fullmatch(supersedes) or supersedes == did):
        raise ValueError("supersedes must name another decision's id.")
    return {"id": did, "kind": kind, "question": question, "options": options, "recommended": recommended,
            "link": _click(link, LINK_HOSTS) if link is not None else None, "supersedes": supersedes, **extended}


def _answer_value(kind, stored):
    """A stored answer as the routes answer it: a multi's is its list of options, every other kind's its text."""
    return json.loads(stored) if kind == "multi" and stored is not None else stored


def _shape(row):
    """A stored row as the routes answer it. Raises Unreadable when its options (or a multi's answer, or its evidence)
    can't be read: that is the table failing, never the caller's bad input. v2 fields appear only when selected."""
    out = dict(row)
    try:
        out["options"] = json.loads(row["options"])
        out["answer"] = _answer_value(row["kind"], row["answer"])
        if row.get("evidence") is not None:
            out["evidence"] = json.loads(row["evidence"])
    except (TypeError, ValueError) as e:
        raise Unreadable(f"decision {row['id']}: a stored list can't be read") from e
    if not isinstance(out["options"], list):
        raise Unreadable(f"decision {row['id']}: options is not a list")
    for field in ("blocking", "delegable"):
        if row.get(field) is not None:
            out[field] = bool(row[field])
    return out


def get(did):
    ready()
    row = db.one(f"SELECT {ALL_COLUMNS} FROM decisions WHERE id = ?", did)
    return _shape(row) if row else None


def _stored(d):
    """The values add() writes for `d` (from valid()), in STORED's order."""
    out = {**d, "options": json.dumps(d["options"]),
           "evidence": None if d.get("evidence") is None else json.dumps(d["evidence"]),
           "blocking": None if d.get("blocking") is None else int(d["blocking"])}
    return tuple(out.get(k) for k in STORED)


def add(source, d, now=None):
    """Stores `d` (from valid()), or asks it again in place while that id is still open (A33 Design). Returns
    (row, "added" | "asked again"). Raises Answered when the id has been answered (the session reads the answer rather
    than asking again), ValueError when `supersedes` doesn't name an answered decision."""
    ready()
    now = int(now or time.time())
    fields = _stored(d)
    if d["initiative"]:
        mirror.ready()  # the mission tables, before the transaction that writes to them
    with db.transaction() as c:
        if d["supersedes"]:
            old = c.execute("SELECT answered_at FROM decisions WHERE id = ?", (d["supersedes"],)).fetchone()
            if not old or old["answered_at"] is None:
                raise ValueError("supersedes must name a decision that has been answered.")
        again = c.execute(f"UPDATE decisions SET {', '.join(f'{k} = ?' for k in STORED)} "
                          "WHERE id = ? AND answered_at IS NULL", (*fields, d["id"])).rowcount
        if not again:
            if c.execute("SELECT 1 FROM decisions WHERE id = ?", (d["id"],)).fetchone():
                raise Answered(get(d["id"]))
            c.execute(f"INSERT INTO decisions (id, source, {', '.join(STORED)}, created_at) "
                      f"VALUES ({', '.join('?' * (len(STORED) + 3))})", (d["id"], source, *fields, now))
        c.execute(TRIM, (KEEP_ANSWERED,))
        if d["initiative"]:
            mirror.asked(c, d, again, now)
    return get(d["id"]), "asked again" if again else "added"


def _answer_for(row, value):
    """The answer as it is stored, or a ValueError: one of the options for a choice or a yesno; 1-500 characters for
    text, with its newlines kept (plan decision 8); for a multi, one or more of the options, stored in option order
    as a JSON list, so the same choice tapped twice in any order is the same answer."""
    if row["kind"] == "text":
        text = _prose(value, ANSWER)
        if text is None:
            raise ValueError(f"The answer is 1 to {ANSWER} characters.")
        return text
    if row["kind"] == "multi":
        picked = {_text(v, OPTION) for v in value} if isinstance(value, list) else set()
        if not picked or not picked <= set(row["options"]):
            raise ValueError("Choose one or more of the options.")
        return json.dumps([o for o in row["options"] if o in picked])
    choice = _text(value, OPTION)
    if choice not in row["options"]:
        raise ValueError("That answer isn't one of the options.")
    return choice


def answer(did, value, role, device, now=None):
    """Records the owner's answer once (plan decision 6). Returns (row, recorded): a second tap of the same answer is
    (stored row, False). Raises LookupError for an unknown id, ValueError for an answer that doesn't fit, Answered when
    a different answer is already stored, Changed when the question was asked again before the write."""
    row = get(did)
    if row is None:
        raise LookupError(did)
    text = _answer_for(row, value)
    # The write names the question and options the answer was checked against, so a session asking again in between
    # (add() updates them in place) leaves the row open rather than storing an answer to a question no longer asked.
    # A row with a status (A35) is marked answered with it; an A33 row has none and keeps none.
    now = int(now or time.time())
    sql = ("UPDATE decisions SET answer = ?, answered_at = ?, status = CASE WHEN status IS NULL THEN NULL ELSE "
           "'answered' END WHERE id = ? AND answered_at IS NULL AND kind = ? AND question = ? AND options = ?")
    args = (text, now, did, row["kind"], row["question"], json.dumps(row["options"]))
    if row.get("initiative"):  # an initiative's answer and its mirrored event are one write (A35 decision 11)
        mirror.ready()
        with db.transaction() as c:
            done = c.execute(sql, args).rowcount
            if done:
                mirror.answered(c, row, now)
    else:
        done = db.run(sql, *args).rowcount
    if done:
        auth.log(role, device, f"decision:{did}", "answered")
        db.run(TRIM, KEEP_ANSWERED)
        return get(did), True
    row = get(did)
    if row is None:
        raise LookupError(did)
    if row["answered_at"] is None:
        raise Changed(row)
    if row["answer"] == _answer_value(row["kind"], text):
        return row, False
    raise Answered(row)


def open_and_recent(answered=NEEDS_ANSWERED, where="1", columns=COLUMNS, args=()):
    """{"open": oldest first, "answered": newest first, at most `answered` (-1: every one)}, of the rows `where`
    selects (with `args` for its ? marks). Raises Unreadable when the table can't be read."""
    try:
        ready()
        opened = db.rows(f"SELECT {columns} FROM decisions WHERE answered_at IS NULL AND {where} "
                         "ORDER BY created_at, rowid", *args)
        done = db.rows(f"SELECT {columns} FROM decisions WHERE answered_at IS NOT NULL AND {where} "
                       "ORDER BY answered_at DESC, rowid DESC LIMIT ?", *args, answered)
        return {"open": [_shape(r) for r in opened], "answered": [_shape(r) for r in done]}
    except sqlite3.Error as e:
        raise Unreadable(str(e)) from e


def attach(data):
    """Adds the owner's decisions to a Needs you answer (plan decisions 3-5). An unreadable table gives
    `decisions: null` and one `bad` item, placed after the other faults; the decisions themselves never enter `items`
    or `count`."""
    try:
        data["decisions"] = open_and_recent()
    except Unreadable:
        data["decisions"] = None
        fault(data, UNREADABLE)
    return data


def fault(data, item):
    """`item` added to a Needs you answer after its other faults, and counted."""
    items = data["items"]
    at = next((n for n, i in enumerate(items) if i.get("tone") != "bad"), len(items))
    items.insert(at, dict(item))
    data["count"] = data.get("count", 0) + 1
    return data


async def _body(request, cap=MAX_BODY):
    """The JSON body, or None when it isn't JSON. 413 past `cap`, and past A33's 8 KB for a body without an
    initiative (D7: only an initiative's decision gets the 32 KB cap)."""
    raw = await request.body()
    if len(raw) > cap:
        raise HTTPException(413, "That decision is too big.")
    try:
        body = json.loads(raw)
    except ValueError:
        return None
    if len(raw) > MAX_BODY and not (isinstance(body, dict) and body.get("initiative") is not None):
        raise HTTPException(413, "That decision is too big.")
    return body


@router.get("")
def list_decisions(request: Request, v: str | None = None):
    """Open decisions and every kept answer, for a session with the Mac's key (plan decision 2). 503 when the table
    can't be read, never an empty list. Without `v`, only rows an A33 client can read (kind choice or text, no
    initiative), as A33 shaped them; `?v=2` (A35 §7.4) is every row with every column, and says `"version": 2`."""
    if not releases.host_key_ok(request, "mac"):
        raise HTTPException(401, WRONG_KEY)
    if v not in (None, "2"):
        raise HTTPException(400, "v must be 2, or left out for the A33 shape.")
    try:
        data = (open_and_recent(-1, columns=ALL_COLUMNS) | {"version": 2} if v == "2"
                else open_and_recent(KEEP_ANSWERED, where=A33_SHAPE))
    except Unreadable as e:
        raise HTTPException(503, f"Decisions can't be read: {e}")
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.post("/{did}/answer")
async def answer_route(did: str, request: Request):
    """The owner's tap. Only a signed-in owner (A33 call 1), and only from the hub's own page: Fetch Metadata saying
    another site (or another of the house's sites) is refused, as the front gate does (gate.lax_like)."""
    site = (request.headers.get("sec-fetch-site") or "").lower()
    if site and site != "same-origin":
        raise HTTPException(403, "This answer has to come from the hub's own page.")
    role, device = auth.need(request, "owner")
    body = await _body(request)
    try:
        row, recorded = answer(did, body.get("answer") if isinstance(body, dict) else None, role, device)
    except LookupError:
        raise HTTPException(404, "There is no such decision.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Answered as e:
        return JSONResponse({"detail": "That decision already has a different answer.", "decision": e.row},
                            status_code=409)
    except Changed as e:
        return JSONResponse({"detail": "Not recorded: the question changed. Read it again.", "decision": e.row},
                            status_code=409)
    except Unreadable:
        raise HTTPException(503, "Not recorded: that decision can't be read.")
    except sqlite3.Error:
        raise HTTPException(503, "Not recorded: decisions can't be written. Try again.")
    return {"ok": True, "recorded": recorded, "decision": row}


@router.post("/{source}")
async def add_route(source: str, request: Request):
    """A session asks the owner. Only its source's own key may add (plan decision 7)."""
    refused = key_refusal(request, source)
    if refused:
        return refused
    body = await _body(request, MAX_BODY_V2)
    try:
        row, outcome = add(source, valid(body))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Unreadable:
        raise HTTPException(503, "Not stored: that decision can't be read.")
    except sqlite3.Error:
        raise HTTPException(503, "Not stored: decisions can't be written.")
    except Answered as e:
        return JSONResponse({"detail": "That decision is already answered; read its answer instead of asking again.",
                             "answer": e.row["answer"], "answered_at": e.row["answered_at"], "decision": e.row},
                            status_code=409)
    return {"ok": True, "outcome": outcome, "decision": row}
