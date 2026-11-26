"""The owner's reads of the ledger (A35 §7.4, §7.5, §8, §10.1; M1b plan decisions 8 and 9): the mission list, the
three views of one mission (overview, decisions, evidence) and the change feed the pages poll.

Every function takes the caller's connection and `now` (seconds), and every body carries `as_of` (the server's now) and
`seq` (the log's last), so a page can say how old what it draws is and relabel with a timer between polls.

Two rules shape the bodies:
- Every row says where it came from (`provenance`: its trust, its source, and for an import the manifest it came
  from). An imported row never carries a freshness field (`live`, `shown`, `since`): a manifest is history, not a
  reading. Only an execution is read live, and it carries `shown()`.
- A source that can't be read is its own state. The ledger failing raises `Unreadable` (the route answers 503); the
  decisions table failing leaves that part `{"state": "unavailable"}`, never a count of zero.

Nothing here writes, streams or starts a thread."""
import json
import sqlite3
import zlib

from .. import decisions, records
from . import shown

TRUST_ORDER = ("trusted", "owner", "reported", "imported")
GROUPS = {  # event history filters (§10.1) as SQL, so a page of history is one query
    "sessions": "source IN ('claude', 'localai')", "imports": "source = 'importer'", "owner": "source = 'owner'",
    "decisions": "type IN ('decision.asked', 'decision.answered')", "github": "source = 'github'"}
PAGE, MAX_PAGE = 25, 100
RECENT = 10  # events on the overview
CHANGES_MAX = 100  # events one changes poll carries; past it the page reads the views again
TEXT_FIELDS = ("title", "summary", "label", "question")


class Unreadable(Exception):
    """The ledger can't be read: its own state, never an empty answer."""


def _json(text):
    try:
        return json.loads(text) if text is not None else None
    except (TypeError, ValueError) as e:
        raise Unreadable("a stored row can't be read") from e


def _obj(text):
    """A stored row's data as an object: a NULL, "null" or non-object value is an unreadable row, never an empty one."""
    d = _json(text)
    if not isinstance(d, dict):
        raise Unreadable("a stored row can't be read")
    return d


def _rows(c, sql, *args):
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    except sqlite3.Error as e:
        raise Unreadable(str(e)) from e


def seq_of(c):
    try:
        return c.execute("SELECT COALESCE(MAX(seq), 0) FROM mission_events").fetchone()[0]
    except sqlite3.Error as e:
        raise Unreadable(str(e)) from e


def head(c, now):
    return {"version": 1, "as_of": shown.iso(now), "seq": seq_of(c)}


def _manifest(row):
    m = _json(row["manifest"]) if row else None
    return {"repo": m["repo"], "path": m["path"], "commit": m["commit"]} if isinstance(m, dict) else None


def imported(manifest, source="importer"):
    """Provenance of a row that came from a reviewed manifest: where from, and no time-based state."""
    return {"trust": "imported", "source": source,
            "from": f"{manifest['repo']}@{manifest['commit'][:7]}" if manifest else None}


def reported(source, at):
    return {"trust": "reported", "source": source, "at": at}


def _initiative(c, initiative):
    rows = _rows(c, "SELECT * FROM mission_initiatives WHERE id = ?", initiative)
    return rows[0] if rows else None


def exists(c, initiative):
    return _initiative(c, initiative) is not None


def _revisions(c, initiative):
    return _rows(c, "SELECT * FROM mission_revisions WHERE initiative = ? ORDER BY n", initiative)


def current(revs):
    """The revision a page draws: the latest accepted, else the latest there is (an import not yet accepted)."""
    accepted = [r for r in revs if r["status"] == "accepted"]
    return (accepted or revs or [None])[-1]


def _revision(row, manifest):
    return {"n": row["n"], "status": row["status"], "at": row["at"], "summary": row["summary"],
            "proposer": row["proposer"], "requires_approval": bool(row["requires_approval"]),
            "provenance": imported(manifest, row["proposer"])}


# ---- decisions: a count for the list and the overview, rows for the Decisions view ----

def _decision_rows(initiative):
    """(open, answered) live decisions of `initiative`, shaped as the decisions routes shape them, or None when the
    decisions table can't be read."""
    try:
        got = decisions.open_and_recent(-1, "initiative = ?", decisions.ALL_COLUMNS, (initiative,))
    except decisions.Unreadable:
        return None
    return got["open"], got["answered"]


