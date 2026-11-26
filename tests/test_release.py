"""Run the real release script in a temporary filesystem with fake Pi commands."""
import io
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[1]
SHA = 'a' * 40


PI_DIRS = ['srv', 'opt/pi-hub/releases/previous', 'var/lock',
           'usr/local/bin', 'usr/local/lib/pi-hub', 'etc/systemd/system', 'etc/caddy']
TOOLS = ['git', 'timeout', 'python3', 'mv', 'readlink']  # these need Python
SHELL_TOOLS = ['systemctl', 'flock', 'sleep', 'curl', 'rsvg-convert', 'caddy']  # these only log and answer


@pytest.fixture(scope='module')
def release_template(tmp_path_factory):
    """What every release test starts from, built once: the fake Pi, the release archives and the fake commands.
    Each test gets its own copy of the Pi and its own copy of the real script."""
    base = tmp_path_factory.mktemp('release-template')
    root = base / 'pi'
    tools = base / 'bin'
    tools.mkdir()
    for directory in PI_DIRS:
        (root / directory).mkdir(parents=True, exist_ok=True)
    (root / 'opt/pi-hub/releases/previous/marker').write_text('old app')
    helper = root / 'usr/local/lib/pi-hub/pi-hub-helper.py'
    helper.write_text('old helper')
    helper.chmod(0o750)
    (root / 'usr/local/bin/pi-status.py').write_text('old status')
    (root / 'etc/systemd/system/pi-hub.service').write_text('old unit')
    (root / 'etc/systemd/system/x2d-camera-bridge.service').write_text('camera')
    (root / 'etc/caddy/Caddyfile').write_text('# package default')
    archives = {}
    for kind in ('gate', 'pregate'):  # pregate: a release from before the front gate (no deploy/caddy)
        archives[kind] = base / f'release-{kind}.tar'
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
    elif 'log' in args and os.environ.get('MSG'): print(os.environ['MSG'])
    else: print('Test release')
elif name == 'timeout':
    with open(os.environ['CALLS'], 'a') as calls: calls.write('timeout ' + ' '.join(args) + '\n')
    if 'node' in args and os.environ.get('FAIL') == 'js':
        print('ok 1 - one that passes\nnot ok 2 - the one that fails\n' + 'ok 3 - later ones\n' * 20)
        sys.exit(1)
    if 'node' in args and os.environ.get('FAIL') == 'js-stopped': sys.exit(124)  # what timeout returns when it stops a run
    print('tests passed')
elif name == 'python3':
    if args == ['-c', 'import xdist']: sys.exit(0 if os.environ.get('XDIST') else 1)  # the release's xdist check
    if '--gate' in args:
        print('{"checks": []}')
        sys.exit(1 if os.environ.get('FAIL') == 'gate' else 0)
    os.execv(sys.executable, [sys.executable, *args])
elif name == 'mv':
    if args[0] == '-T': os.replace(args[1], args[2])
    else:
        args = [a for a in args if a != '-f']
        shutil.move(args[0], args[1])
elif name == 'readlink':
    p = pathlib.Path(args[-1])
    if not p.exists(): sys.exit(1)
    print(p.resolve())
''')
    stub.chmod(0o755)
    for name in TOOLS:
        (tools / name).symlink_to(stub)
    # A shell stub starts in a fraction of Python's time; the script calls these most (curl and sleep 30 times each
    # while a check waits for an address that never answers).
    sh = tools / 'shstub'
    sh.write_text(r'''#!/bin/sh
set -f
case "${0##*/}" in
systemctl)
  echo "$*" >> "$CALLS"
  if [ "$*" = daemon-reload ] && [ "$FAIL" = install ] && [ ! -e "$CALLS.failed" ]; then
    : > "$CALLS.failed"; exit 1
  fi ;;
curl)
  for last; do :; done
  echo "curl $last" >> "$CALLS"
  [ -z "$HEALTHY" ] && exit 0
  for h in $HEALTHY; do [ "$h" = "$last" ] && exit 0; done
  exit 7 ;;
