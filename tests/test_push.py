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


def test_urgent_keeps_default_priority(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path)
    events.push("T", "b", urgent=True)
    assert sent[0].get_header("Priority") == "default"


def test_explicit_high_priority(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path)
    events.push("T", "b", priority="high")
    assert sent[0].get_header("Priority") == "high"


def test_newline_title_and_click_are_cleaned(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path)
    assert events.push("a\r\nb", "x", click="http://h/\nneeds") == "Sent."
    assert sent[0].get_header("Title") == "a b"
    assert sent[0].get_header("Click") == "http://h/needs"


def test_emoji_title_is_rfc2047(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path)
    assert events.push("Done \U0001f680", "x") == "Sent."
    assert sent[0].get_header("Title").startswith("=?UTF-8?B?")


def test_bad_header_does_not_raise(monkeypatch, tmp_path):
    _capture(monkeypatch, tmp_path)

    def boom(req, timeout=None):
        raise ValueError("bad header")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    assert events.push("T", "b") == "The phone message didn't go out."


def test_quiet_hours_still_hold_non_urgent(monkeypatch, tmp_path):
    sent = _capture(monkeypatch, tmp_path, quiet=True)
    assert events.push("T", "b") == "Held back for quiet hours."
    assert sent == []
    assert events.push("T", "b", urgent=True) == "Sent."
    assert len(sent) == 1
