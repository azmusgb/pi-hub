import json
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

from hub import ask  # noqa: E402


def test_ask_labels_its_chat(monkeypatch):
    seen = {}

    class Reply:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, *a): return json.dumps({"message": {"content": "The printer is idle."}, "model": "m"}).encode()

    def fake(req, timeout, context):
        seen["body"] = json.loads(req.data)
        return Reply()
    monkeypatch.setattr(ask, "context", lambda: "Printer: idle.")
    monkeypatch.setattr(ask.urllib.request, "urlopen", fake)
    assert ask.ask("Is the printer busy?")["answer"] == "The printer is idle."
    assert seen["body"]["title"] == "House question"


import pytest
from hub import records


@pytest.fixture
def facts(monkeypatch):
    monkeypatch.setattr(ask.sources, "pi_status", lambda: pytest.fail("Assistant read legacy status"))
    monkeypatch.setattr(ask.sources, "plex_sessions", lambda: None)
    monkeypatch.setattr(ask.bambuddy, "prints", lambda n: None)
    monkeypatch.setattr(ask.events, "recent", lambda n: [])
    monkeypatch.setattr(ask.time, "time", lambda: 1000)
    monkeypatch.setattr(records, "all", lambda: {})


def record(id, state, headline, **kwargs):
    return {"id": id, "state": state, "headline": headline, "source": records.SOURCE[id],
            "as_of": 990, "since": 900, "stale": False, "severity": "ok", "detail": {}, "cause": "", **kwargs}


def test_missing_sources_never_become_invented_household_facts(facts):
    text = ask.context()
    for made_up in ("148", "235 GB", "1.0 TB", "Connected", "Everything's running", "stopped", "synchronized"):
        assert made_up not in text
    assert "Bambu X2D: Unknown (no reading yet)" in text
    assert "Plex playback: Unknown (no response)" in text
    assert "Recent 3D print history: Unknown" in text


def test_assistant_uses_the_same_printer_record_as_home_with_provenance(facts, monkeypatch):
    rec = record("printer", "printing", "Printing test panel, 42%", detail={"progress": 42, "minutes_left": 12, "token": "never-send-this"})
    monkeypatch.setattr(records, "all", lambda: {"printer": rec})
    text = ask.context()
    assert "Printing test panel, 42% (source: Bambuddy; confirmed 10 seconds ago)" in text
    assert "progress=42, minutes_left=12" in text
    assert "never-send-this" not in text


@pytest.mark.parametrize("stale,as_of", [(True, 990), (False, 800)])
def test_stale_readings_are_historical_and_do_not_supply_live_telemetry(facts, monkeypatch, stale, as_of):
    rec = record("printer", "printing", "Printing, 42%", stale=stale, as_of=as_of,
                 severity="attention", detail={"progress": 42, "minutes_left": 12})
    monkeypatch.setattr(records, "all", lambda: {"printer": rec})
    text = ask.context()
    assert "Bambu X2D: Current state unknown. Last reading" in text
    assert "(STALE)" in text
    assert "progress=42" not in text and "minutes_left=12" not in text


def test_confirmed_zero_is_preserved_and_empty_playback_is_distinct_from_failure(facts, monkeypatch):
    rec = record("movies_drive", "connected", "The movies drive is connected", detail={"movies": 0, "free": "0 GB"})
    monkeypatch.setattr(records, "all", lambda: {"movies_drive": rec})
    monkeypatch.setattr(ask.sources, "plex_sessions", lambda: [])
    text = ask.context()
    assert "movies=0, free=0 GB" in text
    assert "Plex playback: Nothing playing right now" in text


def test_attention_reader_uses_the_own_attention_endpoint(monkeypatch):
    seen = []
    class Reply:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, *a): return b'{"source":"localai","cards":[]}'
    def fetch(req, **kwargs):
        seen.append(req.full_url)
        return Reply()
    monkeypatch.setattr(ask.sources.urllib.request, "urlopen", fetch)
    assert ask.sources._localai_feed() == {"source": "localai", "cards": []}
    assert seen == ["https://10.0.0.21/api/attention"]
