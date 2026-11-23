"""Owner decisions (A33, plan docs/superpowers/plans/2026-11-21-a33-owner-decisions.md, P2's server half): a session
on the Mac adds a question with the Mac's deploy key, the owner answers it once, and /api/needs carries the list beside
its items for the owner only."""
import os
import sqlite3
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from helpers_keys import KEYS, LAB_KEY, install_keys  # noqa: E402
from hub import app as hubapp, auth, db, decisions, display_routes, records, sources  # noqa: E402

client = TestClient(hubapp.app)
MAC = {"X-Hub-Deploy-Key": KEYS["mac"]}
SAME = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
TOKENS = {"owner-token": "owner", "household-token": "household", "kid-token": "kid"}


def ask(body=None, headers=None, source="claude", **over):
    body = {"id": "a27-activity-shape", "question": "Which Activity shape?", "options": ["List", "Timeline"],
            "recommended": "List", "link": "https://hub.rahe-home.duckdns.org/docs/a27", **over} if body is None else body
    return client.post(f"/api/decisions/{source}", json=body, headers=MAC if headers is None else headers)


def tap(did, value, token="owner-token", headers=None):
    return client.post(f"/api/decisions/{did}/answer", json={"answer": value}, headers=SAME if headers is None else headers,
                       cookies={auth.COOKIE: token} if token else None)


def listed():
    r = client.get("/api/decisions", headers=MAC)
    assert r.status_code == 200, r.text
    return r.json()


def owner_needs():
    return client.get("/api/needs", cookies={auth.COOKIE: "owner-token"}).json()


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    install_keys(monkeypatch, tmp_path)
    monkeypatch.setattr(auth, "session", lambda token, gate=False: {"role": TOKENS[token], "device": "phone"}
                        if token in TOKENS else None)
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    monkeypatch.setattr(records, "all", lambda: {})


# ---- adding: the key ----

def test_the_macs_deploy_key_adds_and_reads():
    r = ask()
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == "added"
    d = listed()["open"][0]
    assert {k: d[k] for k in ("id", "source", "kind", "question", "options", "recommended", "link", "answer")} == {
        "id": "a27-activity-shape", "source": "claude", "kind": "choice", "question": "Which Activity shape?",
        "options": ["List", "Timeline"], "recommended": "List", "link": "https://hub.rahe-home.duckdns.org/docs/a27",
        "answer": None}
    assert d["answered_at"] is None and isinstance(d["created_at"], int)


@pytest.mark.parametrize("headers", [
    {},  # no key, from the hub's own page: the route refuses
    {"X-Hub-Deploy-Key": KEYS["localai"]},  # another host's deploy key
    {"X-Hub-Deploy-Key": "wrong"},
    {"X-Hub-Mac-Key": LAB_KEY},  # print-lab's lab key is not the Mac's deploy key (plan decision 1)
    {**MAC, "X-Forwarded-Proto": "http"},  # the key over plain http through Caddy doesn't count
])
def test_adding_without_the_macs_key_is_401_and_stores_nothing(headers):
    r = ask(headers={**SAME, **headers} if not headers else headers)
    assert r.status_code == 401 and r.json()["detail"] == decisions.WRONG_KEY
    assert listed() == {"open": [], "answered": []}


def test_no_key_from_another_site_is_refused_before_the_route():
    assert ask(headers={"Origin": "https://evil.example"}).status_code == 403
    assert listed()["open"] == []


@pytest.mark.parametrize("headers", [{}, {"X-Hub-Deploy-Key": KEYS["localai"]}, {"X-Hub-Mac-Key": LAB_KEY},
                                     {"X-Hub-Deploy-Key": "wrong"}])
def test_reading_needs_the_macs_key(headers):
    ask()
    r = client.get("/api/decisions", headers=headers)
    assert r.status_code == 401 and "open" not in r.json()


def test_an_unknown_source_is_404():
    assert ask(source="localai").status_code == 404
    assert ask(source="mac-watch", headers=SAME).status_code == 404
    assert listed()["open"] == []


# ---- adding: the limits (plan decision 8) ----

