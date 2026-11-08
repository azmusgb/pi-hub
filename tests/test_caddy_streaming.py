"""The Room view's live stream (A17 plan, decision 5) passes through the hub's real Caddy block frame by frame. A
multipart/x-mixed-replace response never ends; if Caddy buffered it, the first frame would never reach the page.
This runs the Caddyfile's own (site_hub) block in a local Caddy, in front of a stub that sends one part every 0.2 s."""
import http.client
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CADDYFILE = open(os.path.join(ROOT, "deploy", "caddy", "Caddyfile")).read()

pytestmark = pytest.mark.skipif(shutil.which("caddy") is None, reason="caddy isn't installed here")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _snippet(name):
    """The text of a top-level `(name) { … }` block, by brace depth."""
    start = CADDYFILE.index(f"({name}) {{")
    depth = 0
    for i in range(start, len(CADDYFILE)):
        depth += {"{": 1, "}": -1}.get(CADDYFILE[i], 0)
        if depth == 0 and CADDYFILE[i] == "}":
            return CADDYFILE[start:i + 1]
    raise AssertionError(f"({name}) isn't closed")


class _Stub(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            for n in range(50):
                body = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n\xff\xd8frame-%d\xff\xd9\r\n" % n
                self.wfile.write(b"%x\r\n%s\r\n" % (len(body), body))
                self.wfile.flush()
                time.sleep(0.2)
        except (BrokenPipeError, ConnectionResetError):
            pass


@pytest.fixture
def caddy():
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    port = _free_port()
    site = _snippet("site_hub").replace("127.0.0.1:8100", f"127.0.0.1:{upstream.server_port}")
    conf = "{\n\tadmin off\n\tauto_https off\n}\n(hub_peer) {\n\theader_up X-Hub-Peer {remote_host}\n}\n" \
           f"{site}\nhttp://127.0.0.1:{port} {{\n\timport site_hub\n}}\n"
    d = tempfile.mkdtemp()
    path = os.path.join(d, "Caddyfile")
    with open(path, "w") as f:
        f.write(conf)
    p = subprocess.Popen(["caddy", "run", "--config", path, "--adapter", "caddyfile"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={**os.environ, "HOME": d})
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.1).close()
            break
        except OSError:
            time.sleep(0.05)
    yield port
    p.terminate()
    p.wait(5)
    upstream.shutdown()


def test_live_frames_arrive_through_caddy_as_they_are_sent(caddy):
    c = http.client.HTTPConnection("127.0.0.1", caddy, timeout=5)
    t0 = time.monotonic()
    c.request("GET", "/api/camera/room/live")
    r = c.getresponse()
    assert r.status == 200
    assert r.getheader("Content-Type") == "multipart/x-mixed-replace; boundary=frame"
    got, first_at = b"", None
    while got.count(b"\xff\xd9") < 3:
        got += r.read1(4096)
        if first_at is None and b"\xff\xd9" in got:
            first_at = time.monotonic() - t0
    # The first frame within 2 s (plan decision 5), and three in about 0.6 s of sending: not held until the end.
    assert first_at is not None and first_at < 2
    assert time.monotonic() - t0 < 3
    assert re.search(rb"frame-0.*frame-1.*frame-2", got, re.S)
    c.close()
