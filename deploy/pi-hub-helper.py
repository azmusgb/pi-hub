#!/usr/bin/env python3
"""Pi Hub helper: the only part of the hub with admin rights.

Listens on a Unix socket that only the pi-hub user can reach, and runs one of a fixed
list of actions by name. It never runs anything it's sent; it looks the name up.
"""
import json
import os
import pwd
import re
import shutil
import socket
import struct
import subprocess
import threading
import time

SOCKET = "/run/pi-hub-helper/helper.sock"
HUB_USER = "pi-hub"

ACTIONS = {
    "restart:plex": (["systemctl", "restart", "plexmediaserver"], 60),
    "restart:homebridge": (["systemctl", "restart", "homebridge"], 60),
    "remount:movies": (["sh", "-c", "systemctl restart mnt-usb1.automount && ls /mnt/usb1 >/dev/null"], 120),
    "restart:pi": (["sh", "-c", "sleep 3 && systemctl reboot"], None),  # runs in the background
    "updates:install": (["sh", "-c", "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get -y -qq "
                                     "-o Dpkg::Options::=--force-confold full-upgrade"], 1800),
}
LONG = {"updates:install"}
_jobs = {}

# ---- Drives: health reports, and moving the movies to a new drive ----
MOVIES = "/mnt/usb1"


def movies_uuid():
    """The movies drive is whichever drive /etc/fstab mounts at /mnt/usb1."""
    for line in open("/etc/fstab"):
        parts = line.split()
        if len(parts) > 1 and parts[1] == MOVIES and parts[0].startswith("UUID="):
            return parts[0][5:]
    return None
NEW_MOUNT = "/mnt/movies-new"
MOVE_STATE = "/var/lib/pi-hub-helper/move.json"
DEVICE = re.compile(r"^sd[a-z]$")


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


def _save_move(**kw):
    os.makedirs(os.path.dirname(MOVE_STATE), exist_ok=True)
    state = _load_move()
    state.update(kw, updated=int(time.time()))
    with open(MOVE_STATE + ".tmp", "w") as f:
        json.dump(state, f)
    os.replace(MOVE_STATE + ".tmp", MOVE_STATE)


def _load_move():
    try:
        with open(MOVE_STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"state": "idle"}


def _real_mount(path):
    with open("/proc/mounts") as f:
        return any(l.split()[1] == path for l in f)