@pytest.mark.parametrize("over", [
    {"id": "ab"}, {"id": "-abc"}, {"id": "Abc-def"}, {"id": "a" * 65}, {"id": "abc\n"}, {"id": 12345},
    {"question": ""}, {"question": "   "}, {"question": "q" * 281}, {"question": None},
    {"options": ["Only one"]}, {"options": ["a", "b", "c", "d", "e"]}, {"options": ["a", ""]},
    {"options": ["a", "o" * 61]}, {"options": ["Yes", "yes"]}, {"options": ["a", 2]}, {"options": "a,b"},
    {"recommended": "Neither"}, {"recommended": ""},
    {"link": "http://hub.rahe-home.duckdns.org/x"}, {"link": "https://evil.example/"},
    {"link": "https://user@hub.rahe-home.duckdns.org/"},
    {"kind": "poll"}, {"kind": "text"},  # a text decision with options
    {"supersedes": "a27-activity-shape"}, {"supersedes": "NOPE"}, {"supersedes": "never-asked"},
])
def test_each_limit_is_400_and_stores_nothing(over):
    r = ask(**over)
    assert r.status_code == 400, (over, r.text)
    assert listed()["open"] == []


def test_a_body_that_isnt_an_object_is_400_and_too_big_is_413():
    assert ask(body=["a"]).status_code == 400
    assert client.post("/api/decisions/claude", content=b"{", headers=MAC).status_code == 400
    assert ask(question="q" * 280, options=["o" * 60] * 1 + ["é" * 60] * 3 + ["x" * 9000]).status_code == 413


def test_the_limits_are_inclusive_and_text_is_one_line():
    r = ask(question="q " * 139 + "q", options=["a" * 60, "b", "c", "d"], recommended="b")
    assert r.status_code == 200, r.text
    r = ask(id="one-line", question="Which\r\nX-Evil: 1", options=[" Yes\n", "No"], recommended="Yes")
    d = r.json()["decision"]
    assert d["question"] == "Which X-Evil: 1" and d["options"] == ["Yes", "No"] and d["recommended"] == "Yes"


def test_a_text_decision_has_no_options_and_the_link_is_optional():
    r = ask(id="a30-line", kind="text", question="Write the A30 line", options=None, recommended=None, link=None)
    assert r.status_code == 200, r.text
    d = r.json()["decision"]
    assert d["kind"] == "text" and d["options"] == [] and d["recommended"] is None and d["link"] is None


def test_the_link_is_rebuilt_from_its_parts():
    d = ask(link="https://HUB.rahe-home.duckdns.org?x=1#y").json()["decision"]
    assert d["link"] == "https://hub.rahe-home.duckdns.org/?x=1#y"


# ---- asking again ----

def test_asking_again_while_open_updates_the_row_in_place():
    ask()
    r = ask(question="Which Activity shape, now?", options=["List", "Timeline", "Both"], recommended="Both")
    assert r.status_code == 200 and r.json()["outcome"] == "asked again"
    open_ = listed()["open"]
    assert len(open_) == 1
    assert open_[0]["question"] == "Which Activity shape, now?" and open_[0]["options"] == ["List", "Timeline", "Both"]
    assert open_[0]["recommended"] == "Both"


def test_asking_again_after_its_answered_is_409_with_the_answer():
    ask()
    assert tap("a27-activity-shape", "Timeline").status_code == 200
    r = ask(question="Asked again")
    assert r.status_code == 409
    assert r.json()["answer"] == "Timeline" and isinstance(r.json()["answered_at"], int)
    assert r.json()["decision"]["question"] == "Which Activity shape?"  # the answered row is never edited


def test_a_changed_mind_is_a_new_id_naming_the_old_one():
    ask()
    tap("a27-activity-shape", "List")
    r = ask(id="a27-activity-shape-2", supersedes="a27-activity-shape")
    assert r.status_code == 200 and r.json()["decision"]["supersedes"] == "a27-activity-shape"
    data = listed()
    assert [d["id"] for d in data["open"]] == ["a27-activity-shape-2"]
    assert data["answered"][0]["answer"] == "List"  # the old row stays as it is


def test_supersedes_must_name_an_answered_decision():
    ask()
    assert ask(id="other-one", supersedes="a27-activity-shape").status_code == 400  # still open
    assert [d["id"] for d in listed()["open"]] == ["a27-activity-shape"]


# ---- answering ----

def test_a_tap_records_the_answer_once_and_a_double_tap_returns_it():
    ask()
    first = tap("a27-activity-shape", "Timeline")
    assert first.status_code == 200 and first.json()["recorded"] is True
    when = first.json()["decision"]["answered_at"]
    second = tap("a27-activity-shape", "Timeline")
    assert second.status_code == 200 and second.json()["recorded"] is False
    assert second.json()["decision"]["answered_at"] == when
    data = listed()
    assert data["open"] == [] and [d["answer"] for d in data["answered"]] == ["Timeline"]
    logged = [a for a in auth.recent_actions() if a["action"] == "decision:a27-activity-shape"]
    assert [(a["role"], a["result"]) for a in logged] == [("owner", "answered")]


