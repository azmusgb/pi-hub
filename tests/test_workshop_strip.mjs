// Workshop flow W.1 (docs/superpowers/plans/2026-11-04-workshop-flow.md): Workshop's strip, Printer | Print lab, made
// by System's strip component, and the Local AI and Workshop display cards moved off Workshop to Health and Settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRIP, STRIPS, pageHeading, stripFor, stripItems } from '../hub/static/js/system-strip.js';
import { sectionFor } from '../hub/static/js/sections.js';
import { RECORD_PATHS } from '../hub/static/js/control-room.js';
import { otherSystemRows } from '../hub/static/js/health.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("Workshop's strip is Printer | Print lab, and System's is unchanged", () => {
  assert.deepEqual(STRIPS.workshop.entries, [['/workshop', 'Printer'], ['/lab', 'Print lab']]);
  assert.equal(STRIPS.workshop.label, 'Workshop');
  assert.equal(STRIPS.system.entries, STRIP);
  assert.equal(STRIPS.system.label, 'System');
});

test('on each Workshop page the strip marks that page current, and only that one', () => {
  assert.deepEqual(stripItems('/workshop'), [
    { href: '/workshop', label: 'Printer', current: true },
    { href: '/lab', label: 'Print lab', current: false },
  ]);
  assert.deepEqual(stripItems('/lab').filter((i) => i.current).map((i) => i.href), ['/lab']);
  assert.equal(stripFor('/lab').key, 'workshop');
  assert.equal(stripFor('/lab').label, 'Workshop');
  assert.equal(stripFor('/settings').key, 'system');
  for (const path of ['/', '/wall', '/more', '/pi']) assert.equal(stripFor(path), null, path);  // A6: every other page is on a strip
});

test('every Workshop strip entry is a page of the Workshop section the router knows', () => {
  const main = read('hub/static/js/main.js');
  for (const [href] of STRIPS.workshop.entries) {
    assert.match(main, new RegExp(`^  "${href}": \\{`, 'm'), href);
    assert.equal(sectionFor(href), 'workshop', href);
  }
});

test('Workshop pages are headed Workshop; the strip and the tab title say which page', () => {
  assert.deepEqual(pageHeading('/workshop', 'Workshop'), { heading: 'Workshop', title: 'Printer · Workshop' });
  assert.deepEqual(pageHeading('/lab', 'Print lab'), { heading: 'Workshop', title: 'Print lab · Workshop' });
  assert.deepEqual(pageHeading('/system', 'Health'), { heading: 'System', title: 'Health · System' });
  assert.deepEqual(pageHeading('/more', 'More'), { heading: 'More', title: 'More' });  // A6: Media has a strip now
});

test('the shell draws one strip component for both areas, labelled by its area, with aria-current on the page', () => {
  const src = read('hub/static/js/system-strip.js');
  assert.match(src, /"aria-label": strip\.label/);
  assert.match(src, /"aria-current": current \? "page" : null/);
  const main = read('hub/static/js/main.js');
  assert.match(main, /const strip = pageStrip\(path\);/);
  assert.doesNotMatch(main, /systemStrip\(/);
});

test('Workshop no longer carries the Local AI or Workshop display cards, or the raw display address', () => {
  const src = read('hub/static/js/workshop.js');
  assert.doesNotMatch(src, /Local AI/);
  assert.doesNotMatch(src, /10\.0\.0\.124/);
  assert.doesNotMatch(src, /Workshop display/);
  assert.doesNotMatch(src, /\bd\.(ai|display)\b/);
});

test('Settings owns display pairing, made once so a refresh keeps a code on screen', () => {
  const src = read('hub/static/js/settings.js');
  assert.match(src, /import \{ displayCard \} from "\.\/display-pair\.js";/);
  assert.match(src, /state\.display \?\?= displayCard\(\)/);
  // Settings shows only the cards its groups name: the display card has to be in one, or it's made and never shown.
  assert.match(src, /\["home", "Home", \[[^\]]*"Workshop display"[^\]]*\]\]/);
  assert.doesNotMatch(read('hub/static/js/health.js'), /displayCard/);
});

test('Health shows Local AI, the Workshop display and the PC from their records', () => {
  const rows = otherSystemRows([
    { id: 'local_ai', state: 'ready', severity: 'ok', headline: 'Local AI is ready', cause: '', detail: { models: ['qwen3:8b'], waiting: 0 } },
    { id: 'workshop_display', state: 'online', severity: 'ok', headline: 'The touchscreen is online', cause: '', detail: { firmware: '1.4.2' } },
    { id: 'pc', state: 'off', severity: 'problem', headline: 'The PC is off', cause: 'Not answering on the network since 09:12.', detail: {} },
    { id: 'printer', state: 'idle', severity: 'ok', headline: 'Idle', cause: '', detail: {} },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ['Local AI', 'Workshop display', 'Windows PC']);
  assert.deepEqual(rows.map((r) => r.tone), ['ok', 'ok', 'bad']);
  assert.equal(rows[0].text, 'Local AI is ready');
  assert.equal(rows[0].meta, 'Models loaded: qwen3:8b');
  assert.equal(rows[1].meta, 'Firmware 1.4.2');
  assert.equal(rows[2].meta, 'Not answering on the network since 09:12.');
});

test('a record not read yet, unknown or stale on Health is never shown as off', () => {
  const rows = otherSystemRows([
    { id: 'local_ai', state: 'unknown', severity: 'attention', headline: 'No reading', cause: '', detail: {} },
    { id: 'workshop_display', state: 'online', severity: 'attention', stale: true, headline: 'The touchscreen is online',
      cause: "The Pi's status service not answering since 10:02; last read 4 min ago.", detail: {} },
  ]);
  assert.deepEqual(rows.map((r) => [r.label, r.text, r.tone]), [
    ['Local AI', 'No reading', 'warn'],
    ['Workshop display', 'The touchscreen is online', 'warn'],
    ['Windows PC', 'Not checked yet', 'warn'],
  ]);
  assert.equal(rows[1].meta, "The Pi's status service not answering since 10:02; last read 4 min ago.");
  assert.equal(otherSystemRows(null).length, 3);
});

test("Needs and Home send Local AI, the display and the PC to Health, where they're shown now", () => {
  for (const id of ['local_ai', 'workshop_display', 'pc']) assert.equal(RECORD_PATHS[id], '/system', id);
  assert.equal(RECORD_PATHS.pc_printing, '/workshop');
});
