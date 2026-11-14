// The final fix wave for /lab: what the headless-browser run and the whole-branch review found.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  experimentHtml, gradeText, plain, requestsHtml, load, actRetryable, holdRender, releasePreviews, signInOffer,
  verdictIdAfter,
} from '../hub/static/js/lab.js';
import { mountPhotos, openViewer, openCompare, runsOf } from '../hub/static/js/lab-photos.js';
import { prepareSend, settle, snapshots } from '../hub/static/js/lab-observe.js';
import { labFetch, watchRequests, setDeps, recorded } from '../hub/static/js/lab-net.js';
import { refreshPlan, snapshot, restore, cssEscape } from '../hub/static/js/lab-refresh.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/lab-index.json', import.meta.url), 'utf8'));
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// ---- B1: the viewer and Compare open on a dialog made just now ----
function fakePage() {
  const made = {};
  const el = (extra = {}) => ({ style: { setProperty() {} }, dataset: {}, textContent: '', innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], ...extra });
  const dialog = (id) => {
    const kids = {};
    return el({ id, open: false, showModal() { this.open = true; }, close() { this.open = false; }, querySelector: (s) => (kids[s] ||= el()), kids });
  };
  globalThis.document = { getElementById: (id) => made[id] || null, createElement: () => el() };
  const host = { insertAdjacentHTML(_pos, html) { const id = /id="(\w+)"/.exec(html)[1]; made[id] = dialog(id); } };
  const handlers = {};
  const root = { parentNode: host, isConnected: true, querySelectorAll: () => [], addEventListener: (t, fn) => { handlers[t] = fn; } };
  return { made, root, handlers };
}
const SHA = (c) => c.repeat(64);
const IX = () => ({
  project: 'hex', experiments: [
    { id: 'E-1', question: 'Q', photos: [{ run: 'R1', tab: 'A', sha256: SHA('a') }], runs: [{ id: 'R1', started_at: '2026-01-01' }] },
    { id: 'E-2', question: 'Q', photos: [{ run: 'R2', tab: 'A', sha256: SHA('b') }], runs: [{ id: 'R2', started_at: '2026-01-02' }] },
  ],
});

test('B1: tapping a thumbnail opens the viewer on a dialog made just now', () => {
  const { made, root, handlers } = fakePage();
  mountPhotos(root, IX());
  const thumb = { dataset: { view: 'E-1', i: '0' } };
  handlers.click({ target: { closest: (s) => (s === '.lab-thumb[data-view]' ? thumb : null) } });
  assert.equal(made.labViewer.open, true);
  assert.match(made.labViewer.kids['.lab-viewer__cap'].textContent, /A · R1 · 1 of 1/);
  delete globalThis.document;
});

test('B1: Compare opens on a dialog made just now', () => {
  const { made, root } = fakePage();
  const ix = IX();
  mountPhotos(root, ix);
  openCompare(ix.experiments[1]);
  assert.equal(made.labCompare.open, true);
  assert.match(made.labCompare.kids['.lab-compare__body'].innerHTML, /lab-compare__pair/);
  openViewer(ix.experiments[0], 0);
  assert.equal(made.labViewer.open, true);
  delete globalThis.document;
});

// ---- B2: grades (and other free-form values) that are objects ----
test('B2: a grade string shows as-is; an object shows key value pairs, escaped, empties skipped', () => {
  assert.equal(gradeText('clean'), 'clean');
  assert.equal(gradeText({ print: 'clean', apart: 'no' }), 'print clean · apart no');
  assert.equal(gradeText({ a: null, b: '', c: 'x' }), 'c x');
  assert.equal(gradeText(null), '');
  const ix = structuredClone(FIXTURE);
  const x = ix.experiments.find((e) => e.id === 'E-102');
  x.variants[0].grade = { '<k>': '<v>' };
  const html = experimentHtml(x, ix);
  assert.match(html, /&lt;k&gt; &lt;v&gt;/);
  assert.doesNotMatch(html, /\[object Object\]|<k>|<v>/);
  assert.match(experimentHtml(structuredClone(FIXTURE).experiments.find((e) => e.id === 'E-102'), ix), /print clean · apart no/);
});

test('B2: nothing from build_index prints [object Object]', () => {
  assert.equal(plain({ where: 'top', size: 2 }), 'where top · size 2');
  assert.equal(plain(['a', { b: 'c' }]), 'a, b c');
  const ix = structuredClone(FIXTURE);
  const x = ix.experiments.find((e) => e.id === 'E-101');
  x.ai_observations = [{ assessment: { face: 'banded' }, confidence: 0.5, confirmed: false }];
  x.verdict.defects = [{ where: 'top edge', what: 'strings' }];
  x.filament = { brand: 'Kexcelled', colour: 'Terracotta' };
  x.factor = { name: 'seam', unit: '', values: [{ gap: 0.1 }, 0.2] };
  x.variants[0].requested = { gap: 0.1 };
  const html = experimentHtml(x, ix);
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.match(html, /face banded/);
  assert.match(html, /where top edge · what strings/);
  assert.match(html, /brand Kexcelled · colour Terracotta/);
  assert.match(html, /gap 0\.1 vs 0\.2/);
});

