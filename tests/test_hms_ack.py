"""Acknowledging a printer alert from Needs you (24 Nov: the X2D still listed 0x3000a and 0x2000b at 29% and printing,
and nothing could dismiss them). An acknowledged code leaves the hms record and Needs you while the printer keeps
listing it; a good reading without it forgets the acknowledgement; a failed read never hides or forgets anything."""
import os
import sqlite3
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, hms_ack, needs, records, sources, things  # noqa: E402
from tests.helpers_records import PI, bud, records_from  # noqa: E402

PASSWORD = "correct horse"
ORIGIN = {"Origin": "http://testserver"}
NOW = 1_800_000_000
PASSED, NOTICE = "0x2000b", "0x3000a"


def printer(*codes, state="RUNNING", connected=True):
    """Bambuddy's reading with these alerts listed: 0x2… is severity 2, anything else severity 3."""
    return {**bud(state, progress=29, connected=connected),
            "hms": [{"code": c, "severity": 2 if c.startswith("0x2") else 3, "module": 5, "description": ""} for c in codes]}


@pytest.fixture(autouse=True)
def store(monkeypatch, tmp_path):
    """An empty database, with the owner's password set, and no records for each test."""
    monkeypatch.setenv("HUB_DB", str(tmp_path / "hub.db"))
    monkeypatch.setenv("HUB_SETUP_CODE_FILE", CODE_FILE)
    auth._tries.clear()
    auth.setup("ABCD-1234", PASSWORD)
    records._reset_memory()
    yield
    records._reset_memory()


@pytest.fixture
def client():
    return TestClient(hub_app.app)


@pytest.fixture
def owner(client):
    assert client.post("/api/signin", json={"password": PASSWORD}, headers=ORIGIN).status_code == 200
    return client


@pytest.fixture
def reading(monkeypatch):
    """What Bambuddy answers the route: both alerts by default; set ["b"] to change it (None: no answer)."""
    held = {"b": printer(PASSED, NOTICE)}
    monkeypatch.setattr(sources, "bambuddy_printer", lambda timeout=1: held["b"])
    return held


def items(b):
    """The hms items Needs you lists after one refresh with this reading."""
    recs = records_from(PI, b, now=NOW)
    return {i["id"]: i for i in needs.build([], {"cards": []}, NOW, records.problems(recs))["items"]
            if i["id"].startswith("pi:source:hms:")}


def ack(c, id=f"pi:source:hms:{PASSED}"):
    return c.post("/api/needs/ack", json={"id": id}, headers=ORIGIN)


# ---- the record and Needs you ----

def test_an_acknowledged_code_leaves_the_record_and_needs_you_and_its_sibling_stays():
    b = printer(PASSED, NOTICE)
    assert things.hms_record(b)["state"] == "stopped"
    hms_ack.acknowledge(PASSED, NOW)
    rec = things.hms_record(b)
    assert rec["state"] == "notice" and rec["headline"] == f"Printer needs attention ({NOTICE})"
    assert [e["code"] for e in rec["detail"]["errors"]] == [NOTICE]
    assert [e["code"] for e in rec["detail"]["acknowledged"]] == [PASSED], "still on the record, not lost"
    assert set(items(b)) == {f"pi:source:hms:{NOTICE}"}


def test_every_listed_code_acknowledged_is_a_clear_record_that_still_names_them():
    b = printer(PASSED, NOTICE)
    hms_ack.acknowledge(PASSED, NOW)
    hms_ack.acknowledge(NOTICE, NOW)
    rec = things.hms_record(b)
    assert rec["state"] == "clear" and rec["headline"] == "Printer alerts acknowledged"
    assert rec["detail"]["errors"] == []
    assert {e["code"] for e in rec["detail"]["acknowledged"]} == {PASSED, NOTICE}
    assert items(b) == {}
    assert records.merge(None, rec, NOW)["severity"] == "ok"


def test_a_good_reading_without_the_code_forgets_it_so_it_shows_again_when_raised():
    hms_ack.acknowledge(PASSED, NOW)
    assert things.hms_record(printer(PASSED))["state"] == "clear"
    assert things.hms_record(printer())["headline"] == "No printer alerts"  # the printer dropped it
    assert auth.get(hms_ack.KEY) == {}
    again = things.hms_record(printer(PASSED))
    assert again["state"] == "stopped" and again["detail"]["acknowledged"] == []


@pytest.mark.parametrize("failed", [None, printer(connected=False), "odd"])
def test_a_failed_or_disconnected_reading_forgets_nothing(failed):
    hms_ack.acknowledge(PASSED, NOW)
    hms_ack.current(failed)
    if failed is None:
        assert things.hms_record(None) is None  # no answer is no record, as before
    assert auth.get(hms_ack.KEY) == {PASSED: NOW}
    assert things.hms_record(printer(PASSED))["state"] == "clear", "still acknowledged when Bambuddy answers again"


