// A19 P5: the 2D layer inspector. Pure parts (colours, fit, figures, drawing calls), then the inspector through the fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';
import * as ql from '../hub/static/js/quick-layers.js';

const LAYERS = [
  { i: 0, z: 0.2, extrusion_mm: 1200.4, travel_mm: 80, filament_mm: 40, features: ['Outer wall', 'Sparse infill'], speed: [50, 200] },
  { i: 1, z: 0.4, extrusion_mm: 900, travel_mm: 12, filament_mm: 30, features: ['Outer wall', 'Top surface'], speed: null },
];

test('featureOrder is the file\'s first-seen order, so a feature keeps its colour', () => {
  assert.deepEqual(ql.featureOrder(LAYERS), ['Outer wall', 'Sparse infill', 'Top surface']);
  assert.deepEqual(ql.featureOrder(null), []);
  assert.notEqual(ql.featureColor(0, false), ql.featureColor(1, false));
  assert.equal(ql.featureColor(0, true), ql.featureColor(ql.HUES.length, true));
});

test('speedColor clamps and never throws', () => {
  assert.equal(ql.speedColor(-3, false), ql.speedColor(0, false));
  assert.equal(ql.speedColor(9, true), ql.speedColor(1, true));
  assert.match(ql.speedColor(NaN, false), /^hsl/);
});

test('fit centres the bounds, flips Y, and refuses a bad box', () => {
  const f = ql.fit([0, 0, 100, 50], 220, 120, 10);
  assert.equal(f.scale, 2);
  assert.equal(f.px(0), 10); assert.equal(f.px(100), 210);
  assert.ok(f.py(0) > f.py(50));  // up is up
  assert.equal(ql.fit(null, 100, 100), null);
  assert.equal(ql.fit([0, 0, 1, 1], 10, 10, 20), null);
  assert.equal(ql.fit([0, 0, 1, 1], 0, 100), null);
  assert.ok(ql.fit([5, 5, 5, 5], 100, 100));  // a single point still fits
});

test('figures say what the file says and name what it doesn\'t', () => {
  const rows = ql.figures(LAYERS[0], 2);
  const by = Object.fromEntries(rows.map((r) => [r.title, r.value]));
  assert.equal(by.Layer, '1 of 2');
  assert.equal(by['Printed path'], '1.20 m');
  assert.equal(by.Speed, '50 to 200 mm/s');
  assert.equal(by.Seam, 'Not read from the file');
  assert.equal(ql.figures(LAYERS[1], 2).find((r) => r.title === 'Speed').value, 'Not read from the file');
  assert.deepEqual(ql.figures(null, 0), []);
  assert.equal(ql.mm(NaN), 'Not reported');
});

function ctxSpy() {
  const calls = [];
  const c = new Proxy({}, { get: (_, k) => k === 'calls' ? calls : (...a) => calls.push([k, ...a]), set: (_, k, v) => { calls.push(['set', k, v]); return true; } });
  return c;
}
const GEO = { i: 0, z: 0.2, extrusion: [{ f: 'Outer wall', s: 100, p: [0, 0, 10, 0, 10, 10] }, { f: 'Sparse infill', s: 200, p: [1, 1, 2, 2] }], travel: [[0, 0, 5, 5]] };
const view = (o = {}) => ({ fit: ql.fit([0, 0, 10, 10], 100, 100), dark: false, colours: new Map([['Outer wall', 'red']]), by: 'feature', hide: new Set(), travel: false, ink: '#000', muted: '#888', speed: [100, 200], ...o });

test('drawLayer draws each extrusion run, hides toggled features, and draws travel only when asked', () => {
  let c = ctxSpy();
  assert.equal(ql.drawLayer(c, GEO, view(), 100, 100), 2);
  c = ctxSpy();
  assert.equal(ql.drawLayer(c, GEO, view({ hide: new Set(['Outer wall']) }), 100, 100), 1);
  c = ctxSpy();
  assert.equal(ql.drawLayer(c, GEO, view({ travel: true }), 100, 100), 3);
  c = ctxSpy();
  assert.equal(ql.drawLayer(c, null, view(), 100, 100), 0);
  assert.equal(ql.drawLayer(ctxSpy(), GEO, view({ fit: null }), 100, 100), 0);
});

