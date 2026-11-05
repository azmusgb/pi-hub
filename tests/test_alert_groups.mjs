// A7 P6, decision 5: the same alert on one day is one row with a count and a time range; a problem and its recovery
// share a cause (hub/system.py ALERT_CAUSES) and are one row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install } from './helpers/fake_dom.mjs';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime() / 1000;
const hot = (ts) => ({ ts, title: 'Pi is running hot', body: '81 °C.', tag: 'fire', cause: 'hot', side: 'problem' });
const cool = (ts) => ({ ts, title: 'Pi has cooled down', body: 'Pi has cooled down', tag: 'white_check_mark', cause: 'hot', side: 'recovery' });
const plexDown = (ts) => ({ ts, title: 'Plex stopped', body: 'Restart it.', tag: 'warning', cause: 'plex', side: 'problem' });
const plexUp = (ts) => ({ ts, title: 'Plex is running again', body: '', tag: 'white_check_mark', cause: 'plex', side: 'recovery' });

async function group(list) {
  const dom = install();
  try { return (await import('../hub/static/js/alerts.js')).groupAlerts(list); } finally { dom.uninstall(); }
}

test('two alerts and their recoveries, in order: two groups with the right counts', async () => {
  const g = await group([cool(at(5, 12, 8)), hot(at(5, 11)), plexUp(at(5, 10, 30)), cool(at(5, 9)), plexDown(at(5, 10)), hot(at(5, 4, 29))]);
  assert.equal(g.length, 2);
  const [h, p] = g;
  assert.equal(h.title, 'The Pi ran hot, then cooled down');
  assert.equal(h.count, 2);
  assert.equal(h.first, at(5, 4, 29));
  assert.equal(h.last, at(5, 12, 8));
  assert.equal(h.tone, 'ok');
  assert.equal(h.body, 'Back now.');
  assert.equal(p.title, 'Plex stopped, then ran again');
  assert.equal(p.count, 1);
});

test('out of order: the same groups', async () => {
  const g = await group([hot(at(5, 4, 29)), cool(at(5, 12, 8)), plexDown(at(5, 10)), hot(at(5, 11)), cool(at(5, 9)), plexUp(at(5, 10, 30))]);
  assert.deepEqual(g.map((x) => [x.cause, x.count]), [['hot', 2], ['plex', 1]]);
});

test('across midnight: each local day is its own group; whether it is over comes from the newest alert of all', async () => {
  const g = await group([hot(at(5, 23, 40)), cool(at(5, 23, 45)), hot(at(5, 23, 50)), cool(at(6, 0, 10))]);
  assert.equal(g.length, 2);
  const [today, before] = g;
  assert.deepEqual([today.count, today.body, today.problem], [1, '', false], 'a recovery alone is over');
  assert.deepEqual([before.count, before.body, before.problem, before.tone], [2, 'Back now.', false, 'ok'], 'back after midnight is back');
  const still = await group([hot(at(5, 23, 50)), cool(at(6, 0, 10)), hot(at(6, 1))]);
  assert.deepEqual(still.map((x) => [x.count, x.body, x.problem]), [[1, 'Still out.', true], [1, '81 °C.', true]]);
});

test('an alert with no pair repeats by its title; different titles are different rows; junk is dropped', async () => {
  const done = (ts, t) => ({ ts, title: t, body: 'Ready.', tag: 'tada', cause: `title:${t}`, side: 'event' });
  const g = await group([done(at(5, 9), 'X2D print finished'), done(at(5, 10), 'X2D print finished'), done(at(5, 11), 'Local AI: job A failed'),
    { ts: 'x', title: 'bad' }, null, { ts: at(5, 8) }]);
  assert.deepEqual(g.map((x) => [x.title, x.count]), [['Local AI: job A failed', 1], ['X2D print finished', 2]]);
  // An older hub's alert with no cause still groups by its title.
  const legacy = await group([{ ts: at(5, 9), title: 'Plex stopped', tag: 'warning' }, { ts: at(5, 10), title: 'Plex stopped', tag: 'warning' }]);
  assert.equal(legacy[0].count, 2);
});
