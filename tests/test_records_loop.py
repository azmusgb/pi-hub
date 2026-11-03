import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import db, events, records, things  # noqa: E402
from hub.things import house  # noqa: E402
from tests.helpers_records import GOOD, T, bud, inputs  # noqa: E402

IDLE = inputs()
PRINTING = inputs(bambuddy=bud("RUNNING", 10))


class Fired:
    """The events the hub recorded, oldest first (read from the events table, so fire()'s dedupe applies)."""

    def rows(self):
        return events.recent(100)[::-1]

    def kinds(self):
        return [e["kind"] for e in self.rows()]

    def details(self):
        return [(e["kind"], e["detail"]) for e in self.rows()]

    def count(self, kind):
        return self.kinds().count(kind)

    def __eq__(self, other):
        return self.kinds() == other

    def __repr__(self):
        return repr(self.kinds())


@pytest.fixture(autouse=True)
def pushed(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    events._forget()
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    events.ready()
    yield sent


@pytest.fixture
def fired():
    return Fired()


def step(at, inp, first=False):
    events.on_changes(records.refresh(at, inputs=inp), first=first)


# ---- Review Focus 1: a restart mid-print ----

def test_first_refresh_after_restart_fires_nothing(fired):
    events.on_changes(records.refresh(T, inputs=PRINTING), first=True)
    assert fired == []


def test_restart_mid_print_with_a_remembered_idle_record_fires_nothing(fired):
    records.refresh(T, inputs=IDLE)  # the hub before the restart
    records._reset_memory()
    records.load()
    step(T + 600, PRINTING, first=True)
    step(T + 630, PRINTING)
    assert fired == []
    step(T + 660, inputs(bambuddy=bud("FINISH", 100, awaiting=True)))
    assert fired == ["print_finished"]


# ---- the print triggers ----

def test_a_stop_and_restart_fires_failed_then_started_attempt_2(fired):
    step(T, IDLE, first=True)
    step(T + 1000, inputs(bambuddy=bud("RUNNING", 5)))
    step(T + 1030, inputs(bambuddy=bud("RUNNING", 23)))
    step(T + 1060, inputs(bambuddy=bud("IDLE", 0)))  # stopped early: an inferred failure
    step(T + 1090, inputs(bambuddy=bud("IDLE", 0)))  # still failed: no second alert
    step(T + 1300, inputs(bambuddy=bud("RUNNING", 1)))  # same job again within 15 min
    assert fired.details() == [("print_started", ""), ("print_failed", "at 23%"),
                               ("print_started", "attempt 2")]


def test_a_start_through_prepare_fires_print_started_once(fired):  # R33
    step(T, IDLE, first=True)
    step(T + 30, inputs(bambuddy=bud("PREPARE", 0)))
    assert records.get("printer")["headline"] == "Starting HEX_TILE_v72"
    step(T + 60, inputs(bambuddy=bud("PREPARE", 0)))
    step(T + 90, inputs(bambuddy=bud("RUNNING", 1)))
    step(T + 120, inputs(bambuddy=bud("RUNNING", 2)))
    assert fired.details() == [("print_started", "")]


def test_a_stop_and_restart_through_prepare_is_attempt_2(fired):  # R33
    step(T, IDLE, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 11)))
    step(T + 60, inputs(bambuddy=bud("IDLE", 11)))
    step(T + 90, inputs(bambuddy=bud("PREPARE", 0)))
    step(T + 120, inputs(bambuddy=bud("RUNNING", 1)))
    assert fired.details() == [("print_started", ""), ("print_failed", "at 11%"),
                               ("print_started", "attempt 2")]


def test_printing_then_unknown_then_idle_is_a_failed_record(fired):  # R33, review item 3
    step(T, IDLE, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 40)))
    step(T + 60, inputs(bambuddy=bud("WEIRD", 40)))
    step(T + 90, inputs(bambuddy=bud("IDLE", 0)))
    rec = records.get("printer")
    assert rec["state"] == "failed" and rec["detail"]["inferred"] is True
    assert fired.details() == [("print_started", ""), ("print_failed", "at 40%")]


