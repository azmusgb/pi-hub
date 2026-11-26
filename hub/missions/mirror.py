"""The decisions mirror (A35 §6.2; M1b plan decision 11): when an initiative's decision is asked or answered, one event
is appended to the mission log with source `pi-hub`, so the initiative's history is complete in one place. The
decisions table stays authoritative and is outside rebuild: these events change no projection (`project.MIRRORED`).

Written in the decision's own transaction, so a decision and its history are stored together or not at all. The body
carries the decision's id and kind, never an answer: a text answer is the owner's own words and stays in the
decisions table."""
import uuid

from . import project, shown, store

ready = store.ready


def _append(c, etype, row, body, now):
    at = shown.iso(now)
    store.append(c, {"event_id": str(uuid.uuid4()), "at": at, "received_at": at, "source": "pi-hub",
                     "initiative": row["initiative"], "entity": row["id"], "type": etype,
                     "body": project.json_text(body), "late": False, "behind": False})


def asked(c, d, again, now):
    """`d` (decisions.valid's output) was asked, or asked again in place, inside transaction `c`."""
    body = {"id": d["id"], "kind": d["kind"], "question": d["question"], "again": bool(again)}
    if d.get("blocking") is not None:
        body["blocking"] = bool(d["blocking"])
    _append(c, "decision.asked", d, body, now)


def answered(c, row, now):
    """The owner's answer to `row` (a shaped decision row) was recorded inside transaction `c`."""
    _append(c, "decision.answered", row, {"id": row["id"], "kind": row["kind"]}, now)
