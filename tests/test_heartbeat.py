"""The outside heartbeat (platform baseline D2): ping Healthchecks.io only after Pi Hub's own check passes."""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "deploy/pi-hub-heartbeat.sh"
PING = "https://hc-ping.com/00000000-0000-4000-8000-000000000000"


def run(tmp_path, health='{"ok":true}', ping="ok", url=PING):
    tools = tmp_path / "bin"
    tools.mkdir(exist_ok=True)
    calls = tmp_path / "calls"
    stub = tools / "curl"
    stub.write_text("#!" + sys.executable + "\n" + r'''
import os, sys
args = sys.argv[1:]
with open(os.environ["CALLS"], "a") as f: f.write(" ".join(args) + "\n")
if args[-1].endswith("/healthz"):
    if os.environ["HEALTH"] == "fail":
        print("curl: (22) The requested URL returned error: 503", file=sys.stderr); sys.exit(22)
    sys.stdout.write(os.environ["HEALTH"])
else:
    sys.exit(0 if os.environ["PING"] == "ok" else 6)
''')
    stub.chmod(0o755)
    env = {**os.environ, "PATH": f"{tools}:{os.environ['PATH']}", "CALLS": str(calls), "HEALTH": health, "PING": ping}
    if url is None:
        env.pop("HC_PING_URL", None)
    else:
        env["HC_PING_URL"] = url
    result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
    lines = calls.read_text().splitlines() if calls.exists() else []
    return result, lines


def pings(lines):
    return [line for line in lines if line.endswith(PING)]


def test_a_healthy_hub_sends_one_heartbeat(tmp_path):
    result, lines = run(tmp_path)
    assert result.returncode == 0, result.stderr
    assert len(pings(lines)) == 1
    health = lines[0]
    assert health.endswith("https://hub.rahe-home.duckdns.org/healthz")  # the real name, so Caddy and TLS are tested
    assert "--resolve hub.rahe-home.duckdns.org:443:127.0.0.1" in health
    assert "--insecure" not in health and " -k " not in health
    assert lines.index(health) < lines.index(pings(lines)[0])


def test_an_unhealthy_hub_sends_nothing(tmp_path):
    result, lines = run(tmp_path, health="fail")
    assert result.returncode == 1
    assert pings(lines) == []
    assert "no heartbeat sent" in result.stderr


def test_an_unexpected_health_body_sends_nothing(tmp_path):
    result, lines = run(tmp_path, health='{"ok":false,"error":"database"}')
    assert result.returncode == 1
    assert pings(lines) == []


def test_a_missing_ping_url_does_nothing(tmp_path):
    for url in (None, "", "http://hc-ping.com/plain-http"):
        result, lines = run(tmp_path, url=url)
        assert result.returncode == 2
        assert lines == []


def test_a_failed_ping_is_reported_without_the_secret(tmp_path):
    result, lines = run(tmp_path, ping="fail")
    assert result.returncode == 1
    assert "did not reach Healthchecks.io" in result.stderr
    for out in (result.stdout, result.stderr):
        assert PING not in out and "00000000-0000" not in out


def test_the_secret_stays_out_of_the_repo_and_the_units():
    for name in ("pi-hub-heartbeat.sh", "pi-hub-heartbeat.service", "pi-hub-heartbeat.timer"):
        assert "hc-ping.com/" not in (ROOT / "deploy" / name).read_text()
    unit = (ROOT / "deploy/pi-hub-heartbeat.service").read_text()
    assert "EnvironmentFile=/etc/pi-hub/healthchecks.env" in unit
    assert "ConditionPathExists=/etc/pi-hub/healthchecks.env" in unit
    assert "DynamicUser=yes" in unit


def test_the_timer_runs_every_five_minutes():
    timer = (ROOT / "deploy/pi-hub-heartbeat.timer").read_text()
    assert "OnUnitActiveSec=5min" in timer and "OnBootSec=" in timer


def test_the_release_installs_the_heartbeat_and_starts_it_only_once_live():
    release = (ROOT / "deploy/pi-hub-release").read_text()
    assert release.count("pi-hub-heartbeat.service pi-hub-heartbeat.timer") == 2  # snapshot and install
    assert '"$D/pi-hub-heartbeat.sh"' in release
    assert release.index('record live') < release.index("enable --now pi-hub-heartbeat.timer")
