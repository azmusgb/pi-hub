// A34 P2, P2n: the pages Pi Hub draws for the Assistant, in a fake DOM with the kit's phrases: the task page (every state,
// focus, live region, cancel, Try again), the Start a task form, and the Assistant status and models pages (every source
// state, the mirror, needs the PC, out of date, refused). Local AI's text is asserted to be text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';
import './helpers/kit.mjs';

const adapter = (name) => JSON.parse(readFileSync(new URL(`./browser/fixtures/assistant/ai/tasks/run-fixture-${name}.json`, import.meta.url), 'utf8'));
const contract = (name) => JSON.parse(readFileSync(new URL(`./fixtures/localai-contract/${name}.json`, import.meta.url), 'utf8'));
const RUN = 'run-1790000000000-001a2b3';
const flush = () => new Promise((r) => setImmediate(r));
const unreachable = (why = 'unreachable') => ({ state: 'unreachable', fetched_at: 1, why });

function store(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

// The task page at /assistant/run/<id>, reading what `replies()` returns (a body, or an Error for a failed request).
async function taskPage(replies, { id = RUN, storage = store(), confirm = true, posts = [] } = {}) {
  const calls = { reads: 0, posts: [] };
  const dom = install({ confirm });
  const answer = (r) => {
    if (r instanceof Error) throw r;
    const status = r?.__status || 200;
    return new Response(JSON.stringify(r?.__status ? r.body : r), { status, headers: { 'content-type': 'application/json' } });
  };
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') { calls.posts.push([url, opts.body ? JSON.parse(opts.body) : null]); return answer(posts.length > 1 ? posts.shift() : posts[0]); }
    calls.reads++;
    return answer(typeof replies === 'function' ? replies() : replies);
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  Object.assign(globalThis.location, { pathname: `/assistant/run/${id}`, search: '' });
  const mod = await import('../hub/static/js/assistant-run.js');
  const view = document.createElement('main');
  document.body.append(view);
  const root = document.createElement('div');
  view.append(root);
  const state = { root, context: new URLSearchParams(), goto: (href) => calls.goto = href };
  mod.mount(state);
  return { dom, mod, state, root, calls, storage, load: async () => { await mod.load(state); await flush(); },
    done() { mod.leave(state); dom.uninstall(); delete globalThis.localStorage; } };
}
const refused = (status, body) => ({ __status: status, body });

test('every phase has a word, a lamp and a sentence; unreachable never says failed, and no step count is invented', async () => {
  const { phaseView } = await import('../hub/static/js/assistant-run.js');
  const dom = install();
  try {
    const seen = {};
    for (const phase of ['reading', 'queued', 'running', 'awaiting_approval', 'cancelling', 'completed', 'failed', 'cancelled', 'unreachable', 'out_of_date', 'refused', 'not_found']) {
      const v = phaseView({ phase, steps: null, lastSeen: 0, run: {}, why: '', error: 'No.' });
      seen[phase] = v;
      assert.ok(v.lamp[0] && v.lamp[1] && v.caption, phase);
    }
    assert.equal(seen.running.lamp[0], 'ok');
    assert.equal(seen.running.lamp[2], true, 'running is the kit\'s live lamp');
    assert.equal(seen.queued.lamp[0], 'unknown', 'queued work that needs nothing is neutral');
    assert.equal(seen.awaiting_approval.lamp[0], 'warn');
    assert.equal(seen.failed.lamp[0], 'bad');
    assert.equal(seen.unreachable.lamp[0], 'unknown');
    assert.doesNotMatch(JSON.stringify(seen.unreachable), /failed/i);
    assert.match(seen.unreachable.caption, /Can't reach the Assistant/);
    assert.match(seen.unreachable.caption, /may still be running/);
    assert.match(seen.unreachable.caption, /not seen from this browser yet/);
    assert.match(phaseView({ phase: 'unreachable', why: 'pc_off', lastSeen: Date.now(), run: {} }).caption, /PC is asleep.*last seen \d/);
    assert.match(phaseView({ phase: 'unreachable', why: 'hub', lastSeen: 0, run: {} }).caption, /Pi Hub isn't answering/);
    assert.equal(seen.running.readout, 'Running', 'no steps, so no count and no percentage');
    assert.equal(phaseView({ phase: 'running', steps: { done: 2, total: 5 }, run: {} }).readout, '2 of 5 steps');
  } finally { dom.uninstall(); }
});

test('running shows N of M steps from the workers, a meter from that count, the steps, and no percentage', async () => {
  const p = await taskPage(adapter('running'));
  try {
    await p.load();
    const t = text(p.root);
    assert.match(t, /1 of 5 steps/);
    assert.doesNotMatch(t, /\d\s*%/);
    const meter = p.root.querySelector('.ui-meter');
    assert.equal(meter.getAttribute('aria-valuenow'), '1');
    assert.equal(meter.getAttribute('aria-valuemax'), '5');
    assert.equal(meter.getAttribute('role'), 'meter');
    assert.deepEqual(p.root.querySelectorAll('#run-steps .ui-row').map((r) => text(r.querySelector('.ui-row__title'))), ['Researcher', 'Analyst', 'Writer', 'Reviewer', 'Editor']);
    assert.match(text(p.root.querySelector('.assistant-run__live')), /1 of 5 steps done/);
  } finally { p.done(); }
});

test('a step Local AI reports as error or blocked reads Failed or Skipped, never the raw word (real states from a restarted mission)', async () => {
  const run = adapter('running');
  run.mission.workers = [{ id: 'a', name: 'Router', state: 'complete', model: '', error: null },
    { id: 'b', name: 'Docs', state: 'error', model: 'qwen3:8b', error: 'Local AI restarted for an update while this was running' },
    { id: 'c', name: 'Coordinator', state: 'blocked', model: '', error: 'Local AI restarted for an update while this was running' }];
  const p = await taskPage(run);
  try {
    await p.load();
    const rows = p.root.querySelectorAll('#run-steps .ui-row').map((r) => text(r));
    assert.match(rows[1], /Failed/); assert.doesNotMatch(rows[1], /\berror\b/);
    assert.match(rows[2], /Skipped/); assert.doesNotMatch(rows[2], /\bblocked\b/);
  } finally { p.done(); }
});

test('a task with no steps yet (queued) shows no meter and no count', async () => {
  const p = await taskPage(adapter('queued'));
  try {
    await p.load();
    assert.equal(p.root.querySelector('.ui-meter'), null);
    assert.match(text(p.root.querySelector('.ui-faceplate')), /Queued/);
    assert.ok(p.root.querySelector('button[data-focus="cancel"]'), 'queued and cancellable');
  } finally { p.done(); }
});

test('the answer is text: markup in it is shown as characters and builds no element; line breaks stay', async () => {
  const p = await taskPage(adapter('completed'));
  try {
    await p.load();
    const a = p.root.querySelector('#run-answer');
    assert.ok(text(a).includes('<img src=x onerror=alert(1)>') && text(a).includes('<b>not bold</b>'));
    assert.equal(p.root.querySelector('img'), null);
    assert.equal(p.root.querySelector('b'), null);
    assert.ok(a.textContent.includes('\n\n'), 'the answer\'s own line breaks are kept (the style keeps them)');
    assert.match(text(p.root.querySelector('.ui-faceplate')), /Done/);
    assert.equal(p.root.querySelector('button[data-focus="cancel"]'), null, 'nothing to cancel');
    assert.equal(p.root.querySelector('.ui-meter'), null);
  } finally { p.done(); }
});

test('an answer whose full text could not be read shows the summary, says so, and offers to load it again', async () => {
  const done = adapter('completed');
  done.mission = null;
  done.mission_read = 'failed';
  const p = await taskPage(done);
  try {
    await p.load();
    assert.match(text(p.root.querySelector('#run-answer')), /Three options, ranked\./);
    assert.match(text(p.root), /full answer couldn't be read/);
    const reads = p.calls.reads;
    p.root.querySelector('button[data-focus="reload"]').dispatchEvent({ type: 'click' });
    await flush();
    assert.equal(p.calls.reads, reads + 1);
  } finally { p.done(); }
});

test('failed shows Local AI\'s own error as text, and Try again resubmits the same goal and opens the new task', async () => {
  const storage = store();
  const { writeCurrent } = await import('../hub/static/js/assistant-task.js');
  writeCurrent({ runId: RUN, goal: 'Plan the week <b>now</b>', startedAt: 1, lastSeen: 2 }, storage);
  const p = await taskPage(adapter('failed'), { storage, posts: [{ state: 'submitted', runId: 'run-second-12345' }] });
  try {
    await p.load();
    const f = p.root.querySelector('.assistant-run__failure');
    assert.match(text(f), /The task failed/);
    assert.match(text(f), /Run interrupted by appliance restart/);
    assert.match(text(p.root.querySelector('.ui-faceplate')), /Plan the week <b>now<\/b>/, 'the goal is text too');
    p.root.querySelector('button[data-focus="retry"]').dispatchEvent({ type: 'click' });
    await flush(); await flush();
    assert.deepEqual(p.calls.posts, [['/api/ai/tasks', { goal: 'Plan the week <b>now</b>' }]]);
    assert.equal(p.calls.goto, '/assistant/run/run-second-12345');
  } finally { p.done(); }
});

test('failed with no goal known here offers a new task instead of resubmitting nothing; a refused retry keeps the page and says why', async () => {
  const p = await taskPage(adapter('failed'));
  try {
    await p.load();
    assert.equal(p.root.querySelector('button[data-focus="retry"]'), null);
    assert.match(p.root.querySelector('.ui-faceplate__actions a').getAttribute('href'), /^\/assistant$/);
  } finally { p.done(); }
  const storage = store();
  const { writeCurrent } = await import('../hub/static/js/assistant-task.js');
  writeCurrent({ runId: RUN, goal: 'Again' }, storage);
  const q = await taskPage(adapter('failed'), { storage, posts: [refused(503, { state: 'needs_pc', error: 'Starting a task needs the PC.' })] });
  try {
    await q.load();
    q.root.querySelector('button[data-focus="retry"]').dispatchEvent({ type: 'click' });
    await flush(); await flush();
    assert.equal(q.calls.goto, undefined);
    assert.match(text(q.root), /needs the PC/);
  } finally { q.done(); }
});

test('awaiting approval links to Decisions', async () => {
  const p = await taskPage(adapter('awaiting'));
  try {
    await p.load();
    const a = p.root.querySelector('a[href="/assistant?to=inbox"]');
    assert.ok(a && text(a) === 'Open Decisions' && a.hasAttribute('data-link'));
    assert.match(text(p.root.querySelector('.assistant-run__live')), /approval/);
  } finally { p.done(); }
});

test('cancel is shown only while cancellable; it asks first, saying what it stops, and nothing is sent when the answer is no', async () => {
  const asked = [];
  const no = await taskPage(adapter('running'), { confirm: async (trigger, o) => { asked.push(o); return false; }, posts: [{ state: 'ok' }] });
  try {
    await no.load();
    no.root.querySelector('button[data-focus="cancel"]').dispatchEvent({ type: 'click' });
    await flush(); await flush();
    assert.equal(asked.length, 1);
    assert.match(asked[0].what, /stops this task/);
    assert.match(asked[0].what, /already finished are kept/);
    assert.equal(asked[0].danger, true);
    assert.equal(asked[0].confirm, 'Cancel the task');
    assert.equal(no.calls.posts.length, 0);
  } finally { no.done(); }
  const notCancellable = adapter('running');
  notCancellable.run.cancellable = false;
  const p = await taskPage(notCancellable);
  try {
    await p.load();
    assert.equal(p.root.querySelector('button[data-focus="cancel"]'), null);
  } finally { p.done(); }
});

test('confirmed cancel shows Cancelling and then Cancelled; a 409 says why and offers cancel no more than once per ask', async () => {
  const p = await taskPage(adapter('running'), { posts: [{ state: 'ok', run: adapter('cancelled').run }] });
  try {
    await p.load();
    p.root.querySelector('button[data-focus="cancel"]').dispatchEvent({ type: 'click' });
    await flush(); await flush();
    assert.deepEqual(p.calls.posts, [[`/api/ai/tasks/${RUN}/cancel`, null]]);
    assert.match(text(p.root.querySelector('.ui-faceplate')), /Cancelled/);
    assert.match(text(p.root.querySelector('.assistant-run__live')), /Stopped at your request/);
  } finally { p.done(); }
  const q = await taskPage(adapter('running'), { posts: [refused(409, { state: 'not_cancellable', error: 'This run is not cancellable' })] });
  try {
    await q.load();
    q.root.querySelector('button[data-focus="cancel"]').dispatchEvent({ type: 'click' });
    await flush(); await flush();
    assert.equal(q.calls.posts.length, 1);
    assert.match(text(q.root), /This run is not cancellable/);
    assert.match(text(q.root.querySelector('.ui-faceplate')), /Running/);
  } finally { q.done(); }
});

test('unreachable: says it can\'t reach the Assistant, the task may still be running and when it was last seen; keeps the steps; no failed', async () => {
  let n = 0;
  const p = await taskPage(() => (n++ === 0 ? adapter('running') : unreachable('pc_off')));
  try {
    await p.load();
    p.mod.leave(p.state);  // (the state machine keeps its own clock; the page just draws)
  } finally { p.done(); }
  const storage = store();
  const { writeCurrent } = await import('../hub/static/js/assistant-task.js');
  writeCurrent({ runId: RUN, goal: 'x', lastSeen: Date.now() - 120_000 }, storage);
  const q = await taskPage(unreachable('pc_off'), { storage });
  try {
    await q.load();
    const t = text(q.root);
    assert.match(t, /Can't reach the Assistant: the PC is asleep/);
    assert.match(t, /may still be running; last seen \d/);
    assert.doesNotMatch(t, /failed/i);
    assert.match(text(q.root.querySelector('.ui-faceplate')), /Can't reach it/);
    assert.equal(q.root.querySelector('.assistant-run__failure'), null);
    assert.equal(q.root.querySelector('button[data-focus="retry"]'), null, 'no Try again: nothing failed');
  } finally { q.done(); }
});

test('out of date, refused, unknown id and a bad address are each named, with nothing invented', async () => {
  for (const [reply, words] of [[{ state: 'out_of_date', error: 'x' }, /older than this page needs/], [{ state: 'refused', error: 'Not allowed' }, /Not allowed/],
    [{ state: 'not_found', error: 'x' }, /no task with this id/]]) {
    const p = await taskPage(reply);
    try { await p.load(); assert.match(text(p.root.querySelector('.assistant-run__live')), words); } finally { p.done(); }
  }
  const bad = await taskPage(adapter('running'), { id: 'x' });
  try {
    await bad.load();
    assert.equal(bad.calls.reads, 0, 'a bad id is never sent');
    assert.match(text(bad.root), /isn't a task id/);
  } finally { bad.done(); }
});

test('the status sentence is one polite live region that keeps its place while the rest redraws only when something changed', async () => {
  const replies = [adapter('queued'), adapter('queued'), adapter('running')];
  const p = await taskPage(() => (replies.length > 1 ? replies.shift() : replies[0]));
  try {
    await p.load();
    const live = p.root.querySelector('.assistant-run__live');
    assert.equal(p.root.querySelectorAll('[aria-live]').length, 1);
    assert.equal(live.getAttribute('aria-live'), 'polite');
    assert.equal(live.getAttribute('role'), 'status');
    const first = text(live);
    const body = p.state.body.firstChild;
    p.state.ctl.resume(); await p.load();
    assert.equal(p.state.body.firstChild, body, 'an unchanged poll leaves the page alone');
    p.state.ctl.resume(); await p.load();
    assert.equal(p.root.querySelector('.assistant-run__live'), live, 'the live region is the same element');
    assert.notEqual(text(live), first);
    assert.notEqual(p.state.body.firstChild, body);
  } finally { p.done(); }
});

test('focus: an outcome takes focus when the owner was on the page, a control keeps it when it is still there, and the rail\'s is left alone', async () => {
  const replies = [adapter('running'), adapter('running'), adapter('completed')];
  const p = await taskPage(() => (replies.length > 1 ? replies.shift() : replies[0]));
  try {
    await p.load();
    const cancel = p.root.querySelector('button[data-focus="cancel"]');
    cancel.focus();
    assert.equal(document.activeElement, cancel);
    p.state.ctl.resume(); await p.load();
    assert.equal(document.activeElement, p.root.querySelector('button[data-focus="cancel"]'), 'unchanged: focus stays');
    p.state.ctl.resume(); await p.load();
    assert.equal(document.activeElement.id, 'run-outcome', 'finished: focus goes to the answer');
  } finally { p.done(); }
  const q = await taskPage(() => (q.n = (q.n || 0) + 1, q.n === 1 ? adapter('running') : adapter('completed')));
  try {
    await q.load();
    const rail = document.createElement('a');
    document.body.append(rail);
    rail.focus();
    q.state.ctl.resume(); await q.load();
    assert.equal(document.activeElement, rail, 'focus elsewhere is not taken');
  } finally { q.done(); }
});

test('a hidden tab reads nothing, and the page makes no percentage or HTML of its own', async () => {
  const p = await taskPage(adapter('running'));
  try {
    document.hidden = true;
    await p.load();
    assert.equal(p.calls.reads, 0);
    document.hidden = false;
    await p.load();
    assert.equal(p.calls.reads, 1);
  } finally { p.done(); }
  const src = readFileSync(new URL('../hub/static/js/assistant-run.js', import.meta.url), 'utf8') + readFileSync(new URL('../hub/static/js/assistant-pages.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|setHTML|DOMParser/);
});

// ---- Start a task ----

async function startForm({ post, storage = store() } = {}) {
  const dom = install();
  globalThis.fetch = async (url, opts = {}) => {
    const r = await post(url, opts.body ? JSON.parse(opts.body) : null);
    return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  const { startTask } = await import('../hub/static/js/assistant-run.js');
  const went = [];
  const start = startTask({ goto: (h) => went.push(h), storage });
  document.body.append(start.el);
  return { start, went, dom, storage, el: start.el, done() { dom.uninstall(); delete globalThis.localStorage; } };
}
const type = (el, v) => { el.value = v; el.dispatchEvent({ type: 'input' }); };
const submit = async (f) => { f.el.querySelector('form').dispatchEvent({ type: 'submit', preventDefault() {} }); await flush(); await flush(); };

test('Start a task is a closed disclosure with a labelled goal box and one verb button; it starts the task and opens it by id', async () => {
  const sent = [];
  const f = await startForm({ post: async (u, b) => { sent.push([u, b]); return { state: 'submitted', runId: RUN }; } });
  try {
    assert.equal(f.el.querySelector('details').hasAttribute('open'), false);
    assert.equal(text(f.el.querySelector('summary')), 'Start a task');
    assert.equal(f.el.querySelector('label').getAttribute('for'), f.el.querySelector('textarea').id);
    assert.equal(text(f.el.querySelector('button[type="submit"]')), 'Start the task');
    type(f.el.querySelector('textarea'), ' Plan the week ');
    await submit(f);
    assert.deepEqual(sent, [['/api/ai/tasks', { goal: 'Plan the week' }]]);
    assert.deepEqual(f.went, [`/assistant/run/${RUN}`]);
  } finally { f.done(); }
});

test('a goal the hub or Local AI refuses stays in the box with what went wrong beside it and focus back on it', async () => {
  for (const [body, words] of [[{ __status: 400, body: { state: 'refused', error: 'Unknown model' } }, /Unknown model/],
    [{ __status: 503, body: { state: 'needs_pc', error: 'Starting a task needs the PC.' } }, /needs the PC/],
    [{ __status: 503, body: { state: 'unreachable', error: "Pi Hub couldn't reach the Assistant, so it doesn't know whether the task started." } }, /doesn't know whether the task started/]]) {
    const f = await startForm({ post: async () => new Response(JSON.stringify(body.body), { status: body.__status, headers: { 'content-type': 'application/json' } }) });
    try {
      type(f.el.querySelector('textarea'), 'Do the thing');
      await submit(f);
      assert.equal(f.went.length, 0);
      assert.equal(f.el.querySelector('textarea').value, 'Do the thing', 'what was typed is kept');
      assert.match(text(f.el.querySelector('#assistant-task-note')), words);
      assert.equal(f.el.querySelector('#assistant-task-note').getAttribute('role'), 'status');
      assert.equal(f.el.querySelector('textarea').getAttribute('aria-invalid'), 'true');
      assert.equal(readCurrentOf(f.storage), null);
    } finally { f.done(); }
  }
});
const readCurrentOf = (s) => { try { return JSON.parse(s.getItem('hub-ai-current-task')); } catch { return null; } };

test('an empty goal is refused in the page without asking the hub', async () => {
  let asked = 0;
  const f = await startForm({ post: async () => { asked++; return {}; } });
  try {
    await submit(f);
    assert.equal(asked, 0);
    assert.match(text(f.el.querySelector('#assistant-task-note')), /Say what the task is/);
  } finally { f.done(); }
});

test('the form is disabled with the reason beside it while the PC sleeps or the Assistant is down, and enabled again after', async () => {
  let asked = 0;
  const f = await startForm({ post: async () => { asked++; return { state: 'submitted', runId: RUN }; } });
  try {
    f.start.availability({ disabled: true, phrase: 'pc_off' });
    assert.equal(f.el.querySelector('textarea').disabled, true);
    assert.equal(f.el.querySelector('button[type="submit"]').getAttribute('aria-disabled'), 'true');
    assert.match(text(f.el.querySelector('#assistant-task-note')), /needs the PC.*asleep/);
    await submit(f);
    assert.equal(asked, 0);
    f.start.availability({ disabled: true, phrase: 'assistant_down' });
    assert.match(text(f.el.querySelector('#assistant-task-note')), /isn't answering/);
    f.start.availability({ disabled: false, phrase: '' });
    assert.equal(f.el.querySelector('textarea').disabled, false);
    assert.equal(f.el.querySelector('button[type="submit"]').hasAttribute('aria-disabled'), false);
    assert.equal(text(f.el.querySelector('#assistant-task-note')), '');
  } finally { f.done(); }
});

test('the one current task is offered as a link back to it', async () => {
  const storage = store();
  const { writeCurrent } = await import('../hub/static/js/assistant-task.js');
  const none = await startForm({ post: async () => ({}), storage });
  try { assert.equal(none.el.querySelector('.assistant-task__current').hidden, true); } finally { none.done(); }
  writeCurrent({ runId: RUN, goal: 'Plan the week' }, storage);
  const f = await startForm({ post: async () => ({}), storage });
  try {
    const a = f.el.querySelector('.assistant-task__current a');
    assert.equal(a.getAttribute('href'), `/assistant/run/${RUN}`);
    assert.equal(text(a), 'Plan the week');
    assert.ok(a.hasAttribute('data-link'));
  } finally { f.done(); }
});

// ---- Assistant status and models ----

const live = (data) => ({ state: 'live', mirror: false, fetched_at: 1, data });
const normalise = (d) => ({ ...d, sources: Object.fromEntries(Object.entries(d.sources).map(([k, s]) => [k, s])) });

async function pages() {
  const dom = install();
  const mod = await import('../hub/static/js/assistant-pages.js');
  const draw = (nodes) => { const box = document.createElement('div'); box.append(...nodes.filter(Boolean)); return box; };
  return { mod, draw, done: dom.uninstall };
}

test('status, every source answering (Local AI\'s real source and service names): Working, each service with its latency, nothing alarming', async () => {
  const { mod, draw, done } = await pages();
  try {
    const box = draw(mod.statusBody(live(contract('status_ok'))));
    assert.match(text(box.querySelector('.ui-faceplate')), /Assistant status.*Working.*Read just now.*Required services5.*Required, not working0/);
    assert.deepEqual(box.querySelectorAll('.ui-row__title').map(text).slice(0, 3), ['Intelligence', 'Image generation', 'Automation engine']);
    assert.match(text(box), /17 ms/);
    assert.equal(box.querySelector('.ui-notice'), null);
  } finally { done(); }
});

test('status as captured from Local AI with Ollama up and the rest down: its impact and what to do, failed bridges with their errors, nothing called fine', async () => {
  const { mod, draw, done } = await pages();
  try {
    const box = draw(mod.statusBody(live(contract('status_partial'))));
    const t = text(box);
    assert.match(text(box.querySelector('.ui-faceplate')), /Down.*Required, not working4.*Optional, not working2/);
    const rows = Object.fromEntries(box.querySelectorAll('.ui-row').map((r) => [text(r.querySelector('.ui-row__title')), text(r)]));
    assert.match(rows.Intelligence, /Working/);
    assert.match(rows['Image generation'], /Required.*fetch failed.*Images are unavailable\..*Start ComfyUI on the Windows host\..*Down/);
    assert.match(rows['Automation engine'], /Workflows and scheduled automations are paused\..*Docker Desktop/);
    assert.match(rows['Web research'], /Research and current facts are unavailable\./);
    assert.match(rows['Companion home'], /Optional.*Core appliance unaffected.*Open the Local AI app on your Mac\./);
    assert.match(rows['GridCraft / Excel'], /GridCraft bridge unavailable \(ENOTFOUND\).*Check that it is on and GridCraft is open, then choose Refresh\..*Isn't answering/);
    assert.match(rows.ArtCraft, /Windows computer bridge unavailable.*Isn't answering/);
    assert.match(rows['Workshop display'], /Read/);
    assert.doesNotMatch(t, /Not read yet/);
  } finally { done(); }
});

test('an unknown source is "Not read yet", not failed and not read', async () => {
  const { mod, draw, done } = await pages();
  try {
    const d = contract('status_ok');
    d.sources.artcraft = { state: 'unknown', checked_at: null };
    const rows = Object.fromEntries(draw(mod.statusBody(live(d))).querySelectorAll('.ui-row').map((r) => [text(r.querySelector('.ui-row__title')), text(r)]));
    assert.match(rows.ArtCraft, /Not read yet/);
  } finally { done(); }
});

test('status with every source failed: Unknown, a notice for the services, never an empty list or a healthy lamp', async () => {
  const { mod, draw, done } = await pages();
  try {
    const box = draw(mod.statusBody(live(contract('status_all_failed'))));
    const plate = text(box.querySelector('.ui-faceplate'));
    assert.match(plate, /Unknown/);
    assert.doesNotMatch(plate, /Working/);
    assert.match(text(box), /Local AI isn't answering\. Its services couldn't be read\./);
    assert.equal(box.querySelectorAll('.ui-chip--ok').length, 0);
    assert.equal(box.querySelectorAll('.ui-chip--bad').length, 4, 'each failed source is a bad lamp with a word');
    assert.doesNotMatch(text(box), /not working0|0 down/i);
  } finally { done(); }
});

test('a mirror says it is the last answer, how old, and why; needs the PC; unreachable; out of date; refused', async () => {
  const { mod, draw, done } = await pages();
  try {
    const mirror = draw(mod.statusBody({ state: 'mirror', mirror: true, why: 'pc_off', age: 3600, stored_at: 1, fetched_at: 2, data: contract('status_ok') }));
    const n = text(mirror.querySelector('.ui-notice--warn'));
    assert.match(n, /The PC is asleep\. This is the Assistant's last answer, read 1 hour ago\./);
    assert.match(text(mirror.querySelector('.ui-faceplate')), /Last known.*Read 1 hour ago/);
    assert.equal(mirror.querySelectorAll('.ui-chip--ok').length > 0, true, 'its rows keep their own lamps; the plate says last known');
    const down = draw(mod.statusBody({ state: 'mirror', mirror: true, why: 'unreachable', age: 90, data: contract('status_ok') }));
    assert.match(text(down.querySelector('.ui-notice--warn')), /The Assistant isn't answering\..*read 1 minute ago/);
    const needs = draw(mod.statusBody({ state: 'needs_pc', why: 'pc_off', data: null }));
    assert.match(text(needs), /The PC is asleep\. This page needs the PC/);
    assert.match(text(needs.querySelector('.ui-faceplate')), /Needs the PC.*—/);
    const unreach = draw(mod.statusBody({ state: 'unreachable', why: 'unreachable', data: null }));
    assert.match(text(unreach), /The Assistant isn't answering\. Pi Hub has no earlier answer/);
    const old = draw(mod.statusBody({ state: 'out_of_date', data: null }));
    assert.match(text(old), /Assistant out of date/);
    assert.match(text(old.querySelector('.ui-faceplate')), /Out of date/);
    const ref = draw(mod.statusBody({ state: 'refused', error: 'Pi Hub has no key for the Assistant yet.', data: null }));
    assert.match(text(ref.querySelector('.ui-notice--bad')), /no key/);
  } finally { done(); }
});

test('models as captured: installed with size, loaded, default, the runtime, routing as text', async () => {
  const { mod, draw, done } = await pages();
  try {
    const data = contract('models_ok');
    data.installed.push({ name: '<img src=x onerror=alert(1)>', sizeBytes: 1e9 });
    const box = draw(mod.modelsBody(live(data)));
    assert.match(text(box.querySelector('.ui-faceplate')), /Models.*Runtime ready.*2 installed models.*1 loaded now/);
    assert.match(text(box), /qwen3:8b.*Default · 5\.2 GB.*Loaded/);
    assert.match(text(box), /Mission steps.*Always on this PC/);
    assert.ok(text(box).includes('<img src=x onerror=alert(1)>'));
    assert.equal(box.querySelector('img'), null);
    const manage = box.querySelector('.ui-faceplate a');
    assert.equal(manage.getAttribute('rel'), 'noopener noreferrer');
    assert.match(manage.getAttribute('href'), /^https:\/\/assistant\..*#models$/);
  } finally { done(); }
});

test('models as captured with Ollama unreachable (installed and loaded null): Unknown and why, never "0 installed", never an empty list', async () => {
  const { mod, draw, done } = await pages();
  try {
    const box = draw(mod.modelsBody(live(contract('models_ollama_down'))));
    const plate = text(box.querySelector('.ui-faceplate'));
    assert.match(plate, /Unknown/);
    assert.doesNotMatch(plate, /\b0\b/);
    assert.match(plate, /Runtime not answering/);
    assert.match(text(box), /Ollama isn't answering\. fetch failed\./);
    assert.doesNotMatch(text(box), /No models are installed/);
    assert.match(text(box.querySelector('#models-sources')), /Installed models.*fetch failed.*Isn't answering/);
  } finally { done(); }
});

test('models read truly empty says so and what to do; a mirror and needs-the-PC are drawn as on status', async () => {
  const { mod, draw, done } = await pages();
  try {
    const data = contract('models_ok');
    data.installed = []; data.installedCount = 0; data.loaded = []; data.loadedCount = 0;
    const box = draw(mod.modelsBody(live(data)));
    assert.match(text(box.querySelector('.ui-empty')), /No models are installed\. Pull one on the PC\./);
    assert.match(text(box.querySelector('.ui-faceplate')), /0.*installed models/);
    const mirror = draw(mod.modelsBody({ state: 'mirror', why: 'pc_off', age: 7200, data: contract('models_ok') }));
    assert.match(text(mirror.querySelector('.ui-notice--warn')), /read 2 hours ago/);
    assert.match(text(draw(mod.modelsBody({ state: 'needs_pc', data: null }))), /needs the PC/);
  } finally { done(); }
});

test('the status and models pages load /api/ai/*, set the sources line and a facts line, and keep focus across a refresh', async () => {
  const routes = { '/api/ai/status': live(contract('status_partial')), '/api/ai/models': live(contract('models_ok')) };
  const dom = install({ fetch: routes });
  try {
    const mod = await import('../hub/static/js/assistant-pages.js');
    for (const [page, key] of [[mod.statusPage, 'status'], [mod.modelsPage, 'models']]) {
      const root = document.createElement('div');
      document.body.append(root);
      const state = { root, context: new URLSearchParams() };
      page.mount(state);
      assert.match(text(root), /Assistant/);
      await page.load(state);
      assert.ok(Array.isArray(state.sources));
      assert.ok(state.facts.startsWith(mod.TITLES[key]));
      if (key === 'status') {
        assert.deepEqual(state.sources.map((s) => [s.name, s.tone]), [['Local AI services', 'ok'], ['GridCraft / Excel', 'bad'], ['ArtCraft', 'bad'], ['Workshop display', 'ok'], ['Watch', 'ok']]);
      }
      const link = root.querySelector('a[href="/assistant"]');
      link.focus();
      await page.load(state);
      assert.equal(document.activeElement, link, 'a refresh with nothing changed keeps the page and its focus');
    }
  } finally { dom.uninstall(); }
});

test('a hub that does not answer makes load throw, so the shell says it couldn\'t refresh (not an empty page)', async () => {
  const dom = install({ fetch: {} });
  try {
    const mod = await import('../hub/static/js/assistant-pages.js');
    const root = document.createElement('div');
    document.body.append(root);
    const state = { root };
    mod.statusPage.mount(state);
    await assert.rejects(() => mod.statusPage.load(state));
  } finally { dom.uninstall(); }
});
