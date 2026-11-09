// A19 P4: the Quick Print page. Pure parts first (state words, STL facts, settings), then the page through the fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';
import * as q from '../hub/static/js/quick.js';

const stlBinary = (tris) => {
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, k) => dv.setFloat32(84 + 50 * i + 12 + 4 * k, v, true)));
  return buf;
};
const flat = (...v) => v.flat();

test('state words: waiting is neutral, live work is ok and live, needs-you is warn, failure is bad', () => {
  assert.deepEqual(q.stateLamp('queued').slice(0, 2), ['unknown', 'Waiting for the Mac']);
  assert.deepEqual(q.stateLamp('slicing'), ['ok', 'Slicing', true]);
  assert.equal(q.stateLamp('needs_attention')[0], 'warn');
  assert.equal(q.stateLamp('stale')[0], 'warn');
  assert.equal(q.stateLamp('failed')[0], 'bad');
  assert.equal(q.stateLamp('outcome_uncertain')[0], 'bad');
  assert.deepEqual(q.stateLamp('nonsense'), ['unknown', 'Unknown']);
});

test('stlFacts: binary and ascii STL measured; anything else is null, never a guess', () => {
  const b = stlBinary([flat([0, 0, 0], [10, 0, 0], [0, 20, 5])]);
  assert.deepEqual(q.stlFacts(b), { triangles: 1, size: [10, 20, 5] });
  const ascii = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 4 0 0\nvertex 0 3 2\nendloop\nendfacet\nendsolid x\n';
  const a = new TextEncoder().encode(ascii).buffer;
  assert.deepEqual(q.stlFacts(a), { triangles: 1, size: [4, 3, 2] });
  assert.equal(q.stlFacts(new ArrayBuffer(10)), null);
  assert.equal(q.stlFacts(stlBinary([flat([NaN, 0, 0], [1, 0, 0], [0, 1, 0])])), null);
  assert.equal(q.stlFacts(new TextEncoder().encode('PK\u0003\u0004 not an stl at all'.padEnd(120, ' ')).buffer), null);
  assert.equal(q.stlFacts('x'), null);
});

test('bytes and ago', () => {
  assert.equal(q.bytes(512), '512 B');
  assert.equal(q.bytes(2048), '2 kB');
  assert.equal(q.bytes(5 * 1048576), '5.0 MB');
  assert.equal(q.bytes(NaN), '—');
  assert.equal(q.ago(1000, 1030), 'just now');
  assert.equal(q.ago(1000, 1000 + 600), '10 min ago');
  assert.equal(q.ago(undefined), '');
});

test('workerNotice: said for none and asleep, silent when idle or busy', () => {
  assert.equal(q.workerNotice({ state: 'idle' }), null);
  assert.equal(q.workerNotice({ state: 'busy' }), null);
  assert.equal(q.workerNotice(null), null);
});

const SPEC = (k) => q.SETTINGS.find((s) => s.key === k);
test('settings ranges match print-lab', () => {
  assert.deepEqual([SPEC('layer_height').min, SPEC('layer_height').max], [0.08, 0.28]);
  assert.deepEqual([SPEC('wall_loops').min, SPEC('wall_loops').max], [1, 6]);
  assert.deepEqual([SPEC('sparse_infill_density').min, SPEC('sparse_infill_density').max], [0, 90]);
  assert.deepEqual([SPEC('brim_width').min, SPEC('brim_width').max], [1, 10]);
  assert.equal(q.SETTINGS.length, 9);
});

