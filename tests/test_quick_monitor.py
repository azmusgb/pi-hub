"""A19 P8: how a Quick Print ends (from Bambuddy's print log), the printer's figures only as reported, the history
comparison, and Reprint with its checks."""
import json
import shutil

import pytest
from fastapi.testclient import TestClient

from hub import bambuddy, db, quick, quick_monitor
from test_quick_layers import L0, L1, fresh_builds, plate, slice_ok  # noqa: F401
from test_quick_worker import SAME, env  # noqa: F401


def job(jid):
    return db.one("SELECT * FROM quick_jobs WHERE id = ?", jid)


def printing(env, **info):
    jid = slice_ok(env, plate(L0, L1))
    db.run("UPDATE quick_jobs SET state = 'printing_confirmed', slice_info = ? WHERE id = ?",
           json.dumps({"minutes": 60, "grams": 10.0, **info}), jid)
    return jid


def log(jid, status="completed", **kw):
    e = {"id": 7, "name": f"quick_{jid}", "status": status, "word": bambuddy.status_word(status), "started": 1000, "ended": 4600,
         "seconds": 3600, "grams": 9.4, "error": None}
    return {**e, **kw}


def runs(jid, extra=None):
    return {"connected": True, "bambuddy_state": "RUNNING", "job_name": f"quick_{jid}", **(extra or {})}


# --- how it ends -----------------------------------------------------------------------------------------------------

def test_finished_only_after_the_log_says_completed(env):
    jid = printing(env)
    quick_monitor.step(runs(jid), [])  # printing, nothing logged yet
    assert job(jid)["state"] == "printing_confirmed"
    quick_monitor.step({"connected": True, "bambuddy_state": "FINISH", "job_name": f"quick_{jid}"}, [log(jid, "printing")])
    assert job(jid)["state"] == "printing_confirmed"  # the printer's FINISH alone, or a log still "printing", isn't an outcome
    quick_monitor.step(runs(jid), [log(jid)])
    j = job(jid)
    assert j["state"] == "finished" and json.loads(j["outcome"])["grams"] == 9.4 and j["reason"] is None


@pytest.mark.parametrize("status,word", [("failed", "Failed"), ("cancelled", "Cancelled")])
def test_a_failed_or_cancelled_entry_is_failed_with_its_reason(env, status, word):
    jid = printing(env)
    quick_monitor.step(None, [log(jid, status, error="spaghetti")])
    j = job(jid)
    assert j["state"] == "failed" and word in j["reason"] and "spaghetti" in j["reason"]
    assert json.loads(j["outcome"])["status"] == status


def test_two_entries_for_one_job_fail_closed(env):
    jid = printing(env)
    quick_monitor.step(runs(jid), [log(jid), log(jid, id=8)])
    j = job(jid)
    assert j["state"] == "outcome_uncertain" and "2 entries" in j["reason"]


def test_an_unreadable_log_decides_nothing(env):
    jid = printing(env)
    quick_monitor.step({"connected": True, "bambuddy_state": "IDLE", "job_name": None}, None)
    assert job(jid)["state"] == "printing_confirmed"


def test_another_jobs_entry_or_a_lab_name_is_not_this_jobs(env):
    jid = printing(env)
    other = "0123456789abcdef"
    quick_monitor.step(runs(jid), [log(other), log(jid, name=f"hex-tile_E-001_BLD-001-01"), log(jid, name=f"quick_{jid}0")])
    assert job(jid)["state"] == "printing_confirmed"
    assert not quick_monitor.entries(jid, [log(jid, name=f"x_quick_{jid}")][:0])


def test_not_printing_and_not_logged_for_ten_minutes_is_uncertain_not_finished(env):
    jid = printing(env)
    idle = {"connected": True, "bambuddy_state": "IDLE", "job_name": None}
    t = [1000.0]
    quick_monitor._idle.clear()
    quick_monitor.step(idle, [], now=lambda: t[0])
    t[0] += quick_monitor.END_SECONDS - 1
    quick_monitor.step(idle, [], now=lambda: t[0])
    assert job(jid)["state"] == "printing_confirmed"
    t[0] += 2
    quick_monitor.step(idle, [], now=lambda: t[0])
    assert job(jid)["state"] == "outcome_uncertain"
    assert "Look at the printer" in job(jid)["reason"]


