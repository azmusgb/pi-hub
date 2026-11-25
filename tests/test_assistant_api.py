"""The Assistant adapter (A34 P2 and P2n, hub/assistant_api.py), against a fixture of Local AI's replies
(tests/fixtures/localai-contract; Local AI's side is built in parallel, so nothing here reaches it)."""
import json
import os
import urllib.error
from pathlib import Path

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hubapp, assistant_api as ai, auth, display_ai, records  # noqa: E402

client = TestClient(hubapp.app)
FIX = Path(__file__).parent / "fixtures" / "localai-contract"
SAME = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
OWNER = {auth.COOKIE: "owner-token"}
RUN = "run-1790000000000-001a2b3"
MISSION = "mission-17900000-ab12"


def fx(name):
    return json.loads((FIX / f"{name}.json").read_text())


class Clock:
    t = 1_000_000.0


class LocalAI:
    """A scripted Local AI: path -> (status, body) or a callable or an exception; every call is recorded."""

    def __init__(self):
        self.routes, self.calls = {}, []

    def __call__(self, method, url, headers, body, timeout):
        rest = url.split("10.0.0.81", 1)[1]
        path, _, query = rest.partition("?")
        self.calls.append({"method": method, "path": path, "query": query, "headers": dict(headers), "body": body, "timeout": timeout})
        r = self.routes.get(path)
        if r is None:
            return 404, b'{"error":"not found"}', "application/json"
        if callable(r):
            r = r(method, query, body)
        if isinstance(r, BaseException):
            raise r
        status, payload = r
        raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        return status, raw, "application/json"


@pytest.fixture(autouse=True)
def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "session", lambda token, gate=False: {"role": "owner", "device": "phone"} if token == "owner-token"
                        else {"role": "household", "device": "tv"} if token == "household-token" else None)
    monkeypatch.setattr(auth, "log", lambda *a, **k: logged.append(a))
    logged.clear()
    key = tmp_path / "key"
    key.write_text("secret\n")
    ca = tmp_path / "ca.crt"
    ca.write_text("x")
    monkeypatch.setattr(display_ai, "KEY_FILE", str(key))
    monkeypatch.setattr(display_ai, "CA_FILE", str(ca))
    monkeypatch.setattr(display_ai, "URL", "https://10.0.0.81")
    monkeypatch.setattr(ai, "MIRROR_FILE", str(tmp_path / "mirror" / "assistant-mirror.json"))
    Clock.t = 1_000_000.0
    monkeypatch.setattr(ai, "_now", lambda: Clock.t)
    monkeypatch.setattr(ai, "_breaker", {"probe": 0.0, "ok": 0.0})
    monkeypatch.setattr(ai, "_inflight", {k: 0 for k in ai.INFLIGHT})
    pc = {"state": "on"}
    monkeypatch.setattr(records, "get", lambda id: {"state": pc["state"]} if id == "pc" and pc["state"] else None)
    la = LocalAI()
    monkeypatch.setattr(ai, "FETCH", la)
    la.pc = pc
    return la


logged = []


@pytest.fixture
def la(setup):
    return setup


def get(path, cookies=OWNER, headers=None):
    return client.get(path, cookies=cookies, headers=headers)


def post(path, body=None, cookies=OWNER, headers=None, **kw):
    return client.post(path, json=body, cookies=cookies, headers={**SAME, **(headers or {})}, **kw)


def routes_ok(la):
    la.routes.update({ai.STATUS: (200, fx("status_ok")), ai.MODELS: (200, fx("models_ok")),
                      ai.START: (202, fx("start_202")),
                      ai.RUNS: (200, fx("run_running")), ai.MISSION: (200, fx("mission_running")),
                      ai.CANCEL: (200, fx("run_cancelled"))})


# ---- who may ask, and what the browser can't send ----

@pytest.mark.parametrize("method,path", [("get", "/api/ai/status"), ("get", "/api/ai/models"), ("post", "/api/ai/tasks"),
                                         ("get", f"/api/ai/tasks/{RUN}"), ("post", f"/api/ai/tasks/{RUN}/cancel")])
@pytest.mark.parametrize("cookies", [None, {auth.COOKIE: "household-token"}])
def test_every_route_is_owner_only_and_calls_nothing(la, method, path, cookies):
    routes_ok(la)
    r = getattr(client, method)(path, cookies=cookies, headers=SAME, **({"json": {"goal": "x"}} if method == "post" else {}))
    assert r.status_code == 401
    assert la.calls == []


def test_the_allow_list_is_exactly_six_paths():
    assert ai.PATHS == {"/api/contract/status": "GET", "/api/contract/models": "GET", "/api/agents/missions/start": "POST",
                        "/api/runs": "GET", "/api/agents/mission": "GET", "/api/runs/cancel": "POST"}


