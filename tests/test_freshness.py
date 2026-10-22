import os

os.environ['HUB_NO_SAMPLER'] = '1'

import pytest
from fastapi.testclient import TestClient
from hub import actions, freshness, sources, system, homecontrol
from hub import app as hub_app


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setenv('HUB_DB', str(tmp_path / 'hub.db'))
    monkeypatch.setattr(freshness, '_readings', {})
    monkeypatch.setattr(sources, '_cache', {})


def row(key='pi'):
    return next(r for r in freshness.snapshot()['readings'] if r['key'] == key)


def test_failed_refresh_keeps_only_a_display_reading_not_live_data(monkeypatch):
    clock = [1000]
    monkeypatch.setattr(freshness.time, 'time', lambda: clock[0])
    assert sources.cached('pi', 10, lambda: {'pi_temp': 51, 'drive_state': 'Connected', 'secret': 'NEVER-EXPOSE'})
    assert row()['state'] == 'current'
    clock[0] = 1011
    assert row()['state'] == 'stale'
    # A cached response does not advance its original confirmation time.
    clock[0] = 1005
    sources.cached('pi', 10, lambda: pytest.fail('Cache should be used'))
    assert row()['confirmed_at'] == 1000
    clock[0] = 1011
    def fail():
        raise OSError('NEVER-EXPOSE')
    assert sources.cached('pi', 10, fail) is None
    reading = row()
    assert reading['state'] == 'unavailable'
    assert reading['confirmed_at'] == 1000 and reading['checked_at'] == 1011
    assert '51' in reading['reading'] and 'NEVER-EXPOSE' not in str(freshness.snapshot())
    clock[0] = 1022
    sources.cached('pi', 10, lambda: {'pi_temp': 49, 'drive_state': 'Missing'})
    assert row()['state'] == 'current' and row()['confirmed_at'] == 1022
    assert 'Missing' in row()['reading']


def test_empty_responses_are_confirmed_and_failed_observations_still_raise():
    assert freshness.observe('home', 20, lambda: []) == []
    assert row('home')['state'] == 'current'
    with pytest.raises(OSError):
        freshness.observe('home', 20, lambda: (_ for _ in ()).throw(OSError('offline')))
    assert row('home')['state'] == 'unavailable'
    assert row('home')['reading'] == '0 controllable devices'


def test_unconfigured_sources_hide_old_readings_and_endpoint_does_not_poll(monkeypatch):
    freshness.record('home', 20, [{'name': 'SECRET'}])
    monkeypatch.setattr(hub_app.auth, 'get', lambda key, *args: None)
    monkeypatch.setattr(sources, 'pi_status', lambda: pytest.fail('Freshness must not poll'))
    response = TestClient(hub_app.app).get('/api/freshness')
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    home = next(r for r in response.json()['readings'] if r['key'] == 'home')
    assert home['state'] == 'not_configured' and home['reading'] is None
    assert 'SECRET' not in response.text


@pytest.mark.parametrize('name', ['restart:plex', 'remount:movies'])
def test_movie_recovery_requires_both_real_mount_and_direct_plex_response(monkeypatch, name):
    monkeypatch.setattr(system, 'movies_mounted', lambda: False)
    monkeypatch.setattr(sources, '_plex_sessions', lambda: pytest.fail('No mount'))
    assert actions.verify(name)['state'] == 'needs_attention'
    monkeypatch.setattr(system, 'movies_mounted', lambda: True)
    sources._cache['plex'] = (10**12, [{'old': True}])
    monkeypatch.setattr(sources, '_plex_sessions', lambda: (_ for _ in ()).throw(OSError()))
    assert actions.verify(name)['state'] == 'unavailable'
    monkeypatch.setattr(sources, '_plex_sessions', lambda: [])
    result = actions.verify(name)
    assert result['state'] == 'recovered'
    assert 'TV' in result['next_step']


def test_homebridge_recovery_distinguishes_setup_empty_and_responsive(monkeypatch):
    def not_connected():
        raise homecontrol.NotConnected('Update the login in Settings.')
    monkeypatch.setattr(homecontrol, 'accessories', not_connected)
    assert actions.verify('restart:homebridge')['state'] == 'needs_setup'
    monkeypatch.setattr(homecontrol, 'accessories', lambda: [])
    assert actions.verify('restart:homebridge')['state'] == 'needs_attention'
    monkeypatch.setattr(homecontrol, 'accessories', lambda: [{'name': 'Lamp'}])
    assert actions.verify('restart:homebridge')['state'] == 'recovered'


def test_verification_requires_access_and_never_repeats_the_action(monkeypatch):
    client = TestClient(hub_app.app)
    monkeypatch.setattr(actions, 'helper', lambda *args, **kw: pytest.fail('Must not run a fix'))
    assert client.get('/api/actions/restart:plex/verification').status_code == 401
    monkeypatch.setattr(hub_app, 'need', lambda *args: ('household', 'test'))
    monkeypatch.setattr(system, 'movies_mounted', lambda: False)
    assert client.get('/api/actions/remount:movies/verification').json()['state'] == 'needs_attention'
    assert client.get('/api/actions/unknown/verification').status_code == 400
    assert client.get('/api/actions/restart:pi/verification').json()['state'] == 'not_supported'


def test_mount_verification_rejects_automount_and_accepts_real_filesystem(monkeypatch):
    from io import StringIO
    monkeypatch.setattr('builtins.open', lambda *a: StringIO('systemd-1 /mnt/usb1 autofs rw 0 0\n'))
    assert not system.movies_mounted()
    monkeypatch.setattr('builtins.open', lambda *a: StringIO('/dev/sda1 /mnt/usb1 ext4 rw 0 0\n'))
    assert system.movies_mounted()


def test_missing_telemetry_is_not_reported_as_a_stopped_service():
    from hub import now
    data = now.build({}, None, {}, None)
    assert data['summary'] != "Everything's running"
    assert not any(issue.get('fix') for issue in data['issues'])
    assert data['workshop']['ai'] == 'Unknown'
    assert 'does not confirm' in data['issues'][0]['say']
