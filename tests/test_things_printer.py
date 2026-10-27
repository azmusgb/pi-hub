import time

from hub.things import printer
from tests.helpers_records import T, merged

T0 = 5000


def bud(state, progress=12, job="HEX_TILE_v72.gcode.3mf", awaiting=False, connected=True):
    return {"connected": connected, "state": state, "bambuddy_state": state, "job_name": job,
            "progress": progress, "layer_num": 5, "total_layers": 100, "nozzle_temp": 250,
            "nozzle_target": 255, "bed_temp": 60, "bed_target": 60, "ams_humidity": 3,
            "filament_type": "PLA", "filament_color": "FFFFFF", "awaiting_plate_clear": awaiting}


RUNNING_V72 = bud("RUNNING")
IDLE_V72 = bud("IDLE", progress=0)


def printing_at(pct, at=T0):
    return merged(printer.printer(bud("RUNNING", pct), None, None, None, at), at=at)


def hm(ts):
    return time.strftime("%H:%M", time.localtime(ts))


def test_bambuddy_decides_even_when_pi_status_has_no_status():
    r = printer.printer(RUNNING_V72, {"x2d_state": "No status"}, None, None, T)
    assert r["state"] == "printing" and r["headline"] == "Printing HEX_TILE_v72, 12%"
    assert r["disagree"] == "pi-status reports No status; Bambuddy reports printing"
    assert r["source"] == "bambuddy" and r["detail"]["job"] == "HEX_TILE_v72"


def test_agreement_or_silence_is_no_disagreement():
    assert printer.printer(RUNNING_V72, {"x2d_state": "Printing"}, None, None, T)["disagree"] == ""
    assert printer.printer(RUNNING_V72, {}, None, None, T)["disagree"] == ""
    assert printer.printer(RUNNING_V72, None, None, None, T)["disagree"] == ""
    assert printer.printer(IDLE_V72, {"x2d_state": "Stopped"}, None, None, T)["disagree"] == ""


def test_idle_below_97_after_printing_is_a_failure():
    prev = printing_at(23)
    r = printer.printer(IDLE_V72, None, None, prev, T0 + 600)
    assert r["state"] == "failed" and r["headline"] == "Stopped at 23%: clear the plate"
    assert r["cause"] == f"Stopped at {hm(T0 + 600)} after 10 min; the printer gave no reason."
    assert r["detail"]["last_progress"] == 23


def test_idle_after_printing_to_the_end_is_just_idle():
    r = printer.printer(IDLE_V72, None, None, printing_at(99), T0 + 600)
    assert r["state"] == "idle" and r["headline"] == "Idle"


def test_a_restart_of_the_same_job_within_15_min_is_attempt_2():
    stopped = merged(printer.printer(IDLE_V72, None, None, printing_at(10), T0), at=T0)
    again = printer.printer(RUNNING_V72, None, None, stopped, T0 + 300)
    assert again["detail"]["attempt"] == 2 and again["headline"].endswith(", attempt 2")
    assert again["detail"]["started"] == T0 + 300


def test_a_restart_after_15_min_is_a_new_job():
    stopped = merged(printer.printer(IDLE_V72, None, None, printing_at(10), T0), at=T0)
    again = printer.printer(RUNNING_V72, None, None, stopped, T0 + 1000)
    assert again["detail"]["attempt"] == 1 and "attempt" not in again["headline"]


def test_a_different_job_is_attempt_1():
    stopped = merged(printer.printer(IDLE_V72, None, None, printing_at(10), T0), at=T0)
    r = printer.printer(bud("RUNNING", job="OTHER.gcode"), None, None, stopped, T0 + 60)
    assert r["detail"]["attempt"] == 1


def test_finished_asks_to_clear_the_plate_until_bambuddy_says_cleared():
    r = printer.printer(bud("FINISH", 100, awaiting=True), None, None, None, T)
    assert r["state"] == "finished" and r["headline"] == "Done: clear the plate"
    assert r["actions"] == [{"name": "clear", "label": "Clear the plate", "confirm": False}]
    r = printer.printer(bud("FINISH", 100, awaiting=False), None, None, None, T)
    assert r["state"] == "idle"


def test_failed_state_from_bambuddy_and_paused_and_offline():
    assert printer.printer(bud("FAILED", 30, awaiting=True), None, None, None, T)["state"] == "failed"
    assert printer.printer(bud("FAILED", 30), None, None, None, T)["state"] == "idle"
    p = printer.printer(bud("PAUSE", 40), None, {"x": 1}, None, T)
    assert p["state"] == "paused" and p["headline"] == "Paused at 40%" and p["detail"]["lab"] == {"x": 1}
    assert p["actions"][0] == {"name": "resume", "label": "Resume the print", "confirm": False}
    o = printer.printer(bud("RUNNING", connected=False), None, None, None, T)
    assert o["state"] == "offline" and o["headline"] == "The printer isn't connected to Bambuddy"
    assert o["actions"] == []


def test_lab_only_while_printing_or_paused():
    assert "lab" not in printer.printer(IDLE_V72, None, {"x": 1}, None, T)["detail"]
    assert printer.printer(RUNNING_V72, None, {"x": 1}, None, T)["detail"]["lab"] == {"x": 1}


def test_no_answer_from_bambuddy_returns_none():
    assert printer.printer(None, {"x2d_state": "Printing"}, None, None, T) is None


def _inferred_failure():
    return merged(printer.printer(IDLE_V72, None, None, printing_at(23), T0 + 600), at=T0 + 600)


def test_an_inferred_failure_holds_until_24_hours():
    f = _inferred_failure()
    for dt in (60, 23 * 3600):
        r = printer.printer(IDLE_V72, None, None, f, T0 + 600 + dt)
        assert r["state"] == "failed" and r["cause"] == f["cause"]
        assert r["headline"] == f["headline"]
        assert records_merge(f, r, T0 + 600 + dt)["since"] == f["since"]
    assert printer.printer(IDLE_V72, None, None, f, T0 + 600 + printer.FAILED_HOLD)["state"] == "idle"


def test_a_new_print_after_an_inferred_failure_is_printing():
    f = _inferred_failure()
    r = printer.printer(RUNNING_V72, None, None, f, T0 + 700)
    assert r["state"] == "printing" and r["detail"]["attempt"] == 2


def records_merge(prev, new, now):
    from hub import records
    return records.merge(prev, new, now)
