// Platform step 7, PR 7.3: System's strip, /system as Health with /pi's cards, and /backups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { STRIP, stripItems } from '../hub/static/js/system-strip.js';
import { redirectFor, sectionFor } from '../hub/static/js/sections.js';
import { mergeServices, serviceRows } from '../hub/static/js/health.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("the strip has the spec's six entries in order, then A6's Site map", () => {
  assert.deepEqual(STRIP.map(([, label]) => label), ['Health', 'Backups', 'Versions', 'Alerts', 'Automations', 'Settings', 'Site map']);
  assert.deepEqual(STRIP.map(([href]) => href), ['/system', '/backups', '/versions', '/alerts', '/rules', '/settings', '/map']);
});

test('the page you are on is the one marked current, and only on strip pages (Workshop has its own strip, W.1)', () => {
  for (const [href] of STRIP) {
    const items = stripItems(href);
    assert.deepEqual(items.filter((i) => i.current).map((i) => i.href), [href], href);
  }
  for (const path of ['/', '/wall', '/more', '/pi']) assert.equal(stripItems(path), null, path);  // A6: /drives is on Media's strip
});

test('the strip renders aria-current only on the current entry', () => {
  const src = read('hub/static/js/system-strip.js');
  assert.match(src, /"aria-current": current \? "page" : null/);
  assert.match(src, /"aria-label": strip\.label/);
});

test('every strip entry is a page of the System section the router knows', () => {
  const main = read('hub/static/js/main.js');
  for (const [href] of STRIP) {
    assert.match(main, new RegExp(`^  "${href}": \\{`, 'm'), href);
    assert.equal(sectionFor(href), 'system', href);
  }
});

test('/pi is only a redirect to Health, and keeps ?help=', () => {
  assert.equal(redirectFor('/pi'), '/system');
  const main = read('hub/static/js/main.js');
  assert.doesNotMatch(main, /^ {2}"\/pi": /m);
  assert.doesNotMatch(main, /from "\.\/pi\.js"/);
  assert.match(main, /history\.replaceState\(\{\}, "", moved \+ location\.search\)/);  // /pi?help=x → /system?help=x
  assert.equal(existsSync(new URL('../hub/static/js/pi.js', import.meta.url)), false);
  assert.match(read('hub/static/js/health.js'), /state\.context\?\.get\("help"\)/);
});

test("Health holds every /pi card and System's services; the display's pairing moved to Settings (W.1)", () => {
  const src = read('hub/static/js/health.js');
  for (const fn of ['selfcheckCard(', 'outagesCard(', 'servicesCard(', 'fixCard(', 'storageCard(', 'updatesCard(',
    'networkCard(', 'healthCard(', 'otherSystemsCard(', 'helpGuidance()']) assert.ok(src.includes(fn), fn);
  assert.match(src, /openInRow\("system"\)/);  // Open in Backrest ↗ · Cockpit ↗, from the registry (PR 7.6)
  assert.match(read('hub/static/js/freshness.js'), /const SOURCES = \{ health: true \}/);  // Source responses
});

test('the shell caches the new modules and not the removed ones', () => {
  const sw = read('hub/static/sw.js');
  for (const f of ['health.js', 'backups.js', 'system-strip.js']) assert.ok(sw.includes(`/static/js/${f}"`), f);
  for (const f of ['pi.js', 'system.js']) assert.ok(!sw.includes(`/static/js/${f}"`), f);
});

test('one Services card: a unit and the app of the same name share a row', () => {
  const rows = serviceRows(
    [{ name: 'restart:plex', label: 'Restart Plex' }, { name: 'restart:ntfy', label: 'Restart ntfy' }, { name: 'restart:pi', label: 'Restart the Pi' }],
    [{ id: 'plex', severity: 'attention', state: 'idle', headline: 'Plex is slow' }]);
  const merged = mergeServices([{ name: 'Plex', state: 'active' }, { name: 'Docker', state: 'active' }], rows);
  assert.deepEqual(merged.map((m) => [m.service?.name ?? null, m.restart?.name ?? null]),
    [['Plex', 'Plex'], ['Docker', null], [null, 'ntfy']]);
  assert.deepEqual(mergeServices(null, null), []);
  assert.deepEqual(mergeServices([], []), []);
});
