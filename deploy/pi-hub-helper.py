#!/usr/bin/env python3
"""Pi Hub helper: the only part of the hub with admin rights.

Listens on a Unix socket that only the pi-hub user can reach, and runs one of a fixed
list of actions by name. It never runs anything it's sent; it looks the name up.
"""
import base64
import json
import os
import pwd
import re
import socket
import struct
import subprocess
import threading
import time
import urllib.request

SOCKET = "/run/pi-hub-helper/helper.sock"
HUB_USER = "pi-hub"

ACTIONS = {
    "restart:plex": (["systemctl", "restart", "plexmediaserver"], 60),
    "restart:homebridge": (["systemctl", "restart", "homebridge"], 60),
    "remount:movies": (["sh", "-c", "systemctl restart mnt-usb1.automount && ls /mnt/usb1 >/dev/null"], 120),
    "restart:pi": (["sh", "-c", "sleep 3 && systemctl reboot"], None),  # runs in the background
    "selfcheck:run": (["systemctl", "start", "pi-hub-selfcheck.service"], 300),
    "mirror:movies": (["systemctl", "start", "--no-block", "pi-hub-movies-mirror.service"], 30),
    "updates:install": (["sh", "-c", "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get -y -qq "
                                     "-o Dpkg::Options::=--force-confold full-upgrade"], 1800),
}
LONG = {"updates:install"}
_jobs = {}

# ---- Drives: health reports ----
MOVIES = "/mnt/usb1"


def movies_uuid():
    """The movies drive is whichever drive /etc/fstab mounts at /mnt/usb1."""
    for line in open("/etc/fstab"):
        parts = line.split()
        if len(parts) > 1 and parts[1] == MOVIES and parts[0].startswith("UUID="):
            return parts[0][5:]
    return None


def _out(*cmd, timeout=60):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _disks():
    tree = json.loads(_out("lsblk", "-J", "-b", "-o", "NAME,SIZE,MODEL,TRAN,TYPE,MOUNTPOINT,UUID,FSTYPE,LABEL,SERIAL").stdout)
    return [d for d in tree.get("blockdevices", []) if d.get("type") == "disk" and d.get("tran") == "usb"]


def _movies_disk(disks=None):
    for d in disks or _disks():
        if any(c.get("uuid") == movies_uuid() for c in d.get("children") or []):
            return d["name"]
    return None


def _smart(name):
    for kind in ("sat", "sat,12", "usbjmicron", "auto"):
        r = _out("smartctl", "-j", "-H", "-A", "-i", "-d", kind, f"/dev/{name}", timeout=40)
        try:
            j = json.loads(r.stdout)
        except ValueError:
            continue
        if "smart_status" not in j:
            continue
        attrs = {a.get("name"): (a.get("raw") or {}).get("value") for a in (j.get("ata_smart_attributes") or {}).get("table", [])}
        return {"passed": bool(j["smart_status"].get("passed")), "model": j.get("model_name"),
                "hours": (j.get("power_on_time") or {}).get("hours"), "temp": (j.get("temperature") or {}).get("current"),
                "reallocated": attrs.get("Reallocated_Sector_Ct"), "pending": attrs.get("Current_Pending_Sector"),
                "uncorrectable": attrs.get("Offline_Uncorrectable"), "ssd_life": attrs.get("Percent_Lifetime_Remain")}
    return None


def drives_report():
    disks = _disks()
    movies = _movies_disk(disks)
    out = []
    for d in disks:
        out.append({"name": d["name"], "model": (d.get("model") or "").strip(), "size": d.get("size"), "serial_end": (d.get("serial") or "")[-4:],
                    "is_movies": d["name"] == movies, "mounted": any(c.get("mountpoint") for c in d.get("children") or []) or bool(d.get("mountpoint")),
                    "parts": [{"fs": c.get("fstype"), "label": c.get("label")} for c in d.get("children") or []],
                    "smart": _smart(d["name"])})
    return {"ok": True, "drives": out}


RESTIC = {"Pi": "/mnt/usb1/backups/restic/pi", "Mac": "/mnt/usb1/backups/restic/mac"}
ADGUARD_CONF = "/opt/adguard/conf/AdGuardHome.yaml"
ADGUARD_SECRET = "/etc/pi-hub/secrets/adguard_admin"


