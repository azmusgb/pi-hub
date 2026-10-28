// /lab photos: thumbnails, runs for compare, the wipe and the judging checklist (pure parts; the viewer needs a DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { photosOf, runsOf, thumbsHtml, wipeHtml, checklistHtml, saveTick, ticksOf } from '../hub/static/js/lab-photos.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/lab-index.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(FIXTURE);
const HEX = (c) => c.repeat(64);
const HOSTILE = '<img src=x onerror=alert(1)>"';
const withPhotos = (x, n) => { x.photos = Array.from({ length: n }, (_, i) => ({ run: 'PR-1', tab: `T${i}`, sha256: HEX('abcdef'[i % 6]) })); return x; };

test('thumbsHtml shows six, then "+n", and nothing without photos', () => {
  const ix = fresh(), x = withPhotos(ix.experiments[0], 9);
  const html = thumbsHtml(x, ix);
  assert.equal((html.match(/class="lab-thumb"/g) || []).length, 6);
  assert.match(html, /lab-thumb--more[^>]*>\+3</);
  assert.equal(thumbsHtml(withPhotos(fresh().experiments[0], 0), ix), '');
});

test('thumbsHtml escapes tab labels and skips non-hex SHAs', () => {
  const ix = fresh(), x = ix.experiments[0];
  x.photos = [{ run: 'PR-1', tab: HOSTILE, sha256: HEX('a') }, { run: 'PR-1', tab: 'ok', sha256: '../../etc/passwd"' }];
  const html = thumbsHtml(x, ix);
  assert.ok(!html.includes('<img src=x'), html);
  assert.ok(!html.includes('passwd'));
  assert.equal((html.match(/class="lab-thumb"/g) || []).length, 1);
  assert.match(html, /photo\/a{64}\.jpg/);
});

test('photosOf groups by tab, tabless last', () => {
  const x = { photos: [{ run: 'r', sha256: HEX('a') }, { run: 'r', tab: 'B', sha256: HEX('b') }, { run: 'r', tab: 'A', sha256: HEX('c') }] };
  assert.deepEqual(photosOf(x).map((p) => p.tab), ['A', 'B', undefined]);
});

test('runsOf lists the runs with photos for one question, oldest first, so compare can pair by tab', () => {
  const ix = fresh();
  const a = ix.experiments.find((x) => x.id === 'E-101'), b = ix.experiments.find((x) => x.id === 'E-102');
  b.photos = [{ run: 'PR-102-02', tab: '1A', sha256: HEX('b') }];
  const runs = runsOf(a, ix);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].run, 'PR-101-01');
  assert.deepEqual(runs.map((r) => r.photos[0].tab), ['1A', '1A']);
  assert.equal(runsOf(ix.experiments.find((x) => x.id === 'E-100'), ix).length, 0);
});

test('wipeHtml is empty without reference_variants or reference photos, else escaped', () => {
  const ix = fresh(), by = (id) => ix.experiments.find((x) => x.id === id);
  const t = by('E-102'); t.photos = [{ run: 'r', sha256: HEX('b') }];
  t.reference_variants = [];
  assert.equal(wipeHtml(t, ix), '');
  t.reference_variants = ['E-101-A'];
  const html = wipeHtml(t, ix);
  assert.match(html, /class="lab-wipe"/);
  assert.match(html, /photo\/d{2}/);
  by('E-101').id = 'E-101';
  by('E-101').photos = [{ run: 'r', sha256: HEX('c') }];
  by('E-101').id = HOSTILE; t.reference_variants = [HOSTILE + '-A'];
  assert.ok(!wipeHtml(t, ix).includes('<img src=x'));
  const none = fresh(); const t2 = none.experiments.find((x) => x.id === 'E-102');
  t2.reference_variants = ['E-101-A']; delete t2.photos;
  assert.equal(wipeHtml(t2, none), '');
});

test('the checklist ticks survive a throwing localStorage', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
  try {
    const x = { id: 'E-1', judge_on: 'the seam; the corner' };
    assert.deepEqual(ticksOf('E-1'), []);
    assert.doesNotThrow(() => saveTick('E-1', 0, true));
    const html = checklistHtml(x);
    assert.match(html, /the seam/);
    assert.match(html, /Raking light/);
    assert.ok(!html.includes(' checked'));
  } finally {
    if (real) Object.defineProperty(globalThis, 'localStorage', real); else delete globalThis.localStorage;
  }
});

test('ticks round-trip and the checklist escapes judge_on', () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  try {
    saveTick('E-1', 1, true);
    assert.deepEqual(ticksOf('E-1'), [1]);
    const html = checklistHtml({ id: 'E-1', judge_on: HOSTILE + ';b' });
    assert.ok(!html.includes('<img src=x'));
    assert.equal((html.match(/ checked/g) || []).length, 1);
  } finally { delete globalThis.localStorage; }
});