const fakeForm = (vals) => ({ querySelector: (sel) => { const k = sel.replace('#quick-set-', ''); return k in vals ? { value: vals[k] } : null; } });
test('readSettings: only filled values, typed, range-checked', () => {
  assert.deepEqual(q.readSettings(fakeForm({})), { settings: {} });
  assert.deepEqual(q.readSettings(fakeForm({ layer_height: '0.16', wall_loops: '3', enable_support: '1', sparse_infill_pattern: 'gyroid' })),
    { settings: { layer_height: 0.16, wall_loops: 3, enable_support: true, sparse_infill_pattern: 'gyroid' } });
  assert.equal(q.readSettings(fakeForm({ enable_support: '0' })).settings.enable_support, false);
  assert.match(q.readSettings(fakeForm({ layer_height: '0.5' })).error, /Layer height must be from 0.08 to 0.28/);
  assert.match(q.readSettings(fakeForm({ wall_loops: '2.5' })).error, /whole number/);
  assert.match(q.readSettings(fakeForm({ wall_loops: 'abc' })).error, /Walls/);
  assert.deepEqual(q.readSettings(fakeForm({ brim_type: 'no_brim', brim_width: '5' })).settings, { brim_type: 'no_brim' });
});

const JOB = { id: 'aaaa', state: 'sliced', name: 'bracket.stl', model_bytes: 2048, settings: {}, reason: null, updated: 1,
  slice_sha256: 'ab'.repeat(32), slice_info: { minutes: 42.4, grams: 12.5, layers: 100, studio_version: '02.09.01.70' }, file_removed: 0 };

test('modelRows: measured facts say who measured; STL-less says not measured', () => {
  const r = q.modelRows(JOB, { triangles: 12, size: [1, 2, 3] });
  assert.equal(r.length, 4);
  assert.equal(r[1].detail, 'measured here');
  assert.equal(r[3].value, 'Not measured yet');
  assert.match(q.modelRows(JOB, null)[1].detail, /not measured/);
  assert.deepEqual(q.modelRows(null, null), []);
});

async function render(routes) {
  const dom = install({ fetch: routes });
  globalThis.matchMedia ||= () => ({ matches: false });
  globalThis.history ||= { replaceState() {} };
  (await import('../hub/static/js/core.js')).forgetMe();
  const state = { root: dom.root() };
  q.mount(state);
  assert.equal(state.root.querySelectorAll('.ui-faceplate[aria-busy="true"]').length, 1);
  try { await q.load(state); } catch (e) { q.failed(state, e); }
  return { dom, state };
}

test('page: a sliced job shows one faceplate, honest estimates, and Prepare (which starts nothing)', async () => {
  const { dom, state } = await render({ '/api/quick/jobs': { jobs: [JOB] }, '/api/quick/worker': { state: 'idle', text: 'Mac ready' }, '/api/needs': { items: [] } });
  try {
    assert.equal(state.root.querySelectorAll('.ui-faceplate').length, 1);
    const t = text(state.root);
    assert.match(t, /about 42/);
    assert.match(t, /about 12.5 g/);
    assert.match(t, /Slice again/);
    assert.match(t, /does not start the printer/);
    assert.doesNotMatch(t, /\bnull\b|undefined|NaN/);
    assert.equal(state.root.querySelectorAll('#quick-print-section button[disabled]').length, 0);
    assert.deepEqual(state.root.querySelectorAll('#quick-print-section button').map(text), ['Prepare to print']);
  } finally { dom.restore?.(); }
});

test('page: no jobs is an honest empty page; a silent worker is said, not hidden', async () => {
  const { dom, state } = await render({ '/api/quick/jobs': { jobs: [] }, '/api/quick/worker': { state: 'none', text: 'No worker yet.' }, '/api/needs': { items: [] } });
  try {
    const t = text(state.root);
    assert.match(t, /Choose a model/);
    assert.match(t, /Nothing sliced yet/);
    assert.match(t, /No slicing worker yet/);
  } finally { dom.restore?.(); }
});

test('page: the hub not answering says so and never shows a lamp as ok', async () => {
  const { dom, state } = await render({});
  try {
    assert.equal(state.root.querySelectorAll('.ui-chip--ok').length, 0);
    assert.match(text(state.root), /didn't answer|Not answering/);
  } finally { dom.restore?.(); }
});
