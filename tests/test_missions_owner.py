"""The owner's side of Mission Control (A35 §6.2 "Owner writes", §7.4, §7.5, §17.1, §17.9; M1b plan step H3): the
owner route, the reads, `shown()` and the decisions mirror. Built on test_missions_ledger's A34 import and its clock.
In-memory clock, no sleeps, threads or network."""
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hub import app as hubapp, auth, db, decisions, releases
from hub.missions import __main__ as cli, log, mirror, project, shown, store, views
from test_missions_ledger import (A34, SESSION, T0, at, clock, ev, fresh, import_a34, post, session,  # noqa: F401
                                  tables)

client = TestClient(hubapp.app)
TOKENS = {"owner-token": "owner", "household-token": "household"}
SAME = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
FRESH_KEYS = {"live", "shown", "since", "fresh", "stale"}  # freshness fields an imported row must never carry


@pytest.fixture(autouse=True)
def signed_in(fresh, monkeypatch):  # noqa: F811
    monkeypatch.setattr(auth, "session", lambda token, gate=False: {"role": TOKENS[token], "device": "phone"}
                        if token in TOKENS else None)
    mac = "k-mac-" + "2" * 40
    (Path(releases.KEY_DIR) / "mac.sha256").write_text(hashlib.sha256(mac.encode()).hexdigest() + "\n")


MAC = {"X-Hub-Deploy-Key": "k-mac-" + "2" * 40}


def get(path, token="owner-token", headers=None):
    return client.get(path, cookies={auth.COOKIE: token} if token else None, headers=headers or {})


def tap(initiative, body, token="owner-token", headers=SAME, raw=None):
    return client.post(f"/api/missions/{initiative}/owner", cookies={auth.COOKIE: token} if token else None,
                       headers=headers, content=raw if raw is not None else json.dumps(body))


def accept(n=1, **kw):
    return tap("a34", {"verb": "revision.accept", "revision": n}, **kw)


def ledger_log():
    store.ready()
    return [dict(r) for r in db.conn().execute("SELECT * FROM mission_events ORDER BY seq")]


def kinds(source):
    return [r["type"] for r in ledger_log() if r["source"] == source]


def projections():
    return {k: v for k, v in tables().items() if k != "mission_events"}


def walk(value):
    """Every dict in a JSON value."""
    if isinstance(value, dict):
        yield value
        for v in value.values():
            yield from walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from walk(v)


# ---- the owner route ----

def test_accept_is_conditional_and_a_double_tap_changes_nothing():
    import_a34()
    r = accept()
    assert r.status_code == 200 and r.json()["changed"] is True and r.json()["revision"] == {"n": 1, "status":
                                                                                              "accepted"}
    assert [x["status"] for x in db.conn().execute("SELECT status FROM mission_revisions")] == ["accepted"]
    assert kinds("owner") == ["revision.accepted"]
    once = (tables(), len(ledger_log()))
    again = accept()
    assert again.status_code == 200 and again.json() == {"ok": True, "changed": False,
                                                         "revision": {"n": 1, "status": "accepted"}}
    assert (tables(), len(ledger_log())) == once  # nothing changed: no event, no row
    # a rejection of what is already accepted, and an accept of a revision that isn't there
    r = tap("a34", {"verb": "revision.reject", "revision": 1})
    assert r.status_code == 409 and r.json()["error"] == "conflict" and r.json()["revision"]["status"] == "accepted"
    assert accept(9).status_code == 404
    assert tap("nope", {"verb": "revision.accept", "revision": 1}).status_code == 404
    # a later manifest commit is its own revision; rejecting it leaves revision 1 the one drawn
    import_a34([e for e in _recommit("b" * 40)])
    assert tap("a34", {"verb": "revision.reject", "revision": 2}).json()["revision"]["status"] == "rejected"
    assert accept(2).status_code == 409  # rejected stays rejected
    assert views.current(views._revisions(db.conn(), "a34"))["n"] == 1
    assert cli.main(["rebuild", "a34", "--check"]) == 0  # owner events are replayed to the same tables
    lines = [r["result"] for r in db.rows("SELECT result FROM action_log WHERE action = 'mission:a34'")]
    assert lines == ["revision.accept recorded", "revision.accept no change", "revision.reject recorded"]


