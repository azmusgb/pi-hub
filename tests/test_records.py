import os

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(__import__("tempfile").mkdtemp(), "hub.db"))

import pytest  # noqa: E402

from hub import db, records  # noqa: E402


@pytest.fixture(autouse=True)
def clean():
    records.ready()
    db.run("DELETE FROM records")
    db.run("DELETE FROM record_events")
    records._reset_memory()
    records._subscribers.clear()
    yield


def test_severity_comes_from_the_state():
    r = records.merge(None, records.make("pc", "off", "The PC is off", "netmon"), 1000)
    assert (r["severity"], r["since"], r["as_of"], r["stale"]) == ("problem", 1000, 1000, False)


def test_silent_source_keeps_the_last_record_and_goes_stale():
    ok = records.merge(None, records.make("printer", "printing", "Printing v72, 12%", "bambuddy"), 1000)
    r = records.merge(ok, None, 1000 + 91)
    assert r["state"] == "printing" and r["stale"] is True
    assert r["severity"] == "attention" and "not answering" in r["cause"]
    assert "Bambuddy not answering since" in r["cause"] and "last read 1 min ago" in r["cause"]


def test_a_missed_check_inside_the_window_is_not_stale():
    ok = records.merge(None, records.make("printer", "printing", "Printing", "bambuddy"), 1000)
    r = records.merge(ok, None, 1030)
    assert r["stale"] is False and r["severity"] == "ok" and r["cause"] == ""


def test_nothing_known_and_no_answer_is_nothing():
    assert records.merge(None, None, 5) is None
    records.store({"pc": None}, 5)
    assert records.all() == {}


def test_a_debounced_change_needs_two_checks():
    a = records.merge(None, records.make("movies_drive", "connected", "Connected", "pi_status"), 0)
    b = records.merge(a, records.make("movies_drive", "missing", "Missing", "pi_status"), 30)
    assert b["state"] == "connected"
    c = records.merge(b, records.make("movies_drive", "missing", "Missing", "pi_status"), 60)
    assert (c["state"], c["since"]) == ("missing", 60)


def test_a_blip_that_goes_back_does_not_count():
    a = records.merge(None, records.make("movies_drive", "connected", "Connected", "pi_status"), 0)
    b = records.merge(a, records.make("movies_drive", "missing", "Missing", "pi_status"), 30)
    c = records.merge(b, records.make("movies_drive", "connected", "Connected", "pi_status"), 60)
    d = records.merge(c, records.make("movies_drive", "missing", "Missing", "pi_status"), 90)
    assert d["state"] == "connected"


def test_an_undebounced_change_counts_at_once():
    a = records.merge(None, records.make("pc", "on", "On", "netmon"), 0)
    b = records.merge(a, records.make("pc", "off", "Off", "netmon"), 30)
    assert (b["state"], b["since"]) == ("off", 30)


def test_since_is_kept_while_the_state_holds():
    a = records.merge(None, records.make("pc", "on", "On", "netmon"), 0)
    assert records.merge(a, records.make("pc", "on", "On", "netmon"), 30)["since"] == 0


def test_an_unknown_state_is_attention():
    r = records.merge(None, records.make("pc", "weird", "?", "netmon"), 0)
    assert r["severity"] == "attention"


def test_store_reports_and_logs_changes_only():
    p = records.merge(None, records.make("printer", "printing", "Printing v72, 12%", "bambuddy"), 1000)
    changes = records.store({"printer": p}, 1000)
    assert records.store({"printer": records.merge(p, records.make("printer", "printing", "Printing v72, 13%", "bambuddy"), 1030)}, 1030) == []
    assert [c["new"] for c in changes] == ["printing"]
    assert changes[0]["old"] is None and changes[0]["record"]["headline"] == "Printing v72, 12%"
    assert db.one("SELECT COUNT(*) n FROM record_events")["n"] == 1


def test_old_events_are_dropped():
    db.run("INSERT INTO record_events (ts, thing) VALUES (?, 'pc')", 1000)
    records.store({}, 1000 + 31 * 86400)
    assert db.one("SELECT COUNT(*) n FROM record_events")["n"] == 0


def test_subscribers_get_each_change():
    q = records.subscribe()
    records.store({"pc": records.merge(None, records.make("pc", "on", "On", "netmon"), 1)}, 1)
    assert q.get_nowait()["id"] == "pc"
    records.unsubscribe(q)
    assert records._subscribers == []


def test_load_after_restart_is_stale_and_silent():
    records.store({"pc": records.merge(None, records.make("pc", "on", "On", "netmon"), 1000)}, 1000)
    records._reset_memory()
    records.load()
    assert records.get("pc")["stale"] is True
    assert db.one("SELECT COUNT(*) n FROM record_events")["n"] == 1   # no new rows


def test_problems_are_worst_then_oldest_first():
    records.store({
        "workshop_display": records.merge(None, records.make("workshop_display", "offline", "Offline", "pi_status"), 100),
        "adguard": records.merge(None, records.make("adguard", "not_answering", "Down", "adguard"), 200),
        "pc": records.merge(None, records.make("pc", "off", "Off", "netmon"), 300),
        "internet": records.merge(None, records.make("internet", "ok", "Internet OK", "netmon"), 300),
    }, 300)
    assert [r["id"] for r in records.problems()] == ["pc", "workshop_display", "adguard"]


def _drive(state):
    return records.make("movies_drive", state, state, "pi_status")


def test_a_stale_record_takes_the_new_state_at_once():  # R16
    a = dict(records.merge(None, _drive("connected"), 0), stale=True)  # as load() leaves it
    b = records.merge(a, _drive("not_mounted"), 30)
    assert (b["state"], b["since"]) == ("not_mounted", 30)
    silent = records.merge(records.merge(None, _drive("connected"), 0), None, 200)  # a source quiet too long
    assert silent["stale"] and records.merge(silent, _drive("missing"), 230)["state"] == "missing"


def test_a_stale_record_clears_a_pending_change():  # R16
    a = records.merge(None, _drive("connected"), 0)
    records.merge(a, _drive("missing"), 30)  # one check of missing pending
    b = records.merge(dict(a, stale=True), _drive("connected"), 60)
    c = records.merge(b, _drive("missing"), 90)
    assert c["state"] == "connected"  # the earlier pending check didn't carry over


def test_missing_and_not_mounted_count_as_one_dropout_for_the_debounce():  # R18
    a = records.merge(None, _drive("connected"), 0)
    b = records.merge(a, _drive("missing"), 30)
    c = records.merge(b, _drive("not_mounted"), 60)
    assert (c["state"], c["since"]) == ("not_mounted", 60)
    d = records.merge(c, _drive("missing"), 90)  # moving between the two needs no second check
    assert (d["state"], d["since"]) == ("missing", 90)
