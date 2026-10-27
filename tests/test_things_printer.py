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


def test_an_odd_pi_status_answer_is_no_disagreement():
    for odd in ("not a dict", ["x"], 7):
        r = printer.printer(RUNNING_V72, odd, None, None, T)
        assert r["state"] == "printing" and r["disagree"] == ""


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


def test_paused_then_resumed_keeps_the_attempt():
    stopped = merged(printer.printer(IDLE_V72, None, None, printing_at(10), T0), at=T0)
    p2 = merged(printer.printer(RUNNING_V72, None, None, stopped, T0 + 60), at=T0 + 60)
    paused = merged(printer.printer(bud("PAUSE", 20), None, None, p2, T0 + 120), at=T0 + 120)
    assert paused["detail"]["attempt"] == 2
    assert printer.printer(RUNNING_V72, None, None, paused, T0 + 180)["detail"]["attempt"] == 2


def test_two_restarts_make_attempt_3():
    rec = merged(printer.printer(IDLE_V72, None, None, printing_at(10), T0), at=T0)
    t = T0
    for _ in range(1):
        t += 60
        run = merged(printer.printer(bud("RUNNING", 10), None, None, rec, t), at=t)
        t += 60
        rec = merged(printer.printer(IDLE_V72, None, None, run, t), at=t)
    t += 60
    assert printer.printer(RUNNING_V72, None, None, rec, t)["detail"]["attempt"] == 3


def test_blank_job_name_while_idle_keeps_the_chain():
    stopped = merged(printer.printer(IDLE_V72, None, None, printing_at(10), T0), at=T0)
    blank = merged(printer.printer(bud("IDLE", 0, job=None), None, None, stopped, T0 + 30), at=T0 + 30)
    assert blank["detail"]["job"] == "HEX_TILE_v72"
    assert printer.printer(RUNNING_V72, None, None, blank, T0 + 60)["detail"]["attempt"] == 2


def test_a_persisting_real_failed_keeps_its_cause_and_start():
    first = merged(printer.printer(bud("FAILED", 30, awaiting=True), None, None, printing_at(30), T0 + 600), at=T0 + 600)
    again = printer.printer(bud("FAILED", 30, awaiting=True), None, None, first, T0 + 1200)
    assert again["state"] == "failed" and again["cause"] == first["cause"]
    assert again["detail"]["started"] == first["detail"]["started"] == T0


def test_paused_then_idle_below_97_is_failed():
    paused = merged(printer.printer(bud("PAUSE", 40), None, None, None, T0), at=T0)
    assert printer.printer(IDLE_V72, None, None, paused, T0 + 60)["state"] == "failed"


def test_finished_cleared_restart_is_attempt_1():
    done = merged(printer.printer(bud("FINISH", 100, awaiting=True), None, None, printing_at(99), T0), at=T0)
    cleared = merged(printer.printer(IDLE_V72, None, None, done, T0 + 30), at=T0 + 30)
    assert cleared["state"] == "idle"
    again = printer.printer(RUNNING_V72, None, None, cleared, T0 + 300)
    assert again["detail"]["attempt"] == 1
    cleared2 = merged(printer.printer(bud("FINISH", 100), None, None, None, T0), at=T0)
    assert printer.printer(RUNNING_V72, None, None, cleared2, T0 + 300)["detail"]["attempt"] == 1


def test_real_failed_then_idle_is_idle_not_held():
    f = merged(printer.printer(bud("FAILED", 30, awaiting=True), None, None, printing_at(30), T0 + 60), at=T0 + 60)
    assert "inferred" not in f["detail"]
    assert printer.printer(IDLE_V72, None, None, f, T0 + 120)["state"] == "idle"


def test_missing_progress_and_job_name_do_not_crash():
    r = printer.printer(bud("RUNNING", None, job=None), None, None, None, T)
    assert r["state"] == "printing" and r["detail"]["job"] is None
    prev = merged(r)
    assert printer.printer(bud("IDLE", None, job=None), None, None, prev, T + 5)["state"] == "failed"


def test_the_record_keeps_bambuddys_own_state():
    assert printer.printer(bud("FAILED", 30), None, None, None, T)["detail"]["bambuddy_state"] == "FAILED"
    assert printer.printer(RUNNING_V72, None, None, None, T)["detail"]["bambuddy_state"] == "RUNNING"


