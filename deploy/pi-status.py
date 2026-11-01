#!/usr/bin/env python3
"""Small read-only status API for the home dashboard.

Serves GET /status on port 8099: Pi health, the movie drive, service states,
and the X2D / workshop display / Local AI state relayed from Local AI's
/api/world, read with Pi Hub's key over verified HTTPS. No secrets out.
"""
import json
import os
import ssl
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8099
# One home, step 6: pi-lock.py sets 127.0.0.1 (a systemd drop-in); only the hub reads this.
BIND = os.environ.get("PI_STATUS_BIND", "0.0.0.0")
WORLD_URL = "https://10.0.0.21/api/world"
# Local AI requires sign-in: send Pi Hub's key, and only to Local AI verified by its CA (as hub/display_ai.py does).
LOCALAI_KEY_FILE = os.environ.get("HUB_LOCALAI_KEY_FILE", "/etc/pi-hub/secrets/localai_hub_key")
LOCALAI_CA_FILE = os.environ.get("HUB_LOCALAI_CA_FILE", "/etc/pi-hub/secrets/localai-ca.crt")
MOVIES = "/mnt/usb1"
WINDOWS_MOVIES = "/mnt/windows-movies"
SERVICES = {"plex": "plexmediaserver", "homebridge": "homebridge",
            "docker": "docker", "cockpit": "cockpit.socket"}

_cache = {}
_lock = threading.Lock()
_last_printer = None


def cached(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    try:
        value = fn()
    except Exception:
        value = None
    with _lock:
        _cache[key] = (now, value)
    return value


def run(*cmd, timeout=10):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout


def human_bytes(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1000 or unit == "TB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB", "MB") else f"{n:.1f} {unit}"
        n /= 1000


def human_minutes(m):
    if m is None:
        return ""
    m = int(m)
    if m < 60:
        return f"{m} min"
    return f"{m // 60} h {m % 60:02d} min"


def pi_health():
    with open("/sys/class/thermal/thermal_zone0/temp") as f:
        temp = int(f.read()) / 1000
    raw = run("vcgencmd", "get_throttled").strip().split("=")[-1] or "0x0"
    flags = int(raw, 16)
    if flags & 0x1:
        power = "Low voltage now"
    elif flags & 0x4:
        power = "Slowed by heat"
    elif flags & 0x50000:
        power = "Low voltage earlier"
    else:
        power = "Good"
    with open("/proc/uptime") as f:
        up = float(f.read().split()[0])
    return {"temp": round(temp, 1), "power": power, "uptime_h": round(up / 3600, 1)}


def real_mount():
    # /mnt/usb1 is an automount point, so ismount() is always true; look for the ext4 mount itself.
    with open("/proc/mounts") as f:
        return any(line.split()[1] == MOVIES and line.split()[2] == "ext4" for line in f)


def movies_uuid():
    try:
        for line in open("/etc/fstab"):
            parts = line.split()
            if len(parts) > 1 and parts[1] == MOVIES and parts[0].startswith("UUID="):
                return parts[0][5:]
    except OSError:
        pass
    return None


def drive():
    # Plex plays from the Pi's own drive; pi-hub-movies-mirror copies the films there from the Windows PC.
    uuid = movies_uuid()
    present = bool(uuid) and os.path.exists(f"/dev/disk/by-uuid/{uuid}")
    if present and not real_mount():
        try:
            os.listdir(MOVIES)  # touching it asks systemd to mount it again
        except OSError:
            pass
    mounted = real_mount()
    log = run("dmesg")
    out = {
        "source": "Pi drive (/mnt/usb1)",
        "present": present,
        "mounted": mounted,
        "resets": log.count("reset SuperSpeed"),
        "io_errors": log.count("I/O error, dev sd"),
        "fs_errors": log.count("EXT4-fs error (device sd"),
        "free": "",
        "movies": None,
    }
    if mounted:
        st = os.statvfs(MOVIES)
        out["free"] = human_bytes(st.f_bavail * st.f_frsize)
        out["used"] = human_bytes((st.f_blocks - st.f_bfree) * st.f_frsize)
        out["total"] = human_bytes(st.f_blocks * st.f_frsize)
        try:
            out["movies"] = len([f for f in os.listdir(os.path.join(MOVIES, "Movies")) if not f.startswith(".")])
        except OSError:
            pass
        out["state"] = "Connected"
    elif present:
        out["state"] = "Not mounted"
    else:
        out["state"] = "Missing"
    return out


MIRROR_STATE = "/var/lib/pi-hub-mirror/state.json"


def mirror():
    try:
        with open(MIRROR_STATE) as f:
            m = json.load(f)
    except (OSError, ValueError):
        m = {}
    return {"state": m.get("status", "never"), "message": m.get("message", "The movies haven't been copied from the PC yet."),
            "last_ok": m.get("last_ok"), "finished": m.get("finished"), "source_count": m.get("source_count"),
            "count": m.get("mirror_count"), "share": os.path.ismount(WINDOWS_MOVIES)}


PAPERLESS_STATE = "/var/lib/pi-paperless-backup/state.json"


def paperless_backup():
    try:
        with open(PAPERLESS_STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def updates():
    listing = run("apt", "list", "--upgradable", timeout=60)
    return sum(1 for line in listing.splitlines() if "/" in line)


def services():
    return {k: run("systemctl", "is-active", unit).strip() == "active" for k, unit in SERVICES.items()}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A 3xx comes back as an error: following it would send the key wherever it points."""

    def redirect_request(self, *args, **kwargs):
        return None


def world():
    """Local AI's /api/world, or an exception (no key, no CA, refused, down): the caller caches None."""
    with open(LOCALAI_KEY_FILE) as f:
        key = f.read().strip()
    if not key or not os.path.exists(LOCALAI_CA_FILE):
        raise RuntimeError("Local AI hub key or CA isn't set up")
    opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=LOCALAI_CA_FILE)))
    req = urllib.request.Request(WORLD_URL, headers={"X-LocalAI-Hub-Key": key, "Accept": "application/json"})
    with opener.open(req, timeout=1.5) as r:
        return json.loads(r.read(512 * 1024))


