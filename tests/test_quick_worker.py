"""A19 P3a: the worker channel. Claim, heartbeat, artifact, completion and cancel under fenced attempts; every late or
replaced message refused; restart reconciliation; the Pi's own start-sequence check. A fake Mac drives the routes."""
import hashlib
import io
import json
import os
import struct
import tempfile
import zipfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("QWRK-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, db, lab, lab_guard, quick, quick_check, quick_worker  # noqa: E402

SAME = {"Origin": "http://testserver"}
KEY = "test-mac-key-1234567890abcdef1234567890abcdef"
MAC = {"X-Hub-Mac-Key": KEY}
OCT = {**MAC, "Content-Type": "application/octet-stream"}
BASE = "/api/lab/quick/worker"
WORKER = {"id": "mac-1", "os": "macOS", "studio_version": "02.09.01.70", "presets": ["Standard 0.20 mm PLA, X2D 0.4"]}
GOOD_BLOCK = ["; EXECUTABLE_BLOCK_START", "M73 P0 R5", "  M620 S0A", "  G29", "  M621 S0A", "M109 S220", "T0", "G28",
              "M104 S220", "G1 Z5"]


def gcode(block=GOOD_BLOCK, machine="MS", ids="GFL99") -> str:
    return "\n".join(["; HEADER", *block, "; MACHINE_START_GCODE_END", "G1 X1 Y1 E1", f"; filament_ids = {ids}",
                      f"; machine_start_gcode = {machine}", ""])


def sliced_file(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Metadata/plate_1.gcode", text)
        z.writestr("Metadata/slice_info.config", "<x/>")
    return buf.getvalue()


@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    auth._tries.clear()
    lab._ready_dbs.clear()
    quick._ready_dbs.clear()
    quick_worker._reconciled.clear()
    quick_worker._reconciled.add(os.environ["HUB_DB"])  # a running hub, not just restarted
    key_file = tmp_path / "lab_mac_key.sha256"
    key_file.write_text(hashlib.sha256(KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(key_file))
    monkeypatch.setattr(quick, "QUICK_DIR", tmp_path / "quick")
    monkeypatch.setattr(quick, "free_bytes", lambda: 100 * 1024 ** 3)
    ref = tmp_path / "ref.json"
    ref.write_text(json.dumps({"commands": ["M73", "M620", "G29", "M621", "M109", "T0", "G28"],
                               "machine_start_sha256": hashlib.sha256(b"MS").hexdigest(), "block_lines": 10}))
    monkeypatch.setattr(quick_check, "REFERENCE", ref)
    clock = {"t": 1_800_000_000}
    monkeypatch.setattr(quick_worker, "_now", lambda: clock["t"])
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "QWRK-4321", "owner_password": "long enough"}, headers=SAME).status_code == 200
    c.clock = clock
    return c


def stl(n=2) -> bytes:
    return b"\0" * 80 + struct.pack("<I", n) + b"".join(struct.pack("<12fH", *([0.0] * 12), 0) for _ in range(n))


_n = iter(range(2, 10_000))


def new_job(c, *, queue=True) -> str:
    data = stl(next(_n))
    uid = c.post("/api/quick/uploads", json={"filename": "p.stl", "size": len(data)}, headers=SAME).json()["id"]
    r = c.put(f"/api/quick/uploads/{uid}?offset=0", content=data, headers={**SAME, "Content-Type": "application/octet-stream"})
    assert r.status_code == 200, r.text
    jid = r.json()["job"]["id"]
    if queue:
        assert c.post(f"/api/quick/jobs/{jid}/slice", headers=SAME).status_code == 200
    return jid


def claim(c, worker=WORKER):
    r = c.post(f"{BASE}/claim", json={"worker": worker}, headers=MAC)
    assert r.status_code == 200, r.text
    return r.json()


def claimed(c, worker=WORKER) -> dict:
    j = claim(c, worker)["job"]
    assert j, "nothing to claim"
    return j


def url(j, tail):
    return f"{BASE}/jobs/{j['id']}/attempts/{j['attempt']}/{tail}"


def beat(c, j, phase="slicing", gen=None):
    return c.post(url(j, "heartbeat"), json={"generation": j["generation"] if gen is None else gen, "phase": phase,
                                              "worker": WORKER}, headers=MAC)


def push(c, j, data: bytes, chunk=1024, sha=None):
    off, last = 0, None
    while off < len(data):
        last = c.put(url(j, f"artifact?generation={j['generation']}&offset={off}"), content=data[off:off + chunk],
                     headers={**OCT, "X-Size": str(len(data)), "X-Sha256": sha or hashlib.sha256(data).hexdigest()})
        if last.status_code != 200:
            return last
        off = last.json().get("offset", len(data)) if not last.json().get("done") else len(data)
    return last


def finish(c, j, data: bytes, outcome="sliced", **extra):
    body = {"generation": j["generation"], "outcome": outcome, "artifact": {"sha256": hashlib.sha256(data).hexdigest(),
                                                                         "bytes": len(data)},
            "result": {"minutes": 12.5, "grams": 3.1, "layers": 50, "studio_version": "02.09.01.70"}, **extra}
    return c.post(url(j, "complete"), json=body, headers=MAC)


def job(jid):
    return db.one("SELECT * FROM quick_jobs WHERE id = ?", jid)


def attempt(j):
    return db.one("SELECT * FROM quick_attempts WHERE attempt = ?", j["attempt"])


GOOD = sliced_file(gcode())


# --- claim -----------------------------------------------------------------------------------------------------

def test_a_queued_job_is_claimed_once(env):
    jid = new_job(env)
    assert job(jid)["state"] == "queued"
    j = claimed(env)
    assert j["id"] == jid and j["generation"] == 1 and j["lease_seconds"] == 90 and j["heartbeat_every"] == 15
    assert job(jid)["state"] == "preparing" and job(jid)["slice_reserved"] == quick.MAX_SLICED
    assert j["model"]["sha256"] == job(jid)["model_sha256"] and j["settings"] == {} and j["transform"] is None


def test_two_workers_claim_one_job_and_only_one_wins(env):
    new_job(env)
    first = claim(env)
    second = claim(env, {**WORKER, "id": "mac-2"})
    assert first["job"] and second["job"] is None
    assert db.one("SELECT COUNT(*) AS n FROM quick_attempts WHERE terminal IS NULL")["n"] == 1


def test_the_unique_index_backs_the_claim_up(env):
    jid = new_job(env)
    claimed(env)
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        db.run("INSERT INTO quick_attempts (attempt, job, generation, worker, claimed_at, lease_end, last_heartbeat, phase, "
               "request_hash) VALUES ('x', ?, 2, 'w', 1, 1, 1, 'preparing', 'h')", jid)


def test_a_worker_with_a_live_attempt_claims_nothing_more(env):
    new_job(env)
    new_job(env)
    claimed(env)
    again = claim(env)
    assert again["job"] is None and "already holds" in again["why"]


def test_a_studio_version_off_the_list_claims_nothing(env):
    jid = new_job(env)
    r = claim(env, {**WORKER, "studio_version": "02.10.00.00"})
    assert r["job"] is None and "isn't allowed" in r["why"] and job(jid)["state"] == "queued"
    assert claim(env)["job"]["id"] == jid


@pytest.mark.parametrize("w", [None, {}, {"id": ""}, {"id": "a b"}, {"id": "x" * 41}, {"id": "ok", "presets": "x"},
                               {"id": "ok", "presets": ["x"] * 21}])
def test_a_bad_worker_record_is_refused(env, w):
    assert env.post(f"{BASE}/claim", json={"worker": w}, headers=MAC).status_code == 422


def test_no_key_or_a_wrong_key_is_refused(env):
    assert env.post(f"{BASE}/claim", json={"worker": WORKER}).status_code in (401, 403)
    assert env.post(f"{BASE}/claim", json={"worker": WORKER}, headers={"X-Hub-Mac-Key": "nope"}).status_code == 401


def test_nothing_queued_claims_nothing(env):
    assert claim(env) == {"job": None, "why": None}


def test_a_full_store_fails_the_job_with_the_reason(env, monkeypatch):
    jid = new_job(env)
    monkeypatch.setattr(quick, "QUOTA", 1000)
    r = claim(env)
    assert r["job"] is None and "full" in r["why"]
    assert job(jid)["state"] == "failed" and "room" in job(jid)["reason"]


# --- model -----------------------------------------------------------------------------------------------------

def test_the_worker_downloads_the_model_with_its_sha(env):
    jid = new_job(env)
    j = claimed(env)
    r = env.get(url(j, f"model?generation={j['generation']}"), headers=MAC)
    assert r.status_code == 200 and r.headers["x-sha256"] == job(jid)["model_sha256"]
    assert hashlib.sha256(r.content).hexdigest() == job(jid)["model_sha256"]
    assert env.get(url(j, "model?generation=9"), headers=MAC).json()["reason"] == "generation"


# --- heartbeat, loss and timeout --------------------------------------------------------------------------------

def test_the_first_slicing_beat_moves_the_job_and_every_beat_extends_the_lease(env):
    jid = new_job(env)
    j = claimed(env)
    env.clock["t"] += 60
    assert beat(env, j, "slicing").json() == {"ok": True, "cancel": False, "lease_seconds": 90}
    assert job(jid)["state"] == "slicing" and attempt(j)["lease_end"] == env.clock["t"] + 90
    env.clock["t"] += 80
    assert beat(env, j, "slicing").status_code == 200  # 140 s since the claim, 80 since the last beat


def test_a_crash_during_slicing_is_shown_failed_and_frees_everything(env):
    jid = new_job(env)
    j = claimed(env)
    beat(env, j)
    push(env, j, GOOD[:300], sha="a" * 64)  # a partial artifact is on disk
    assert (quick.QUICK_DIR / "scratch" / jid).exists()
    env.clock["t"] += 91  # no beat for 90 s
    assert env.get("/api/quick/worker", headers=SAME).status_code == 200
    a = attempt(j)
    assert a["terminal"] == "heartbeat_stale" and a["cause"] == "heartbeat_stale"
    assert job(jid)["state"] == "failed" and "stopped reporting" in job(jid)["reason"]
    assert job(jid)["slice_reserved"] == 0 and not (quick.QUICK_DIR / "scratch" / jid).exists()


def test_a_heartbeat_after_the_lease_lapsed_is_refused(env):
    new_job(env)
    j = claimed(env)
    env.clock["t"] += 100
    r = beat(env, j)
    assert r.status_code == 409 and r.json()["reason"] == "expired"
    assert attempt(j)["cause"] == "heartbeat_stale"


def test_a_slice_past_its_timeout_is_a_timeout_not_a_lost_heartbeat(env):
    jid = new_job(env)
    j = claimed(env)
    for _ in range(126):  # beats keep the lease alive past 30 minutes (1890 s)
        env.clock["t"] += 15
        assert beat(env, j).status_code == 200
    env.clock["t"] += 45  # 1935 s: past the 1800 s limit plus the 120 s grace, though the last beat is 45 s old
    r = beat(env, j)
    assert r.status_code == 409 and r.json()["reason"] == "expired"
    assert attempt(j)["cause"] == "slice_timeout" and "longer than 30 minutes" in job(jid)["reason"]


def test_a_bad_phase_or_generation_is_refused(env):
    new_job(env)
    j = claimed(env)
    assert beat(env, j, "napping").status_code == 422
    r = beat(env, j, gen=7)
    assert r.status_code == 409 and r.json()["reason"] == "generation"
    assert beat(env, j, gen=True).json()["reason"] == "generation"


# --- cancel ----------------------------------------------------------------------------------------------------

def test_a_late_heartbeat_after_cancel_is_refused(env):
    jid = new_job(env)
    j = claimed(env)
    beat(env, j)
    assert env.post(f"/api/quick/jobs/{jid}/cancel", headers=SAME).json()["state"] == "canceled"
    r = beat(env, j)
    assert r.status_code == 409 and r.json()["reason"] == "canceled"
    assert job(jid)["slice_reserved"] == 0 and attempt(j)["cancel_requested"] == 1


def test_a_canceled_job_never_publishes_a_later_result(env):
    jid = new_job(env)
    j = claimed(env)
    beat(env, j)
    assert push(env, j, GOOD).json()["done"]
    env.post(f"/api/quick/jobs/{jid}/cancel", headers=SAME)
    r = finish(env, j, GOOD)
    assert r.status_code == 409 and r.json()["reason"] == "canceled"
    assert job(jid)["state"] == "canceled" and not (quick.QUICK_DIR / "slices").exists()


def test_cancel_during_artifact_publication_publishes_nothing(env):
    jid = new_job(env)
    j = claimed(env)
    beat(env, j)
    size = len(GOOD)
    h = {**OCT, "X-Size": str(size), "X-Sha256": hashlib.sha256(GOOD).hexdigest()}
    assert env.put(url(j, f"artifact?generation=1&offset=0"), content=GOOD[:200], headers=h).json() == {"done": False, "offset": 200}
    env.post(f"/api/quick/jobs/{jid}/cancel", headers=SAME)
    r = env.put(url(j, "artifact?generation=1&offset=200"), content=GOOD[200:], headers=h)
    assert r.status_code == 409 and r.json()["reason"] == "canceled"
    assert not (quick.QUICK_DIR / "scratch" / jid).exists() and not (quick.QUICK_DIR / "slices").exists()


def test_canceling_a_queued_job_resolves_its_request(env):
    jid = new_job(env)
    assert db.one("SELECT status FROM lab_requests WHERE experiment = ?", jid)["status"] == "pending"
    env.post(f"/api/quick/jobs/{jid}/cancel", headers=SAME)
    assert db.one("SELECT status FROM lab_requests WHERE experiment = ?", jid)["status"] == "refused"
    assert claim(env)["job"] is None


# --- artifact and completion ------------------------------------------------------------------------------------

def test_a_valid_completion_publishes_the_slice(env):
    jid = new_job(env)
    j = claimed(env)
    beat(env, j)
    r = push(env, j, GOOD)
    assert r.json() == {"done": True, "sha256": hashlib.sha256(GOOD).hexdigest(), "bytes": len(GOOD)}
    assert job(jid)["state"] == "validating"
    r = finish(env, j, GOOD)
    assert r.status_code == 200 and r.json() == {"ok": True, "state": "sliced"}
    row = job(jid)
    assert row["slice_sha256"] == hashlib.sha256(GOOD).hexdigest() and row["sliced_hash"] == row["request_hash"]
    assert (quick.QUICK_DIR / "slices" / f"{jid}.gcode.3mf").read_bytes() == GOOD
    assert row["slice_reserved"] == 0 and not (quick.QUICK_DIR / "scratch" / jid).exists()
    info = env.get(f"/api/quick/jobs/{jid}", headers=SAME).json()["slice_info"]
    assert info["minutes"] == 12.5 and info["layers"] == 50 and info["start_block_lines"] == 10
    assert db.one("SELECT status FROM lab_requests WHERE experiment = ?", jid)["status"] == "applied"
    assert attempt(j)["terminal"] == "completed"
    quick.transition(jid, "staging")  # and it can now be staged


def test_a_duplicate_completion_is_refused(env):
    jid = new_job(env)
    j = claimed(env)
    push(env, j, GOOD)
    assert finish(env, j, GOOD).status_code == 200
    r = finish(env, j, GOOD)
    assert r.status_code == 409 and r.json()["reason"] == "terminal"
    assert (quick.QUICK_DIR / "slices" / f"{jid}.gcode.3mf").read_bytes() == GOOD  # the published file is untouched


def test_a_wrong_sha_is_refused_at_the_upload(env):
    jid = new_job(env)
    j = claimed(env)
    r = push(env, j, GOOD, sha="b" * 64)
    assert r.status_code == 422 and r.json()["reason"] == "sha"
    assert attempt(j)["artifact_sha"] is None and not (quick.QUICK_DIR / "slices").exists()
    assert push(env, j, GOOD).json()["done"]  # a clean retry from offset 0 works


def test_completion_naming_another_artifact_is_refused(env):
    jid = new_job(env)
    j = claimed(env)
    push(env, j, GOOD)
    other = sliced_file(gcode(ids="X"))
    r = finish(env, j, other)
    assert r.status_code == 422 and r.json()["reason"] == "artifact" and job(jid)["state"] == "validating"
    assert env.post(url(j, "complete"), json={"generation": 1, "outcome": "sliced"}, headers=MAC).status_code == 422


def test_a_bad_start_sequence_is_refused_on_the_pi_even_when_the_mac_says_sliced(env):
    jid = new_job(env)
    j = claimed(env)
    loose = sliced_file(gcode(block=["; EXECUTABLE_BLOCK_START", "M73 P0", "G28"], machine="OTHER", ids=""))
    push(env, j, loose)
    r = finish(env, j, loose)
    assert r.json() == {"ok": True, "state": "needs_attention"}
    assert job(jid)["state"] == "needs_attention" and "start sequence" in job(jid)["reason"]
    assert "missing" in job(jid)["reason"] and not (quick.QUICK_DIR / "slices").exists()
    with pytest.raises(quick.QuickError):
        quick.transition(jid, "staging")


@pytest.mark.parametrize("data", [b"not a zip", sliced_file("G28\n")])
def test_a_file_that_isnt_a_sliced_plate_is_refused_on_the_pi(env, data):
    jid = new_job(env)
    j = claimed(env)
    push(env, j, data)
    assert finish(env, j, data).json()["state"] == "needs_attention"


def test_a_studio_version_off_the_list_in_the_result_is_refused(env):
    jid = new_job(env)
    j = claimed(env)
    push(env, j, GOOD)
    body = {"generation": 1, "outcome": "sliced", "artifact": {"sha256": hashlib.sha256(GOOD).hexdigest(), "bytes": len(GOOD)},
            "result": {"studio_version": "01.00.00.00"}}
    assert env.post(url(j, "complete"), json=body, headers=MAC).json()["state"] == "needs_attention"
    assert "allow" in job(jid)["reason"]


def test_the_artifact_resumes_from_what_the_hub_has_and_is_chunk_limited(env):
    new_job(env)
    j = claimed(env)
    h = {**OCT, "X-Size": str(len(GOOD)), "X-Sha256": hashlib.sha256(GOOD).hexdigest()}
    assert env.put(url(j, "artifact?generation=1&offset=0"), content=GOOD[:100], headers=h).json()["offset"] == 100
    assert env.get(url(j, "artifact?generation=1"), headers=MAC).json() == {"offset": 100}
    r = env.put(url(j, "artifact?generation=1&offset=0"), content=GOOD[:100], headers=h)
    assert r.status_code == 409 and r.json()["reason"] == "offset" and r.json()["offset"] == 100
    r = env.put(url(j, "artifact?generation=1&offset=100"), content=GOOD[100:] + b"x", headers=h)
    assert r.status_code == 413
    assert push(env, j, GOOD[100:], chunk=100000).status_code in (409, 200)  # sanity: server stays usable
    for bad in ({"X-Size": "0"}, {"X-Sha256": "zz"}, {"X-Size": str(quick.MAX_SLICED + 1)}):
        r = env.put(url(j, "artifact?generation=1&offset=100"), content=b"x", headers={**h, **bad})
        assert r.status_code == 422


# --- late and replaced attempts ---------------------------------------------------------------------------------

def test_a_late_artifact_after_a_timeout_is_refused(env):
    jid = new_job(env)
    j = claimed(env)
    env.clock["t"] += 100
    h = {**OCT, "X-Size": str(len(GOOD)), "X-Sha256": hashlib.sha256(GOOD).hexdigest()}
    r = env.put(url(j, "artifact?generation=1&offset=0"), content=GOOD, headers=h)
    assert r.status_code == 409 and r.json()["reason"] == "expired"
    assert job(jid)["state"] == "failed" and not (quick.QUICK_DIR / "scratch" / jid).exists()


def test_an_old_artifact_after_a_replacement_attempt_began_is_refused(env):
    jid = new_job(env)
    old = claimed(env)
    push(env, old, GOOD)
    env.clock["t"] += 100
    claim(env, {**WORKER, "id": "mac-2"})  # reaps the old attempt; the job is failed, nothing to claim yet
    assert job(jid)["state"] == "failed"
    assert env.post(f"/api/quick/jobs/{jid}/slice", headers=SAME).status_code == 200
    new = claimed(env, {**WORKER, "id": "mac-2"})
    assert new["generation"] == 2 and new["attempt"] != old["attempt"]
    h = {**OCT, "X-Size": str(len(GOOD)), "X-Sha256": hashlib.sha256(GOOD).hexdigest()}
    env.put(url(new, "artifact?generation=2&offset=0"), content=GOOD[:200], headers=h)  # the new attempt's partial
    r = finish(env, old, GOOD)
    assert r.status_code == 409 and r.json()["reason"] == "superseded"
    r = push(env, old, GOOD)
    assert r.status_code == 409 and r.json()["reason"] == "superseded"
    assert (quick.QUICK_DIR / "scratch" / jid / f"{new['attempt']}.part").stat().st_size == 200  # untouched
    assert job(jid)["state"] in ("validating", "preparing")


def test_an_attempt_of_another_job_or_unknown_id_is_not_found(env):
    new_job(env)
    j = claimed(env)
    ok = {"generation": 1, "phase": "slicing", "worker": WORKER}
    assert env.post(f"{BASE}/jobs/{'0' * 16}/attempts/{j['attempt']}/heartbeat", json=ok, headers=MAC).status_code == 404
    assert env.post(f"{BASE}/jobs/{j['id']}/attempts/{'f' * 16}/heartbeat", json=ok, headers=MAC).status_code == 404
    assert env.post(f"{BASE}/jobs/zz/attempts/{j['attempt']}/heartbeat", json=ok, headers=MAC).status_code == 404


def test_a_changed_job_ends_the_attempt_as_stale(env):
    jid = new_job(env)
    j = claimed(env)
    db.run("UPDATE quick_jobs SET request_hash = 'changed' WHERE id = ?", jid)
    r = beat(env, j)
    assert r.status_code == 409 and r.json()["reason"] == "terminal" or attempt(j)["cause"] == "stale"
    assert attempt(j)["cause"] == "stale" and job(jid)["state"] == "failed"


# --- restart ----------------------------------------------------------------------------------------------------

def test_restart_while_slicing_ends_a_lapsed_attempt_before_any_claim(env):
    jid = new_job(env)
    j = claimed(env)
    beat(env, j)
    env.clock["t"] += 200  # the hub was down; the lease lapsed
    quick_worker._reconciled.clear()  # a fresh process
    new_job(env)
    claim(env, {**WORKER, "id": "mac-2"})
    assert attempt(j)["cause"] == "attempt_expired" and job(jid)["state"] == "failed"
    assert "restarted" in job(jid)["reason"]
    r = beat(env, j)  # the worker returns later and finds its attempt refused
    assert r.status_code == 409 and r.json()["reason"] == "expired"


def test_restart_keeps_an_attempt_whose_lease_is_still_good(env):
    jid = new_job(env)
    j = claimed(env)
    beat(env, j)
    env.clock["t"] += 30
    quick_worker._reconciled.clear()
    quick._ready_dbs.clear()
    assert beat(env, j).status_code == 200 and job(jid)["state"] == "slicing"


# --- the worker record and the page's facts ---------------------------------------------------------------------

def test_a_worker_never_heard_from_reads_no_worker_yet(env):
    r = env.get("/api/quick/worker", headers=SAME).json()
    assert r["state"] == "none" and "No worker yet" in r["text"] and r["allowed_versions"] == ["02.09.01.70"]


def test_idle_busy_and_asleep(env):
    claim(env)
    assert env.get("/api/quick/worker", headers=SAME).json()["state"] == "idle"
    new_job(env)
    j = claimed(env)
    beat(env, j)
    r = env.get("/api/quick/worker", headers=SAME).json()
    assert r["state"] == "busy" and r["phase"] == "slicing" and r["job"] == j["id"]
    assert r["studio_version"] == "02.09.01.70" and r["presets"] == WORKER["presets"]
    env.clock["t"] += 181
    r = env.get("/api/quick/worker", headers=SAME).json()
    assert r["state"] == "asleep" and "Mac asleep, last seen 3 min ago" == r["text"]  # never "idle"


@pytest.mark.parametrize("cause", quick_worker.CAUSES)
def test_every_failure_cause_is_kept_apart_and_shown(env, cause):
    jid = new_job(env)
    j = claimed(env)
    r = env.post(url(j, "complete"), json={"generation": 1, "outcome": "failed", "cause": cause}, headers=MAC)
    assert r.json() == {"ok": True, "state": "failed"}
    assert job(jid)["reason"] == quick_worker.REASONS[cause]
    attempts = env.get(f"/api/quick/jobs/{jid}/attempts", headers=SAME).json()["attempts"]
    assert attempts[0]["cause"] == cause and attempts[0]["terminal"] == "failed"


def test_the_failure_texts_are_all_different():
    assert len(set(quick_worker.REASONS.values())) == len(quick_worker.REASONS)


def test_a_needs_attention_report_and_a_bad_report(env):
    jid = new_job(env)
    j = claimed(env)
    r = env.post(url(j, "complete"), json={"generation": 1, "outcome": "needs_attention", "message": "Odd output"}, headers=MAC)
    assert r.json()["state"] == "needs_attention" and job(jid)["reason"] == "Odd output"
    jid2 = new_job(env)
    j2 = claimed(env)
    for body in ({"generation": 1, "outcome": "maybe"}, {"generation": 1, "outcome": "failed", "cause": "bored"},
                 {"generation": 1, "outcome": "failed", "message": "x" * 301}):
        assert env.post(url(j2, "complete"), json=body, headers=MAC).status_code == 422


# --- owner side -------------------------------------------------------------------------------------------------

def test_slice_is_owner_only_and_makes_a_request_row(env):
    jid = new_job(env, queue=False)
    env.cookies.clear()
    assert env.post(f"/api/quick/jobs/{jid}/slice", headers=SAME).status_code == 401
    assert env.get("/api/quick/worker", headers=SAME).status_code == 401
    assert env.get(f"/api/quick/jobs/{jid}/attempts", headers=SAME).status_code == 401
    env.post("/api/signin", json={"password": "long enough"}, headers=SAME)
    r = env.post(f"/api/quick/jobs/{jid}/slice", headers=SAME)
    assert r.json()["state"] == "queued"
    row = db.one("SELECT * FROM lab_requests WHERE experiment = ?", jid)
    assert row["project"] == "quick" and row["kind"] == "slice" and row["status"] == "pending"
    assert env.post(f"/api/quick/jobs/{jid}/slice", headers=SAME).status_code == 409  # already queued


def test_the_mac_cant_see_quick_requests_through_the_lab_routes(env):
    new_job(env)
    r = env.get("/api/lab/quick/requests?status=pending", headers=MAC)
    assert r.status_code in (400, 404, 405)


def test_the_pending_cap_refuses_more_slices(env, monkeypatch):
    monkeypatch.setattr(quick_worker, "PENDING_CAP", 1)
    new_job(env)
    jid = new_job(env, queue=False)
    assert env.post(f"/api/quick/jobs/{jid}/slice", headers=SAME).status_code == 429
    assert job(jid)["state"] == "draft"  # nothing half-moved


def test_reslicing_a_stale_job_makes_generation_two_and_a_current_slice(env):
    jid = new_job(env)
    j = claimed(env)
    push(env, j, GOOD)
    finish(env, j, GOOD)
    env.patch(f"/api/quick/jobs/{jid}", json={"settings": {"wall_loops": 4}}, headers=SAME)
    assert job(jid)["state"] == "stale"
    assert env.post(f"/api/quick/jobs/{jid}/slice", headers=SAME).json()["state"] == "queued"
    j2 = claimed(env)
    assert j2["generation"] == 2 and j2["settings"] == {"wall_loops": 4}


def test_vendored_reference_is_well_formed_and_rejects_a_loose_start():
    ref = quick_check.load_reference(quick_check.REFERENCE.parent / "quick_start_reference.json")
    assert len(ref["commands"]) > 100 and ref["block_lines"] == 404 and "M620" in ref["commands"]
    import tempfile as _t
    from pathlib import Path
    with _t.TemporaryDirectory() as d:
        p = Path(d) / "loose.gcode.3mf"
        p.write_bytes(sliced_file(gcode(block=["; EXECUTABLE_BLOCK_START", "M73 P0 R5", "M106 S0", "G28"])))
        ok, reasons, lines = quick_check.check_artifact(p, ref)
    assert not ok and lines == 4 and any("missing" in r for r in reasons)


# --- hardening of the Pi's check and the publish path ------------------------------------------------------------

def _check(tmp_path, data: bytes):
    p = tmp_path / "f.gcode.3mf"
    p.write_bytes(data)
    return quick_check.check_artifact(p, quick_check.load_reference(quick_check.REFERENCE))


def _zip(entries: list) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in entries:
            z.writestr(name, text)
    return buf.getvalue()


def test_the_good_file_passes_the_pi_check(env, tmp_path):
    assert _check(tmp_path, GOOD)[0] is True


def test_duplicate_entry_names_are_refused(env, tmp_path):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", gcode(["; EXECUTABLE_BLOCK_START", "G28"], "x", "")),
                                                 ("Metadata/plate_1.gcode", gcode())]))
    assert not ok and "duplicate" in reasons[0]


