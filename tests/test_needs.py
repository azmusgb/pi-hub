import os
import tempfile
from datetime import datetime, timezone

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


def test_each_hms_item_says_its_own_code_and_severity():  # final review M4, I2
    b = _hms(("0500_0200", 2), ("0300_0100", 3), ("0700_0100", None))
    items = needs.build([], {"cards": []}, NOW, problems(b=b))["items"]
    by_id = {i["id"]: i for i in items}
    assert by_id["pi:source:hms:0500_0200"]["detail"] == "0500_0200, severity 2"
    assert by_id["pi:source:hms:0300_0100"]["detail"] == "0300_0100, severity 3"
    assert by_id["pi:source:hms:0700_0100"]["detail"] == "0700_0100, severity unknown"
    assert by_id["pi:source:hms:0700_0100"]["tone"] == "warn"


# ---- the print lab's own asks (Plan D, Task 1) ----
def _need(id, action, why="why", urgency=1, **kw):
    return dict({"id": id, "urgency": urgency, "action": action, "why": why, "command": "x"}, **kw)


def _lab(*needs, project="hex-tile", at="2026-10-28T10:00:00+00:00"):
    return [(project, at, list(needs))]


def _labitems(n):
    return [i for i in n["items"] if i["source"] == "Print lab"]


def test_lab_kinds_tone_title_link_as_of():
    lab = _lab(_need("E-001", "Judge the print", "Look at the face."), _need("E-002", "Approve or drop", urgency=2),
               _need("E-003", "Send it to the printer"), _need("E-004", "Fix the plan", urgency=3))
    got = {i["id"]: i for i in _labitems(needs.build([], None, NOW, lab=lab))}
    assert got["pi:lab:hex-tile:E-001"]["tone"] == "attention"
    assert got["pi:lab:hex-tile:E-001"]["title"] == "E-001: Judge the print"
    assert got["pi:lab:hex-tile:E-001"]["detail"] == "Look at the face."
    assert got["pi:lab:hex-tile:E-001"]["link"] == "/lab?e=E-001&do=judge"
    assert got["pi:lab:hex-tile:E-002"]["tone"] == "attention" and got["pi:lab:hex-tile:E-002"]["link"] == "/lab?e=E-002"
    assert got["pi:lab:hex-tile:E-003"]["tone"] == "warn"
    assert got["pi:lab:hex-tile:E-004"]["tone"] == "warn"
    assert all(i["as_of"] == "2026-10-28T10:00:00+00:00" for i in got.values())


def test_lab_skips_run_the_check_keeps_fix_the_plan():
    lab = _lab(_need("E-001", "Run the check", urgency=3), _need("E-002", "Run the build", urgency=3),
               _need("E-003", "Fix the plan", urgency=3))
    assert [i["id"] for i in _labitems(needs.build([], None, NOW, lab=lab))] == ["pi:lab:hex-tile:E-003"]


def test_lab_judge_waits_for_due_at():
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat()
    later, past = iso(NOW + 3600), iso(NOW - 60)
    assert not _labitems(needs.build([], None, NOW, lab=_lab(_need("E-1", "Judge the print", due_at=later))))
    assert _labitems(needs.build([], None, NOW, lab=_lab(_need("E-1", "Judge the print", due_at=past))))
    assert _labitems(needs.build([], None, NOW, lab=_lab(_need("E-1", "Judge the print", due_at=later)), printer_done=True))
    assert _labitems(needs.build([], None, NOW, lab=_lab(_need("E-1", "Judge the print", due_at=None))))


def test_lab_malformed_entries_skipped():
    lab = [("p", "t", [None, "x", {"action": "Approve or drop"}, {"id": "E-1"}, {"id": 5, "action": "Approve or drop"},
                       {"id": "bad id", "action": "Approve or drop", "urgency": 1},
                       _need("E-2", "Judge the print", due_at="not a date"),
                       {"id": "E-3", "action": "Approve or drop", "urgency": "x", "why": None}]),
           ("q", "t", None), ("r", "t", "nope"), "junk", ("s",)]
    n = needs.build([], None, NOW, lab=lab)
    assert not _labitems(n)


