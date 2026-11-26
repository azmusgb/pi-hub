"""The mission ledger (A35 §6.2, §7.4, §8, §17.2-17.3; M1b plan step H2): POST /api/missions/events/{source}, the
append-only log, its projections and change-sets, and `python -m hub.missions rebuild`.

The A34 events are home-mcp's importer output for docs/missions/a34.json at e9efd31, made with
`importer.build(manifest, ref, at="2026-11-25T18:00:00+00:00")` from tools/home-mcp (what `home-mission import
--dry-run` validates and counts: 72 events). In-memory clock, no sleeps, threads or network."""
import copy
import hashlib
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hub import app as hubapp, auth, db, records, releases, sources
from hub.missions import __main__ as cli, keys, log, store

client = TestClient(hubapp.app)
A34 = json.loads((Path(__file__).parent / "fixtures" / "missions" / "a34-import-events.json").read_text())
KEY = {name: f"k-{name}-" + "7" * 40 for name in keys.KEYS.values()}
SESSION = "5e55a0b1-0000-4000-8000-000000000001"
T0 = 1_764_093_600  # 2026-11-25T18:00:00Z
clock = [T0]  # the ledger's clock (log.clock), moved by the tests
_ids = iter(range(1, 10**6))


def at(seconds):
    """ISO time `seconds` after T0."""
    return datetime.fromtimestamp(T0 + seconds, timezone.utc).isoformat()


def ev(etype, body, t=0, initiative="a34", **extra):
    return {"event_id": f"00000000-0000-4000-8000-{next(_ids):012d}", "type": etype, "at": at(t),
            "initiative": initiative, "body": body, **extra}


def session(etype, t=0, sid=SESSION, **body):
    return ev(etype, {"session_id": sid, **body}, t)


def late(event):
    """The event as the drainer marks one that sat in the spool."""
    return {**event, "late": True}


def post(source, events, key=None, version="1", raw=None):
    headers = {"X-Hub-Deploy-Key": KEY[keys.KEYS[source]] if key is None else key}
    if version is not None:
        headers["X-Mission-Contract"] = version
    content = raw if raw is not None else json.dumps(events)
    return client.post(f"/api/missions/events/{source}", content=content,
                       headers={**headers, "Content-Type": "application/json"})


def tables():
    store.ready()
    c = db.conn()
    out = {t: [dict(r) for r in c.execute(f"SELECT * FROM {t} ORDER BY 1, 2")]
           for t in ("mission_events", *store.project.KEYS)}
    return out


def logged():
    store.ready()
    return [dict(r) for r in db.conn().execute("SELECT * FROM mission_events ORDER BY seq")]


def execution(sid=SESSION):
    return dict(db.conn().execute("SELECT * FROM mission_executions WHERE id = ?", (sid,)).fetchone())


def import_a34(events=A34):
    """The importer's two batches, as `home-mission import` sends them, a minute apart (the second waits out the
    per-source limit: see test_rate_limit…)."""
    for i in range(0, len(events), 50):
        clock[0] += 61
        r = post("importer", events[i:i + 50])
        assert r.status_code == 200, r.text


