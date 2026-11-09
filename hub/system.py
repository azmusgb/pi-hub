"""The Pi in detail: services, updates, storage, network, history, alerts."""
import json
import os
import socket
import subprocess
import time

from . import db, records, sources

SERVICES = [
    ("plexmediaserver", "Plex", "Plays the movies"),
    ("homebridge", "Homebridge", "Smart home accessories"),
    ("pi-hub", "Pi Hub", "This app"),
    ("pi-status", "Status and alerts", "Checks things and sends phone alerts"),
    ("cups", "Printing", "Sends prints to the HP DeskJet"),
    ("docker", "Docker", "Runs NETMON network diagnostic appliance (Prometheus, Grafana, Uptime Kuma)"),
    ("cockpit.socket", "Cockpit", "Admin pages at port 9090"),
    ("x2d-camera-failover", "Camera address", "The X2D camera: from the Pi, or the MacBook as backup"),
    ("pi-hub-helper", "Pi Hub helper", "Carries out the Fix-it buttons"),
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
    """The pending apt upgrades. Raises when apt can't be read, so a failure is never taken for "nothing waiting"."""
    run = subprocess.run(("apt", "list", "--upgradable"), capture_output=True, text=True, timeout=90)
    if run.returncode != 0:
        raise RuntimeError(f"apt list exited {run.returncode}")
    out = []
    for line in run.stdout.splitlines():
        if "/" in line and "[upgradable" in line:
            name, rest = line.split("/", 1)
            parts = rest.split()
            # apt names the archive a package comes from first, e.g. "stable-security,now"; only that says "security"
            suites = parts[0].split(",") if parts else []
            out.append({"name": name, "version": parts[1] if len(parts) > 1 else "",
                        "security": any(x.endswith("-security") for x in suites)})
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
    data = {"hostname": socket.gethostname(), "ip": ip, "name": f"{socket.gethostname()}.local"}
    try:
        metrics = sources.network_metrics()
        if metrics:
            data["metrics"] = metrics
    except Exception:
        pass
    return data


def history(hours=24):
    since = int(time.time()) - hours * 3600
    pts = db.rows("SELECT ts, cpu, mem, temp, drive FROM samples WHERE ts >= ? ORDER BY ts", since)
    step = max(1, len(pts) // 240)
    return pts[::step]


def drive_events(days=7):
    since = int(time.time()) - days * 86400
    return db.rows("SELECT ts, kind FROM drive_events WHERE ts >= ? ORDER BY ts DESC LIMIT 100", since)


# Each pi-status alert's cause and side (A7 decision 5): an alert and its recovery share a cause, so the Alerts page can
# group "ran hot, then cooled down" by day. The titles are pi-status.py watch()'s; a test keeps the two in step. A title
# not listed is its own cause, an event with no pair.
ALERT_CAUSES = {
    "Movies drive dropped out": ("drive", "problem"), "Movies drive is back": ("drive", "recovery"),
    "Plex stopped": ("plex", "problem"), "Plex is running again": ("plex", "recovery"),
    "Homebridge stopped": ("homebridge", "problem"), "Homebridge is running again": ("homebridge", "recovery"),
    "Windows PC isn't answering": ("pc", "problem"), "Windows PC is back": ("pc", "recovery"),
    "Workshop display went offline": ("display", "problem"), "Workshop display is back": ("display", "recovery"),
    "Pi is running hot": ("hot", "problem"), "Pi has cooled down": ("hot", "recovery"),
    "X2D print finished": ("print_finished", "event"), "X2D needs attention": ("x2d_error", "problem"),
}


def alert_cause(title):
    return ALERT_CAUSES.get(title, (f"title:{title}", "event"))


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
            title = str(a["title"])[:120]
            cause, side = alert_cause(title)
            out.append({"ts": int(a["ts"]), "title": title, "body": str(a.get("body", ""))[:240],
                        "tag": str(a.get("tag", ""))[:30], "cause": cause, "side": side})
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


def movies_mounted():
    """An actual filesystem, rather than just the automount, is mounted here."""
    with open("/proc/mounts") as mounts:
        return any(len(parts) > 2 and parts[1] == "/mnt/usb1" and parts[2] != "autofs"
                   for parts in (line.split() for line in mounts))


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


OUTAGE_PAIRS = {"pc_down": ("pc_back", "Windows PC"), "drive_dropped": ("drive_back", "Movies drive"),
                "plex_stopped": (None, "Plex"), "homebridge_stopped": (None, "Homebridge")}
# down event -> the record that speaks for the thing, and its states that mean it is down (events.ON's)
OUTAGE_RECORDS = {"pc_down": ("pc", {"off"}), "drive_dropped": ("movies_drive", {"missing", "not_mounted"}),
                  "plex_stopped": ("plex", {"stopped"}), "homebridge_stopped": ("devices", {"stopped"})}


def outages(days=30):
    """Downtime from the hub's own event log: what went down, when, and for how long. An outage with no
    recovery event (Plex and Homebridge have none, and one can be missed across a hub restart) ends at its
    record's first change to a state that isn't down; failing that, it isn't ongoing once the thing went
    down again or its record says it's up now, and its end is unknown. A record that can't be read leaves it
    ongoing."""
    since = int(time.time()) - days * 86400
    try:
        evs = db.rows("SELECT ts, kind FROM events WHERE ts >= ? ORDER BY ts", since)
    except Exception:  # noqa: BLE001 - the events table appears on first use
        return []
    out, open_ = [], {}
    for e in evs:
        if e["kind"] in OUTAGE_PAIRS:
            open_[e["kind"]] = e["ts"]
            out.append({"what": OUTAGE_PAIRS[e["kind"]][1], "kind": e["kind"], "start": e["ts"], "end": None})
        for down, (up, _) in OUTAGE_PAIRS.items():
            if up and e["kind"] == up and down in open_:
                start = open_.pop(down)
                for o in reversed(out):
                    if o["start"] == start and o["end"] is None:
                        o["end"] = e["ts"]
                        break
    for i, o in enumerate(out):
        kind = o.pop("kind")
        if o["end"] is not None:
            o["ongoing"] = False
            continue
        thing, down = OUTAGE_RECORDS[kind]
        later = next((x["start"] for x in out[i + 1:] if x["kind"] == kind), None)
        back = _record_back(thing, down, o["start"], later)
        o["end"] = back if isinstance(back, int) else None
        if back is not None or later is not None:
            o["ongoing"] = False
        else:
            rec = records.get(thing)
            o["ongoing"] = (not rec or rec.get("stale") or rec.get("state") in down
                            or rec.get("state") in ("unknown", "offline"))
    return list(reversed(out))[:20]


def _record_back(thing, down, start, before=None):
    """How the thing's record came back after start (and before the next outage): the time it changed from a down
    state to one that isn't, "seen" when it was first read up with no down reading before it (after a hub start,
    say, which says it's up but not since when), or None when no reading says it's up."""
    try:
        rows = db.rows("SELECT ts, old, new FROM record_events WHERE thing = ? AND ts > ? AND ts < ? ORDER BY ts",
                       thing, start, before if before is not None else 2**62)
    except Exception:  # noqa: BLE001 - no record history yet
        return None
    unsure = ("unknown", "offline")
    lost = False  # a hub start since the last down reading: the record no longer knows what came before
    for r in rows:
        if r["old"] is None:
            lost = True
        if r["new"] in down:
            lost = False
            continue
        if r["new"] in unsure:
            continue
        return r["ts"] if not lost and (r["old"] in down or r["old"] in unsure) else "seen"
    return None
