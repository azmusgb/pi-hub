import json
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hubapp, db, events, needs, records, releases  # noqa: E402
from tests.helpers_records import T, inputs  # noqa: E402

client = TestClient(hubapp.app)
A, B, C = "a" * 40, "b" * 40, "c" * 40


def iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def report(commit=A, result="deployed", at=T, **kw):
    return {"commit": commit, "result": result, "at": iso(at), "mechanism": "pi-hub-release", **kw}


def put(target="pi-hub", now=T + 10, **kw):
    r = releases.valid(target, report(**kw), now)
    assert r is not None
    return releases.put(target, r, now)


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch, tmp_path):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    releases._refused.clear()
    events._forget()
    monkeypatch.setattr(events, "push", lambda *a, **k: "Sent.")
    monkeypatch.setattr(releases, "INBOX", str(tmp_path / "inbox"))
    monkeypatch.setattr(releases, "CURRENT", str(tmp_path / "missing"))
    events.ready()
    records.refresh(T, inputs=inputs())
    yield
    records._subscribers.clear()


def test_unknown_targets_are_seeded():
    releases.seed(T)
    for target in releases.TARGETS:
        r = records.get("release:" + target)
        assert (r["state"], r["severity"], r["headline"]) == ("unknown", "info", "Not publishing yet")


def test_deployed_sets_live_and_commit():
    r = put()
    assert (r["state"], r["severity"], r["detail"]["commit"], r["source"]) == ("live", "ok", A, "pi-hub-release")
    assert r["headline"] == "aaaaaaa is live" and r["detail"]["deployed_at"] == T


def test_failed_keeps_commit_and_sets_last():
    put()
    r = put(commit=B, result="failed", at=T + 5, message="Tests failed; nothing changed.")
    assert (r["state"], r["severity"], r["detail"]["commit"]) == ("live", "attention", A)
    assert r["detail"]["last"]["commit"] == B and r["detail"]["last"]["result"] == "failed"
    assert r["headline"] == "Pi Hub deploy failed: aaaaaaa is still running"
    assert r["cause"] == "Tests failed; nothing changed."


def test_rolled_back_keeps_restored_commit():
    put()
    r = put(commit=B, result="rolled-back", running=A, at=T + 5)
    assert (r["detail"]["commit"], r["detail"]["last"]["commit"], r["severity"]) == (A, B, "attention")
    assert r["headline"] == "Pi Hub deploy of bbbbbbb was rolled back: aaaaaaa is running"


def test_rolled_back_needs_running():
    assert releases.valid("pi-hub", report(result="rolled-back"), T) is None


def test_next_success_clears_attention():
    put()
    put(commit=B, result="failed", at=T + 5)
    r = put(commit=B, at=T + 9)
    assert (r["state"], r["severity"], r["detail"]["previous"]) == ("live", "ok", A)


def test_head_ahead_of_commit_is_behind():
    r = put(head=B)
    assert (r["state"], r["severity"]) == ("behind", "info")
    assert r["headline"] == "aaaaaaa is live; bbbbbbb is not deployed"


def test_no_head_stays_live():
    assert put()["state"] == "live"


@pytest.mark.parametrize("change", [
    {"commit": "XYZ1234"}, {"commit": "abc"}, {"result": "done"}, {"mechanism": "ssh"},
    {"at": iso(T + 601)}, {"at": "2026-11-02T10:00:00"}, {"at": "yesterday"}, {"message": "x" * 201},
    {"head": "nothex!"},
])
def test_invalid_body_is_refused(change):
    assert releases.valid("pi-hub", {**report(), **change}, T) is None


def test_unknown_target_is_refused():
    assert releases.valid("toaster", report(), T) is None


def test_duplicate_is_noop():
    put()
    before = db.rows("SELECT COUNT(*) AS n FROM record_events WHERE thing = 'release:pi-hub'")[0]["n"]
    r = put(now=T + 50)
    assert r["as_of"] == T + 10
    assert db.rows("SELECT COUNT(*) AS n FROM record_events WHERE thing = 'release:pi-hub'")[0]["n"] == before