def _recommit(commit):
    from test_missions_ledger import recommit
    return recommit(A34, commit, lambda e: e["body"].get("id") != "a34:risk:pi-spof")


def test_initiative_status_is_conditional_on_the_status_the_owner_saw():
    import_a34()
    r = tap("a34", {"verb": "initiative.status", "status": "paused", "from": "active"})
    assert r.status_code == 200 and r.json()["changed"] is True
    assert db.conn().execute("SELECT status FROM mission_initiatives").fetchone()[0] == "paused"
    again = tap("a34", {"verb": "initiative.status", "status": "paused", "from": "active"})
    assert again.json() == {"ok": True, "changed": False, "status": "paused"}
    stale = tap("a34", {"verb": "initiative.status", "status": "done", "from": "active"})
    assert stale.status_code == 409 and stale.json()["current"] == "paused"
    for bad in ({"status": "bogus", "from": "paused"}, {"status": "done"}, {"from": "paused"}):
        assert tap("a34", {"verb": "initiative.status", **bad}).status_code == 400
    assert kinds("owner") == ["initiative.status"]
    assert cli.main(["rebuild", "a34", "--check"]) == 0


def test_owner_route_needs_owner_and_same_origin():
    import_a34()
    before = (tables(), len(ledger_log()))
    assert accept(token=None).status_code == 401
    assert accept(token="household-token").status_code == 401
    assert accept(token="stranger").status_code == 401
    # the page's Origin is there, but Sec-Fetch-Site is missing: this route refuses (A33's answer route would not)
    r = accept(headers={"Origin": "http://testserver"})
    assert r.status_code == 403 and "own page" in r.json()["detail"]
    for site in ("cross-site", "same-site", "none", ""):
        assert accept(headers={"Origin": "http://testserver", "Sec-Fetch-Site": site}).status_code == 403
    assert accept(headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "same-origin"}).status_code == 403
    assert (tables(), len(ledger_log())) == before
    # a source's key is not an owner session
    assert accept(token=None, headers={**SAME, "X-Hub-Deploy-Key": "k-mission-claude-" + "7" * 40}).status_code == 401
    assert accept().status_code == 200


def test_owner_route_refuses_m3_verbs():
    import_a34()
    before = (tables(), len(ledger_log()))
    for verb in ("gate.verdict", "gate.verdict.met", "evidence.add", "command", "command.issue"):
        r = tap("a34", {"verb": verb, "gate": "a34:gate:p0-done", "verdict": "met"})
        assert r.status_code == 400 and r.json()["error"] == "not_yet", verb
    assert tap("a34", {"verb": "revision.delete", "revision": 1}).json()["error"] == "unknown_verb"
    for body in ({}, {"verb": 7}, {"verb": "revision.accept"}, {"verb": "revision.accept", "revision": "1"},
                 {"verb": "revision.accept", "revision": True}, {"verb": "revision.accept", "revision": 0}, [1]):
        assert tap("a34", body).status_code == 400, body
    assert tap("a34", None, raw="{").status_code == 400
    assert tap("a34", None, raw=json.dumps({"verb": "revision.accept", "revision": 1, "pad": "x" * 2000})
               ).status_code == 413
    assert (tables(), len(ledger_log())) == before


def test_owner_write_that_cannot_be_stored_is_503_and_changes_nothing(monkeypatch):
    import_a34()
    before = tables()
    real = store.write

    def broken(c, changes):
        real(c, changes[:0])
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(store, "write", broken)
    r = accept()
    assert r.status_code == 503 and r.json()["error"] == "unavailable"
    monkeypatch.undo()
    assert tables() == before  # the event rolled back with the projection


# ---- shown(): §7.5 ----

def row(state="working", logged=0, tool=None, tool_state=None, level="observable", ended=None):
    return {"level": level, "state": state, "logged_at": at(logged), "ended_at": ended and at(ended),
            "tool_at": None if tool is None else at(tool), "tool_state": tool_state}