// ---- I1: an edit after a stale pending request is the same request ----
test('I1: an edit after a stale pending request keeps the same id, with the new answers', () => {
  const X = { id: 'E-9', run: 'R', test_kind: 'strip', variants: [] };
  const d = { identified: 'confirmed', light: 'room', words: 'first', answers: {} };
  let n = 0;
  const first = prepareSend(d, X, () => `rq-${++n}`);
  d.words = 'second'; // the Mac slept; the owner edited and sends again
  const again = prepareSend(d, X, () => `rq-${++n}`);
  assert.equal(again.id, first.id);
  assert.equal(n, 1);
  assert.equal(again.payload.snapshots[0].source.words, 'second');
  assert.deepEqual(again.payload.snapshots, snapshots(d, X));
  const freed = settle(d, { id: first.id, status: 'refused', message: 'no' });
  assert.equal(freed.draft.requestId, undefined, 'only a refusal frees the id');
  assert.equal(prepareSend(freed.draft, X, () => 'rq-new').id, 'rq-new');
});

// ---- a refused verdict frees its id, as a refused observation does (I1) ----
// The hub answers a request id it already holds with that request's status and drops the new payload (lab.py), so a
// corrected verdict sent under the refused id never reached the Mac and showed the old refusal again.
test('a refused verdict frees its id: the corrected verdict is a new request', () => {
  assert.equal(verdictIdAfter('rq-1', { id: 'rq-1', status: 'refused', message: 'no' }), null);
  assert.equal(verdictIdAfter('rq-1', { id: 'rq-1', status: 'pending' }), 'rq-1', 'a slept Mac keeps the same request');
  assert.equal(verdictIdAfter('rq-1', { id: 'rq-1', status: 'applied' }), 'rq-1');
  assert.equal(verdictIdAfter('rq-1', { id: 'rq-2', status: 'refused' }), 'rq-1', "another request's refusal frees nothing");
  assert.equal(verdictIdAfter(null, { id: 'rq-1', status: 'refused' }), null);
});

test("the verdict sheet's refusal goes through verdictIdAfter", () => {
  const src = readFileSync(new URL('../hub/static/js/lab.js', import.meta.url), 'utf8');
  const update = src.slice(src.indexOf('function onRequestUpdate('), src.indexOf('async function sendVerdict('));
  const from = update.indexOf('} else if (item.status === "refused") {'), to = update.indexOf('} else if (', from + 1);
  assert.ok(from > 0 && to > from, 'the refused branch is where it was');
  assert.match(update.slice(from, to), /^\s*state\.currentReqId = verdictIdAfter\(state\.currentReqId, item\);$/m);
});

// ---- I2: duplicate is done ----
test('I2: duplicate counts as recorded everywhere', async () => {
  assert.equal(recorded('applied'), true);
  assert.equal(recorded('duplicate'), true);
  assert.equal(recorded('refused'), false);
  const s = settle({ requestId: 'rq-1', answers: {} }, { id: 'rq-1', status: 'duplicate' });
  assert.equal(s.draft, null);
  assert.equal(s.status, 'Already recorded on the Mac');
  assert.equal(s.error, '');
  assert.match(requestsHtml([{ id: 'rq-1', kind: 'photos', status: 'duplicate' }]), /badge--ok/);

  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  setDeps({ fetch: async (p) => { calls.push(p); return res(200, { items: [{ id: 'rq-1', status: 'duplicate' }] }); }, ensure: async () => true, hidden: () => false });
  const seen = [];
  watchRequests('hex', ['rq-1'], (i) => seen.push(i.status));
  for (const ms of [1000, 60000]) { mock.timers.tick(ms); for (let i = 0; i < 10; i++) await Promise.resolve(); }
  assert.deepEqual(seen, ['duplicate']);
  assert.equal(calls.length, 1, 'the poll stops on duplicate');
  mock.timers.reset();
});

// ---- M3: a refused approve or drop can be sent again ----
test('M3: a refusal frees the open sheet for another try; pending or applied does not', () => {
  const ctx = { reqId: 'rq-1' };
  assert.equal(actRetryable(ctx, { id: 'rq-1', status: 'pending' }), false);
  assert.equal(ctx.reqId, 'rq-1');
  assert.equal(actRetryable(ctx, { id: 'rq-1', status: 'refused' }), true);
  assert.equal(ctx.reqId, null);
  assert.equal(actRetryable(null, { status: 'refused' }), false);
});