def status():
    w = cached("world", 15, world)
    p = (w or {}).get("printer") or {}
    # Local AI briefly reports the printer as unknown between its polls; hold the
    # last real reading for up to two minutes so the page doesn't flicker.
    global _last_printer
    if p.get("state"):
        _last_printer = (time.time(), p)
    elif _last_printer and time.time() - _last_printer[0] < 120:
        p = _last_printer[1]
    k = (w or {}).get("kiosk") or {}
    m = (w or {}).get("models") or {}
    d = cached("drive", 10, drive) or {}
    h = cached("pi", 10, pi_health) or {}
    s = cached("services", 15, services) or {}

    # Local AI's states: printing | paused | error | cancelled | ended | idle; null when unknown.
    if w is None:
        x2d_state = "No status"
    elif not p.get("setUp"):
        x2d_state = "Not set up"
    else:
        raw_state = p.get("state")
        error_code = p.get("errorCode") or ""
        if raw_state == "error" and not error_code:
            x2d_state = "Stopped"
        else:
            x2d_state = {"printing": "Printing", "paused": "Paused", "idle": "Idle",
                         "error": "Error", "cancelled": "Stopped", "ended": "Stopped"}.get(raw_state, "No status")

    queue = m.get("queue") or {}
    loaded = m.get("loaded") or []
    if w is None:
        ai_state = "Down"
    elif queue.get("active") or queue.get("waiting"):
        ai_state = "Busy"
    else:
        ai_state = "Ready"

    return {
        "updated": int(time.time()),
        "x2d_state": x2d_state,
        "x2d_progress": p.get("progress") if p.get("progress") is not None else 0,
        "x2d_left": human_minutes(p.get("minutesLeft")),
        "x2d_minutes_left": p.get("minutesLeft"),
        "x2d_error": p.get("errorCode") or "",
        "display_state": "Unknown" if w is None else ("Online" if k.get("online") else "Offline"),
        "display_firmware": k.get("firmware") or "",
        "ai_state": ai_state,
        "ai_models": len(loaded),
        "ai_waiting": queue.get("waiting", 0),
        "drive_source": d.get("source", "Pi drive (/mnt/usb1)"),
        "drive_state": d.get("state", "Unknown"),
        "drive_free": d.get("free", ""),
        "drive_used": d.get("used", ""),
        "drive_total": d.get("total", ""),
        "drive_resets": d.get("resets", 0),
        "drive_errors": d.get("io_errors", 0) + d.get("fs_errors", 0),
        "movies": d.get("movies"),
        "mirror": cached("mirror", 30, mirror),
        "paperless_backup": cached("paperless_backup", 60, paperless_backup),
        "pi_temp": h.get("temp"),
        "pi_power": h.get("power", "Unknown"),
        "pi_uptime_h": h.get("uptime_h"),
        "updates": cached("updates", 1800, updates),
        "services": s,
    }