def show(r, seconds, pc=None):
    return shown.shown(r, T0 + seconds, pc)


def test_each_execution_state_label_and_window():
    hm = lambda s: shown.hhmm(T0 + s)  # noqa: E731
    # working: live for 2 minutes from the last event, then "No report since HH:MM"
    w = row("working", logged=60)
    assert show(w, 60) == {"state": "working", "label": "Working", "live": True, "since": at(60)}
    assert show(w, 60 + shown.WINDOW - 1)["live"] is True  # the last second inside the window
    edge = show(w, 60 + shown.WINDOW)
    assert (edge["live"], edge["label"]) == (False, f"No report since {hm(60)}")  # at the window: not live
    assert show(w, 60 + 3600)["label"] == f"No report since {hm(60)}"
    assert show(w, 60 + 3600)["state"] == "working" and show(w, 3600)["since"] == at(60)
    # tool.finished is an in-place event: it restarts the window
    done = row("working", logged=60, tool=100, tool_state="finished")
    assert show(done, 100 + 119)["live"] is True and show(done, 100 + 120)["live"] is False
    assert show(done, 100 + 120)["label"] == f"No report since {hm(100)}"
    # running_tool: no window; the tool's age in minutes
    t = row("working", logged=60, tool=100, tool_state="running")
    assert show(t, 100)["label"] == "Running a tool for under 1 min"
    assert show(t, 100 + 9 * 60 + 59)["label"] == "Running a tool for 9 min"
    assert show(t, 100 + 3 * 3600)["label"] == "Running a tool for 180 min"
    assert (show(t, 100)["state"], show(t, 100 + 3600)["live"]) == ("running_tool", True)
    stale_tool = row("working", logged=200, tool=100, tool_state="running")  # a later logged event ended the tool
    assert show(stale_tool, 210)["state"] == "working"
    # turn_finished: a fact about the past, never "waiting on you", never live
    f = row("turn_finished", logged=300)
    for later in (0, 5, 3600):
        s = show(f, 300 + later)
        assert (s["state"], s["label"], s["live"]) == ("turn_finished", f"Turn finished {hm(300)}", False)
        assert "waiting" not in s["label"].lower()
    # waiting_owner: "Waiting for you since"; an event after it is the session working again, with the window
    wo = row("waiting_owner", logged=400)
    assert show(wo, 4000)["label"] == f"Waiting for you since {hm(400)}" and show(wo, 4000)["live"] is False
    back = row("waiting_owner", logged=400, tool=500, tool_state="finished")
    assert show(back, 510) == {"state": "working", "label": "Working", "live": True, "since": at(500)}
    assert show(back, 500 + 120)["label"] == f"No report since {hm(500)}"
    # ended
    e = row("ended", logged=600, ended=600)
    assert show(e, 7200) == {"state": "ended", "label": f"Ended {hm(600)}", "live": False, "since": at(600)}
    # unknown: no event since attach; or nothing readable at all
    u = row("unknown", logged=0)
    assert show(u, 30)["label"] == f"No report since {hm(0)}" and show(u, 30)["live"] is False
    assert show({"level": "observable", "state": "working", "logged_at": None}, 5) == {
        "state": "unknown", "label": "No report yet", "live": False, "since": None}
    assert show({"level": "observable", "state": "working", "logged_at": "garbage"}, 5)["label"] == "No report yet"
    assert show({}, 5)["label"] == "No report yet"
    # Local AI: the run's state while the PC is on; "Last known" when it is off or can't be told; a finished run
    # says so either way
    run = row("running", logged=700, level="full")
    assert show(run, 710, True) == {"state": "running", "label": f"Running since {hm(700)}", "live": True,
                                    "since": at(700)}
    assert show(run, 710, False)["label"] == f"Last known {hm(700)} (PC asleep)" and not show(run, 710, False)["live"]
    assert show(run, 710, None)["label"] == f"Last known {hm(700)} (PC state unknown)"
    for state, word in (("done", "Done"), ("failed", "Failed"), ("cancelled", "Cancelled")):
        s = show(row(state, logged=700, level="full"), 9000, False)
        assert (s["label"], s["live"]) == (f"{word} {hm(700)}", False)
    assert show(row("queued", logged=700, level="full"), 710, True)["label"] == f"Queued since {hm(700)}"