def test_a_reprint_after_a_normal_finish_is_attempt_1():
    done = merged(printer.printer(bud("FINISH", 100, awaiting=True), None, None, printing_at(99), T0), at=T0)
    assert done["detail"]["from_finished"] is True
    again = printer.printer(RUNNING_V72, None, None, done, T0 + 60)
    assert again["detail"]["attempt"] == 1
    plain = merged(printer.printer(bud("FINISH", 100), None, None, printing_at(99), T0), at=T0)
    assert plain["state"] == "idle" and plain["detail"]["from_finished"] is True
    assert printer.printer(RUNNING_V72, None, None, plain, T0 + 60)["detail"]["attempt"] == 1


# ---- R30: an unknown pi-status word contradicts Bambuddy only while it is printing or paused ----

def test_no_status_is_a_disagreement_only_while_printing_or_paused():
    no_status = {"x2d_state": "No status"}
    assert printer.printer(IDLE_V72, no_status, None, None, T)["disagree"] == ""
    assert printer.printer(bud("RUNNING"), no_status, None, None, T)["disagree"] == \
        "pi-status reports No status; Bambuddy reports printing"
    assert printer.printer(bud("PAUSE"), no_status, None, None, T)["disagree"] == \
        "pi-status reports No status; Bambuddy reports paused"
    assert printer.printer(bud("IDLE", connected=False), no_status, None, None, T)["disagree"] == ""
    assert printer.printer(IDLE_V72, {"x2d_state": "Printing"}, None, None, T)["disagree"] == \
        "pi-status reports Printing; Bambuddy reports idle"


# ---- R31: an attempt chain continues only from a failure, or the idle that directly followed one ----

def test_a_plain_idle_never_chains():
    idle = merged(printer.printer(IDLE_V72, None, None, None, T0), at=T0)
    assert idle["state"] == "idle" and "after_failure" not in idle["detail"]
    again = printer.printer(RUNNING_V72, None, None, idle, T0 + 300)
    assert again["detail"]["attempt"] == 1 and "attempt" not in again["headline"]


def _failed_then_idle(failed_at=T0):
    failed = merged(printer.printer(bud("FAILED", 30, awaiting=True), None, None, printing_at(30), failed_at), at=failed_at)
    return merged(printer.printer(IDLE_V72, None, None, failed, failed_at + 60), at=failed_at + 60)


def test_failed_then_idle_then_running_within_15_min_of_the_failure_is_attempt_2():
    idle = _failed_then_idle()
    assert idle["state"] == "idle" and idle["detail"]["after_failure"] is True and idle["detail"]["failed_at"] == T0
    idle2 = merged(printer.printer(IDLE_V72, None, None, idle, T0 + 90), at=T0 + 90)  # stays marked while idle
    assert idle2["detail"]["after_failure"] is True and idle2["detail"]["failed_at"] == T0
    assert printer.printer(RUNNING_V72, None, None, idle2, T0 + 600)["detail"]["attempt"] == 2


def test_the_same_after_15_min_is_attempt_1():
    idle = _failed_then_idle()
    assert printer.printer(RUNNING_V72, None, None, idle, T0 + printer.ATTEMPT_WINDOW)["detail"]["attempt"] == 1


# ---- R33: starting states, and judging by the last known record ----

def _run(steps, prev=None, at=T0):
    """Feeds Bambuddy readings 30 s apart through the builder and merge; returns the last record."""
    for b in steps:
        prev = records_merge(prev, printer.printer(b, None, None, prev, at), at)
        at += 30
    return prev


def test_prepare_slicing_and_init_are_a_print_starting():
    for raw in ("PREPARE", "SLICING", "INIT"):
        r = printer.printer(bud(raw, 0), None, None, None, T)
        assert r["state"] == "printing" and r["detail"]["starting"] is True
        assert r["headline"] == "Starting HEX_TILE_v72"
    assert "starting" not in printer.printer(RUNNING_V72, None, None, None, T)["detail"]


