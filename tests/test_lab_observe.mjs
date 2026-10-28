// Observations and the quiet refresh on /lab: the golden payload, the retry, the draft, and what a refresh may touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  snapshots, observationRequest, prepareSend, settle, missing, plan, formHtml, observeButton, canObserve,
  loadDraft, saveDraft, clearDraft, draftKey,
} from '../hub/static/js/lab-observe.js';
import { refreshPlan, changedIds, snapshot, restore } from '../hub/static/js/lab-refresh.js';
import { fetchLab, cardSignatures, syncedHtml } from '../hub/static/js/lab.js';
import { setDeps } from '../hub/static/js/lab-net.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/lab-requests/observation.json', import.meta.url), 'utf8'));
const X = { id: 'E-102', run: 'PR-102-01', status: 'printing', test_kind: 'full_part', shown_build: 'E-102-3', variants: [{ id: 'V1', tab: 'A' }] };
const DRAFT = () => ({
  variant: 'V1', identified: 'confirmed', label: ' A1 ', light: 'diagnostic', words: ' Looked fine ',
  sides: { tile1: 'left', tile2: 'unknown' },
  answers: {
    'pair.separation': { value: 'easily', note: '' }, 'pair.acceptance': { value: 'accepted_with_defects', note: ' small ding ' },
    'tile1.face': { value: 'clean', note: '' }, 'tile1.backing': { value: 'whole', note: '' }, 'tile1.mounting': { status: 'not_applicable', note: 'no clip' },
    'tile2.face': { status: 'unknown', note: 'dark' }, 'tile2.backing': { value: 'marked', note: '' }, 'tile2.mounting': { value: 'fits', note: '' },
  },
});

test('the builder produces the golden observation payload', () => {
  const d = DRAFT();
  assert.deepEqual(observationRequest(X, snapshots(d, X), golden.id), golden);
  assert.equal(missing(d, X), null);
});

test('every snapshot is complete, unasked outcomes are not_assessed, and an unknown side is not guessed', () => {
  const s = snapshots({ ...DRAFT(), answers: {} }, X);
  assert.equal(s.length, 3);
  assert.deepEqual(Object.keys(s[1].outcomes), ['face', 'backing', 'mounting', 'acceptance']);
  assert.deepEqual(s[1].outcomes.acceptance, { status: 'not_assessed', value: null, note: null });
  assert.equal(s[2].subject.tile, null);
  assert.match(s[2].subject.note, /which side isn't known/);
  assert.equal(snapshots(DRAFT(), { ...X, test_kind: 'strip', variants: [] }).length, 1);
});

test('a retry sends the same id, with the form as it is now (Local AI: the id is kept until the Mac refuses)', () => {
  const d = DRAFT();
  let n = 0;
  const makeId = () => `rq-${String(++n).padStart(16, '0')}`;
  const first = prepareSend(d, X, makeId);
  assert.deepEqual(prepareSend(d, X, makeId), first);
  d.words = 'something else typed later';
  const again = prepareSend(d, X, makeId);
  assert.equal(n, 1);
  assert.equal(again.id, first.id);
  assert.equal(again.payload.snapshots[0].source.words, 'something else typed later');
});

test('a refusal keeps the answers and frees the next send; recorded clears the draft', () => {
  const d = DRAFT();
  prepareSend(d, X, () => 'rq-0000000000000009');
  const refused = settle(d, { id: 'rq-0000000000000009', status: 'refused', message: 'Not that run' });
  assert.equal(refused.error, 'Not that run');
  assert.equal(refused.draft.requestId, undefined);
  assert.equal(refused.draft.sentSnapshots, undefined);
  assert.deepEqual(refused.draft.answers, d.answers);
  assert.equal(settle(d, { id: 'rq-0000000000000009', status: 'applied', message: 'OBS-0004' }).draft, null);
  assert.equal(settle(d, { id: 'rq-other', status: 'applied' }), null);
});

test('the draft survives a localStorage that throws', () => {
  const d = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.deepEqual(loadDraft('p', 'E-1'), {});
    assert.doesNotThrow(() => saveDraft('p', 'E-1', { a: 1 }));
    assert.doesNotThrow(() => clearDraft('p', 'E-1'));
  } finally { if (d) Object.defineProperty(globalThis, 'localStorage', d); else delete globalThis.localStorage; }
});

test('the draft round-trips and a damaged one is ignored', () => {
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } });
  try {
    saveDraft('p', 'E-1', { light: 'room' });
    assert.deepEqual(loadDraft('p', 'E-1'), { light: 'room' });
    store.set(draftKey('p', 'E-2'), '{not json');
    assert.deepEqual(loadDraft('p', 'E-2'), {});
    store.set(draftKey('p', 'E-3'), '[1]');
    assert.deepEqual(loadDraft('p', 'E-3'), {});
    clearDraft('p', 'E-1');
    assert.deepEqual(loadDraft('p', 'E-1'), {});
  } finally { delete globalThis.localStorage; }
});

test('the button shows where Local AI shows it: a run that is printing without a verdict, or answered', () => {
  assert.match(observeButton(X), /class="btn-outline lab-observe" data-exp="E-102"/);
  assert.ok(canObserve({ ...X, status: 'answered', verdict: { kind: 'acceptance' } }));
  assert.ok(!canObserve({ ...X, verdict: { kind: 'acceptance' } }));
  assert.ok(!canObserve({ ...X, run: null }));
  assert.ok(!canObserve({ ...X, status: 'planned' }));
  assert.equal(observeButton({ ...X, status: 'abandoned' }), '');
});