def test_a_different_answer_after_it_is_recorded_is_409():
    ask()
    tap("a27-activity-shape", "Timeline")
    r = tap("a27-activity-shape", "List")
    assert r.status_code == 409 and r.json()["decision"]["answer"] == "Timeline"
    assert listed()["answered"][0]["answer"] == "Timeline"


def test_an_unknown_id_is_404():
    assert tap("never-asked", "List").status_code == 404


def test_an_answer_that_isnt_an_option_is_400_and_the_row_stays_open():
    ask()
    for value in ("Neither", "", None, 3, "o" * 61):
        assert tap("a27-activity-shape", value).status_code == 400, value
    assert [d["id"] for d in listed()["open"]] == ["a27-activity-shape"]


def test_a_text_answer_keeps_its_newlines_up_to_500_characters():
    ask(id="a30-line", kind="text", question="Write the A30 line", options=None, recommended=None)
    assert tap("a30-line", "x" * 501).status_code == 400
    assert tap("a30-line", " \r\n ").status_code == 400
    r = tap("a30-line", "First line\r\nSecond line" + "y" * 477)
    assert r.status_code == 200, r.text
    assert r.json()["decision"]["answer"] == "First line\nSecond line" + "y" * 477


@pytest.mark.parametrize("token", [None, "household-token", "kid-token", "someone-elses"])
def test_only_the_owner_answers(token):
    ask()
    assert tap("a27-activity-shape", "List", token=token).status_code == 401
    assert [d["id"] for d in listed()["open"]] == ["a27-activity-shape"]


def test_the_macs_key_cannot_answer():
    ask()
    r = client.post("/api/decisions/a27-activity-shape/answer", json={"answer": "List"}, headers={**MAC, **SAME})
    assert r.status_code == 401
    r = client.post("/api/decisions/a27-activity-shape/answer", json={"answer": "List"}, headers=MAC)
    assert r.status_code == 403  # no exemption from the page check on the answer path
    assert listed()["open"] != []


@pytest.mark.parametrize("site", ["cross-site", "same-site", "none"])
def test_an_answer_from_another_site_is_refused_even_as_the_owner(site):
    ask()
    r = tap("a27-activity-shape", "List", headers={"Origin": "http://testserver", "Sec-Fetch-Site": site})
    assert r.status_code == 403
    assert listed()["answered"] == []


def test_two_open_decisions_keep_their_order_and_answering_one_leaves_the_other():
    ask(id="first-one")
    ask(id="second-one")
    ask(id="first-one", question="Asked again")  # asking again keeps its place
    assert [d["id"] for d in listed()["open"]] == ["first-one", "second-one"]
    tap("first-one", "List")
    data = listed()
    assert [d["id"] for d in data["open"]] == ["second-one"] and [d["id"] for d in data["answered"]] == ["first-one"]


def test_retention_keeps_the_newest_50_answered_and_every_open_one():
    for n in range(53):
        decisions.add("claude", decisions.valid({"id": f"q-{n:03}", "question": "Q", "options": ["a", "b"]}), now=1000 + n)
        if n < 52:
            decisions.answer(f"q-{n:03}", "a", "owner", "phone", now=2000 + n)
    data = listed()
    assert [d["id"] for d in data["open"]] == ["q-052"]
    assert len(data["answered"]) == 50
    assert data["answered"][0]["id"] == "q-051" and data["answered"][-1]["id"] == "q-002"
    assert decisions.get("q-000") is None and decisions.get("q-001") is None


# ---- Needs you ----

def test_the_owners_needs_carries_open_and_the_last_five_answered():
    for n in range(7):
        ask(id=f"q-{n:03}")
    for n in range(6):
        tap(f"q-{n:03}", "List")
    got = owner_needs()["decisions"]
    assert [d["id"] for d in got["open"]] == ["q-006"]
    assert len(got["answered"]) == 5


@pytest.mark.parametrize("cookies", [None, {auth.COOKIE: "household-token"}, {auth.COOKIE: "kid-token"}])
def test_a_non_owner_needs_call_has_no_decisions_key(cookies):
    ask()
    data = client.get("/api/needs", cookies=cookies).json()
    assert "decisions" not in data
    assert all(not i["id"].startswith("pi:decisions") for i in data["items"])