def test_a_finish_and_an_early_stop_are_told_apart(fired):
    step(T, IDLE, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 40)))
    step(T + 60, inputs(bambuddy=bud("RUNNING", 99)))
    step(T + 90, inputs(bambuddy=bud("FINISH", 100, awaiting=True)))
    step(T + 120, inputs(bambuddy=bud("IDLE", 0)))  # plate cleared
    step(T + 2000, inputs(bambuddy=bud("RUNNING", 12, job="OTHER.gcode.3mf")))
    step(T + 2030, inputs(bambuddy=bud("FAILED", 12, awaiting=True)))
    assert fired == ["print_started", "print_finished", "print_started", "print_failed"]


def test_a_paused_print_resuming_is_not_a_new_print(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("PAUSE", 20)))
    step(T + 60, inputs(bambuddy=bud("RUNNING", 21)))
    assert fired == []


# ---- Review Focus 2: the webhook and the records report the same print ----

def test_webhook_then_record_report_of_one_finish_fires_once(fired):
    step(T, PRINTING, first=True)
    finish_changes = records.refresh(T + 30, inputs=inputs(bambuddy=bud("FINISH", 100, awaiting=True)))
    events.fire("print_finished", dedupe=events.PRINT_DEDUPE)  # Bambuddy's webhook arrives first
    events.on_changes(finish_changes, first=False)
    assert fired.count("print_finished") == 1


def test_record_then_webhook_report_of_one_start_fires_once(fired):
    step(T, IDLE, first=True)
    step(T + 30, PRINTING)
    events.fire("print_started", "Cube", dedupe=events.PRINT_DEDUPE)  # ...or second
    assert fired == ["print_started"]


# ---- a source that drops out and comes back doesn't re-report ----

def test_a_printer_that_drops_off_and_reconnects_does_not_re_alert(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 10, connected=False)))
    step(T + 60, inputs(bambuddy=bud("RUNNING", 11)))  # the same print, still going
    assert fired == []
    step(T + 90, inputs(bambuddy=bud("FINISH", 100, awaiting=True)))
    step(T + 4000, inputs(bambuddy=bud("FINISH", 100, awaiting=True, connected=False)))  # switched off overnight
    step(T + 90000, inputs(bambuddy=bud("FINISH", 100, awaiting=True)))  # on again, plate not cleared yet
    assert fired == ["print_finished"]


def test_a_start_while_the_printer_was_offline_still_counts(fired):
    step(T, IDLE, first=True)
    step(T + 30, inputs(bambuddy=bud("IDLE", connected=False)))
    step(T + 60, PRINTING)
    assert fired == ["print_started"]


def test_bambuddy_silent_mid_print_then_idle_is_a_failure(fired):
    step(T, inputs(bambuddy=bud("RUNNING", 50)), first=True)
    for at in (T + 30, T + 60, T + 1000):  # Bambuddy not answering: the record goes stale, nothing fires
        step(at, inputs(bambuddy=None))
    assert fired == []
    assert records.get("printer")["state"] == "printing" and records.get("printer")["stale"]
    step(T + 1030, IDLE)
    assert fired.details() == [("print_failed", "at 50%")]


# ---- R11: on_changes tells a finish from a failure itself, as the Watcher did ----

def test_idle_after_99_percent_is_a_finish(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 99)))
    step(T + 60, IDLE)
    assert fired == ["print_finished"]


def test_finish_without_awaiting_plate_clear_is_a_finish(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 99)))
    step(T + 60, inputs(bambuddy=bud("FINISH", 100)))
    assert records.get("printer")["state"] == "idle"
    assert fired == ["print_finished"]


def test_failed_without_awaiting_plate_clear_is_a_failure(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 99)))
    step(T + 60, inputs(bambuddy=bud("FAILED", 99)))
    assert records.get("printer")["state"] == "idle"
    assert fired.details() == [("print_failed", "at 99%")]


def test_offline_then_idle_below_97_is_a_failure(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 40)))
    step(T + 60, inputs(bambuddy=bud("RUNNING", 40, connected=False)))
    step(T + 90, IDLE)
    assert fired.details() == [("print_failed", "at 40%")]


def test_offline_then_idle_at_98_is_a_finish(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 98)))
    step(T + 60, inputs(bambuddy=bud("RUNNING", 98, connected=False)))
    step(T + 90, IDLE)
    assert fired == ["print_finished"]