def _imported_decisions(c, initiative, rev, manifest):
    rows = _rows(c, "SELECT id, data, state FROM mission_entities WHERE initiative = ? AND revision = ? "
                    "AND kind = 'decision'", initiative, rev)
    out = []
    for r in rows:
        d = _obj(r["data"])
        out.append({"id": r["id"], "kind": d.get("kind"), "question": d.get("question"),
                    "options": d.get("options") or [], "recommended": d.get("recommended"),
                    "answer": d.get("answer"), "answered_at": d.get("answered_at"),
                    "answer_source": d.get("answer_source"), "provenance": imported(manifest)})
    return out


def decision_counts(c, initiative, rev, manifest):
    """§8: `3 open (1 blocking) · 14 answered`, over the live decisions and the imported ones. The live half
    unreadable gives `{"state": "unavailable"}`, so the page can't draw a zero it didn't read."""
    live = _decision_rows(initiative)
    if live is None:
        return {"state": "unavailable"}
    opened, answered = live
    return {"state": "ok", "open": len(opened), "blocking": sum(1 for d in opened if d.get("blocking")),
            "answered": len(answered) + len(_imported_decisions(c, initiative, rev, manifest))}


# ---- executions ----

def _pc_on(rows):
    """Local AI's PC record as True/False, or None when it isn't there or is stale: only asked when a Local AI
    execution exists."""
    if not any(r["level"] == "full" for r in rows):
        return None
    rec = records.get("pc")
    if not rec or rec.get("stale"):
        return None
    return {"on": True, "off": False}.get(rec.get("state"))


def executions(c, initiative, now):
    rows = _rows(c, "SELECT * FROM mission_executions WHERE initiative = ? ORDER BY started_at, id", initiative)
    pc = _pc_on(rows)
    out = []
    for r in rows:
        data = _obj(r["data"]) or {}
        s = shown.shown(r, now, pc)
        out.append({"id": r["id"], "source": r["source"], "level": r["level"], "title": r["title"],
                    "tasks": data.get("tasks", []), "model": data.get("model"), "branch": data.get("branch"),
                    "workstream": data.get("workstream"), "started_at": r["started_at"], "tool": r["tool_label"]
                    if r["tool_state"] == "running" else None, "shown": s["label"], "state": s["state"],
                    "live": s["live"], "since": s["since"], "provenance": reported(r["source"], s["since"])})
    return out


# ---- events ----

def _event_text(body):
    for field in TEXT_FIELDS:
        if isinstance(body.get(field), str):
            return body[field][:240]
    return None


def _event(r):
    body = _json(r["body"]) or {}
    return {"seq": r["seq"], "at": r["at"], "received_at": r["received_at"], "source": r["source"],
            "type": r["type"], "entity": r["entity"], "late": bool(r["late"]), "text": _event_text(body)}


def events(c, initiative, before=None, limit=RECENT, group=None):
    """A page of the log, newest first: `before` a seq (stable while new events arrive), filtered by `group`.
    Returns (rows, next_before): the seq to ask for the page after this one, None at the end."""
    where, args = ["initiative = ?"], [initiative]
    if before is not None:
        where.append("seq < ?")
        args.append(before)
    if group:
        where.append(GROUPS[group])
    rows = _rows(c, f"SELECT * FROM mission_events WHERE {' AND '.join(where)} ORDER BY seq DESC LIMIT ?",
                 *args, limit + 1)
    more = len(rows) > limit
    rows = rows[:limit]
    return [_event(r) for r in rows], rows[-1]["seq"] if more else None


# ---- the list ----

def listing(c, now):
    out = []
    for init in _rows(c, "SELECT * FROM mission_initiatives ORDER BY created_at, id"):
        revs = _revisions(c, init["id"])
        rev, manifest = current(revs), _manifest(init)
        out.append({"id": init["id"], "title": init["title"], "status": init["status"],
                    "revision": _revision(rev, manifest) if rev else None,
                    "decisions": decision_counts(c, init["id"], rev["n"], manifest) if rev else
                    {"state": "ok", "open": 0, "blocking": 0, "answered": 0},
                    "provenance": imported(manifest)})
    return {**head(c, now), "view": "list", "missions": out}


# ---- one mission ----

class Missing(Exception):
    """No such mission."""