def test_no_live_label_without_a_fresh_event():
    """§17.1, server half: over every state and every age, `live` is true only for a running tool or a report inside
    the window, and reading later never makes a silent session more live."""
    rows = [row("working", 100), row("working", 100, 150, "finished"), row("working", 100, 150, "running"),
            row("turn_finished", 100), row("waiting_owner", 100), row("unknown", 100), row("ended", 100, ended=100),
            row("waiting_owner", 100, 150, "finished"), row("turn_finished", 100, 150, "finished")]
    for r in rows:
        last = max(100, 150 if r["tool_at"] else 0)
        was = True
        for age in range(0, 600, 7):
            s = show(r, last + age)
            if s["live"] and s["state"] != "running_tool":
                assert age < shown.WINDOW and s["state"] == "working", (r, age)
            assert not (s["live"] and not was), (r, age)  # once not live, never live again without an event
            was = s["live"]
    # through the route: a session that reports once is Live, then isn't, as the clock moves
    clock[0] += 61
    assert post("claude", [session("session.attached", 0, cwd_name="pi-hub"), session("turn.started", 1, prompt_id=SESSION)]).json()[
        "accepted"] == 2
    import_a34()
    for dt, live, label in ((10, True, "Working"), (119, True, "Working"), (121, False, "No report since"),
                            (3600, False, "No report since")):
        clock[0] = T0 + 1 + dt
        [x] = get("/api/missions/a34").json()["executions"]
        assert x["live"] is live and x["shown"].startswith(label), (dt, x)


# ---- the reads ----

def test_overview_counts_with_their_denominators_and_the_sources_line():
    assert get("/api/missions").json()["missions"] == []  # read and empty: its own answer, not a failure
    import_a34()
    listed = get("/api/missions").json()
    [m] = listed["missions"]
    assert (m["id"], m["status"], m["revision"]["n"], m["revision"]["status"]) == ("a34", "active", 1, "proposed")
    assert m["decisions"] == {"state": "ok", "open": 0, "blocking": 0, "answered": 15}
    assert m["provenance"] == {"trust": "imported", "source": "importer", "from": "azmusgb/pi-hub@e9efd31"}
    o = get("/api/missions/a34").json()
    assert o["view"] == "overview" and o["seq"] == len(ledger_log()) and o["as_of"] == shown.iso(log.clock())
    assert len(o["stages"]) == 8 and [s["n"] for s in o["stages"]] == list(range(8))
    assert o["counts"]["gates"] == {"met": 0, "of": 8} and o["counts"]["tasks"]["of"] == 8
    assert o["counts"]["evidence"] == {"trusted": 0, "owner": 0, "reported": 0, "imported": 10, "of": 10}
    assert o["counts"]["risks"]["of"] == 9 and o["counts"]["decisions"]["answered"] == 15
    assert [p["n"] for p in o["proposed"]] == [1] and o["proposed"][0]["changes"] == {"add": 60}
    assert o["sources"][0]["name"] == "ledger" and o["sources"][1]["commit"].startswith("e9efd31")
    assert len(o["events"]) == views.RECENT and o["events"][0]["seq"] > o["events"][1]["seq"]
    # one tap accepts it: the overview then draws revision 1 as accepted, nothing proposed
    accept()
    o = get("/api/missions/a34").json()
    assert o["revision"]["status"] == "accepted" and o["proposed"] == []
    # a reported task state replaces the imported one in the counts, and says how many were reported
    clock[0] += 61
    post("claude", [session("session.attached", 100, cwd_name="pi-hub"),
                    session("task.done", 101, task="a34:task:p0-cheap-hashing")])
    t = get("/api/missions/a34").json()["counts"]["tasks"]
    assert t["of"] == 8 and t["reported"] == 1


