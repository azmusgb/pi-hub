// A7 H3b: Devices and Media drawn as one page (P1 faceplate, P8 honest states), and a hidden section stays hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

const acc = (id, kind, on) => ({ id, name: id, kind, on, control: 'On', room: 'Living room' });

test('Devices: the faceplate counts what is on; a device with no answer is counted apart, never as off', async () => {
  const dom = install();
  try {
    const { devicesPlate } = await import('../hub/static/js/control.js');
    const p = devicesPlate({ connected: true, accessories: [acc('a', 'light', true), acc('b', 'light', false), acc('c', 'plug', null)] });
    assert.equal(text(p.querySelector('.ui-readout')), '1 on');
    assert.equal(p.querySelector('.ui-chip').className, 'ui-chip ui-chip--warn');
    assert.equal(text(p.querySelector('.ui-chip')), '1 not answering');
    assert.deepEqual(p.querySelectorAll('dt').map(text), ['Lights'], 'a kind with only silent devices has no reading');
    const all = devicesPlate({ connected: true, accessories: [acc('a', 'light', true)] });
    assert.equal(all.querySelector('.ui-chip').className, 'ui-chip ui-chip--ok');
    const off = devicesPlate({ connected: false, message: 'Homebridge is off.' });
    assert.equal(text(off.querySelector('.ui-readout')), '—');
    assert.equal(text(off.querySelector('.ui-faceplate__caption')), 'Homebridge is off.');
    assert.equal(off.querySelector('a').getAttribute('href'), '/settings#group-home');
  } finally { dom.uninstall(); }
});

test('Devices: sources say Homebridge and, when set up, laundry; more than six sections fold under More', async () => {
  const dom = install();
  try {
    const { devicesSources, capSections } = await import('../hub/static/js/control.js');
    assert.deepEqual(devicesSources({ connected: true }, { configured: false }).map((s) => s.name), ['Homebridge']);
    assert.deepEqual(devicesSources({ connected: false }, { configured: true, available: false }).map((s) => s.tone), ['bad', 'bad']);
    const six = Array.from({ length: 6 }, () => dom.document.createElement('section'));
    assert.equal(capSections(six).length, 6);
    const eight = capSections(Array.from({ length: 8 }, () => dom.document.createElement('section')));
    assert.equal(eight.length, 6);
    assert.equal(eight[5].tagName.toLowerCase(), 'details');
    assert.equal(eight[5].querySelectorAll('section').length, 3);
  } finally { dom.uninstall(); }
});

test('Media: Plex not answering, the drive missing, playing and ready each show on the lamp and the sources line', async () => {
  const dom = install();
  try {
    const { mediaPlate } = await import('../hub/static/js/movies.js');
    const drive = { state: 'Connected', count: 1240, free: '1.2 TB' };
    const playing = mediaPlate({ playing: [{ title: 'Arrival', device: 'TV' }], drive });
    assert.equal(playing.plate.querySelector('.ui-chip').className, 'ui-chip ui-chip--ok ui-chip--live');
    assert.equal(text(playing.plate.querySelector('.ui-faceplate__caption')), 'Playing Arrival on TV.');
    assert.equal(text(playing.plate.querySelector('.ui-readout')), `${(1240).toLocaleString()} movies`);
    assert.equal(text(mediaPlate({ playing: [], drive }).plate.querySelector('.ui-chip')), 'Ready');
    const down = mediaPlate({ playing: null, drive });
    assert.equal(down.plate.querySelector('.ui-chip').className, 'ui-chip ui-chip--bad');
    assert.deepEqual(down.sources.map((s) => s.tone), ['bad', 'ok']);
    const missing = mediaPlate({ playing: [], drive: { state: 'Missing' } });
    assert.equal(text(missing.plate.querySelector('.ui-chip')), 'Drive missing');
    assert.equal(text(missing.plate.querySelector('.ui-readout')), '—');
    const unknown = mediaPlate({ playing: [], drive: {} });
    assert.equal(unknown.plate.querySelector('.ui-chip').className, 'ui-chip ui-chip--unknown');
    const failed = mediaPlate(null, { onRetry: () => {} });
    assert.equal(text(failed.plate.querySelector('button')), 'Try again');
    assert.equal(failed.sources[0].tone, 'unknown');
  } finally { dom.uninstall(); }
});

test('a hidden ui-section is not drawn: the kit\'s grid display must not beat the hidden attribute', () => {
  const css = readFileSync(new URL('../hub/static/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.ui-section\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

test('Movie night is a section, with no all-caps kicker or marketing headline (A7 P1)', () => {
  const js = readFileSync(new URL('../hub/static/js/movie-night.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /A GOOD NIGHT STARTS HERE|Everyone gets a say|card\(/);
});
