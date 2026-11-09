// A7 P1 on System's pages: Health, Backups, Versions, Alerts and the Site map each open on one faceplate, have no old
// cards, and say unknown (never fine) when their source doesn't answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

const chip = (p) => p.querySelector('.ui-faceplate__nameplate .ui-chip');

async function render(file, routes, path) {
  const dom = install({ fetch: routes });
  dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
  const m = await import(`../hub/static/js/${file}`);
  const state = { root: dom.root(), context: new URLSearchParams(''), path };
  m.mount(state);
  assert.equal(state.root.querySelectorAll('.ui-faceplate[aria-busy="true"]').length, 1, `${file}: a skeleton faceplate while loading`);
  await m.load(state);
  return { dom, state };
}

function onePlateNoCards(state, name) {
  const plates = state.root.querySelectorAll('.ui-faceplate');
  assert.equal(plates.length, 1, `${name}: one faceplate`);
  assert.equal(state.root.querySelectorAll('.card').length, 0, `${name}: no old cards`);
  assert.doesNotMatch(text(state.root), /\bnull\b|undefined|NaN/, `${name}: no stray values`);
  return plates[0];
}

const PI = {
  selfcheck: { checks: [{ ok: true, name: 'disk' }, { ok: false, name: 'Backups', detail: 'Last night’s backup is missing' }], total: 2, failed: 1, passed: false, ts: 1 },
  outages: [], services: [{ name: 'pi-hub', state: 'active' }, { name: 'plex', state: 'failed' }],
  storage: [{ name: 'USB', mounted: true, used_pct: 40, free_gb: 1, total_gb: 2 }],
  health: { temp: 82.4, uptime_h: 30, power: 'Good' }, history: [], live: {}, network: {},
};

test('Health: the self-check is the faceplate; a failed check and a failed service are lamp rows in it', async () => {
  const { dom, state } = await render('health.js', { '/api/pi': PI, '/api/actions': { actions: [], log: [], updates: {} }, '/api/records': { records: [] } }, '/system');
  try {
    const plate = onePlateNoCards(state, 'Health');
    assert.ok(state.root.children[1].contains(plate), 'the faceplate comes first, after the hidden fix notice');
    assert.equal(chip(plate).className, 'ui-chip ui-chip--bad');
    assert.equal(text(chip(plate)), '1 failed');
    assert.match(text(plate.querySelector('.ui-readout')), /^1 of 2/);
    assert.deepEqual(plate.querySelectorAll('.ui-row__title').map(text), ['Backups', 'plex']);
    assert.ok(plate.querySelectorAll('dd').map(text).includes('82 °C'));
    assert.ok(state.root.querySelector('[data-health="disks"]').classList.contains('ui-section'));
  } finally { dom.uninstall(); }
});

test('Health: no self-check yet is unknown, and a failed service still lights it', async () => {
  const dom = install();
  try {
    const { healthPlate } = await import('../hub/static/js/health.js');
    assert.equal(chip(healthPlate(null, [])).className, 'ui-chip ui-chip--unknown');
    assert.equal(text(chip(healthPlate(null, [{ name: 'plex', state: 'failed' }]))), '1 service failed');
    const ok = healthPlate({ checks: [], total: 30, failed: 0, passed: true, ts: 1 }, [{ name: 'a', state: 'active' }], {});
    assert.equal(chip(ok).className, 'ui-chip ui-chip--ok');
    assert.equal(ok.querySelectorAll('dd').length, 0, 'no temperature or uptime read: neither is shown');
  } finally { dom.uninstall(); }
});

test('Backups: the faceplate counts the repositories up to date; one behind is a warning; no answer is unknown', async () => {
  const backups = { available: true, repos: [{ name: 'Pi', hours: 5 }, { name: 'Mac', hours: 50 }, { name: 'PC', hours: null }] };
  const { dom, state } = await render('backups.js', { '/api/system/backups': backups }, '/backups');
  try {
    const plate = onePlateNoCards(state, 'Backups');
    assert.equal(text(plate.querySelector('.ui-readout')), '1 of 3 up to date');
    assert.equal(chip(plate).className, 'ui-chip ui-chip--warn');
    assert.deepEqual(state.root.querySelectorAll('.ui-row__title').map(text), ['The Pi', 'The Mac', 'PC']);
    assert.deepEqual(state.root.querySelectorAll('.ui-rows .ui-chip').map(text), ['OK', 'Behind', 'None']);
    const { backupsPlate } = await import('../hub/static/js/backups.js');
    assert.equal(chip(backupsPlate(null)).className, 'ui-chip ui-chip--unknown');
    assert.equal(chip(backupsPlate({ available: true, repos: [] })).className, 'ui-chip ui-chip--warn');
  } finally { dom.uninstall(); }
});