def test_a_failure_then_the_plate_cleared_fires_once(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("FAILED", 10, awaiting=True)))
    step(T + 60, IDLE)
    step(T + 90000, IDLE)
    assert fired.details() == [("print_failed", "at 10%")]


def test_paused_then_stopped_is_a_failure(fired):
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("PAUSE", 60)))
    step(T + 60, IDLE)
    assert fired.details() == [("print_failed", "at 60%")]


# ---- the house triggers ----

def test_pc_down_fires_on_the_network_not_on_local_ai(fired, pushed):
    step(T, IDLE, first=True)
    for i in range(1, 21):  # Local AI down for 10 minutes while the PC answers on the network
        step(T + 30 * i, inputs(pi={"ai_state": "Down"}))
    assert "pc_down" not in fired.kinds()
    off = inputs(netmon=dict(GOOD["netmon"], win_ok=False))
    start = T + 1000
    for t in range(start, start + 300, 30):  # 4.5 minutes not answering
        step(t, off)
    assert "pc_down" not in fired.kinds()
    step(start + 300, off)
    step(start + 330, off)
    assert fired.count("pc_down") == 1
    assert ("Windows PC is down", "It hasn't answered on the network for 5 minutes. "
            "Check the PC or the room's breaker.") == pushed[-1][:2]
    step(start + 360, IDLE)
    assert fired.kinds()[-1] == "pc_back"


def test_one_unknown_netmon_reading_does_not_skip_the_pc_grace(fired):  # R15
    step(T, IDLE, first=True)
    step(T + 30, inputs(netmon={"status": "ok"}))  # no win_ok in this answer
    off = inputs(netmon=dict(GOOD["netmon"], win_ok=False))
    for t in range(T + 60, T + 60 + 300, 30):
        step(t, off)
        assert records.get("pc")["state"] == "on", t
    assert "pc_down" not in fired.kinds()
    step(T + 60 + 300, off)
    assert fired == ["pc_down"]


def test_a_short_pc_blip_fires_nothing(fired):
    step(T, IDLE, first=True)
    off = inputs(netmon=dict(GOOD["netmon"], win_ok=False))
    for t in (T + 30, T + 60, T + 90):
        step(t, off)
    step(T + 120, IDLE)
    assert fired == []


def test_the_drive_change_must_hold_for_two_checks(fired):
    dropped = inputs(pi={"drive_state": "Missing"})
    for i, inp in enumerate((IDLE, dropped, IDLE, IDLE)):
        step(T + 30 * i, inp, first=i == 0)
    assert fired == []
    for i, inp in enumerate((dropped, dropped, IDLE, IDLE)):
        step(T + 200 + 30 * i, inp)
    assert fired == ["drive_dropped", "drive_back"]


def test_missing_then_not_mounted_is_one_dropout(fired):
    step(T, IDLE, first=True)
    for i, d in enumerate(("Missing", "Missing", "Not mounted", "Not mounted")):
        step(T + 30 * (i + 1), inputs(pi={"drive_state": d}))
    assert fired == ["drive_dropped"]


def test_plex_homebridge_and_heat(fired):
    step(T, IDLE, first=True)
    bad = inputs(pi={"services": {"plex": False, "homebridge": False}, "pi_temp": 80})
    step(T + 30, bad)
    assert fired == []  # each has to hold for two checks
    step(T + 60, bad)
    step(T + 90, bad)
    assert sorted(fired.details()) == [("homebridge_stopped", ""), ("pi_hot", "80 °C"), ("plex_stopped", "")]


def test_a_hot_pi_slowed_by_heat_fires_once_and_again_after_cooling(fired):  # R17
    step(T, IDLE, first=True)
    hot = inputs(pi={"pi_temp": 82, "pi_power": "Slowed by heat"})
    cool = inputs(pi={"pi_temp": 60, "pi_power": "Slowed by heat earlier"})
    for i in range(1, 6):
        step(T + 30 * i, hot)
    assert fired.details() == [("pi_hot", "82 °C")]
    for i in range(6, 9):
        step(T + 30 * i, cool)
    for i in range(9, 12):
        step(T + 30 * i, hot)
    assert fired == ["pi_hot", "pi_hot"]


