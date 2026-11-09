// A19 P8: the Print section after Start. Figures only as reported, stale and disconnected said, the outcome and its comparison, Reprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';
import * as q from '../hub/static/js/quick.js';

install();

const JOB = { id: 'aaaaaaaaaaaaaaaa', state: 'printing_confirmed', name: 'part.stl', reason: null, file_removed: 0, outcome: null };
const MON = (printer, extra = {}) => ({ printer: { source: 'ok', this_job: true, state: 'RUNNING', progress: 41.4, layer: 12, total_layers: 80, remaining_minutes: 95, nozzle: 215, nozzle_target: 220, bed: 60, bed_target: 60, ...printer }, actions: ['pause'], outcome: null, compare: null, ...extra });
const btn = (el, label) => el.querySelectorAll('button').find((b) => text(b) === label);

test('printing shows the printer\'s figures as reported', () => {
  const el = q.printBody(JOB, null, { monitor: MON({}), onAction: () => {} });
  const t = text(el);
  assert.match(t, /41%/); assert.match(t, /12 of 80/); assert.match(t, /1 h 35 min/); assert.match(t, /215 °C \(target 220 °C\)/);
  assert.match(t, /only when Bambuddy's print log says so/);
});

test('a missing figure reads Not reported, never 0', () => {
  const t = text(q.printBody(JOB, null, { monitor: MON({ nozzle: null, nozzle_target: null, bed: null, bed_target: null, progress: null, remaining_minutes: null, layer: null }), onAction: () => {} }));
  assert.equal((t.match(/Not reported/g) || []).length >= 5, true);
  assert.doesNotMatch(t, /0 °C|0%|\b0 min/);
});

test('a printer the hub can\'t read, or that is disconnected, is said', () => {
  const none = text(q.printBody(JOB, null, { monitor: MON({ source: 'unavailable', state: null, this_job: null, progress: null }), onAction: () => {} }));
  assert.match(none, /Can't read/); assert.match(none, /couldn't read the printer just now/);
  const dis = text(q.printBody(JOB, null, { monitor: MON({ source: 'disconnected', progress: null }), onAction: () => {} }));
  assert.match(dis, /Disconnected/);
  assert.match(text(q.printBody(JOB, null, { monitor: null, onAction: () => {} })), /couldn't read the printer's status just now, so no figures/);
});

test('stale figures are marked stale, and another job on the printer is said', () => {
  assert.match(text(q.printBody(JOB, null, { monitor: MON({}), monitorStale: '3 min ago', onAction: () => {} })), /stale: the hub last read the printer 3 min ago/);
  assert.match(text(q.printBody(JOB, null, { monitor: MON({ this_job: false }), onAction: () => {} })), /isn't showing this job right now/);
});

test('pause is the existing printer action; there is no stop button', () => {
  const calls = [];
  const el = q.printBody(JOB, null, { monitor: MON({}), onAction: (a) => calls.push(a) });
  assert.deepEqual(el.querySelectorAll('button').map(text), ['Pause the print']);
  btn(el, 'Pause the print').click();
  assert.deepEqual(calls, ['pause']);
  assert.match(text(el), /no stop of its own/);
});

test('finished shows the outcome and the estimate beside what happened, and Reprint', () => {
  const job = { ...JOB, state: 'finished', outcome: { word: 'Finished', status: 'completed', seconds: 3600, grams: 9.4 } };
  let n = 0;
  const el = q.printBody(job, null, { monitor: { outcome: job.outcome, compare: { estimate_minutes: 60, actual_minutes: 61, estimate_grams: null, actual_grams: 9.4 } }, onReprint: () => n++ });
  const t = text(el);
  assert.match(t, /print log says this print completed/); assert.match(t, /estimated 1 h 0 min/); assert.match(t, /1 h 1 min/);
  assert.match(t, /estimated Not reported/); assert.match(t, /9.4 g/); assert.match(t, /still needs Prepare and Start with both ticks/);
  btn(el, 'Reprint').click(); assert.equal(n, 1);
});

test('a failed print shows its reason and can be reprinted; a removed file asks for a new slice', () => {
  const job = { ...JOB, state: 'failed', reason: 'Bambuddy logged this print as Failed: spaghetti', outcome: { word: 'Failed', status: 'failed', seconds: 600, grams: 1 } };
  assert.match(text(q.printBody(job, null, { monitor: null })), /spaghetti/);
  const gone = text(q.printBody({ ...job, state: 'finished', file_removed: 1 }, null, { monitor: null }));
  assert.match(gone, /upload the model again/);
  assert.equal(btn(q.printBody({ ...job, file_removed: 1 }, null, { monitor: null }), 'Reprint'), undefined);
});

test('history rows carry the outcome\'s own figures and leave unknown ones out', () => {
  assert.equal(q.outcomeBits({ outcome: null }), '');
  assert.equal(q.outcomeBits({ outcome: { word: 'Finished', seconds: 3660, grams: 9.4 } }), ' · Finished · 61 min · 9.4 g');
  assert.equal(q.outcomeBits({ outcome: { word: 'Cancelled', seconds: null, grams: null } }), ' · Cancelled');
  assert.deepEqual(q.stateLamp('finished'), ['ok', 'Finished']);
});