test('drawLayer colours by speed from the layer\'s own range, and unknown speed is muted', () => {
  const c = ctxSpy();
  ql.drawLayer(c, { extrusion: [{ f: 'a', s: null, p: [0, 0, 1, 1] }, { f: 'b', s: 200, p: [0, 0, 1, 1] }], travel: [] }, view({ by: 'speed' }), 100, 100);
  const strokes = c.calls.filter((x) => x[0] === 'set' && x[1] === 'strokeStyle').map((x) => x[2]);
  assert.equal(strokes[0], '#888');
  assert.match(strokes[1], /^hsl/);
});

async function mountInspector(routes, opts = {}) {
  const dom = install({ fetch: routes });
  globalThis.matchMedia ||= () => ({ matches: false });
  (await import('../hub/static/js/core.js')).forgetMe();
  const into = dom.root();
  const insp = ql.layerInspector(into, 'job1', { poll: 5, ...opts });
  return { dom, into, insp };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const READY = { state: 'ready', progress: 1, built: 2, layers: LAYERS, bounds: [0, 0, 10, 10], truncated: null, reason: null };

test('inspector: a ready slice enables the controls and shows the first layer\'s figures', async () => {
  const { dom, into, insp } = await mountInspector({ '/api/quick/jobs/job1/layers': READY, '/api/quick/jobs/job1/layers/0': GEO, '/api/quick/jobs/job1/layers/1': { ...GEO, i: 1 } });
  try {
    await tick();
    const t = text(into);
    assert.match(t, /Layers/);
    assert.match(t, /1 of 2/);
    assert.match(t, /Not read from the file/);
    assert.equal(into.querySelectorAll('input[type="range"]')[0].disabled, false);
    assert.equal(into.querySelectorAll('input[type="checkbox"]').length, 4);  // three features and Travel
    assert.doesNotMatch(t, /\bnull\b|undefined|NaN/);
  } finally { insp.destroy(); dom.restore?.(); }
});

test('inspector: building shows a real fraction and what is read so far; unavailable says why', async () => {
  const { dom, into, insp } = await mountInspector({ '/api/quick/jobs/job1/layers': { ...READY, state: 'building', progress: 0.4, built: 1, layers: [LAYERS[0]] }, '/api/quick/jobs/job1/layers/0': GEO });
  try {
    await tick();
    assert.match(text(into), /40%/);
    assert.equal(into.querySelectorAll('[role="meter"]').length, 1);
  } finally { insp.destroy(); dom.restore?.(); }
  const b = await mountInspector({ '/api/quick/jobs/job1/layers': { state: 'unavailable', reason: 'The file uses absolute extrusion.', layers: [], bounds: null } });
  try {
    await tick();
    assert.match(text(b.into), /Layers unavailable\. The file uses absolute extrusion\./);
    assert.equal(b.into.querySelectorAll('input[type="range"]')[0].disabled, true);
  } finally { b.insp.destroy(); b.dom.restore?.(); }
});

test('inspector: truncation is said, and a hub that doesn\'t answer is said, not shown as empty', async () => {
  const t1 = await mountInspector({ '/api/quick/jobs/job1/layers': { ...READY, truncated: 'Only the first 2 layers are drawn here; the rest is too large to show.' }, '/api/quick/jobs/job1/layers/0': GEO });
  try { await tick(); assert.match(text(t1.into), /Only the first 2 layers/); } finally { t1.insp.destroy(); t1.dom.restore?.(); }
  const t2 = await mountInspector({});
  try { await tick(); assert.match(text(t2.into), /Layers unavailable/); } finally { t2.insp.destroy(); t2.dom.restore?.(); }
});

test('inspector: a layer that fails to load is said on the page', async () => {
  const { dom, into, insp } = await mountInspector({ '/api/quick/jobs/job1/layers': READY });
  try { await tick(); assert.match(text(into), /That layer didn't load/); } finally { insp.destroy(); dom.restore?.(); }
});

test('inspector: destroy stops polling', async () => {
  let n = 0;
  const get = async () => { n++; return { ...READY, state: 'building', progress: 0.1, layers: [], built: 0 }; };
  const dom = install({});
  const into = dom.root();
  const insp = ql.layerInspector(into, 'job1', { poll: 5, get });
  await tick(40);
  insp.destroy();
  const at = n;
  await tick(40);
  assert.equal(n, at);
  assert.ok(at >= 2);
  dom.restore?.();
});
