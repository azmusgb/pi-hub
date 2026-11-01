// labFetch (sign-in, plain errors) and watchRequests (one gentle poller). fetch, ensure and visibility are injected.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLab } from '../hub/static/js/lab.js';
import { labFetch, watchRequests, setDeps } from '../hub/static/js/lab-net.js';

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function rig(responses) {
  const calls = { fetch: [], ensure: 0 };
  const queue = [...responses];
  const state = { hidden: false, ensureResult: true };
  setDeps({
    fetch: async (path, opts) => { calls.fetch.push([path, opts]); const r = queue.length > 1 ? queue.shift() : queue[0]; return typeof r === 'function' ? r() : r; },
    ensure: async () => { calls.ensure += 1; return state.ensureResult; },
    hidden: () => state.hidden,
  });
  return { calls, state, queue };
}

test('401 asks for the owner password once and retries once', async () => {
  const { calls } = rig([res(401, { detail: 'Sign in as the owner first.' }), res(200, { ok: 1 })]);
  assert.deepEqual(await labFetch('/api/lab/projects'), { ok: 1 });
  assert.equal(calls.ensure, 1);
  assert.equal(calls.fetch.length, 2);
});

test('a second 401 throws with the detail text, no third try', async () => {
  const { calls } = rig([res(401, { detail: 'Sign in as the owner first.' })]);
  await assert.rejects(labFetch('/api/lab/projects'), /Sign in as the owner first\./);
  assert.equal(calls.ensure, 1);
  assert.equal(calls.fetch.length, 2);
});

test('a refused sign-in sheet does not retry', async () => {
  const { calls, state } = rig([res(401, { detail: 'Sign in as the owner first.' })]);
  state.ensureResult = false;
  await assert.rejects(labFetch('/api/lab/projects'), /owner|sign-in/i);
  assert.equal(calls.fetch.length, 1);
});

test('{prompt:false} never calls ensure', async () => {
  const { calls } = rig([res(401, { detail: 'Sign in as the owner first.' })]);
  await assert.rejects(labFetch('/api/lab/projects', {}, { prompt: false }), /owner|sign-in/i);
  assert.equal(calls.ensure, 0);
  assert.equal(calls.fetch.length, 1);
});

test('403 says kids cannot use the lab', async () => {
  rig([res(403, { detail: 'nope' })]);
  await assert.rejects(labFetch('/api/lab/projects'), { message: "Kids can't use the lab." });
});

test('detail, then error, then HTTP code', async () => {
  rig([res(400, { detail: 'Invalid run id' })]);
  await assert.rejects(labFetch('/api/lab/p/requests', { method: 'POST' }), { message: 'Invalid run id' });
  rig([res(500, { error: 'boom' })]);
  await assert.rejects(labFetch('/api/lab/p/requests'), { message: 'boom' });
  rig([{ ok: false, status: 502, json: async () => { throw new Error('not json'); } }]);
  await assert.rejects(labFetch('/api/lab/p/requests'), { message: 'HTTP 502' });
});

test('404 on GET /api/lab/<project> is null (no lab data yet); other 404s throw', async () => {
  rig([res(404, { detail: 'No lab data' })]);
  assert.equal(await labFetch('/api/lab/print-lab'), null);
  rig([res(404, { detail: 'No such request' })]);
  await assert.rejects(labFetch('/api/lab/print-lab/requests'), /No such request/);
});

test('fetches are relative, same-origin, and never set Origin', async () => {
  const { calls } = rig([res(200, {})]);
  await labFetch('/api/lab/print-lab/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(calls.fetch[0][0], '/api/lab/print-lab/requests');
  assert.ok(!Object.keys(calls.fetch[0][1].headers || {}).some((k) => k.toLowerCase() === 'origin'));
  await assert.rejects(labFetch('https://evil.example/api/lab/x'), /relative/);
  await assert.rejects(labFetch('//evil.example/api/lab/x'), /relative/);
});

// ---- the poller ----
const items = (...xs) => res(200, { items: xs });
const tick = async (ms) => { mock.timers.tick(ms); for (let i = 0; i < 10; i++) await Promise.resolve(); };

function polling(responses, ids = ['rq-1']) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const r = rig(responses);
  const seen = [];
  const stop = watchRequests('print-lab', ids, (item) => seen.push(item));
  return { ...r, seen, stop };
}

test('poll waits 1000, 1500, 2250 ... capped at 10000', async () => {
  const { calls, stop } = polling([items({ id: 'rq-1', status: 'pending' })]);
  const times = [];
  let last = 0;
  for (let t = 0; t < 120000 && times.length < 11; t += 50) {
    const n = calls.fetch.length;
    await tick(50);
    if (calls.fetch.length > n) { times.push(t + 50 - last); last = t + 50; }
  }
  stop();
  assert.deepEqual(times.slice(0, 3), [1000, 1500, 2250]);
  assert.equal(Math.max(...times), 10000);
  assert.equal(times[times.length - 1], 10000);
  mock.timers.reset();
});