def test_a_hot_pi_with_a_power_problem_still_fires_pi_hot(fired):  # R17
    step(T, IDLE, first=True)
    for i in range(1, 4):
        step(T + 30 * i, inputs(pi={"pi_temp": 80, "pi_power": "Under-voltage"}))
    assert records.get("pi")["state"] == "power"
    assert fired.details() == [("pi_hot", "80 °C")]


def test_a_pi_already_hot_at_start_is_not_news(fired):  # R17
    step(T, inputs(pi={"pi_temp": 82}), first=True)
    step(T + 30, inputs(pi={"pi_temp": 83}))
    assert fired == []


def test_restart_with_the_drive_and_plex_not_yet_up_fires_nothing(fired):  # R16
    records.refresh(T, inputs=IDLE)  # before the restart: drive connected, Plex idle
    records._reset_memory()
    records.load()
    booting = inputs(pi={"drive_state": "Not mounted", "services": {"plex": False, "homebridge": True}})
    step(T + 600, booting, first=True)
    assert records.get("movies_drive")["state"] == "not_mounted" and records.get("plex")["state"] == "stopped"
    step(T + 630, booting)
    step(T + 660, booting)
    assert fired == []


def test_a_one_off_failure_says_its_own_progress(fired, monkeypatch):  # R19
    monkeypatch.setattr(events, "PRINT_DEDUPE", 0)  # the test's two failures are seconds apart in real time
    step(T, PRINTING, first=True)
    step(T + 30, inputs(bambuddy=bud("RUNNING", 40)))
    step(T + 60, inputs(bambuddy=bud("FAILED", 40, awaiting=True)))
    step(T + 90, IDLE)  # plate cleared
    assert events._last_progress == {}
    step(T + 2000, inputs(bambuddy=bud("FAILED", 70, awaiting=True)))  # reported without a live print seen
    assert fired.details() == [("print_failed", "at 40%"), ("print_failed", "at 70%")]


def test_unknown_readings_fire_nothing(fired):
    step(T, IDLE, first=True)
    odd = inputs(pi_status={"drive_state": "Unknown", "services": {}, "ai_state": "Unknown"},
                 netmon={"status": "ok"})
    for at in (T + 30, T + 60, T + 2000):
        step(at, odd)
    step(T + 2030, IDLE)
    step(T + 2060, IDLE)
    assert fired == []


def test_a_stale_record_fires_nothing(fired):
    step(T, IDLE, first=True)
    for at in (T + 30, T + 600, T + 5000):
        step(at, {k: None for k in GOOD})
    assert fired == []
    assert records.get("pc")["stale"] and records.get("pc")["severity"] == "attention"


def test_quiet_hours_still_record_the_event(monkeypatch, fired, pushed):
    monkeypatch.setattr(events, "quiet_now", lambda *a: True)
    step(T, inputs(bambuddy=bud("RUNNING", 30)), first=True)
    step(T + 30, inputs(bambuddy=bud("FAILED", 30, awaiting=True)))
    assert fired == ["print_failed"]
    assert pushed == []
    assert db.one("SELECT status FROM rule_runs WHERE trigger = 'print_failed'")["status"] == "skipped"
    assert db.one("SELECT old, new FROM record_events WHERE thing = 'printer' AND new = 'failed'") == \
        {"old": "printing", "new": "failed"}


# ---- Review Focus 3: odd source answers ----

def test_odd_source_json_gives_unknown_and_others_still_refresh():
    recs = things.build_all(dict(PRINTING, pi_status="not a dict"), {}, T)
    assert recs["workshop_display"]["state"] == "unknown"
    assert recs["printer"]["state"] == "printing"


def test_odd_answers_from_every_source_are_unknown_not_errors():
    odd = {"bambuddy": bud("RUNNING", 10), "pi_status": ["x"], "netmon": "x", "lab": None, "sessions": None,
           "paper": 7, "weather": "x", "adguard": [], "backups": "x", "camera": "x"}
    recs = things.build_all(odd, {}, T)
    assert recs["printer"]["state"] == "printing"
    for id in ("workshop_display", "local_ai", "pi", "movies_drive", "movie_copy", "plex", "devices", "pc",
               "internet", "paper_printer", "weather", "adguard", "backups"):
        assert recs[id]["state"] == "unknown", id
    assert recs["camera"]["state"] == "no_picture"


