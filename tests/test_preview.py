"""tests/browser/preview.py (amendment A10, plan decision 9): the sweep's preview never writes to the live hub."""
import http.server
import importlib.util
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location("preview", Path(__file__).parent / "browser" / "preview.py")
assert _spec and _spec.loader
preview = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(preview)


class _Upstream(http.server.BaseHTTPRequestHandler):
    seen: list = []

    def log_message(self, format, *args):  # noqa: A002
        pass

    def _answer(self):
        _Upstream.seen.append((self.command, self.path))
        if self.path.startswith("/api/missing"):
            body, code = b'{"detail":"no"}', 404
        else:
            body, code = json.dumps({"path": self.path}).encode(), 200
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _answer


def _start(server):
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return f"http://127.0.0.1:{server.server_address[1]}"


@pytest.fixture()
def hub(tmp_path):
    static = tmp_path / "static"
    (static / "js").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>shell</title>")
    (static / "js" / "app.js").write_text("export {};")
    fixture = tmp_path / "fixture"
    fixture.mkdir()
    (fixture / "today.json").write_text('{"fixture": true}')
    _Upstream.seen = []
    up = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Upstream)
    upstream = _start(up)
    srv = preview.serve(0, static, upstream, fixture)
    base = _start(srv)
    yield base
    srv.shutdown()
    up.shutdown()


def _call(url, method="GET", data=None):
    req = urllib.request.Request(url, method=method, data=data)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_writes_are_refused_and_never_reach_the_hub(hub, method):
    code, body = _call(hub + "/api/printer/pause", method, data=b"{}")
    assert code == 405
    assert b"read-only" in body
    assert _Upstream.seen == []


def test_get_api_is_forwarded_with_its_query(hub):
    code, body = _call(hub + "/api/now?x=1")
    assert code == 200
    assert json.loads(body) == {"path": "/api/now?x=1"}
    assert _Upstream.seen == [("GET", "/api/now?x=1")]


def test_an_upstream_error_keeps_its_status(hub):
    code, _ = _call(hub + "/api/missing")
    assert code == 404


def test_a_fixture_answers_before_the_hub_and_cannot_escape_its_folder(hub):
    code, body = _call(hub + "/api/today")
    assert (code, json.loads(body)) == (200, {"fixture": True})
    assert _Upstream.seen == []
    code, _ = _call(hub + "/api/..%2F..%2Fstatic%2Findex")
    assert _Upstream.seen and code in (200, 404)  # forwarded, not read from outside the fixture


def test_static_files_page_routes_and_the_stream(hub):
    assert _call(hub + "/static/js/app.js") == (200, b"export {};")
    assert _call(hub + "/workshop")[1].startswith(b"<!doctype html><title>shell")
    assert _call(hub + "/api/records/stream")[0] == 404
    assert _Upstream.seen == []


def test_an_unreachable_hub_is_a_502_not_a_crash(tmp_path):
    static = tmp_path / "s"
    static.mkdir()
    (static / "index.html").write_text("x")
    srv = preview.serve(0, static, "http://127.0.0.1:9", None)
    base = _start(srv)
    try:
        assert _call(base + "/api/now")[0] == 502
    finally:
        srv.shutdown()


def _with_host(url, host, method="GET"):
    req = urllib.request.Request(url, method=method, headers={"Host": host})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def test_another_host_name_is_refused_before_anything_is_read(hub):
    # DNS rebinding: a page on evil.example resolved to 127.0.0.1 must not read the hub's answers through the preview.
    port = hub.rsplit(":", 1)[1]
    for host in ("evil.example", f"evil.example:{port}", "10.0.0.80", f"127.0.0.1:{int(port) + 1}"):
        assert _with_host(hub + "/api/now", host) == 421, host
        assert _with_host(hub + "/workshop", host) == 421, host
    assert _Upstream.seen == []
    for host in (f"127.0.0.1:{port}", f"localhost:{port}"):
        assert _with_host(hub + "/api/now", host) == 200, host


def test_a_burst_of_module_requests_is_served_not_reset(hub):
    # A page asks for its 40-odd modules at once. With the socket's default backlog of 5, some connections were reset
    # (ERR_CONNECTION_RESET in Chromium), the page drew half of itself, and the width sweep called it clean.
    from concurrent.futures import ThreadPoolExecutor

    def get(_):
        try:
            return _call(f"{hub}/static/js/app.js")[0]
        except OSError as e:
            return repr(e)

    with ThreadPoolExecutor(max_workers=120) as pool:
        codes = list(pool.map(get, range(240)))
    assert [c for c in codes if c != 200] == []