test('a change brings the interval back to 1000', async () => {
  const { calls, stop } = polling([
    items({ id: 'rq-1', status: 'pending' }), items({ id: 'rq-1', status: 'pending' }), items({ id: 'rq-1', status: 'pending' }),
    items({ id: 'rq-1', status: 'pending', message: 'seen' }), items({ id: 'rq-1', status: 'pending', message: 'seen' }),
  ]);
  await tick(1000); await tick(1500); await tick(2250); // 3 fetches, none changed
  assert.equal(calls.fetch.length, 3);
  await tick(3375); // 4th fetch: message changed
  assert.equal(calls.fetch.length, 4);
  await tick(999);
  assert.equal(calls.fetch.length, 4);
  await tick(1);
  assert.equal(calls.fetch.length, 5);
  stop(); mock.timers.reset();
});

test('no fetch while the page is hidden, and no burst on wake', async () => {
  const { calls, state, stop } = polling([items({ id: 'rq-1', status: 'pending' })]);
  state.hidden = true;
  for (let i = 0; i < 20; i++) await tick(1000);
  assert.equal(calls.fetch.length, 0);
  state.hidden = false;
  await tick(10000);
  assert.equal(calls.fetch.length, 1);
  stop(); mock.timers.reset();
});

test('applied and refused stop the poll; each poll delivers the item', async () => {
  const { calls, seen } = polling([items({ id: 'rq-1', status: 'applied', message: 'ok' })]);
  await tick(1000);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'applied');
  await tick(60000);
  assert.equal(calls.fetch.length, 1);
  mock.timers.reset();
});

test('one poll serves several ids and ends when all are done', async () => {
  const { calls, seen } = polling([
    items({ id: 'rq-1', status: 'applied' }, { id: 'rq-2', status: 'pending' }),
    items({ id: 'rq-2', status: 'refused', message: 'no' }),
  ], ['rq-1', 'rq-2']);
  await tick(1000);
  assert.equal(calls.fetch.length, 1);
  await tick(1000);
  assert.equal(calls.fetch.length, 2);
  assert.deepEqual(seen.map((s) => s.id + ':' + s.status), ['rq-1:applied', 'rq-2:pending', 'rq-2:refused']);
  await tick(60000);
  assert.equal(calls.fetch.length, 2);
  mock.timers.reset();
});

test('stop() ends it; a failed fetch keeps going; it gives up after 10 minutes', async () => {
  let r = polling([items({ id: 'rq-1', status: 'pending' })]);
  await tick(1000);
  r.stop();
  const n = r.calls.fetch.length;
  await tick(60000);
  assert.equal(r.calls.fetch.length, n);
  mock.timers.reset();

  r = polling([res(500, { detail: 'down' })]);
  await tick(1000); await tick(1500);
  assert.equal(r.calls.fetch.length, 2);
  await tick(11 * 60000);
  const after = r.calls.fetch.length;
  await tick(60000);
  assert.equal(r.calls.fetch.length, after);
  assert.equal(r.calls.ensure, 0, 'the poller never opens a sign-in sheet');
  mock.timers.reset();
});

// ---- the page's load decision ----
test('first load may prompt once; a cancelled sheet means later refreshes never prompt', async () => {
  const { calls, state } = rig([res(401, { detail: 'Sign in as the owner first.' })]);
  state.ensureResult = false;
  const page = {};
  await assert.rejects(fetchLab(page), /owner|sign-in/i);
  assert.equal(calls.ensure, 1);
  await assert.rejects(fetchLab(page), /owner|sign-in/i);
  await assert.rejects(fetchLab(page), /owner|sign-in/i);
  assert.equal(calls.ensure, 1);
});

test('after a good load the refresh uses prompt:false', async () => {
  const { calls } = rig([
    res(200, { projects: [{ name: 'print-lab' }] }), res(200, { index: {} }), res(200, { items: [] }),
    res(401, { detail: 'Sign in as the owner first.' }),
  ]);
  const page = {};
  assert.ok(await fetchLab(page));
  await assert.rejects(fetchLab(page), /owner|sign-in/i);
  assert.equal(calls.ensure, 0);
});

test('a 404 on the project is the empty state, and no projects is too', async () => {
  rig([res(200, { projects: [{ name: 'print-lab' }] }), res(404, { detail: 'No lab data' }), res(200, { items: [] })]);
  assert.equal(await fetchLab({}), null);
  rig([res(200, { projects: [] })]);
  assert.equal(await fetchLab({}), null);
});
