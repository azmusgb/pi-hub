"""The ledger's projections as one pure function (M1b plan decision 2): `apply(state, event)` returns the changes one
logged event makes to one initiative's tables, and `fold` puts them into the in-memory state. The live path applies
it inside the event's transaction; `rebuild` replays the log through the same function, so "rebuild = live" is a
property of this module alone. Nothing here reads a clock, the database or the network.

State is {"initiative": id, "pending": [events], "rows": {table: {key: row}}}. Rows are stored as they sit in the
tables (JSON columns as text), so live rows and replayed rows compare as they are.

`tool.running` and `tool.finished` are not logged (A35 §6.2): `apply_tool` updates an execution's in-place columns
(IN_PLACE) and nothing else, and rebuild keeps those columns from the live row (plan decision 4)."""
import json

from .contract import parse_at

# table -> its key columns
KEYS = {
    "mission_initiatives": ("id",),
    "mission_revisions": ("initiative", "n"),
    "mission_changes": ("initiative", "revision", "entity"),
    "mission_entities": ("initiative", "revision", "id"),
    "mission_evidence": ("initiative", "id"),
    "mission_executions": ("initiative", "id"),
    "mission_task_states": ("initiative", "task"),
}
IN_PLACE = ("tool_state", "tool", "tool_label", "tool_at")  # execution columns only unlogged tool events write
TOOL = frozenset({"tool.running", "tool.finished"})
# Entity kinds an import carries into a revision's plan. initiative.imported and evidence.imported are folded too, into
# the initiative and evidence tables.
ENTITY = {"stage.imported": "stage", "gate.imported": "gate", "workstream.imported": "workstream",
          "task.imported": "task", "dependency.imported": "dependency", "decision.imported": "decision",
          "risk.imported": "risk", "experiment.imported": "experiment"}
# A34's imported entity states before any report: tasks carry their own, the rest start here.
FIRST_STATE = {"gate": "open", "dependency": "open", "decision": "answered"}
SESSION_STATE = {"session.attached": "unknown", "turn.started": "working", "turn.finished": "turn_finished",
                 "waiting.owner": "waiting_owner", "subagent.started": "working", "session.ended": "ended"}
SESSION_FIELDS = ("model", "effort", "branch", "remote")
ATTACH_FIELDS = ("workstream", "lineage", "start_source")
LEVEL = {"claude": "observable", "localai": "full"}
TASK_STATE = {"task.started": "active", "task.done": "done"}


def empty(initiative):
    return {"initiative": initiative, "pending": [], "rows": {t: {} for t in KEYS}}


def key_of(table, row):
    return tuple(row[c] for c in KEYS[table])


