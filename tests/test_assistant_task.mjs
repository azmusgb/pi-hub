// A34 P2n: the first native task's state machine (hub/static/js/assistant-task.js) against a scripted fixture of what
// /api/ai/tasks answers (tests/browser/fixtures/assistant/ai/tasks, which tests/test_assistant_api.py proves are the
// adapter's own answers over Local AI's replies). A fake clock and a fake tab: no timers, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyOf, createTask, KEY, POLL_MS, readCurrent, stepsOf, stepsText, submitTask, validRunId, writeCurrent } from '../hub/static/js/assistant-task.js';

const fx = (name) => JSON.parse(readFileSync(new URL(`./browser/fixtures/assistant/ai/tasks/run-fixture-${name}.json`, import.meta.url), 'utf8'));
const RUN = 'run-1790000000000-001a2b3';
const fail = (status, body) => Object.assign(new Error('x'), { status, body });
const unreachable = (why = 'unreachable') => ({ state: 'unreachable', fetched_at: 1, why });

function store(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

// A scripted hub: each read answers the next scripted reply (a body, or an Error to throw); every call is recorded.
function rig({ replies = [], posts = [], storage = store(), hiddenNow = false, runId = RUN } = {}) {
  const t = { now: 1_000_000, hidden: hiddenNow, reads: [], posts: [] };
  const queue = [...replies], pq = [...posts];
  const next = async (q, rec, path, opts) => {
    rec.push({ path, opts });
    const r = q.length > 1 ? q.shift() : q[0];
    if (r instanceof Error) throw r;
    return r;
  };
  const task = createTask({ runId, storage, now: () => t.now, hidden: () => t.hidden,
    api: (path) => next(queue, t.reads, path), post: (path, body) => next(pq, t.posts, path, body) });
  const seen = [];
  task.subscribe((m) => seen.push(m.phase));
  Object.assign(t, { task, m: task.model, storage, seen, advance: (ms) => { t.now += ms; } });
  return t;
}

test('queued, then running with steps from the workers, then completed with the answer; polling stops when it is over', async () => {
  const t = rig({ replies: [fx('queued'), fx('running'), fx('completed')] });
  assert.equal(t.m.phase, 'reading');
  await t.task.tick();
  assert.equal(t.m.phase, 'queued');
  assert.deepEqual(t.m.steps, null, 'no steps are made up before the workers exist');
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.m.phase, 'running');
  assert.deepEqual(t.m.steps, { done: 1, total: 5 });
  assert.equal(stepsText(t.m.steps), '1 of 5 steps');
  assert.equal(t.m.run.cancellable, true);
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.m.phase, 'completed');
  assert.match(t.m.mission.answer, /^Option A is cheapest\./);
  assert.deepEqual(t.m.steps, { done: 3, total: 3 });
  const reads = t.reads.length;
  for (let i = 0; i < 5; i++) { t.advance(POLL_MS * 10); await t.task.tick(); }
  assert.equal(t.reads.length, reads, 'a finished task is not polled again');
  assert.deepEqual(t.reads.map((r) => r.path), Array(3).fill(`/api/ai/tasks/${RUN}`));
});

test('polling is every 3 s: a tick before then reads nothing', async () => {
  const t = rig({ replies: [fx('running')] });
  await t.task.tick();
  t.advance(POLL_MS - 1);
  await t.task.tick();
  assert.equal(t.reads.length, 1);
  t.advance(1);
  await t.task.tick();
  assert.equal(t.reads.length, 2);
});

test('awaiting approval is its own phase, and so is a run Local AI interrupted at a restart: failed, with its reason', async () => {
  const t = rig({ replies: [fx('awaiting'), fx('failed')] });
  await t.task.tick();
  assert.equal(t.m.phase, 'awaiting_approval');
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.m.phase, 'failed');
  assert.equal(t.m.run.error, 'Run interrupted by appliance restart');
  assert.equal(t.m.missionRead, 'failed', 'a failed mission read is its own state, not "no steps"');
});

test('cancel asks once, shows cancelling, and ends on what Local AI says; it is never retried', async () => {
  const t = rig({ replies: [fx('running')], posts: [{ state: 'ok', fetched_at: 1, run: { ...fx('cancelled').run } }] });
  await t.task.tick();
  const done = t.task.cancel();
  assert.equal(t.m.phase, 'cancelling');
  await done;
  assert.equal(t.m.phase, 'cancelled');
  assert.equal(t.posts.length, 1);
  assert.deepEqual(t.posts[0].path, `/api/ai/tasks/${RUN}/cancel`);
  assert.equal(await t.task.cancel(), null, 'nothing to cancel any more');
  assert.equal(t.posts.length, 1);
});

