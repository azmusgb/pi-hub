"""The workshop display's two actions through Pi Hub, with the PC asleep: Clear plate (Bambuddy, one at a time, a
timeout never repeats a physical command, one banner per outcome) and Judge it (the Mac's lab queue, with Local AI's
checks from app/display-lab.js: the run on the judge card, every strip graded unless inconclusive, one request per id)."""
import hashlib
import os
import tempfile
import threading

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
KEY_FILE = os.path.join(_tmp, "bambuddy_control_key")
open(CODE_FILE, "w").write("ACTS-4321\n")
open(KEY_FILE, "w").write("ctl-key\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, db, display_messages, lab, lab_guard, printer_control, sources  # noqa: E402

SAME = {"Origin": "http://testserver"}
MAC_KEY = "hub-lab-key-display-actions-0123456789abcdef0123"
MAC = {"X-Hub-Mac-Key": MAC_KEY}
MOVED = "This print has changed. Open it again."
CRITERIA = [{"key": "layers", "label": "Layers", "choices": ["good", "ok", "bad"]},
            {"key": "top", "label": "Top face", "choices": ["clean", "rough"]}]
RECORD = {"id": "E-021", "variants": [{"id": "v1", "tab": "A", "role": "variant"}, {"id": "v2", "tab": "B"},
                                      {"id": "ref", "tab": "R", "role": "reference"}],
          "criteria": CRITERIA}
ALL = {"A": {"layers": "good", "top": "clean"}, "B": {"layers": "bad", "top": None}}


def index(run="PR-021-01", needs=None, fingerprint="fp-1"):
    return {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-31T09:00:00Z",
            "fingerprint": fingerprint,
            "experiments": [{"id": "E-021", "status": "printing", "run": run, "criteria": CRITERIA}],
            "needs": [{"id": "E-021", "action": "Judge the print", "urgency": 1, "why": "Look at the top face."}]
            if needs is None else needs,
            "records": {"E-021": {"type": "experiment", "file": "E-021.json", "sha256": fingerprint, "payload": RECORD}}}


@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    lab._ready_dbs.clear()
    lab._needs_cache.clear()
    auth._tries.clear()
    display_messages._sends.clear()
    monkeypatch.setattr(printer_control, "KEY_FILE", KEY_FILE)
    monkeypatch.setattr(sources, "bambuddy_printer",
                        lambda timeout=1: {"connected": True, "bambuddy_state": "FINISH", "awaiting_plate_clear": True})
    key_file = tmp_path / "lab_mac_key.sha256"
    key_file.write_text(hashlib.sha256(MAC_KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(key_file))
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "ACTS-4321", "owner_password": "long enough"},
                  headers=SAME).status_code == 200
    code = c.post("/api/display/pair/start", headers=SAME).json()["code"]
    key = TestClient(hub_app.app).post("/api/display/pair", json={"code": code}, headers=SAME).json()["key"]
    return c, {"X-Hub-Display-Key": key, **SAME}


def fake_post(results):
    """Bambuddy's answers in order, counting the calls."""
    calls = []

    def post(path, key):
        calls.append(path)
        return results[len(calls) - 1]
    return post, calls


def clear(env):
    c, disp = env
    return c.post("/api/display/printer/clear", headers=disp)


def banners():
    return display_messages.pending()


def logged(action):
    return [r["result"] for r in auth.recent_actions(50) if r["action"] == action]


# ---- Clear plate ----

@pytest.mark.parametrize("answers, ok, status, title, tone", [
    (["ok", "ok"], True, 200, "Plate confirmed", "ok"),
    (["ok", "no answer"], True, 200, "Check printer errors", "warning"),
    (["refused"], False, 502, "Plate not confirmed", "warning"),
])
def test_clear_plate_banners(env, monkeypatch, answers, ok, status, title, tone):
    post, calls = fake_post(answers)
    monkeypatch.setattr(printer_control, "_post", post)
    r = clear(env)
    assert r.status_code == status, r.text
    body = r.json()
    assert body["ok"] is ok and set(body) == {"ok", "say", "steps"}
    assert calls == ["clear-plate", "hms/clear"][:len(answers)]
    b = banners()
    assert [m["title"] for m in b] == [title]
    assert b[0]["tone"] == tone and b[0]["chime"] is False and b[0]["action"] == {"type": "show", "page": "printer"}
    assert logged("display:clear-plate") == ["ok" if ok and answers[-1] == "ok" else
                                             "errors not cleared" if ok else "failed: refused"]


