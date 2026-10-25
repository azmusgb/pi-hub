#!/usr/bin/env python3
"""Make the hub's Bambuddy control key, once (one home, step 3). The owner runs it on the Pi:

    sudo python3 /opt/pi-hub/current/deploy/bambuddy-control-key.py

It signs in to Bambuddy as `bill` with the password in /etc/pi-hub/secrets/bambuddy_admin, makes an API key that
can only control printer 1 ("Pi Hub control"), and writes it to /etc/pi-hub/secrets/bambuddy_control_key
(root:pi-hub 640). It never prints the password or the key. If the key file already has a key, it does nothing."""
import grp
import json
import os
import sys
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8000"
USER = "bill"
ADMIN_FILE = "/etc/pi-hub/secrets/bambuddy_admin"
KEY_FILE = "/etc/pi-hub/secrets/bambuddy_control_key"
FLAGS_OFF = ("can_queue", "can_read_status", "can_manage_library", "can_manage_inventory", "can_manage_maintenance",
             "can_manage_archives", "can_manage_projects", "can_access_cloud", "can_update_energy_cost",
             "can_send_notifications")


def _call(method, url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method=method,
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Bambuddy said HTTP {e.code} to {url.split('/api/v1/')[-1]}.")
    except OSError:
        raise SystemExit("Bambuddy isn't answering on the Pi (port 8000).")


def make_key(url, user, password, call=_call):
    login = call("POST", url + "/api/v1/auth/login", {"username": user, "password": password}, {})
    token = login.get("access_token")
    if login.get("requires_2fa") or not token:
        raise SystemExit("Bambuddy didn't sign in (two-step sign-in on, or the password changed). "
                         "Make the key by hand: Bambuddy › Settings › API keys, \"Control printer\" only, printer 1.")
    body = {"name": "Pi Hub control", "can_control_printer": True, "printer_ids": [1], **{f: False for f in FLAGS_OFF}}
    key = call("POST", url + "/api/v1/api-keys/", body, {"Authorization": f"Bearer {token}"}).get("key")
    if not key:
        raise SystemExit("Bambuddy made no key. Check Bambuddy › Settings › API keys.")
    return key


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run it with sudo.")
    try:
        with open(KEY_FILE) as f:
            if f.read().strip():
                print("The hub's control key is already set up.")
                return
    except OSError:
        pass
    with open(ADMIN_FILE) as f:
        password = f.read().strip()
    key = make_key(URL, USER, password)
    os.umask(0o077)
    with open(KEY_FILE, "w") as f:
        f.write(key + "\n")
    os.chown(KEY_FILE, 0, grp.getgrnam("pi-hub").gr_gid)
    os.chmod(KEY_FILE, 0o640)
    print("Made the hub's control key (Bambuddy › Settings › API keys › Pi Hub control).")


if __name__ == "__main__":
    sys.exit(main())
