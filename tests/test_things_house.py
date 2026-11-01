from hub import records
from hub.things import house
from tests.helpers_records import T, merged

DAY = 86400


def test_pc_answering_on_the_network_is_on_even_when_local_ai_is_down():
    pc_rec = house.pc({"win_ok": True}, None, T)
    ai = house.local_ai({"ai_state": "Down"}, merged(pc_rec))
    assert pc_rec["state"] == "on" and pc_rec["headline"] == "The PC is on"
    assert ai["state"] == "down" and ai["headline"] == "Local AI isn't answering"
    assert ai["cause"] == "The PC is on; Local AI itself isn't answering."


def test_local_ai_down_without_a_known_pc_makes_no_claim_about_it():
    want = "Local AI isn't answering; the PC may be off."
    assert house.local_ai({"ai_state": "Down"}, None)["cause"] == want
    off = merged(house.pc({"win_ok": False}, None, T))
    assert house.local_ai({"ai_state": "Down"}, off)["cause"] == want


def test_local_ai_ready_and_busy():
    assert house.local_ai({"ai_state": "Ready"}, None)["state"] == "ready"
    assert house.local_ai({"ai_state": "Busy"}, None)["state"] == "busy"


def test_pc_is_off_only_after_5_minutes_without_an_answer():
    on = merged(house.pc({"win_ok": True}, None, T))
    first = merged(house.pc({"win_ok": False}, on, T), at=T)
    assert first["state"] == "on" and "Not answering" in first["cause"]
    assert first["detail"]["down_since"] == T
    mid = house.pc({"win_ok": False}, first, T + 120)
    assert mid["state"] == "on" and "2 min" in mid["cause"]
    off = house.pc({"win_ok": False}, merged(mid, at=T + 120), T + 300)
    assert off["state"] == "off" and off["headline"] == "The PC is off"
    assert off["cause"].startswith("Not answering on the network since ")
    assert off["detail"]["down_since"] == T


def test_failing_probe_with_no_prev_or_not_on_prev_is_off_at_once():
    assert house.pc({"win_ok": False}, None, T)["state"] == "off"
    unk = merged(house.pc({"win_ok": None}, None, T))
    assert unk["state"] == "unknown"
    assert house.pc({"win_ok": False}, unk, T)["state"] == "off"


def test_pc_probe_missing_is_unknown_and_no_source_is_none():
    assert house.pc({"win_ok": None}, None, T)["state"] == "unknown"
    assert house.pc({}, None, T)["state"] == "unknown"
    assert house.pc(None, None, T) is None
    assert house.pc("oops", None, T)["state"] == "unknown"


def test_every_builder_gives_none_for_no_source():
    assert house.local_ai(None, None) is None
    for f in (house.workshop_display, house.pi, house.movies_drive, house.devices,
              house.paper_printer, house.weather):
        assert f(None) is None
    assert house.movie_copy(None, T) is None
    assert house.plex(None, []) is None


def test_missing_fields_give_unknown_not_an_error():
    assert house.workshop_display({})["state"] == "unknown"
    assert house.workshop_display({})["headline"] == "No reading"
    assert house.workshop_display("oops")["state"] == "unknown"
    assert house.local_ai({}, None)["state"] == "unknown"
    assert house.pi({})["state"] == "unknown"
    assert house.movies_drive({})["state"] == "unknown"
    assert house.movie_copy({}, T)["state"] == "unknown"
    assert house.movie_copy({"mirror": {}}, T)["state"] == "unknown"
    assert house.plex({}, None)["state"] == "unknown"
    assert house.devices({})["state"] == "unknown"
    assert house.paper_printer({})["state"] == "unknown"
    assert house.weather({})["state"] == "unknown"
    assert house.weather("oops")["state"] == "unknown"


def test_workshop_display():
    assert house.workshop_display({"display_state": "Online"})["state"] == "online"
    off = house.workshop_display({"display_state": "Offline"})
    assert off["state"] == "offline" and off["headline"] == "The touchscreen is offline."


def test_pi_at_75_is_hot():
    assert house.pi({"pi_temp": 75, "pi_power": "Good"})["state"] == "hot"
    ok = house.pi({"pi_temp": 66, "pi_power": "Good"})
    assert ok["state"] == "ok" and ok["headline"] == "Pi 66 °C"
    p = house.pi({"pi_temp": 90, "pi_power": "Under-voltage"})
    assert p["state"] == "power" and "Under-voltage" in p["cause"]