test('cancel is only offered while the run says cancellable', async () => {
  const run = fx('running');
  run.run.cancellable = false;
  const t = rig({ replies: [run] });
  await t.task.tick();
  assert.equal(await t.task.cancel(), null);
  assert.equal(t.posts.length, 0);
});

test('a cancel Local AI refuses (409) goes back to what the run was, with its words, and does not retry', async () => {
  const t = rig({ replies: [fx('running')], posts: [fail(409, { state: 'not_cancellable', error: 'This run is not cancellable' })] });
  await t.task.tick();
  await t.task.cancel();
  assert.equal(t.m.phase, 'running');
  assert.equal(t.m.note, 'This run is not cancellable');
  assert.equal(t.posts.length, 1);
});

test('a cancel that did not arrive says so and is not retried; a cancel that is still in flight stays cancelling', async () => {
  for (const [post, words] of [[fail(503, unreachable()), /wasn't cancelled/], [fail(503, { state: 'needs_pc' }), /needs the PC/]]) {
    const t = rig({ replies: [fx('running')], posts: [post] });
    await t.task.tick();
    await t.task.cancel();
    assert.equal(t.m.phase, 'running');
    assert.match(t.m.note, words);
    assert.equal(t.posts.length, 1);
  }
  const running = { state: 'ok', run: { ...fx('running').run } };
  const t = rig({ replies: [fx('running'), fx('running'), fx('cancelled')], posts: [running] });
  await t.task.tick();
  await t.task.cancel();
  assert.equal(t.m.phase, 'cancelling', 'Local AI has not said cancelled yet');
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.m.phase, 'cancelling', 'a poll that still says running does not undo it');
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.m.phase, 'cancelled');
});

test('PC asleep or Local AI down while following is unreachable with the last seen time, never failed; it backs off and recovers on its own', async () => {
  const t = rig({ replies: [fx('running'), ...Array(5).fill(unreachable('pc_off')), fx('running')] });
  await t.task.tick();
  const seen = t.m.lastSeen;
  assert.ok(seen > 0);
  // How long each next read waits: step the clock and tick until the task reads again.
  const nextRead = async () => {
    let waited = 0;
    for (;;) {
      t.advance(500); waited += 500;
      const n = t.reads.length;
      await t.task.tick();
      if (t.reads.length > n) return waited;
      assert.ok(waited <= 40_000, 'a read is always due within 40 s');
    }
  };
  const gaps = [];
  for (let i = 0; i < 5; i++) {
    gaps.push(await nextRead());
    assert.equal(t.m.phase, 'unreachable');
    assert.equal(t.m.why, 'pc_off');
    assert.equal(t.m.lastSeen, seen, 'last seen is the last time Local AI answered');
    assert.equal(t.m.run.status, 'running', 'what was last known stays on the page');
  }
  assert.deepEqual(gaps, [3000, 6000, 12_000, 24_000, 30_000], 'the wait doubles from 3 s and is capped at 30 s');
  assert.ok(!t.seen.includes('failed'), 'never failed');
  await nextRead();
  assert.equal(t.m.phase, 'running', 'resumes by itself when the Assistant answers');
  assert.ok(t.m.lastSeen > seen);
  assert.equal(t.m.why, '');
  assert.equal(await nextRead(), 3000, 'and polls every 3 s again');
});

test('a Local AI 500 or 429 while following (the adapter says unreachable) keeps polling, keeps what was known, and recovers', async () => {
  // What GET /api/ai/tasks/<id> answers for a Local AI 500 or 429 (tests/test_assistant_api.py): never `refused`, which stops.
  const t = rig({ replies: [fx('running'), unreachable(), unreachable(), fx('completed')] });
  await t.task.tick();
  const seen = t.m.lastSeen;
  for (let i = 0; i < 2; i++) {
    t.advance(60_000);
    await t.task.tick();
    assert.equal(t.m.phase, 'unreachable');
    assert.equal(t.m.run.status, 'running', 'the last known run stays');
    assert.equal(t.m.lastSeen, seen);
  }
  assert.equal(t.reads.length, 3, 'it reads again after each one');
  t.advance(60_000);
  await t.task.tick();
  assert.equal(t.m.phase, 'completed');
  assert.ok(!t.seen.includes('refused') && !t.seen.includes('failed'));
});

