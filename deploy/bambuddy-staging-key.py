#!/usr/bin/env python3
"""Make the hub's Bambuddy staging key, once (A19 P6). The owner runs it on the Pi:

    sudo python3 /opt/pi-hub/current/deploy/bambuddy-staging-key.py

It signs in to Bambuddy as `bill` with the password in /etc/pi-hub/secrets/bambuddy_admin; if that is missing or
Bambuddy refuses it, it asks for the username and password in this terminal (never echoed). It makes an API key that
can only read status and manage the Library for printer 1 ("Pi Hub staging": Quick Print uploads the sliced file into
Bambuddy's quick-print folder with it). Bambuddy has no folder-level scope, so Pi Hub itself keeps this key to that one
folder and to files it uploaded. The key gets no queue, printer-control or other right. It writes the key to
/etc/pi-hub/secrets/bambuddy_staging_key (root:pi-hub 640). It never prints the password or the key. If the key file
already has a key, it does nothing."""
import getpass
import grp
import json
import os
import sys
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8000"
USER = "bill"
ADMIN_FILE = "/etc/pi-hub/secrets/bambuddy_admin"
KEY_FILE = "/etc/pi-hub/secrets/bambuddy_staging_key"
FLAGS_OFF = ("can_queue", "can_control_printer", "can_manage_inventory", "can_manage_maintenance",
             "can_manage_archives", "can_manage_projects", "can_access_cloud", "can_update_energy_cost",
             "can_send_notifications")


class LoginRefused(SystemExit):
    """Bambuddy turned the username and password down."""


def _call(method, url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method=method,
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        msg = f"Bambuddy said HTTP {e.code} to {url.split('/api/v1/')[-1]}."
        raise (LoginRefused if e.code in (401, 403) and url.endswith("/auth/login") else SystemExit)(msg)
    except OSError:
        raise SystemExit("Bambuddy isn't answering on the Pi (port 8000).")


def make_key(url, user, password, call=_call):
    login = call("POST", url + "/api/v1/auth/login", {"username": user, "password": password}, {})
    token = login.get("access_token")
    if login.get("requires_2fa") or not token:
        raise SystemExit("Bambuddy didn't sign in (two-step sign-in on, or the password changed). "
                         "Make the key by hand: Bambuddy › Settings › API keys, \"Read status\" and \"Manage library\" only, printer 1.")
    body = {"name": "Pi Hub staging", "can_read_status": True, "can_manage_library": True, "printer_ids": [1],
            **{f: False for f in FLAGS_OFF}}
    key = call("POST", url + "/api/v1/api-keys/", body, {"Authorization": f"Bearer {token}"}).get("key")
    if not key:
        raise SystemExit("Bambuddy made no key. Check Bambuddy › Settings › API keys.")
    return key


def get_key(url, user, saved, ask, call=_call):
    """The saved password first; if there is none or Bambuddy refuses it, ask once (ask is None without a terminal)."""
    if saved:
        try:
            return make_key(url, user, saved, call)
        except LoginRefused:
            if ask is None:
                raise SystemExit("Bambuddy refused the saved password. Run this in a terminal (ssh -t) to type it.")
    elif ask is None:
        raise SystemExit("No saved Bambuddy password. Run this in a terminal (ssh -t) to type it.")
    typed_user, typed = ask()
    try:
        return make_key(url, typed_user or user, typed, call)
    except LoginRefused:
        raise SystemExit("Bambuddy didn't accept that username and password. Nothing was made; run it again to retry.")


def _ask():
    print("Bambuddy refused the saved password (or there is none). Sign in to Bambuddy:")
    who = input(f"  Bambuddy username [{USER}]: ").strip()
    return who, getpass.getpass("  Bambuddy password (not shown): ")


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run it with sudo.")
    try:
        with open(KEY_FILE) as f:
            if f.read().strip():
                print("The hub's staging key is already set up.")
                return
    except OSError:
        pass
    try:
        with open(ADMIN_FILE) as f:
            saved = f.read().strip()
    except OSError:
        saved = None
    key = get_key(URL, USER, saved, _ask if sys.stdin.isatty() else None)
    os.umask(0o077)
    with open(KEY_FILE, "w") as f:
        f.write(key + "\n")
    os.chown(KEY_FILE, 0, grp.getgrnam("pi-hub").gr_gid)
    os.chmod(KEY_FILE, 0o640)
    print("Made the hub's staging key (Bambuddy › Settings › API keys › Pi Hub staging).")


if __name__ == "__main__":
    sys.exit(main())
