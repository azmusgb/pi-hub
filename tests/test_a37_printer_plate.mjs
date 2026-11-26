// A37 R4: on a page with a sentence the faceplate is the plate: nameplate and lamp, the job and its age, the meter,
// the readings and the actions. The head says the number, so nothing it says is drawn again as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

const live = () => ({ status: 'live', source: 'Bambuddy', observed_at: new Date(Date.now() - 20000).toISOString() });
const printing = (over = {}) => ({ state: 'printing', progress: 45, percent: 45, left: '6 h 16 min', minutes_left: 376, job_name: 'Clip.gcode.3mf',
  detail: 'Layer 506 / 1306', layer_num: 506, total_layers: 1306, nozzle_temp: 220, nozzle_target: 220, bed_temp: 60, bed_target: 60,
  as_of: Date.now() / 1000 - 20, actions: ['pause'], telemetry: live(), ...over });
const kits = () => {
  for (const [file, name] of [['needs.js', 'ApplianceNeeds'], ['say.js', 'ApplianceSay']]) {
    const mod = { exports: {} };
    new Function('module', readFileSync(new URL(`../hub/static/ui/${file}`, import.meta.url), 'utf8'))(mod);
    globalThis[name] = mod.exports;
  }
};

test('page-parts: a plate has the kit\'s class, no readout or caption even when given, and the job on the nameplate', async () => {
  const dom = install();
  try {
    const { faceplate } = await import('../hub/static/js/page-parts.js');
    const f = faceplate({ name: 'Bambu X2D', lamp: ['ok', 'Printing', true], plate: true, job: 'Clip, checked 20s ago', readout: '45', unit: '%', caption: 'Done soon.' });
    assert.equal(f.className, 'ui-faceplate ui-faceplate--plate');
    assert.equal(f.querySelector('.ui-readout'), null);
    assert.equal(f.querySelector('.ui-faceplate__caption'), null);
    assert.equal(text(f.querySelector('.ui-faceplate__nameplate .ui-faceplate__job')), 'Clip, checked 20s ago');
    const withAside = faceplate({ name: 'Bambu X2D', plate: true, aside: dom.document.createElement('div') });
    assert.equal(withAside.className, 'ui-faceplate ui-faceplate--aside ui-faceplate--plate');
    assert.equal(withAside.querySelector('.ui-faceplate__job'), null, 'no job, no empty line');
    const old = faceplate({ name: 'Internet', readout: '9.3', unit: 'ms', caption: 'Out.' });
    assert.equal(old.className, 'ui-faceplate');
    assert.ok(old.querySelector('.ui-readout') && old.querySelector('.ui-faceplate__caption'), 'a page that has not moved is unchanged');
  } finally { dom.uninstall(); }
});

test('printing: the job and its age on one line, the kit\'s meter, and nothing the sentence says drawn again', async () => {
  const dom = install();
  try {
    const { printerPlate } = await import('../hub/static/js/workshop.js');
    const p = printerPlate(printing(), { ok: true, source: 'Pi' });
    assert.ok(p.classList.contains('ui-faceplate--plate'));
    assert.equal(text(p.querySelector('.ui-faceplate__job')), 'Clip · Bambuddy · checked 20s ago');
    const meter = p.querySelector('.ui-meter');
    assert.equal(meter.getAttribute('role'), 'progressbar');
    assert.equal(meter.getAttribute('aria-valuenow'), '45');
    assert.equal(meter.getAttribute('aria-label'), 'Print progress');
    assert.match(meter.querySelector('i').style.cssText, /width:45%/);
    assert.equal(p.querySelector('.line'), null, 'the old bar is gone');
    const words = text(p.querySelector('.ui-faceplate__main'));
    assert.doesNotMatch(words, /45\s*%/, 'the percentage is the head\'s');
    assert.doesNotMatch(words, /Done in about|6 h 16 min/, 'the estimate is the head\'s');
    assert.ok(!p.querySelectorAll('dt').map(text).includes('Print'), 'the job is not also a reading');
    assert.ok(p.querySelectorAll('dt').map(text).includes('Layer'));
  } finally { dom.uninstall(); }
});

