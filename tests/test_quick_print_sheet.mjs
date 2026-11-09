// A19 P6: the Print section's sheet. Prepare starts nothing, Start needs both ticks, a start the hub can't vouch for is said plainly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';
import * as q from '../hub/static/js/quick.js';

install(); // the pure sheet builders need a document

const JOB = { id: 'aaaaaaaaaaaaaaaa', state: 'staged', name: 'part.stl', reason: null, slice_info: { minutes: 42 }, slice_sha256: 'a'.repeat(64) };
const OK = { reasons: [], bed_only: false, needs: ['PLA'], hold: null, last: null };
const btn = (el, label) => el.querySelectorAll('button').find((b) => text(b) === label);
const boxes = (el) => el.querySelectorAll('input[type=checkbox]');
const calls = () => { const c = []; const f = (n) => () => c.push(n); return { c, h: { onPrepare: f('prepare'), onUnprepare: f('unprepare'), onStart: (w) => c.push(w ? 'start-wait' : 'start'), onResolve: f('resolve'), onCancelHold: f('cancel') } }; };

test('a sliced job offers Prepare and says it starts nothing', () => {
  const { c, h } = calls();
  const el = q.printBody({ ...JOB, state: 'sliced' }, null, h);
  assert.match(text(el), /does not start the printer/);
  assert.deepEqual(el.querySelectorAll('button').map(text), ['Prepare to print']);
  btn(el, 'Prepare to print').click();
  assert.deepEqual(c, ['prepare']);
});

test('a failed Prepare shows its reason on the sliced job', () => {
  const el = q.printBody({ ...JOB, state: 'sliced', reason: 'Bambuddy already holds an identical file.' }, null, calls().h);
  assert.match(text(el), /identical file/);
});

test('Start stays off until both ticks, and says why', () => {
  const { h } = calls();
  let el = q.printBody(JOB, OK, { ...h, ticks: { plate: false, filament: false } });
  assert.equal(btn(el, 'Start print').disabled, true);
  assert.match(text(el), /Tick both first/);
  el = q.printBody(JOB, OK, { ...h, ticks: { plate: true, filament: false } });
  assert.equal(btn(el, 'Start print').disabled, true);
  el = q.printBody(JOB, OK, { ...h, ticks: { plate: true, filament: true } });
  assert.equal(btn(el, 'Start print').disabled, false);
  assert.equal(boxes(el).length, 2);
  assert.deepEqual(boxes(el).map((b) => b.checked), [true, true]);
  assert.match(text(el), /The plate is clear and dry/);
  assert.match(text(el), /The filament matches/);
});

test('with both ticks the tap starts; nothing starts from the sheet before it', () => {
  const { c, h } = calls();
  const el = q.printBody(JOB, OK, { ...h, ticks: { plate: true, filament: true } });
  assert.deepEqual(c, []);
  btn(el, 'Start print').click();
  assert.deepEqual(c, ['start']);
});

test('a refusing printer turns Start off and names every reason', () => {
  const { h } = calls();
  const el = q.printBody(JOB, { ...OK, reasons: ['The printer has an error. Clear it on the printer first.'] }, { ...h, ticks: { plate: true, filament: true } });
  assert.equal(btn(el, 'Start print').disabled, true);
  assert.match(text(el), /has an error/);
  assert.match(text(el), /Not ready/);
});

test('a warm bed alone becomes "Start when the bed is cool", and waiting is shown and cancelable', () => {
  const { c, h } = calls();
  const warm = { ...OK, reasons: ['The bed is 60 °C; wait until it is below 35 °C.'], bed_only: true };
  let el = q.printBody(JOB, warm, { ...h, ticks: { plate: true, filament: true } });
  assert.equal(btn(el, 'Start print'), undefined);
  btn(el, 'Start when the bed is cool').click();
  assert.deepEqual(c, ['start-wait']);
  el = q.printBody(JOB, { ...warm, hold: { bed: 55.2, minutes: 45, expires: 5 } }, h);
  assert.match(text(el), /Waiting for the bed to cool \(the bed is 55 °C\)/);
  assert.equal(btn(el, 'Start when the bed is cool'), undefined);
  btn(el, 'Cancel waiting').click();
  assert.deepEqual(c, ['start-wait', 'cancel']);
});