@pytest.mark.parametrize("path,method", [("/api/runs/retry", "POST"), ("/api/changes/apply", "POST"), ("/api/powershell/run", "POST"),
                                         ("/api/models/pull", "POST"), ("/api/chat/stream", "POST"), ("/api/runs/../status", "GET"),
                                         ("/api/runs?id=x", "GET"), ("/api/runs%2Fcancel", "POST"), ("//api/runs", "GET")])
def test_an_unlisted_path_is_refused_without_a_request(la, path, method):
    status, _, _ = display_ai.forward(method, path, paths=ai.PATHS, methods=ai.PATHS, fetch=la)
    assert status == 403 and la.calls == []


@pytest.mark.parametrize("path,method", [(ai.STATUS, "POST"), (ai.START, "GET"), (ai.RUNS, "POST"), (ai.CANCEL, "GET")])
def test_a_wrong_method_on_a_listed_path_is_refused(la, path, method):
    assert display_ai.forward(method, path, paths=ai.PATHS, methods=ai.PATHS, fetch=la)[0] == 405 and la.calls == []


def test_the_displays_own_paths_are_still_the_displays_alone(la):
    assert display_ai.forward("GET", ai.STATUS, fetch=la)[0] == 403
    assert display_ai.forward("GET", "/api/display/approvals", paths=ai.PATHS, methods=ai.PATHS, fetch=la)[0] == 403


def test_the_key_and_owner_flag_are_pi_hubs_never_the_browsers(la):
    routes_ok(la)
    evil = {"X-LocalAI-Hub-Key": "browser-key", "X-Hub-Owner": "0", "Authorization": "Bearer x", "X-Forwarded-For": "1.2.3.4"}
    assert get("/api/ai/status", headers=evil).status_code == 200
    post("/api/ai/tasks", {"goal": "Plan the week", "owner": True, "key": "browser-key", "agentIds": ["x"], "webSearch": True,
                           "workerModel": "m", "async": False, "path": "/api/changes/apply"}, headers=evil)
    get(f"/api/ai/tasks/{RUN}", headers=evil)
    post(f"/api/ai/tasks/{RUN}/cancel", {"id": "other", "path": "/x"}, headers=evil)
    assert len(la.calls) >= 5
    for c in la.calls:
        assert c["headers"]["X-LocalAI-Hub-Key"] == "secret" and c["headers"]["X-Hub-Owner"] == "1"
        assert set(c["headers"]) <= {"X-LocalAI-Hub-Key", "X-Hub-Owner", "Content-Type"}
        assert c["path"] in ai.PATHS
    start = next(c for c in la.calls if c["path"] == ai.START)
    assert json.loads(start["body"]) == {"goal": "Plan the week", "async": True}
    cancel = next(c for c in la.calls if c["path"] == ai.CANCEL)
    assert json.loads(cancel["body"]) == {"id": RUN}