// ---- M4: the photo picker counts as an open dialog ----
test('M4: a refresh while the photo picker is open waits', () => {
  const noDialog = { querySelector: () => null };
  assert.equal(holdRender({ picking: true }, noDialog), true);
  assert.equal(holdRender({ picking: false }, noDialog), false);
  assert.equal(holdRender({}, { querySelector: () => ({}) }), true);
  assert.equal(refreshPlan({ fingerprint: 'fp1' }, 'fp0', holdRender({ picking: true }, noDialog)), 'defer');
});

// ---- M5: nothing lands after leaving ----
test('M5: a load that finishes after leave() draws nothing', async () => {
  const touched = [];
  const box = { set innerHTML(v) { touched.push('innerHTML'); }, replaceChildren() { touched.push('replaceChildren'); }, querySelector: () => null, querySelectorAll: () => [] };
  const state = { box, context: new URLSearchParams(), renderedFp: undefined, currentData: null };
  setDeps({
    fetch: async (p) => {
      state.left = true; // the owner navigated away while this was in flight
      if (p === '/api/lab/projects') return res(200, { projects: [{ name: 'hex', fingerprint: 'fp1' }] });
      return res(200, p.endsWith('/requests') ? { items: [] } : { meta: {}, index: { experiments: [] } });
    },
    ensure: async () => true, hidden: () => false,
  });
  await load(state);
  assert.deepEqual(touched, []);
  assert.equal(state.currentData, null);
});

test('M5: mountPhotos ignores a detached tree', () => {
  const { root } = fakePage();
  const ix = IX();
  mountPhotos(root, ix);
  const other = { experiments: [{ id: 'E-1', question: 'Q', photos: [], runs: [] }] };
  mountPhotos({ ...root, isConnected: false }, other);
  assert.equal(runsOf(ix.experiments[0]).length, 2, 'the module still points at the live index');
  delete globalThis.document;
});

// ---- M6: selectors are escaped properly and can never break a render ----
test('M6: cssEscape escapes a newline the way CSS.escape does', () => {
  assert.equal(cssEscape('a\nb'), 'a\\a b');
  assert.equal(cssEscape('1x'), '\\31 x');
  assert.equal(cssEscape('a"b'), 'a\\"b');
  assert.equal(cssEscape('ok-id_1'), 'ok-id_1');
});

test('M6: snapshot and restore survive a selector the DOM rejects', () => {
  const bad = { tagName: 'BUTTON', id: '', classList: ['x'], attributes: [{ name: 'data-k', value: 'line1\nline2' }], parentElement: null, closest: () => null };
  const win = { scrollY: 10, scrollBy() {}, scrollTo() {} };
  const container = {
    ownerDocument: { defaultView: win, activeElement: bad },
    contains: () => true,
    querySelectorAll: (s) => { if (s.includes('\n')) throw new SyntaxError('bad selector'); return []; },
    querySelector: () => { throw new SyntaxError('bad selector'); },
  };
  const snap = snapshot(container);
  assert.equal(snap.focus.css.includes('\n'), false, 'the newline is escaped');
  assert.doesNotThrow(() => restore(container, { ...snap, open: ['x\ny'], focusId: 'a\nb' }));
  const broken = { ...container, querySelectorAll: () => { throw new SyntaxError('no'); } };
  assert.doesNotThrow(() => snapshot(broken));
});

// ---- M7: the photo previews are let go ----
test('M7: closing the photos sheet revokes every preview URL', () => {
  const revoked = [];
  const state = { previewUrls: ['blob:1', 'blob:2'] };
  releasePreviews(state, (u) => revoked.push(u));
  assert.deepEqual(revoked, ['blob:1', 'blob:2']);
  assert.deepEqual(state.previewUrls, []);
  assert.doesNotThrow(() => releasePreviews({}, () => {}));
});

// ---- M8: a cancelled sign-in leaves a Sign in button ----
test('M8: a cancelled sign-in is a 401 the page can offer to sign in for, only when nothing is shown yet', async () => {
  setDeps({ fetch: async () => res(401, { detail: 'Sign in as the owner first.' }), ensure: async () => false, hidden: () => false });
  const err = await labFetch('/api/lab/projects').catch((e) => e);
  assert.equal(err.status, 401);
  assert.equal(signInOffer({ currentData: null }, err), true);
  assert.equal(signInOffer({ currentData: { index: {} } }, err), false, 'never replace what is already shown');
  assert.equal(signInOffer({ currentData: null }, new Error('HTTP 500')), false);
});
