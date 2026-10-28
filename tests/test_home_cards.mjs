import test from 'node:test';
import assert from 'node:assert/strict';
import { homeCards, homeBadge, labLink, needsSummary } from '../hub/static/js/home-cards.js';

const AT = new Date(2026, 9, 25, 13, 50);
const NOW = {
  printer: { state: 'printing', progress: 94, minutes_left: 30 },
  movies: { playing: [{ title: 'Arrival' }] },
  network: { status: 'ok', wan_ms: 20 },
  pi: { temp: 52 },
};
const NEEDS = { count: 2, items: [{ source: 'Printer', tone: 'attention', title: 'Clear the plate', detail: '', link: '/workshop' },
  { source: 'Pi', tone: 'warn', title: 'Pi is hot', detail: '', link: '/alerts' }], unread: [] };
const BACKUPS = { available: true, repos: [{ name: 'Pi', hours: 6 }, { name: 'Mac', hours: 20 }] };
const HOME = { connected: true, accessories: [{ on: true }, { on: false }, { on: true }] };
const all = (over = {}) => homeCards({ now: NOW, needs: NEEDS, backups: BACKUPS, home: HOME, latest: { title: 'Dune' }, at: AT, host: 'home.home.arpa', ...over });
const by = (cards) => Object.fromEntries(cards.map((c) => [c.key, c]));

test('Needs you comes first, and only when something needs you', () => {
  assert.deepEqual(all().map((c) => c.key), ['needs', 'workshop', 'documents', 'media', 'network', 'system']);
  assert.deepEqual(all({ needs: { count: 0, items: [], unread: [] } }).map((c) => c.key), ['workshop', 'documents', 'media', 'network', 'system']);
  const n = by(all()).needs;
  assert.equal(n.title, 'Needs you');
  assert.equal(n.tone, 'attention');
  assert.deepEqual(n.items.map((i) => i.title), ['Clear the plate', 'Pi is hot']);
  assert.equal(n.action, null);
  for (const c of all().slice(1)) assert.ok(c.action?.label && c.action?.href, c.key);
});

test('each card has a status line and one main action in task words', () => {
  const c = by(all());
  assert.equal(c.workshop.title, 'Bambu X2D');
  assert.match(c.workshop.status, /^Printing, 94% · done (2|14):20/);
  assert.deepEqual(c.workshop.action, { label: 'Open Bambuddy ↗', href: 'https://bambuddy.home.arpa/' });
  assert.deepEqual(c.documents.action, { label: 'Find a document', href: '/documents' });
  assert.deepEqual(c.documents.link, { label: 'Scan ↗', href: 'https://scan.home.arpa/' });
  assert.equal(c.media.status, 'Now playing: Arrival · Latest: Dune');
  assert.equal(c.network.status, 'Internet OK · 2 devices on');
  assert.equal(c.system.status, 'Backed up 20 h ago · Pi 52 °C');
  assert.equal(c.system.tone, 'ok');
});

test('slow, quiet and stale states read plainly', () => {
  const c = by(all({
    now: { ...NOW, printer: { state: 'idle' }, movies: { playing: [] }, network: { status: 'ok', wan_ms: 400 } },
    backups: { available: true, repos: [{ name: 'Pi', hours: 40 }, { name: 'Mac', hours: 2 }] },
  }));
  assert.equal(c.workshop.status, 'Idle');
  assert.equal(c.media.status, 'Nothing playing · Latest: Dune');
  assert.equal(c.network.status, 'Internet slow · 2 devices on');
  assert.equal(c.network.tone, 'warn');
  assert.equal(c.system.status, 'Backed up 40 h ago · Pi 52 °C');
  assert.equal(c.system.tone, 'warn');
});

