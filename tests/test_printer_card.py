"""The printer card the pages read (now.printer_from): a stale record keeps when it was last read, for "last seen"."""
from hub import now


def test_a_stale_printer_card_says_when_it_was_last_read():
    rec = {"state": "printing", "headline": "Printing", "detail": {"progress": 40}, "actions": [{"name": "pause"}],
           "stale": True, "as_of": 1793770000, "cause": "Bambuddy not answering since 12:40; last read 3 min ago."}
    card = now.printer_from(rec)
    assert card["stale"] is True and card["as_of"] == 1793770000
    assert card["actions"] == []  # nothing to press on a reading that may be old
    assert now.printer_from(None).get("as_of") is None


# A7 H2: the card carries where its readings came from, so the page's lamp agrees with them. Before, the record card had
# no telemetry and every page said "No answer" (idle) or "Backup readings" (printing) beside fresh Bambuddy readings.
def _rec(**kw):
    rec = {"state": "idle", "headline": "Idle", "detail": {}, "actions": [], "source": "bambuddy", "stale": False,
           "as_of": 1793856806.25, "cause": ""}
    rec.update(kw)
    return rec


def test_a_fresh_bambuddy_card_is_live_with_its_source_and_time():
    t = now.printer_from(_rec())["telemetry"]
    assert t["status"] == "live" and t["source"] == "Bambuddy"
    from datetime import datetime
    assert abs(datetime.fromisoformat(t["observed_at"]).timestamp() - 1793856806.25) < 1


def test_the_card_says_stale_offline_unknown_and_backup_as_they_are():
    assert now.printer_from(_rec(stale=True, state="printing"))["telemetry"]["status"] == "stale"
    assert now.printer_from(_rec(state="offline"))["telemetry"]["status"] == "offline"
    assert now.printer_from(_rec(state="unknown"))["telemetry"]["status"] == "none"
    pi = now.printer_from(_rec(source="pi_status", state="printing"))["telemetry"]
    assert pi["status"] == "degraded" and pi["source"] == "The Pi's status service"
    assert "telemetry" not in now.printer_from(None) or now.printer_from(None)["telemetry"]["status"] == "none"