def test_decisions_never_change_count_items_the_wall_or_the_display():
    before = client.get("/api/needs").json()
    before_owner = owner_needs()
    before_display = display_routes._needs_now(records.all())
    ask(id="first-one")
    ask(id="second-one")
    after = client.get("/api/needs").json()
    after_owner = owner_needs()
    assert (after["count"], after["items"]) == (before["count"], before["items"])  # the wall reads it unsigned
    assert (after_owner["count"], after_owner["items"]) == (before_owner["count"], before_owner["items"])
    assert len(after_owner["decisions"]["open"]) == 2
    assert display_routes._needs_now(records.all()) == before_display


def test_an_unreadable_table_is_one_bad_item_and_null_never_an_empty_list():
    db.run("CREATE TABLE decisions (x TEXT)")  # a table the hub can't read its rows from
    before = client.get("/api/needs").json()
    data = owner_needs()
    assert data["decisions"] is None
    bad = [i for i in data["items"] if i["id"] == "pi:decisions:unreadable"]
    assert bad == [decisions.UNREADABLE]
    assert data["count"] == before["count"] + 1
    assert "decisions" not in before and all(i["id"] != "pi:decisions:unreadable" for i in before["items"])
    r = client.get("/api/decisions", headers=MAC)
    assert r.status_code == 503 and "can't be read" in r.json()["detail"]


def test_the_unreadable_item_comes_after_other_faults_and_before_the_rest():
    data = {"count": 3, "items": [{"id": "a", "tone": "bad"}, {"id": "b", "tone": "attention"}, {"id": "c", "tone": "warn"}]}
    db.run("CREATE TABLE decisions (x TEXT)")
    decisions.attach(data)
    assert [i["id"] for i in data["items"]] == ["a", "pi:decisions:unreadable", "b", "c"] and data["count"] == 4


def test_a_failed_write_says_not_recorded_and_keeps_the_row(monkeypatch):
    ask()
    real = db.run

    def broken(sql, *args):
        if sql.startswith("UPDATE decisions SET answer"):
            raise sqlite3.OperationalError("database is locked")
        return real(sql, *args)

    monkeypatch.setattr(db, "run", broken)
    r = tap("a27-activity-shape", "List")
    assert r.status_code == 503 and "Not recorded" in r.json()["detail"]
    monkeypatch.setattr(db, "run", real)
    assert [d["id"] for d in listed()["open"]] == ["a27-activity-shape"]


def test_a_re_ask_between_the_check_and_the_write_never_stores_a_stale_option(monkeypatch):
    """QA defect 1: the answer is checked against the options it is written against, in one step."""
    ask()
    real = decisions._answer_for

    def re_asked_meanwhile(row, value):
        text = real(row, value)
        ask(question="Which shape, now?", options=["Cards", "Rows"], recommended="Rows")  # a session asks again
        return text

    monkeypatch.setattr(decisions, "_answer_for", re_asked_meanwhile)
    r = tap("a27-activity-shape", "List")
    assert r.status_code == 409 and r.json()["decision"]["options"] == ["Cards", "Rows"]
    d = listed()["open"][0]
    assert d["answer"] is None and d["question"] == "Which shape, now?"


@pytest.mark.parametrize("stored", ["{", '"List"', "null"])
def test_a_corrupt_stored_row_is_503_not_400(stored):
    """QA defect 3: a row the hub can't read is a read failure, not the owner's bad answer."""
    ask()
    db.run("UPDATE decisions SET options = ? WHERE id = ?", stored, "a27-activity-shape")
    r = tap("a27-activity-shape", "List")
    assert r.status_code == 503 and "can't be read" in r.json()["detail"]
    assert client.get("/api/decisions", headers=MAC).status_code == 503
    assert ask().status_code == 200  # asking again while open rewrites the row, which repairs it
    assert listed()["open"][0]["options"] == ["List", "Timeline"]


def test_when_who_is_asking_cant_be_read_needs_says_so_without_naming_decisions(monkeypatch):
    """QA defect 2: a failed sign-in read is its own bad item, never a quiet "not the owner"."""
    ask()

    def broken(token, gate=False):  # as auth.session(): no token never reads the database
        if token:
            raise sqlite3.OperationalError("database disk image is malformed")

    monkeypatch.setattr(auth, "session", broken)
    data = client.get("/api/needs", cookies={auth.COOKIE: "owner-token"}).json()
    assert "decisions" not in data
    bad = [i for i in data["items"] if i["id"] == "pi:who:unreadable"]
    assert len(bad) == 1 and bad[0]["tone"] == "bad" and bad == [decisions.WHO_UNREADABLE]
    assert "decision" not in (bad[0]["title"] + bad[0]["detail"]).lower()
    assert data["count"] == client.get("/api/needs").json()["count"] + 1
