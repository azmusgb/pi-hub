"""Read-only preview of a branch's pages against the live hub (amendment A10, plan decision 9).

Serves hub/static from this checkout (or --static), the shell's index.html for page routes, and forwards GET /api/* to
the live hub (--upstream). Every other method is refused with 405 and never reaches the hub, so no button on a
previewed page can act on the house. --fixture DIR answers GET /api/<path> from DIR/<path>.json when that file
exists (the long-content and empty states). The record stream is answered 404: the shell falls back to polling.

Usage (from the Mac): python3 tests/browser/preview.py [--port 8799] [--upstream https://hub.rahe-home.duckdns.org]
Stdlib only; run with the repo's .venv or any Python 3.11+.
"""
from __future__ import annotations

import argparse
import http.server
import os
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
UPSTREAM = "https://hub.rahe-home.duckdns.org"
STREAMS = ("/api/records/stream", "/api/stream", "/events")


def handler(static: Path, upstream: str, fixture: Path | None, timeout: float = 8.0):
    static = static.resolve()

    class Preview(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(static), **k)

        def log_message(self, format, *args):  # noqa: A002 (the base class's name)
            pass

        def send(self, code: int, body: bytes, ctype: str = "application/json"):
            self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def refuse(self):
            self.send(405, b'{"detail":"the preview is read-only"}')

        do_POST = do_PUT = do_PATCH = do_DELETE = refuse

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path.startswith(STREAMS):
                return self.send(404, b'{"detail":"no stream in the preview"}')
            if path.startswith("/api/"):
                return self.api(path)
            if path.startswith("/static/"):
                self.path = self.path[len("/static"):]
                return super().do_GET()
            if path in ("/sw.js", "/manifest.webmanifest") and (static / path.lstrip("/")).is_file():
                return super().do_GET()
            # A page route: the shell draws it.
            self.path = "/index.html"
            return super().do_GET()

        def api(self, path: str):
            if fixture is not None:
                f = (fixture / (path[len("/api/"):] + ".json")).resolve()
                if f.is_relative_to(fixture.resolve()) and f.is_file():
                    return self.send(200, f.read_bytes())
            try:
                with urllib.request.urlopen(upstream + self.path, timeout=timeout) as r:
                    return self.send(r.status, r.read(), r.headers.get("content-type", "application/json"))
            except urllib.error.HTTPError as e:
                return self.send(e.code, e.read(), e.headers.get("content-type", "application/json"))
            except (OSError, ValueError):
                return self.send(502, b'{"detail":"the live hub did not answer"}')

    return Preview


def serve(port: int, static: Path, upstream: str, fixture: Path | None) -> http.server.ThreadingHTTPServer:
    return http.server.ThreadingHTTPServer(("127.0.0.1", port), handler(static, upstream.rstrip("/"), fixture))


def main() -> None:
    p = argparse.ArgumentParser(description="Read-only preview of a branch's pages against the live hub.")
    p.add_argument("--port", type=int, default=int(os.environ.get("PREVIEW_PORT", "8799")))
    p.add_argument("--static", type=Path, default=REPO / "hub" / "static")
    p.add_argument("--upstream", default=os.environ.get("PREVIEW_UPSTREAM", UPSTREAM))
    p.add_argument("--fixture", type=Path, default=None)
    a = p.parse_args()
    if not (a.static / "index.html").is_file():
        p.error(f"{a.static} has no index.html")
    if a.fixture is not None and not a.fixture.is_dir():
        p.error(f"{a.fixture} is not a directory")
    srv = serve(a.port, a.static, a.upstream, a.fixture)
    print(f"preview of {a.static} on http://127.0.0.1:{srv.server_address[1]} (GET /api from {a.upstream}; read-only)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