def _move(dev):
    part = f"/dev/{dev}1"
    try:
        prev = _load_move()
        label = _out("blkid", "-s", "LABEL", "-o", "value", part).stdout.strip()
        resume = prev.get("device") == dev and prev.get("state") in ("failed", "running") and label == "Movies"
        _save_move(state="running", step="Picking up where the copy stopped" if resume else "Preparing the new drive",
                   device=dev, started=prev.get("started") if resume else int(time.time()), failed=[], message=None)
        for cmd in ([] if resume else (["wipefs", "-a", f"/dev/{dev}"], ["parted", "-s", f"/dev/{dev}", "mklabel", "gpt", "mkpart", "movies", "ext4", "1MiB", "100%"],
                    ["partprobe", f"/dev/{dev}"], ["udevadm", "settle"], ["mkfs.ext4", "-F", "-q", "-L", "Movies", part])):
            r = _out(*cmd, timeout=600)
            if r.returncode != 0:
                raise RuntimeError(f"Preparing the new drive failed: {(r.stderr or r.stdout).strip()[:150]}")
        os.makedirs(NEW_MOUNT, exist_ok=True)
        if not _real_mount(NEW_MOUNT) and _out("mount", part, NEW_MOUNT).returncode != 0:
            raise RuntimeError("The new drive wouldn't mount after formatting.")
        st = os.statvfs(MOVIES)
        total = (st.f_blocks - st.f_bfree) * st.f_frsize
        _save_move(step="Copying the movies", total=total)
        p = subprocess.Popen(["rsync", "-aHAX", "--info=progress2", "--no-inc-recursive", "--exclude=lost+found",
                              f"{MOVIES}/", f"{NEW_MOUNT}/"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        failed = []

        def errors():
            for line in p.stderr:
                m = re.search(r'"([^"]+)"', line)
                if m and ("read errors" in line or "failed" in line or "Input/output" in line):
                    failed.append(m.group(1).replace(MOVIES + "/", "")[:200])
        t = threading.Thread(target=errors, daemon=True)
        t.start()
        last = 0
        for line in p.stdout:
            m = re.match(r"\s*([\d,]+)\s+(\d+)%", line.replace("\r", "\n").strip().split("\n")[-1] if "\r" in line else line)
            if m and time.time() - last > 5:
                _save_move(copied=int(m.group(1).replace(",", "")), percent=int(m.group(2)), failed=failed[-200:])
                last = time.time()
        rc = p.wait()
        t.join(timeout=5)
        if rc not in (0, 23, 24):
            raise RuntimeError(f"The copy stopped (rsync code {rc}). The old drive may have dropped out; start the move again to continue.")
        _save_move(step="Checking the copy", failed=failed[-200:])
        diff = _out("rsync", "-a", "--dry-run", "--itemize-changes", "--exclude=lost+found", f"{MOVIES}/", f"{NEW_MOUNT}/", timeout=3600)
        missing = [l.split(" ", 1)[1] for l in diff.stdout.splitlines() if l.startswith(">f") and " " in l]
        _save_move(state="copied", step="Ready to switch", missing=missing[:200], percent=100, finished=int(time.time()))
    except Exception as e:  # noqa: BLE001
        _save_move(state="failed", step="Stopped", message=str(e)[:200])


def move_start(dev):
    if not DEVICE.match(dev or ""):
        return {"ok": False, "message": "Unknown drive."}
    disks = {d["name"]: d for d in _disks()}
    if dev not in disks:
        return {"ok": False, "message": "That drive isn't plugged in."}
    if dev == _movies_disk(list(disks.values())):
        return {"ok": False, "message": "That's the current movies drive. Choose the new one."}
    if not _real_mount(MOVIES):
        return {"ok": False, "message": "The old movies drive has to be plugged in and mounted to copy from it."}
    if any(c.get("mountpoint") not in (None, NEW_MOUNT) for c in disks[dev].get("children") or []):
        return {"ok": False, "message": "The new drive is in use. Unplug it and plug it back in, then try again."}
    st = os.statvfs(MOVIES)
    used = (st.f_blocks - st.f_bfree) * st.f_frsize
    if (disks[dev].get("size") or 0) < used * 1.05:
        return {"ok": False, "message": "The new drive is too small for all the movies."}
    if _jobs.get("move", {}).get("state") == "running":
        return {"ok": True, "message": "The move is already running."}
    _jobs["move"] = {"state": "running"}
    threading.Thread(target=lambda: (_move(dev), _jobs.update(move={"state": "done"})), daemon=True).start()
    return {"ok": True, "message": "Started. The new drive is being prepared, then the movies are copied."}


def move_switch():
    m = _load_move()
    if m.get("state") != "copied":
        return {"ok": False, "message": "Finish the copy first."}
    uuid = _out("blkid", "-s", "UUID", "-o", "value", f"/dev/{m['device']}1").stdout.strip()
    if not uuid:
        return {"ok": False, "message": "Can't find the new drive. Is it still plugged in?"}
    shutil.copy2("/etc/fstab", f"/etc/fstab.bak-move-{time.strftime('%Y%m%d-%H%M%S')}")
    old = movies_uuid()
    lines = [l for l in open("/etc/fstab").read().splitlines() if not (old and old in l) and uuid not in l]
    lines.append(f"UUID={uuid} {MOVIES} ext4 defaults,nofail,noatime,x-systemd.automount,x-systemd.device-timeout=90s 0 2")
    with open("/etc/fstab.tmp", "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace("/etc/fstab.tmp", "/etc/fstab")
    _out("systemctl", "stop", "plexmediaserver")
    _out("umount", NEW_MOUNT)
    _out("umount", "-l", MOVIES)
    _out("systemctl", "daemon-reload")
    _out("systemctl", "restart", "mnt-usb1.automount")
    _out("ls", MOVIES)
    _out("systemctl", "start", "plexmediaserver")
    _save_move(state="switched", step="Done", switched=int(time.time()), new_uuid=uuid)
    return {"ok": True, "message": "The new drive is now the movies drive. You can unplug the old one."}


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
            elif name == "move:status":
                reply = {"ok": True, **_load_move()}
            elif name == "move:start":
                reply = move_start(str(req.get("device", "")))
            elif name == "move:switch":
                reply = move_switch()
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