test('every card still renders when its source is down', () => {
  const c = by(all({
    now: { printer: { state: 'none' }, movies: { playing: null }, network: null, pi: {} },
    needs: null, backups: null, home: { connected: false, accessories: [] }, latest: null,
  }));
  assert.equal(c.workshop.status, "Bambuddy isn't answering");
  assert.equal(c.media.status, "Plex isn't answering");
  assert.equal(c.network.status, "Network checks aren't answering");
  assert.equal(c.system.status, "Backups unknown");
  assert.equal(c.system.tone, 'warn');
  assert.equal(c.needs.status, "Couldn't check what needs you");
});

test('Needs you says which sources it could not read', () => {
  const n = by(all({ needs: { count: 1, items: [NEEDS.items[1]], unread: ['Local AI'] } })).needs;
  assert.equal(n.note, "Couldn't check Local AI.");
});

test('the Home badge equals the Needs you count', () => {
  assert.equal(homeBadge({ count: 3 }), '3');
  assert.equal(homeBadge({ count: 120 }), '99+');
  assert.equal(homeBadge({ count: 0 }), '');
  assert.equal(homeBadge(null), '');
  assert.equal(by(all()).needs.count, Number(homeBadge(NEEDS)));
});

test('links use the old addresses when the hub is opened by IP', () => {
  assert.equal(by(all({ host: '10.0.0.30' })).workshop.action.href, 'http://10.0.0.30:8000/');
});

test('Needs you says when it could not check, even with nothing else to show', () => {
  const n = by(all({ needs: { count: 0, items: [], unread: ['Local AI'] } })).needs;
  assert.equal(n.status, "Couldn't check Local AI");
  assert.equal(n.tone, 'warn');
  assert.deepEqual(n.items, []);
  assert.equal(by(all({ needs: null })).needs.status, "Couldn't check what needs you");
  assert.equal(homeBadge({ count: 0, items: [], unread: ['Local AI'] }), '');
});

test('before the extra sources answer, Home shows its cards with "Checking…" instead of waiting', () => {
  const c = by(all({ needs: undefined, backups: undefined, latest: undefined }));
  assert.ok(!c.needs);
  assert.equal(c.system.status, 'Checking backups… · Pi 52 °C');
  assert.equal(c.media.status, 'Now playing: Arrival');
});

test('Workshop card offers Clear plate when the print is done', () => {
  const c = homeCards({ now: { printer: { state: 'idle', headline: 'Print done — clear the plate', actions: ['clear'] } }, at: AT, host: 'home.home.arpa' })
    .find((x) => x.key === 'workshop');
  assert.deepEqual(c.action, { label: 'Clear the plate', do: 'clear' });
  assert.equal(c.status, 'Print done — clear the plate');
  assert.equal(c.tone, 'warn');
});

test('Workshop card keeps the Bambuddy link while printing', () => {
  const c = by(all()).workshop;
  assert.equal(c.action.label, 'Open Bambuddy ↗');
});

test('Workshop card stays red when the printer reports an error and the plate waits', () => {
  const c = homeCards({ now: { printer: { state: 'error', headline: 'Print failed — clear the plate', actions: ['clear'] } }, at: AT, host: 'home.home.arpa' })
    .find((x) => x.key === 'workshop');
  assert.equal(c.tone, 'bad');
  assert.equal(c.action.do, 'clear');
});

test('while a lab experiment prints, the printer card links the hub\'s /lab page; otherwise it does not', () => {
  const lab = { ...NOW, printer: { ...NOW.printer, lab: { experiment: 'E-020' } } };
  assert.deepEqual(by(all({ now: lab, host: '10.0.0.30' })).workshop.lab, { label: 'Print lab: E-020', href: '/lab?e=E-020' });
  assert.deepEqual(by(all({ now: lab })).workshop.lab, { label: 'Print lab: E-020', href: '/lab?e=E-020' });
  assert.equal(by(all()).workshop.lab, null);
  const odd = { ...NOW, printer: { ...NOW.printer, lab: { experiment: '"><img src=x>' } } };
  assert.equal(by(all({ now: odd })).workshop.lab, null);
  assert.deepEqual(labLink({ lab: { experiment: 'E-7' } }), { label: 'Print lab: E-7', href: '/lab?e=E-7' });
});