@pytest.mark.parametrize("error", [sqlite3.OperationalError("database is locked"), ValueError("not JSON")])
def test_a_store_that_cant_be_read_hides_nothing(monkeypatch, error):
    hms_ack.acknowledge(PASSED, NOW)

    def broken(key, default=None):
        raise error
    monkeypatch.setattr(auth, "get", broken)
    b = printer(PASSED, NOTICE)
    rec = things.hms_record(b)
    assert rec["state"] == "stopped" and [e["code"] for e in rec["detail"]["errors"]] == [PASSED, NOTICE]
    assert set(items(b)) == {f"pi:source:hms:{PASSED}", f"pi:source:hms:{NOTICE}"}


def test_a_forgetting_that_cant_be_saved_still_builds_the_record(monkeypatch):
    hms_ack.acknowledge(PASSED, NOW)

    def broken(key, value):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(auth, "put", broken)
    assert things.hms_record(printer(NOTICE))["state"] == "notice"


def test_a_start_still_reads_the_printers_own_list():
    from hub import lab_start
    hms_ack.acknowledge(PASSED, NOW)
    b = {**printer(PASSED, state="IDLE"), "bed_temp": 25}
    assert things.hms_record(b)["state"] == "clear"
    assert "The printer has an error. Clear it on the printer first." in lab_start.printer_refusals(b)


# ---- POST /api/needs/ack ----

def test_only_the_owner_may_acknowledge(client, reading):
    r = ack(client)
    assert r.status_code == 401 and r.json()["detail"] == "Sign in as the owner first."
    assert auth.get(hms_ack.KEY) is None
    assert not [a for a in auth.recent_actions() if a["action"] == "needs:ack"]


def test_the_owner_acknowledges_one_alert_and_the_next_read_leaves_it_out(owner, reading, monkeypatch):
    monkeypatch.setattr(sources, "localai_feed", lambda: {"cards": []})
    records.store(records_from(PI, reading["b"], now=NOW), NOW)
    before = {i["id"] for i in owner.get("/api/needs").json()["items"]}
    assert {f"pi:source:hms:{PASSED}", f"pi:source:hms:{NOTICE}"} <= before
    r = ack(owner)
    assert r.status_code == 200 and r.json() == {"ok": True, "say": f"Acknowledged printer alert {PASSED}."}
    after = {i["id"] for i in owner.get("/api/needs").json()["items"]}  # no loop pass in between
    assert f"pi:source:hms:{PASSED}" not in after and f"pi:source:hms:{NOTICE}" in after
    assert records.get("hms")["state"] == "notice"
    [logged] = [a for a in auth.recent_actions() if a["action"] == "needs:ack"]
    assert logged["role"] == "owner" and logged["result"] == f"Acknowledged printer alert {PASSED}."


@pytest.mark.parametrize("id", ["pi:source:hms:", "pi:source:hms:0x2000b#2", "pi:source:hms:0x2000b ", "pi:Movies drive",
                                "pi:source:bambuddy", "hms:0x2000b", "pi:source:hms:../x", 7, None, ["pi:source:hms:0x2000b"]])
def test_an_id_that_isnt_one_printer_alert_is_refused(owner, reading, id):
    r = ack(owner, id)
    assert r.status_code == 400 and r.json()["detail"] == "Only a printer alert can be acknowledged."
    assert auth.get(hms_ack.KEY) is None


def test_a_body_that_isnt_json_is_refused(owner, reading):
    r = owner.post("/api/needs/ack", content=b"id=pi", headers=ORIGIN)
    assert r.status_code == 400


def test_a_code_the_printer_doesnt_list_now_is_refused(owner, reading):
    reading["b"] = printer(NOTICE)
    r = ack(owner)
    assert r.status_code == 409 and r.json()["detail"] == "The printer no longer lists that alert. Nothing was acknowledged."
    assert auth.get(hms_ack.KEY) is None
    assert not [a for a in auth.recent_actions() if a["action"] == "needs:ack"]


@pytest.mark.parametrize("b", [None, printer(PASSED, connected=False)])
def test_nothing_is_acknowledged_when_bambuddy_cant_say_what_is_listed(owner, reading, b):
    reading["b"] = b
    r = ack(owner)
    assert r.status_code == 503 and "nothing was acknowledged" in r.json()["detail"]
    assert auth.get(hms_ack.KEY) is None


def test_an_acknowledgement_that_cant_be_saved_says_so(owner, reading, monkeypatch):
    def broken(code, now):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(hms_ack, "acknowledge", broken)
    r = ack(owner)
    assert r.status_code == 503 and r.json()["detail"] == "Pi Hub couldn't save that just now. Nothing was acknowledged."
    assert not [a for a in auth.recent_actions() if a["action"] == "needs:ack"]


def test_acknowledging_sends_the_printer_nothing(owner, reading, monkeypatch):
    from hub import printer_control
    monkeypatch.setattr(printer_control, "run", lambda *a, **k: pytest.fail("the printer was sent a command"))
    assert ack(owner).status_code == 200