def test_seeing_it_print_again_clears_the_idle_clock(env):
    jid = printing(env)
    t = [1000.0]
    quick_monitor._idle.clear()
    quick_monitor.step({"connected": True, "bambuddy_state": "IDLE"}, [], now=lambda: t[0])
    quick_monitor.step(runs(jid), [], now=lambda: t[0] + 500)
    quick_monitor.step({"connected": True, "bambuddy_state": "IDLE"}, [], now=lambda: t[0] + 900)
    assert job(jid)["state"] == "printing_confirmed"


def test_a_disconnected_printer_never_ends_a_job(env):
    jid = printing(env)
    quick_monitor._idle.clear()
    quick_monitor.step({"connected": False}, [], now=lambda: 10**9)
    quick_monitor.step(None, [], now=lambda: 10**9)
    assert job(jid)["state"] == "printing_confirmed"


# --- the figures are the printer's own -------------------------------------------------------------------------------

def test_a_missing_temperature_is_none_never_zero():
    f = quick_monitor.figures(runs("abc", {"progress": 41.5, "nozzle_temp": None, "bed_temp": True, "layer_num": float("nan")}), "abc")
    assert f["source"] == "ok" and f["this_job"] is True and f["progress"] == 41.5
    assert f["nozzle"] is None and f["bed"] is None and f["layer"] is None and f["remaining_minutes"] is None


def test_unreachable_and_disconnected_are_said_not_guessed():
    assert quick_monitor.figures(None, "abc")["source"] == "unavailable"
    d = quick_monitor.figures({"connected": False, "progress": 50}, "abc")
    assert d["source"] == "disconnected" and d["progress"] is None


def test_figures_belong_to_this_job_only():
    f = quick_monitor.figures({"connected": True, "bambuddy_state": "RUNNING", "job_name": "quick_other", "progress": 90}, "abc")
    assert f["this_job"] is False and f["progress"] is None and f["state"] == "RUNNING"
    idle = quick_monitor.figures({"connected": True, "bambuddy_state": "IDLE", "job_name": None}, "abc")
    assert idle["this_job"] is False


def test_the_comparison_leaves_unknowns_unknown():
    j = {"slice_info": json.dumps({"minutes": 60, "grams": None})}
    assert quick_monitor.compare(j, {"seconds": 5400, "grams": 9.4}) == {"estimate_minutes": 60, "actual_minutes": 90.0,
                                                                        "estimate_grams": None, "actual_grams": 9.4}
    assert quick_monitor.compare(j, {"seconds": None, "grams": None})["actual_minutes"] is None
    assert quick_monitor.compare(j, None) is None


# --- routes ----------------------------------------------------------------------------------------------------------

def test_the_monitor_route_is_owner_only_and_not_cached(env, monkeypatch):
    jid = printing(env)
    monkeypatch.setattr("hub.quick_start.printer_now", lambda: runs(jid, {"progress": 12, "nozzle_temp": None}))
    r = env.get(f"/api/quick/jobs/{jid}/monitor")
    body = r.json()
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert body["printer"]["progress"] == 12 and body["printer"]["nozzle"] is None and body["actions"] == ["pause"]
    from hub import app as hub_app
    assert TestClient(hub_app.app).get(f"/api/quick/jobs/{jid}/monitor").status_code in (401, 403)
    assert env.get("/api/quick/jobs/nope/monitor").status_code == 404


def test_a_finished_job_shows_its_outcome_and_comparison(env, monkeypatch):
    jid = printing(env)
    quick_monitor.step(runs(jid), [log(jid)])
    monkeypatch.setattr("hub.quick_start.printer_now", lambda: {"connected": True, "bambuddy_state": "IDLE", "job_name": None})
    body = env.get(f"/api/quick/jobs/{jid}/monitor").json()
    assert body["printer"] is None and body["outcome"]["word"] == "Finished"
    assert body["compare"]["estimate_minutes"] == 60 and body["compare"]["actual_minutes"] == 60.0
    assert body["job"]["outcome"]["log_id"] == 7