TOPIC_FILE = "/etc/pi-status/ntfy_topic"
SERVERS_FILE = "/etc/pi-status/ntfy_servers"  # one per line; default ntfy.sh (the Pi's own is http://127.0.0.1:8093)


ALERTS_LOG = "/var/lib/pi-status/alerts.jsonl"


def notify(title, message, tags="", priority="default"):
    # Keep a history for the hub's Alerts page, even if the phone push fails.
    try:
        os.makedirs(os.path.dirname(ALERTS_LOG), exist_ok=True)
        with open(ALERTS_LOG, "a") as f:
            f.write(json.dumps({"ts": int(time.time()), "title": title, "body": message, "tag": tags}) + "\n")
    except OSError:
        pass
    try:
        with open(TOPIC_FILE) as f:
            topic = f.read().strip()
    except OSError:
        return
    try:
        with open(SERVERS_FILE) as f:
            servers = [line.strip().rstrip("/") for line in f if line.strip() and not line.startswith("#")]
    except OSError:
        servers = []
    for server in servers or ["https://ntfy.sh"]:
        req = urllib.request.Request(
            f"{server}/{topic}", data=message.encode(), method="POST",
            headers={"Title": title, "Tags": tags, "Priority": priority})
        try:
            urllib.request.urlopen(req, timeout=10).close()
        except Exception:
            pass


def watch():
    """Push a phone alert when something changes and stays changed for two checks."""
    seen, pending = {}, {}
    last_print, last_progress = None, 0
    while True:
        time.sleep(30)
        try:
            s = status()
        except Exception:
            continue
        svc = s.get("services") or {}
        now = {
            "drive": s["drive_state"] == "Connected",
            "plex": bool(svc.get("plex")),
            "homebridge": bool(svc.get("homebridge")),
            "pc": s["ai_state"] != "Down",
            "display": s["display_state"] != "Offline",
            "hot": (s.get("pi_temp") or 0) >= 80,
        }
        messages = {
            "drive": (("Movies drive is back", "Plex can play movies again.", "white_check_mark"),
                      ("Movies drive dropped out", "Unplug it, wait 10 seconds and plug it back in.", "warning")),
            "plex": (("Plex is running again", "", "white_check_mark"),
                     ("Plex stopped", "Restart it in Cockpit on the Pi.", "warning")),
            "homebridge": (("Homebridge is running again", "", "white_check_mark"),
                           ("Homebridge stopped", "Restart it in Cockpit on the Pi.", "warning")),
            "pc": (("Windows PC is back", "Local AI answers again.", "white_check_mark"),
                   ("Windows PC isn't answering", "Local AI is down. Check the PC, or the room's breaker.", "rotating_light")),
            "display": (("Workshop display is back", "", "white_check_mark"),
                        ("Workshop display went offline", "", "warning")),
            "hot": (("Pi is running hot", f"{s.get('pi_temp')} °C.", "fire"),
                    ("Pi has cooled down", "", "white_check_mark")),
        }
        for key, val in now.items():
            if key not in seen:
                seen[key] = val
                continue
            if val == seen[key]:
                pending.pop(key, None)
                continue
            pending[key] = pending.get(key, 0) + 1
            if pending[key] >= 2:
                seen[key] = val
                pending.pop(key)
                good, bad = messages[key]
                title, body, tag = good if val else bad  # each pair is (when True, when False)
                notify(title, body or title, tag, "high" if not val and key in ("pc", "drive") else "default")

        state = s["x2d_state"]
        if state == "Printing":
            last_progress = s.get("x2d_progress") or 0
        if last_print == "Printing" and state in ("Idle", "Stopped", "No status") and last_progress >= 97:
            notify("X2D print finished", "Ready to take off the plate.", "tada")
        elif state == "Error" and last_print != "Error":
            notify("X2D needs attention", f"The printer reports {s.get('x2d_error') or 'an error'}.", "rotating_light", "high")
        last_print = state


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] != "/status":
            self.send_error(404)
            return
        body = json.dumps(status()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    threading.Thread(target=watch, daemon=True).start()
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