def json_text(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def is_import(etype):
    return etype.endswith(".imported") and etype != "plan.imported"


def execution_id(source, event):
    """The execution an event is about, or None: a Claude session by its session_id, a Local AI run by its id."""
    body = event.get("body") or {}
    if source == "claude" and event["type"] != "gap":
        return body.get("session_id")
    if source == "localai" and event["type"].startswith("execution."):
        return body.get("execution_id")
    return None


def entity_of(event):
    """What an event is about, for the log's `entity` column."""
    body = event.get("body") or {}
    if event["type"] == "dependency.imported":
        return f"{body['from']}>{body['to']}>{body['kind']}"
    return (body.get("id") or body.get("task") or body.get("session_id") or body.get("execution_id")
            or event["initiative"])


def last_event_at(row):
    """When an execution last reported, logged or in place: the later of its two times."""
    times = [t for t in (parse_at(row.get("logged_at")), parse_at(row.get("tool_at"))) if t]
    return max(times) if times else None


def fold(state, changes):
    for change in changes:
        if change[0] == "put":
            _, table, row = change
            state["rows"][table][key_of(table, row)] = row
        elif change[0] == "pending":
            state["pending"].append(change[1])
        else:  # "clear_pending"
            state["pending"] = []
    return state


def apply(state, event):
    """The changes one logged event makes. `event` carries seq, event_id, at, source, initiative, type, body (a
    dict) and `behind`: true when it was older than its execution's last report on arrival, so it changes no
    execution field (plan decision 5)."""
    etype = event["type"]
    if is_import(etype):
        return [("pending", event)]
    if etype == "plan.imported":
        return _revision(state, event)
    changes = []
    if etype in TASK_STATE:
        changes += _task(state, event)
    if etype == "evidence.reported":
        changes += _reported(event)
    exec_id = execution_id(event["source"], event)
    if exec_id and not event["behind"]:
        changes += _execution(state, event, exec_id)
    return changes


def apply_tool(row, event, behind):
    """An execution row with a tool event's in-place columns, or None when it changes nothing: no such execution yet
    (a row an unlogged event made could never be rebuilt), or the event is behind."""
    if row is None or behind:
        return None
    body = event["body"]
    return {**row, "tool_state": "running" if event["type"] == "tool.running" else "finished", "tool": body["tool"],
            "tool_label": body["label"], "tool_at": event["at"]}


def _execution(state, event, exec_id):
    key = (event["initiative"], exec_id)
    old = state["rows"]["mission_executions"].get(key)
    row = dict(old) if old else {
        "initiative": event["initiative"], "id": exec_id, "source": event["source"],
        "level": LEVEL[event["source"]], "title": None, "state": "unknown", "started_at": event["at"],
        "ended_at": None, "logged_at": event["at"], "data": "{}", "seq": event["seq"],
        **dict.fromkeys(IN_PLACE)}
    data = json.loads(row["data"])
    body, etype = event["body"], event["type"]
    new_state = SESSION_STATE.get(etype)
    if event["source"] == "claude":
        data.update({f: body[f] for f in SESSION_FIELDS if f in body})
        if etype == "session.attached":
            row["title"] = body["cwd_name"]
            data.update({f: body[f] for f in ATTACH_FIELDS if f in body})
    else:
        if etype == "execution.started":
            row["title"] = body["title"]
        new_state = body.get("state", "running")
    task = body.get("task")
    if task and task not in data.setdefault("tasks", []):
        data["tasks"].append(task)
    if new_state:
        row["state"] = new_state
        row["ended_at"] = event["at"] if new_state in ("ended", "done", "failed", "cancelled") else None
    row.update(logged_at=event["at"], data=json_text(data), seq=event["seq"])
    return [("put", "mission_executions", row)]


def _task(state, event):
    """A reported task state. A report older than the one stored changes nothing."""
    body = event["body"]
    key = (event["initiative"], body["task"])
    old = state["rows"]["mission_task_states"].get(key)
    if old and parse_at(old["at"]) > parse_at(event["at"]):
        return []
    return [("put", "mission_task_states", {
        "initiative": event["initiative"], "task": body["task"], "state": TASK_STATE[event["type"]],
        "at": event["at"], "source": event["source"], "execution": execution_id(event["source"], event),
        "summary": body.get("summary"), "seq": event["seq"]})]


def _reported(event):
    """A source's own word about a commit, PR, test or measurement: trust `reported`, never verified (§8)."""
    body = event["body"]
    data = {k: body[k] for k in ("repo", "sha", "pr", "links") if k in body}
    data["execution"] = execution_id(event["source"], event)
    return [("put", "mission_evidence", {
        "initiative": event["initiative"], "id": "reported:" + event["event_id"], "kind": body["kind"],
        "trust": "reported", "source": event["source"], "summary": body.get("summary"), "data": json_text(data),
        "observed_at": event["at"], "revision": None, "seq": event["seq"]})]


def _revision(state, event):
    """plan.imported: the pending import of this manifest commit becomes revision n, `proposed`, with its change-set
    against revision n-1 (§8). The import starts at the last initiative.imported naming the same manifest; with none,
    nothing changes and the pending events wait."""
    manifest = event["body"]["manifest"]
    pending = state["pending"]
    starts = [i for i, e in enumerate(pending)
              if e["type"] == "initiative.imported" and e["body"]["manifest"] == manifest]
    if not starts:
        return []
    batch = pending[starts[-1]:]
    initiative = event["initiative"]
    revisions = state["rows"]["mission_revisions"]
    n = max((k[1] for k in revisions), default=0) + 1
    entities = _entities(initiative, n, batch)
    previous = {r["id"]: r for (_, rev, _), r in state["rows"]["mission_entities"].items() if rev == n - 1}
    changes = _changes(initiative, n, previous, entities)
    out = [("put", "mission_entities", r) for r in entities.values()]
    out += [("put", "mission_changes", c) for c in changes]
    out += [("put", "mission_evidence", r) for r in _imported_evidence(initiative, n, batch)]
    if initiative not in {k[0] for k in state["rows"]["mission_initiatives"]}:
        out.append(("put", "mission_initiatives", _initiative(batch[0], event)))
    out.append(("put", "mission_revisions", {
        "initiative": initiative, "n": n, "at": event["at"], "proposer": event["source"], "status": "proposed",
        "manifest": json_text(manifest), "summary": f"Imported from {manifest['repo']}@{manifest['commit'][:7]}",
        "requires_approval": int(_needs_approval(changes)), "declared": event["body"]["entities"],
        "seen": len(batch), "seq": event["seq"]}))
    out.append(("clear_pending",))
    return out


def _entities(initiative, n, batch):
    out = {}
    for e in batch:
        kind = ENTITY.get(e["type"])
        if kind is None:
            continue
        body = e["body"]
        eid = entity_of(e)
        state = body.get("state", "planned") if kind == "task" else body.get("status", FIRST_STATE.get(kind, "planned"))
        out[eid] = {"initiative": initiative, "revision": n, "id": eid, "kind": kind, "data": json_text(body),
                    "state": state}
    return out


def _changes(initiative, n, previous, current):
    out = []
    for eid in sorted(previous.keys() | current.keys()):
        before, after = previous.get(eid), current.get(eid)
        if before and after and before["data"] == after["data"] and before["state"] == after["state"]:
            continue
        op = "add" if before is None else "remove" if after is None else "change"
        out.append({"initiative": initiative, "revision": n, "entity": eid, "kind": (after or before)["kind"],
                    "op": op, "before": before["data"] if before else None, "after": after["data"] if after else None})
    return out


def _needs_approval(changes):
    """Derived by the server (§8): a stage or gate added or removed, or a gate's criterion changed."""
    for c in changes:
        if c["kind"] in ("stage", "gate") and c["op"] != "change":
            return True
        if c["kind"] == "gate" and json.loads(c["before"]).get("criterion") != json.loads(c["after"]).get("criterion"):
            return True
    return False


def _imported_evidence(initiative, n, batch):
    for e in batch:
        if e["type"] != "evidence.imported":
            continue
        body = e["body"]
        data = {k: body[k] for k in ("source", "pr", "links") if k in body}
        yield {"initiative": initiative, "id": body["id"], "kind": body["kind"], "trust": "imported",
               "source": e["source"], "summary": body["summary"], "data": json_text(data), "observed_at": e["at"],
               "revision": n, "seq": e["seq"]}


def _initiative(first, event):
    body = first["body"]
    return {"id": event["initiative"], "title": body["title"], "intent": body["intent"], "status": body["status"],
            "manifest": json_text(body["manifest"]), "spec": json_text(body["spec"]) if "spec" in body else None,
            "created_at": event["at"], "seq": event["seq"]}
