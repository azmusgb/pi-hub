"""Run the real release script in a temporary filesystem with fake Pi commands."""
import io
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[1]
SHA = 'a' * 40


@pytest.fixture
def release(tmp_path):
    root = tmp_path / 'pi'
    tools = tmp_path / 'bin'
    tools.mkdir()
    for directory in ['srv', 'opt/pi-hub/releases/previous', 'var/lock',
                      'usr/local/bin', 'usr/local/lib/pi-hub', 'etc/systemd/system', 'etc/caddy']:
        (root / directory).mkdir(parents=True, exist_ok=True)
    old = root / 'opt/pi-hub/releases/previous'
    (old / 'marker').write_text('old app')
    (root / 'opt/pi-hub/current').symlink_to(old)
    helper = root / 'usr/local/lib/pi-hub/pi-hub-helper.py'
    helper.write_text('old helper')
    helper.chmod(0o750)
    (root / 'usr/local/bin/pi-status.py').write_text('old status')
    (root / 'etc/systemd/system/pi-hub.service').write_text('old unit')
    (root / 'etc/systemd/system/x2d-camera-bridge.service').write_text('camera')
    (root / 'etc/caddy/Caddyfile').write_text('# package default')
    script = (ROOT / 'deploy/pi-hub-release').read_text()
    script = re.sub(r'/[a-z]+/(?:local/)?', lambda m: str(root) + m[0]
                    if m[0] in ['/srv/', '/opt/', '/var/', '/usr/local/', '/etc/'] else m[0], script)
    script = script.replace('/tmp/pi-hub-gate.json', str(tmp_path / 'gate.json'))
    runner = tmp_path / 'release'
    runner.write_text(script)
    archives = {}
    for kind in ('gate', 'pregate'):  # pregate: a release from before the front gate (no deploy/caddy)
        archives[kind] = tmp_path / f'release-{kind}.tar'
        with tarfile.open(archives[kind], 'w') as tar:
            tar.add(ROOT / 'deploy', arcname='deploy',
                    filter=lambda t: None if kind == 'pregate' and '/caddy' in t.name else t)
            for name, body in [('tests/smoke.mjs', ''), ('hub/static/icon.svg', '<svg/>')]:
                entry = tarfile.TarInfo(name)
                entry.size = len(body)
                tar.addfile(entry, io.BytesIO(body.encode()))
    stub = tools / 'stub'
    stub.write_text('#!' + sys.executable + '\n' + r'''
import os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
if name == 'git':
    if 'rev-parse' in args: print('a' * 40)
    elif 'archive' in args: sys.stdout.buffer.write(pathlib.Path(os.environ['ARCHIVE']).read_bytes())
    else: print('Test release')
elif name == 'timeout':
    if 'node' in args and os.environ.get('FAIL') == 'js': sys.exit(1)
    print('tests passed')
elif name == 'python3':
    if '--gate' in args:
        print('{"checks": []}')
        sys.exit(1 if os.environ.get('FAIL') == 'gate' else 0)
    os.execv(sys.executable, [sys.executable, *args])
elif name == 'mv':
    if args[0] == '-T': os.replace(args[1], args[2])
    else:
        args = [a for a in args if a != '-f']
        shutil.move(args[0], args[1])
elif name == 'systemctl':
    with open(os.environ['CALLS'], 'a') as f: f.write(' '.join(args) + '\n')
    if args == ['daemon-reload'] and os.environ.get('FAIL') == 'install':
        marker = pathlib.Path(os.environ['CALLS'] + '.failed')
        if not marker.exists(): marker.touch(); sys.exit(1)
elif name == 'curl':
    with open(os.environ['CALLS'], 'a') as f: f.write('curl ' + args[-1] + '\n')
    healthy = os.environ.get('HEALTHY')
    sys.exit(0 if not healthy or args[-1] in healthy.split() else 7)
elif name == 'caddy':
    with open(os.environ['CALLS'], 'a') as f: f.write('caddy ' + ' '.join(args) + '\n')
elif name == 'readlink':
    p = pathlib.Path(args[-1])
    if not p.exists(): sys.exit(1)
    print(p.resolve())
# flock, sleep and rsvg-convert succeed without touching the host.
''')
    stub.chmod(0o755)
    for name in ['git', 'timeout', 'python3', 'mv', 'systemctl', 'readlink',
                 'flock', 'sleep', 'curl', 'rsvg-convert', 'caddy']:
        (tools / name).symlink_to(stub)

    def run(fail='', kind='gate', healthy=''):
        env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'], 'HEALTHY': healthy,
               'ARCHIVE': str(archives[kind]), 'FAIL': fail, 'CALLS': str(tmp_path / 'calls')}
        return subprocess.run(['bash', str(runner), SHA], env=env, capture_output=True, text=True)
    return root, helper, run