def backups_ages(roots=RESTIC):
    """The newest snapshot file's time in each restic repo (root-only folders); None when there is none."""
    out = {}
    for name, root in roots.items():
        try:
            folder = os.path.join(root, "snapshots")
            out[name] = int(max(os.path.getmtime(os.path.join(folder, f)) for f in os.listdir(folder)))
        except (OSError, ValueError):
            out[name] = None
    return out


def _adguard_fetch():
    user = re.search(r"users:\s*\n\s*-\s*name:\s*(\S+)", open(ADGUARD_CONF).read()).group(1)
    password = open(ADGUARD_SECRET).read().strip()
    req = urllib.request.Request("http://127.0.0.1:3002/control/stats", headers={
        "Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=4) as r:
        return json.load(r)


def adguard_stats(fetch=_adguard_fetch):
    """Today's DNS queries and blocks; the admin password stays in here."""
    try:
        s = fetch()
        return {"queries": int(s["num_dns_queries"]), "blocked": int(s["num_blocked_filtering"])}
    except Exception:  # noqa: BLE001
        return None


def run(name):
    cmd, timeout = ACTIONS[name]
    if timeout is None:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return {"ok": True, "message": "Restarting in a few seconds."}
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    tail = (r.stderr or r.stdout).strip().splitlines()[-1:] or [""]
    return {"ok": r.returncode == 0, "message": "Done." if r.returncode == 0 else tail[0][:200]}


def background(name):
    _jobs[name] = {"state": "running", "started": int(time.time())}
    try:
        result = run(name)
        _jobs[name] = {"state": "done" if result["ok"] else "failed", "message": result["message"], "ended": int(time.time())}
    except Exception as e:  # noqa: BLE001
        _jobs[name] = {"state": "failed", "message": str(e)[:200], "ended": int(time.time())}


RELEASES = "/opt/pi-hub/releases"
CURRENT = "/opt/pi-hub/current"


def rollback(to):
    if not re.fullmatch(r"[0-9a-f]{7,40}", to or "") or not os.path.isdir(os.path.join(RELEASES, to)):
        return {"ok": False, "message": "That version isn't on the Pi any more."}
    if os.path.realpath(CURRENT) == os.path.realpath(os.path.join(RELEASES, to)):
        return {"ok": True, "message": "That version is already running."}
    # A separate systemd unit survives the helper's own restart during release.
    result = subprocess.run([
        "systemd-run", "--unit=pi-hub-rollback", "--collect", "--on-active=2s",
        "/usr/local/lib/pi-hub/pi-hub-release", to,
    ], capture_output=True, text=True, timeout=10)
    if result.returncode:
        return {"ok": False, "message": "Couldn't schedule that release. Another rollback may already be running."}
    return {"ok": True, "message": f"Checking version {to} before switching. See Versions for the result."}



def handle(conn):
    with conn:
        creds = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        _, uid, _ = struct.unpack("3i", creds)
        if uid not in (0, pwd.getpwnam(HUB_USER).pw_uid):
            return
        try:
            req = json.loads(conn.makefile().readline() or "{}")
            name = str(req.get("action", ""))
            if name.startswith("status:"):
                reply = _jobs.get(name[7:], {"state": "idle"})
            elif name == "drives:report":
                reply = drives_report()
            elif name == "backups:ages":
                reply = {"ok": True, "ages": backups_ages()}
            elif name == "adguard:stats":
                stats = adguard_stats()
                reply = {"ok": stats is not None, **(stats or {"message": "AdGuard isn't answering."})}
            elif name == "release:rollback":
                reply = rollback(str(req.get("to", "")))
            elif name not in ACTIONS:
                reply = {"ok": False, "message": "Unknown action."}
            elif name in LONG:
                if _jobs.get(name, {}).get("state") == "running":
                    reply = {"ok": True, "message": "Already running."}
                else:
                    threading.Thread(target=background, args=(name,), daemon=True).start()
                    reply = {"ok": True, "message": "Started."}
            else:
                reply = run(name)
        except Exception as e:  # noqa: BLE001
            reply = {"ok": False, "message": str(e)[:200]}
        conn.sendall((json.dumps(reply) + "\n").encode())


def main():
    os.makedirs(os.path.dirname(SOCKET), exist_ok=True)
    if os.path.exists(SOCKET):
        os.unlink(SOCKET)
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.bind(SOCKET)
    os.chown(SOCKET, 0, pwd.getpwnam(HUB_USER).pw_gid)
    os.chmod(SOCKET, 0o660)
    s.listen(4)
    while True:
        conn, _ = s.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    main()
