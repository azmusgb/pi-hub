#!/usr/bin/env python3
"""One home, step 6 (lock): the Pi's tools answer only on 127.0.0.1, so the front gate is the way in.

    sudo python3 pi-lock.py apply    rebind every tool (backs up each file it changes, once)
    sudo python3 pi-lock.py undo     put every file back from those backups and restart what changed
    sudo python3 pi-lock.py status   one line per change: locked / open / missing

Edits are text edits, line by line (the Pi has no PyYAML), and each is idempotent. Backups live in
/var/backups/pi-lock/<the file's path>; the first one is kept, so a second apply never overwrites the original.
--root DIR runs against a copy of the files (the tests) and then restarts nothing.
Plan: docs/superpowers/plans/2026-10-25-one-home-step-6-lock.md
"""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

BACKUPS = "var/backups/pi-lock"
HERE = Path(__file__).resolve().parent
FIREWALL = "etc/systemd/system/pi-lock-firewall.service"
NETMON = "opt/netmon/docker-compose.yml"


def bind_ports(text, ports):
    """Compose port lines "N:M" for the listed host ports become "127.0.0.1:N:M"."""
    pat = re.compile(r'^(\s*- )"(%s):(\d+)"' % "|".join(str(p) for p in ports), re.M)
    return pat.sub(r'\1"127.0.0.1:\2:\3"', text)


def _service_span(text, service):
    start = text.index(f"\n  {service}:\n") + 1
    m = re.compile(r"^  [a-z]", re.M).search(text, start + 3)
    return start, m.start() if m else len(text)


def add_item(text, service, key, item):
    """Adds `- item` to the end of a service's list (environment, command), once."""
    start, end = _service_span(text, service)
    block = text[start:end]
    if f"- {item}\n" in block:
        return text
    lines = block.splitlines(keepends=True)
    k = next(i for i, x in enumerate(lines) if x.rstrip() == f"    {key}:")
    last = k
    for i in range(k + 1, len(lines)):
        if not lines[i].startswith("      ") and lines[i].strip():
            break
        if lines[i].lstrip().startswith("- "):
            last = i
    lines.insert(last + 1, f"      - {item}\n")
    return text[:start] + "".join(lines) + text[end:]


def adguard_web(text):
    """AdGuard's web page (http.address) on 127.0.0.1; its DNS (dns.bind_hosts) is left alone."""
    m = re.compile(r"^http:\n(?:(?:  .*|)\n)*", re.M).search(text)
    block = m.group(0).replace("\n  address: 0.0.0.0:3002\n", "\n  address: 127.0.0.1:3002\n")
    return text[:m.start()] + block + text[m.end():]


def homebridge_ui(text):
    """Homebridge's UI (the "config" platform) on 127.0.0.1; the HomeKit bridge itself is left alone."""
    c = json.loads(text)
    ui = next(p for p in c.get("platforms", []) if p.get("platform") == "config")
    if ui.get("host") == "127.0.0.1":
        return text
    ui["host"] = "127.0.0.1"
    return json.dumps(c, indent=4) + "\n"


def orbi_exporter(text):
    return text.replace('HTTPServer(("0.0.0.0", LISTEN_PORT)', 'HTTPServer(("127.0.0.1", LISTEN_PORT)')


