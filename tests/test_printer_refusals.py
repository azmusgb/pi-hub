"""The printer-only rules of S5, shared by experiments and Quick Print (A19 P6)."""
from hub import lab_start

OK = {"connected": True, "bambuddy_state": "IDLE", "hms": [], "bed_temp": 24.0}


def test_a_ready_printer_has_no_refusals():
    assert lab_start.printer_refusals(OK) == []
    assert lab_start.printer_refusals({**OK, "bambuddy_state": "FINISH"}) == []


def test_each_blocker_is_named():
    assert lab_start.printer_refusals(None) == ["Bambuddy can't see the printer."]
    assert lab_start.printer_refusals({**OK, "connected": False}) == ["Bambuddy can't see the printer."]
    assert "isn't idle (running)" in lab_start.printer_refusals({**OK, "bambuddy_state": "RUNNING"})[0]
    assert "isn't idle (unknown)" in lab_start.printer_refusals({**OK, "bambuddy_state": None})[0]
    assert "has an error" in lab_start.printer_refusals({**OK, "hms": [1]})[0]
    assert "unknown" in lab_start.printer_refusals({**OK, "bed_temp": None})[0]
    assert "below 35" in lab_start.printer_refusals({**OK, "bed_temp": 40.0})[0]


def test_the_bed_can_be_left_out():
    assert lab_start.printer_refusals({**OK, "bed_temp": 60.0}, ignore_bed=True) == []
    assert lab_start.printer_refusals({**OK, "bed_temp": None}, ignore_bed=True) == []


def test_the_experiment_rules_are_this_plus_the_experiment():
    x = {"id": "E-1", "status": "ready", "staged": {"library_file": 3, "sha256": "a" * 64}}
    assert lab_start.refusals(OK, x) == []
    hot = {**OK, "bed_temp": 50.0}
    assert lab_start.refusals(hot, x) == lab_start.printer_refusals(hot)
    assert lab_start.refusals(hot, {**x, "status": "draft"})[-1] == lab_start.printer_refusals(hot)[-1]
    assert lab_start.refusals(None, None) == ["The print lab has no such experiment."]
