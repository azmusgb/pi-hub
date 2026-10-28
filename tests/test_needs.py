import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, needs, records, sources  # noqa: E402
from tests.helpers_records import PI, bud, records_from  # noqa: E402

NOW = 1_800_000_000
QUIET = dict(PI, mirror={"last_ok": NOW})  # pi-status on a quiet day, the movie copy up to date


def problems(pi=None, b=None, **kw):
    """What records.problems() gives after one refresh with these answers."""
    recs = records_from(dict(QUIET, **(pi or {})), b, now=NOW, **kw)
    return records.problems(recs)


FINISHED = bud("FINISH", progress=100, awaiting=True)
FAILED = bud("FAILED", progress=40, awaiting=True)
FEED = {"cards": [
    {"kind": "needs", "title": "Needs you", "text": "Approve the E-009 print.", "tone": "attention", "count": 1},
    {"kind": "watch", "title": "Disk", "text": "C: is 92% full.", "tone": "warn"},
    {"kind": "weather", "title": "Weather", "text": "Sunny", "tone": "ok"},
]}


def test_needs_merges_the_three_sources():
    n = needs.build([], FEED, NOW, problems({"drive_state": "Not mounted"}, FINISHED))
    assert n["count"] == len(n["items"]) == 4
    local = [i for i in n["items"] if i["source"] == "Local AI"]
    assert {i["title"] for i in local} == {"Needs you", "Disk"}
    assert all(i["link"] == "tool:assistant" for i in local)
    hub = {i["title"]: i for i in n["items"] if i["source"] == "Pi Hub"}
    assert hub["Movies drive"]["link"] == "/drives"
    # the printer's finished record says "clear the plate" (it was a print event before the records)
    assert hub["Bambu X2D"]["detail"] == "Done: clear the plate" and hub["Bambu X2D"]["link"] == "/workshop"
    assert n["unread"] == []


def test_needs_ignores_ok_cards_and_cleared_prints():
    feed = {"cards": [{"kind": "needs", "title": "All clear", "text": "Nothing needs you right now.", "tone": "ok", "count": 0}]}
    # the plate was cleared: Bambuddy says FINISH without awaiting_plate_clear, so the record is idle
    n = needs.build([], feed, NOW, problems(b=bud("FINISH", progress=100)))
    assert n == {"count": 0, "items": [], "unread": []}


def test_a_failed_print_needs_you():
    n = needs.build([], {"cards": []}, NOW, problems(b=FAILED))
    item = n["items"][0]
    assert item["title"] == "Bambu X2D" and item["tone"] == "bad"
    assert item["detail"].startswith("Stopped at 40%: clear the plate")
    assert item["link"] == "/workshop"


def test_items_come_worst_first():
    tones = [i["tone"] for i in needs.build([], FEED, NOW, problems(b=FAILED))["items"]]
    assert tones == ["bad", "attention", "warn"]


def test_needs_lists_sources_it_could_not_read():
    n = needs.build([], None, NOW, problems({"pi_temp": 82, "pi_power": "Slowed by heat"}))
    assert n["unread"] == ["Local AI"] and n["count"] == 1
    assert n["items"][0]["title"] == "Raspberry Pi" and "Running hot at 82" in n["items"][0]["detail"]


def test_api_needs_answers_when_local_ai_is_off(monkeypatch):
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    r = TestClient(hub_app.app).get("/api/needs")
    assert r.status_code == 200 and r.json()["unread"] == ["Local AI"]


def test_the_hubs_own_live_issues_need_you_too():
    n = needs.build([], {"cards": []}, NOW, problems({"services": {"plex": False, "homebridge": True}}))
    assert n["items"][0] == {"id": "pi:Movies", "source": "Pi Hub", "tone": "bad", "title": "Movies",
                             "detail": "The movie service has stopped", "link": "/pi"}


def test_the_alert_history_is_not_needs():
    # "Workshop display went offline" then "is back": history, not something to do. Live records cover what's still wrong.
    import inspect
    assert "alerts" not in inspect.signature(needs.build).parameters


