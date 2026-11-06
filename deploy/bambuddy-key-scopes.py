#!/usr/bin/env python3
"""Set every Bambuddy API key's permissions to what its app uses (A12 plan, decision 2). The owner runs it on the Pi:

    sudo python3 /opt/pi-hub/current/deploy/bambuddy-key-scopes.py

Bambuddy's settings screen can only make and delete keys, so this edits them in place: no key changes, nothing to swap
on the Mac, the Pi or the PC. It signs in as bambuddy-control-key.py does (`bill`, the password in
/etc/pi-hub/secrets/bambuddy_admin, or asked in this terminal, never echoed), finds each key in KEYS by its id and
name, and stops before changing anything if one is missing or renamed, or a name appears twice. Keys not in KEYS are
listed and left alone. It prints each key's permissions after, never a key or the password. Running it again changes
nothing that is already right."""
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8000"
USER = "bill"
ADMIN_FILE = "/etc/pi-hub/secrets/bambuddy_admin"
FLAGS = ("can_read_status", "can_queue", "can_control_printer", "can_manage_library", "can_manage_inventory",
         "can_manage_maintenance", "can_manage_archives", "can_manage_projects", "can_access_cloud",
         "can_update_energy_cost", "can_send_notifications")
WORDS = {"can_read_status": "Read", "can_queue": "Queue", "can_control_printer": "Control",
         "can_manage_library": "Library", "can_manage_inventory": "Inventory", "can_manage_maintenance": "Maintenance",
         "can_manage_archives": "Archives", "can_manage_projects": "Projects", "can_access_cloud": "Cloud",
         "can_update_energy_cost": "Energy", "can_send_notifications": "Notify"}
# id -> (name, the permissions it keeps). What each app calls is in the plan's key table
# (docs/superpowers/plans/2026-11-06-a12-one-tap-print.md); every read is "Read" (Bambuddy's can_read_status).
KEYS = {
    6: ("print-lab", {"can_read_status", "can_manage_library"}),
    1: ("Pi Hub (read)", {"can_read_status"}),
    4: ("Pi Hub control", {"can_control_printer", "can_queue"}),
    2: ("Local AI Materials (read)", {"can_read_status"}),
    3: ("Local AI Clear plate (control)", {"can_read_status", "can_control_printer"}),
}
CONTROL_PRINTERS = [1]  # a key that can control or queue reaches printer 1 only


class LoginRefused(SystemExit):
    """Bambuddy turned the username and password down."""


def _call(method, url, body, headers):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        msg = f"Bambuddy said HTTP {e.code} to {url.split('/api/v1/')[-1]}."
        raise (LoginRefused if e.code in (401, 403) and url.endswith("/auth/login") else SystemExit)(msg)
    except OSError:
        raise SystemExit("Bambuddy isn't answering on the Pi (port 8000).")


def login(url, user, password, call=_call):
    r = call("POST", url + "/api/v1/auth/login", {"username": user, "password": password}, {})
    token = (r or {}).get("access_token")
    if (r or {}).get("requires_2fa") or not token:
        raise SystemExit("Bambuddy didn't sign in (two-step sign-in on, or the password changed). Nothing was changed.")
    return {"Authorization": f"Bearer {token}"}


def want(key_id):
    """The PATCH body for a key in KEYS: every permission on or off, and printer 1 for one that can act."""
    _, keep = KEYS[key_id]
    body: dict = {f: f in keep for f in FLAGS}
    if keep & {"can_queue", "can_control_printer"}:
        body["printer_ids"] = CONTROL_PRINTERS
    return body


def scopes(k):
    return [WORDS[f] for f in FLAGS if k.get(f)]


def check(keys):
    """Problems that stop the script before any change: a key in KEYS missing or renamed, or a name used twice."""
    problems = []
    by_id = {k.get("id"): k for k in keys if isinstance(k, dict)}
    names = [k.get("name") for k in by_id.values()]
    for key_id, (name, _) in KEYS.items():
        k = by_id.get(key_id)
        if k is None:
            problems.append(f"key {key_id} ({name}) isn't in Bambuddy")
        elif k.get("name") != name:
            problems.append(f"key {key_id} is named {k.get('name')!r}, not {name!r}")
        if names.count(name) > 1:
            problems.append(f"{names.count(name)} keys are named {name!r}")
    return sorted(set(problems))


def apply(url, auth, call=_call, say=print):
    keys = call("GET", url + "/api/v1/api-keys/", None, auth)
    if not isinstance(keys, list):
        raise SystemExit("Bambuddy's key list wasn't a list. Nothing was changed.")
    problems = check(keys)
    if problems:
        raise SystemExit("Nothing was changed: " + "; ".join(problems) + ". Fix the key in Bambuddy › Settings › API "
                         "keys, or KEYS in this script, and run it again.")
    changed = 0
    for k in keys:
        if k.get("id") not in KEYS:
            continue
        body = want(k["id"])
        if any(bool(k.get(f)) != v for f, v in body.items() if f in FLAGS) or \
                ("printer_ids" in body and k.get("printer_ids") != body["printer_ids"]):
            call("PATCH", url + f"/api/v1/api-keys/{int(k['id'])}", body, auth)
            changed += 1
    after = call("GET", url + "/api/v1/api-keys/", None, auth)
    wrong = []
    for k in sorted(after or [], key=lambda k: k.get("id") or 0):
        managed = k.get("id") in KEYS
        say(f"  {k.get('id'):>3}  {str(k.get('name'))[:32]:<32}  {', '.join(scopes(k)) or 'nothing'}"
            + ("" if managed else "  (not in this script; left alone)"))
        if managed and any(bool(k.get(f)) != v for f, v in want(k["id"]).items() if f in FLAGS):
            wrong.append(k["name"])
    if wrong:
        raise SystemExit("Bambuddy didn't take the change for: " + ", ".join(wrong) + ".")
    say(f"Changed {changed} key{'s' if changed != 1 else ''}; every key above has what its app uses.")
    return changed


def sign_in(url, user, saved, ask, call=_call):
    """The saved password first; if there is none or Bambuddy refuses it, ask once (ask is None without a terminal)."""
    if saved:
        try:
            return login(url, user, saved, call)
        except LoginRefused:
            if ask is None:
                raise SystemExit("Bambuddy refused the saved password. Run this in a terminal (ssh -t) to type it.")
    elif ask is None:
        raise SystemExit("No saved Bambuddy password. Run this in a terminal (ssh -t) to type it.")
    typed_user, typed = ask()
    try:
        return login(url, typed_user or user, typed, call)
    except LoginRefused:
        raise SystemExit("Bambuddy didn't accept that username and password. Nothing was changed.")


def _ask():
    print("Bambuddy refused the saved password (or there is none). Sign in to Bambuddy:")
    who = input(f"  Bambuddy username [{USER}]: ").strip()
    return who, getpass.getpass("  Bambuddy password (not shown): ")


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run it with sudo.")
    try:
        with open(ADMIN_FILE) as f:
            saved = f.read().strip()
    except OSError:
        saved = None
    auth = sign_in(URL, USER, saved, _ask if sys.stdin.isatty() else None)
    apply(URL, auth)


if __name__ == "__main__":
    sys.exit(main())