def test_older_report_is_ignored():
    put(commit=B, at=T + 5)
    assert put(commit=A, at=T)["detail"]["commit"] == B


def test_release_records_are_in_api_records():
    releases.seed(T)
    put()
    ids = [r["id"] for r in client.get("/api/records").json()["records"]]
    assert ids[-len(releases.TARGETS):] == releases.ids()
    assert "printer" in ids


def test_release_records_load_without_stale():
    put()
    records._reset_memory()
    records.load()
    assert records.get("release:pi-hub")["stale"] is False
    assert records.get("printer")["stale"] is True


def test_failed_deploy_raises_one_needs_item():
    releases.seed(T)
    put()
    put(commit=B, result="failed", at=T + 5)
    items = [i for i in needs.build([], {"cards": []}, T + 10, problems=records.problems())["items"] if "release:" in i["id"]]
    assert len(items) == 1
    assert items[0]["id"] == "pi:release:pi-hub" and items[0]["title"] == "Pi Hub deploy"
    assert items[0]["link"] == "/versions"


def test_unknown_and_live_raise_no_needs_item():
    releases.seed(T)
    put()
    assert not [r for r in records.problems() if r["id"].startswith("release:")]


# ---- the inbox on the Pi ----

def drop(path, name, body):
    path.mkdir(exist_ok=True)
    (path / name).write_text(json.dumps(body))


def test_inbox_report_is_applied(tmp_path):
    drop(tmp_path / "inbox", "pi-hub-1-x.json", {"target": "pi-hub", **report()})
    assert releases.read_inbox(T + 10) == 1
    assert records.get("release:pi-hub")["detail"]["commit"] == A


def test_inbox_written_while_down_is_read_on_start(tmp_path):
    drop(tmp_path / "inbox", "pi-hub-1-x.json", {"target": "pi-hub", **report()})
    records._reset_memory()  # the hub restarts after the deploy wrote its report
    records.load()
    events.loop_pass(False, now=T + 30, inputs=inputs())
    assert records.get("release:pi-hub")["state"] == "live"
    assert records.get("release:localai")["state"] == "unknown"


def test_inbox_order_is_by_time(tmp_path):
    drop(tmp_path / "inbox", "pi-hub-2-a.json", {"target": "pi-hub", **report(commit=B, at=T + 5)})
    drop(tmp_path / "inbox", "pi-hub-1-b.json", {"target": "pi-hub", **report(commit=A, at=T)})
    releases.read_inbox(T + 10)
    r = records.get("release:pi-hub")
    assert (r["detail"]["commit"], r["detail"]["previous"]) == (B, A)


def test_inbox_read_twice_is_noop(tmp_path):
    drop(tmp_path / "inbox", "pi-hub-1-x.json", {"target": "pi-hub", **report()})
    releases.read_inbox(T + 10)
    releases.read_inbox(T + 40)
    assert records.get("release:pi-hub")["as_of"] == T + 10


def test_bad_inbox_file_is_logged_once(tmp_path, capsys):
    drop(tmp_path / "inbox", "pi-hub-1-x.json", {"target": "pi-hub", "commit": "nope"})
    (tmp_path / "inbox" / "broken.json").write_text("{")
    releases.read_inbox(T)
    releases.read_inbox(T + 30)
    err = capsys.readouterr().err
    assert err.count("pi-hub-1-x.json") == 1 and err.count("broken.json") == 1
    assert records.get("release:pi-hub") is None


def test_missing_inbox_is_fine():
    assert releases.read_inbox(T) == 0


# ---- Pi Hub's own drift check ----

def release_dirs(tmp_path, running):
    rel = tmp_path / "releases"
    rel.mkdir(exist_ok=True)
    (rel / running[:10]).mkdir(exist_ok=True)
    cur = tmp_path / "current"
    if cur.is_symlink():
        cur.unlink()
    cur.symlink_to(rel / running[:10])
    return str(cur)


def test_match_is_verified_once(tmp_path):
    put()
    cur = release_dirs(tmp_path, A)
    r = releases.verify_pi_hub(T + 20, cur)
    assert r["state"] == "live" and r["detail"]["verified"]["commit"] == A[:10]
    assert releases.verify_pi_hub(T + 50, cur)["detail"]["verified"]["at"] == T + 20