test('Versions: the faceplate counts the parts live; a drifted part needs a look; unreadable records are unknown', async () => {
  const records = { records: [
    { id: 'release:pi-hub', state: 'live', detail: { target: 'pi-hub', label: 'Pi Hub', commit: 'a'.repeat(40), last: { result: 'deployed' } } },
    { id: 'release:localai', state: 'drifted', headline: 'Running something else', detail: { target: 'localai', label: 'Local AI', commit: 'b'.repeat(40), last: { result: 'deployed' } } },
    { id: 'release:netmon', state: 'unknown', detail: { target: 'netmon', label: 'netmon' } },
  ] };
  const { dom, state } = await render('versions.js', { '/api/records': records, '/api/whoami': { role: 'household' } }, '/versions');
  try {
    const plate = onePlateNoCards(state, 'Versions');
    assert.equal(text(plate.querySelector('.ui-readout')), '1 of 2 live');
    assert.equal(chip(plate).className, 'ui-chip ui-chip--warn');
    assert.deepEqual(state.root.querySelectorAll('[data-target] .ui-chip').map(text), ['Live', 'Drifted', 'Unknown']);
    const { versionsPlate } = await import('../hub/static/js/versions.js');
    assert.equal(chip(versionsPlate(null)).className, 'ui-chip ui-chip--unknown');
    assert.equal(chip(versionsPlate([])).className, 'ui-chip ui-chip--unknown');
  } finally { dom.uninstall(); }
});

test('Alerts: the faceplate counts what is still open, lit by the worst; no answer is unknown, not "all clear"', async () => {
  const now = Math.floor(Date.now() / 1000);
  const alerts = { alerts: [
    { ts: now - 60, title: 'Plex stopped', tag: 'rotating_light', cause: 'plex', side: 'problem' },
    { ts: now - 120, title: 'Print finished', tag: 'tada' },
  ] };
  const { dom, state } = await render('alerts.js', { '/api/alerts': alerts }, '/alerts');
  try {
    const plate = onePlateNoCards(state, 'Alerts');
    assert.equal(text(plate.querySelector('.ui-readout')), '1 still open');
    assert.equal(chip(plate).className, 'ui-chip ui-chip--bad');
  } finally { dom.uninstall(); }
  const down = await render('alerts.js', {}, '/alerts');
  try {
    assert.equal(chip(down.state.root.querySelector('.ui-faceplate')).className, 'ui-chip ui-chip--unknown');
  } finally { down.dom.uninstall(); }
});

test('Alerts: a cause still open across several days counts once, and so does one over across several days', async () => {
  const now = Math.floor(Date.now() / 1000), day = 86400;
  const alerts = { alerts: [
    { ts: now - 60, title: 'Workshop display went offline', tag: 'warning', cause: 'display', side: 'problem' },
    { ts: now - 2 * day, title: 'Workshop display is back', tag: 'white_check_mark', cause: 'display', side: 'recovery' },
    { ts: now - 2 * day - 600, title: 'Workshop display went offline', tag: 'warning', cause: 'display', side: 'problem' },
    { ts: now - 3 * day, title: 'Workshop display went offline', tag: 'warning', cause: 'display', side: 'problem' },
    { ts: now - 120, title: 'Plex is running again', tag: 'white_check_mark', cause: 'plex', side: 'recovery' },
    { ts: now - 3 * day - 60, title: 'Plex stopped', tag: 'rotating_light', cause: 'plex', side: 'problem' },
  ] };
  const { dom, state } = await render('alerts.js', { '/api/alerts': alerts }, '/alerts');
  try {
    const plate = onePlateNoCards(state, 'Alerts');
    assert.equal(text(plate.querySelector('.ui-readout')), '1 still open');
    assert.match(text(plate), /1 over or fine/);
  } finally { dom.uninstall(); }
});

test('Site map: one faceplate counting the pages, with no lamp', async () => {
  const dom = install();
  try {
    const m = await import('../hub/static/js/map.js');
    const state = { root: dom.root() };
    m.mount(state);
    const plate = onePlateNoCards(state, 'Site map');
    assert.ok(!chip(plate), 'no state of its own');
    assert.match(text(plate.querySelector('.ui-readout')), /^\d+ pages$/);
  } finally { dom.uninstall(); }
});

test("a section's lamp badges its More item, as a card's pill did", async () => {
  const dom = install();
  try {
    const { moreList } = await import('../hub/static/js/section-links.js');
    const { section } = await import('../hub/static/js/page-parts.js');
    const list = moreList({ storeKey: 'k-lamp', title: 'More', items: [['a', 'Outages']], alerts: ['a'] });
    list.fill('a', [section('Outages', [], { lamp: ['warn', '2 in 30 days'] })]);
    assert.equal(text(list.root.querySelector('.more-badge')), 'Check');
  } finally { dom.uninstall(); }
});