def test_lab_two_projects():
    lab = _lab(_need("E-001", "Approve or drop"), project="a") + _lab(_need("E-001", "Approve or drop"), project="b")
    assert {i["id"] for i in _labitems(needs.build([], None, NOW, lab=lab))} == {"pi:lab:a:E-001", "pi:lab:b:E-001"}


def test_lab_feed_cards_dropped_others_kept():
    feed = {"cards": [{"id": "judge-E-1", "kind": "needs", "title": "J", "text": "t", "tone": "attention"},
                      {"id": "lab-x", "kind": "needs", "title": "L", "text": "t", "tone": "attention"},
                      {"id": "disk", "kind": "watch", "title": "Disk", "text": "t", "tone": "warn"}]}
    n = needs.build([], feed, NOW)
    assert [i["id"] for i in n["items"]] == ["localai:disk"]


def test_lab_item_survives_one_row_beside_printer_record():
    lab = _lab(_need("E-001", "Judge the print", "Look at the printed face."), _need("E-002", "Send it to the printer"))
    n = needs.build([], None, NOW, problems(None, FINISHED), lab=lab)
    assert {i["id"] for i in _labitems(n)} == {"pi:lab:hex-tile:E-001", "pi:lab:hex-tile:E-002"}
    assert any(i["title"] == "Bambu X2D" for i in n["items"])


def test_api_needs_without_lab_table(monkeypatch):
    import sqlite3
    monkeypatch.setenv("HUB_DB", os.path.join(tempfile.mkdtemp(), "fresh.db"))
    from hub import lab
    lab._ready_dbs.discard(os.environ["HUB_DB"])
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    assert lab.stored_needs() == []
    assert TestClient(hub_app.app).get("/api/needs").status_code == 200


def test_printer_done_false_when_record_stale(monkeypatch):
    seen = {}
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    monkeypatch.setattr(needs, "build", lambda *a, **kw: seen.update(kw) or {"items": [], "count": 0})
    for rec, want in (({"state": "finished"}, True), ({"state": "finished", "stale": True}, False),
                      ({"state": "failed", "stale": True}, False)):
        monkeypatch.setattr(records, "all", lambda rec=rec: {"printer": {"severity": "ok", **rec}})
        TestClient(hub_app.app).get("/api/needs")
        assert seen["printer_done"] is want


def test_stored_needs_parses_only_on_resync(monkeypatch):
    import json
    from hub import lab
    monkeypatch.setenv("HUB_DB", os.path.join(tempfile.mkdtemp(), "cache.db"))
    lab.ready()
    lab._needs_cache.clear()

    def put(synced, needs_):
        from hub import db
        db.run("INSERT OR REPLACE INTO lab_projects (project, meta, index_json, synced_at) VALUES (?, ?, ?, ?)",
               "p", "{}", json.dumps({"generated_at": "g", "needs": needs_}), synced)
    put("t1", [{"id": "E-1"}])
    calls = []
    real = json.loads
    monkeypatch.setattr(lab.json, "loads", lambda *a, **k: calls.append(1) or real(*a, **k))
    assert lab.stored_needs() == [("p", "g", [{"id": "E-1"}])]
    n = len(calls)
    assert n >= 1
    assert lab.stored_needs() == [("p", "g", [{"id": "E-1"}])]
    assert len(calls) == n, "unchanged synced_at must not re-parse"
    put("t2", [{"id": "E-2"}])
    assert lab.stored_needs() == [("p", "g", [{"id": "E-2"}])]
    assert len(calls) > n


# ---- which items are about the X2D (Home's printer card goes amber or red with them; IMG_1047, 28 Oct) ----
def _about(items):
    return {i["id"] for i in items if i.get("about") == "printer"}


def test_printer_items_say_they_are_about_the_printer():
    obico = {"enabled": True, "per_printer": {"1": {"class": "error", "error": "Failed to capture snapshot for printer 1"}}}
    b = {**bud("RUNNING", progress=10), "hms": [{"code": "0500_0200", "severity": 2, "module": 5}]}
    feed = {"cards": [{"kind": "watch", "id": "watch-mac-disk", "title": "Worth a look", "text": "Mac disk is 95% full",
                       "tone": "warning"}]}
    n = needs.build([], feed, NOW, problems({"drive_state": "Missing"}, b, obico=obico),
                    lab=_lab(_need("E-022", "Judge the print")))
    assert _about(n["items"]) == {"pi:source:hms:0500_0200", "pi:Failure detection"}
    assert all("about" not in i for i in n["items"] if i["id"] in ("pi:Movies drive", "localai:watch-mac-disk",
                                                                    "pi:lab:hex-tile:E-022"))
    assert _about(needs.build([], {"cards": []}, NOW, problems(b=FAILED))["items"]) == {"pi:Bambu X2D"}