def test_symlink_change_is_drift(tmp_path):
    put()
    releases.verify_pi_hub(T + 20, release_dirs(tmp_path, B))
    r = releases.verify_pi_hub(T + 20 + releases.PROBE_LAG, release_dirs(tmp_path, B))
    assert (r["state"], r["severity"]) == ("drifted", "attention")
    assert r["headline"] == "Pi Hub is running bbbbbbb, not the recorded aaaaaaa"
    items = [i for i in needs.build([], {"cards": []}, T + 30 + releases.PROBE_LAG, problems=records.problems())["items"] if i["id"] == "pi:release:pi-hub"]
    assert len(items) == 1


def test_drift_clears_on_match(tmp_path):
    put()
    releases.verify_pi_hub(T + 20, release_dirs(tmp_path, B))
    r = releases.verify_pi_hub(T + 40, release_dirs(tmp_path, A))
    assert (r["state"], r["severity"]) == ("live", "ok")


def test_next_deploy_clears_drift(tmp_path):
    put()
    releases.verify_pi_hub(T + 20, release_dirs(tmp_path, B))
    assert put(commit=B, at=T + 30, now=T + 40)["state"] == "live"


def test_no_record_no_drift(tmp_path):
    assert releases.verify_pi_hub(T, release_dirs(tmp_path, B)) is None


# ---- Local AI's drift check (its /healthz, read by pi-status) ----

def test_localai_drift():
    r = releases.valid("localai", {**report(), "mechanism": "safe-deploy"}, T + 10)
    releases.put("localai", r, T + 10)
    releases.verify_localai(T + 20, {"ai_release": B})
    d = releases.verify_localai(T + 20 + releases.PROBE_LAG, {"ai_release": B})
    assert (d["state"], d["severity"]) == ("drifted", "attention")
    assert d["detail"]["verified"]["by"] == "localai healthz"
    assert releases.verify_localai(T + 30 + releases.PROBE_LAG, {"ai_release": A})["state"] == "live"


def test_a_mismatch_is_drift_only_once_it_has_lasted_probe_lag():
    for at, commit in ((T, B), (T + 100, A)):  # B was live; A deploys at T + 100
        releases.put("localai", releases.valid("localai", {**report(commit=commit, at=at), "mechanism": "safe-deploy"}, at + 1), at + 1)
    assert releases.verify_localai(T + 160, {"ai_release": B})["state"] == "live"  # pi-status's cache, 60 s on
    assert releases.verify_localai(T + 200, {"ai_release": B})["state"] == "live"
    assert releases.verify_localai(T + 160 + releases.PROBE_LAG, {"ai_release": B})["state"] == "drifted"
    assert releases.verify_localai(T + 600, {"ai_release": A})["state"] == "live"


def test_a_new_release_seen_before_its_report_is_not_drift(tmp_path):
    put(now=T + 10)  # A is live
    assert releases.verify_pi_hub(T + 20, release_dirs(tmp_path, B))["state"] == "live"  # the runner switched first
    rec = put(commit=B, at=T + 50, now=T + 60)  # its report lands
    assert rec["state"] == "live" and "mismatch" not in rec["detail"]
    assert releases.verify_pi_hub(T + 400, release_dirs(tmp_path, B))["state"] == "live"


def test_a_changing_mismatch_restarts_the_wait():
    releases.put("localai", releases.valid("localai", {**report(), "mechanism": "safe-deploy"}, T + 1), T + 1)
    releases.verify_localai(T + 10, {"ai_release": B})
    releases.verify_localai(T + 100, {"ai_release": "c" * 40})
    assert releases.verify_localai(T + 10 + releases.PROBE_LAG, {"ai_release": "c" * 40})["state"] == "live"
    assert releases.verify_localai(T + 100 + releases.PROBE_LAG, {"ai_release": "c" * 40})["state"] == "drifted"


