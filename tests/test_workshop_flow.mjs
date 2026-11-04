// Workshop flow W.2 (docs/superpowers/plans/2026-11-04-workshop-flow.md): the Printer page's order and each of its
// states, decided by workshopView from /api/workshop, the viewer's role and the camera, then drawn by load().
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { printLabUrl } from '../hub/static/js/sections.js';
import { workshopView, readOpen, writeOpen, MORE } from '../hub/static/js/workshop.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const T = 1793770000;

const printer = (state, extra = {}) => ({ state, headline: state, detail: '', progress: 0, left: '', minutes_left: null,
  stale: false, actions: [], layer_num: null, total_layers: null, ...extra });
const judge = { project: 'hex-tile', id: 'E-007', action: 'Judge the print', judge_on: 'Top surface gloss', question_text: '', href: '/lab?p=hex-tile&e=E-007&do=judge' };
const prints = [
  { id: 40, name: 'Cable clip x4', status: 'completed', word: 'Finished', started: T - 86400, ended: T - 80000, seconds: 6400 },
  { id: 39, name: 'Drawer label', status: 'failed', word: 'Failed', started: T - 172800, ended: T - 171900, seconds: 900 },
];
const base = (over = {}) => ({
  printer: printer('idle'), prints, prints_available: true, week: { finished: 6, hours: 14.2 },
  spools: [{ colour: 'Blue', material: 'PLA', grams_left: 640, grams_total: 1000, measured: true, low: false },
    { colour: 'White', material: 'PETG', grams_left: 90, grams_total: 1000, measured: true, low: true }],
  ams_trays: [{ slot: 1, type: 'PLA', color: '#2b6cb0', remain: 64 }], lab: { needs: [], active: [], questions: [] },
  filament_month: { prints_logged: 0 }, ...over,
});
const owner = { role: 'owner', now: T };

test('the lab link helper takes the action: p, e and do=judge, and nothing it does not know', () => {
  assert.equal(printLabUrl('E-007', 'hex-tile', 'judge'), '/lab?p=hex-tile&e=E-007&do=judge');
  assert.equal(printLabUrl('E-007', 'hex-tile'), '/lab?p=hex-tile&e=E-007');
  assert.equal(printLabUrl('E-007', 'Bad Name', 'judge'), '/lab?e=E-007&do=judge');
  assert.equal(printLabUrl('E-007', 'hex-tile', 'delete'), '/lab?p=hex-tile&e=E-007');
});

test('loading: no view until the first answer; the page draws a band skeleton and a camera placeholder', () => {
  assert.equal(workshopView(null, owner), null);
  const src = read('hub/static/js/workshop.js');
  assert.match(src, /class: "band ws-skeleton", "aria-busy": "true"/);
  assert.match(src, /h\("div", \{ class: "ws-cam-placeholder" \}\)/);
  const css = read('hub/static/workshop-pi-rich.css');
  assert.match(css, /\.ws-cam-placeholder \{[^}]*aspect-ratio: 16 \/ 9/);
});

test('printing: progress stays in the band, the camera comes first on a phone, Needs you holds only lab items', () => {
  const v = workshopView(base({ printer: printer('printing', { progress: 42, left: '1 h 13 min', actions: ['pause'] }),
    lab: { needs: [judge], active: [], questions: [] } }), owner);
  assert.equal(v.camFirst, true);
  assert.deepEqual(v.bandActions, ['pause']);
  assert.deepEqual(v.needs.map((n) => n.kind), ['lab']);
  assert.equal(v.needs[0].href, '/lab?p=hex-tile&e=E-007&do=judge');
  assert.equal(v.needs[0].label, 'Judge E-007');
  assert.equal(v.needs[0].title, 'E-007: Judge the print');
  assert.equal(v.needs[0].detail, 'Look at: Top surface gloss');
});

test('finished: Clear the plate comes first in Needs you, with the one Clear button there and not in the band', () => {
  // /api/workshop calls a finished print "stopped" (now.PRINTER_STATE); a failed one is "error".
  assert.equal(workshopView(base({ printer: printer('error', { actions: ['clear'] }) }), owner).needs[0].title, 'Clear the plate');
  const v = workshopView(base({ printer: printer('stopped', { actions: ['clear'] }), lab: { needs: [judge], active: [], questions: [] } }), owner);
  assert.deepEqual(v.needs.map((n) => n.kind), ['clear', 'lab']);
  assert.equal(v.needs[0].title, 'Done: clear the plate');
  assert.equal(v.needs[0].action, 'clear');
  assert.deepEqual(v.bandActions, []);
  assert.equal(v.camFirst, false);
});

test('idle: the band says Idle with the last print, and Needs you is empty (so hidden) without lab items', () => {
  const v = workshopView(base(), owner);
  assert.deepEqual(v.needs, []);
  assert.match(v.lastPrint, /^Last print: Cable clip x4, Finished/);
  const src = read('hub/static/js/workshop.js');
  assert.match(src, /state\.needs\.hidden = !v\.needs\.length/);
  // An empty slot is left out, not drawn as the word "null" (screenshot, W.2).
  assert.match(src, /needsList\(state, v\)\.filter\(Boolean\)/);
  // A pill with nothing to say is hidden, whatever display the kit gives .pill.
  assert.match(read('hub/static/workshop-pi-rich.css'), /\.ws-more-item \.pill\[hidden\] \{ display: none; \}/);
});