test("Home's summary line never repeats the Needs you count: the badge and the card say it (IMG_1047, 28 Oct)", () => {
  const item = (title, tone) => ({ title, tone, detail: '' });
  // the 28 Oct photo: "2" on the badge, "2 small things to check" over the card, "2 things" on the card
  assert.equal(needsSummary({ count: 2, items: [item('Failure detection', 'warn'), item('Worth a look', 'warn')] }, '1 small thing to check'), '');
  assert.equal(needsSummary({ count: 3, items: [item('Bambu X2D', 'bad'), item('Ad blocking', 'warn'), item('Worth a look', 'warn')] }, '2 things need a look'), '');
  assert.equal(needsSummary({ count: 1, items: [item('Ad blocking', 'warn')] }, 'Ad blocking needs a look'), '');
  // nothing on the card: the hub's own line still says so
  assert.equal(needsSummary({ count: 0, items: [] }, "Everything's running"), "Everything's running");
  assert.equal(needsSummary(null, 'Home status is unavailable'), 'Home status is unavailable');  // Needs you didn't answer
  assert.equal(needsSummary(undefined, "Everything's running"), "Everything's running");
});

test("the printer card's dot follows Needs you: amber for a printer item, red for a bad one (IMG_1047, 28 Oct)", () => {
  const blind = { id: 'pi:Failure detection', source: 'Pi Hub', tone: 'attention', title: 'Failure detection is blind', detail: '', about: 'printer' };
  const disk = { id: 'localai:watch-mac-disk', source: 'Local AI', tone: 'warn', title: 'Worth a look', detail: 'Mac disk is 95% full' };
  const needs = (...items) => ({ count: items.length, items, unread: [] });
  assert.equal(by(all({ needs: needs(disk) })).workshop.tone, 'ok');  // nothing about the printer: printing stays green
  assert.equal(by(all({ needs: needs(blind, disk) })).workshop.tone, 'warn');
  assert.equal(by(all({ needs: needs({ ...blind, tone: 'warn' }) })).workshop.tone, 'warn');
  assert.equal(by(all({ needs: needs(disk, { ...blind, tone: 'bad' }) })).workshop.tone, 'bad');
  assert.equal(by(all({ needs: undefined })).workshop.tone, 'ok');  // Needs you hasn't answered yet
  assert.equal(by(all({ needs: null })).workshop.tone, 'ok');
  const error = { ...NOW, printer: { state: 'error' } };
  assert.equal(by(all({ now: error, needs: needs(blind) })).workshop.tone, 'bad');  // never softened
  const done = { printer: { state: 'idle', headline: 'Print done — clear the plate', actions: ['clear'] } };
  assert.equal(by(all({ now: done, needs: needs({ ...blind, tone: 'bad' }) })).workshop.tone, 'bad');
});

test("the blind failure-detection item's link opens Bambuddy's Failure detection settings", async () => {
  const { resolveLink } = await import('../hub/static/js/sections.js');
  const link = 'tool:bambuddy/settings?tab=failure-detection';
  assert.equal(resolveLink(link, 'home.home.arpa'), 'https://bambuddy.home.arpa/settings?tab=failure-detection');
  assert.equal(resolveLink(link, '10.0.0.30'), 'http://10.0.0.30:8000/settings?tab=failure-detection');
});

test("the Mac disk item's link opens the Assistant with the question (its #ask?context= hand-off)", async () => {
  const { resolveLink } = await import('../hub/static/js/sections.js');
  const link = 'tool:assistant/#ask?context=Pi%20Hub%20%E2%80%BA%20Mac%20disk%20is%2095%25%20full.%20What\'s%20using%20the%20space%3F';
  const url = new URL(resolveLink(link, '10.0.0.30'));
  assert.equal(url.origin, 'https://10.0.0.21');
  assert.equal(decodeURIComponent(url.hash.split('context=')[1]), "Pi Hub › Mac disk is 95% full. What's using the space?");
  assert.ok(resolveLink(link, 'home.home.arpa').startsWith('https://assistant.home.arpa/#ask?context='));
});
