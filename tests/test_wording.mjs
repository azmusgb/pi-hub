import test from 'node:test';
import assert from 'node:assert/strict';
import { agoText, applianceLabel, groupAppliances, mergeDropouts, printWords, printLabText, plainInternet } from '../hub/static/js/wording.js';

test('backup and event ages read like speech', () => {
  assert.equal(agoText(0), 'less than an hour ago');
  assert.equal(agoText(1), '1 h ago');
  assert.equal(agoText(30), '30 h ago');
  assert.equal(agoText(50), '2 days ago');
  assert.equal(agoText(null), 'never');
});

const sw = (id, name, room = 'Bosch', on = false) => ({ id, name, room, kind: 'switch', on });
test('an appliance whose functions arrive as separate switches becomes one card', () => {
  const accessories = [
    { id: 'l', name: 'Workshop Light', room: 'Workshop', kind: 'light', on: true },
    sw('p', 'Dishwasher Power', 'Bosch', true), sw('a', 'Dishwasher Active Program'),
    sw('1', 'Auto'), sw('2', 'Normal', 'Bosch', true), sw('3', 'Rinse'), sw('4', 'Speed 60'),
  ];
  const { appliances, rest } = groupAppliances(accessories);
  assert.deepEqual(rest.map((a) => a.id), ['l']);
  assert.equal(appliances.length, 1);
  const d = appliances[0];
  assert.equal(d.name, 'Dishwasher');
  assert.equal(d.power.id, 'p');
  assert.equal(d.running.id, 'a');
  assert.deepEqual(d.programs.map((p) => p.name), ['Auto', 'Normal', 'Rinse', 'Speed 60']);
  assert.equal(d.status, 'On · Normal selected');
  assert.equal(groupAppliances([sw('x', 'Fan', 'Kitchen'), sw('y', 'Pump', 'Kitchen')]).appliances.length, 0);
});

test('a device that drops out and comes back many times in a day is one line', () => {
  const day = new Date(2026, 9, 24, 12).getTime() / 1000;
  const alerts = [];  // newest first, as /api/alerts gives them
  for (let i = 0; i < 4; i++) {
    alerts.push({ ts: day - i * 600, title: 'Workshop display is back', body: '', tag: 'white_check_mark' });
    alerts.push({ ts: day - i * 600 - 300, title: 'Workshop display went offline', body: '', tag: 'warning' });
  }
  alerts.push({ ts: day - 5000, title: 'X2D print finished', body: 'Cube', tag: 'tada' });
  const out = mergeDropouts(alerts);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Workshop display dropped out 4 times');
  assert.equal(out[0].body, 'Back now');
  assert.equal(out[0].tag, 'warning');
  assert.equal(out[1].title, 'X2D print finished');
  const once = mergeDropouts(alerts.slice(0, 2));
  assert.deepEqual(once.map((a) => a.title), ['Workshop display is back', 'Workshop display went offline']);
});

test('the internet summary is in plain words', () => {
  assert.equal(plainInternet({ status: 'ok', wan_ms: 9.5, orbi_down_mbps: 20.96, orbi_up_mbps: 2.5 }), 'Internet OK · 21 Mbps down, 2.5 up');
  assert.equal(plainInternet({ status: 'ok', wan_ms: 400 }), 'Internet slow');
  assert.equal(plainInternet({ status: 'bad' }), 'Internet down');
  assert.equal(plainInternet(null), "Network checks aren't answering");
});

const at = (y, m, d, hh, mm) => new Date(y, m, d, hh, mm).getTime() / 1000;
const alert = (ts, title, tag = 'warning') => ({ ts, title, body: '', tag });

test('only things that come back are merged as dropouts; stopped prints and crashes stay as they are', () => {
  const out = mergeDropouts([
    alert(at(2026, 9, 24, 18, 0), 'X2D print stopped'), alert(at(2026, 9, 24, 17, 0), 'X2D print stopped'),
    alert(at(2026, 9, 24, 16, 0), 'Plex stopped'), alert(at(2026, 9, 24, 15, 0), 'Plex stopped'),
  ]);
  assert.deepEqual(out.map((a) => a.title), ['X2D print stopped', 'X2D print stopped', 'Plex stopped', 'Plex stopped']);
});

test('the PC going down and coming back merges too', () => {
  const out = mergeDropouts([
    alert(at(2026, 9, 24, 12, 30), 'Windows PC is back', 'white_check_mark'), alert(at(2026, 9, 24, 12, 20), 'Windows PC is down'),
    alert(at(2026, 9, 24, 12, 10), 'Windows PC is back', 'white_check_mark'), alert(at(2026, 9, 24, 12, 0), 'Windows PC is down'),
  ]);
  assert.deepEqual(out.map((a) => [a.title, a.body]), [['Windows PC dropped out 2 times', 'Back now']]);
});

test('back after midnight counts as back for the day before', () => {
  const out = mergeDropouts([
    alert(at(2026, 9, 25, 0, 10), 'Movies drive is back', 'white_check_mark'),
    alert(at(2026, 9, 24, 23, 50), 'Movies drive dropped out'),
    alert(at(2026, 9, 24, 23, 45), 'Movies drive is back', 'white_check_mark'),
    alert(at(2026, 9, 24, 23, 40), 'Movies drive dropped out'),
  ]);
  const merged = out.find((a) => a.title === 'Movies drive dropped out 2 times');
  assert.equal(merged.body, 'Back now');
  assert.equal(merged.tag, 'warning');
});

test('only known appliances are grouped; three switches from one maker are not', () => {
  const tp = ['Fountain Power', 'Kitchen Lamp', 'Fan'].map((n, i) => ({ id: `t${i}`, name: n, room: 'TP-Link', kind: 'switch', on: false }));
  const { appliances, rest } = groupAppliances(tp);
  assert.equal(appliances.length, 0);
  assert.equal(rest.length, 3);
});

test('an appliance switch shown on its own carries the appliance name', () => {
  assert.equal(applianceLabel({ name: 'Heavy', room: 'Bosch' }), 'Dishwasher: Heavy');
  assert.equal(applianceLabel({ name: 'Dishwasher Power', room: 'Bosch' }), 'Dishwasher Power');
  assert.equal(applianceLabel({ name: 'Kitchen Lamp', room: 'TP-Link' }), 'Kitchen Lamp');
});

test('a missing upload speed is left out, not shown as 0', () => {
  assert.equal(plainInternet({ status: 'ok', wan_ms: 9, orbi_down_mbps: 20.4, orbi_up_mbps: null }), 'Internet OK · 20 Mbps down');
});

test('a print row reads its word from the print log and its tone from the status', () => {
  assert.deepEqual(printWords({ status: 'completed', word: 'Finished' }), ['Finished', 'ok']);
  assert.deepEqual(printWords({ status: 'failed', word: 'Failed' }), ['Failed', 'bad']);
  assert.deepEqual(printWords({ status: 'cancelled', word: 'Cancelled' }), ['Cancelled', 'warn']);
  assert.deepEqual(printWords({ status: 'printing', word: 'Printing' }), ['Printing', 'ok']);
  assert.deepEqual(printWords({ status: 'skipped', word: 'Skipped' }), ['Skipped', 'warn']);
});

test('a print row says which lab build it is, or that it is outside the lab', () => {
  assert.equal(printLabText({ lab: { exp: 'E-023', build: 'BLD-023-01' } }), 'E-023 · BLD-023-01');
  assert.equal(printLabText({ lab: null }), 'Outside the lab');
});
