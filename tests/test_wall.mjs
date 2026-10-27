// The wall display's words (wall fits any screen, 26 Oct): the clock's parts, the Needs you tile and the extra tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clockParts, nextHours, printing, upcoming, wallNeeds } from '../hub/static/js/wall.js';

test('the clock splits the time from a small AM/PM, and 24-hour clocks have none', () => {
  assert.deepEqual(clockParts(new Date(2026, 9, 26, 12, 38), 'en-US'), { hm: '12:38', ampm: 'PM' });
  assert.deepEqual(clockParts(new Date(2026, 9, 26, 9, 5), 'en-US'), { hm: '9:05', ampm: 'AM' });
  assert.deepEqual(clockParts(new Date(2026, 9, 26, 21, 5), 'en-GB'), { hm: '21:05', ampm: '' });
});

test('Needs you lists the top items in order, and says All clear when nothing needs you', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t, i) => ({ title: t, tone: i ? 'warn' : 'bad', link: '/pi' }));
  const m = wallNeeds({ count: 7, items, unread: [] }, 5);
  assert.deepEqual(m.items.map((i) => i.title), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(m.more, 2);
  assert.equal(m.tone, 'bad');
  assert.equal(m.status, '7 things');
  assert.equal(wallNeeds({ count: 1, items: items.slice(1, 2), unread: [] }).status, '1 thing');

  const clear = wallNeeds({ count: 0, items: [], unread: [] });
  assert.equal(clear.clear, true);
  assert.equal(clear.status, 'All clear');
  assert.equal(clear.tone, 'ok');
});

test("Needs you says when it couldn't check, rather than All clear", () => {
  assert.equal(wallNeeds(null).status, "Couldn't check what needs you");
  assert.equal(wallNeeds(null).clear, false);
  assert.equal(wallNeeds({ count: 0, items: [], unread: ['Local AI'] }).status, "Couldn't check Local AI");
  assert.equal(wallNeeds(undefined).status, 'Checking…');
});

test('the extra tiles: the hours from now on, and events not long past', () => {
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17].map((hr) => ({ time: `2026-10-26T${String(hr).padStart(2, '0')}:00`, label: `${hr}`, temp: hr }));
  assert.deepEqual(nextHours(hours, new Date(2026, 9, 26, 10, 40)).map((x) => x.temp), [10, 11, 12, 13, 14, 15]);
  assert.deepEqual(nextHours(null), []);
  const now = Date.UTC(2026, 9, 26, 15, 0);
  const events = [{ title: 'old', start: now / 1000 - 3600 }, { title: 'all', all_day: true, start: 0 }, { title: 'soon', start: now / 1000 + 600 }];
  assert.deepEqual(upcoming(events, now).map((e) => e.title), ['all', 'soon']);
});

test('the printer counts as busy while printing or paused', () => {
  assert.equal(printing({ state: 'printing' }), true);
  assert.equal(printing({ state: 'paused' }), true);
  assert.equal(printing({ state: 'idle' }), false);
  assert.equal(printing(undefined), false);
});