@pytest.mark.parametrize('failure', ['js', 'gate', 'install'])
def test_failed_release_preserves_app_and_supporting_files(release, failure):
    root, helper, run = release
    result = run(failure)
    assert result.returncode != 0, result.stdout + result.stderr
    assert (root / 'opt/pi-hub/current').resolve().name == 'previous'
    assert helper.read_text() == 'old helper'
    assert helper.stat().st_mode & 0o777 == 0o750
    assert (root / 'usr/local/bin/pi-status.py').read_text() == 'old status'
    assert (root / 'etc/systemd/system/pi-hub.service').read_text() == 'old unit'
    assert not (root / 'usr/local/lib/pi-hub/pi-backup-serve').exists()
    assert not (root / 'etc/systemd/system/x2d-camera-bridge.service.d/port.conf').exists()
    log = json.loads((root / 'var/lib/pi-hub-releases/releases.json').read_text())
    assert log[0]['status'] == ('failed' if failure == 'js' else 'rolled-back')


def test_successful_release_installs_matching_support_and_is_idempotent(release):
    root, helper, run = release
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert (root / 'opt/pi-hub/current').resolve().name == SHA[:10]
    assert helper.read_text() == (ROOT / 'deploy/pi-hub-helper.py').read_text()
    assert (root / 'etc/systemd/system/x2d-camera-bridge.service.d/port.conf').exists()
    again = run()
    assert again.returncode == 0, again.stdout + again.stderr
    assert 'already running' in again.stdout
    assert helper.exists()