def test_clear_plate_needs_the_display_key(env, monkeypatch):
    c, _ = env
    post, calls = fake_post(["ok", "ok"])
    monkeypatch.setattr(printer_control, "_post", post)
    assert c.post("/api/display/printer/clear", headers=SAME).status_code == 401
    assert calls == [] and banners() == []


def test_clear_plate_refuses_while_one_is_running(env, monkeypatch):
    started, release = threading.Event(), threading.Event()
    calls = []

    def slow(path, key):
        calls.append(path)
        started.set()
        release.wait(5)
        return "ok"
    monkeypatch.setattr(printer_control, "_post", slow)
    first = {}
    t = threading.Thread(target=lambda: first.setdefault("r", clear(env)))
    t.start()
    assert started.wait(5)
    second = clear(env)
    assert second.status_code == 409
    assert second.json()["detail"] == "Clear plate is already running."
    release.set()
    t.join(5)
    assert first["r"].status_code == 200
    assert calls == ["clear-plate", "hms/clear"]  # the second tap sent nothing
    assert [m["title"] for m in banners()] == ["Plate confirmed"]
    assert clear(env).status_code == 200  # the lock is free again


@pytest.mark.parametrize("holder, copy", [("pause", "The printer is busy with another command."),
                                           ("resume", "The printer is busy with another command."),
                                           ("clear", "Clear plate is already running.")])
def test_clear_plate_shares_the_hubs_printer_lock(env, monkeypatch, holder, copy):
    post, calls = fake_post(["ok", "ok"])
    monkeypatch.setattr(printer_control, "_post", post)
    assert printer_control.hold(holder) is None  # the owner's Clear plate, pause or resume in flight
    try:
        assert printer_control.hold("clear") == holder  # who holds it, and nothing taken
        r = clear(env)
    finally:
        printer_control.release()
    assert r.status_code == 409 and r.json()["detail"] == copy
    assert calls == []
    assert printer_control.hold("clear") is None
    printer_control.release()


def test_the_owners_printer_buttons_say_which_command_runs(env, monkeypatch):
    c, disp = env
    started, release = threading.Event(), threading.Event()

    def slow(path, key):
        started.set()
        release.wait(5)
        return "ok"
    monkeypatch.setattr(printer_control, "_post", slow)
    t = threading.Thread(target=lambda: clear(env))
    t.start()
    assert started.wait(5)
    try:
        assert printer_control.hold("pause") == "clear"
    finally:
        release.set()
        t.join(5)


@pytest.mark.parametrize("answers, calls_made", [(["no answer"], 1), (["ok", "no answer"], 2)])
def test_clear_plate_timeout_is_not_retried(env, monkeypatch, answers, calls_made):
    post, calls = fake_post(answers + ["ok"] * 5)
    monkeypatch.setattr(printer_control, "_post", post)
    clear(env)
    assert len(calls) == calls_made
    assert len(banners()) == 1


def test_clear_plate_only_when_the_printer_waits_for_it(env, monkeypatch):
    post, calls = fake_post(["ok", "ok"])
    monkeypatch.setattr(printer_control, "_post", post)
    monkeypatch.setattr(sources, "bambuddy_printer",
                        lambda timeout=1: {"connected": True, "bambuddy_state": "RUNNING", "awaiting_plate_clear": True})
    r = clear(env)
    assert r.status_code == 409 and "Nothing was sent" in r.json()["detail"]
    monkeypatch.setattr(sources, "bambuddy_printer", lambda timeout=1: None)
    r = clear(env)
    assert r.status_code == 503
    assert calls == [] and banners() == []
    assert logged("display:clear-plate") == ["refused: offline", "refused: not waiting"]