def test_not_mounted_drive_offers_remount():
    d = house.movies_drive({"drive_state": "Not mounted"})
    assert d["state"] == "not_mounted"
    assert d["actions"] == [{"name": "remount:movies", "label": "Remount it", "confirm": False}]
    m = house.movies_drive({"drive_state": "Missing"})
    assert m["state"] == "missing" and m["cause"] == "Unplug it, wait 10 seconds and plug it back in."
    assert house.movies_drive({"drive_state": "Connected"})["state"] == "connected"


def test_movie_copy_behind_after_2_days():
    ok = house.movie_copy({"mirror": {"last_ok": T}}, T + DAY)
    assert ok["state"] == "up_to_date"
    old = house.movie_copy({"mirror": {"last_ok": T}}, T + 3 * DAY)
    assert old["state"] == "behind"
    assert old["headline"] == "Movies not copied from the PC for 3 days"


def test_stopped_plex_offers_restart():
    p = house.plex({"services": {"plex": False}}, [])
    assert p["state"] == "stopped"
    assert p["actions"] == [{"name": "restart:plex", "label": "Restart movie service", "confirm": True}]


def test_plex_playing_idle():
    up = {"services": {"plex": True}}
    assert house.plex(up, [{"title": "Alien"}])["headline"] == "Playing Alien"
    assert house.plex(up, [])["state"] == "idle"
    assert house.plex(up, None)["state"] == "idle"


def test_devices():
    d = house.devices({"services": {"homebridge": False}})
    assert d["state"] == "stopped"
    assert d["actions"] == [{"name": "restart:homebridge", "label": "Restart smart-home service", "confirm": True}]
    assert house.devices({"services": {"homebridge": True}})["state"] == "ok"


def test_paper_printer():
    assert house.paper_printer({"name": "HP", "state": "Ready"})["state"] == "ready"
    assert house.paper_printer({"name": "HP", "state": "Printing"})["state"] == "busy"
    p = house.paper_printer({"name": "HP", "state": "Paused"})
    assert p["state"] == "problem" and p["cause"] == "The printer is paused."
    n = house.paper_printer({"name": "HP", "state": "Not found"})
    assert n["cause"] == "The printer isn't set up on the Pi."


def test_weather():
    w = {"now": {"temp": 44, "sky": "Clear"}, "days": [{"high": 75, "low": 40}], "alerts": []}
    r = house.weather(w)
    assert r["state"] == "ok" and r["headline"] == "44° Clear, high 75°"
    w["alerts"] = [{"headline": "Frost advisory", "event": "Frost"}]
    a = house.weather(w)
    assert a["state"] == "warning" and a["headline"] == "Frost advisory"


def test_sources_come_from_the_records_table():
    assert house.pc({"win_ok": True}, None, T)["source"] == records.SOURCE["pc"]
    assert house.weather({"now": {"temp": 1}})["source"] == "weather"


def test_one_unknown_reading_keeps_the_pc_grace():  # R15
    on = merged(house.pc({"win_ok": True}, None, T))
    unk = merged(house.pc({"win_ok": None}, on, T + 30), at=T + 30)
    assert unk["state"] == "unknown" and unk["detail"]["last_state"] == "on"
    first = merged(house.pc({"win_ok": False}, unk, T + 60), at=T + 60)
    assert first["state"] == "on" and first["cause"].startswith("Not answering")
    assert house.pc({"win_ok": False}, first, T + 60 + 299)["state"] == "on"
    assert house.pc({"win_ok": False}, first, T + 60 + 300)["state"] == "off"


def test_an_unknown_reading_keeps_the_down_clock():  # R15
    on = merged(house.pc({"win_ok": True}, None, T))
    failing = merged(house.pc({"win_ok": False}, on, T), at=T)
    unk = merged(house.pc({"win_ok": None}, failing, T + 30), at=T + 30)
    assert unk["detail"] == {"last_state": "on", "down_since": T}
    assert house.pc({"win_ok": False}, unk, T + 300)["state"] == "off"
    off = merged(house.pc({"win_ok": False}, unk, T + 300), at=T + 300)
    unk2 = merged(house.pc({"win_ok": None}, off, T + 330), at=T + 330)
    assert house.pc({"win_ok": False}, unk2, T + 360)["state"] == "off"