def test_manual_rollback_uses_a_separate_checked_systemd_job(tmp_path, monkeypatch):
    import importlib.util
    from types import SimpleNamespace
    spec = importlib.util.spec_from_file_location("release_helper", ROOT / "deploy/pi-hub-helper.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    monkeypatch.setattr(helper, "RELEASES", str(tmp_path))
    monkeypatch.setattr(helper, "CURRENT", str(tmp_path / "current"))
    target = 'b' * 10
    (tmp_path / target).mkdir()
    calls = []
    def schedule(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(helper.subprocess, "run", schedule)
    assert helper.rollback('../escape')['ok'] is False
    assert not calls
    assert helper.rollback(target)['ok'] is True
    assert calls[0] == ["systemd-run", "--unit=pi-hub-rollback", "--collect", "--on-active=2s",
                        "/usr/local/lib/pi-hub/pi-hub-release", target]
    monkeypatch.setattr(helper.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1))
    assert helper.rollback(target)['ok'] is False


def test_hub_listens_only_on_localhost_8100():
    # One home step 1: Caddy takes ports 80/443 and fronts the hub.
    deploy = Path(__file__).resolve().parents[1] / "deploy"
    unit = (deploy / "pi-hub.service").read_text()
    assert "--host 127.0.0.1 --port 8100" in unit and "CAP_NET_BIND_SERVICE" not in unit
    assert "http://127.0.0.1:8100/healthz" in (deploy / "pi-hub-release").read_text()
    assert 'HUB = "http://127.0.0.1:8100"' in (deploy / "pi-hub-selfcheck.py").read_text()


def test_release_puts_the_gate_in_front_of_the_hub(release):
    root, helper, run = release
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert (root / 'etc/caddy/Caddyfile').read_text() == (ROOT / 'deploy/caddy/Caddyfile').read_text()
    calls = (root.parent / 'calls').read_text().splitlines()
    validate = next(i for i, c in enumerate(calls) if c.startswith('caddy validate'))
    hub = next(i for i, c in enumerate(calls) if c.startswith('restart pi-hub'))
    assert validate < hub < calls.index('restart caddy')  # Caddy takes :80 only after the hub has left it


def test_failed_release_gives_back_the_old_gate_or_frees_port_80(release):
    root, helper, run = release
    result = run('gate')
    assert result.returncode != 0
    assert (root / 'etc/caddy/Caddyfile').read_text() == '# package default'
    calls = (root.parent / 'calls').read_text().splitlines()
    assert 'stop caddy' in calls[calls.index('restart caddy') + 1:]  # the old hub needs :80 back


HUB_8100 = 'http://127.0.0.1:8100/healthz'
THROUGH_CADDY = 'http://127.0.0.1/healthz'


def test_gate_release_checks_the_hub_and_the_gate(release):
    root, helper, run = release
    assert run(healthy=HUB_8100).returncode != 0  # the hub answers but the gate doesn't: not live
    assert (root / 'opt/pi-hub/current').resolve().name == 'previous'
    calls = (root.parent / 'calls')
    calls.unlink()
    result = run(healthy=f'{HUB_8100} {THROUGH_CADDY}')
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'curl ' + THROUGH_CADDY in calls.read_text().splitlines()


def test_failed_first_gate_release_recovers_to_the_hub_on_port_80(release):
    root, helper, run = release
    result = run('gate', healthy=THROUGH_CADDY)  # the previous release (no gate) answers on :80
    assert result.returncode != 0
    log = json.loads((root / 'var/lib/pi-hub-releases/releases.json').read_text())
    assert log[0]['status'] == 'rolled-back', result.stdout


def test_rolling_back_to_a_release_from_before_the_gate(release):
    root, helper, run = release
    result = run(kind='pregate', healthy=THROUGH_CADDY)
    assert result.returncode == 0, result.stdout + result.stderr
    calls = (root.parent / 'calls').read_text().splitlines()
    assert calls.index('stop caddy') < calls.index('restart pi-hub pi-hub-helper x2d-camera-failover')
    assert 'restart caddy' not in calls


def test_gate_release_refuses_without_caddy(release):
    root, helper, run = release
    import shutil
    shutil.rmtree(root / 'etc/caddy')
    result = run()
    assert result.returncode != 0
    assert 'install.sh' in result.stdout + result.stderr
    assert (root / 'opt/pi-hub/current').resolve().name == 'previous'


def test_the_release_check_expects_signed_in_apis_to_refuse(monkeypatch, capsys):
    import importlib.util, json, urllib.error
    spec = importlib.util.spec_from_file_location("selfcheck", Path(__file__).resolve().parents[1] / "deploy/pi-hub-selfcheck.py")
    sc = importlib.util.module_from_spec(spec); spec.loader.exec_module(sc)
    assert "/api/drives" in sc.SIGNED_IN

    class Resp:
        status = 200
        def __init__(self, body): self.body = body
        def read(self): return self.body
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def answer(url, timeout):
        path = url[len(sc.HUB):]
        if path in sc.SIGNED_IN:
            raise urllib.error.HTTPError(url, 401, "x", {}, __import__("io").BytesIO(b'{"detail": "Sign in"}'))
        return Resp(b"js/main.js" if not path.startswith("/api/") else b"{}")
    monkeypatch.setattr(sc.urllib.request, "urlopen", answer)
    try:
        sc.main(gate=True)
    except SystemExit as e:
        out = json.loads(capsys.readouterr().out)
        assert e.code == 0, [c for c in out["checks"] if not c["ok"]]


def test_heartbeat_timer_starts_after_a_live_release(release):
    root, helper, run = release
    assert run().returncode == 0
    assert 'enable --now pi-hub-heartbeat.timer' in (root.parent / 'calls').read_text().splitlines()
    assert (root / 'usr/local/lib/pi-hub/pi-hub-heartbeat.sh').exists()


def test_heartbeat_timer_does_not_start_after_a_failed_release(release):
    root, helper, run = release
    assert run('gate').returncode != 0
    assert 'enable --now pi-hub-heartbeat.timer' not in (root.parent / 'calls').read_text().splitlines()
    assert not (root / 'usr/local/lib/pi-hub/pi-hub-heartbeat.sh').exists()  # rolled back with the release


def reports(root):
    inbox = root / 'var/lib/pi-hub-releases/inbox'
    return [json.loads(p.read_text()) for p in sorted(inbox.glob('pi-hub-*.json'))] if inbox.exists() else []


def test_live_release_writes_a_deployed_report(release):
    root, _, run = release
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    [r] = reports(root)
    assert (r['target'], r['commit'], r['result'], r['mechanism']) == ('pi-hub', SHA, 'deployed', 'pi-hub-release')
    assert r['head'] == SHA and 'running' not in r


@pytest.mark.parametrize('failure', ['js'])
def test_test_failure_writes_a_failed_report(release, failure):
    root, _, run = release
    run(failure)
    [r] = reports(root)
    assert (r['result'], r['message']) == ('failed', 'JavaScript tests failed; nothing changed.')
    assert 'running' not in r


def test_rollback_records_the_restored_commit(release):
    root, _, run = release
    old = root / 'opt/pi-hub/releases/bbbbbbbbbb'
    (root / 'opt/pi-hub/releases/previous').rename(old)
    (root / 'opt/pi-hub/current').unlink()
    (root / 'opt/pi-hub/current').symlink_to(old)
    result = run('gate')
    assert result.returncode != 0
    [r] = reports(root)
    assert (r['result'], r['commit'], r['running']) == ('rolled-back', SHA, 'bbbbbbbbbb')
    log = json.loads((root / 'var/lib/pi-hub-releases/releases.json').read_text())
    assert log[0]['status'] == 'rolled-back' and log[0]['restored'] == 'bbbbbbbbbb'


def test_rollback_to_an_unnamed_release_reports_failed(release):
    root, _, run = release
    run('gate')
    [r] = reports(root)
    assert r['result'] == 'failed' and 'running' not in r


def test_reports_are_read_by_the_hub(release, tmp_path, monkeypatch):
    root, _, run = release
    run()
    os.environ['HUB_NO_SAMPLER'] = '1'
    os.environ['HUB_DB'] = str(tmp_path / 'hub.db')
    from hub import records, releases
    records._reset_memory()
    import time
    assert releases.read_inbox(time.time(), str(root / 'var/lib/pi-hub-releases/inbox')) == 1
    assert records.get('release:pi-hub')['state'] == 'live'


def test_report_never_fails_the_release(release):
    root, _, run = release
    (root / 'var/lib/pi-hub-releases').mkdir(parents=True, exist_ok=True)
    (root / 'var/lib/pi-hub-releases/inbox').write_text('not a folder')
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert "couldn't write the release report" in result.stdout
    assert (root / 'opt/pi-hub/current').resolve().name == SHA[:10]


def test_reports_keep_the_newest_ten(release):
    root, _, run = release
    inbox = root / 'var/lib/pi-hub-releases/inbox'
    inbox.mkdir(parents=True)
    for i in range(12):
        p = inbox / f'pi-hub-{i:03d}-1.json'
        p.write_text('{}')
        os.utime(p, (1000 + i, 1000 + i))
    run()
    assert len(list(inbox.glob('pi-hub-*.json'))) == 10


def test_live_release_refreshes_the_push_runner(release):
    root, _, run = release
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    incoming = root / 'usr/local/lib/pi-hub/pi-hub-release-incoming'
    assert incoming.read_text() == (ROOT / 'deploy/pi-hub-release').read_text()
    assert incoming.stat().st_mode & 0o777 == 0o755


@pytest.mark.parametrize('failure', ['js', 'gate'])
def test_failed_release_keeps_the_push_runner(release, failure):
    root, _, run = release
    incoming = root / 'usr/local/lib/pi-hub/pi-hub-release-incoming'
    incoming.write_text('old runner')
    run(failure)
    assert incoming.read_text() == 'old runner'


def test_live_release_installs_the_ota_hook(release):
    root, _, run = release
    hooks = root / 'srv/bambuhelper-smart-display.git/hooks'
    hooks.mkdir(parents=True)
    (hooks / 'post-receive').write_text('old hook')
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    hook = hooks / 'post-receive'
    assert hook.read_text() == (ROOT / 'deploy/bambuhelper-post-receive').read_text()
    assert hook.stat().st_mode & 0o777 == 0o755


def test_no_firmware_repo_no_ota_hook(release):
    root, _, run = release
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert not (root / 'srv/bambuhelper-smart-display.git').exists()
    assert "OTA publish hook" not in result.stdout


@pytest.mark.parametrize('failure', ['js', 'gate'])
def test_failed_release_keeps_the_ota_hook(release, failure):
    root, _, run = release
    hooks = root / 'srv/bambuhelper-smart-display.git/hooks'
    hooks.mkdir(parents=True)
    (hooks / 'post-receive').write_text('old hook')
    run(failure)
    assert (hooks / 'post-receive').read_text() == 'old hook'