def test_a_stop_then_prepare_then_running_is_attempt_2():
    # the repro: RUNNING 10, 11, IDLE 11, IDLE 0, PREPARE 0, RUNNING 1
    steps = [bud("RUNNING", 10), bud("RUNNING", 11), bud("IDLE", 11), bud("IDLE", 0)]
    failed = _run(steps)
    starting = _run([bud("PREPARE", 0)], failed, T0 + 120)
    assert starting["state"] == "printing" and starting["detail"]["attempt"] == 2
    assert starting["headline"] == "Starting HEX_TILE_v72, attempt 2"
    running = _run([bud("RUNNING", 1)], starting, T0 + 150)
    assert running["detail"]["attempt"] == 2 and running["headline"] == "Printing HEX_TILE_v72, 1%, attempt 2"


def test_running_11_idle_prepare_running_is_attempt_2():
    r = _run([bud("RUNNING", 11), bud("IDLE", 11), bud("PREPARE", 0), bud("RUNNING", 1)])
    assert r["state"] == "printing" and r["detail"]["attempt"] == 2


def test_printing_then_unknown_then_idle_at_40_is_an_inferred_failure():
    printing = _run([bud("RUNNING", 30), bud("RUNNING", 40)])
    unknown = _run([bud("WEIRD", 40)], printing, T0 + 60)
    assert unknown["state"] == "unknown" and unknown["detail"]["attempt"] == 1
    assert unknown["detail"]["last_progress"] == 40 and unknown["detail"]["started"] == T0
    assert unknown["detail"]["last_known"]["state"] == "printing"
    r = printer.printer(bud("IDLE", 0), None, None, unknown, T0 + 600)
    assert r["state"] == "failed" and r["detail"]["inferred"] is True
    assert r["headline"] == "Stopped at 40%: clear the plate"
    assert r["cause"] == f"Stopped at {hm(T0 + 600)} after 10 min; the printer gave no reason."


def test_offline_mid_chain_keeps_the_attempt():
    failed = _run([bud("RUNNING", 10), bud("IDLE", 0)])
    attempt2 = _run([bud("RUNNING", 1)], failed, T0 + 300)
    assert attempt2["detail"]["attempt"] == 2
    gone = _run([bud("RUNNING", 5, connected=False), bud("RUNNING", 5, connected=False)], attempt2, T0 + 330)
    assert gone["state"] == "offline" and gone["detail"]["attempt"] == 2
    back = _run([bud("RUNNING", 6)], gone, T0 + 390)
    assert back["state"] == "printing" and back["detail"]["attempt"] == 2
    assert back["detail"]["started"] == T0 + 300 and back["headline"].endswith(", attempt 2")


def test_an_inferred_failure_held_through_an_unknown_reading():
    f = _inferred_failure()
    unknown = _run([bud("WEIRD", 0)], f, T0 + 700)
    r = printer.printer(IDLE_V72, None, None, unknown, T0 + 800)
    assert r["state"] == "failed" and r["cause"] == f["cause"] and r["detail"]["failed_at"] == T0 + 600


def test_init_without_a_job_is_the_printer_powering_on_not_a_print():
    # R38: INIT at power-on, with no job, must not read as a print starting (and then failing)
    idle = _run([bud("IDLE", 0, job="")])
    r = _run([bud("INIT", 0, job=""), bud("IDLE", 0, job="")], idle, T0 + 60)
    assert r["state"] == "idle" and "inferred" not in r["detail"]
    assert printer.printer(bud("INIT", 0, job=""), None, None, None, T)["state"] == "idle"
    assert printer.printer(bud("INIT", 0), None, None, None, T)["state"] == "printing"


def test_whole_number_progress_reads_without_a_decimal():
    # Bambuddy sends progress as a float: 0.0 must read "0%", not "0.0%"
    r = printer.printer(bud("RUNNING", 0.0), None, None, None, T)
    assert r["headline"] == "Printing HEX_TILE_v72, 0%"
    assert r["detail"]["progress"] == 0 and isinstance(r["detail"]["progress"], int)
    assert printer.printer(bud("PAUSE", 16.0), None, None, None, T)["headline"] == "Paused at 16%"
    assert printer.printer(bud("RUNNING", 16.5), None, None, None, T)["headline"] == "Printing HEX_TILE_v72, 16.5%"
