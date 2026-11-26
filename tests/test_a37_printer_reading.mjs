// A37 R2: Pi Hub supplies facts and the kit writes the sentence. printerReading() maps the printer card (/api/now and
// /api/workshop give the same one) to the kit's reading; each case is then said by the real ApplianceSay.compose, so
// the two halves are tested together and no copy of the kit's words lives here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { printerReading } from '../hub/static/js/printer-reading.js';

const kit = { exports: {} };
new Function('module', readFileSync(new URL('../hub/static/ui/say.js', import.meta.url), 'utf8'))(kit);
const Say = kit.exports;

const AS_OF = Date.UTC(2026, 10, 25, 20, 0, 0) / 1000;  // the card's as_of is in seconds
const NOW = AS_OF * 1000 + 20000;
const clock = (ms) => `t${Math.round((ms - AS_OF * 1000) / 60000)}`;  // minutes after the reading, so no time zone
const ago = (s) => `${Math.round(s / 60)} min ago`;
const say = (reading, now = NOW) => Say.compose({ page: 'printer', label: 'Printer', reading }, { now, clock, ago }).sentences;
const live = { status: 'live', source: 'Bambuddy' };
const card = (over = {}) => ({ state: 'printing', percent: 45, progress: 45, minutes_left: 376, job_name: 'Clip', stale: false,
  as_of: AS_OF, since: AS_OF - 3600, actions: ['pause'], telemetry: live, ...over });

test('no card yet is loading, never text', () => {
  assert.deepEqual(printerReading(null), { state: 'loading' });
  assert.equal(Say.compose({ page: 'printer', label: 'Printer', reading: printerReading(null) }, { now: NOW }).loading, true);
});

test('printing: live, with the percent, the job and an estimate counted from the reading, not from the clock', () => {
  const r = printerReading(card());
  assert.equal(r.state, 'live');
  assert.equal(r.status, 'printing');
  assert.equal(r.percent, 45);
  assert.equal(r.left_min, 376);
  assert.equal(r.done_at, AS_OF * 1000 + 376 * 60000);
  assert.equal(r.as_of, AS_OF * 1000);
  assert.deepEqual(say(r), ['The X2D is 45% through Clip.', 'About 6 h 16 min left, done around t376.']);
});

test('the job name goes through the title function the page gives', () => {
  const r = printerReading(card({ job_name: 'RIFT_TILE.gcode.3mf' }), { title: () => 'Rift tile' });
  assert.equal(r.job, 'Rift tile');
});

test('paused, finished, failed and idle each give their status', () => {
  assert.deepEqual(say(printerReading(card({ state: 'paused', minutes_left: null, actions: ['resume'] }))), ['The X2D is paused at 45%.']);
  assert.deepEqual(say(printerReading(card({ state: 'error', percent: 62, minutes_left: null, actions: [] }))), ['The X2D stopped at 62%.']);
  assert.deepEqual(say(printerReading(card({ state: 'idle', percent: null, minutes_left: null, job_name: null, actions: [] }))), ['The X2D is idle.']);
  const done = printerReading(card({ state: 'stopped', percent: null, minutes_left: null, since: AS_OF - 600, actions: ['clear'] }));
  assert.equal(done.status, 'finished');
  assert.equal(done.finished_at, (AS_OF - 600) * 1000);
  assert.equal(done.plate_ask, true);
  assert.deepEqual(say(done), ['The X2D finished Clip at t-10.', 'Clear the plate.']);
});

test('since is passed only for a finished print: an idle printer gets no finish time the hub did not read', () => {
  const idle = printerReading(card({ state: 'idle', percent: null, minutes_left: null, since: AS_OF - 600, actions: [] }));
  assert.equal('finished_at' in idle, false);
  assert.equal(printerReading(card()).finished_at, undefined);
  assert.equal(printerReading(card({ state: 'stopped', since: null })).finished_at, undefined);
});

test('a percent the card does not know stays unknown: progress 0 beside it is ignored', () => {
  const r = printerReading(card({ percent: null, progress: 0 }));
  assert.equal(r.percent, null);
  assert.deepEqual(say(r)[0], 'The X2D is printing Clip.');
  const old = printerReading({ ...card(), percent: undefined, progress: 45 });
  assert.equal(old.percent, null, 'a card from before PR A has no percent, and progress is not read in its place');
});

test('backup readings from the Pi are current: live, not past tense', () => {
  const r = printerReading(card({ telemetry: { status: 'degraded', source: "The Pi's status service" } }));
  assert.equal(r.state, 'live');
});