test('the hub itself answering 500 or 429 while following is unreachable and keeps polling, never refused', async () => {
  for (const err of [fail(500, null), fail(429, { detail: 'Too many requests' }), fail(502, 'bad gateway')]) {
    const t = rig({ replies: [fx('running'), err, fx('running')] });
    await t.task.tick();
    t.advance(60_000);
    await t.task.tick();
    assert.equal(t.m.phase, 'unreachable');
    assert.equal(t.m.why, 'hub');
    t.advance(60_000);
    await t.task.tick();
    assert.equal(t.m.phase, 'running');
    assert.equal(t.reads.length, 3);
  }
});

test('the hub itself not answering is unreachable too (why: hub), not an error page', async () => {
  const t = rig({ replies: [new Error('The hub could not be reached.')] });
  await t.task.tick();
  assert.equal(t.m.phase, 'unreachable');
  assert.equal(t.m.why, 'hub');
});

test('a hidden tab reads nothing; coming back reads at once, past any backoff', async () => {
  const t = rig({ replies: [fx('running'), unreachable(), fx('running')] });
  await t.task.tick();
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.m.phase, 'unreachable');
  const reads = t.reads.length;
  t.hidden = true;
  for (let i = 0; i < 10; i++) { t.advance(POLL_MS * 5); await t.task.tick(); await t.task.tick({ force: true }); }
  assert.equal(t.reads.length, reads, 'nothing is read while hidden, not even a forced tick');
  t.hidden = false;
  t.task.resume();
  await t.task.tick();
  assert.equal(t.reads.length, reads + 1);
  assert.equal(t.m.phase, 'running');
});

test('leaving and coming back re-reads the run by its id, from this browser\'s one current task', async () => {
  const storage = store();
  writeCurrent({ runId: RUN, goal: 'Plan the week', startedAt: 5, lastSeen: 42_000 }, storage);
  const first = rig({ replies: [fx('running')], storage });
  assert.equal(first.m.goal, 'Plan the week');
  assert.equal(first.m.lastSeen, 42_000, 'last seen survives a reload');
  await first.task.tick();
  assert.equal(readCurrent(storage).lastSeen, first.m.lastSeen, 'and is kept up to date');
  // the page is left; a new one for the same id starts with nothing but the id and what the browser kept
  const back = rig({ replies: [unreachable('pc_off')], storage });
  assert.equal(back.m.phase, 'reading');
  await back.task.tick();
  assert.equal(back.m.phase, 'unreachable');
  assert.equal(back.m.lastSeen, first.m.lastSeen, 'last seen carries over, so a reload while the PC sleeps still says when');
  const after = rig({ replies: [fx('completed')], storage });
  await after.task.tick();
  assert.equal(after.m.phase, 'completed');
  assert.deepEqual(after.reads.map((r) => r.path), [`/api/ai/tasks/${RUN}`]);
});

test('another task\'s stored goal is not this one\'s', async () => {
  const storage = store();
  writeCurrent({ runId: 'run-other-12345', goal: 'Something else' }, storage);
  const t = rig({ replies: [fx('running')], storage });
  assert.equal(t.m.goal, '');
  assert.equal(t.m.lastSeen, 0);
});

test('a state this page does not know, a refusal and an unknown id each stop polling and are named', async () => {
  const odd = rig({ replies: [{ state: 'out_of_date', error: 'older' }] });
  await odd.task.tick();
  assert.equal(odd.m.phase, 'out_of_date');
  const refused = rig({ replies: [fail(401, null)] });
  await refused.task.tick();
  assert.equal(refused.m.phase, 'refused');
  assert.match(refused.m.error, /Sign in/);
  const storage = store();
  writeCurrent({ runId: RUN, goal: 'x' }, storage);
  const gone = rig({ replies: [{ state: 'not_found', error: 'Run not found' }], storage });
  await gone.task.tick();
  assert.equal(gone.m.phase, 'not_found');
  assert.equal(readCurrent(storage), null, 'a task Local AI no longer has is not kept as the current one');
  for (const t of [odd, refused, gone]) { const n = t.reads.length; t.advance(POLL_MS * 9); await t.task.tick(); assert.equal(t.reads.length, n); }
  const weird = rig({ replies: [{ state: 'ok', run: { status: 'teleporting' } }] });
  await weird.task.tick();
  assert.equal(weird.m.phase, 'out_of_date');
});

test('a busy answer keeps what is shown and slows down', async () => {
  const t = rig({ replies: [fx('running'), { state: 'busy' }, fx('running')] });
  await t.task.tick();
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.m.phase, 'running');
  t.advance(POLL_MS);
  await t.task.tick();
  assert.equal(t.reads.length, 2, 'it waits longer than 3 s after a busy answer');
});