def test_a_builder_that_raises_gives_unknown_and_the_rest_still_build(monkeypatch):
    def broken(s):
        raise KeyError("pi_temp")
    monkeypatch.setattr(house, "pi", broken)
    recs = things.build_all(PRINTING, {}, T)
    assert recs["pi"] == records.make("pi", "unknown", "No reading", "pi_status",
                                      cause="The hub couldn't read it: KeyError")
    assert recs["printer"]["state"] == "printing" and recs["plex"]["state"] == "idle"


def test_build_all_makes_every_thing_but_the_hub():
    recs = things.build_all(GOOD, {}, T)
    assert set(recs) == set(records.KINDS) - {"hub"}
    silent = things.build_all({k: None for k in GOOD}, {}, T)
    # pc_printing and mac_lab are the hub's own readings (other records, its own lab tables), so they are always there
    assert all(r is None for id, r in silent.items() if id not in ("pc_printing", "mac_lab"))
    assert silent["pc_printing"]["state"] == "fine" and silent["mac_lab"]["state"] in ("idle", "unknown")


def test_local_ai_hears_about_the_new_pc_record():
    on = records.merge(None, house.pc({"win_ok": True}, None, T), T)
    down = inputs(pi={"ai_state": "Down"}, netmon=dict(GOOD["netmon"], win_ok=False))
    recs = things.build_all(down, {"pc": on}, T + 400)
    assert recs["pc"]["state"] == "on"  # the 5-minute grace has only just started
    recs = things.build_all(down, {"pc": dict(on, state="off")}, T + 400)
    assert recs["local_ai"]["cause"] == "Local AI isn't answering; the PC may be off."
    quiet = dict(down, netmon=None)  # NETMON silent: Local AI uses the last PC record
    assert things.build_all(quiet, {"pc": on}, T)["local_ai"]["cause"] == \
        "The PC is on; Local AI itself isn't answering."


def test_gather_reads_each_source_once_and_none_for_a_failure(monkeypatch):
    from hub import actions, bambuddy, homecontrol, outside, printing, sources
    calls = []

    def answer(name, value=None, fail=False):
        def fn(*a, **k):
            calls.append(name)
            if fail:
                raise OSError("down")
            return value if value is not None else {"from": name}
        return fn
    monkeypatch.setattr(sources, "bambuddy_printer", answer("bambuddy"))
    monkeypatch.setattr(sources, "pi_status", answer("pi_status"))
    monkeypatch.setattr(sources, "network_metrics", answer("netmon"))
    monkeypatch.setattr(sources, "lab_printing", answer("lab"))
    monkeypatch.setattr(sources, "plex_sessions", answer("sessions", fail=True))
    monkeypatch.setattr(printing, "printer_state", answer("paper", fail=True))
    monkeypatch.setattr(outside, "weather", answer("weather"))
    monkeypatch.setattr(sources, "camera_health", answer("camera"))
    monkeypatch.setattr(bambuddy, "obico_status", answer("obico"))
    monkeypatch.setattr(homecontrol, "login_state", answer("homebridge_login"))
    monkeypatch.setattr(actions, "helper", lambda name, timeout=None: calls.append(name) or {"from": name})
    sources._cache.pop("helper-adguard", None)
    sources._cache.pop("homebridge-login", None)
    sources._cache.pop("helper-backups", None)
    records.refresh(T, inputs=PRINTING)  # the lab is asked only while the printer is printing or paused
    got = things.gather()
    assert set(got) == {"bambuddy", "pi_status", "netmon", "lab", "sessions", "paper", "weather", "adguard",
                        "backups", "camera", "obico", "homebridge_login"}
    assert got["sessions"] is None and got["paper"] is None
    assert got["adguard"] == {"from": "adguard:stats"} and got["backups"] == {"from": "backups:ages"}
    assert sorted(calls) == sorted(["bambuddy", "pi_status", "netmon", "lab", "sessions", "paper", "weather",
                                    "camera", "obico", "adguard:stats", "backups:ages", "homebridge_login"])
    things.gather()  # the helper reports are shared with /api/network/adguard and /api/system/backups for 5 min
    assert calls.count("adguard:stats") == 1 and calls.count("backups:ages") == 1
    assert calls.count("homebridge_login") == 1  # cached too: Homebridge's login is tried at most every 5 min


