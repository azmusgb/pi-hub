#!/usr/bin/env python3
"""Nightly self-check: opens every hub page and API, checks the services, space, backups and heat,
saves the result for the hub's Pi page, and sends a phone alert only when something fails."""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

HUB = "http://127.0.0.1:8100"
OUT = "/var/lib/pi-hub-selfcheck/last.json"
TOPIC_FILE = "/etc/pi-status/ntfy_topic"
PAGES = ["/", "/media", "/documents", "/network", "/system", "/lists", "/workshop", "/print", "/pi", "/rules", "/alerts", "/drives", "/versions", "/settings", "/more"]
APIS = ["/api/needs", "/api/system/backups", "/api/movies/latest", "/api/projects", "/api/movie-night", "/api/freshness", "/api/now", "/api/movies", "/api/workshop", "/api/print", "/api/lists", "/api/pi", "/api/alerts",
        "/api/rules", "/api/outside", "/api/drives", "/api/camera", "/api/home", "/api/me"]
# Signed out (as this check is), these must refuse: 401 means the API is up and its sign-in holds.
SIGNED_IN = {"/api/drives"}
SERVICES = {"plexmediaserver": "Plex", "homebridge": "Homebridge", "pi-hub": "Pi Hub", "pi-hub-helper": "Pi Hub helper",
            "pi-status": "Status and alerts", "cups": "Printing", "x2d-camera-failover": "Camera address",
            "caddy": "Front gate"}


def fetch(path, timeout=20):
    t = time.time()
    try:
        with urllib.request.urlopen(HUB + path, timeout=timeout) as r:
            return r.status, r.read(), round((time.time() - t) * 1000)
    except urllib.error.HTTPError as e:  # an answer all the same (a 401 is expected from SIGNED_IN)
        return e.code, e.read(), round((time.time() - t) * 1000)


def main(gate=False):
    """gate=True: only pages and APIs, for checking a new release; prints JSON, no file, no alert."""
    checks = []

    def add(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    for p in PAGES:
        try:
            code, body, ms = fetch(p)
            add(f"Page {p}", code == 200 and b"js/main.js" in body, f"{ms} ms")
        except Exception as e:  # noqa: BLE001
            add(f"Page {p}", False, str(e)[:80])
    for p in APIS:
        try:
            code, body, ms = fetch(p, timeout=150 if p == "/api/drives" else 30)
            json.loads(body)
            want = 401 if p in SIGNED_IN else 200
            add(f"API {p}", code == want, f"{ms} ms" if code == want else f"answered {code}, expected {want}")
        except Exception as e:  # noqa: BLE001
            add(f"API {p}", False, str(e)[:80])
    if gate:
        bad = [c for c in checks if not c["ok"]]
        print(json.dumps({"passed": not bad, "checks": checks}))
        raise SystemExit(1 if bad else 0)
    states = subprocess.run(["systemctl", "is-active", *SERVICES], capture_output=True, text=True).stdout.split()
    for (unit, name), state in zip(SERVICES.items(), states):
        add(name, state == "active", state)
    # The hub's real name, checked against the system's trust (its certificate is Let's Encrypt's).
    r = subprocess.run(["curl", "-s", "--max-time", "10", "--resolve", "hub.rahe-home.duckdns.org:443:127.0.0.1",
                        "-o", "/dev/null", "-w", "%{http_code}", "https://hub.rahe-home.duckdns.org/healthz"], capture_output=True, text=True)
    add("The front gate answers", r.stdout == "200", r.stdout or "no answer")
    st = os.statvfs("/")
    free = st.f_bavail * st.f_frsize / 1e9
    add("Free space on the SD card", free >= 2, f"{free:.1f} GB")
    try:
        newest = max(os.path.getmtime(os.path.join("/var/backups/pi-hub", n)) for n in os.listdir("/var/backups/pi-hub") if n.endswith(".tgz"))
        hours = (time.time() - newest) / 3600
        add("Last night's backup", hours < 36, f"{hours:.0f} h ago")
    except (OSError, ValueError):
        add("Last night's backup", False, "none found")
    try:
        hours = (time.time() - int(open("/var/lib/pi-backup/last-copied").read().split()[0])) / 3600
        add("Backup copied to the PC", hours < 50, f"{hours:.0f} h ago")
    except (OSError, ValueError, IndexError):
        add("Backup copied to the PC", False, "never")
    try:
        with open("/var/lib/pi-hub-mirror/state.json") as f:
            hours = (time.time() - json.load(f)["last_ok"]) / 3600
        add("Movies copied from the PC", hours < 50, f"{hours:.0f} h ago")
    except (OSError, ValueError, KeyError, TypeError):
        add("Movies copied from the PC", False, "never")
    try:
        with open("/var/lib/pi-paperless-backup/state.json") as f:
            hours = (time.time() - json.load(f)["last_ok"]) / 3600
        add("Paperless backed up from the PC", hours < 50, f"{hours:.0f} h ago")
    except (OSError, ValueError, KeyError, TypeError):
        add("Paperless backed up from the PC", False, "never")
    with open("/sys/class/thermal/thermal_zone0/temp") as f:
        temp = int(f.read()) / 1000
    add("Temperature", temp < 80, f"{temp:.0f} °C")

    failed = [c for c in checks if not c["ok"]]
    result = {"ts": int(time.time()), "passed": not failed, "total": len(checks), "failed": len(failed), "checks": checks}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT + ".tmp", "w") as f:
        json.dump(result, f)
    os.chmod(OUT + ".tmp", 0o644)
    os.replace(OUT + ".tmp", OUT)

    if failed:
        try:
            with open(TOPIC_FILE) as f:
                topic = f.read().strip()
            body = "; ".join(f"{c['name']} ({c['detail']})" for c in failed[:6])
            req = urllib.request.Request(f"https://ntfy.sh/{topic}", data=body.encode(), method="POST",
                                         headers={"Title": f"Pi self-check: {len(failed)} problem{'s' if len(failed) > 1 else ''}",
                                                  "Tags": "warning"})
            urllib.request.urlopen(req, timeout=10).close()
        except Exception:  # noqa: BLE001
            pass
    print(f"{len(checks) - len(failed)} of {len(checks)} checks passed")


if __name__ == "__main__":
    import sys
    main(gate="--gate" in sys.argv)