def _base(c, initiative):
    init = _initiative(c, initiative)
    if init is None:
        raise Missing(initiative)
    revs = _revisions(c, initiative)
    return init, revs, current(revs), _manifest(init)


def _entities(c, initiative, rev):
    return _rows(c, "SELECT * FROM mission_entities WHERE initiative = ? AND revision = ?", initiative, rev)


def _task_states(c, initiative):
    return {r["task"]: r for r in _rows(c, "SELECT * FROM mission_task_states WHERE initiative = ?", initiative)}


def _proposed(c, initiative, revs, manifest):
    out = []
    for r in (r for r in revs if r["status"] == "proposed"):
        ops = _rows(c, "SELECT op, COUNT(*) AS n FROM mission_changes WHERE initiative = ? AND revision = ? "
                       "GROUP BY op", initiative, r["n"])
        out.append({**_revision(r, manifest), "changes": {o["op"]: o["n"] for o in ops},
                    "declared": r["declared"], "seen": r["seen"]})
    return out


def _stages(entities, manifest):
    gates = [e for e in entities if e["kind"] == "gate"]
    out = []
    for e in sorted((e for e in entities if e["kind"] == "stage"), key=lambda e: (_obj(e["data"]).get("n", 0), e["id"])):
        d = _obj(e["data"])
        out.append({"id": e["id"], "n": d.get("n"), "title": d.get("title"), "status": e["state"],
                    "gates": [{"id": g["id"], "criterion": _obj(g["data"]).get("criterion"), "verdict": g["state"]}
                              for g in gates if _obj(g["data"]).get("stage") == e["id"]],
                    "provenance": imported(manifest)})
    return out


def _counts(c, initiative, rev, entities, manifest):
    states = _task_states(c, initiative)
    tasks = {}
    for e in entities:
        if e["kind"] == "task":
            state = states[e["id"]]["state"] if e["id"] in states else e["state"]
            tasks[state] = tasks.get(state, 0) + 1
    gates = [e for e in entities if e["kind"] == "gate"]
    risks = [e for e in entities if e["kind"] == "risk"]
    evidence = _rows(c, "SELECT trust, COUNT(*) AS n FROM mission_evidence WHERE initiative = ? GROUP BY trust",
                     initiative)
    by_trust = {t: 0 for t in TRUST_ORDER} | {r["trust"]: r["n"] for r in evidence}
    return {
        "tasks": {"by_state": tasks, "of": sum(tasks.values()), "reported": len(states)},
        "gates": {"met": sum(1 for g in gates if g["state"] == "met"), "of": len(gates)},
        "decisions": decision_counts(c, initiative, rev, manifest),
        "evidence": {**by_trust, "of": sum(by_trust.values())},
        "risks": {"open": sum(1 for r in risks if r["state"] == "open"),
                  "mitigated": sum(1 for r in risks if r["state"] == "mitigated"), "of": len(risks)}}


def overview(c, initiative, now):
    init, revs, rev, manifest = _base(c, initiative)
    ents = _entities(c, initiative, rev["n"]) if rev else []
    recent, _ = events(c, initiative)
    return {**head(c, now), "view": "overview",
            "initiative": {"id": init["id"], "title": init["title"], "intent": init["intent"],
                           "status": init["status"], "manifest": manifest, "provenance": imported(manifest)},
            "revision": _revision(rev, manifest) if rev else None, "proposed": _proposed(c, initiative, revs, manifest),
            "stages": _stages(ents, manifest), "counts": _counts(c, initiative, rev["n"] if rev else 0, ents, manifest),
            "executions": executions(c, initiative, now), "events": recent,
            "sources": [{"name": "ledger", "state": "ok", "as_of": shown.iso(now)},
                        {"name": "manifest", "state": "ok", "repo": manifest and manifest["repo"],
                         "commit": manifest and manifest["commit"]}]}


