import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import events, outside  # noqa: E402


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append((a, k)) or "Sent.")
    events.ready()
    return sent


def test_icons_follow_the_weather_codes():
    assert outside._icon(0, True) == "clear-day" and outside._icon(0, False) == "clear-night"
    assert outside._icon(2, True) == "partly-day" and outside._icon(63) == "rain"
    assert outside._icon(75) == "snow" and outside._icon(95) == "storm" and outside._icon(45) == "fog"


def test_new_warnings_are_passed_on_urgently_once(fresh):
    w = events.Watcher()
    base = {"alerts": [], "soon": None, "freeze_tonight": False}
    w.check_weather(base)
    warn = dict(base, alerts=[{"id": "a1", "event": "Wind Advisory", "headline": "Wind Advisory until 6 PM"}])
    w.check_weather(warn)
    w.check_weather(warn)
    assert [e["kind"] for e in events.recent()] == ["weather_alert"]
    (title, body, tag), kw = fresh[0]
    assert title == "Weather warning" and body.startswith("Wind Advisory until 6 PM") and kw.get("urgent")


def test_rain_and_frost_fire_at_most_once_a_day():
    w = events.Watcher()
    afternoon = time.mktime((2026, 10, 20, 16, 0, 0, 0, 0, -1))
    wet = {"alerts": [], "soon": "Rain likely from around 6 PM (70%).", "freeze_tonight": True, "tonight_low": 30}
    w.check_weather(wet, now=afternoon)
    w.check_weather(wet, now=afternoon + 600)
    assert sorted(e["kind"] for e in events.recent()) == ["freeze_tonight", "rain_soon"]


def test_frost_waits_until_the_afternoon():
    w = events.Watcher()
    morning = time.mktime((2026, 10, 20, 9, 0, 0, 0, 0, -1))
    w.check_weather({"alerts": [], "soon": None, "freeze_tonight": True, "tonight_low": 31}, now=morning)
    assert events.recent() == []