def test_a_local_ai_item_that_names_the_printer_is_about_it():
    feed = {"cards": [{"kind": "watch", "id": "watch-x2d", "title": "Heads up", "text": "The X2D is offline.", "tone": "warning"},
                      {"kind": "watch", "id": "watch-disk", "title": "Disk", "text": "C: is 92% full.", "tone": "warning"}]}
    assert _about(needs.build([], feed, NOW, [])["items"]) == {"localai:watch-x2d"}


def test_blind_failure_detection_says_what_to_do_and_sorts_above_worth_a_look():  # IMG_1047, 28 Oct
    obico = {"enabled": True, "per_printer": {"1": {"class": "error", "error": "Failed to capture snapshot for printer 1"}}}
    feed = {"cards": [{"kind": "watch", "id": "watch-mac-disk", "title": "Worth a look", "text": "Mac disk is 95% full",
                       "tone": "warning", "at": NOW + 100}]}
    n = needs.build([], feed, NOW, problems(b=bud("RUNNING", progress=10), obico=obico))
    assert [i["id"] for i in n["items"]] == ["pi:Failure detection", "localai:watch-mac-disk"]
    blind = n["items"][0]
    assert blind["title"] == "Failure detection is blind"
    assert blind["detail"] == "The camera isn't sending frames to Bambuddy."
    assert blind["tone"] == "attention"
    assert blind["link"] == "tool:bambuddy/settings?tab=failure-detection"
    assert blind["action"] == {"key": "open_bambuddy", "link": "tool:bambuddy/settings?tab=failure-detection"}
    assert "snapshot" not in str(n)


def test_mac_disk_full_offers_what_is_using_it():  # IMG_1047, 28 Oct: "Mac disk is 95% full" had nothing to do
    from urllib.parse import unquote
    feed = {"cards": [{"kind": "watch", "id": "watch-mac-disk", "title": "Worth a look", "text": "Mac disk is 95% full",
                       "tone": "warning", "ask": "health"},
                      {"kind": "watch", "id": "watch-disk", "title": "Disk", "text": "C: is 92% full.", "tone": "warning"}]}
    by_id = {i["id"]: i for i in needs.build([], feed, NOW, [])["items"]}
    mac = by_id["localai:watch-mac-disk"]
    assert mac["title"] == "Worth a look"
    assert mac["detail"] == "Mac disk is 95% full · What's using it"
    assert mac["link"].startswith("tool:assistant/#ask?context=")
    assert unquote(mac["link"].split("context=", 1)[1]) == "Pi Hub › Mac disk is 95% full. What's using the space?"
    assert by_id["localai:watch-disk"]["link"] == "tool:assistant"  # other cards keep the plain Assistant link


def test_a_local_ai_item_about_another_printer_is_not_about_the_x2d():  # review: "printer" alone isn't the X2D
    def card(id, title, text):
        return {"cards": [{"kind": "watch", "id": id, "title": title, "text": text, "tone": "warning"}]}
    assert _about(needs.build([], card("watch-doc", "Heads up", "Document printer offline"), NOW, [])["items"]) == set()
    assert _about(needs.build([], card("watch-toner", "Brother printer", "Toner low"), NOW, [])["items"]) == set()
    assert _about(needs.build([], card("watch-bambu", "Heads up", "Bambu printer offline"), NOW, [])["items"]) == \
        {"localai:watch-bambu"}


def test_another_printer_item_does_not_fold_with_x2d():
    feed = {"cards": [
        {"kind": "watch", "id": "watch-doc", "title": "Document printer", "text": "Paper jam", "tone": "bad"},
        {"kind": "watch", "id": "watch-bambu", "title": "Bambu printer", "text": "Filament low", "tone": "warning"},
    ]}
    res = needs.build([], feed, NOW, [])["items"]
    ids = {i["id"] for i in res}
    assert "localai:watch-doc" in ids
    assert "localai:watch-bambu" in ids