caddy)
  echo "caddy $*" >> "$CALLS" ;;
esac
# flock, sleep and rsvg-convert succeed without touching the host.
exit 0
''')
    sh.chmod(0o755)
    for name in SHELL_TOOLS:
        (tools / name).symlink_to(sh)
    return base, (ROOT / 'deploy/pi-hub-release').read_text(), archives


@pytest.fixture
def release(release_template, tmp_path):
    base, script, archives = release_template
    root = tmp_path / 'pi'
    shutil.copytree(base / 'pi', root, symlinks=True)
    (root / 'opt/pi-hub/current').symlink_to(root / 'opt/pi-hub/releases/previous')
    helper = root / 'usr/local/lib/pi-hub/pi-hub-helper.py'
    script = re.sub(r'/[a-z]+/(?:local/)?', lambda m: str(root) + m[0]
                    if m[0] in ['/srv/', '/opt/', '/var/', '/usr/local/', '/etc/'] else m[0], script)
    script = script.replace('/tmp/pi-hub-gate.json', str(tmp_path / 'gate.json'))
    # The release times its tests with bash's $SECONDS; each reset starts from PY_START / JS_START instead of 0,
    # so a test can say how long the tests "took" (plus the second or so they really take).
    script = script.replace('SECONDS=0', 'SECONDS=${PY_START:-0}', 1).replace('SECONDS=0', 'SECONDS=${JS_START:-0}', 1)
    runner = tmp_path / 'release'
    runner.write_text(script)
    tools = base / 'bin'

    def run(fail='', kind='gate', healthy='', msg='', py=0, js=0, xdist=False):
        env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'], 'HEALTHY': healthy, 'MSG': msg,
               'PY_START': str(py), 'JS_START': str(js), 'XDIST': '1' if xdist else '',
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
    assert 'running' not in r and 'tests' not in r


# A stopped run is not a failing test: the Pi was busy (a Plex transcode, 25 Nov 2026) and the record must say which.
def test_javascript_tests_stopped_at_the_limit_say_so(release):
    root, _, run = release
    result = run('js-stopped')
    assert result.returncode != 0
    assert 'timeout 240 node --test' in (root.parent / 'calls').read_text()
    [r] = reports(root)
    assert (r['result'], r['message']) == ('failed', 'JavaScript tests ran past 240 s and were stopped; nothing changed.')
    assert (root / 'opt/pi-hub/current').resolve().name == 'previous'


def test_a_failing_javascript_test_is_named_in_the_output(release):
    root, _, run = release
    result = run('js')
    assert 'not ok 2 - the one that fails' in result.stdout, result.stdout


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


@pytest.mark.parametrize('msg, name', [
    ('Merge pull request #109 from azmusgb/docs/c1-accepted\n\nOff-site backup accepted', 'Off-site backup accepted #109'),
    ('Off-site backup accepted (#109)', 'Off-site backup accepted #109'),
    ('Merge pull request #7 from azmusgb/x', 'Merge pull request #7 from azmusgb/x'),
    ('Fix the gate', 'Fix the gate'),
])
def test_a_version_is_named_by_its_change(release, msg, name):
    # A7 decision 4: the PR title and its number, never "Merge pull request #N from …" when GitHub gave a title.
    root, _, run = release
    run(msg=msg)
    log = json.loads((root / 'var/lib/pi-hub-releases/releases.json').read_text())
    assert log[0]['subject'] == name


# A34 P0: each release states its own test time; at or past the 600 s budget it still goes live and says so.
# The stubbed tests take a second or so, so each time may read one more than its start.
@pytest.mark.parametrize('py, js, said', [
    (412, 41, r'Tests passed in 41[23] s \(JS 4[12] s\)'),
    (598, 30, r'Tests passed in 59[89] s \(JS 3[01] s\)'),
])
def test_a_live_release_reports_its_test_time(release, py, js, said):
    root, _, run = release
    result = run(py=py, js=js)
    assert result.returncode == 0, result.stdout + result.stderr
    assert re.search(f'pi-hub: {said}\n', result.stdout), result.stdout
    log = json.loads((root / 'var/lib/pi-hub-releases/releases.json').read_text())
    assert log[0]['status'] == 'live'
    assert re.fullmatch(f'{said}; every page and API answered.', log[0]['message'])
    [r] = reports(root)
    assert r['message'] == log[0]['message']


def test_tests_at_the_budget_still_go_live_and_say_so(release):
    root, _, run = release
    result = run(py=600, js=41)
    assert result.returncode == 0, result.stdout + result.stderr
    said = r'Tests passed in 60[01] s \(JS 4[12] s\), tests over budget \(600 s\)'
    assert re.search(f'pi-hub: {said}\n', result.stdout), result.stdout
    assert (root / 'opt/pi-hub/current').resolve().name == SHA[:10]
    log = json.loads((root / 'var/lib/pi-hub-releases/releases.json').read_text())
    assert log[0]['status'] == 'live'
    assert re.fullmatch(f'{said}; every page and API answered.', log[0]['message'])


# A34 P0 decision 7: with pytest-xdist installed the Python tests run on 3 workers, one test file to a worker, and the
# message says so; without it they run in one process as before and the message has no worker count.
def _pytest_call(root):
    [call] = [c for c in (root.parent / 'calls').read_text().splitlines() if c.startswith('timeout 900 ')]
    return call.split()


def test_tests_run_on_three_workers_when_xdist_is_installed(release):
    root, _, run = release
    result = run(py=412, js=41, xdist=True)
    assert result.returncode == 0, result.stdout + result.stderr
    said = r'Tests passed in 41[23] s on 3 workers \(JS 4[12] s\)'
    assert re.search(f'pi-hub: {said}\n', result.stdout), result.stdout
    log = json.loads((root / 'var/lib/pi-hub-releases/releases.json').read_text())
    assert re.fullmatch(f'{said}; every page and API answered.', log[0]['message'])
    call = _pytest_call(root)
    assert call[call.index('-n') + 1] == '3' and call[call.index('--dist') + 1] == 'loadfile'
    assert call[-1] == 'tests'


# A35 decision 13: the deployed report carries the test time as numbers, so later steps need not parse the message.
# (Without xdist it says one worker: test_tests_run_in_one_process_without_xdist; a failed report has none.)
def test_deployed_report_carries_its_test_time(release):
    root, _, run = release
    result = run(py=412, js=41, xdist=True)
    assert result.returncode == 0, result.stdout + result.stderr
    [r] = reports(root)
    assert r['tests']['python_s'] in (412, 413) and r['tests']['js_s'] in (41, 42), r
    assert r['tests']['workers'] == 3 and set(r['tests']) == {'python_s', 'js_s', 'workers'}


def test_tests_run_in_one_process_without_xdist(release):
    root, _, run = release
    result = run(py=412, js=41)
    assert result.returncode == 0, result.stdout + result.stderr
    assert re.search(r'pi-hub: Tests passed in 41[23] s \(JS 4[12] s\)\n', result.stdout), result.stdout
    assert 'workers' not in result.stdout
    assert reports(root)[0]['tests']['workers'] == 1
    call = _pytest_call(root)
    assert '-n' not in call and '--dist' not in call
    assert call[-5:] == ['pytest', '-q', '-p', 'no:cacheprovider', 'tests']


def test_parallel_tests_over_budget_still_say_so(release):
    root, _, run = release
    result = run(py=600, js=41, xdist=True)
    assert result.returncode == 0, result.stdout + result.stderr
    said = r'Tests passed in 60[01] s on 3 workers \(JS 4[12] s\), tests over budget \(600 s\)'
    assert re.search(f'pi-hub: {said}\n', result.stdout), result.stdout