def test_changes_after_seq_and_304(monkeypatch):
    import_a34()
    top = len(ledger_log())
    r = get("/api/missions/a34/changes?after=0")
    assert r.status_code == 200 and r.json()["seq"] == top and r.headers["etag"] == f'"{top}"'
    body = r.json()
    assert len(body["events"]) == top and body["views"] == ["overview", "decisions", "evidence"]
    assert [e["seq"] for e in body["events"]] == sorted(e["seq"] for e in body["events"])  # oldest first
    assert r.headers["cache-control"] == "private, no-cache"
    # nothing new: the same tag is a 304 with no body
    same = get("/api/missions/a34/changes?after=%d" % top, headers={"If-None-Match": f'"{top}"'})
    assert same.status_code == 304 and same.content == b"" and same.headers["etag"] == f'"{top}"'
    assert get("/api/missions/a34/changes?after=0", headers={"If-None-Match": f'W/"{top}"'}).status_code == 304
    quiet = get(f"/api/missions/a34/changes?after={top}")
    assert quiet.status_code == 200 and quiet.json()["events"] == [] and quiet.json()["views"] == []
    # a new event moves the tag, and the page is told which views to read again
    clock[0] += 61
    post("claude", [session("session.attached", 100, cwd_name="pi-hub")])
    new = get(f"/api/missions/a34/changes?after={top}", headers={"If-None-Match": f'"{top}"'})
    assert new.status_code == 200 and new.headers["etag"] == f'"{top + 1}"'
    assert [e["type"] for e in new.json()["events"]] == ["session.attached"]
    assert new.json()["views"] == ["overview", "evidence"] and new.json()["executions"][0]["id"] == SESSION
    # a tool event isn't logged (seq stays), but it moves the tag so a running tool still reaches the page
    tag = new.headers["etag"]
    post("claude", [session("tool.running", 110, tool_use_id="t1", tool="Bash", label="Running tests")])
    moved = get(f"/api/missions/a34/changes?after={top + 1}", headers={"If-None-Match": tag})
    assert moved.status_code == 200 and moved.json()["seq"] == top + 1 and moved.headers["etag"] != tag
    assert moved.json()["executions"][0]["state"] == "running_tool"
    # a page ahead of the log (a restored database) is told to read everything again
    ahead = get(f"/api/missions/a34/changes?after={top + 50}").json()
    assert ahead["reset"] is True and ahead["views"] == ["overview", "decisions", "evidence"]
    # more than a poll carries: truncated, every view stale
    monkeypatch.setattr(views, "CHANGES_MAX", 5)
    cut = get("/api/missions/a34/changes?after=0").json()
    assert cut["truncated"] is True and len(cut["events"]) == 5 and cut["views"] == ["overview", "decisions", "evidence"]
    for bad in ("after=-1", "after=x", ""):
        assert get(f"/api/missions/a34/changes?{bad}").status_code == 422
    assert get("/api/missions/nope/changes?after=0").status_code == 404
    assert get("/api/missions/nope/changes?after=0", headers={"If-None-Match": f'"{top + 1}"'}).status_code == 404