def test_clear_plate_answers_even_when_banners_are_rate_limited(env, monkeypatch):
    for n in range(6):
        display_messages.post(f"t{n}")
    post, calls = fake_post(["ok", "ok"])
    monkeypatch.setattr(printer_control, "_post", post)
    r = clear(env)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert len(calls) == 2


# ---- Judge it ----

def synced(env, **kw):
    c, _ = env
    r = c.post("/api/lab/hex-tile/sync", json=index(**kw), headers=MAC)
    assert r.status_code == 200, r.text


def verdict(env, run="E-021", request_id="rq-00000000000000a1", grades=None, inconclusive=None, replace=False, **extra):
    c, disp = env
    body = {"run": run, "requestId": request_id, "grades": ALL if grades is None else grades,
            "inconclusive": inconclusive, "replace": replace, **extra}
    return c.post("/api/display/lab/verdict", json=body, headers=disp)


def queued():
    return db.rows("SELECT id, kind, experiment, run, payload, status, by_device FROM lab_requests ORDER BY id")


def test_verdict_queues_one_request_per_id(env):
    import json
    synced(env)
    r = verdict(env)
    assert r.status_code == 202, r.text
    assert r.json() == {"id": "rq-00000000000000a1", "status": "pending"}
    again = verdict(env)
    assert again.status_code == 202 and again.json() == {"id": "rq-00000000000000a1", "status": "pending"}
    rows = queued()
    assert len(rows) == 1
    row = rows[0]
    assert (row["kind"], row["experiment"], row["run"], row["by_device"]) == ("verdict", "E-021", "PR-021-01", "display")
    assert json.loads(row["payload"]) == {"grades": ALL, "lighting": "diagnostic", "note": None, "inconclusive": None,
                                          "replace": False}
    # The Mac's lab pull sees the phone's request, field for field.
    items = env[0].get("/api/lab/hex-tile/requests?status=pending", headers=MAC).json()["items"]
    assert [(i["kind"], i["experiment"], i["run"], i["payload"]["lighting"]) for i in items] == \
        [("verdict", "E-021", "PR-021-01", "diagnostic")]
    # Change it: a new id with replace true is a second request.
    r = verdict(env, request_id="rq-00000000000000a2", replace=True)
    assert r.status_code == 202
    assert [json.loads(x["payload"])["replace"] for x in queued()] == [False, True]
    assert logged("display:verdict") == ["queued", "queued", "queued"]


def test_verdict_retry_after_the_card_moved_answers_the_stored_request(env):
    synced(env)
    assert verdict(env).status_code == 202
    c, _ = env
    c.post("/api/lab/hex-tile/requests/rq-00000000000000a1/result", json={"status": "applied"}, headers=MAC)
    synced(env, needs=[], fingerprint="fp-2")  # the verdict is applied: the judge card has gone
    r = verdict(env)
    assert r.status_code == 202 and r.json() == {"id": "rq-00000000000000a1", "status": "applied"}
    assert len(queued()) == 1
    assert verdict(env, request_id="rq-00000000000000b1").json()["detail"] == MOVED  # a new id is not a retry


def test_verdict_for_a_changed_run_is_refused(env):
    synced(env)
    for run in ("E-022", "PR-021-01", "", None, 21):
        r = verdict(env, run=run)
        assert r.status_code == 409, run
        assert r.json()["detail"] == MOVED
    synced(env, run=None, fingerprint="fp-2")  # no print run to record the verdict on
    r = verdict(env)
    assert r.status_code == 409 and r.json()["detail"] == MOVED
    synced(env, needs=[{"id": "E-021", "action": "Approve or drop", "urgency": 1}], fingerprint="fp-3")
    r = verdict(env)
    assert r.status_code == 409 and r.json()["detail"] == MOVED
    assert queued() == []
    assert set(logged("display:verdict")) == {"refused: moved"}