def test_another_plates_gcode_is_refused(env, tmp_path):
    ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", gcode()), ("Metadata/plate_2.gcode", gcode())]))
    assert not ok and "more than one plate" in reasons[0]


def test_code_before_the_start_block_is_refused(env, tmp_path):
    ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", "G28\n" + gcode())]))
    assert not ok and "before the start block" in reasons[0]


def test_an_overlong_line_is_refused_without_being_held(env, tmp_path, monkeypatch):
    monkeypatch.setattr(quick_check, "MAX_LINE", 1000)
    ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", gcode() + "; " + "x" * 5000 + "\n")]))
    assert not ok and "longer than" in reasons[0]


def test_a_runaway_start_block_is_cut_off(env, tmp_path):
    big = ["; EXECUTABLE_BLOCK_START"] + ["G1 X1"] * 5000
    ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", gcode(big))]))
    assert not ok and "longer than" in reasons[0]


def test_lines_split_across_reads_are_whole(env, tmp_path, monkeypatch):
    monkeypatch.setattr(quick_check, "READ", 7)  # every line straddles several reads
    assert _check(tmp_path, GOOD)[0] is True


def test_no_more_bytes_after_an_artifact_is_complete(env):
    jid = new_job(env)
    j = claimed(env)
    assert push(env, j, GOOD).json()["done"]
    h = {**OCT, "X-Size": str(len(GOOD) + 5), "X-Sha256": hashlib.sha256(GOOD).hexdigest()}
    r = env.put(url(j, f"artifact?generation=1&offset={len(GOOD)}"), content=b"extra", headers=h)
    assert r.status_code == 409 and r.json()["reason"] == "uploaded"
    r = env.put(url(j, "artifact?generation=1&offset=0"), content=GOOD, headers=h)
    assert r.status_code == 409 and r.json()["reason"] == "uploaded"


