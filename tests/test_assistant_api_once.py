"""One task for one ask (A34 P2n, hub/assistant_api.py): a double tap, or the same goal sent again at once, never starts
a second Mission. The scripted Local AI and the fixtures are test_assistant_api's."""
import json
import threading
from pathlib import Path

from hub import assistant_api as ai, auth
import test_assistant_api as api_tests
from test_assistant_api import RUN, Clock, fx, logged, post, routes_ok

# The fixtures, bound by assignment: an imported fixture named as a test's parameter reads as a redefined import.
setup, la = api_tests.setup, api_tests.la


def test_the_same_goal_again_within_ten_seconds_answers_with_the_first_task(la):
    routes_ok(la)
    a = post("/api/ai/tasks", {"goal": "Plan the week"})
    Clock.t += 9
    b = post("/api/ai/tasks", {"goal": "  Plan the week  "})
    assert (b.status_code, b.json()["state"], b.json()["runId"]) == (202, "submitted", a.json()["runId"])
    assert len(la.calls) == 1, "Local AI was asked once"
    assert logged[-1][2:] == ("ai:task-start", "duplicate") and "Plan the week" not in json.dumps(logged)
    Clock.t += 2  # 11 s after the first: the owner means it
    assert post("/api/ai/tasks", {"goal": "Plan the week"}).status_code == 202 and len(la.calls) == 2


def test_another_goal_project_or_session_starts_its_own_task(la, monkeypatch):
    routes_ok(la)
    post("/api/ai/tasks", {"goal": "Plan the week"})
    post("/api/ai/tasks", {"goal": "Plan the month"})
    post("/api/ai/tasks", {"goal": "Plan the week", "projectId": "proj-1"})
    monkeypatch.setattr(auth, "session", lambda token, gate=False: {"role": "owner", "device": "ipad"} if token in ("owner-token", "owner-2") else None)
    post("/api/ai/tasks", {"goal": "Plan the week"}, cookies={auth.COOKIE: "owner-2"})
    assert len(la.calls) == 4 and all(logged[i][3] == "submitted" for i in range(4))


def test_a_submit_that_started_nothing_is_not_remembered_and_keeps_no_goal(la):
    la.routes[ai.START] = (400, {"error": "goal is required"})
    assert post("/api/ai/tasks", {"goal": "Plan the week"}).json()["state"] == "refused"
    assert ai._starts == {}
    routes_ok(la)
    assert post("/api/ai/tasks", {"goal": "Plan the week"}).json()["state"] == "submitted" and len(la.calls) == 2
    assert "Plan the week" not in repr(ai._starts), "only a digest is kept, in memory, for ten seconds"
    assert not Path(ai.MIRROR_FILE).exists()
    Clock.t += 11
    post("/api/ai/tasks", {"goal": "Something else"})
    assert len(ai._starts) == 1, "an old entry is dropped"


def test_an_identical_submit_while_the_first_is_in_flight_waits_for_it_and_answers_with_the_same_task(la):
    arrived, release = threading.Event(), threading.Event()

    def slow(method, query, body):
        arrived.set()
        assert release.wait(5)
        return 202, fx("start_202")

    la.routes[ai.START] = slow
    out = []
    first = threading.Thread(target=lambda: out.append(post("/api/ai/tasks", {"goal": "Plan the week"})))
    first.start()
    assert arrived.wait(5)
    second = threading.Thread(target=lambda: out.append(post("/api/ai/tasks", {"goal": "Plan the week"})))
    second.start()
    second.join(0.3)
    assert second.is_alive() and len(la.calls) == 1, "the double tap waits; it does not start a second task"
    release.set()
    first.join(5)
    second.join(5)
    assert [r.status_code for r in out] == [202, 202] and {r.json()["runId"] for r in out} == {RUN}
    assert len(la.calls) == 1 and ai._inflight["submit"] == 0


def test_an_identical_submit_behind_one_that_failed_gets_that_answer_and_starts_nothing(la):
    arrived, release = threading.Event(), threading.Event()

    def slow(method, query, body):
        arrived.set()
        assert release.wait(5)
        return TimeoutError("slow")

    la.routes[ai.START] = slow
    out = []
    threads = [threading.Thread(target=lambda: out.append(post("/api/ai/tasks", {"goal": "x"}))) for _ in range(2)]
    threads[0].start()
    assert arrived.wait(5)
    threads[1].start()
    threads[1].join(0.3)
    release.set()
    for t in threads:
        t.join(5)
    assert [r.json()["state"] for r in out] == ["unreachable", "unreachable"] and len(la.calls) == 1
    assert ai._starts == {}