@pytest.mark.parametrize("grades, inconclusive, problem", [
    ({"A": {"layers": "good", "top": "clean"}}, None, "Judge strip B on Layers, or mark it inconclusive."),
    ({"A": {"layers": "good"}, "B": {"layers": "bad", "top": "rough"}}, None,
     "Judge strip A on Top face, or mark it inconclusive."),
    ({**ALL, "R": {"layers": "good"}}, None, "R isn't a strip of this test."),
    ({"A": {"layers": "good", "top": "clean", "colour": "red"}, "B": ALL["B"]}, None,
     "colour isn't a criterion of this test."),
    ({"A": {"layers": "great", "top": "clean"}, "B": ALL["B"]}, None, "great isn't a choice for Layers."),
    ({"A": ["good"], "B": ALL["B"]}, None, "grades must be {strip: {criterion: choice}}."),
    ([], None, "grades must be {strip: {criterion: choice}}."),
    ({}, "  ", "An inconclusive reason is up to 500 characters of text, or null."),
    ({}, True, "An inconclusive reason is up to 500 characters of text, or null."),
    ({}, "x" * 501, "An inconclusive reason is up to 500 characters of text, or null."),
])
def test_verdict_needs_every_strip_or_a_reason(env, grades, inconclusive, problem):
    synced(env)
    r = verdict(env, grades=grades, inconclusive=inconclusive)
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == problem
    assert queued() == []


def test_verdict_inconclusive_with_some_strips(env):
    import json
    synced(env)
    r = verdict(env, grades={"A": {"layers": "good"}}, inconclusive="  Too dark to see  ")
    assert r.status_code == 202, r.text
    assert json.loads(queued()[0]["payload"]) == {"grades": {"A": {"layers": "good"}}, "lighting": "diagnostic",
                                                 "note": None, "inconclusive": "Too dark to see", "replace": False}


def test_verdict_checks(env):
    c, disp = env
    synced(env)
    assert c.post("/api/display/lab/verdict", json={"run": "E-021"}, headers=SAME).status_code == 401
    r = c.post("/api/display/lab/verdict", content=b"[1]", headers={**disp, "Content-Type": "application/json"})
    assert r.status_code == 400
    r = c.post("/api/display/lab/verdict", content=b"{nope", headers={**disp, "Content-Type": "application/json"})
    assert r.status_code == 400
    r = c.post("/api/display/lab/verdict", content=b"x" * 5000, headers={**disp, "Content-Type": "application/json"})
    assert r.status_code == 413
    assert verdict(env, request_id="rq-1").status_code == 400  # the queue's own id check
    assert queued() == []


def test_verdict_without_criteria_is_for_the_phone(env, monkeypatch):
    c, _ = env
    ix = index()
    ix["records"]["E-021"]["payload"] = {"id": "E-021", "variants": RECORD["variants"], "criteria": []}
    assert c.post("/api/lab/hex-tile/sync", json=ix, headers=MAC).status_code == 200
    r = verdict(env)
    assert r.status_code == 409 and r.json()["detail"] == "Judge it on your phone: this test compares A and B"
    assert queued() == []


# ---- The Judge it sheet (Local AI's GET /api/display/lab/judge, tests/display-lab.test.cjs) ----

def judge(env, run="E-021", key=True):
    c, disp = env
    return c.get("/api/display/lab/judge", params={"run": run}, headers=disp if key else SAME)


@pytest.fixture
def no_local_ai(monkeypatch):
    import urllib.request

    def refuse(*a, **k):
        raise AssertionError("Judge it must not ask Local AI")
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(sources, "localai_feed", refuse)


