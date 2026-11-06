// A7 P1 on Print, Lists and Drives: each opens on one faceplate, has no old cards, and says unknown (never fine) when
// its source doesn't answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

const chip = (p) => p.querySelector('.ui-faceplate__nameplate .ui-chip');

async function render(file, routes) {
  const dom = install({ fetch: routes });
  globalThis.matchMedia ||= () => ({ matches: false });
  (await import('../hub/static/js/core.js')).forgetMe();
  const m = await import(`../hub/static/js/${file}`);
  const state = { root: dom.root() };
  m.mount(state);
  assert.equal(state.root.querySelectorAll('.ui-faceplate[aria-busy="true"]').length, 1, `${file}: a skeleton faceplate while loading`);
  try { await m.load(state); } catch (e) { m.failed?.(state, e); }
  return { dom, state };
}

function onePlateNoCards(state, name) {
  const plates = state.root.querySelectorAll('.ui-faceplate');
  assert.equal(plates.length, 1, `${name}: one faceplate`);
  assert.equal(state.root.querySelectorAll('.card').length, 0, `${name}: no old cards`);
  assert.doesNotMatch(text(state.root), /\bnull\b|undefined|NaN/, `${name}: no stray values`);
  return plates[0];
}

const PRINT = { printer: { state: 'Ready' }, ink: [{ name: 'Black', level: 10 }, { name: 'Colour', level: 60 }],
  jobs: { waiting: [{ id: 'j1', number: 7, when: 'just now' }], done: [{ id: 'j0', number: 6, when: 'today' }] } };

test('Print: the printer is the faceplate, with its ink and Scan; the queue rows are lamp-right rows', async () => {
  const { dom, state } = await render('print.js', { '/api/print': PRINT });
  try {
    const plate = onePlateNoCards(state, 'Print');
    assert.equal(chip(plate).className, 'ui-chip ui-chip--ok');
    assert.equal(text(plate.querySelector('.ui-readout')), '1 waiting to print');
    assert.equal(text(chip(plate)), 'Ready');
    assert.match(text(plate), /Ink is low/);
    assert.equal(plate.querySelectorAll('[role="meter"]').length, 2);
    assert.match(text(plate.querySelector('.ui-faceplate__actions')), /Scan a document/);
    const rows = state.root.querySelectorAll('.print-queue .ui-row');
    assert.deepEqual(rows.map((r) => text(r.querySelector('.ui-row__title'))), ['Job 7', 'Job 6']);
    assert.ok(!rows[0].querySelector('.ui-chip'), 'a waiting job is neutral, not a warning');
    assert.equal(text(rows[0].querySelector('button')), 'Cancel');
  } finally { dom.uninstall(); }
});

test('Print: a printer that is off lights bad; no answer is unknown', async () => {
  const dom = install();
  try {
    const { printerPlate } = await import('../hub/static/js/print.js');
    assert.equal(chip(printerPlate({ printer: { state: 'Offline' }, jobs: { waiting: [] } })).className, 'ui-chip ui-chip--bad');
    assert.equal(chip(printerPlate(null)).className, 'ui-chip ui-chip--unknown');
  } finally { dom.uninstall(); }
  const down = await render('print.js', {});
  try {
    assert.equal(chip(down.state.root.querySelector('.ui-faceplate')).className, 'ui-chip ui-chip--unknown');
  } finally { down.dom.uninstall(); }
});

const LISTS = {
  shopping: { name: 'Shopping', items: [{ id: 1, text: 'Milk' }, { id: 2, text: 'Eggs', done: true }] },
  todo: { name: 'To do', items: [{ id: 3, text: 'Bins', due: 2000000000 }] },
  notes: { name: 'Notes', items: [] },
};

test('Lists: the faceplate counts what is to buy and to do, with no lamp; the list is not a card', async () => {
  const { dom, state } = await render('lists.js', { '/api/lists': LISTS });
  try {
    const plate = onePlateNoCards(state, 'Lists');
    assert.ok(!chip(plate));
    assert.equal(text(plate.querySelector('.ui-readout')), '1 to buy');
    const dd = plate.querySelectorAll('dd').map(text);
    assert.equal(dd[0], '1');
    assert.equal(dd.length, 3, 'the next reminder shows when there is one');
    const { listsPlate } = await import('../hub/static/js/lists.js');
    assert.equal(listsPlate({ shopping: { items: [] }, todo: { items: [] }, notes: { items: [] } }).querySelectorAll('dd').length, 2);
  } finally { dom.uninstall(); }
  const down = await render('lists.js', {});
  try {
    assert.equal(chip(down.state.root.querySelector('.ui-faceplate')).className, 'ui-chip ui-chip--unknown');
  } finally { down.dom.uninstall(); }
});

const DRIVES = { ok: true, drives: [
  { is_movies: true, model: 'WD Elements', size: 5e12, mounted: true, smart: { passed: true, reallocated: 0, pending: 0, hours: 100 } },
  { is_movies: false, model: 'Stick', size: 3.2e10, mounted: true, smart: null },
], mirror: { state: 'ok', last_ok: Math.floor(Date.now() / 1000) - 3600, count: 120, source_count: 121, share: true } };

test('Drives: the faceplate is the worst of the drives and the copy; a drive that hides its health is unknown', async () => {
  const { dom, state } = await render('drives.js', { '/api/drives': DRIVES, '/api/me': { role: 'owner' } });
  try {
    const plate = onePlateNoCards(state, 'Drives');
    assert.equal(text(plate.querySelector('.ui-readout')), '2 drives connected');
    assert.equal(chip(plate).className, 'ui-chip ui-chip--unknown', 'the stick reports no health: not "all healthy"');
    assert.deepEqual(state.root.querySelectorAll('.ui-section').filter((n) => !n.classList.contains('needs-here')).map((n) => text(n.querySelector('h2'))), ['Movies drive', 'Other drive', 'Copy from the Windows PC']);
    const { drivesPlate } = await import('../hub/static/js/drives.js');
    assert.equal(chip(drivesPlate({ ...DRIVES, drives: [DRIVES.drives[0]] })).className, 'ui-chip ui-chip--ok');
    assert.equal(chip(drivesPlate({ ...DRIVES, mirror: { state: 'failed' } })).className, 'ui-chip ui-chip--bad');
    assert.equal(chip(drivesPlate({ ok: true, drives: [], mirror: {} })).className, 'ui-chip ui-chip--bad');
    assert.equal(chip(drivesPlate(null)).className, 'ui-chip ui-chip--unknown');
  } finally { dom.uninstall(); }
});

test('Drives: signed out, the faceplate asks to sign in and shows nothing else', async () => {
  const { dom, state } = await render('drives.js', { '/api/me': { role: 'guest' } });
  try {
    const plate = onePlateNoCards(state, 'Drives');
    assert.equal(chip(plate).className, 'ui-chip ui-chip--unknown');
    assert.equal(text(plate.querySelector('button')), 'Sign in');
    assert.equal(state.root.querySelectorAll('.ui-section').filter((n) => !n.classList.contains('needs-here')).length, 0);
  } finally { dom.uninstall(); }
});