test('a percent the card does not know draws no meter; progress 0 beside it is not a reading', async () => {
  const dom = install();
  try {
    const { printerPlate } = await import('../hub/static/js/workshop.js');
    assert.equal(printerPlate(printing({ percent: null, progress: 0 }), null).querySelector('.ui-meter'), null);
    assert.equal(printerPlate(printing({ percent: 0, progress: 0 }), null).querySelector('.ui-meter').getAttribute('aria-valuenow'), '0');
    assert.equal(printerPlate({ state: 'idle', percent: null, progress: 0, telemetry: live() }, null).querySelector('.ui-meter'), null);
  } finally { dom.uninstall(); }
});

test('not printing: the card\'s own line is kept under the nameplate, and the job line is the source and its age', async () => {
  const dom = install();
  try {
    const { printerPlate } = await import('../hub/static/js/workshop.js');
    const idle = printerPlate({ state: 'idle', percent: null, detail: 'Ready for the next print.', telemetry: live() }, null);
    assert.equal(text(idle.querySelector('.ui-faceplate__job')), 'Bambuddy · checked 20s ago');
    assert.equal(text(idle.querySelector('.ws-detail')), 'Ready for the next print.');
    const stale = printerPlate(printing({ stale: true, detail: 'Bambuddy not answering since 15:06; last read 12 min ago.', telemetry: { ...live(), status: 'stale' } }), null);
    assert.equal(stale.querySelector('.ws-detail'), null, 'the head already says the source stopped answering');
    assert.match(text(stale.querySelector('.ui-faceplate__job')), /last seen/);
  } finally { dom.uninstall(); }
});

test('the page: load() says the reading in the head, and a failed status keeps the last reading in the past tense', async () => {
  const dom = install({ fetch: { '/api/workshop': { printer: printing(), prints: [], prints_available: true, week: { finished: 0, hours: 0 }, spools: [], queue: [], ams_trays: [], lab: null, filament_month: {} } } });
  try {
    kits();
    const parts = await import('../hub/static/js/page-parts.js');
    const ws = await import('../hub/static/js/workshop.js');
    assert.equal(ws.says, true);
    const header = dom.document.createElement('header');
    const h1 = Object.assign(dom.document.createElement('h1'), { id: 'page-title', className: 'brand' });
    header.append(h1);
    dom.document.body.append(header);
    parts.pageHead(h1, null, { label: 'Printer', says: true });
    const state = { root: dom.root() };
    ws.mount(state);
    assert.equal(h1.getAttribute('aria-busy'), 'true', 'loading until the first answer');
    await ws.load(state);
    const said = () => h1.querySelectorAll('.ui-say__s').map(text);
    assert.equal(said()[0], 'The X2D is 45% through Clip.');
    assert.match(said()[1], /^About 6 h 16 min left, done around /);
    assert.equal(text(h1.querySelector('.ui-vh')), 'Printer:');
    ws.failed(state);
    assert.match(said()[0], /^The X2D was 45% through Clip /, 'past tense, never the last live sentence');
    assert.match(said()[1], /^Pi Hub hasn't answered since /);
    const plate = state.root.querySelector('.ui-faceplate');
    assert.equal(text(plate.querySelector('.ui-chip')), 'No answer');
    assert.equal(plate.querySelector('.ui-readout'), null, 'no dash standing in for a number');
    ws.leave(state);
  } finally { delete globalThis.ApplianceSay; delete globalThis.ApplianceNeeds; dom.uninstall(); }
});

test('the page: a status that never answered says the printer isn\'t answering, not a skeleton forever', async () => {
  const dom = install();
  try {
    kits();
    const parts = await import('../hub/static/js/page-parts.js');
    const ws = await import('../hub/static/js/workshop.js');
    const h1 = Object.assign(dom.document.createElement('h1'), { id: 'page-title', className: 'brand' });
    dom.document.body.append(h1);
    parts.pageHead(h1, null, { label: 'Printer', says: true });
    const state = { root: dom.root() };
    ws.mount(state);
    ws.failed(state);
    assert.deepEqual(h1.querySelectorAll('.ui-say__s').map(text), ["The X2D isn't answering."]);
    assert.equal(h1.getAttribute('aria-busy'), null);
    ws.leave(state);
  } finally { delete globalThis.ApplianceSay; delete globalThis.ApplianceNeeds; dom.uninstall(); }
});