def test_judge_shape_matches_local_ais(env, no_local_ai):
    c, _ = env
    ix = index()
    rec = dict(RECORD, judge_on="the seam on the top face",
               criteria=[*CRITERIA, {"key": 42, "label": "broken"}])  # the record counts, malformed entries dropped
    ix["records"]["E-021"]["payload"] = rec
    ix["experiments"][0].update(criteria=[{"key": "x", "label": "X", "choices": ["a"]}], judge_on="index's own")
    assert c.post("/api/lab/hex-tile/sync", json=ix, headers=MAC).status_code == 200
    r = judge(env)
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.json() == {"experiment": "E-021", "run": "E-021", "judgeOn": "the seam on the top face",
                        "tabs": ["A", "B"], "criteria": CRITERIA, "judged": None, "pending": None}
    # Sent from the display: judged by the display, with the request's state.
    assert verdict(env).status_code == 202
    body = judge(env).json()
    assert body["judged"]["by"] == "display" and isinstance(body["judged"]["at"], str) and body["judged"]["at"]
    assert body["pending"] == {"id": "rq-00000000000000a1", "status": "pending", "message": None}


def test_judge_from_the_phone_says_phone(env):
    c, _ = env
    synced(env)
    phone = {"id": "rq-00000000000000c1", "kind": "verdict", "experiment": "E-021", "run": "PR-021-01",
             "payload": {"grades": ALL, "lighting": "diagnostic", "note": None, "inconclusive": None, "replace": False}}
    c.cookies.clear()
    assert c.post("/api/signin", json={"password": "long enough"}, headers=SAME).status_code == 200
    assert c.post("/api/lab/hex-tile/requests", json=phone, headers=SAME).status_code == 200
    assert judge(env).json()["judged"]["by"] == "phone"


def test_judge_judge_on_falls_back_to_the_index(env):
    c, _ = env
    ix = index()
    ix["experiments"][0]["judge_on"] = "the top face"
    assert c.post("/api/lab/hex-tile/sync", json=ix, headers=MAC).status_code == 200
    assert judge(env).json()["judgeOn"] == "the top face"
    synced(env, fingerprint="fp-2")
    assert judge(env).json()["judgeOn"] == ""


def test_judge_after_the_verdict_is_applied(env):
    c, _ = env
    synced(env)
    assert verdict(env).status_code == 202
    c.post("/api/lab/hex-tile/requests/rq-00000000000000a1/result", json={"status": "applied", "message": "Recorded."},
           headers=MAC)
    ix = index(needs=[], fingerprint="fp-2")
    ix["experiments"][0].update(status="answered", verdict={"at": "2026-10-31T12:05:00Z", "by": "owner"})
    assert c.post("/api/lab/hex-tile/sync", json=ix, headers=MAC).status_code == 200
    r = judge(env)
    assert r.status_code == 200
    assert r.json() == {"experiment": "E-021", "run": "E-021", "judgeOn": "", "tabs": ["A", "B"], "criteria": CRITERIA,
                        "judged": {"at": "2026-10-31T12:05:00Z", "by": "owner"},
                        "pending": {"id": "rq-00000000000000a1", "status": "applied", "message": "Recorded."}}


def test_judge_nothing_to_judge(env, no_local_ai):
    assert judge(env).status_code == 409  # no lab data at all
    assert judge(env).json()["detail"] == MOVED
    synced(env)
    for run in ("E-022", "PR-021-01", ""):
        r = judge(env, run=run)
        assert r.status_code == 409 and r.json()["detail"] == MOVED, run
    synced(env, needs=[], fingerprint="fp-2")  # the card has gone and nothing was sent from here
    assert judge(env).status_code == 409


def test_judge_needs_the_display_key(env):
    synced(env)
    assert judge(env, key=False).status_code == 401


def test_judge_without_criteria_is_for_the_phone(env):
    c, _ = env
    ix = index()
    ix["records"]["E-021"]["payload"] = {"id": "E-021", "variants": RECORD["variants"]}
    assert c.post("/api/lab/hex-tile/sync", json=ix, headers=MAC).status_code == 200
    assert judge(env).json() == {"experiment": "E-021", "run": "E-021", "judgeOn": "", "phoneOnly": True,
                                 "reason": "Judge it on your phone: this test compares A and B"}