test('a printer the hub cannot read never reads as Ready and keeps Start off', () => {
  const el = q.printBody(JOB, null, { ...calls().h, ticks: { plate: true, filament: true } });
  assert.equal(btn(el, 'Start print').disabled, true);
  assert.match(text(el), /Can't read/);
  assert.doesNotMatch(text(el), /Ready\b.*connected, idle/);
});

test('how the last wait ended is shown', () => {
  const el = q.printBody(JOB, { ...OK, last: { status: 'expired', say: 'Waited 45 minutes for the bed to cool. Nothing was sent.' } }, calls().h);
  assert.match(text(el), /Nothing was sent/);
});

test('after the tap the sheet says sent, and Printing only when the hub saw it print', () => {
  for (const state of ['queued_in_bambuddy', 'start_requested', 'start_accepted']) {
    const t = text(q.printBody({ ...JOB, state }, null, calls().h));
    assert.match(t, /only once the hub sees the printer printing/);
    assert.doesNotMatch(t, /^Printing/);
  }
  assert.match(text(q.printBody({ ...JOB, state: 'printing_confirmed' }, null, calls().h)), /Printing\. The hub saw the printer print this job/);
});

test('an uncertain outcome is bad, says it will not retry, and offers only the careful way back', () => {
  const { c, h } = calls();
  const el = q.printBody({ ...JOB, state: 'outcome_uncertain', reason: 'Not sure whether it started (no answer from Bambuddy).' }, null, h);
  assert.equal(el.querySelectorAll('.ui-notice--bad').length, 1);
  assert.match(text(el), /will not send it again by itself/);
  assert.deepEqual(el.querySelectorAll('button').map(text), ["It isn't printing: go back"]);
  el.querySelectorAll('button')[0].click();
  assert.deepEqual(c, ['resolve']);
});

test('preparing shows progress and no buttons', () => {
  const el = q.printBody({ ...JOB, state: 'staging' }, null, calls().h);
  assert.equal(el.querySelectorAll('button').length, 0);
  assert.match(text(el), /byte for byte/);
});

test('no job, a draft and a failed job offer nothing to print', () => {
  for (const job of [null, { ...JOB, state: 'draft' }, { ...JOB, state: 'failed' }, { ...JOB, state: 'stale' }]) {
    assert.equal(q.printBody(job, null, calls().h).querySelectorAll('button').length, 0);
  }
});

test('every printed string is free of null, undefined and NaN', () => {
  const states = ['sliced', 'staging', 'staged', 'queued_in_bambuddy', 'start_requested', 'start_accepted', 'printing_confirmed', 'outcome_uncertain'];
  for (const state of states) {
    const t = text(q.printBody({ ...JOB, state, slice_info: null, reason: null }, state === 'staged' ? { reasons: [], needs: [] } : null, calls().h));
    assert.doesNotMatch(t, /\bnull\b|undefined|NaN/, state);
  }
});

async function page(routes) {
  const dom = install({ fetch: routes });
  globalThis.matchMedia ||= () => ({ matches: false });
  globalThis.history ||= { replaceState() {} };
  (await import('../hub/static/js/core.js')).forgetMe();
  const state = { root: dom.root() };
  q.mount(state);
  await q.load(state);
  return { dom, state };
}

test('page: a prepared job loads its start check and the ticks survive the 10 s refresh', async () => {
  const seen = [];
  const { dom, state } = await page((url) => {
    seen.push(url);
    if (url.startsWith('/api/quick/jobs/aaaaaaaaaaaaaaaa/start')) return OK;
    if (url.startsWith('/api/quick/jobs')) return { jobs: [{ ...JOB, settings: {}, transform: null, model_bytes: 10, model_sha256: 'b'.repeat(64), request_hash: 'c', file_removed: 0, created: 1, updated: 2, can_reprint_file: true }] };
    if (url.startsWith('/api/quick/worker')) return { state: 'idle' };
    return { items: [] };
  });
  try {
    assert.ok(seen.some((u) => u.startsWith('/api/quick/jobs/aaaaaaaaaaaaaaaa/start')));
    const sheet = state.root.querySelector('#quick-print-section');
    assert.match(text(sheet), /part\.stl is ready/);
    const plate = sheet.querySelector('#quick-tick-plate');
    plate.checked = true;
    plate.dispatchEvent({ type: 'change' });
    await q.load(state); // the 10 s refresh with nothing changed keeps what was drawn
    assert.equal(state.root.querySelector('#quick-tick-plate').checked, true);
    assert.equal(state.root.querySelector('#quick-print-section').querySelectorAll('button').map(text).includes('Start print'), true);
  } finally { dom.restore?.(); }
});