def test_what_is_published_is_the_file_that_was_checked(env):
    jid = new_job(env)
    j = claimed(env)
    push(env, j, GOOD)
    assert finish(env, j, GOOD).json()["state"] == "sliced"
    final = quick.QUICK_DIR / "slices" / f"{jid}.gcode.3mf"
    assert hashlib.sha256(final.read_bytes()).hexdigest() == job(jid)["slice_sha256"]
    assert not list(final.parent.glob("*.old")) and not (quick.QUICK_DIR / "scratch" / jid).exists()


def test_a_replaced_slice_keeps_the_old_one_until_the_new_commit(env, monkeypatch):
    jid = new_job(env)
    j = claimed(env)
    push(env, j, GOOD)
    finish(env, j, GOOD)
    first = (quick.QUICK_DIR / "slices" / f"{jid}.gcode.3mf").read_bytes()
    env.patch(f"/api/quick/jobs/{jid}", json={"settings": {"wall_loops": 3}}, headers=SAME)
    env.post(f"/api/quick/jobs/{jid}/slice", headers=SAME)
    j2 = claimed(env)
    second = sliced_file(gcode(ids="GFL98"))
    push(env, j2, second)
    monkeypatch.setattr(quick_worker, "_end", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        finish(env, j2, second)
    assert (quick.QUICK_DIR / "slices" / f"{jid}.gcode.3mf").read_bytes() == first


def test_a_carriage_return_is_refused(env, tmp_path):
    hidden = gcode().replace("; HEADER", "; HEADER\rG28", 1)  # a reader splitting on \r would see code before the block
    ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", hidden)]))
    assert not ok and "carriage return" in reasons[0]
    ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", gcode().replace("\n", "\r\n"))]))
    assert not ok and "carriage return" in reasons[0]


@pytest.mark.parametrize("other", ["metadata/plate_1.gcode", "Metadata\\plate_1.gcode", "/Metadata/plate_1.gcode",
                                   "./Metadata/plate_1.gcode", "METADATA/PLATE_1.GCODE", "Metadata/plate_01.gcode"])
def test_a_lookalike_plate_name_is_refused(env, tmp_path, other):
    ok, reasons, _ = _check(tmp_path, _zip([("Metadata/plate_1.gcode", gcode()), (other, gcode(["; EXECUTABLE_BLOCK_START", "G28"]))]))
    assert not ok and ("duplicate" in reasons[0] or "more than one plate" in reasons[0])


def test_a_plate_spelled_unexpectedly_alone_is_refused(env, tmp_path):
    ok, reasons, _ = _check(tmp_path, _zip([("METADATA/plate_1.gcode", gcode())]))
    assert not ok
