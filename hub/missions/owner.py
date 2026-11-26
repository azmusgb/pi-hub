"""The owner's writes to a mission (A35 §6.2 "Owner writes", §8; M1b plan decision 10): `POST /api/missions/{id}/owner`.

Three verbs in M1b: `revision.accept`, `revision.reject` and `initiative.status`. Gate verdicts, manual evidence and
Commands are refused with 400 "not yet" until M3 and M4 add them. Each write is conditional on what the owner saw: a
revision is decided only while it is still `proposed`, at the number sent, and a status changes only from the one sent.
So a double tap is a 200 that changes nothing (`changed: false`), and a tap on a state that has moved is a 409 that
says where it is now. A change is appended to the log as an event with source `owner` and projected by the same
`project.apply` the importer's events use, in one transaction (so rebuild = live).

Returns (status, body); the route adds the headers. Nothing here knows about HTTP or a session."""
import json
import uuid

from .. import db
from . import project, shown, store

LATER = ("gate.", "evidence.", "command")  # verbs M3 and M4 add: refused, never silently dropped
STATUSES = ("proposed", "active", "paused", "done", "retired")  # an initiative's, A35 §6.1
VERBS = ("revision.accept", "revision.reject", "initiative.status")
DECIDES = {"revision.accept": ("revision.accepted", "accepted"), "revision.reject": ("revision.rejected", "rejected")}


def _int(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 1


def refuse(status, error, detail, **more):
    return status, {"error": error, "detail": detail, **more}


def check(body):
    """A refusal for a body this route won't act on, else None: the verb, then its fields."""
    verb = body.get("verb") if isinstance(body, dict) else None
    if not isinstance(verb, str):
        return refuse(400, "bad_field", "Send a JSON object with a verb.")
    if verb.startswith(LATER):
        return refuse(400, "not_yet", f"{verb[:40]} isn't taken yet; it comes with Mission Control M3.")
    if verb not in VERBS:
        return refuse(400, "unknown_verb", f"The verbs are {', '.join(VERBS)}.")
    if verb == "initiative.status":
        if body.get("status") not in STATUSES or body.get("from") not in STATUSES:
            return refuse(400, "bad_field", f"status and from are each one of {', '.join(STATUSES)}.")
    elif not _int(body.get("revision")):
        return refuse(400, "bad_field", "revision is the number you saw, 1 or more.")
    return None


def _append(c, state, initiative, etype, entity, body, now):
    at = shown.iso(now)
    logged = store.append(c, {
        "event_id": str(uuid.uuid4()), "at": at, "received_at": at, "source": "owner", "initiative": initiative,
        "entity": entity, "type": etype, "body": project.json_text(body), "late": False, "behind": False})
    store.write(c, project.apply(state, logged))
    return logged["seq"]


def _decide(c, state, initiative, verb, n, now):
    etype, target = DECIDES[verb]
    row = state["rows"]["mission_revisions"].get((initiative, n))
    if row is None:
        return refuse(404, "no_such_revision", "There is no such revision.")
    seen = {"n": n, "status": row["status"]}
    if row["status"] == target:
        return 200, {"ok": True, "changed": False, "revision": seen}
    if row["status"] != "proposed":
        return refuse(409, "conflict", f"Revision {n} is {row['status']}, not proposed.", revision=seen)
    seq = _append(c, state, initiative, etype, f"revision:{n}", {"revision": n}, now)
    return 200, {"ok": True, "changed": True, "revision": {"n": n, "status": target}, "seq": seq}


def _status(c, state, initiative, body, now):
    row = state["rows"]["mission_initiatives"][(initiative,)]
    if row["status"] == body["status"]:
        return 200, {"ok": True, "changed": False, "status": row["status"]}
    if row["status"] != body["from"]:
        return refuse(409, "conflict", f"The initiative is {row['status']}, not {body['from']}.", current=row["status"])
    seq = _append(c, state, initiative, "initiative.status", initiative, {"status": body["status"]}, now)
    return 200, {"ok": True, "changed": True, "status": body["status"], "seq": seq}


def write(initiative, body, now):
    """One owner write, in one BEGIN IMMEDIATE. Raises sqlite3.Error when the ledger can't be written; the route
    answers that as 503, never as a refusal or a success."""
    refused = check(body)
    if refused:
        return refused
    store.ready()
    with db.transaction() as c:
        state = store.load_state(c, initiative)
        if (initiative,) not in state["rows"]["mission_initiatives"]:
            return refuse(404, "no_such_initiative", "There is no such mission.")
        if body["verb"] == "initiative.status":
            return _status(c, state, initiative, body, now)
        return _decide(c, state, initiative, body["verb"], body["revision"], now)


def body_of(raw):
    """The JSON body, or None when it isn't JSON (the route answers that 400)."""
    try:
        return json.loads(raw)
    except (ValueError, RecursionError):
        return None
