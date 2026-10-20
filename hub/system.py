"""The Pi in detail: services, updates, storage, network, history, alerts."""
import json
import os
import socket
import subprocess
import time

from . import db, sources

SERVICES = [
    ("plexmediaserver", "Plex", "Plays the movies"),
    ("homebridge", "Homebridge", "Smart home accessories"),
    ("pi-hub", "Pi Hub", "This app"),
    ("pi-status", "Status and alerts", "Checks things and sends phone alerts"),
    ("cups", "Printing", "Sends prints to the HP DeskJet"),
    ("docker", "Docker", "Runs the old dashboard"),
    ("cockpit.socket", "Cockpit", "Admin pages at port 9090"),
    ("glances-api", "Glances", "System charts for the old dashboard"),
    ("avahi-daemon", "pi.local name", "Lets devices find the Pi by name"),
    ("unattended-upgrades", "Security updates", "Installs security fixes each day"),
    ("mnt-usb1.automount", "Movies drive mount", "Mounts the drive when it's plugged in"),
]
ALERTS_FILE = os.environ.get("HUB_ALERTS_FILE", "/var/lib/pi-status/alerts.jsonl")


def _run(*cmd, timeout=20):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout


def services():
    units = [u for u, _, _ in SERVICES]
    states = _run("systemctl", "is-active", *units).split()
    out = []
    for (unit, name, what), state in zip(SERVICES, states + ["unknown"] * len(units)):
        out.append({"unit": unit, "name": name, "what": what, "state": state})
    return out


def _updates():
    lines = _run("apt", "list", "--upgradable", timeout=90).splitlines()
    out = []
    for line in lines:
        if "/" in line and "[upgradable" in line:
            name, rest = line.split("/", 1)
            parts = rest.split()
            out.append({"name": name, "version": parts[1] if len(parts) > 1 else ""})
    return out


def updates():
    return sources.cached("updates", 1800, _updates)


def storage():
    out = []
    for path, name in (("/", "SD card"), ("/mnt/usb1", "Movies drive")):
        try:
            with open("/proc/mounts") as f:
                mounted = path == "/" or any(l.split()[1] == path and l.split()[2] == "ext4" for l in f)
            if not mounted:
                out.append({"name": name, "mounted": False})
                continue
            st = os.statvfs(path)
            total, free = st.f_blocks * st.f_frsize, st.f_bavail * st.f_frsize
            out.append({"name": name, "mounted": True, "total_gb": round(total / 1e9, 1),
                        "free_gb": round(free / 1e9, 1), "used_pct": round(100 * (1 - free / total)) if total else 0})
        except OSError:
            out.append({"name": name, "mounted": False})
    return out


def network():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.0.0.1", 9))
        ip = s.getsockname()[0]
        s.close()
    except OSError:
        ip = None
    return {"hostname": socket.gethostname(), "ip": ip, "name": f"{socket.gethostname()}.local"}


def history(hours=24):
    since = int(time.time()) - hours * 3600
    pts = db.rows("SELECT ts, cpu, mem, temp, drive FROM samples WHERE ts >= ? ORDER BY ts", since)
    step = max(1, len(pts) // 240)
    return pts[::step]


def drive_events(days=7):
    since = int(time.time()) - days * 86400
    return db.rows("SELECT ts, kind FROM drive_events WHERE ts >= ? ORDER BY ts DESC LIMIT 100", since)


def alerts(limit=200):
    try:
        with open(ALERTS_FILE) as f:
            lines = f.readlines()[-limit:]
    except OSError:
        return []
    out = []
    for line in reversed(lines):
        try:
            a = json.loads(line)
            out.append({"ts": int(a["ts"]), "title": str(a["title"])[:120], "body": str(a.get("body", ""))[:240],
                        "tag": str(a.get("tag", ""))[:30]})
        except (ValueError, KeyError, TypeError):
            continue
    return out


BACKUP_DIR = os.environ.get("HUB_BACKUP_DIR", "/var/backups/pi-hub")


def backups():
    try:
        names = sorted((n for n in os.listdir(BACKUP_DIR) if n.startswith("pi-") and n.endswith(".tgz")), reverse=True)
    except OSError:
        return []
    out = []
    for n in names[:14]:
        st = os.stat(os.path.join(BACKUP_DIR, n))
        out.append({"name": n, "ts": int(st.st_mtime), "mb": round(st.st_size / 1e6, 1)})
    return out


def movies_present():
    """True when the drive that /etc/fstab mounts at /mnt/usb1 is plugged in."""
    try:
        for line in open("/etc/fstab"):
            parts = line.split()
            if len(parts) > 1 and parts[1] == "/mnt/usb1" and parts[0].startswith("UUID="):
                return os.path.exists(f"/dev/disk/by-uuid/{parts[0][5:]}")
    except OSError:
        pass
    return False


def selfcheck():
    try:
        with open("/var/lib/pi-hub-selfcheck/last.json") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def releases():
    try:
        with open("/var/lib/pi-hub-releases/releases.json") as f:
            log = json.load(f)
    except (OSError, ValueError):
        log = []
    try:
        current = os.path.basename(os.path.realpath("/opt/pi-hub/current"))
        on_pi = sorted(os.listdir("/opt/pi-hub/releases"))
    except OSError:
        current, on_pi = None, []
    return {"current": current, "on_pi": on_pi, "log": log[:12]}


def pc_copy():
    """When the Windows PC last copied a backup (it pulls one each morning at 5:00)."""
    try:
        ts, name = open("/var/lib/pi-backup/last-copied").read().split()[:2]
        return {"ts": int(ts), "name": name}
    except (OSError, ValueError):
        return None
