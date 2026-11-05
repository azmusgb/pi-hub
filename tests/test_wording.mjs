import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agoText, applianceControls, applianceLabel, groupAppliances, laundryLine, printWords, printLabText, printErrorCode, printSeconds, weekPill, plainInternet, workshopDisplayLabel } from '../hub/static/js/wording.js';

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

test('an appliance card switches only its power: no program or running switch to start a wash by accident', () => {
  const { appliances } = groupAppliances([sw('p', 'Dishwasher Power'), sw('a', 'Dishwasher Active Program'), sw('1', 'Auto')]);
  assert.deepEqual(applianceControls(appliances[0]).map((a) => a.id), ['p']);
  assert.deepEqual(applianceControls(appliances[0], new Set(['p'])), []);  // already in Favourites
  assert.deepEqual(applianceControls({ power: null, running: null, programs: [] }), []);
});

test('the internet summary is in plain words', () => {
  assert.equal(plainInternet({ status: 'ok', wan_ms: 9.5, orbi_down_mbps: 20.96, orbi_up_mbps: 2.5 }), 'Internet OK · using 21 Mbps down, 2.5 up');
  assert.equal(plainInternet({ status: 'ok', wan_ms: 400 }), 'Internet slow');
  assert.equal(plainInternet({ status: 'bad' }), 'Internet down');
  assert.equal(plainInternet(null), "Network checks aren't answering");
});

const at = (y, m, d, hh, mm) => new Date(y, m, d, hh, mm).getTime() / 1000;
const alert = (ts, title, tag = 'warning') => ({ ts, title, body: '', tag });

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
  // The Govee plugin names its devices by device id; the page says what each is.
  assert.equal(applianceLabel({ name: '0EEAC47545E6515C', room: 'Govee' }), 'Permanent Lights');
  assert.equal(applianceLabel({ name: '0EFBEA1B882AED13', room: 'Govee' }), 'Wall Light Pro 1');
  assert.equal(applianceLabel({ name: '0F8CE1F8C532B55B', room: 'Govee' }), 'Wall Light Pro 2');
});

test('a missing upload speed is left out, not shown as 0', () => {
  assert.equal(plainInternet({ status: 'ok', wan_ms: 9, orbi_down_mbps: 20.4, orbi_up_mbps: null }), 'Internet OK · using 20 Mbps down');
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

test('only a printer-looking code gets a help link; free text stays plain', () => {
  assert.equal(printErrorCode('HMS_0300_0100_0001_0007'), '0300_0100_0001_0007');
  assert.equal(printErrorCode('0300_0100_0001_0007'), '0300_0100_0001_0007');
  assert.equal(printErrorCode('Filament ran out'), null);
  assert.equal(printErrorCode(null), null);
});

test('a print row length: running shows none, ended falls back to start and end', () => {
  assert.equal(printSeconds({ status: 'printing', started: 100, ended: null }), null);
  assert.equal(printSeconds({ status: 'failed', seconds: 90, started: 1, ended: 500 }), 90);
  assert.equal(printSeconds({ status: 'failed', seconds: null, started: 100, ended: 400 }), 300);
  assert.equal(printSeconds({ status: 'failed', seconds: null, started: null, ended: 400 }), null);
});

test('the week pill never invents zeros when the print log is missing', () => {
  assert.deepEqual(weekPill({ finished: 2, hours: 3 }), { pill: '2 finished this week', tone: 'ok' });
  assert.deepEqual(weekPill(null), { pill: 'No answer', tone: 'warn' });
});

test('the workshop display chip says on, off, or the word as it came', () => {
  assert.equal(workshopDisplayLabel('Online'), 'on');
  assert.equal(workshopDisplayLabel('Offline'), 'off');
  assert.equal(workshopDisplayLabel('Sleeping'), 'Sleeping');
});

test('the wall printer tile: short title, real external Bambuddy link, new HUD wording', () => {
  const now = readFileSync(new URL('../hub/static/js/now.js', import.meta.url), 'utf8');
  assert.match(now, /h\("h2", \{\}, "Bambu X2D"\)/);
  assert.doesNotMatch(now, /Bambu X2D Workshop|WS350/);
  assert.match(now, /`Display: \$\{workshopDisplayLabel\(w\.display\)\}`/);  // under the Workshop heading
  assert.match(now, /href: toolUrl\("bambuddy"\), target: "_blank", rel: "noopener" \}, "Open Bambuddy ↗"/);
  assert.doesNotMatch(now, /href: "\/bambuddy"/);
});

test('laundry lines say what each machine is doing, read-only', () => {
  const clock = (s) => (s === 1000 ? '12:46' : '?');
  const line = (m) => laundryLine({ name: 'Washer', minutes_left: null, ended_at: null, ...m }, clock);
  assert.equal(line({ state: 'idle' }), 'Washer: idle');
  assert.equal(line({ state: 'running', minutes_left: 32 }), 'Washer: running · 32 min left');
  assert.equal(line({ state: 'running', minutes_left: 65 }), 'Washer: running · 1 h 5 min left');
  assert.equal(line({ state: 'running' }), 'Washer: running');
  assert.equal(line({ state: 'paused', minutes_left: 12 }), 'Washer: paused · 12 min left');
  assert.equal(line({ state: 'scheduled' }), 'Washer: delayed start');
  assert.equal(line({ state: 'done', ended_at: 1000 }), 'Washer: done at 12:46');
  assert.equal(line({ state: 'done' }), 'Washer: done');
  assert.equal(line({ state: 'fault', name: 'Dryer' }), 'Dryer: needs attention');
  assert.equal(line({ state: 'offline', name: 'Dishwasher' }), 'Dishwasher: not connected');
  assert.equal(line({ state: 'unknown' }), 'Washer: state unknown');
});