test('stale: past tense, with its age in milliseconds and the source that stopped answering', () => {
  const r = printerReading(card({ stale: true, minutes_left: null, actions: [], telemetry: { status: 'stale', source: 'Bambuddy' } }));
  assert.equal(r.state, 'stale');
  assert.equal(r.as_of, AS_OF * 1000);
  assert.equal(r.source, 'Bambuddy');
  assert.deepEqual(say(r, AS_OF * 1000 + 12 * 60000), ['The X2D was 45% through Clip 12 min ago.', "Bambuddy hasn't answered since t0."]);
  const flag = printerReading(card({ stale: true }));
  assert.equal(flag.state, 'stale', 'the stale flag alone is enough');
});

test('a stale reading carries no estimate and no plate ask', () => {
  const r = printerReading(card({ stale: true, actions: ['clear'], telemetry: { status: 'stale', source: 'Bambuddy' } }));
  assert.equal(r.left_min, undefined);
  assert.equal(r.done_at, undefined);
  assert.equal(r.plate_ask, undefined);
});

test('printer offline, as Bambuddy reports it, is unavailable', () => {
  const r = printerReading({ state: 'none', percent: null, stale: false, as_of: AS_OF, actions: [], telemetry: { status: 'offline', source: 'Bambuddy' } });
  assert.equal(r.state, 'unavailable');
  assert.deepEqual(say(r), ["The X2D isn't answering."]);
});

test('never read is unknown, never idle', () => {
  const r = printerReading({ state: 'none', actions: [], telemetry: { status: 'none', source: '', observed_at: null } });
  assert.equal(r.state, 'unknown');
  assert.deepEqual(say(r), ["The X2D hasn't reported yet."]);
});

test('a state or telemetry status this page does not know is unknown, never a guess', () => {
  assert.equal(printerReading(card({ state: 'calibrating' })).state, 'unknown');
  assert.equal(printerReading(card({ telemetry: { status: 'sideways' } })).state, 'unknown');
  assert.equal(printerReading(card({ telemetry: null })).state, 'unknown');
  assert.equal(printerReading('nonsense').state, 'unknown');
});

test('down: the hub did not answer, so the last card is said in the past tense with Pi Hub as the silent source', () => {
  const r = printerReading(null, { failed: true, last: card() });
  assert.equal(r.state, 'stale');
  assert.equal(r.source, 'Pi Hub');
  assert.equal(r.status, 'printing');
  assert.equal(r.left_min, undefined);
  assert.deepEqual(say(r, AS_OF * 1000 + 12 * 60000), ['The X2D was 45% through Clip 12 min ago.', "Pi Hub hasn't answered since t0."]);
});

// Found by the QA gate: the hub answered seconds ago with a stale card; the party silent since that card's time is
// Bambuddy. Blaming Pi Hub with Bambuddy's time states something the hub did not read.
test('down with a last card that was already stale keeps that card\'s own source and age', () => {
  const r = printerReading(null, { failed: true, last: card({ stale: true, as_of: AS_OF - 300, telemetry: { status: 'stale', source: 'Bambuddy' } }) });
  assert.equal(r.state, 'stale');
  assert.equal(r.as_of, (AS_OF - 300) * 1000);
  assert.equal(r.source, 'Bambuddy');
  assert.deepEqual(say(r, AS_OF * 1000 + 19 * 60000), ['The X2D was 45% through Clip 24 min ago.', "Bambuddy hasn't answered since t-5."]);
});

// Found by the QA gate: a stale record whose last state was offline or unknown has reported before, so "hasn't
// reported yet" is false; nothing is known and the source is quiet.
test('a stale card with no status is unavailable, not "hasn\'t reported yet"', () => {
  const r = printerReading({ state: 'none', stale: true, as_of: AS_OF, actions: [], telemetry: { status: 'stale', source: 'Bambuddy' } });
  assert.deepEqual(r, { state: 'unavailable' });
  assert.deepEqual(printerReading(null, { failed: true, last: { state: 'none', stale: true, telemetry: { status: 'stale' } } }), { state: 'unavailable' });
});

test('down with nothing read before, or only an unknown card, is unavailable', () => {
  assert.deepEqual(printerReading(null, { failed: true }), { state: 'unavailable' });
  assert.deepEqual(printerReading(null, { failed: true, last: { state: 'none', telemetry: { status: 'none' } } }), { state: 'unavailable' });
  assert.deepEqual(say(printerReading(null, { failed: true })), ["The X2D isn't answering."]);
});

test('unusable numbers are dropped, not passed on', () => {
  const r = printerReading(card({ percent: 'lots', minutes_left: 'soon', as_of: 'now', since: NaN }));
  assert.equal(r.percent, null);
  assert.equal(r.left_min, undefined);
  assert.equal(r.done_at, undefined);
  assert.equal(r.as_of, undefined);
});
