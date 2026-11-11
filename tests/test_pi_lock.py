"""One home, step 6 (lock): pi-lock.py rebinds the Pi's tools to 127.0.0.1, undoably. Runs against a copy of the real
config files (tests/fixtures/pi-lock, secrets removed) under --root."""
import importlib.util
import json
import re
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "pi-lock"
spec = importlib.util.spec_from_file_location("pi_lock", ROOT / "deploy" / "pi-lock.py")
pi_lock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pi_lock)


@pytest.fixture
def root(tmp_path):
    shutil.copytree(FIXTURES, tmp_path, dirs_exist_ok=True)
    return tmp_path


def run(root, *args):
    return pi_lock.main(["--root", str(root), *args])


def files(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_ports_bound_to_loopback(root):
    run(root, "apply")
    assert '"127.0.0.1:7745:7745"' in (root / "opt/homebox/compose.yml").read_text()
    assert '"127.0.0.1:9898:9898"' in (root / "opt/backrest/compose.yml").read_text()


def _service(text, name):
    """The block of one compose service: from its name to the next service or the end."""
    import re
    start = text.index(f"\n  {name}:\n")
    m = re.compile(r"\n  [a-z]").search(text, start + 3)
    return text[start:m.start() if m else len(text)]


def test_grafana_and_kuma_listen_on_loopback(root):
    run(root, "apply")
    text = (root / "opt/netmon/docker-compose.yml").read_text()
    assert "- GF_SERVER_HTTP_ADDR=127.0.0.1" in _service(text, "grafana")
    assert "- UPTIME_KUMA_HOST=127.0.0.1" in _service(text, "uptime-kuma")


def test_exporters_listen_on_loopback(root):
    run(root, "apply")
    text = (root / "opt/netmon/docker-compose.yml").read_text()
    assert "- '--web.listen-address=127.0.0.1:9100'" in _service(text, "node-exporter")
    assert "- '--web.listen-address=127.0.0.1:9115'" in _service(text, "blackbox-exporter")
    assert '("127.0.0.1", LISTEN_PORT)' in (root / "opt/netmon/scripts/orbi_exporter.py").read_text()


def test_adguard_dns_untouched(root):
    before = (root / "opt/adguard/conf/AdGuardHome.yaml").read_text()
    run(root, "apply")
    after = (root / "opt/adguard/conf/AdGuardHome.yaml").read_text()
    assert after[after.index("\ndns:"):] == before[before.index("\ndns:"):]
    assert "  address: 127.0.0.1:3002\n" in after and "0.0.0.0:3002" not in after


def test_homebridge_bridge_port_untouched(root):
    run(root, "apply")
    c = json.loads((root / "var/lib/homebridge/config.json").read_text())
    assert c["bridge"]["port"] == 51125 and "host" not in c["bridge"]
    assert next(p for p in c["platforms"] if p["platform"] == "config")["host"] == "127.0.0.1"


def test_cockpit_and_pi_status_drop_ins(root):
    run(root, "apply")
    assert "ListenStream=\nListenStream=127.0.0.1:9090\n" in (
        root / "etc/systemd/system/cockpit.socket.d/listen.conf").read_text()
    assert "Environment=PI_STATUS_BIND=127.0.0.1" in (
        root / "etc/systemd/system/pi-status.service.d/lock.conf").read_text()


def test_cockpit_allows_the_gate_origin(root):
    run(root, "apply")
    conf = (root / "etc/cockpit/cockpit.conf").read_text()
    assert "wss://pi.rahe-home.duckdns.org" in conf and "ProtocolHeader = X-Forwarded-Proto" in conf
    run(root, "undo")
    assert not (root / "etc/cockpit/cockpit.conf").exists()


def test_apply_twice_is_a_no_op(root):
    run(root, "apply")
    once = files(root)
    run(root, "apply")
    assert files(root) == once


def test_undo_restores_the_first_backup(root):
    original = files(root)
    run(root, "apply")
    run(root, "apply")
    run(root, "undo")
    assert files(root) == original
    assert not (root / "var/backups/pi-lock").exists()


def test_status_reports_each_edit(root, capsys):
    run(root, "status")
    before = capsys.readouterr().out
    assert before.count("open") >= 9 and "locked" not in before
    run(root, "apply")
    capsys.readouterr()
    run(root, "status")
    after = capsys.readouterr().out
    assert "open" not in after and after.count("locked") == before.count("open")


def test_a_missing_file_is_reported_not_created(root, capsys):
    (root / "opt/homebox/compose.yml").unlink()
    run(root, "apply")
    assert not (root / "opt/homebox/compose.yml").exists()
    run(root, "status")
    assert "missing" in capsys.readouterr().out


def test_pi_status_binds_from_the_environment():
    src = (ROOT / "deploy" / "pi-status.py").read_text()
    assert 'os.environ.get("PI_STATUS_BIND", "0.0.0.0")' in src
    assert 'ThreadingHTTPServer(("0.0.0.0"' not in src


# Bambuddy keeps :8000 for its machine callers only (Task 4): a table of its own, so Docker rebuilding its chains
# never removes it.
NFT = ROOT / "deploy" / "pi-lock-firewall.nft"


def test_bambuddy_allow_list():
    text = NFT.read_text()
    assert "table inet pi_lock {" in text and "table ip filter" not in text
    assert "hook forward priority filter - 1" in text and "hook input priority filter - 1" in text
    want = sorted(["127.0.0.0/8", "172.16.0.0/12", "10.0.0.80", "10.0.0.81", "10.0.0.92", "10.0.0.124", "100.78.96.97", "100.109.178.34"])
    rules = [x for x in text.splitlines() if x.strip().endswith("drop")]
    # Docker's NAT path (forward, the port the caller dialled) and docker-proxy's own sockets (input), IPv4 and IPv6.
    fwd = next(x for x in rules if "ct original proto-dst 8000" in x and "ip saddr" in x)
    inp = next(x for x in rules if "tcp dport 8000" in x and "ip saddr" in x)
    for rule in (fwd, inp):
        assert sorted(re.search(r"\{([^}]*)\}", rule).group(1).replace(" ", "").split(",")) == want
    assert any("tcp dport 8000" in x and "ip6 saddr != ::1" in x for x in rules)
    assert any("ct original proto-dst 8000" in x and "meta nfproto ipv6" in x for x in rules)
    # The camera failover's :8091 has no sign-in of its own: the same callers, on the Pi's own sockets.
    cam = next(x for x in rules if "tcp dport 8091" in x and "ip saddr" in x)
    assert sorted(re.search(r"\{([^}]*)\}", cam).group(1).replace(" ", "").split(",")) == want
    assert any("tcp dport 8091" in x and "ip6 saddr != ::1" in x for x in rules)
    # Only connections Docker forwarded to a published port (DNAT), not anything else the Pi might ever route.
    assert all("ct status dnat" in x for x in rules if "ct original" in x)


def test_apply_installs_the_firewall_unit(root):
    run(root, "apply")
    assert (root / "etc/pi-lock/firewall.nft").read_text() == NFT.read_text()
    unit = (root / "etc/systemd/system/pi-lock-firewall.service").read_text()
    for line in ("Before=docker.service", "Type=oneshot", "RemainAfterExit=yes",
                 "ExecStart=/usr/sbin/nft -f /etc/pi-lock/firewall.nft", "ExecStop=/usr/sbin/nft delete table inet pi_lock",
                 "WantedBy=multi-user.target"):
        assert line in unit, line
    # Stopping or restarting Docker must never take the rule down with it: only pi-lock.py undo removes it.
    assert "PartOf=" not in unit and "BindsTo=" not in unit


def test_undo_removes_it(root):
    run(root, "apply")
    run(root, "undo")
    assert not (root / "etc/pi-lock").exists()
    assert not (root / "etc/systemd/system/pi-lock-firewall.service").exists()


def test_a_changed_rule_is_reloaded_on_apply(root, monkeypatch):
    calls = []
    monkeypatch.setattr(pi_lock.subprocess, "run", lambda a, **k: calls.append(list(a)) or type("R", (), {"returncode": 0})())
    pi_lock.restart(["etc/pi-lock/firewall.nft"], "apply")
    assert ["systemctl", "enable", "pi-lock-firewall"] in calls
    assert ["systemctl", "restart", "pi-lock-firewall"] in calls


def test_a_firewall_that_fails_to_load_is_reported(root, monkeypatch, capsys):
    def run_(a, **k):
        return type("R", (), {"returncode": 1 if list(a[:2]) == ["systemctl", "restart"] else 0})()
    monkeypatch.setattr(pi_lock.subprocess, "run", run_)
    with pytest.raises(SystemExit):
        pi_lock.restart([pi_lock.FIREWALL], "apply")


# Final review fixes.
def test_adguard_web_flag_on_loopback(root):
    # --web-addr on AdGuard's command line wins over http.address in its yaml.
    run(root, "apply")
    text = (root / "opt/adguard/compose.yml").read_text()
    assert '"--web-addr", "127.0.0.1:3002"' in text and "0.0.0.0:3002" not in text


def test_apply_restarts_every_locked_target(root):
    # A re-run after an interrupted apply finds no file to change, but must still bring every tool up locked.
    run(root, "apply")
    assert sorted(pi_lock.targets(root)) == sorted({rel for _, rel, _ in pi_lock.EDITS})


def test_undo_keeps_what_the_apps_changed_since(root):
    run(root, "apply")
    yaml = root / "opt/adguard/conf/AdGuardHome.yaml"
    yaml.write_text(yaml.read_text() + "filters_update_interval: 12\n")
    hb = root / "var/lib/homebridge/config.json"
    c = json.loads(hb.read_text())
    c["accessories"].append({"name": "New lamp"})
    hb.write_text(json.dumps(c, indent=4) + "\n")
    run(root, "undo")
    assert "filters_update_interval: 12" in yaml.read_text() and "  address: 0.0.0.0:3002\n" in yaml.read_text()
    c = json.loads(hb.read_text())
    assert c["accessories"] == [{"name": "New lamp"}]
    assert "host" not in next(p for p in c["platforms"] if p["platform"] == "config")


def test_a_file_replaced_after_the_lock_becomes_the_new_original(root):
    # netmon's deploy copies a fresh docker-compose.yml over the locked one, then runs apply again: undo must later
    # restore that fresh file, not the one from before the first lock.
    run(root, "apply")
    fresh = (FIXTURES / "opt/netmon/docker-compose.yml").read_text() + "# a newer netmon\n"
    (root / "opt/netmon/docker-compose.yml").write_text(fresh)
    run(root, "apply")
    run(root, "undo")
    assert (root / "opt/netmon/docker-compose.yml").read_text() == fresh


def test_a_file_the_lock_does_not_recognise_is_not_called_locked(root, capsys):
    # A port written without quotes doesn't match the edit; status must say so rather than "locked".
    p = root / "opt/homebox/compose.yml"
    p.write_text(p.read_text().replace('"7745:7745"', "7745:7745"))
    run(root, "apply")
    capsys.readouterr()
    run(root, "status")
    line = next(x for x in capsys.readouterr().out.splitlines() if x.startswith("Homebox"))
    assert line.split()[-1] == "unrecognised"
