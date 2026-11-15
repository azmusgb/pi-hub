"""Why the workshop display drops out: Pi Hub's own check of it every minute, and a day of its heartbeats.

The check is GET /recovery/status, the display's public status page, straight from the Pi. Next to the PC's check
(Local AI's poll, which pi-status relays) it tells the two apart: if both lose the display, the display or its Wi-Fi
is at fault; if only the PC does, the PC's link is. Each change is one line in the journal ("display: ..."), and
GET /api/display/diagnostics shows the outages, the signal and the restarts. Kept two days."""
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

from . import db

URL = os.environ.get("HUB_DISPLAY_URL", "http://10.0.0.28")
TIMEOUT_S = 3
KEEP_S = 2 * 86400
# esp_reset_reason_t (ESP-IDF), the number the firmware sends as resetReason.
RESETS = {0: "unknown", 1: "power on", 2: "reset pin", 3: "software restart", 4: "crash", 5: "interrupt watchdog",
          6: "task watchdog", 7: "watchdog", 8: "deep sleep", 9: "brownout", 10: "SDIO", 11: "USB", 12: "JTAG",
          13: "eFuse", 14: "power glitch", 15: "CPU lockup"}


def _ready():
    db.conn().executescript(
        "CREATE TABLE IF NOT EXISTS display_probes (ts INTEGER PRIMARY KEY, ok INTEGER NOT NULL, ms INTEGER,"
        " reason TEXT NOT NULL DEFAULT '');"
        "CREATE TABLE IF NOT EXISTS display_beats (at INTEGER PRIMARY KEY, body TEXT NOT NULL);")


def _why(e):
    """A failed check in a few words: timeout, refused, unreachable, an HTTP status, or not a status page."""
    if isinstance(e, urllib.error.HTTPError):
        return f"http {e.code}"
    r = getattr(e, "reason", e)
    if isinstance(r, (socket.timeout, TimeoutError)):
        return "timeout"
    if isinstance(r, ConnectionRefusedError):
        return "refused"
    if isinstance(r, ConnectionResetError):
        return "reset"
    if isinstance(r, OSError):
        return "unreachable"
    return "bad answer"


def check(url=URL, timeout=TIMEOUT_S):
    """(ok, ms, reason): ms is how long the answer took, or None when there was none."""
    start = time.monotonic()
    try:
        with urllib.request.urlopen(f"{url}/recovery/status", timeout=timeout) as r:
            d = json.loads(r.read(8192))
        ms = round((time.monotonic() - start) * 1000)
        if not isinstance(d, dict):
            return False, ms, "bad answer"
        return True, ms, ""
    except ValueError:
        return False, round((time.monotonic() - start) * 1000), "bad answer"
    except Exception as e:  # noqa: BLE001 - every failure is a reason, never a crash in the minute loop
        return False, None, _why(e)


def _ago(seconds):
    m = max(0, round(seconds / 60))
    return f"{m} min" if m < 120 else f"{m / 60:.1f} h"


def probe(now=None, result=None):
    """Check once, keep the result, and log a line when the display stops or starts answering."""
    now = int(time.time() if now is None else now)
    ok, ms, reason = check() if result is None else result
    _ready()
    last = db.one("SELECT ts, ok FROM display_probes ORDER BY ts DESC LIMIT 1")
    if last is not None and bool(last["ok"]) != ok:
        if ok:
            down = db.one("SELECT MIN(ts) AS ts FROM display_probes WHERE ok = 0 AND ts > "
                          "COALESCE((SELECT MAX(ts) FROM display_probes WHERE ok = 1), 0)")
            gone = _ago(now - down["ts"]) if down and down["ts"] else "a while"
            print(f"display: answering Pi Hub again after {gone} ({ms} ms)", file=sys.stderr, flush=True)
        else:
            print(f"display: not answering Pi Hub ({reason})", file=sys.stderr, flush=True)
    db.run("INSERT OR REPLACE INTO display_probes (ts, ok, ms, reason) VALUES (?, ?, ?, ?)", now, int(ok), ms, reason)
    db.run("DELETE FROM display_probes WHERE ts < ?", now - KEEP_S)
    return ok, ms, reason


def record_beat(beat, now=None):
    """Keep one heartbeat (already cleaned by display_routes.clean_heartbeat); a restart is logged as it shows up."""
    now = int(time.time() if now is None else now)
    _ready()
    last = db.one("SELECT body FROM display_beats ORDER BY at DESC LIMIT 1")
    prev = json.loads(last["body"]).get("uptimeS") if last else None
    up = beat.get("uptimeS")
    if isinstance(prev, int) and isinstance(up, int) and up < prev:
        why = RESETS.get(beat.get("resetReason"), "reason not sent")
        print(f"display: restarted ({why}), up {_ago(up)}; signal {beat.get('rssi')} dBm", file=sys.stderr, flush=True)
    db.run("INSERT OR REPLACE INTO display_beats (at, body) VALUES (?, ?)", now, json.dumps(beat))
    db.run("DELETE FROM display_beats WHERE at < ?", now - KEEP_S)


def _outages(probes):
    """Runs of failed checks, newest first: {start, end (None while still out), checks, reason}."""
    out, cur = [], None
    for p in probes:
        if not p["ok"]:
            if cur is None:
                cur = {"start": p["ts"], "end": None, "checks": 0, "reason": p["reason"]}
                out.append(cur)
            cur["checks"] += 1
        elif cur is not None:
            cur["end"], cur = p["ts"], None
    return list(reversed(out))


def summary(hours=24, now=None):
    now = int(time.time() if now is None else now)
    since = now - max(1, min(int(hours), KEEP_S // 3600)) * 3600
    _ready()
    probes = db.rows("SELECT ts, ok, ms, reason FROM display_probes WHERE ts >= ? ORDER BY ts", since)
    times = sorted(p["ms"] for p in probes if p["ok"] and p["ms"] is not None)
    beats, restarts, prev = [], [], None
    for row in db.rows("SELECT at, body FROM display_beats WHERE at >= ? ORDER BY at", since):
        b = json.loads(row["body"])
        beats.append({"at": row["at"], **{k: b.get(k) for k in ("rssi", "uptimeS", "heapFree", "heapMin", "version")}})
        up = b.get("uptimeS")
        if isinstance(up, int):
            if isinstance(prev, int) and up < prev:  # uptime went back: it started again since the last beat
                restarts.append({"at": row["at"] - up, "reason": RESETS.get(b.get("resetReason"), "reason not sent")})
            prev = up
    rssi = [b["rssi"] for b in beats if isinstance(b["rssi"], int)]
    return {
        "url": URL,
        "hours": (now - since) // 3600,
        "checks": len(probes),
        "failed": sum(1 for p in probes if not p["ok"]),
        "answer_ms": {"median": times[len(times) // 2], "slowest": times[-1]} if times else None,
        "outages": _outages(probes)[:50],
        "signal": {"latest": rssi[-1], "weakest": min(rssi), "strongest": max(rssi)} if rssi else None,
        "restarts": list(reversed(restarts)),
        "beats": beats[-300:],
    }
