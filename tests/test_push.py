import urllib.request

from hub import events


def _capture(monkeypatch, tmp_path, quiet=False):
    topic = tmp_path / "topic"
    topic.write_text("t0pic\n")
    monkeypatch.setattr(events, "TOPIC_FILE", str(topic))
    monkeypatch.setattr(events, "ntfy_servers", lambda: ["http://ntfy.test"])
    monkeypatch.setattr(events, "quiet_now", lambda now=None: quiet)
    sent = []

    class Resp:
        def close(self):
            pass

    def fake(req, timeout=None):
        sent.append(req)
        return Resp()

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return sent


def test_click_header_is_sent(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path)
    events.push("T", "b", click="http://hub.local/needs")
    assert sent[0].get_header("Click") == "http://hub.local/needs"


def test_no_click_header_without_click(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path)
    events.push("T", "b")
    assert sent[0].get_header("Click") is None
    assert sent[0].get_header("Priority") == "default"


def test_urgent_defaults_to_high_priority(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path)
    events.push("T", "b", urgent=True)
    assert sent[0].get_header("Priority") == "high"
    events.push("T", "b", priority="max", urgent=True)
    assert sent[1].get_header("Priority") == "max"


def test_quiet_hours_still_hold_non_urgent(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path, quiet=True)
    assert events.push("T", "b") == "Held back for quiet hours."
    assert sent == []
    assert events.push("T", "b", urgent=True) == "Sent."
    assert len(sent) == 1