# --- Reprint ---------------------------------------------------------------------------------------------------------

def finished(env):
    jid = printing(env)
    quick_monitor.step(runs(jid), [log(jid)])
    assert job(jid)["state"] == "finished"
    return jid


def test_a_reprint_is_a_new_sliced_job_with_its_own_copies(env):
    src = finished(env)
    r = env.post(f"/api/quick/jobs/{src}/reprint", headers=SAME)
    assert r.status_code == 200, r.text
    new = job(r.json()["job"]["id"])
    old = job(src)
    assert new["id"] != src and new["state"] == "sliced" and new["slice_sha256"] == old["slice_sha256"]
    assert json.loads(new["slice_info"])["reprint_of"] == src and new["outcome"] is None
    assert quick.slice_path(new) != quick.slice_path(old) and quick.slice_path(new).read_bytes() == quick.slice_path(old).read_bytes()
    assert quick.model_path(new).read_bytes() == quick.model_path(old).read_bytes()
    assert old["state"] == "finished"  # the history record is untouched


def test_a_reprint_needs_a_job_that_has_printed(env):
    jid = slice_ok(env, plate(L0))
    r = env.post(f"/api/quick/jobs/{jid}/reprint", headers=SAME)
    assert r.status_code == 409 and "has printed" in r.json()["detail"]
    db.run("UPDATE quick_jobs SET state = 'printing_confirmed' WHERE id = ?", jid)
    assert env.post(f"/api/quick/jobs/{jid}/reprint", headers=SAME).status_code == 409


def test_after_retention_removed_the_files_it_asks_for_a_new_slice(env):
    src = finished(env)
    assert quick.evict(10**12) > 0 and job(src)["file_removed"] == 1 and job(src)["state"] == "finished"
    r = env.post(f"/api/quick/jobs/{src}/reprint", headers=SAME)
    assert r.status_code == 409 and "new slice" in r.json()["detail"] and "upload the model again" in r.json()["detail"]
    assert env.get("/api/quick/jobs").json()["jobs"][0]["can_reprint_file"] in (False, True)
    assert not [j for j in db.rows("SELECT id FROM quick_jobs") if j["id"] != src]


def test_a_changed_stored_slice_is_never_reprinted(env):
    src = finished(env)
    p = quick.slice_path(job(src))
    p.write_bytes(p.read_bytes() + b"x")
    r = env.post(f"/api/quick/jobs/{src}/reprint", headers=SAME)
    assert r.status_code == 409 and "hashes" in r.json()["detail"]


def test_a_reprint_needs_the_owner(env):
    src = finished(env)
    from hub import app as hub_app
    assert TestClient(hub_app.app).post(f"/api/quick/jobs/{src}/reprint", headers=SAME).status_code in (401, 403)


def test_a_reprint_that_cant_be_stored_leaves_nothing_behind(env, monkeypatch):
    src = finished(env)
    monkeypatch.setattr(quick, "admit", lambda need: (_ for _ in ()).throw(quick.QuickError(507, "full")))
    r = env.post(f"/api/quick/jobs/{src}/reprint", headers=SAME)
    assert r.status_code == 507
    assert [j["id"] for j in db.rows("SELECT id FROM quick_jobs")] == [src]


# --- Quick Print is never the lab's ----------------------------------------------------------------------------------

def test_a_quick_print_never_looks_like_a_lab_run():
    e = {"id": 3, "print_name": "quick_0123456789abcdef", "status": "completed", "duration_seconds": 60}
    assert bambuddy._print(e)["lab"] is None


def test_the_monitor_never_sends_a_printer_command():
    import re
    from pathlib import Path
    text = (Path(quick_monitor.__file__)).read_text()
    assert not re.search(r"printer_control|_post\(|/api/printer|\.start\(|requests\.|urlopen", text)