def test_a_cross_site_post_is_refused_by_the_hubs_origin_check(la):
    routes_ok(la)
    r = client.post("/api/ai/tasks", json={"goal": "x"}, cookies=OWNER, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and la.calls == []


def test_no_key_or_no_ca_is_refused_by_the_adapter_without_a_call(la, monkeypatch):
    routes_ok(la)
    monkeypatch.setattr(display_ai, "KEY_FILE", "/nonexistent")
    for r in (get("/api/ai/status"), get(f"/api/ai/tasks/{RUN}")):
        assert r.json()["state"] == "refused" and "fetched_at" in r.json()
    assert post("/api/ai/tasks", {"goal": "x"}).status_code == 503
    assert la.calls == []


# ---- status and models: every source state, failed sources, the mirror ----

@pytest.mark.parametrize("which,path", [("status", ai.STATUS), ("models", ai.MODELS)])
def test_a_live_read_is_passed_with_fetched_at_and_labelled_live(la, which, path):
    routes_ok(la)
    r = get(f"/api/ai/{which}").json()
    assert r["state"] == "live" and r["mirror"] is False and r["fetched_at"] == int(Clock.t)
    assert r["data"]["sources"] and r["data"]["as_of"]
    assert [c["path"] for c in la.calls] == [path] and la.calls[0]["method"] == "GET"


@pytest.mark.parametrize("name,sources", [
    ("status_partial", {"appliance": "ok", "gridcraft": "failed", "artcraft": "unknown", "workshop": "failed", "watch": "ok"}),
    ("status_all_failed", {k: "failed" for k in ("appliance", "gridcraft", "artcraft", "workshop", "watch")})])
def test_failed_and_unknown_sources_reach_the_page_as_themselves(la, name, sources):
    la.routes[ai.STATUS] = (200, fx(name))
    d = get("/api/ai/status").json()["data"]
    assert {k: v["state"] for k, v in d["sources"].items()} == sources
    assert [v.get("error") for v in d["sources"].values() if v["state"] == "failed"] == ["Not answering right now."] * list(sources.values()).count("failed")


def test_models_with_ollama_down_keeps_its_failed_sources_and_reason(la):
    la.routes[ai.MODELS] = (200, fx("models_ollama_down"))
    d = get("/api/ai/models").json()["data"]
    assert d["sources"]["installed"]["state"] == "failed" and d["runtimeAvailable"] is False and d["runtimeError"]
    assert d["installed"] == [] and d["installedCount"] == 0


def test_an_unknown_source_state_is_unknown_never_ok(la):
    body = fx("status_ok")
    body["sources"]["watch"] = {"state": "healthy-ish"}
    body["sources"]["artcraft"] = "ok"
    la.routes[ai.STATUS] = (200, body)
    s = get("/api/ai/status").json()["data"]["sources"]
    assert s["watch"]["state"] == "unknown" and s["artcraft"]["state"] == "unknown"


def test_a_reply_without_the_contract_shape_is_out_of_date(la):
    for body in ({"overall": "ok"}, {"as_of": "x", "sources": {}}, {"as_of": "x", "sources": []}):
        la.routes[ai.STATUS] = (200, body)
        r = get("/api/ai/status").json()
        assert r["state"] == "out_of_date" and r["data"] is None, body


@pytest.mark.parametrize("version", [None, 0, -1, "1", 1.0, True, [1]])
@pytest.mark.parametrize("name,path", [("status_ok", ai.STATUS), ("status_all_failed", ai.STATUS), ("models_ollama_down", ai.MODELS)])
def test_a_missing_or_older_contract_version_is_out_of_date_even_with_failed_sources(la, name, path, version):
    body = fx(name)
    if version is None:
        body.pop("contract_version")
    else:
        body["contract_version"] = version
    la.routes[path] = (200, body)
    r = get("/api/ai/" + path.rsplit("/", 1)[1]).json()
    assert r["state"] == "out_of_date" and r["data"] is None
    assert not Path(ai.MIRROR_FILE).exists(), "an out-of-date answer is never stored"


def test_a_newer_contract_version_is_accepted_and_the_minimum_is_one():
    assert ai.MIN_CONTRACT_VERSION == 1


def test_a_newer_contract_version_is_drawn(la):
    body = fx("status_ok")
    body["contract_version"] = 2
    la.routes[ai.STATUS] = (200, body)
    r = get("/api/ai/status").json()
    assert r["state"] == "live" and r["data"]["contract_version"] == 2


def test_an_older_local_ai_without_the_route_is_out_of_date(la):
    r = get("/api/ai/models").json()  # the fake answers 404 for a path it doesn't have
    assert r["state"] == "out_of_date"


def test_local_ai_refusing_the_key_is_refused(la):
    la.routes[ai.STATUS] = (403, {"error": "Not allowed"})
    r = get("/api/ai/status").json()
    assert r["state"] == "refused" and r["error"] == "Not allowed"


@pytest.mark.parametrize("fail", [(502, {"error": "bad gateway"}), (503, {"error": "model unchecked"}), (500, b"boom"),
                                  (200, b"<html>not json</html>"), (200, b"[1]"), TimeoutError("slow"), urllib.error.URLError("refused")])
def test_a_failed_read_with_nothing_kept_says_unreachable_never_empty(la, fail):
    la.routes[ai.STATUS] = fail
    r = get("/api/ai/status").json()
    assert r["state"] == "unreachable" and r["data"] is None and r["why"] == "unreachable"


def test_a_failed_read_answers_from_the_mirror_with_its_age(la):
    routes_ok(la)
    get("/api/ai/status")
    Clock.t += 600
    la.routes[ai.STATUS] = TimeoutError("slow")
    r = get("/api/ai/status").json()
    assert r["state"] == "mirror" and r["mirror"] is True and r["why"] == "unreachable"
    assert r["age"] == 600 and r["stored_at"] == int(Clock.t) - 600
    assert r["data"]["sources"]["appliance"]["state"] == "ok"


def test_only_status_and_models_are_stored_and_in_a_file_outside_the_database(la):
    routes_ok(la)
    get("/api/ai/status"), get("/api/ai/models")
    post("/api/ai/tasks", {"goal": "Answer with a secret"}), get(f"/api/ai/tasks/{RUN}")
    stored = json.loads(Path(ai.MIRROR_FILE).read_text())
    assert set(stored) == {"status", "models"}
    assert "secret" not in json.dumps(stored) and "Option A" not in json.dumps(stored)
    assert oct(os.stat(ai.MIRROR_FILE).st_mode & 0o777) == "0o600"
    backup = (Path(__file__).parents[1] / "deploy" / "pi-hub-backup.sh").read_text()
    assert "assistant-mirror" not in backup and "/var/lib/pi-hub/hub.db" in backup


def test_the_default_mirror_path_is_not_in_what_the_backup_archives():
    default = "/var/lib/pi-hub/assistant-mirror.json"
    src = (Path(__file__).parents[1] / "hub" / "assistant_api.py").read_text()
    assert default in src
    sh = (Path(__file__).parents[1] / "deploy" / "pi-hub-backup.sh").read_text()
    archived = ["etc/fstab", "var/lib/pi-hub/lab", "var/lib/pi-hub/project-files"]
    assert all(not default.lstrip("/").startswith(a + "/") and default.lstrip("/") != a for a in archived)
    assert all(a in sh for a in archived) and "var/lib/pi-hub\n" not in sh


def test_a_read_where_no_source_answered_never_replaces_the_last_good_mirror(la):
    routes_ok(la)
    get("/api/ai/status")
    Clock.t += 120
    la.routes[ai.STATUS] = (200, fx("status_all_failed"))
    assert get("/api/ai/status").json()["state"] == "live"  # the live answer is shown as it is: all failed
    la.routes[ai.STATUS] = TimeoutError("x")
    kept = get("/api/ai/status").json()["data"]
    assert kept["sources"]["appliance"]["state"] == "ok"


def test_the_mirror_is_written_when_it_changes_or_after_a_minute_and_not_every_read(la):
    routes_ok(la)
    get("/api/ai/status")
    first = os.stat(ai.MIRROR_FILE).st_mtime_ns
    body = fx("status_ok")
    body["as_of"] = "later"
    body["services"][0]["latencyMs"] = 99  # only what changes on every read
    la.routes[ai.STATUS] = (200, body)
    Clock.t += 10
    get("/api/ai/status")
    assert os.stat(ai.MIRROR_FILE).st_mtime_ns == first
    Clock.t += 10
    la.routes[ai.STATUS] = (200, fx("status_partial"))
    get("/api/ai/status")
    assert json.loads(Path(ai.MIRROR_FILE).read_text())["status"]["body"]["overall"] == "DEGRADED"
    stamp = json.loads(Path(ai.MIRROR_FILE).read_text())["status"]["at"]
    Clock.t += 61
    get("/api/ai/status")
    assert json.loads(Path(ai.MIRROR_FILE).read_text())["status"]["at"] == stamp + 61


def test_an_answer_past_the_size_bound_is_not_stored(la, monkeypatch):
    routes_ok(la)
    monkeypatch.setattr(ai, "MIRROR_MAX", 100)
    assert get("/api/ai/status").json()["state"] == "live"
    assert not Path(ai.MIRROR_FILE).exists()


def test_a_corrupt_mirror_is_no_mirror_and_is_replaced(la):
    Path(ai.MIRROR_FILE).parent.mkdir(parents=True)
    Path(ai.MIRROR_FILE).write_text("{not json")
    la.routes[ai.STATUS] = TimeoutError("x")
    assert get("/api/ai/status").json()["state"] == "unreachable"
    routes_ok(la)
    get("/api/ai/status")
    assert "status" in json.loads(Path(ai.MIRROR_FILE).read_text())


# ---- the sleeping PC: the pc record, the breaker, the caps ----

def test_pc_off_with_a_mirror_answers_from_it_at_once_without_calling(la):
    routes_ok(la)
    get("/api/ai/models")
    la.calls.clear()
    la.pc["state"] = "off"
    Clock.t += 3600
    la.routes[ai.STATUS] = TimeoutError("asleep")
    get("/api/ai/status")  # spends the probe on another route, and it fails
    la.calls.clear()
    r = get("/api/ai/models").json()
    assert r["state"] == "mirror" and r["why"] == "pc_off" and r["age"] == 3600 and la.calls == []


def test_pc_off_with_nothing_stored_says_needs_the_pc(la):
    routes_ok(la)
    la.pc["state"] = "off"
    la.routes[ai.STATUS] = TimeoutError("asleep")
    first = get("/api/ai/status").json()  # the probe
    assert first["state"] == "needs_pc" and first["data"] is None
    assert get("/api/ai/status").json()["state"] == "needs_pc"
    assert len(la.calls) == 1


def test_the_breaker_lets_one_probe_through_every_30_seconds_with_a_short_timeout(la):
    routes_ok(la)
    la.pc["state"] = "off"
    la.routes[ai.STATUS] = TimeoutError("asleep")
    for _ in range(5):
        get("/api/ai/status")
    assert len(la.calls) == 1 and la.calls[0]["timeout"] <= 2
    Clock.t += 29
    get("/api/ai/status")
    assert len(la.calls) == 1
    Clock.t += 2
    get("/api/ai/status")
    assert len(la.calls) == 2


def test_a_live_answer_beats_a_stale_off_record(la):
    routes_ok(la)
    la.pc["state"] = "off"
    assert get("/api/ai/status").json()["state"] == "live"  # the probe went through and Local AI answered
    for _ in range(3):
        assert get("/api/ai/models").json()["state"] == "live"  # so the next 30 s don't wait on the record
    assert all(c["timeout"] <= 2 for c in la.calls)


def test_pc_unknown_or_on_uses_the_normal_timeout_and_no_breaker(la):
    routes_ok(la)
    for state in ("on", None):
        la.pc["state"] = state
        la.calls.clear()
        for _ in range(3):
            get("/api/ai/status")
        assert len(la.calls) == 3 and all(c["timeout"] > 2 for c in la.calls)


def test_a_read_over_its_in_flight_cap_serves_the_mirror_or_says_busy(la, monkeypatch):
    routes_ok(la)
    get("/api/ai/status")
    monkeypatch.setattr(ai, "_inflight", {**{k: 0 for k in ai.INFLIGHT}, "status": ai.INFLIGHT["status"]})
    la.calls.clear()
    r = get("/api/ai/status").json()
    assert r["state"] == "mirror" and r["why"] == "busy" and la.calls == []
    monkeypatch.setattr(ai, "MIRROR_FILE", ai.MIRROR_FILE + ".none")
    assert get("/api/ai/status").json()["state"] == "unreachable"


def test_the_slot_is_given_back_after_every_call(la):
    routes_ok(la)
    la.routes[ai.STATUS] = TimeoutError("x")
    for _ in range(ai.INFLIGHT["status"] + 3):
        get("/api/ai/status")
    assert ai._inflight["status"] == 0


# ---- submit ----

def test_submit_returns_local_ais_task_identity(la):
    routes_ok(la)
    r = post("/api/ai/tasks", {"goal": "  Plan the week  ", "projectId": "proj-1"})
    assert r.status_code == 202 and r.json()["state"] == "submitted" and r.json()["runId"] == RUN
    assert r.json()["threadId"] and r.json()["fetched_at"]
    c = la.calls[0]
    assert c["method"] == "POST" and c["path"] == ai.START and json.loads(c["body"]) == {"goal": "Plan the week", "async": True, "projectId": "proj-1"}
    assert logged[-1][2:] == ("ai:task-start", "submitted") and "Plan the week" not in json.dumps(logged)


@pytest.mark.parametrize("goal,why", [(None, "Say"), ("", "Say"), ("   \n\t ", "Say"), (5, "Say"), ("\x00\x07", "Say"), ("x" * 2001, "2,000"), (["a"], "Say")])
def test_goal_validation_refuses_without_calling(la, goal, why):
    routes_ok(la)
    r = post("/api/ai/tasks", {"goal": goal})
    assert r.status_code == 400 and r.json()["state"] == "refused" and why in r.json()["error"]
    assert la.calls == []


def test_a_goal_of_exactly_the_limit_goes_and_control_characters_are_dropped(la):
    routes_ok(la)
    assert post("/api/ai/tasks", {"goal": "a" * 2000}).status_code == 202
    post("/api/ai/tasks", {"goal": "one\x00two\x1b\nthree"})
    assert json.loads(la.calls[-1]["body"])["goal"] == "onetwo\nthree"


@pytest.mark.parametrize("project", [5, "../x", "a b", "x" * 81, {"a": 1}])
def test_a_bad_project_id_is_refused(la, project):
    routes_ok(la)
    assert post("/api/ai/tasks", {"goal": "x", "projectId": project}).status_code == 400 and la.calls == []


def test_submit_needs_json_an_object_and_a_small_body(la):
    routes_ok(la)
    assert client.post("/api/ai/tasks", data="goal=x", cookies=OWNER, headers=SAME).status_code == 415
    assert client.post("/api/ai/tasks", content=b"{", cookies=OWNER, headers={**SAME, "Content-Type": "application/json"}).status_code == 400
    assert post("/api/ai/tasks", ["x"]).status_code == 400
    assert post("/api/ai/tasks", {"goal": "x" * 20000}).status_code == 413
    assert la.calls == []


def test_submit_refuses_with_needs_the_pc_while_it_sleeps(la):
    routes_ok(la)
    la.pc["state"] = "off"
    la.routes[ai.START] = TimeoutError("asleep")
    ai._breaker["probe"] = Clock.t  # the probe was just spent: no call at all
    r = post("/api/ai/tasks", {"goal": "x"})
    assert r.status_code == 503 and r.json()["state"] == "needs_pc" and "needs the PC" in r.json()["error"] and la.calls == []
    Clock.t += 31  # the probe is due: it is tried, fails and is still "needs the PC"-not "started"
    r = post("/api/ai/tasks", {"goal": "x"})
    assert r.status_code == 503 and r.json()["state"] == "unreachable" and len(la.calls) == 1 and la.calls[0]["timeout"] <= 2


@pytest.mark.parametrize("answer,status,state", [
    ((400, {"error": "goal is required"}), 400, "refused"),
    ((400, {"error": "Unknown model", "code": "UNKNOWN_MODEL", "installed": ["llama3.1:8b"]}), 400, "refused"),
    ((503, {"error": "Models not checked"}), 503, "unavailable"),
    ((500, {"error": "boom"}), 502, "unavailable"),
    ((502, {"error": "bad gateway"}), 503, "unreachable"),
    ((404, {"error": "not found"}), 502, "out_of_date"),
    ((403, {"error": "no"}), 502, "refused"),
    ((200, {"runId": RUN}), 502, "out_of_date"),
    ((202, {"runId": "../x"}), 502, "out_of_date"),
    ((202, {}), 502, "out_of_date"),
    (TimeoutError("slow"), 503, "unreachable"),
    (urllib.error.URLError("refused"), 503, "unreachable")])
def test_each_local_ai_error_shape_on_submit(la, answer, status, state):
    la.routes[ai.START] = answer
    r = post("/api/ai/tasks", {"goal": "x"})
    assert (r.status_code, r.json()["state"]) == (status, state) and r.json()["fetched_at"]
    assert logged[-1][3] == state
    if state == "unreachable":
        assert "doesn't know whether the task started" in r.json()["error"]


def test_a_400_for_an_unknown_model_names_what_is_installed(la):
    la.routes[ai.START] = (400, {"error": "Unknown model", "code": "UNKNOWN_MODEL", "installed": ["a", "b"]})
    r = post("/api/ai/tasks", {"goal": "x"}).json()
    assert r["error"] == "Unknown model" and r["installed"] == ["a", "b"] and r["code"] == "UNKNOWN_MODEL"


def test_submit_stores_nothing(la):
    routes_ok(la)
    post("/api/ai/tasks", {"goal": "x"})
    assert not Path(ai.MIRROR_FILE).exists()


def test_submit_over_its_in_flight_cap_is_busy_without_a_call(la, monkeypatch):
    routes_ok(la)
    monkeypatch.setattr(ai, "_inflight", {**{k: 0 for k in ai.INFLIGHT}, "submit": ai.INFLIGHT["submit"]})
    r = post("/api/ai/tasks", {"goal": "x"})
    assert r.status_code == 429 and r.json()["state"] == "busy" and la.calls == []


# ---- follow ----

def test_follow_merges_the_run_and_its_mission(la):
    routes_ok(la)
    r = get(f"/api/ai/tasks/{RUN}").json()
    assert r["state"] == "ok" and r["fetched_at"] and r["mission_read"] == "ok"
    assert r["run"]["status"] == "running" and r["run"]["cancellable"] is True and r["run"]["missionId"] == MISSION
    assert [w["state"] for w in r["mission"]["workers"]] == ["complete", "running", "pending", "pending", "pending"]
    assert [(c["path"], c["query"]) for c in la.calls] == [(ai.RUNS, f"id={RUN}"), (ai.MISSION, f"id={MISSION}")]
    assert not Path(ai.MIRROR_FILE).exists()


def test_follow_a_queued_run_has_no_mission_yet(la):
    routes_ok(la)
    la.routes[ai.RUNS] = (200, fx("run_queued"))
    r = get(f"/api/ai/tasks/{RUN}").json()
    assert r["run"]["status"] == "queued" and r["mission"] is None and r["mission_read"] == "none"
    assert [c["path"] for c in la.calls] == [ai.RUNS]


def test_follow_a_finished_run_carries_the_full_answer_as_plain_text_never_html(la):
    routes_ok(la)
    la.routes[ai.RUNS] = (200, fx("run_completed"))
    la.routes[ai.MISSION] = (200, fx("mission_done"))
    resp = get(f"/api/ai/tasks/{RUN}")
    assert resp.headers["content-type"].startswith("application/json") and resp.headers["cache-control"] == "no-store"
    assert resp.headers["x-content-type-options"] == "nosniff"
    r = resp.json()
    assert r["run"]["status"] == "completed" and r["run"]["outcome"] == "complete"
    assert r["mission"]["answer"].endswith("<b>not bold</b> <img src=x onerror=alert(1)>")  # a string, as sent
    assert "<html" not in resp.text.lower()


def test_text_from_local_ai_is_text_with_control_characters_dropped_and_bounded(la):
    routes_ok(la)
    item = fx("run_failed")
    item["item"]["error"] = "bad\x00 <script>x</script>\x1b" + "e" * 9000
    mission = fx("mission_done")
    mission["mission"]["answer"] = "A" * (ai.ANSWER_MAX + 50)
    mission["mission"]["workers"][0]["name"] = "<b>W</b>\x07"
    la.routes[ai.RUNS], la.routes[ai.MISSION] = (200, item), (200, mission)
    r = get(f"/api/ai/tasks/{RUN}").json()
    assert r["run"]["error"].startswith("bad <script>x</script>") and "\x00" not in r["run"]["error"] and "\x1b" not in r["run"]["error"]
    assert "\x00" not in r["run"]["error"] and len(r["run"]["error"]) == ai.ERROR_MAX
    assert len(r["mission"]["answer"]) == ai.ANSWER_MAX and r["mission"]["workers"][0]["name"] == "<b>W</b>"


def test_follow_shows_a_run_interrupted_by_a_restart_as_failed_with_that_reason(la):
    routes_ok(la)
    la.routes[ai.RUNS] = (200, fx("run_failed_restart"))
    r = get(f"/api/ai/tasks/{RUN}").json()
    assert r["state"] == "ok" and r["run"]["status"] == "failed" and r["run"]["error"] == "Run interrupted by appliance restart"


@pytest.mark.parametrize("name,status", [("run_queued", "queued"), ("run_running", "running"), ("run_awaiting", "awaiting_approval"),
                                         ("run_completed", "completed"), ("run_failed", "failed"), ("run_cancelled", "cancelled")])
def test_each_run_status_is_passed_as_local_ai_says_it(la, name, status):
    routes_ok(la)
    la.routes[ai.RUNS] = (200, fx(name))
    assert get(f"/api/ai/tasks/{RUN}").json()["run"]["status"] == status


def test_an_unknown_run_status_is_out_of_date_never_a_guess(la):
    routes_ok(la)
    item = fx("run_running")
    item["item"]["status"] = "teleporting"
    la.routes[ai.RUNS] = (200, item)
    assert get(f"/api/ai/tasks/{RUN}").json()["state"] == "out_of_date"
    la.routes[ai.RUNS] = (200, {"nothing": 1})
    assert get(f"/api/ai/tasks/{RUN}").json()["state"] == "out_of_date"


def test_a_failed_mission_read_is_its_own_state_not_no_steps(la):
    routes_ok(la)
    la.routes[ai.MISSION] = (404, {"error": "Mission not found"})
    r = get(f"/api/ai/tasks/{RUN}").json()
    assert r["state"] == "ok" and r["mission"] is None and r["mission_read"] == "failed" and r["run"]["status"] == "running"
    la.routes[ai.MISSION] = TimeoutError("x")
    assert get(f"/api/ai/tasks/{RUN}").json()["mission_read"] == "failed"


@pytest.mark.parametrize("fail", [(502, {"error": "x"}), (503, {"error": "x"}), (504, b""), (200, b"junk"), TimeoutError("slow"),
                                  urllib.error.URLError("refused")])
def test_following_when_local_ai_does_not_answer_is_unreachable_never_failed(la, fail):
    routes_ok(la)
    la.routes[ai.RUNS] = fail
    resp = get(f"/api/ai/tasks/{RUN}")
    assert resp.status_code == 200 and resp.json()["state"] == "unreachable" and resp.json()["why"] == "unreachable"
    assert "run" not in resp.json() and "failed" not in resp.text


def test_following_while_the_pc_sleeps_is_unreachable_with_no_call_after_the_probe(la):
    routes_ok(la)
    la.pc["state"] = "off"
    la.routes[ai.RUNS] = TimeoutError("asleep")
    assert get(f"/api/ai/tasks/{RUN}").json() == {"state": "unreachable", "fetched_at": int(Clock.t), "why": "pc_off"}
    assert get(f"/api/ai/tasks/{RUN}").json()["why"] == "pc_off"
    assert len(la.calls) == 1 and la.calls[0]["timeout"] <= 2


def test_following_an_unknown_run_is_not_found(la):
    la.routes[ai.RUNS] = (404, {"error": "Run not found"})
    r = get(f"/api/ai/tasks/{RUN}").json()
    assert r["state"] == "not_found" and r["error"] == "Run not found"


def test_follow_refused_by_local_ai_is_refused(la):
    la.routes[ai.RUNS] = (403, {"error": "Not allowed"})
    assert get(f"/api/ai/tasks/{RUN}").json()["state"] == "refused"
    la.routes[ai.RUNS] = (405, {})
    assert get(f"/api/ai/tasks/{RUN}").json()["state"] == "out_of_date"


@pytest.mark.parametrize("bad", ["x", "ab", "../etc/passwd", "run 1", "run-1;rm", "run%2F1", "a" * 81, "-run-1", "run-1.json", "run-1:x", "%00"])
def test_a_run_id_must_match_the_strict_pattern_and_is_never_a_path(la, bad):
    routes_ok(la)
    assert get(f"/api/ai/tasks/{bad}").status_code in (400, 404)
    assert post(f"/api/ai/tasks/{bad}/cancel").status_code in (400, 404, 405)
    assert la.calls == []


def test_a_mission_id_that_fails_the_pattern_is_never_sent(la):
    routes_ok(la)
    item = fx("run_running")
    item["item"]["meta"] = {"missionId": "../../api/changes/apply?x=1"}
    la.routes[ai.RUNS] = (200, item)
    r = get(f"/api/ai/tasks/{RUN}").json()
    assert r["run"]["missionId"] is None and r["mission_read"] == "none"
    assert [c["path"] for c in la.calls] == [ai.RUNS]


def test_follow_over_its_cap_is_busy(la, monkeypatch):
    routes_ok(la)
    monkeypatch.setattr(ai, "_inflight", {**{k: 0 for k in ai.INFLIGHT}, "follow": ai.INFLIGHT["follow"]})
    assert get(f"/api/ai/tasks/{RUN}").json()["state"] == "busy" and la.calls == []


# ---- cancel ----

def test_cancel_sends_the_id_and_returns_the_run(la):
    routes_ok(la)
    r = post(f"/api/ai/tasks/{RUN}/cancel")
    assert r.status_code == 200 and r.json()["state"] == "ok" and r.json()["run"]["status"] == "cancelled"
    assert la.calls[0]["path"] == ai.CANCEL and json.loads(la.calls[0]["body"]) == {"id": RUN}
    assert logged[-1][2:] == ("ai:task-cancel", "ok")


@pytest.mark.parametrize("answer,status,state", [
    ((409, {"error": "This run is not cancellable"}), 409, "not_cancellable"),
    ((404, {"error": "Run not found"}), 404, "not_found"),
    ((502, {"error": "x"}), 503, "unreachable"),
    ((500, {"error": "x"}), 502, "refused"),
    (TimeoutError("slow"), 503, "unreachable")])
def test_each_local_ai_error_shape_on_cancel(la, answer, status, state):
    la.routes[ai.CANCEL] = answer
    r = post(f"/api/ai/tasks/{RUN}/cancel")
    assert (r.status_code, r.json()["state"]) == (status, state) and la.calls[0]["path"] == ai.CANCEL
    assert len(la.calls) == 1, "never retried"


def test_cancel_while_the_pc_sleeps_says_needs_the_pc_without_a_call(la):
    la.pc["state"] = "off"
    ai._breaker["probe"] = Clock.t
    r = post(f"/api/ai/tasks/{RUN}/cancel")
    assert r.status_code == 503 and r.json()["state"] == "needs_pc" and la.calls == []


def test_cancel_stores_nothing(la):
    routes_ok(la)
    post(f"/api/ai/tasks/{RUN}/cancel")
    assert not Path(ai.MIRROR_FILE).exists()


# ---- the browser's fixtures are what the adapter makes of Local AI's ----

BROWSER = Path(__file__).parent / "browser" / "fixtures"
RUNS = [("queued", "run_queued", None), ("running", "run_running", "mission_running"),
        ("awaiting", "run_awaiting", "mission_running"), ("completed", "run_completed", "mission_done"),
        ("failed", "run_failed_restart", None), ("cancelled", "run_cancelled", None)]


def _adapter_outputs(la):
    """dir/name -> the adapter's own answer for each Local AI fixture, the clock fixed: the browser preview's files.
    `assistant` is the PC on (status with a failed source, models, a task in each state); `assistant-asleep` is the PC off
    (status from the mirror, models never read, a task unreachable)."""
    out = {}
    la.routes.update({ai.STATUS: (200, fx("status_partial")), ai.MODELS: (200, fx("models_ok"))})
    out["assistant/ai/status"], out["assistant/ai/models"] = get("/api/ai/status").json(), get("/api/ai/models").json()
    for name, run, mission in RUNS:
        la.routes[ai.RUNS] = (200, fx(run))
        la.routes[ai.MISSION] = (200, fx(mission)) if mission else (404, {"error": "Mission not found"})
        out[f"assistant/ai/tasks/run-fixture-{name}"] = get(f"/api/ai/tasks/{RUN}").json()
    Path(ai.MIRROR_FILE).unlink()
    Path(ai.MIRROR_FILE).parent.mkdir(exist_ok=True)
    Path(ai.MIRROR_FILE).write_text(json.dumps({"status": {"at": Clock.t - 3600, "body": ai._contract_body(fx("status_partial"))}}))
    la.pc["state"] = "off"
    ai._breaker.update(probe=Clock.t, ok=0.0)  # the PC is off, the probe was just spent and nothing has answered since
    out["assistant-asleep/ai/status"], out["assistant-asleep/ai/models"] = get("/api/ai/status").json(), get("/api/ai/models").json()
    out["assistant-asleep/ai/tasks/run-fixture-running"] = get(f"/api/ai/tasks/{RUN}").json()
    return out


def test_the_browser_preview_fixtures_are_the_adapters_answers(la):
    write = os.environ.get("WRITE_AI_FIXTURES") == "1"
    outputs = _adapter_outputs(la)
    assert [outputs[f"assistant-asleep/ai/{n}"]["state"] for n in ("status", "models", "tasks/run-fixture-running")] == ["mirror", "needs_pc", "unreachable"]
    assert [outputs[f"assistant/ai/{n}"]["state"] for n in ("status", "models", "tasks/run-fixture-running")] == ["live", "live", "ok"]
    for name, body in outputs.items():
        f = BROWSER / f"{name}.json"
        if write:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(body, indent=2) + "\n")
        assert f.is_file(), f"{f} (regenerate: WRITE_AI_FIXTURES=1 pytest tests/test_assistant_api.py)"
        assert json.loads(f.read_text()) == body, f