test('materials: AMS trays and only the low spools, in one row; this week: one line from weekPill', () => {
  const v = workshopView(base(), owner);
  assert.deepEqual(v.materials.trays.map((t) => t.slot), [1]);
  assert.deepEqual(v.materials.low.map((s) => s.colour), ['White']);
  assert.equal(v.week, '6 finished this week · 14.2 h printing');
  assert.equal(v.quiet, null);
});

test('Bambuddy down: one "No answer" line for Materials and This week, lab items still shown, last known kept with its age', () => {
  const down = base({ printer: printer('printing', { stale: true, detail: 'Bambuddy not answering since 12:40; last read 3 min ago.' }),
    prints: [], prints_available: false, week: null, spools: null, lab: { needs: [judge], active: [], questions: [] } });
  const v = workshopView(down, { ...owner, last: { prints, spools: base().spools, week: base().week, at: T - 300 } });
  assert.equal(v.down, true);
  assert.equal(v.materials, null);
  assert.equal(v.week, null);
  assert.equal(v.quiet, 'No answer from Bambuddy for spools and this week’s prints.');
  assert.deepEqual(v.needs.map((n) => n.id), ['E-007']);
  assert.equal(v.history.prints.length, 2);
  assert.equal(v.history.asOf, T - 300);
  assert.equal(v.spools.asOf, T - 300);
  // With nothing seen yet there's nothing to show, and nothing is invented.
  const cold = workshopView(down, owner);
  assert.equal(cold.history.prints, null);
  assert.equal(cold.spools.list, null);
});

test('signed out: a read-only band, no Clear button, and lab items with no action', () => {
  const v = workshopView(base({ printer: printer('stopped', { actions: ['clear'] }), lab: { needs: [judge], active: [], questions: [] } }), { role: 'none', now: T });
  assert.deepEqual(v.bandActions, []);
  assert.equal(v.needs[0].kind, 'clear');
  assert.equal(v.needs[0].action, null);
  assert.equal(v.needs[1].href, null);
  assert.equal(v.signIn, true);
  assert.equal(workshopView(base(), owner).signIn, false);
});

test('camera off: says the camera is unavailable and why, never that the printer is off', () => {
  const src = read('hub/static/js/workshop.js');
  const off = src.slice(src.indexOf('function camera('), src.indexOf('// One row per print'));
  assert.match(off, /Camera unavailable/);
  assert.match(off, /LAN Only Liveview/);
  assert.doesNotMatch(off, /printer is off|Printer off/i);
});

test('the page in the plan order: Now, Needs you here, Materials, This week, More in the workshop, Open in', () => {
  const src = read('hub/static/js/workshop.js');
  const order = src.match(/state\.root\.append\(([^;]+)\);/)[1];
  const at = (s) => order.indexOf(s);
  for (const [a, b] of [['state.sources', 'now'], ['now', 'state.needs'], ['state.needs', 'state.materials'],
    ['state.materials', 'state.week'], ['state.week', 'more'], ['more', 'openInRow("workshop")']]) {
    assert.ok(at(a) >= 0 && at(a) < at(b), `${a} before ${b}`);
  }
});

test('More in the workshop: four native <details>, closed by default, open state remembered per viewer', () => {
  assert.deepEqual(MORE.map(([k, title]) => [k, title]),
    [['filament', 'Filament'], ['history', 'Print history'], ['projects', 'Projects'], ['lab', 'Print lab & queue']]);
  const store = new Map();
  const ls = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  assert.deepEqual(readOpen(ls), {});
  writeOpen('history', true, ls);
  writeOpen('filament', false, ls);
  assert.deepEqual(readOpen(ls), { history: true, filament: false });
  // Storage that throws (private mode, blocked) or holds junk leaves everything closed and the page working.
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(readOpen(broken), {});
  assert.doesNotThrow(() => writeOpen('history', true, broken));
  assert.deepEqual(readOpen({ getItem: () => '[1,2]', setItem() {} }), {});
  assert.deepEqual(readOpen(undefined), {});
  const src = read('hub/static/js/workshop.js');
  assert.match(src, /h\("details", \{ class: "ws-more-item"/);
});

test('one "Open in Bambuddy ↗" row, and no other Bambuddy link names the tool', () => {
  const src = read('hub/static/js/workshop.js');
  assert.equal(src.match(/openInRow\("workshop"\)/g).length, 1);
  assert.doesNotMatch(src, /"Open Bambuddy ↗"/);
});

test('the band, the Needs list and the strip are what Tab reaches; reduced motion stills the progress line', () => {
  const css = read('hub/static/workshop-pi-rich.css');
  assert.match(css, /\.ws-more-item > summary:focus-visible \{[^}]*outline/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.ws-skeleton/);
  assert.match(read('hub/static/app.css'), /@media \(prefers-reduced-motion: reduce\) \{\s*\.printer-source__dot,\s*\.line-bead,\s*\.line-nozzle/);
});