def test_views_are_paged_filtered_and_tagged_without_the_clock():
    import_a34()
    accept()
    full = get("/api/missions/a34?view=evidence&limit=4")
    ev1 = full.json()
    assert len(ev1["evidence"]["rows"]) == 4 and ev1["evidence"]["total"] == 10 and ev1["evidence"]["next"] == 4
    nxt = get("/api/missions/a34?view=evidence&limit=4&offset=4").json()["evidence"]
    assert nxt["next"] == 8 and not {r["id"] for r in nxt["rows"]} & {r["id"] for r in ev1["evidence"]["rows"]}
    assert get("/api/missions/a34?view=evidence&limit=4&offset=8").json()["evidence"]["next"] is None
    page = ev1["events"]
    assert len(page["rows"]) == 4 and page["next_before"] == page["rows"][-1]["seq"]
    older = get(f"/api/missions/a34?view=evidence&limit=4&before={page['next_before']}").json()["events"]
    assert older["rows"][0]["seq"] < page["rows"][-1]["seq"]
    owners = get("/api/missions/a34?view=evidence&group=owner").json()["events"]
    assert [e["type"] for e in owners["rows"]] == ["revision.accepted"] and owners["next_before"] is None
    assert {e["source"] for e in get("/api/missions/a34?view=evidence&group=imports&limit=100").json()["events"][
        "rows"]} == {"importer"}
    assert get("/api/missions/a34?view=evidence&group=github").json()["events"]["rows"] == []  # none yet: read, empty
    # the ETag is the body without its clock: later, with nothing changed, it is a 304
    r = get("/api/missions/a34?view=decisions")
    clock[0] += 500
    again = get("/api/missions/a34?view=decisions", headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304 and r.json()["as_of"] != get("/api/missions/a34?view=decisions").json()["as_of"]
    for bad in ("view=plan", "view=evidence&group=nope", "view=summary"):
        assert get(f"/api/missions/a34?{bad}").status_code == 400
    for bad in ("limit=0", "limit=101", "offset=-1", "before=0"):
        assert get(f"/api/missions/a34?view=evidence&{bad}").status_code == 422
    assert get("/api/missions/nope").status_code == 404
    assert get("/api/missions/Not a slug").status_code == 404


def test_every_read_needs_the_owner_session():
    import_a34()
    for path in ("/api/missions", "/api/missions/a34", "/api/missions/a34?view=decisions",
                 "/api/missions/a34/changes?after=0"):
        for token in (None, "household-token", "stranger"):
            assert get(path, token=token).status_code == 401, (path, token)
        assert get(path, headers={"X-Hub-Deploy-Key": MAC["X-Hub-Deploy-Key"]}, token=None).status_code == 401
    assert get("/api/missions").status_code == 200


def test_imported_rows_carry_their_source_and_never_a_freshness_state():
    import_a34()
    source = "azmusgb/pi-hub@e9efd31"
    o = get("/api/missions/a34").json()
    d = get("/api/missions/a34?view=decisions&limit=100").json()
    e = get("/api/missions/a34?view=evidence&limit=100").json()
    rows = [o["initiative"], *o["stages"], o["revision"], *o["proposed"], *d["answered"], *e["evidence"]["rows"]]
    assert len(d["answered"]) == 15 and len(e["evidence"]["rows"]) == 10
    for r in rows:
        assert r["provenance"]["trust"] == "imported" and r["provenance"]["from"] == source, r
        assert r["provenance"]["source"] == "importer"
        assert not FRESH_KEYS & set(r), r  # a manifest is history, not a reading
    for x in walk(rows):
        assert not FRESH_KEYS & set(x), x
    # a session's own report is trust `reported`, from its source, and only an execution carries a live label
    clock[0] += 61
    post("claude", [session("session.attached", 100, cwd_name="pi-hub"),
                    session("evidence.reported", 101, kind="commit", repo="azmusgb/pi-hub", sha="1874c5f")])
    e = get("/api/missions/a34?view=evidence&limit=100").json()["evidence"]["rows"]
    reported = [r for r in e if r["trust"] == "reported"]
    assert len(reported) == 1 and reported[0]["provenance"] == {"trust": "reported", "source": "claude",
                                                                "at": at(101)}
    assert [r["trust"] for r in e] == ["reported"] + ["imported"] * 10  # by trust, then kind
    [x] = get("/api/missions/a34").json()["executions"]
    assert x["provenance"]["trust"] == "reported" and x["provenance"]["source"] == "claude" and "shown" in x


def test_no_stream_route_and_no_thread_per_viewer():
    """§17.9: Mission Control opens no SSE stream and holds no default-executor thread per viewer."""
    ours = [r for r in hubapp.app.routes if getattr(r, "path", "").startswith("/api/missions")]
    assert {(r.path, tuple(sorted(r.methods))) for r in ours} == {
        ("/api/missions/events/{source}", ("POST",)), ("/api/missions", ("GET",)),
        ("/api/missions/{initiative}", ("GET",)), ("/api/missions/{initiative}/changes", ("GET",)),
        ("/api/missions/{initiative}/owner", ("POST",))}
    assert not [r for r in ours if "stream" in r.path.lower() or "sse" in r.path.lower()]
    for r in ours:
        assert getattr(r.response_class, "value", r.response_class).__name__ not in ("StreamingResponse", "EventSourceResponse"), r.path
    for src in Path(views.__file__).parent.glob("*.py"):
        text = src.read_text()
        for banned in ("asyncio.to_thread", "run_in_executor", "run_in_threadpool", "StreamingResponse",
                       "text/event-stream", "EventSourceResponse", "threading.Thread", "records.subscribe"):
            assert banned not in text, (src.name, banned)
    import_a34()
    for path in ("/api/missions", "/api/missions/a34", "/api/missions/a34?view=decisions",
                 "/api/missions/a34?view=evidence", "/api/missions/a34/changes?after=0"):
        assert get(path).headers["content-type"].startswith("application/json"), path


# ---- failed sources: a read that can't be made is its own state ----

def test_a_ledger_that_cannot_be_read_is_503_never_an_empty_answer(monkeypatch):
    import_a34()
    for path in ("/api/missions", "/api/missions/a34", "/api/missions/a34?view=decisions",
                 "/api/missions/a34?view=evidence", "/api/missions/a34/changes?after=0"):
        with monkeypatch.context() as m:
            m.setattr(store, "ready", lambda: (_ for _ in ()).throw(sqlite3.OperationalError("database is locked")))
            r = get(path)
            assert r.status_code == 503 and r.json()["error"] == "unavailable", path
            assert "missions" not in r.json() and "events" not in r.json()
    # a stored row that isn't readable is the same failure, not a row skipped
    db.run("UPDATE mission_initiatives SET manifest = '{broken'")
    for path in ("/api/missions", "/api/missions/a34"):
        assert get(path).status_code == 503, path


def test_a_stored_row_with_no_object_data_is_503_not_an_empty_row():
    import_a34()
    for bad in ("NULL", "'null'", "'[]'"):
        db.run(f"UPDATE mission_entities SET data = {bad} WHERE id IN (SELECT id FROM mission_entities LIMIT 1)")
        codes = {get(path).status_code for path in ("/api/missions/a34", "/api/missions/a34?view=decisions",
                                                      "/api/missions/a34?view=evidence")}
        assert 503 in codes, bad


def test_decisions_that_cannot_be_read_are_unavailable_not_zero(monkeypatch):
    import_a34()

    def broken(*a, **k):
        raise decisions.Unreadable("no such table")
    monkeypatch.setattr(decisions, "open_and_recent", broken)
    assert get("/api/missions").json()["missions"][0]["decisions"] == {"state": "unavailable"}
    assert get("/api/missions/a34").json()["counts"]["decisions"] == {"state": "unavailable"}
    d = get("/api/missions/a34?view=decisions&limit=100").json()
    assert d["state"] == "unavailable" and d["open"] == [] and len(d["answered"]) == 15  # the manifest's still drawn


# ---- the decisions mirror ----

def ask(did="a34-pick-owner", **over):
    body = {"id": did, "kind": "choice", "question": "Which one?", "options": ["List", "Timeline"],
            "initiative": "a34", "blocking": True, **over}
    return client.post("/api/decisions/claude", json=body, headers=MAC)


def answer(did, value):
    return client.post(f"/api/decisions/{did}/answer", json={"answer": value}, headers=SAME,
                       cookies={auth.COOKIE: "owner-token"})


def test_initiative_decisions_are_mirrored_into_the_log_and_outside_rebuild():
    import_a34()
    accept()
    before, live = len(ledger_log()), projections()
    assert ask().status_code == 200
    [asked] = [r for r in ledger_log() if r["type"] == "decision.asked"]
    assert (asked["source"], asked["initiative"], asked["entity"], asked["late"]) == ("pi-hub", "a34", "a34-pick-owner",
                                                                                      0)
    assert json.loads(asked["body"]) == {"id": "a34-pick-owner", "kind": "choice", "question": "Which one?",
                                        "again": False, "blocking": True}
    assert ask(question="Which one, really?").json()["outcome"] == "asked again"
    assert [json.loads(r["body"])["again"] for r in ledger_log() if r["type"] == "decision.asked"] == [False, True]
    r = answer("a34-pick-owner", "List")
    assert r.status_code == 200 and r.json()["recorded"] is True
    assert answer("a34-pick-owner", "List").json()["recorded"] is False  # a double tap logs nothing more
    [done] = [x for x in ledger_log() if x["type"] == "decision.answered"]
    assert done["source"] == "pi-hub" and json.loads(done["body"]) == {"id": "a34-pick-owner", "kind": "choice"}
    assert "List" not in done["body"]  # never the answer
    assert len(ledger_log()) == before + 3
    # history only: no projection moved, a rebuild ignores the mirror, and the log keeps it
    assert projections() == live
    assert cli.main(["rebuild", "a34", "--check"]) == 0
    assert cli.main(["rebuild", "a34"]) == 0 and len(ledger_log()) == before + 3
    assert projections() == live
    assert project.apply(project.empty("a34"), {"type": "decision.asked", "source": "pi-hub", "initiative": "a34",
                                                "body": {}, "behind": False}) == []
    # the views read it: open, then answered, with the owner's trust; history under its own filter
    assert get("/api/missions/a34?view=decisions").json()["open"] == []
    d = get("/api/missions/a34?view=decisions&limit=100").json()
    mine = [x for x in d["answered"] if x["id"] == "a34-pick-owner"]
    assert len(mine) == 1 and mine[0]["answer"] == "List" and mine[0]["provenance"]["trust"] == "owner"
    assert d["total"] == 16
    hist = get("/api/missions/a34?view=evidence&group=decisions").json()["events"]["rows"]
    assert [e["type"] for e in hist] == ["decision.answered", "decision.asked", "decision.asked"]
    c = get("/api/missions/a34").json()["counts"]["decisions"]
    assert c == {"state": "ok", "open": 0, "blocking": 0, "answered": 16}
    assert get("/api/missions/a34/changes?after=%d" % before).json()["views"] == ["overview", "decisions", "evidence"]


def test_open_decision_is_in_the_decisions_view_and_counts():
    import_a34()
    ask()
    ask("a34-second", blocking=False)
    d = get("/api/missions/a34?view=decisions").json()
    assert [x["id"] for x in d["open"]] == ["a34-pick-owner", "a34-second"] and d["state"] == "ok"
    assert get("/api/missions/a34").json()["counts"]["decisions"] == {"state": "ok", "open": 2, "blocking": 1,
                                                                      "answered": 15}
    assert get("/api/missions").json()["missions"][0]["decisions"]["open"] == 2
    ch = get("/api/missions/a34/changes?after=0").json()
    assert "decisions" in ch["views"]


def test_a33_decisions_and_other_initiatives_leave_this_ledger_alone():
    r = client.post("/api/decisions/claude", headers=MAC, json={"id": "plain-one", "question": "Which?",
                                                                 "options": ["A", "B"]})
    assert r.status_code == 200
    assert answer("plain-one", "A").status_code == 200
    store.ready()
    assert ledger_log() == []  # no initiative: nothing mirrored
    assert ask("other-one", initiative="zz9").status_code == 200  # an initiative this ledger has no mission for
    assert [r["initiative"] for r in ledger_log()] == ["zz9"]
    assert get("/api/missions/zz9").status_code == 404


def test_a_mirror_that_cannot_be_written_stores_no_decision(monkeypatch):
    def broken(*a, **k):
        raise sqlite3.OperationalError("disk I/O error")
    with monkeypatch.context() as m:
        m.setattr(mirror, "asked", broken)
        assert ask().status_code == 503
    assert decisions.get("a34-pick-owner") is None  # asked and logged together, or neither
    assert ask().status_code == 200
    with monkeypatch.context() as m:
        m.setattr(mirror, "answered", broken)
        assert answer("a34-pick-owner", "List").status_code == 503
    assert decisions.get("a34-pick-owner")["answered_at"] is None  # not answered without its history
    assert answer("a34-pick-owner", "List").json()["recorded"] is True