def test_pc_asleep_is_not_drift():
    r = releases.valid("localai", {**report(), "mechanism": "safe-deploy"}, T + 10)
    releases.put("localai", r, T + 10)
    for reading in (None, {}, {"ai_release": None}, {"ai_release": "not a sha"}):
        assert releases.verify_localai(T + 20, reading) in (None, records.get("release:localai"))
    assert records.get("release:localai")["state"] == "live"


def test_localai_without_record_is_unchanged():
    assert releases.verify_localai(T, {"ai_release": A}) is None


# ---- the firmware: published by the OTA hook, live only when the display runs it ----

def publish(commit=A, version="12.7.1", now=T + 10):
    r = releases.valid("firmware", report(commit=commit, mechanism="ota-hook", version=version), now)
    assert r is not None
    return releases.put("firmware", r, now)


def test_published_not_running_is_behind():
    r = publish()
    assert (r["state"], r["severity"]) == ("behind", "info")
    assert r["headline"] == "Published aaaaaaa; the display hasn't reported it yet"
    r = releases.verify_firmware(T + 20, {"sourceSha": B, "version": "12.4.4"})
    assert (r["state"], r["headline"]) == ("behind", "Published aaaaaaa; the display runs bbbbbbb")
    assert r["detail"]["display"] == {"commit": B, "version": "12.4.4", "at": T + 20}


def test_heartbeat_match_is_live():
    publish()
    r = releases.verify_firmware(T + 20, {"sourceSha": A.upper(), "version": "12.7.1"})
    assert (r["state"], r["severity"], r["headline"]) == ("live", "ok", "aaaaaaa is live")
    again = releases.verify_firmware(T + 30, {"sourceSha": A, "version": "12.7.1"})
    assert (again["since"], again["detail"]["display"]["at"]) == (r["since"], T + 20)  # an unchanged beat writes nothing


def test_newer_display_is_ahead():
    publish()
    r = releases.verify_firmware(T + 20, {"sourceSha": B, "version": "12.8.0"})
    assert (r["state"], r["headline"]) == ("ahead", "The display runs bbbbbbb, newer than the published aaaaaaa")


def test_no_heartbeat_keeps_state():
    publish()
    live = releases.verify_firmware(T + 20, {"sourceSha": A, "version": "12.7.1"})
    for beat in (None, {}, {"sourceSha": None}, {"sourceSha": "not a sha"}):
        assert releases.verify_firmware(T + 30, beat) is None
    assert records.get("release:firmware")["state"] == live["state"] == "live"


def test_new_publish_is_behind_until_the_display_updates():
    publish()
    releases.verify_firmware(T + 20, {"sourceSha": A, "version": "12.7.1"})
    r = publish(commit=C, version="12.8.0", now=T + 30)
    assert (r["state"], r["headline"]) == ("behind", "Published ccccccc; the display runs aaaaaaa")
    assert r["detail"]["previous"] == A
    assert releases.verify_firmware(T + 40, {"sourceSha": C, "version": "12.8.0"})["state"] == "live"


def test_heartbeat_without_record_is_unchanged():
    assert releases.verify_firmware(T, {"sourceSha": A}) is None


@pytest.mark.parametrize("version", ["", "12.7.1 beta", "x" * 33, 12])
def test_bad_version_is_refused(version):
    assert releases.valid("firmware", report(mechanism="ota-hook", version=version), T + 10) is None


def test_loop_reads_the_display_heartbeat(monkeypatch):
    from hub import display_messages
    publish()
    monkeypatch.setattr(display_messages, "last_heartbeat", lambda **k: {"sourceSha": A, "version": "12.7.1"})
    releases.loop(T + 20)
    assert records.get("release:firmware")["state"] == "live"


def test_dirty_deploy_is_kept_until_the_next_clean_one():
    r = put(target="netmon", mechanism="netmon-deploy", dirty=True, message="deployed from uncommitted changes")
    assert (r["state"], r["detail"]["dirty"]) == ("live", True)
    assert put(target="netmon", now=T + 20, at=T + 5, mechanism="netmon-deploy")["detail"]["dirty"] is False


@pytest.mark.parametrize("dirty", ["yes", 1, "true"])
def test_dirty_must_be_a_bool(dirty):
    assert releases.valid("netmon", report(mechanism="netmon-deploy", dirty=dirty), T + 10) is None
