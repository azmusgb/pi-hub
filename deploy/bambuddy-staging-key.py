#!/usr/bin/env python3
"""Make the hub's Bambuddy staging key, once (A19 P6). The owner runs it on the Pi:

    sudo python3 /opt/pi-hub/current/deploy/bambuddy-staging-key.py

It signs in exactly as bambuddy-control-key.py does (`bill`, the saved password or one typed in the terminal, never
echoed). It makes an API key that can only read status and manage the Library for printer 1 ("Pi Hub staging": Quick
Print uploads the sliced file into Bambuddy's quick-print folder with it). Bambuddy has no folder-level scope, so Pi Hub
itself keeps this key to that one folder and to files it uploaded. The key gets no queue, printer-control or other right.
It writes the key to /etc/pi-hub/secrets/bambuddy_staging_key (root:pi-hub 640) and never prints the password or the
key. If the key file already has a key, it does nothing."""
import importlib.util
import os
import sys

_spec = importlib.util.spec_from_file_location("control_key", os.path.join(os.path.dirname(os.path.abspath(__file__)), "bambuddy-control-key.py"))
control = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(control)

URL = control.URL
KEY_FILE = "/etc/pi-hub/secrets/bambuddy_staging_key"
OFF = tuple(f for f in control.FLAGS_OFF if f not in ("can_read_status", "can_manage_library")) + ("can_control_printer",)
BODY = {"name": "Pi Hub staging", "can_read_status": True, "can_manage_library": True, "printer_ids": [1], **{f: False for f in OFF}}
BY_HAND = "Bambuddy › Settings › API keys, \"Read status\" and \"Manage library\" only, printer 1."


def make_key(url, user, password, call=control._call):
    return control.make_key(url, user, password, call, body=BODY, by_hand=BY_HAND)


def main():
    return control.main(KEY_FILE, "staging", body=BODY, by_hand=BY_HAND)


if __name__ == "__main__":
    sys.exit(main())
