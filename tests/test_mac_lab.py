"""The mac_lab record (platform step 6, PR 6.2): what waits for the Mac, and whether the Mac has gone quiet."""
import os

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import db, lab, lab_guard, mac_lab, records  # noqa: E402
from hub.things import lab as lab_thing  # noqa: E402

T = 1_800_000_000
ISO = lambda t: __import__("datetime").datetime.fromtimestamp(t, __import__("datetime").timezone.utc).isoformat()  # noqa: E731


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "hub.db"))
    lab._ready_dbs.clear()
    mac_lab._last_write = 0
    lab.ready()
    return tmp_path


def queue(at, project="hex-tile", status="pending"):
    db.run("INSERT INTO lab_requests (id, project, kind, experiment, run, payload, status, created_at) "
           "VALUES (?, ?, 'verdict', 'E-025', 'RUN-025-01', '{}', ?, ?)", f"rq-{at}-{project}", project, status, ISO(at))


def rec(now):
    return lab_thing.mac_lab_record(mac_lab.facts(), now)


def test_nothing_waiting_is_idle_heard_or_not(env):
    assert rec(T)["state"] == "idle"
    mac_lab.note_contact(T)
    r = rec(T + 30)
    assert r["state"] == "idle" and r["cause"] == "The Mac checked in just now." and r["detail"]["last_contact"] == T
    assert records._severity("mac_lab", "idle") == "ok"


def test_waiting_while_the_mac_checks_in_is_ok(env):
    mac_lab.note_contact(T)
    queue(T - 600)
    r = rec(T + 60)
    assert r["state"] == "waiting" and r["headline"] == "1 lab request waits for the Mac"
    assert records._severity("mac_lab", "waiting") == "ok"


def test_the_mac_silent_with_a_request_waiting_is_a_problem_only_past_three_minutes(env):
    mac_lab.note_contact(T)
    queue(T + 10)
    queue(T + 20, project="bracket")
    assert rec(T + 180)["state"] == "waiting"       # contact exactly SILENT_AFTER ago: not yet
    r = rec(T + 191)                                 # contact 191 s ago, oldest request 181 s old
    assert r["state"] == "mac_silent" and r["headline"] == "2 lab requests wait for the Mac"
    assert records._severity("mac_lab", "mac_silent") == "problem"
    assert rec(T + 185)["state"] == "waiting"       # the oldest request is 175 s old: not yet


def test_a_request_never_seen_by_any_mac_contact_counts_as_silent(env):
    queue(T)
    assert rec(T + 100)["state"] == "waiting"
    assert rec(T + 200)["state"] == "mac_silent"


def test_resolved_requests_do_not_wait(env):
    queue(T, status="applied")
    assert rec(T + 3600)["state"] == "idle"


def test_contact_survives_a_restart_and_is_written_at_most_once_a_minute(env):
    mac_lab.note_contact(T)
    mac_lab.note_contact(T + 30)
    assert mac_lab.facts()["last_contact"] == T
    mac_lab._last_write = 0                          # a restart: memory gone, the row kept
    assert mac_lab.facts()["last_contact"] == T
    mac_lab.note_contact(T + 61)
    assert mac_lab.facts()["last_contact"] == T + 61


def test_a_valid_mac_key_is_contact_and_a_wrong_one_is_not(env, tmp_path, monkeypatch):
    import hashlib
    hfile = tmp_path / "key.sha256"
    hfile.write_text(hashlib.sha256(b"mac-key").hexdigest())
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(hfile))

    class Req:
        def __init__(self, key):
            self.headers = {"x-hub-mac-key": key}
    assert not lab_guard.mac_key_ok(Req("wrong"))
    assert mac_lab.facts()["last_contact"] is None
    assert lab_guard.mac_key_ok(Req("mac-key"))
    assert mac_lab.facts()["last_contact"] is not None


def test_an_unreadable_lab_table_is_unknown_not_silent(env, monkeypatch):
    from hub import things
    monkeypatch.setattr(mac_lab, "facts", lambda: (_ for _ in ()).throw(OSError("disk")))
    r = things._build("mac_lab", lambda: lab_thing.mac_lab_record(mac_lab.facts(), T))
    assert r["state"] == "unknown" and "OSError" in r["cause"]
