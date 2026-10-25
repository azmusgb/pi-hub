import test from 'node:test';
import assert from 'node:assert/strict';
import { homeCards, homeBadge } from '../hub/static/js/home-cards.js';

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
  assert.ok(!c.needs);
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
