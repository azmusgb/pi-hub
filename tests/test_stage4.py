import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import db, events, filament, recorder  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    filament.ready()
    return sent


def test_add_spool_and_validation():
    sid = filament.add({"material": "PLA", "colour": "  Jade   white ", "hex": "#e8f0ea", "price": "19.99"})
    s = filament.spools()[0]
    assert s["id"] == sid and s["colour"] == "Jade white" and s["grams_left"] == 1000 and s["cost_per_kg"] == 19.99
    with pytest.raises(ValueError):
        filament.add({"material": "Cheese", "colour": "x"})
    with pytest.raises(ValueError):
        filament.add({"material": "PLA", "colour": ""})
    filament.add({"material": "PETG", "colour": "Black", "hex": "javascript:alert(1)"})
    assert filament.spools()[0]["hex"] is None  # PETG sorts first; a bad colour is dropped


def test_logging_a_print_takes_filament_off_and_costs_it():
    sid = filament.add({"material": "PLA", "colour": "Red", "price": 20, "grams_total": 1000})
    now = int(__import__("time").time())
    recorder.record_print("Printing", 50, now - 4000)
    recorder.record_print("Idle", 0, now)
    pid = db.one("SELECT id FROM prints")["id"]
    assert filament.log_print(pid, sid, 120) == {"cost": 2.4}
    assert db.one("SELECT grams_left FROM spools")["grams_left"] == 880
    filament.log_print(pid, sid, 100)  # corrected: the first 120 g go back first
    assert db.one("SELECT grams_left FROM spools")["grams_left"] == 900
    assert filament.summary()["grams"] == 100


def test_running_low_fires_once_and_the_default_rule_alerts(fresh_db):
    events.ready()
    sid = filament.add({"material": "PLA", "colour": "Blue", "grams_total": 1000})
    filament.update(sid, {"grams_left": 400})
    filament.update(sid, {"grams_left": 120})
    filament.update(sid, {"grams_left": 100})
    assert [e["kind"] for e in events.recent()] == ["filament_low"]
    assert fresh_db and fresh_db[0][0] == "Filament running low" and "Blue PLA, 120 g left" in fresh_db[0][1]
    assert filament.spools()[0]["low"]


def test_failed_print_keeps_the_error_code():
    recorder.record_print("Printing", 20, 1000)
    recorder.record_print("Error", 20, 2000, "0300_0100_0001_0007")
    assert db.one("SELECT outcome, error FROM prints") == {"outcome": "failed", "error": "0300_0100_0001_0007"}


def test_used_up_spools_leave_the_shelf():
    sid = filament.add({"material": "PLA", "colour": "Grey"})
    filament.update(sid, {"finished": True})
    assert filament.spools() == [] and len(filament.spools(include_finished=True)) == 1