# (name, file, change). A change is a function of the file's text, or a str: the whole of a file the lock creates.
EDITS = [
    ("Homebox :7745", "opt/homebox/compose.yml", lambda t: bind_ports(t, [7745])),
    ("Backrest :9898", "opt/backrest/compose.yml", lambda t: bind_ports(t, [9898])),
    ("Grafana :3000", NETMON, lambda t: add_item(t, "grafana", "environment", "GF_SERVER_HTTP_ADDR=127.0.0.1")),
    ("Uptime Kuma :3001", NETMON, lambda t: add_item(t, "uptime-kuma", "environment", "UPTIME_KUMA_HOST=127.0.0.1")),
    ("node_exporter :9100", NETMON,
     lambda t: add_item(t, "node-exporter", "command", "'--web.listen-address=127.0.0.1:9100'")),
    ("blackbox :9115", NETMON,
     lambda t: add_item(t, "blackbox-exporter", "command", "'--web.listen-address=127.0.0.1:9115'")),
    ("Orbi exporter :9120", "opt/netmon/scripts/orbi_exporter.py", orbi_exporter),
    ("AdGuard web :3002", "opt/adguard/conf/AdGuardHome.yaml", adguard_web),
    ("Homebridge UI :8581", "var/lib/homebridge/config.json", homebridge_ui),
    ("Cockpit :9090", "etc/systemd/system/cockpit.socket.d/listen.conf",
     "# one home, step 6 (pi-lock.py): Cockpit only through the gate\n[Socket]\nListenStream=\nListenStream=127.0.0.1:9090\n"),
    ("pi-status :8099", "etc/systemd/system/pi-status.service.d/lock.conf",
     "# one home, step 6 (pi-lock.py): pi-status only for the hub\n[Service]\nEnvironment=PI_STATUS_BIND=127.0.0.1\n"),
    ("Bambuddy :8000 rule", "etc/pi-lock/firewall.nft", (HERE / "pi-lock-firewall.nft").read_text()),
    ("Bambuddy :8000 unit", FIREWALL, (HERE / "pi-lock-firewall.service").read_text()),
]
COMPOSE = {"opt/homebox/compose.yml", "opt/backrest/compose.yml", NETMON}
RESTART = {"opt/netmon/scripts/orbi_exporter.py": "orbi-exporter", "opt/adguard/conf/AdGuardHome.yaml": "adguard",
           "var/lib/homebridge/config.json": "homebridge",
           "etc/systemd/system/cockpit.socket.d/listen.conf": "cockpit.socket",
           "etc/systemd/system/pi-status.service.d/lock.conf": "pi-status"}


def state(root, rel, change):
    p = root / rel
    if isinstance(change, str):
        return "locked" if p.exists() and p.read_text() == change else "open"
    if not p.exists():
        return "missing"
    text = p.read_text()
    return "locked" if change(text) == text else "open"


def apply(root):
    changed = []
    for name, rel, change in EDITS:
        p, backup = root / rel, root / BACKUPS / rel
        if isinstance(change, str):
            new, old = change, (p.read_text() if p.exists() else None)
        elif not p.exists():
            print(f"{name:24} missing: {rel}")
            continue
        else:
            old = p.read_text()
            new = change(old)
        if new == old:
            continue
        if old is not None and not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, backup)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(new)
        changed.append(rel)
        print(f"{name:24} locked")
    return changed


def undo(root):
    changed = []
    for _, rel, change in EDITS:
        p, backup = root / rel, root / BACKUPS / rel
        if backup.exists():
            shutil.copy2(backup, p)
        elif isinstance(change, str) and p.exists():
            p.unlink()
            if not any(p.parent.iterdir()):
                p.parent.rmdir()
        else:
            continue
        if rel not in changed:
            changed.append(rel)
    shutil.rmtree(root / BACKUPS, ignore_errors=True)
    return changed


def check_firewall():
    """On the real Pi, before anything changes: the rule must parse, or nothing is applied."""
    r = subprocess.run(["nft", "-c", "-f", str(HERE / "pi-lock-firewall.nft")], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("pi-lock: the Bambuddy rule doesn't check out, nothing changed:\n" + r.stderr)


def restart(changed, action):
    """On the real Pi: bring the changed tools up on their new address."""
    sh = lambda *a: subprocess.run(a, check=False)  # noqa: E731 — keep going; status shows what didn't take
    sh("systemctl", "daemon-reload")
    if FIREWALL in changed and action == "apply":
        sh("systemctl", "enable", "--now", "pi-lock-firewall")
    for rel in changed:
        if rel in COMPOSE:
            sh("docker", "compose", "-f", "/" + rel, "up", "-d")
        elif rel == "opt/adguard/conf/AdGuardHome.yaml":
            sh("docker", "compose", "-f", "/opt/adguard/compose.yml", "restart")
        elif rel in RESTART:
            sh("systemctl", "restart", RESTART[rel])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default="/")
    ap.add_argument("action", choices=["apply", "undo", "status"])
    a = ap.parse_args(argv)
    root = Path(a.root)
    if a.action == "status":
        for name, rel, change in EDITS:
            print(f"{name:24} {state(root, rel, change)}")
        return 0
    if a.root == "/" and a.action == "apply":
        check_firewall()
    if a.root == "/" and a.action == "undo" and (root / FIREWALL).exists():
        # Before its file goes: stopping runs its ExecStop, which deletes the table.
        subprocess.run(["systemctl", "disable", "--now", "pi-lock-firewall"], check=False)
    changed = apply(root) if a.action == "apply" else undo(root)
    if a.root == "/" and changed:
        restart(changed, a.action)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
