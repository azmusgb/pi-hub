"""The printer card the pages read (now.printer_from): a stale record keeps when it was last read, for "last seen"."""
from hub import now


def test_a_stale_printer_card_says_when_it_was_last_read():
    rec = {"state": "printing", "headline": "Printing", "detail": {"progress": 40}, "actions": [{"name": "pause"}],
           "stale": True, "as_of": 1793770000, "cause": "Bambuddy not answering since 12:40; last read 3 min ago."}
    card = now.printer_from(rec)
    assert card["stale"] is True and card["as_of"] == 1793770000
    assert card["actions"] == []  # nothing to press on a reading that may be old
    assert now.printer_from(None).get("as_of") is None
