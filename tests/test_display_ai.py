import json
import time

import pytest

from hub import display_ai

GOOD = {"v": 2, "at": 1, "cards": [{"id": "a"}], "approvals": {"count": 2, "speech": "Two waiting."},
        "images": [{"title": "t", "imageUrl": "/x"}], "messages": [{"seq": 1, "at": 1, "title": "m"}]}


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
    assert r["images"] == GOOD["images"] and r["messages"] == GOOD["messages"]


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
    monkeypatch.setattr(display_ai, "_TEST_ALLOW_HTTP", True)
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
    assert calls[0][1] == "https://10.0.0.81/api/images/view?filename=a.png&type=output"
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


# ---- final review fixes ----

def test_malformed_messages_are_dropped_not_fatal():
    good = {"seq": 2, "at": 5, "title": "ok"}
    body = {**GOOD, "messages": ["oops", 7, None, {"seq": 1, "at": "2026-10-31T15:00:00Z"}, {"seq": True, "at": 1},
                                 {"seq": 1, "at": False}, {"at": 1}, {"seq": 1}, {"seq": 1, "at": float("nan")}, good]}
    r = display_ai.cards(100, fetch=ok(body))
    assert r["available"] is True and r["messages"] == [good]


def test_images_are_normalised_once():
    pics = [{"title": "no url"}, {"imageUrl": 5}, "x", {"imageUrl": ""}, {"title": "b", "imageUrl": "/api/images/view?f=b"}]
    r = display_ai.cards(100, fetch=ok({**GOOD, "images": pics}))
    assert r["images"] == [{"title": "b", "imageUrl": "/api/images/view?f=b"}]


def test_ai_cards_over_the_cap_are_unavailable():
    raw = json.dumps(GOOD).encode() + b" " * display_ai.ANSWER_MAX
    assert display_ai.cards(100, fetch=ok(raw))["available"] is False


class _Resp:
    def __init__(self, size, status=200):
        self.size, self.status, self.asked = size, status, []
        self.headers = {"Content-Type": "application/json"}

    def read(self, n=-1):
        self.asked.append(n)
        return b"x" * (self.size if n is None or n < 0 else min(n, self.size))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Tracked(__import__("io").BytesIO):
    def __init__(self, data):
        super().__init__(data)
        self.asked = []

    def read(self, n=-1):
        self.asked.append(n)
        return super().read(n)


class _Opener:
    def __init__(self, resp=None, error=None):
        self.resp, self.error = resp, error

    def open(self, req, timeout=None):
        if self.error:
            raise self.error
        return self.resp


def test_fetch_reads_at_most_the_cap_plus_one(monkeypatch):
    resp = _Resp(10 * display_ai.ANSWER_MAX)
    monkeypatch.setattr(display_ai, "_opener", lambda: _Opener(resp))
    status, _ = display_ai._fetch("https://10.0.0.81/api/display/ai-cards", "k")
    assert resp.asked == [display_ai.ANSWER_MAX + 1] and status == 502


def test_send_reads_at_most_the_cap_plus_one(monkeypatch):
    resp = _Resp(10 * display_ai.ANSWER_MAX)
    monkeypatch.setattr(display_ai, "_opener", lambda: _Opener(resp))
    status, _, _ = display_ai._send("GET", "https://10.0.0.81/api/display/ask", {}, None, 1)
    assert resp.asked == [display_ai.ANSWER_MAX + 1] and status == 502
    resp = _Resp(1000)
    monkeypatch.setattr(display_ai, "_opener", lambda: _Opener(resp))
    assert display_ai._send("GET", "https://10.0.0.81/api/images/view", {}, None, 1, cap=5000)[:2] == (200, b"x" * 1000)
    assert resp.asked == [5001]


def test_send_http_error_body_is_capped(monkeypatch):
    import io
    import urllib.error
    big = _Tracked(b"y" * (10 * display_ai.ANSWER_MAX))
    err = urllib.error.HTTPError("https://10.0.0.81/x", 409, "conflict", {"Content-Type": "application/json"}, big)
    monkeypatch.setattr(display_ai, "_opener", lambda: _Opener(error=err))
    status, _, _ = display_ai._send("GET", "https://10.0.0.81/api/display/ask", {}, None, 1)
    assert status == 502 and big.asked == [display_ai.ANSWER_MAX + 1]


