import json
import time

import pytest

from hub import display_ai

GOOD = {"v": 2, "at": 1, "cards": [{"id": "a"}], "approvals": {"count": 2, "speech": "Two waiting."},
        "images": [{"title": "t", "imageUrl": "/x"}], "messages": ["m"]}


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    key = tmp_path / "key"
    key.write_text("secret\n")
    monkeypatch.setattr(display_ai, "KEY_FILE", str(key))
    ca = tmp_path / "ca.crt"
    ca.write_text("x")
    monkeypatch.setattr(display_ai, "CA_FILE", str(ca))
    monkeypatch.setattr(display_ai, "_cache", (0.0, None))


def ok(body=GOOD, status=200):
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    return lambda url, key: (status, raw)


def test_good_answer_is_available():
    r = display_ai.cards(100, fetch=ok())
    assert r["available"] is True and r["checkedAt"] == 100
    assert r["cards"] == GOOD["cards"] and r["approvals"] == {"count": 2, "speech": "Two waiting."}
    assert r["images"] == GOOD["images"] and r["messages"] == ["m"]


def test_answer_is_cached_for_15_seconds():
    calls = []

    def fetch(url, key):
        calls.append(key)
        return 200, json.dumps(GOOD).encode()
    display_ai.cards(100, fetch=fetch)
    display_ai.cards(110, fetch=fetch)
    assert len(calls) == 1 and calls[0] == "secret"
    display_ai.cards(116, fetch=fetch)
    assert len(calls) == 2


def test_slow_localai_never_delays_household():
    def slow(url, key):
        time.sleep(5)
        return 200, json.dumps(GOOD).encode()
    t = time.monotonic()
    r = display_ai.cards(100, fetch=slow)
    assert time.monotonic() - t < 3.5
    assert r["available"] is False and r["cards"] == [] and r["images"] == []


@pytest.mark.parametrize("body", [[], "<html>", {"cards": "x"}, 500])
def test_malformed_ai_cards_are_unavailable(body):
    if body == 500:
        fetch = ok({}, status=500)
    elif body == "<html>":
        fetch = ok(b"<html>")
    else:
        fetch = ok(body)
    r = display_ai.cards(100, fetch=fetch)
    assert r == {"available": False, "checkedAt": 100, "cards": [], "approvals": {"count": 0, "speech": ""},
                 "images": [], "messages": []}


def test_fetch_raising_is_unavailable():
    def boom(url, key):
        raise OSError("refused")
    assert display_ai.cards(100, fetch=boom)["available"] is False


def test_no_key_file_means_unavailable_without_calling(monkeypatch, tmp_path):
    monkeypatch.setattr(display_ai, "KEY_FILE", str(tmp_path / "missing"))
    called = []
    r = display_ai.cards(100, fetch=lambda u, k: called.append(1))
    assert r["available"] is False and not called


@pytest.mark.parametrize("path", ["/api/other", "/api/display/ai-cards", "/etc/passwd", "/api/display/approvalsx",
                                  "//evil/api/display/ask"])
def test_forward_refuses_other_paths(path):
    assert display_ai.forward("GET", path)[0] == 403


def test_forward_no_key_is_502(monkeypatch, tmp_path):
    monkeypatch.setattr(display_ai, "KEY_FILE", str(tmp_path / "missing"))
    assert display_ai.forward("GET", "/api/display/approvals")[0] == 502


def test_forward_unreachable_is_502(monkeypatch):
    monkeypatch.setattr(display_ai, "URL", "http://127.0.0.1:9")
    status, body, ctype = display_ai.forward("GET", "/api/display/ask", timeout=1)
    assert status == 502 and ctype == "application/json"


BAD = ["/api/images/viewer-x", "/api/images/view/../../api/changes", "/api/images/view%2F..", "/api/images/view/",
       "/api/display/ask?x=1", "/api/display/ask#f", "/api/display/ask\n", "/api/display/ ask",
       "/api/display//ask"]


@pytest.mark.parametrize("path", BAD)
def test_forward_refuses_tricky_paths_without_calling(path):
    called = []
    assert display_ai.forward("GET", path, fetch=lambda *a: called.append(a))[0] == 403
    assert not called


@pytest.mark.parametrize("query", ["a=1#frag", "a=1 b", "a=1\nb"])
def test_forward_refuses_bad_query_without_calling(query):
    called = []
    assert display_ai.forward("GET", "/api/images/view", query=query, fetch=lambda *a: called.append(a))[0] == 403
    assert not called


def test_forward_sends_key_and_never_caches():
    calls = []

    def fetch(method, url, headers, body, timeout):
        calls.append((method, url, headers))
        return 200, b"png", "image/png"
    for _ in range(2):
        r = display_ai.forward("GET", "/api/images/view", query="filename=a.png&type=output", fetch=fetch)
        assert r == (200, b"png", "image/png")
    assert len(calls) == 2
    assert calls[0][1] == "https://10.0.0.21/api/images/view?filename=a.png&type=output"
    assert calls[0][2]["X-LocalAI-Hub-Key"] == "secret"


@pytest.mark.parametrize("method,path", [("POST", "/api/display/approvals"), ("GET", "/api/display/approvals/decide"),
                                         ("POST", "/api/display/ask"), ("POST", "/api/images/view"),
                                         ("DELETE", "/api/display/approvals"), ("PUT", "/api/display/approvals/decide")])
def test_forward_wrong_method_is_405_without_calling(method, path):
    called = []
    assert display_ai.forward(method, path, fetch=lambda *a: called.append(a))[0] == 405
    assert not called


@pytest.mark.parametrize("method,path", [("GET", "/api/display/approvals"), ("GET", "/api/display/ask"),
                                         ("GET", "/api/images/view"), ("POST", "/api/display/approvals/decide")])
def test_forward_right_method_is_sent(method, path):
    assert display_ai.forward(method, path, fetch=lambda *a: (200, b"{}", "application/json"))[0] == 200


def test_missing_ca_never_sends_key_for_cards(monkeypatch, tmp_path):
    monkeypatch.setattr(display_ai, "CA_FILE", str(tmp_path / "gone.crt"))
    called = []
    assert display_ai.cards(100, fetch=lambda u, k: called.append(1))["available"] is False
    assert not called


def test_missing_ca_never_sends_key_for_forward(monkeypatch, tmp_path):
    monkeypatch.setattr(display_ai, "CA_FILE", str(tmp_path / "gone.crt"))
    called = []
    assert display_ai.forward("GET", "/api/display/approvals", fetch=lambda *a: called.append(a))[0] == 502
    assert not called