test('the form escapes what came from the Mac and what was typed', () => {
  const evil = '<img src=x onerror=alert(1)>"';
  const html = formHtml({ ...X, variants: [{ id: evil, tab: evil }] }, { ...DRAFT(), label: evil, words: evil, identNote: evil, variant: evil });
  assert.ok(!html.includes('<img'));
  assert.ok(!/value="[^"]*"[^>]*onerror/.test(html));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;/);
  assert.equal(plan({ test_kind: 'strip' })[0].key, 'strip');
});

// ---- the quiet refresh ----
test('an unchanged fingerprint is a quiet refresh; a changed one renders unless a dialog is open', () => {
  assert.equal(refreshPlan({ fingerprint: 'a' }, 'a', false), 'quiet');
  assert.equal(refreshPlan({ fingerprint: 'a' }, 'a', true), 'quiet');
  assert.equal(refreshPlan({ fingerprint: 'b' }, 'a', false), 'render');
  assert.equal(refreshPlan({ fingerprint: 'b' }, 'a', true), 'defer');
  assert.equal(refreshPlan({ fingerprint: 'b' }, undefined, false), 'render');
  assert.equal(refreshPlan({}, 'a', false), 'render'); // an older Mac with no fingerprint always draws
  assert.equal(refreshPlan({ fingerprint: '' }, '', false), 'render');
});

test('changed cards flash, new ones too, equal ones not, and the first render never does', () => {
  assert.deepEqual(changedIds({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }), ['b', 'c']);
  assert.deepEqual(changedIds(null, { a: '1' }), []);
  const data = { index: { experiments: [{ id: 'E-1', status: 'planned' }] } };
  const before = cardSignatures(data, []);
  const after = cardSignatures(data, [{ id: 'rq-1', experiment: 'E-1', kind: 'photos', status: 'pending' }]);
  assert.deepEqual(changedIds(before, before), []);
  assert.deepEqual(changedIds(before, { ...before, 'E-1': before['E-1'] + 'x' }), ['E-1']);
  assert.equal(typeof after['E-1'], 'string');
});

test('the sync line can be redrawn on its own', () => {
  assert.match(syncedHtml({ synced_at: new Date().toISOString() }), /class="meta lab-synced" aria-live="off">Synced from the Mac just now/);
  assert.match(syncedHtml({ synced_at: '2020-01-01T00:00:00Z' }), /lab-synced--stale/);
});

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function rig(handler) {
  const calls = [];
  setDeps({ fetch: async (path) => { calls.push(path); return handler(path); }, ensure: async () => false, hidden: () => false });
  return calls;
}

test('an unchanged fingerprint does not fetch the project again, but still reads the requests', async () => {
  const calls = rig((p) => (p === '/api/lab/projects' ? res(200, { projects: [{ name: 'hex', fingerprint: 'fp1', synced_at: 'T2' }] }) : res(200, p.endsWith('/requests') ? { items: [] } : { meta: {}, index: {} })));
  const page = { renderedFp: 'fp1' };
  const got = await fetchLab(page);
  assert.equal(got.unchanged, true);
  assert.equal(got.labData, null);
  assert.deepEqual(calls, ['/api/lab/projects', '/api/lab/hex/requests']);
  page.renderedFp = 'fp0';
  assert.equal((await fetchLab(page)).unchanged, undefined);
});

// ---- restore keeps the reader's place ----
function fakeDom({ openIds, focusId, cardTop }) {
  const els = {};
  const mk = (id, extra = {}) => (els[id] = { id, open: false, focused: false, focus() { this.focused = true; }, getBoundingClientRect: () => ({ top: cardTop.v, bottom: cardTop.v + 100 }), ...extra });
  mk('lab-earlier'); mk('lab-d-E-1'); mk('lab-E-1'); mk('btn');
  const win = { scrollY: 340, scrolled: [], scrollBy(x, y) { this.scrolled.push(['by', y]); }, scrollTo(x, y) { this.scrolled.push(['to', y]); } };
  const doc = { defaultView: win, activeElement: focusId ? els[focusId] : null };
  const container = {
    ownerDocument: doc,
    contains: (e) => Object.values(els).includes(e),
    querySelectorAll(s) {
      if (s === 'details[open]') return openIds.map((i) => els[i]);
      if (s === '.lab-exp') return [els['lab-E-1']];
      return [];
    },
    querySelector(s) { return els[s.replace(/^#/, '').replace(/\\/g, '')] || null; },
  };
  els.btn.closest = () => els.btn; els.btn.parentElement = null; els.btn.classList = []; els.btn.attributes = []; els.btn.tagName = 'BUTTON';
  return { container, els, win };
}

test('restore reopens the details (Earlier included), refocuses, and keeps the card where it was', () => {
  const cardTop = { v: 120 };
  const a = fakeDom({ openIds: ['lab-earlier', 'lab-d-E-1'], focusId: 'btn', cardTop });
  const snap = snapshot(a.container);
  assert.deepEqual(snap.open, ['lab-earlier', 'lab-d-E-1']);
  assert.equal(snap.focusId, 'btn');
  assert.deepEqual(snap.anchor, { id: 'lab-E-1', top: 120 });
  const b = fakeDom({ openIds: [], focusId: null, cardTop: { v: 150 } }); // the new render, a card above grew 30px
  restore(b.container, snap);
  assert.equal(b.els['lab-earlier'].open, true);
  assert.equal(b.els['lab-d-E-1'].open, true);
  assert.equal(b.els.btn.focused, true);
  assert.deepEqual(b.win.scrolled, [['by', 30]]);
});
