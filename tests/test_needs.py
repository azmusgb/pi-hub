import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, needs, sources  # noqa: E402

NOW = 1_800_000_000
FEED = {"cards": [
    {"kind": "needs", "title": "Needs you", "text": "Approve the E-009 print.", "tone": "attention", "count": 1},
    {"kind": "watch", "title": "Disk", "text": "C: is 92% full.", "tone": "warn"},
    {"kind": "weather", "title": "Weather", "text": "Sunny", "tone": "ok"},
]}


def test_needs_merges_the_three_sources():
    issues = [{"what": "Movies drive", "say": "The movies drive isn't connected.", "tone": "warn"}]
    events = [{"ts": NOW - 600, "kind": "print_finished", "detail": "Cube"}]
    n = needs.build(events, FEED, NOW, issues)
    by = {i["source"]: i for i in n["items"]}
    assert n["count"] == len(n["items"]) == 4
    local = [i for i in n["items"] if i["source"] == "Local AI"]
    assert {i["title"] for i in local} == {"Needs you", "Disk"}
    assert all(i["link"] == "https://assistant.home.arpa/" for i in local)
    assert by["Pi Hub"]["title"] == "Movies drive" and by["Pi Hub"]["link"] == "/pi"
    assert by["Printer"]["title"] == "Clear the plate" and by["Printer"]["link"] == "/workshop"
    assert n["unread"] == []


def test_needs_ignores_ok_cards_and_cleared_prints():
    feed = {"cards": [{"kind": "needs", "title": "All clear", "text": "Nothing needs you right now.", "tone": "ok", "count": 0}]}
    events = [{"ts": NOW - 60, "kind": "print_started", "detail": ""}, {"ts": NOW - 600, "kind": "print_finished", "detail": ""}]
    n = needs.build(events, feed, NOW)
    assert n == {"count": 0, "items": [], "unread": []}


def test_a_recent_failed_print_needs_you():
    events = [{"ts": NOW - 3600, "kind": "print_failed", "detail": "at 40%"}]
    n = needs.build(events, {"cards": []}, NOW)
    assert n["items"][0]["title"] == "The print failed" and n["items"][0]["tone"] == "bad"
    assert needs.build([{"ts": NOW - 25 * 3600, "kind": "print_failed", "detail": ""}], {"cards": []}, NOW)["count"] == 0


def test_items_come_worst_first():
    events = [{"ts": NOW - 3600, "kind": "print_failed", "detail": ""}]
    tones = [i["tone"] for i in needs.build(events, FEED, NOW)["items"]]
    assert tones == ["bad", "attention", "warn"]


def test_needs_lists_sources_it_could_not_read():
    issues = [{"what": "Pi is hot", "say": "", "tone": "warn"}]
    n = needs.build([], None, NOW, issues)
    assert n["unread"] == ["Local AI"] and n["count"] == 1


def test_api_needs_answers_when_local_ai_is_off(monkeypatch):
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    r = TestClient(hub_app.app).get("/api/needs")
    assert r.status_code == 200 and r.json()["unread"] == ["Local AI"]


def test_the_hubs_own_live_issues_need_you_too():
    issues = [{"what": "Plex", "say": "Plex has stopped.", "tone": "bad"}]
    n = needs.build([], {"cards": []}, NOW, issues)
    assert n["items"][0] == {"source": "Pi Hub", "tone": "bad", "title": "Plex", "detail": "Plex has stopped.", "link": "/pi"}


def test_the_alert_history_is_not_needs():
    # "Workshop display went offline" then "is back": history, not something to do. Live issues cover what's still wrong.
    import inspect
    assert "alerts" not in inspect.signature(needs.build).parameters


def test_a_finished_print_stops_asking_after_a_day():
    # Without a "plate cleared" signal (step 3 adds one), a day-old finish has almost certainly been cleared.
    old = [{"ts": NOW - 25 * 3600, "kind": "print_finished", "detail": ""}]
    assert needs.build(old, {"cards": []}, NOW)["count"] == 0
