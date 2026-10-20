#!/usr/bin/env python3
"""Pi Hub helper: the only part of the hub with admin rights.

Listens on a Unix socket that only the pi-hub user can reach, and runs one of a fixed
list of actions by name. It never runs anything it's sent; it looks the name up.
"""
import json
import os
import pwd
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
