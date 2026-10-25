import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, needs, sources, system  # noqa: E402

NOW = 1_800_000_000
FEED = {"cards": [
    {"kind": "needs", "title": "Needs you", "text": "Approve the E-009 print.", "tone": "attention", "count": 1},
    {"kind": "watch", "title": "Disk", "text": "C: is 92% full.", "tone": "warn"},
    {"kind": "weather", "title": "Weather", "text": "Sunny", "tone": "ok"},
]}


def test_needs_merges_the_three_sources():
    alerts = [{"ts": NOW - 2 * 3600, "title": "Movies drive dropped", "body": "Reconnected after 1 min", "tag": "warning"}]
    events = [{"ts": NOW - 600, "kind": "print_finished", "detail": "Cube"}]
    n = needs.build(alerts, events, FEED, NOW)
    by = {i["source"]: i for i in n["items"]}
    assert n["count"] == len(n["items"]) == 4
    local = [i for i in n["items"] if i["source"] == "Local AI"]
    assert {i["title"] for i in local} == {"Needs you", "Disk"}
    assert all(i["link"] == "https://assistant.home.arpa/" for i in local)
    assert by["Pi"]["title"] == "Movies drive dropped"
    assert by["Printer"]["title"] == "Clear the plate" and by["Printer"]["link"] == "/workshop"
    assert n["unread"] == []


def test_needs_ignores_ok_cards_old_alerts_and_cleared_prints():
    feed = {"cards": [{"kind": "needs", "title": "All clear", "text": "Nothing needs you right now.", "tone": "ok", "count": 0}]}
    alerts = [{"ts": NOW - 13 * 3600, "title": "Old", "body": "", "tag": ""}]
    events = [{"ts": NOW - 60, "kind": "print_started", "detail": ""}, {"ts": NOW - 600, "kind": "print_finished", "detail": ""}]
    n = needs.build(alerts, events, feed, NOW)
    assert n == {"count": 0, "items": [], "unread": []}


def test_a_recent_failed_print_needs_you():
    events = [{"ts": NOW - 3600, "kind": "print_failed", "detail": "at 40%"}]
    n = needs.build([], events, {"cards": []}, NOW)
    assert n["items"][0]["title"] == "The print failed" and n["items"][0]["tone"] == "bad"
    assert needs.build([], [{"ts": NOW - 25 * 3600, "kind": "print_failed", "detail": ""}], {"cards": []}, NOW)["count"] == 0


def test_items_come_worst_first():
    events = [{"ts": NOW - 3600, "kind": "print_failed", "detail": ""}]
    tones = [i["tone"] for i in needs.build([], events, FEED, NOW)["items"]]
    assert tones == ["bad", "attention", "warn"]


def test_needs_lists_sources_it_could_not_read():
    alerts = [{"ts": NOW - 60, "title": "Pi is hot", "body": "", "tag": ""}]
    n = needs.build(alerts, [], None, NOW)
    assert n["unread"] == ["Local AI"] and n["count"] == 1


def test_api_needs_answers_when_local_ai_is_off(monkeypatch):
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    monkeypatch.setattr(system, "alerts", lambda limit=200: [])
    r = TestClient(hub_app.app).get("/api/needs")
    assert r.status_code == 200 and r.json()["unread"] == ["Local AI"]


def test_the_hubs_own_live_issues_need_you_too():
    issues = [{"what": "Plex", "say": "Plex has stopped.", "tone": "bad"}]
    n = needs.build([], [], {"cards": []}, NOW, issues)
    assert n["items"][0] == {"source": "Pi Hub", "tone": "bad", "title": "Plex", "detail": "Plex has stopped.", "link": "/pi"}