def test_the_loop_gives_bambuddy_3_s_and_asks_the_lab_only_mid_print(monkeypatch):  # R36
    from hub import sources
    timeouts, labs = [], []
    monkeypatch.setattr(sources, "_get_json", lambda url, headers=None, timeout=4: timeouts.append(timeout))
    monkeypatch.setattr(sources, "lab_printing", lambda: labs.append(1) or {"experiment": "E-020"})
    sources._cache.pop("bambuddy_printer", None)
    assert things._fetchers()["bambuddy"]() is None and timeouts == [3]
    sources._cache.pop("bambuddy_printer", None)
    sources.bambuddy_printer()  # a page's call keeps the short timeout
    assert timeouts == [3, 1]
    assert things._lab() is None and labs == []  # no printer record yet
    records.refresh(T, inputs=IDLE)
    assert things._lab() is None and labs == []
    records.refresh(T + 30, inputs=PRINTING)
    assert things._lab() == {"experiment": "E-020"} and labs == [1]


# ---- the hub's own record: sources that disagree ----

def test_disagreement_over_5_minutes_is_an_attention_on_hub():
    wrong = inputs(bambuddy=bud("RUNNING", 10), pi={"x2d_state": "Idle"})
    records.refresh(T, inputs=wrong)
    hub = records.get("hub")
    assert (hub["state"], hub["severity"], hub["headline"], hub["source"]) == ("ok", "ok", "All sources agree", "hub")
    records.refresh(T + DISAGREE - 1, inputs=wrong)
    assert records.get("hub")["state"] == "ok"
    changes = records.refresh(T + DISAGREE, inputs=wrong)
    hub = records.get("hub")
    assert (hub["state"], hub["severity"]) == ("disagreement", "attention")
    assert hub["headline"] == "Two sources disagree about the printer"
    assert hub["cause"] == "pi-status reports Idle; Bambuddy reports printing"
    assert [c["id"] for c in changes] == ["hub"]
    records.refresh(T + DISAGREE + 30, inputs=inputs(bambuddy=bud("RUNNING", 11), pi={"x2d_state": "Printing"}))
    assert records.get("hub")["state"] == "ok" and records.get("hub")["detail"]["disagree_since"] == {}


def test_a_disagreement_that_stops_starts_its_clock_again():
    wrong = inputs(bambuddy=bud("RUNNING", 10), pi={"x2d_state": "Idle"})
    records.refresh(T, inputs=wrong)
    records.refresh(T + 200, inputs=inputs(bambuddy=bud("RUNNING", 10), pi={"x2d_state": "Printing"}))
    records.refresh(T + 250, inputs=wrong)
    records.refresh(T + DISAGREE + 10, inputs=wrong)
    assert records.get("hub")["state"] == "ok"
    assert records.get("hub")["detail"]["disagree_since"] == {"printer": T + 250}
    records.refresh(T + 250 + DISAGREE, inputs=wrong)
    assert records.get("hub")["state"] == "disagreement"


def test_a_disagreement_remembered_from_before_a_restart_starts_again():
    wrong = inputs(bambuddy=bud("RUNNING", 10), pi={"x2d_state": "Idle"})
    records.refresh(T, inputs=wrong)
    records._reset_memory()
    records.load()
    records.refresh(T + 3600, inputs=wrong)
    assert records.get("hub")["state"] == "ok"
    assert records.get("hub")["detail"]["disagree_since"] == {"printer": T + 3600}


def test_the_hub_record_fires_no_trigger(fired):
    wrong = inputs(bambuddy=bud("RUNNING", 10), pi={"x2d_state": "Idle"})
    step(T, wrong, first=True)
    step(T + DISAGREE, wrong)
    assert records.get("hub")["state"] == "disagreement" and fired == []


DISAGREE = records.DISAGREE_AFTER


# ---- the loop ----

def test_refresh_gathers_when_no_inputs_are_given(monkeypatch):
    monkeypatch.setattr(things, "gather", lambda: PRINTING)
    changes = records.refresh(T)
    assert records.get("printer")["state"] == "printing"
    assert {c["id"] for c in changes} == set(records.KINDS)


