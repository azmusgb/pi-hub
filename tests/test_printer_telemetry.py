from hub.printer_telemetry import normalize_printer


def test_bambuddy_is_state_fallback_without_pi_status():
    p = normalize_printer(None, {
        "connected": True,
        "bambuddy_state": "RUNNING",
        "progress": 37,
        "layer_num": 12,
        "total_layers": 100,
        "nozzle_temp": 219.5,
        "bed_temp": 60,
    })
    assert p["state"] == "printing"
    assert p["progress"] == 37
    assert p["headline"] == "Printing, 37%"
    assert p["telemetry"]["status"] == "live"
    assert p["telemetry"]["source"] == "Bambuddy"
    assert p["layer"]["percent"] == 12.0


def test_pi_status_is_degraded_but_usable_fallback():
    p = normalize_printer({
        "x2d_state": "Printing",
        "x2d_progress": 22,
        "x2d_minutes_left": 91,
        "x2d_left": "1 h 31 min",
    }, None)
    assert p["state"] == "printing"
    assert p["progress"] == 22
    assert p["minutes_left"] == 91
    assert p["telemetry"]["status"] == "degraded"
    assert p["telemetry"]["source"] == "Pi status"


def test_missing_sources_do_not_invent_measurements():
    p = normalize_printer(None, None)
    assert p["state"] == "none"
    assert p["telemetry"]["status"] == "offline"
    assert p["nozzle_temp"] is None
    assert p["bed_temp"] is None
    assert p["layer_num"] is None
    assert p["minutes_left"] is None


def test_progress_is_clamped_and_invalid_values_become_zero():
    high = normalize_printer(
        {"x2d_state": "Printing", "x2d_progress": 170},
        None,
    )
    low = normalize_printer(
        None,
        {"connected": True, "state": "RUNNING", "progress": -3},
    )
    bad = normalize_printer(
        None,
        {"connected": True, "state": "RUNNING", "progress": "wat"},
    )
    assert high["progress"] == 100
    assert low["progress"] == 0
    assert bad["progress"] == 0
