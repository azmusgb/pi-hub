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
                      'usr/local/bin', 'usr/local/lib/pi-hub', 'etc/systemd/system']:
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
    script = (ROOT / 'deploy/pi-hub-release').read_text()
    script = re.sub(r'/[a-z]+/(?:local/)?', lambda m: str(root) + m[0]
                    if m[0] in ['/srv/', '/opt/', '/var/', '/usr/local/', '/etc/'] else m[0], script)
    script = script.replace('/tmp/pi-hub-gate.json', str(tmp_path / 'gate.json'))
    runner = tmp_path / 'release'
    runner.write_text(script)
    archive = tmp_path / 'release.tar'
    with tarfile.open(archive, 'w') as tar:
        tar.add(ROOT / 'deploy', arcname='deploy')
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
elif name == 'caddy':
    with open(os.environ['CALLS'], 'a') as f: f.write('caddy ' + ' '.join(args) + '\n')
elif name == 'readlink':
    p = pathlib.Path(args[-1])
    if not p.exists(): sys.exit(1)
    print(p.resolve())
# flock, sleep, curl and rsvg-convert succeed without touching the host.
''')
    stub.chmod(0o755)
    for name in ['git', 'timeout', 'python3', 'mv', 'systemctl', 'readlink',
                 'flock', 'sleep', 'curl', 'rsvg-convert', 'caddy']:
        (tools / name).symlink_to(stub)

    def run(fail=''):
        env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'],
               'ARCHIVE': str(archive), 'FAIL': fail, 'CALLS': str(tmp_path / 'calls')}
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
    (root / 'etc/caddy').mkdir()
    (root / 'etc/caddy/Caddyfile').write_text('# package default')
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert (root / 'etc/caddy/Caddyfile').read_text() == (ROOT / 'deploy/caddy/Caddyfile').read_text()
    calls = (root.parent / 'calls').read_text().splitlines()
    validate = next(i for i, c in enumerate(calls) if c.startswith('caddy validate'))
    hub = next(i for i, c in enumerate(calls) if c.startswith('restart pi-hub'))
    assert validate < hub < calls.index('restart caddy')  # Caddy takes :80 only after the hub has left it


def test_failed_release_gives_back_the_old_gate_or_frees_port_80(release):
    root, helper, run = release
    (root / 'etc/caddy').mkdir()
    (root / 'etc/caddy/Caddyfile').write_text('# package default')
    result = run('gate')
    assert result.returncode != 0
    assert (root / 'etc/caddy/Caddyfile').read_text() == '# package default'
    calls = (root.parent / 'calls').read_text().splitlines()
    assert 'stop caddy' in calls[calls.index('restart caddy') + 1:]  # the old hub needs :80 back