def test_run_says_first_only_once_and_keeps_going_after_an_error(monkeypatch):
    seen, cycles = [], []

    def refresh():
        cycles.append(1)
        if len(cycles) == 1:
            raise OSError("first cycle broke")
        return [{"cycle": len(cycles)}]

    def sleep(s):
        if len(cycles) >= 4:
            raise KeyboardInterrupt
    monkeypatch.setattr(records, "refresh", refresh)
    monkeypatch.setattr(events, "on_changes", lambda changes, first: seen.append(first))
    monkeypatch.setattr(events.Watcher, "check", lambda self, s, now=None: None)
    monkeypatch.setattr(events.Watcher, "check_network", lambda self, a, now=None: None)
    monkeypatch.setattr(events.Watcher, "check_weather", lambda self, w, now=None: None)
    monkeypatch.setattr(events.sources, "pi_status", lambda: None)
    monkeypatch.setattr(events.sources, "active_network_alerts", lambda: None)
    from hub import outside
    monkeypatch.setattr(outside, "weather", lambda: None)
    monkeypatch.setattr(events.time, "sleep", sleep)
    with pytest.raises(KeyboardInterrupt):
        events.run()
    assert seen == [True, False, False]


def test_the_watcher_no_longer_reads_printer_pc_drive_or_services(monkeypatch, fired):
    monkeypatch.setattr(events.Watcher, "_check_spools", lambda self: None)
    w = events.Watcher()
    bad = {"x2d_state": "Printing", "x2d_progress": 5, "drive_state": "Missing", "ai_state": "Down",
           "pi_temp": 90, "services": {"plex": False, "homebridge": False}}
    w.check(dict(bad, x2d_state="Idle"), now=T)
    for i in range(1, 20):
        w.check(bad, now=T + 30 * i)
    w.check(dict(bad, x2d_state="Idle"), now=T + 1000)
    assert fired == []


# ---- R35: the print photo is taken when the printer's record says a print ended ----

class _Sampler:
    def snapshot(self):
        return {"cpu_series": [], "mem_series": [], "temp_series": []}


def _tick(monkeypatch, at, inp):
    from hub import recorder
    records.refresh(at, inputs=inp)
    monkeypatch.setattr(recorder.time, "time", lambda: at)
    monkeypatch.setattr(recorder.sources, "pi_status", lambda: inp["pi_status"])
    recorder.tick(_Sampler())


def test_a_print_in_the_records_ends_with_one_photo(monkeypatch):
    from hub import recorder
    shots = []
    monkeypatch.setattr(recorder, "capture_print_photo", lambda: shots.append(1))
    monkeypatch.setattr(recorder, "_printing", False)
    no_status = {"x2d_state": "No status"}  # pi-status says nothing; the record still drives the photo
    _tick(monkeypatch, T, inputs(pi=no_status))
    _tick(monkeypatch, T + 60, inputs(pi=no_status, bambuddy=bud("PREPARE", 0)))
    _tick(monkeypatch, T + 120, inputs(pi=no_status, bambuddy=bud("RUNNING", 60)))
    _tick(monkeypatch, T + 180, inputs(pi=no_status, bambuddy=bud("RUNNING", 99)))
    assert shots == []
    _tick(monkeypatch, T + 240, inputs(pi=no_status, bambuddy=bud("FINISH", 100, awaiting=True)))
    _tick(monkeypatch, T + 300, inputs(pi=no_status, bambuddy=bud("IDLE", 0)))
    assert shots == [1]
    _tick(monkeypatch, T + 2000, inputs(pi=no_status, bambuddy=bud("RUNNING", 30, job="OTHER.gcode.3mf")))
    _tick(monkeypatch, T + 2060, inputs(pi=no_status, bambuddy=bud("IDLE", 0)))  # stopped early
    assert shots == [1, 1]


def test_an_offline_or_silent_printer_takes_no_photo(monkeypatch):
    from hub import recorder
    shots = []
    monkeypatch.setattr(recorder, "capture_print_photo", lambda: shots.append(1))
    monkeypatch.setattr(recorder, "_printing", False)
    _tick(monkeypatch, T, inputs(bambuddy=bud("RUNNING", 40)))
    _tick(monkeypatch, T + 60, inputs(bambuddy=bud("RUNNING", 40, connected=False)))
    _tick(monkeypatch, T + 1000, inputs(bambuddy=None))
    assert shots == []