def test_a_cleared_plate_stops_asking():
    # was "a finished print stops asking after a day": the record now knows when the plate is cleared
    assert needs.build([], {"cards": []}, NOW, problems(b=FINISHED))["count"] == 1
    assert needs.build([], {"cards": []}, NOW, problems(b=bud("IDLE")))["count"] == 0


def test_ids_are_stable():
    feed = {"cards": [{"kind": "watch", "id": "watch-disk", "title": "Disk", "text": "C: is 92% full.", "tone": "warning"},
                      {"kind": "needs", "id": "needs-e9", "title": "Needs you", "text": "Approve.", "tone": "attention"}]}
    found = problems({"drive_state": "Missing"}, FINISHED)
    a = needs.build([], feed, NOW, found)
    b = needs.build([], feed, NOW + 30, found)
    ids = [i["id"] for i in a["items"]]
    assert ids == [i["id"] for i in b["items"]]
    assert len(set(ids)) == len(ids)
    assert set(ids) == {"pi:Movies drive", "localai:watch-disk", "localai:needs-e9", "pi:Bambu X2D"}
    failed = needs.build([], None, NOW, problems(b=FAILED))
    assert failed["items"][0]["id"] == "pi:Bambu X2D"


def test_local_ai_warning_is_kept():
    feed = {"cards": [{"kind": "watch", "id": "watch-disk", "title": "Disk", "text": "C: is 92% full.", "tone": "warning"}]}
    n = needs.build([], feed, NOW, [])
    assert [(i["id"], i["tone"]) for i in n["items"]] == [("localai:watch-disk", "warn")]


def test_local_ai_home_cards_not_echoed():
    feed = {"cards": [{"kind": "home", "id": "home-movies", "title": "Movies drive", "text": "Not connected.", "tone": "warning"}]}
    n = needs.build([], feed, NOW, problems({"drive_state": "Not mounted"}))
    assert [i["id"] for i in n["items"]] == ["pi:Movies drive"]


def test_the_printer_camera_and_document_printer_are_not_folded_into_the_x2d():
    # all three name a printer; the X2D's one-row rule is for other apps' echoes of the X2D, not the hub's own things
    found = problems(b=FAILED, camera={"ok": False, "reason": "printer_unreachable"}, paper={"state": "Paused"})
    titles = {i["title"] for i in needs.build([], {"cards": []}, NOW, found)["items"]}
    assert titles == {"Bambu X2D", "Printer camera", "Document printer"}


def _hms(*errs):
    return {**bud("PAUSE", progress=40), "hms": [{"code": c, "severity": s, "module": 5} for c, s in errs]}


def test_needs_lists_one_item_per_hms_code():
    b = _hms(("0500_0200", 2), ("0300_0100", 3))
    items = needs.build([], {"cards": []}, NOW, problems(b=b))["items"]
    by_id = {i["id"]: i for i in items}
    assert by_id["pi:source:hms:0500_0200"]["title"] == "Printer needs attention (0500_0200)"
    assert by_id["pi:source:hms:0500_0200"]["tone"] == "bad"
    assert by_id["pi:source:hms:0300_0100"]["tone"] == "warn"
    assert by_id["pi:source:hms:0300_0100"]["link"] == "/workshop"


def test_obico_and_hms_items_are_not_folded_into_the_printer_row():
    obico = {"enabled": True, "per_printer": {"1": {"class": "failure", "error": None}}}
    b = {**FAILED, "hms": [{"code": "0500_0200", "severity": 2, "module": 5}]}
    items = needs.build([], {"cards": []}, NOW, problems(b=b, obico=obico))["items"]
    ids = {i["id"] for i in items}
    assert len(items) == 3
    assert {"Failure detection", "Printer needs attention (0500_0200)"} <= {i["title"] for i in items}
    assert "Failure detected on the X2D" in {i["detail"] for i in items}