def test_forward_over_the_cap_is_502_and_images_get_their_own_cap():
    big = b"x" * (display_ai.ANSWER_MAX + 1)
    assert display_ai.forward("GET", "/api/display/ask", fetch=lambda *a: (200, big, "application/json"))[0] == 502
    pic = b"p" * (display_ai.ANSWER_MAX * 2)
    assert display_ai.forward("GET", "/api/images/view", fetch=lambda *a: (200, pic, "image/png"),
                              cap=5 * 1024 * 1024)[:2] == (200, pic)


def test_forward_http_error_raised_by_fetch_is_capped():
    import io
    import urllib.error
    big = _Tracked(b"y" * (10 * display_ai.ANSWER_MAX))

    def fetch(*a):
        raise urllib.error.HTTPError("u", 409, "conflict", {}, big)
    assert display_ai.forward("GET", "/api/display/ask", fetch=fetch)[0] == 502
    assert big.asked == [display_ai.ANSWER_MAX + 1]


@pytest.mark.parametrize("url", ["http://10.0.0.81", "HTTP://10.0.0.81", "Http://pc.rahe-home.duckdns.org:8080"])
def test_plain_http_never_sends_the_key(monkeypatch, url):
    monkeypatch.setattr(display_ai, "URL", url)
    called = []
    assert display_ai.cards(100, fetch=lambda u, k: called.append(1))["available"] is False
    assert display_ai.forward("GET", "/api/display/approvals", fetch=lambda *a: called.append(a))[0] == 502
    assert not called


def test_uppercase_https_is_https(monkeypatch):
    monkeypatch.setattr(display_ai, "URL", "HTTPS://10.0.0.81")
    assert display_ai._tls_ok() is True


def test_redirects_are_never_followed(monkeypatch):
    import http.server
    import threading
    hits = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append((self.path, self.headers.get("X-LocalAI-Hub-Key")))
            if self.path.startswith("/api/display/ask"):
                self.send_response(302)
                self.send_header("Location", "/elsewhere")
                self.send_header("Content-Length", "0")
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

        def log_message(self, *a):
            pass
    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        monkeypatch.setattr(display_ai, "URL", f"http://127.0.0.1:{srv.server_address[1]}")
        monkeypatch.setattr(display_ai, "_TEST_ALLOW_HTTP", True)
        status = display_ai.forward("GET", "/api/display/ask", query="q=hi", timeout=2)[0]
    finally:
        srv.shutdown()
    assert status == 302 and [h[0] for h in hits] == ["/api/display/ask?q=hi"]


class _Capture(_Opener):
    def __init__(self, resp):
        super().__init__(resp)
        self.reqs = []

    def open(self, req, timeout=None):
        self.reqs.append(req)
        return self.resp


def test_call_sends_the_key_and_returns_json(monkeypatch):
    opener = _Capture(__import__("io").BytesIO(b'{"agents": []}'))
    monkeypatch.setattr(display_ai, "_opener", lambda: opener)
    assert display_ai.call("/api/world") == {"agents": []}
    req = opener.reqs[0]
    assert req.full_url == "https://10.0.0.81/api/world" and req.get_method() == "GET"
    assert req.get_header("X-localai-hub-key") == "secret"


def test_call_posts_json(monkeypatch):
    opener = _Capture(__import__("io").BytesIO(b'{"message": {}}'))
    monkeypatch.setattr(display_ai, "_opener", lambda: opener)
    display_ai.call("/api/chat", method="POST", body={"q": 1})
    req = opener.reqs[0]
    assert req.get_method() == "POST" and json.loads(req.data) == {"q": 1}
    assert req.get_header("Content-type") == "application/json"


@pytest.mark.parametrize("setup", ["no-key", "no-ca", "http"])
def test_call_never_sends_the_key_without_key_ca_and_https(monkeypatch, tmp_path, setup):
    if setup == "no-key":
        monkeypatch.setattr(display_ai, "KEY_FILE", str(tmp_path / "missing"))
    elif setup == "no-ca":
        monkeypatch.setattr(display_ai, "CA_FILE", str(tmp_path / "gone.crt"))
    else:
        monkeypatch.setattr(display_ai, "URL", "http://10.0.0.81")
    monkeypatch.setattr(display_ai, "_opener", lambda: pytest.fail("called Local AI"))
    with pytest.raises(RuntimeError):
        display_ai.call("/api/world")


def test_call_refuses_an_answer_past_the_cap(monkeypatch):
    monkeypatch.setattr(display_ai, "_opener", lambda: _Opener(__import__("io").BytesIO(b"x" * 100)))
    with pytest.raises(ValueError):
        display_ai.call("/api/world", cap=10)
