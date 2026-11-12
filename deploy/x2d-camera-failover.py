#!/usr/bin/env python3
"""One camera address for the workshop display, with two sources behind it.

Serves /x2d/frame.jpg and /x2d/health.json on port 8091, the same paths as the X2D
camera bridge. Frames come from the Pi's own bridge (the printer's LAN stream) when it
has a fresh frame, and from the MacBook's bridge (Bambu Studio) when it doesn't.
Nothing secret passes through: only JPEG frames and the bridges' health numbers.
"""
import json
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOURCES = [("Pi", "http://127.0.0.1:8092"), ("MacBook", "http://10.0.0.82:8091")]
FRESH_MS = 5000
_state = {"source": None, "since": None, "checked": None, "sources": {}}
_lock = threading.Lock()


def _health(base):
    try:
        with urllib.request.urlopen(f"{base}/x2d/health.json", timeout=1.5) as r:
            h = json.load(r)
        ok = bool(h.get("ok")) and h.get("frameAgeMs") is not None and h["frameAgeMs"] < FRESH_MS
        return {"up": True, "fresh": ok, "frameAgeMs": h.get("frameAgeMs")}
    except Exception:  # noqa: BLE001
        return {"up": False, "fresh": False, "frameAgeMs": None}


def watch():
    while True:
        found = {name: _health(base) for name, base in SOURCES}
        pick = next((name for name, _ in SOURCES if found[name]["fresh"]), None)
        with _lock:
            if pick != _state["source"]:
                _state["since"] = int(time.time())
            _state.update(source=pick, checked=int(time.time()), sources=found)
        time.sleep(2)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, kind):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        with _lock:
            state = json.loads(json.dumps(_state))
        if path == "/x2d/health.json":
            self._send(200, json.dumps({"ok": state["source"] is not None, **state}).encode(), "application/json")
            return
        if path not in ("/x2d/frame.jpg", "/x2d/detect.jpg"):
            self._send(404, b"not found", "text/plain")
            return
        order = [state["source"]] + [n for n, _ in SOURCES if n != state["source"]] if state["source"] else [n for n, _ in SOURCES]
        for name in order:
            base = dict(SOURCES)[name]
            try:
                with urllib.request.urlopen(f"{base}{path}", timeout=2) as r:
                    if r.status == 200:
                        self._send(200, r.read(384 * 1024), "image/jpeg")
                        return
            except Exception:  # noqa: BLE001
                continue
        self._send(503, b"no camera source has a frame", "text/plain")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    threading.Thread(target=watch, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8091), Handler).serve_forever()