def recommit(events, commit, edit=lambda e: None):
    """The A34 import as a later manifest commit would make it: new ids and manifest ref, each event put through
    `edit` (which may return False to drop it)."""
    out = []
    for e in copy.deepcopy(events):
        e["event_id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, commit + e["event_id"]))
        if "manifest" in e["body"]:
            e["body"]["manifest"]["commit"] = commit
        if edit(e) is not False:
            out.append(e)
    out[-1]["body"]["entities"] = len(out) - 1
    return out


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    for name, key in KEY.items():
        (tmp_path / f"{name}.sha256").write_text(hashlib.sha256(key.encode()).hexdigest() + "\n")
    monkeypatch.setattr(releases, "KEY_DIR", str(tmp_path))
    clock[0] = T0
    monkeypatch.setattr(log, "clock", lambda: clock[0])
    monkeypatch.setattr(log, "LIMIT", log.Limiter(60))
    monkeypatch.setattr(log, "REFUSALS", log.Refusals())
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    monkeypatch.setattr(records, "all", lambda: {})
    monkeypatch.setattr(auth, "session", lambda token, gate=False: None)


# ---- idempotency ----

def test_duplicate_event_id_is_200_and_changes_nothing():
    first = session("session.attached", 0, cwd_name="pi-hub")
    r = post("claude", [first])
    assert r.status_code == 200 and r.json() == {"accepted": 1, "duplicates": 0, "seq_max": 1}
    before = tables()
    again = post("claude", [first, {**first, "body": {**first["body"], "cwd_name": "other"}}])
    assert again.status_code == 200 and again.json() == {"accepted": 0, "duplicates": 2, "seq_max": 1}
    assert tables() == before
    twice = session("turn.started", 5, prompt_id=str(uuid.uuid4()))
    r = post("claude", [twice, twice])  # the same id twice in one batch: once
    assert r.json() == {"accepted": 1, "duplicates": 1, "seq_max": 2}


# ---- executions ----

def test_tool_events_update_the_execution_in_place_and_are_not_logged():
    post("claude", [session("session.attached", 0, cwd_name="pi-hub"), session("turn.started", 1, prompt_id=SESSION)])
    r = post("claude", [session("tool.running", 2, tool_use_id="t1", tool="Bash", label="Running tests")])
    assert r.status_code == 200 and r.json()["accepted"] == 1
    assert [e["type"] for e in logged()] == ["session.attached", "turn.started"]
    row = execution()
    assert (row["tool_state"], row["tool"], row["tool_label"], row["tool_at"]) == ("running", "Bash", "Running tests",
                                                                                  at(2))
    assert (row["state"], row["logged_at"]) == ("working", at(1))  # the logged columns are the log's alone
    post("claude", [session("tool.finished", 9, tool_use_id="t1", tool="Bash", label="Running tests", failed=False)])
    assert (execution()["tool_state"], execution()["tool_at"]) == ("finished", at(9))
    # a tool event for a session that never attached makes no row: nothing logged could rebuild it
    other = "5e55a0b1-0000-4000-8000-000000000002"
    post("claude", [session("tool.running", 3, sid=other, tool_use_id="t", tool="Read", label="Reading")])
    assert db.conn().execute("SELECT COUNT(*) FROM mission_executions WHERE id = ?", (other,)).fetchone()[0] == 0


def test_late_event_never_moves_an_execution_back():
    post("claude", [session("session.attached", 0, cwd_name="pi-hub"), session("turn.finished", 20)])
    r = post("claude", [late(session("turn.started", 10, prompt_id=SESSION))])
    assert r.status_code == 200
    row = execution()
    assert (row["state"], row["logged_at"]) == ("turn_finished", at(20))
    last = logged()[-1]
    assert (last["type"], last["late"], last["behind"]) == ("turn.started", 1, 1)  # logged, changes nothing
    post("claude", [session("tool.running", 15, tool_use_id="t", tool="Bash", label="Old")])
    assert execution()["tool_at"] is None
    post("claude", [session("tool.running", 30, tool_use_id="t", tool="Bash", label="New")])
    post("claude", [session("waiting.owner", 25, tool="AskUserQuestion", label="Asks")])  # older than the tool event
    row = execution()
    assert (row["state"], row["tool_label"], logged()[-1]["behind"]) == ("turn_finished", "New", 1)
    # a spooled event that is still the newest does move it: `late` alone is not `behind`
    post("claude", [late(session("turn.started", 40, prompt_id=SESSION))])
    assert execution()["state"] == "working" and logged()[-1]["behind"] == 0


def test_source_cannot_write_another_sources_types_or_executions():
    assert post("claude", [session("session.attached", 0, cwd_name="pi-hub")]).status_code == 200
    r = post("importer", [session("session.ended", 1)])
    assert r.status_code == 400 and r.json()["error"] == "unknown_type"
    r = post("claude", [ev("stage.imported", {"id": "a34:stage:p9", "n": 9, "title": "Not mine"})])
    assert r.status_code == 400 and r.json()["error"] == "unknown_type"
    r = post("claude", [session("session.ended", 1)], key=KEY["mission-importer"])  # another source's key
    assert r.status_code == 401 and r.json()["error"] == "bad_key"
    r = client.post("/api/missions/events/claude", json=[session("session.ended", 1)],
                    headers={"X-Mission-Contract": "1", "Origin": "https://evil.example"})  # no key at all
    assert r.status_code == 401 and r.json()["error"] == "bad_key"
    before = tables()
    batch = [ev("evidence.reported", {"kind": "test", "repo": "azmusgb/LocalAI"}, 2),
             ev("execution.state", {"execution_id": SESSION, "state": "cancelled"}, 3)]
    r = post("localai", batch)
    assert r.status_code == 403 and r.json()["error"] == "not_your_execution"
    assert tables() == before  # the whole batch, its good first event included
    assert execution()["state"] == "unknown" and execution()["source"] == "claude"
    assert client.post("/api/missions/events/owner", json=[], headers={"X-Mission-Contract": "1"}).status_code == 404


# ---- size, names, grammar ----

def test_body_over_4kb_and_never_accepted_fields_are_refused():
    big = session("session.attached", 0, cwd_name="pi-hub", branch="b" * 4100)
    r = post("claude", [big])
    assert r.status_code == 413 and r.json()["error"] == "too_large"
    for event in (session("turn.started", 1, prompt_id=SESSION, prompt="the owner's words"),
                  {**session("turn.finished", 1), "output": "a reply"},
                  ev("evidence.reported", {"session_id": SESSION, "kind": "pr", "repo": "azmusgb/pi-hub",
                                           "links": [{"entity": "a34:task:x", "role": "supports",
                                                      "tool_input": "rm -rf"}]}, 1)):
        r = post("claude", [event])
        assert r.status_code == 400 and r.json()["error"] == "unknown_field", r.text
        assert "never accepted" in r.json()["detail"]
    assert post("claude", [], raw=b"x" * (2 * 50 * 4096 + 1)).status_code == 413
    assert logged() == []


def test_unknown_field_and_bad_grammar_name_the_field_never_the_value():
    secret = "SECRET-VALUE-4711"
    cases = [
        (session("turn.finished", 0, colour=secret), "unknown_field", "event 0: body.colour"),
        ({**session("turn.finished", 0), "seq": 7}, "unknown_field", "event 0.seq"),
        (session("turn.finished", 0, effort=secret), "bad_field", "event 0: body.effort"),
        ({**session("turn.finished", 0), "at": secret}, "bad_field", "event 0.at"),
        ({**session("turn.finished", 0), "at": "2026-11-25T18:00:00"}, "bad_field", "event 0.at"),  # no offset
        (session("task.done", 0, task="a35:task:other-initiative"), "bad_field", "event 0: body.task"),
        (session("turn.started", 0), "bad_field", "event 0: body.prompt_id: missing"),
        (ev("turn.finished", {}), "bad_field", "event 0: body.session_id: missing"),
    ]
    for event, code, where in cases:
        r = post("claude", [event])
        assert (r.status_code, r.json()["error"]) == (400, code), (where, r.text)
        assert r.json()["detail"].startswith(where), r.json()["detail"]
        assert secret not in r.text
    assert post("claude", [], raw=b"{not json").json()["error"] == "bad_json"
    for batch in ([], {"event_id": SESSION}, [session("turn.finished", 0)] * 51, [42]):
        r = post("claude", batch)
        assert (r.status_code, r.json()["error"]) == (400, "bad_batch"), batch
    assert logged() == []


def test_deeply_nested_json_is_refused_as_the_contract_says_never_a_500():
    r = post("claude", [], raw=("[" * 199000 + "]" * 199000).encode())  # past the parser's stack
    assert (r.status_code, r.json()["error"]) == (400, "bad_json")
    x = []
    for _ in range(1500):  # parses, but would overflow a recursive walk
        x = [x]
    deep = session("turn.finished", 0, x=x)
    assert len(json.dumps(deep)) < 4096
    r = post("claude", [deep])
    assert (r.status_code, r.json()["error"]) == (400, "bad_field")
    assert r.json()["detail"] == "event 0: nested deeper than 32"
    for _ in range(8):
        post("claude", [deep])
    assert [i["id"] for i in needs_items()] == ["pi:missions:claude:refused"]  # keyed refusals, counted
    assert logged() == []


def test_wrong_or_missing_contract_header_is_409():
    event = session("session.attached", 0, cwd_name="pi-hub")
    for version in (None, "2", "0", ""):
        r = post("claude", [event], version=version)
        assert (r.status_code, r.json()["error"]) == (409, "version"), version
    assert logged() == []
    assert post("claude", [event], version="1").status_code == 200


# ---- rate limit and refusals ----

def needs_items():
    return [i for i in client.get("/api/needs").json()["items"] if i["id"].startswith("pi:missions:")]


def test_rate_limit_429_with_retry_after_and_refusals_raise_one_needs_item():
    events = [session("turn.finished", n) for n in range(50)]
    assert post("claude", events).json()["accepted"] == 50
    clock[0] += 10
    r = post("claude", [session("turn.finished", 60 + n) for n in range(11)])
    assert r.status_code == 429 and r.json()["error"] == "rate_limited" and r.headers["Retry-After"] == "50"
    assert post("claude", events).json() == {"accepted": 0, "duplicates": 50, "seq_max": 50}  # dups are free
    assert post("claude", [session("turn.finished", 70 + n) for n in range(10)]).json()["accepted"] == 10
    clock[0] = T0 + 61
    assert post("claude", [session("turn.finished", 90 + n) for n in range(11)]).status_code == 200
    # refusals: the 429 above was the first; nine more raise one item, and more keep it one
    assert needs_items() == []
    for _ in range(8):
        post("claude", [], raw=b"{")
    assert needs_items() == []
    post("claude", [], raw=b"{")
    [item] = needs_items()
    assert item["id"] == "pi:missions:claude:refused" and item["tone"] == "attention"
    assert "bad_json" in item["detail"] and "Claude Code sessions" in item["detail"]
    for _ in range(5):
        post("claude", [], raw=b"{")
    assert len(needs_items()) == 1
    data = client.get("/api/needs").json()
    assert data["count"] == len(data["items"])
    last = clock[0]
    clock[0] = last + 3599
    assert len(needs_items()) == 1
    clock[0] = last + 3600
    assert needs_items() == []  # an hour quiet clears it
    for _ in range(9):
        post("importer", [], raw=b"{")  # another source counts on its own
    assert needs_items() == []


def test_bad_key_refusals_never_raise_the_needs_item():
    event = [session("turn.finished", 0)]
    for key in ("wrong", KEY["mission-importer"], ""):
        for _ in range(10):
            assert post("claude", event, key=key).status_code == 401
    for _ in range(10):  # no key at all, from another site
        r = client.post("/api/missions/events/claude", json=event,
                        headers={"X-Mission-Contract": "1", "Origin": "https://evil.example"})
        assert r.status_code == 401
    assert needs_items() == []
    for _ in range(10):  # the same number with the source's own key does raise it
        post("claude", [], raw=b"{")
    assert [i["id"] for i in needs_items()] == ["pi:missions:claude:refused"]


# ---- revisions and rebuild ----

def revisions():
    return [dict(r) for r in db.conn().execute("SELECT * FROM mission_revisions ORDER BY n")]


def changes(n):
    return {(r["entity"], r["op"]) for r in db.conn().execute(
        "SELECT entity, op FROM mission_changes WHERE revision = ?", (n,))}


def test_plan_imported_makes_revision_n_proposed_with_its_changes():
    import_a34(A34[:-1])
    assert revisions() == []  # the import waits for its plan.imported
    import_a34(A34[-1:])
    [rev] = revisions()
    assert (rev["n"], rev["status"], rev["proposer"], rev["requires_approval"]) == (1, "proposed", "importer", 1)
    assert (rev["declared"], rev["seen"]) == (71, 71)
    assert rev["summary"] == "Imported from azmusgb/pi-hub@e9efd31"
    assert len(changes(1)) == 60 and {op for _, op in changes(1)} == {"add"}
    init = dict(db.conn().execute("SELECT * FROM mission_initiatives").fetchone())
    assert init["id"] == "a34" and init["title"].startswith("A34") and json.loads(init["manifest"])["commit"][:7] == \
        "e9efd31"
    trust = {r[0] for r in db.conn().execute("SELECT trust FROM mission_evidence")}
    assert trust == {"imported"} and db.conn().execute("SELECT COUNT(*) FROM mission_evidence").fetchone()[0] == 10

    def edit(e):
        b = e["body"]
        if b.get("id") == "a34:task:p0-cheap-hashing":
            b["title"] = "Cheap hashing in tests"
        if b.get("id") == "a34:risk:pi-spof":
            return False
        if b.get("id") == "a34:gate:p0-done":
            b["criterion"] = "three releases in a row under 600 s"
    import_a34(recommit(A34, "a" * 40, edit))
    rev = revisions()[1]
    assert (rev["n"], rev["status"], rev["requires_approval"]) == (2, "proposed", 1)  # a gate's criterion changed
    assert changes(2) == {("a34:task:p0-cheap-hashing", "change"), ("a34:risk:pi-spof", "remove"),
                          ("a34:gate:p0-done", "change")}
    before = json.loads(db.conn().execute("SELECT before FROM mission_changes WHERE revision = 2 AND entity = ?",
                                          ("a34:task:p0-cheap-hashing",)).fetchone()[0])
    assert before["title"] == "Cheap hashing in tests (plan step 1)"

    def retitle(e):
        edit(e)
        if e["body"].get("id") == "a34:task:p0-cheap-hashing":
            e["body"]["title"] = "Cheap hashing"
        return e["body"].get("id") != "a34:risk:pi-spof"
    import_a34(recommit(A34, "b" * 40, retitle))
    rev = revisions()[2]
    assert (rev["n"], rev["requires_approval"]) == (3, 0)  # only a task's title
    assert changes(3) == {("a34:task:p0-cheap-hashing", "change")}
    # a plan.imported whose manifest no pending import names makes nothing
    orphan = recommit(A34[-1:], "c" * 40)
    assert post("importer", orphan).status_code == 200 and len(revisions()) == 3


def test_rebuild_equals_live_after_a34_import_session_events_duplicates_and_late(capsys):
    import_a34()
    import_a34(A34[:5])  # a re-run: duplicates only
    sid = SESSION
    events = [
        session("session.attached", 100, cwd_name="pi-hub", workstream="a34:workstream:p0-tests", model="claude-x",
                effort="high", branch="feat/x", remote="azmusgb/pi-hub"),
        session("turn.started", 110, prompt_id=sid),
        session("tool.running", 111, tool_use_id="t1", tool="Bash", label="Running tests"),
        session("task.started", 112, task="a34:task:p0-cheap-hashing"),
        session("subagent.started", 113, agent_id="ag1", agent_type="reviewer", label="Review"),
        session("subagent.finished", 114, agent_id="ag1", agent_type="reviewer", tokens=1200),
        session("evidence.reported", 115, kind="commit", repo="azmusgb/pi-hub", sha="1874c5f",
                links=[{"entity": "a34:task:p0-cheap-hashing", "role": "supports"}]),
        session("task.done", 116, task="a34:task:p0-cheap-hashing", summary="done"),
        session("tool.finished", 117, tool_use_id="t1", tool="Bash", label="Running tests", duration_ms=6000),
        session("turn.finished", 120),
        late(session("turn.started", 105, prompt_id=sid)),  # late: logged, changes nothing
        late(session("task.started", 106, task="a34:task:p0-cheap-hashing")),  # older than its done
        ev("gap", {"dropped": 3}, 121),
    ]
    clock[0] += 61
    assert post("claude", events).status_code == 200
    assert post("claude", events[:3]).json()["duplicates"] == 2  # the tool event isn't logged, so it isn't a dup
    clock[0] += 61
    assert post("localai", [ev("execution.started", {"execution_id": "run-1", "title": "Contract tests"}, 130),
                            ev("execution.finished", {"execution_id": "run-1", "state": "done"}, 140)]).status_code \
        == 200
    import_a34(recommit(A34, "d" * 40, lambda e: e["body"].get("id") != "a34:risk:pi-spof"))
    live = tables()
    assert execution()["tool_state"] == "finished"
    task = db.conn().execute("SELECT state FROM mission_task_states").fetchone()[0]
    assert task == "done"

    replayed = store.replay(db.conn(), "a34")
    assert store.differences(replayed, store.load_rows(db.conn(), "a34")) == []
    assert cli.main(["rebuild", "a34", "--check"]) == 0
    assert tables() == live

    # a corrupted projection: --check names it and writes nothing; rebuild puts it back
    db.run("UPDATE mission_entities SET state = 'bogus' WHERE id = 'a34:task:p0-cheap-hashing' AND revision = 1")
    db.run("DELETE FROM mission_evidence WHERE trust = 'reported'")
    capsys.readouterr()
    assert cli.main(["rebuild", "a34", "--check"]) == 1
    out = capsys.readouterr().out
    assert "mission_entities a34/1/a34:task:p0-cheap-hashing: differs in state" in out
    assert "mission_evidence a34/reported:" in out and "missing from the live table" in out
    assert cli.main(["rebuild", "a34"]) == 0
    assert tables() == live  # in-place tool columns kept
    assert cli.main(["rebuild", "a34", "--check"]) == 0
    assert cli.main(["rebuild", "nope", "--check"]) == 2
    assert cli.main(["rebuild", "Not a slug"]) == 2