test('overlapping ticks read once', async () => {
  const t = rig({ replies: [fx('running')] });
  await Promise.all([t.task.tick(), t.task.tick(), t.task.tick({ force: true })]);
  assert.equal(t.reads.length, 1);
});

test('an id is checked against the strict pattern', () => {
  for (const ok of [RUN, 'run-abc', 'a1b']) assert.ok(validRunId(ok), ok);
  for (const bad of ['', 'ab', '../x', 'run 1', 'run/1', 'run?x', '-run', 'a'.repeat(81), null, 5, 'run:1']) assert.ok(!validRunId(bad), String(bad));
});

test('stepsOf counts the workers Local AI calls complete, of all of them; none is no count', () => {
  assert.equal(stepsOf(null), null);
  assert.equal(stepsOf({ workers: [] }), null);
  assert.deepEqual(stepsOf({ workers: [{ state: 'complete' }, { state: 'running' }, { state: 'error' }] }), { done: 1, total: 3 });
  assert.equal(stepsText({ done: 1, total: 1 }), '1 of 1 step');
});

test('bodyOf reads the adapter\'s own refusal from a thrown error, and a bare failure is unreachable', () => {
  assert.deepEqual(bodyOf(fail(503, { state: 'needs_pc' })), { state: 'needs_pc' });
  assert.equal(bodyOf(fail(500, 'boom')).state, 'unreachable');
  assert.equal(bodyOf(fail(401, null)).state, 'refused');
  assert.equal(bodyOf(new Error('x')).state, 'unreachable');
});

// ---- submit ----

test('submit sends the trimmed goal, keeps the run id and goal as the one current task, and returns the id', async () => {
  const storage = store();
  const sent = [];
  const post = async (path, body) => { sent.push([path, body]); return { state: 'submitted', runId: RUN, threadId: 't-1', fetched_at: 1 }; };
  const r = await submitTask(post, '  Plan the week \n', { storage, now: () => 7 });
  assert.deepEqual(r, { ok: true, runId: RUN });
  assert.deepEqual(sent, [['/api/ai/tasks', { goal: 'Plan the week' }]]);
  assert.deepEqual(readCurrent(storage), { runId: RUN, goal: 'Plan the week', startedAt: 7, lastSeen: 7 });
  await submitTask(async () => ({ state: 'submitted', runId: 'run-second-1' }), 'Again', { storage });
  assert.equal(readCurrent(storage).runId, 'run-second-1', 'one current task');
});

test('submit refuses an empty or too long goal without asking the hub, and says what the hub and Local AI said otherwise', async () => {
  let asked = 0;
  const post = async () => { asked++; return {}; };
  for (const goal of ['', '   ', null, undefined, 5]) assert.equal((await submitTask(post, goal, { storage: store() })).ok, false);
  const long = await submitTask(post, 'x'.repeat(2001), { storage: store() });
  assert.match(long.error, /2,000/);
  assert.equal(asked, 0);
  const cases = [
    [fail(503, { state: 'needs_pc', error: 'Starting a task needs the PC.' }), 'needs_pc', /needs the PC/],
    [fail(400, { state: 'refused', error: 'Unknown model', installed: ['a'] }), 'refused', /Unknown model/],
    [fail(503, { state: 'unavailable', error: 'Models not checked' }), 'unavailable', /not checked/],
    [fail(503, { state: 'unreachable', error: "doesn't know whether the task started" }), 'unreachable', /doesn't know/],
    [fail(502, { state: 'out_of_date', error: 'older' }), 'out_of_date', /older/],
    [new Error('The hub could not be reached.'), 'unreachable', /^$/],
    [{ state: 'submitted', runId: '../x' }, 'submitted', /^$/],
  ];
  for (const [answer, state, words] of cases) {
    const storage = store();
    const r = await submitTask(async () => { if (answer instanceof Error || answer.status) throw answer; return answer; }, 'Do it', { storage });
    assert.equal(r.ok, false);
    assert.equal(r.state, state);
    assert.match(r.error, words);
    assert.equal(readCurrent(storage), null, 'a task that did not start is not the current one');
  }
});

test('the current task is read back only when it is well formed', () => {
  assert.equal(readCurrent(store()), null);
  assert.equal(readCurrent(store({ [KEY]: '{bad' })), null);
  assert.equal(readCurrent(store({ [KEY]: JSON.stringify({ runId: '../x' }) })), null);
  assert.equal(readCurrent({ getItem() { throw new Error('private mode'); } }), null);
});