def decisions_view(c, initiative, now, offset=0, limit=PAGE):
    """Open decisions (live), then answered ones newest first: live answers and the manifest's imported ones, paged.
    Either half can fail on its own: live unreadable is `state: unavailable`, with the imported rows still drawn."""
    init, revs, rev, manifest = _base(c, initiative)
    live = _decision_rows(initiative)
    imported_rows = _imported_decisions(c, initiative, rev["n"], manifest) if rev else []
    answered = [{**d, "when": shown.iso(d["answered_at"]), "provenance": {"trust": "owner", "source": "owner", "at": shown.iso(d["answered_at"])}}
                for d in (live[1] if live else [])]
    answered += [{**d, "when": d["answered_at"]} for d in imported_rows]
    answered.sort(key=lambda d: (d["when"] or "", d["id"]), reverse=True)
    page = answered[offset:offset + limit]
    return {**head(c, now), "view": "decisions", "state": "ok" if live is not None else "unavailable",
            "open": live[0] if live else [], "answered": page, "total": len(answered),
            "next": offset + limit if offset + limit < len(answered) else None}


def _evidence_row(r, manifest):
    data = _obj(r["data"]) or {}
    prov = imported(manifest, r["source"]) if r["trust"] == "imported" else reported(r["source"], r["observed_at"])
    return {"id": r["id"], "kind": r["kind"], "trust": r["trust"], "source": r["source"], "summary": r["summary"],
            "observed_at": r["observed_at"], "data": data, "provenance": prov}


def evidence_view(c, initiative, now, offset=0, limit=PAGE, before=None, group=None):
    """Evidence by trust, then kind (paged by `offset`), and the event history (paged by `before`, filtered by
    `group`)."""
    init, revs, rev, manifest = _base(c, initiative)
    order = "CASE trust " + " ".join(f"WHEN '{t}' THEN {i}" for i, t in enumerate(TRUST_ORDER)) + " ELSE 9 END"
    rows = _rows(c, f"SELECT * FROM mission_evidence WHERE initiative = ? ORDER BY {order}, kind, observed_at DESC, "
                    "id LIMIT ? OFFSET ?", initiative, limit + 1, offset)
    total = _rows(c, "SELECT COUNT(*) AS n FROM mission_evidence WHERE initiative = ?", initiative)[0]["n"]
    history, next_before = events(c, initiative, before, limit, group)
    return {**head(c, now), "view": "evidence",
            "evidence": {"rows": [_evidence_row(r, manifest) for r in rows[:limit]], "total": total,
                         "next": offset + limit if len(rows) > limit else None},
            "events": {"rows": history, "next_before": next_before, "group": group}}


VIEWS = ("overview", "decisions", "evidence")


# ---- the change feed ----

def tool_mark(c, initiative):
    """A short mark of the newest in-place tool event: those aren't logged, so `seq` alone can't see them."""
    rows = _rows(c, "SELECT COALESCE(MAX(tool_at), '') AS at FROM mission_executions WHERE initiative = ?", initiative)
    return format(zlib.crc32(rows[0]["at"].encode()), "x") if rows[0]["at"] else "0"


def etag(c, initiative):
    """`"<seq>"` (plan decision 9), with a mark of the newest unlogged tool event after a dot when there is one."""
    seq, mark = seq_of(c), tool_mark(c, initiative)
    return f'"{seq}"' if mark == "0" else f'"{seq}.{mark}"'


def affects(etype):
    """The views an event changes: every logged event is history (evidence) and moves the overview; a decision's
    also moves the Decisions view, and the overview's decision counts."""
    return {"overview", "decisions", "evidence"} if etype.startswith("decision.") else {"overview", "evidence"}


def changes(c, initiative, after, now):
    """What changed after `after`: the new seq, the views to read again, the new events (at most CHANGES_MAX, oldest
    first; `truncated` says there were more) and the executions as they read now. An `after` past the log's end (the
    ledger went back, or the page is from another database) says `reset`: read every view again."""
    if _initiative(c, initiative) is None:
        raise Missing(initiative)
    seq = seq_of(c)
    if after > seq:
        return {**head(c, now), "after": after, "reset": True, "views": list(VIEWS), "events": [],
                "truncated": False, "executions": executions(c, initiative, now)}
    rows = _rows(c, "SELECT * FROM mission_events WHERE initiative = ? AND seq > ? ORDER BY seq LIMIT ?",
                 initiative, after, CHANGES_MAX + 1)
    views = set().union(*(affects(r["type"]) for r in rows[:CHANGES_MAX])) if rows else set()
    truncated = len(rows) > CHANGES_MAX
    return {**head(c, now), "after": after, "reset": False, "views": [v for v in VIEWS if v in views or truncated],
            "events": [_event(r) for r in rows[:CHANGES_MAX]], "truncated": truncated,
            "executions": executions(c, initiative, now)}
