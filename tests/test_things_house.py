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