def test_heat_wins_over_heat_power_flags():  # R17
    assert house.pi({"pi_temp": 82, "pi_power": "Slowed by heat"})["state"] == "hot"
    assert house.pi({"pi_temp": 82, "pi_power": "Slowed by heat earlier"})["state"] == "hot"
    assert house.pi({"pi_temp": 82, "pi_power": "Under-voltage earlier"})["state"] == "hot"
    assert house.pi({"pi_temp": 60, "pi_power": "Slowed by heat earlier"})["state"] == "power"
    assert house.pi({"pi_temp": 82, "pi_power": "Under-voltage"})["state"] == "power"


def _pc_printing(printer_state, ai_state, down_for, now=T + 1000):
    printer = {"id": "printer", "state": printer_state}
    ai = {"id": "local_ai", "state": ai_state, "since": now - down_for}
    return house.pc_printing(printer, ai, now)


def test_pc_off_for_90s_during_a_print_is_fine():
    assert _pc_printing("printing", "down", 90)["state"] == "fine"


def test_pc_off_for_150s_during_a_print_is_a_problem():
    rec = _pc_printing("printing", "down", 150)
    assert rec["state"] == "off_while_printing" and rec["source"] == "hub"
    assert rec["headline"] == "The PC is off during a print"
    assert rec["cause"] == "Failure detection has stopped until it's back."
    assert records.merge(None, rec, T)["severity"] == "problem"


def test_pc_off_while_idle_is_fine():
    assert _pc_printing("idle", "down", 500)["state"] == "fine"


def test_pc_off_while_paused_counts():
    assert _pc_printing("paused", "down", 150)["state"] == "off_while_printing"


def test_pc_back_during_a_print_is_fine():
    assert _pc_printing("printing", "ready", 500)["state"] == "fine"


def _prev(printer="printing", ai="down", ai_since=T, stale=False):
    out = {"printer": records.merge(None, records.make("printer", printer, "x", "bambuddy"), T),
           "local_ai": dict(records.merge(None, records.make("local_ai", ai, "x", "pi_status"), T), since=ai_since)}
    return {k: dict(v, stale=True) if stale else v for k, v in out.items()}


def _build(prev, pi=None, bambuddy=None, now=T + 150):
    from hub import things
    from tests.helpers_records import inputs
    return things.build_all(inputs(pi=pi, bambuddy=bambuddy), prev, now)["pc_printing"]


def test_build_all_uses_the_previous_since_for_this_cycles_down_record():
    down = {"ai_state": "Down"}
    assert _build(_prev(), pi=down)["state"] == "off_while_printing"
    assert _build(_prev(ai_since=T + 100), pi=down)["state"] == "fine"


def test_silent_pi_status_with_a_stale_down_local_ai_is_fine():
    from hub import things
    from tests.helpers_records import inputs
    prev = _prev()
    prev["local_ai"]["stale"] = True
    ins = inputs(pi_status=None)  # Bambuddy answers: the printer is printing
    ins["bambuddy"] = __import__("tests.helpers_records", fromlist=["bud"]).bud("RUNNING")
    assert things.build_all(ins, prev, T + 150)["pc_printing"]["state"] == "fine"


def test_silent_bambuddy_with_a_stale_printing_printer_is_fine():
    prev = _prev()
    prev["printer"]["stale"] = True
    r = _build(prev, pi={"ai_state": "Down"}, bambuddy=None)
    assert r["state"] == "fine" and r["headline"] == "Can't tell while a source is quiet"


def test_after_a_restart_with_everything_stale_it_is_fine():
    assert _build(_prev(stale=True), pi={"ai_state": "Down"}, bambuddy=None)["state"] == "fine"


def test_the_print_ending_while_the_pc_stays_down_is_fine():
    from tests.helpers_records import bud
    assert _build(_prev(), pi={"ai_state": "Down"}, bambuddy=bud("IDLE"))["state"] == "fine"


def test_local_ai_up_without_its_models_is_not_ready():
    r = house.local_ai({"ai_state": "Can't answer"}, None)
    assert r["state"] == "no_models" and r["headline"] == "Local AI can't answer questions"
