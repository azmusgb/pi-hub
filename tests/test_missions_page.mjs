// A35 M1b step H7: /missions and /missions/<initiative> (Overview, Decisions, Evidence), in a fake DOM with the kit's
// phrases and the hub's bodies as hub/missions/views.py shapes them. Every state in spec §10.5 is drawn, a read that
// failed is never drawn as empty or zero, every read the pages make has its failed-source case, and no percentage is
// written anywhere (§17.8). The §17.1 timer test, page half, is test_relabel_timer_turns_live_into_no_report_since.
process.env.TZ = 'UTC';  // the pages write HH:MM in the browser's zone
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';
import './helpers/kit.mjs';
import { SITE, sectionFor } from '../hub/static/js/site.js';
import { hhmm, shownNow, stamp } from '../hub/static/js/mission-parts.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const iso = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, '+00:00');
const day = new Date();
const NOW = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9, 41);  // today, so a time is HH:MM, as in use
const MANIFEST = { repo: 'azmusgb/pi-hub', path: 'docs/missions/a34.json', commit: '4ef3c14aaaaaaaa' };
const IMPORTED = { trust: 'imported', source: 'importer', from: 'azmusgb/pi-hub@4ef3c14' };
const FROM = 'azmusgb/pi-hub@4ef3c14';

// ---- the hub's bodies ----

const rev = (n, status, extra = {}) => ({ n, status, at: iso(NOW - 3_600_000), summary: 'Imported plan', proposer: 'importer', requires_approval: false, provenance: IMPORTED, ...extra });
const exec = (over = {}) => ({ id: 'x1', source: 'claude', level: 'hook', title: 'pi-hub fix/release-test-timing', tasks: [], model: 'Opus 5.5', branch: 'fix/release-test-timing', workstream: null,
  started_at: iso(NOW - 600_000), tool: null, shown: 'Working', state: 'working', live: true, since: iso(NOW - 20_000), provenance: { trust: 'reported', source: 'claude', at: iso(NOW - 20_000) }, ...over });
const event = (seq, over = {}) => ({ seq, at: iso(NOW - seq * 1000), received_at: iso(NOW - seq * 1000), source: 'claude', type: 'task.started', entity: 't1', late: false, text: `Event ${seq}`, ...over });
const overview = (over = {}) => ({ version: 1, as_of: iso(NOW), seq: 12, view: 'overview',
  initiative: { id: 'a34', title: 'Pi Hub draws the Assistant', intent: '', status: 'active', manifest: MANIFEST, provenance: IMPORTED },
  revision: rev(1, 'accepted'), proposed: [],
  stages: [{ id: 'a34:stage:p0', n: 0, title: 'Headroom', status: 'active', gates: [], provenance: IMPORTED }],
  counts: { tasks: { by_state: { planned: 19, active: 2, done: 2 }, of: 23, reported: 3 }, gates: { met: 0, of: 7 },
    decisions: { state: 'ok', open: 2, blocking: 1, answered: 14 }, evidence: { trusted: 1, owner: 0, reported: 6, imported: 9, of: 16 }, risks: { open: 1, mitigated: 0, of: 1 } },
  executions: [exec()], events: [event(12, { text: 'Started the timing fix' })],
  sources: [{ name: 'ledger', state: 'ok', as_of: iso(NOW) }, { name: 'manifest', state: 'ok', repo: MANIFEST.repo, commit: MANIFEST.commit }], ...over });
const proposed = (n, extra = {}) => ({ ...rev(n, 'proposed'), changes: { add: 3 }, declared: 3, seen: 3, ...extra });
const D1 = { id: 'd1', kind: 'choice', question: 'Raise the 900 s test limit?', options: ['No, fix the tests', 'Raise to 1200 s'], recommended: 'No, fix the tests', link: null, answered_at: null, answer: null, blocking: true };
const D2 = { id: 'd2', kind: 'yesno', question: 'Keep the budget?', options: [], recommended: null, link: null, answered_at: null, answer: null, blocking: false };
const live = (id, q, answer, at) => ({ id, kind: 'choice', question: q, options: [], answer, answered_at: at / 1000, when: iso(at), provenance: { trust: 'owner', source: 'owner', at: iso(at) } });
const imp = (id, q, answer, when) => ({ id, kind: 'choice', question: q, options: [], answer, answered_at: when, when, provenance: IMPORTED });
const decisions = (over = {}) => ({ version: 1, as_of: iso(NOW), seq: 12, view: 'decisions', state: 'ok', open: [D1, D2],
  answered: [live('d9', 'Where does Activity live?', 'System', NOW - 7_200_000), imp('a34:d1', 'Pick the stage order', ['P0', 'P1'], '2026-11-23')], total: 2, next: null, ...over });
const ev = (id, trust, kind, summary) => ({ id, kind, trust, source: trust === 'imported' ? 'importer' : 'github', summary, observed_at: iso(NOW - 60_000), data: {},
  provenance: trust === 'imported' ? IMPORTED : { trust: 'reported', source: 'github', at: iso(NOW - 60_000) } });
const evidence = (over = {}) => ({ version: 1, as_of: iso(NOW), seq: 12, view: 'evidence',
  evidence: { rows: [ev('e1', 'trusted', 'release', 'Release 653dc50 is live'), ev('e2', 'reported', 'pr', 'PR #315 opened'), ev('e3', 'imported', 'doc', 'Plan imported')], total: 3, next: null },
  events: { rows: [event(12), event(11, { source: 'importer', type: 'revision.proposed', text: null })], next_before: null, group: null }, ...over });
const changes = (over = {}) => ({ version: 1, as_of: iso(NOW + 15_000), seq: 12, after: 12, reset: false, views: [], events: [], truncated: false, executions: [exec()], ...over });
const list = (over = {}) => ({ version: 1, as_of: iso(NOW), seq: 12, view: 'list', missions: [{ id: 'a34', title: 'Pi Hub draws the Assistant', status: 'active', revision: rev(1, 'accepted'),
  decisions: { state: 'ok', open: 2, blocking: 1, answered: 14 }, provenance: IMPORTED }], ...over });
const fail = (status, body = { detail: 'No.' }) => ({ __status: status, body });

// The hub: `over` replaces a read by name (a body, a function of (url, opts), a fail(), or an Error to throw).
function hub(over = {}) {
  const base = { list: list(), overview: overview(), decisions: decisions(), evidence: evidence(), changes: changes(), owner: { ok: true, changed: true, revision: { n: 1, status: 'accepted' } } };
  return async (url, opts = {}) => {
    const u = new URL(url, 'http://hub.test');
    const name = u.pathname === '/api/missions' ? 'list' : u.pathname.endsWith('/changes') ? 'changes' : u.pathname.endsWith('/owner') ? 'owner'
      : u.pathname.startsWith('/api/missions/') ? u.searchParams.get('view') : 'other';
    const r = name in over ? over[name] : base[name];
    return typeof r === 'function' ? r(u, opts) : r;
  };
}

async function open(handler, { path = '/missions/a34', page = 'mission.js', search = '', confirm = true } = {}) {
  const dom = install({ confirm });
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const r = await handler(String(url), opts);
    if (r instanceof Error) throw r;
    if (r === undefined) return new Response('{"detail":"no"}', { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(r.__status ? r.body : r), { status: r.__status || 200, headers: { 'content-type': 'application/json' } });
  };
  Object.assign(globalThis.location, { pathname: path, search });
  const toast = document.createElement('div');
  toast.id = 'toast';
  document.body.append(toast);
  const mod = await import(`../hub/static/js/${page}`);
  const root = dom.root();
  const state = { root, context: new URLSearchParams(search) };
  mod.mount(state);
  const k = {
    dom, mod, state, root, calls, toast: () => text(toast),
    load: async () => { await mod.load(state); await flush(); },
    panel: () => text(root.querySelector('#mission-panel')), all: () => text(root),
    tab: async (key) => { root.querySelector(`#mission-tab-${key}`).click(); await flush(); },
    buttons: (label) => root.querySelectorAll('button').filter((b) => b.textContent.startsWith(label)),
    done() { mod.leave?.(state); dom.uninstall(); },
  };
  return k;
}
const withPage = (handler, opts, fn) => (async () => { const k = await open(handler, opts); try { await fn(k); } finally { k.done(); } })();

// ---- /missions ----

test('/missions: a row per initiative with its title, status, revision provenance and open decisions', () => withPage(hub(), { path: '/missions', page: 'missions.js' }, async (k) => {
  await k.load();
  const rows = k.root.querySelectorAll('a.ui-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].getAttribute('href'), '/missions/a34');
  const t = text(rows[0]);
  assert.match(t, /Pi Hub draws the Assistant/);
  assert.match(t, /Active/);
  assert.match(t, new RegExp(`Imported from ${FROM}`));
  assert.match(t, /Revision 1, accepted/);
  assert.match(t, /2open decisions|2 open decisions/);
  assert.match(text(k.root.querySelector('.ui-faceplate')), /1\s*mission/);
  assert.deepEqual(k.state.sources.map((s) => s.name), ['Ledger']);
}));

test('/missions: a proposed import says so; a mission with no plan says that; zero open decisions is said in words, not a figure', () => withPage(hub({
  list: list({ missions: [
    { id: 'a34', title: 'A34', status: 'proposed', revision: rev(1, 'proposed'), decisions: { state: 'ok', open: 0, blocking: 0, answered: 0 }, provenance: IMPORTED },
    { id: 'b1', title: 'B1', status: 'proposed', revision: null, decisions: { state: 'ok', open: 0, blocking: 0, answered: 0 }, provenance: { trust: 'imported', source: 'importer', from: null } }] }) }),
{ path: '/missions', page: 'missions.js' }, async (k) => {
  await k.load();
  const [a, b] = k.root.querySelectorAll('a.ui-row').map(text);
  assert.match(a, /Proposed/);
  assert.match(a, /Revision 1, proposed/);
  assert.match(a, /No decisions open/);
  assert.match(b, /No plan imported yet/);
  assert.equal(k.root.querySelectorAll('.ui-row__figure').length, 0, 'no figure for no number');
}));

test('/missions: no initiative at all is "No missions yet", not an error', () => withPage(hub({ list: list({ missions: [] }) }), { path: '/missions', page: 'missions.js' }, async (k) => {
  await k.load();
  assert.match(k.all(), /No missions yet/);
  assert.doesNotMatch(k.all(), /can't be read/);
}));

for (const [why, reply, words] of [
  ['the ledger is down (503)', fail(503), /The ledger can't be read/], ['the hub is silent', new Error('network'), /Pi Hub isn't answering/],
  ['not the owner (403)', fail(403), /Sign in as the owner/], ['a newer contract', list({ version: 2 }), /older than Pi Hub/],
  ['a body that is not a list', { version: 1, missions: 'x' }, /couldn't be read/],
]) {
  test(`/missions: ${why} is "Missions can't be read", never "No missions yet"`, () => withPage(hub({ list: reply }), { path: '/missions', page: 'missions.js' }, async (k) => {
    await k.load();
    assert.match(k.all(), /Missions can't be read/);
    assert.match(k.all(), words);
    assert.doesNotMatch(k.all(), /No missions yet/);
    assert.equal(k.root.querySelectorAll('a.ui-row').length, 0);
    assert.equal(k.state.sources[0].tone, 'bad');
    if (!/403/.test(why)) assert.equal(k.buttons('Try again').length, 1);
  }));
}

test('/missions: a failed refresh keeps the last rows, says how old they are, and a refused one drops them', () => {
  let n = 0;
  return withPage(hub({ list: () => (++n === 1 ? list() : fail(503)) }), { path: '/missions', page: 'missions.js' }, async (k) => {
    await k.load();
    await k.load();
    assert.equal(k.root.querySelectorAll('a.ui-row').length, 1);
    assert.match(k.all(), /Couldn't refresh\. This is what Pi Hub last said, as of 09:41/);
    assert.match(k.state.sources[0].word, /last read 09:41/);
  });
});

test('/missions: a decisions table that could not be read is not a count of zero', () => withPage(hub({
  list: list({ missions: [{ ...list().missions[0], decisions: { state: 'unavailable' } }] }) }), { path: '/missions', page: 'missions.js' }, async (k) => {
  await k.load();
  assert.match(text(k.root.querySelector('a.ui-row')), /Decisions couldn't be read/);
  assert.equal(k.root.querySelectorAll('.ui-row__figure').length, 0);
  assert.match(text(k.root.querySelector('.ui-faceplate')), /Decisions not read/);
}));

test('/missions: loading is drawn before the first answer', () => withPage(hub(), { path: '/missions', page: 'missions.js' }, async (k) => {
  assert.equal(k.root.querySelectorAll('.ui-skeleton').length > 0, true);
  assert.equal(k.root.querySelector('.ui-faceplate').getAttribute('aria-busy'), 'true');
}));

// ---- Overview ----

test('Overview: gates as "n of m" with the plan\'s provenance, every count with its denominator, the sources line', () => withPage(hub(), {}, async (k) => {
  await k.load();
  const plate = text(k.root.querySelector('.ui-faceplate'));
  assert.match(plate, /Pi Hub draws the Assistant/);
  assert.match(plate, /0 of 7\s*gates met/);
  assert.match(plate, new RegExp(`Imported from ${FROM}`));
  assert.match(plate, /Revision 1, accepted/);
  const p = k.panel();
  assert.match(p, /Stage.*P0 Headroom/);
  assert.match(p, /Gates.*0 of 7 met/);
  assert.match(p, /Tasks.*2 active · 2 done of 23 tasks/);
  assert.match(p, /3 with a state a session reported/);
  assert.match(p, /Decisions.*2 open \(1 blocking\) · 14 answered/);
  assert.match(p, /Evidence.*1 trusted · 6 reported · 9 imported of 16/);
  assert.match(p, /Risks.*1 open of 1/);
  const meters = k.root.querySelectorAll('.ui-meter');
  assert.deepEqual(meters.map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow'), m.getAttribute('aria-valuemax')]),
    [['0 of 7 gates met', '0', '7'], ['2 of 23 tasks done', '2', '23']]);
  assert.deepEqual(k.state.sources, [{ name: 'Ledger', tone: 'ok', word: 'as of 09:41' }, { name: 'Plan', tone: 'ok', word: 'azmusgb/pi-hub@4ef3c14' }]);
  assert.equal(k.root.querySelectorAll('[role="tab"]').length, 3);
  assert.equal(k.root.querySelector('[aria-selected="true"]').dataset.tab, 'overview');
}));

test('Overview: a plan with no gates, tasks, evidence or risks says so; no target is a meter', () => withPage(hub({ overview: overview({
  counts: { tasks: { by_state: {}, of: 0, reported: 0 }, gates: { met: 0, of: 0 }, decisions: { state: 'ok', open: 0, blocking: 0, answered: 0 }, evidence: { trusted: 0, owner: 0, reported: 0, imported: 0, of: 0 }, risks: { open: 0, mitigated: 0, of: 0 } },
  stages: [], executions: [], events: [] }) }), {}, async (k) => {
  await k.load();
  const p = k.panel();
  for (const w of [/No stages in this plan/, /No gates in this plan/, /No tasks in this plan/, /No decisions yet/, /No evidence yet/, /No risks in this plan/,
    /No session or run is attached/, /Nothing has happened on this mission yet/]) assert.match(p, w);
  assert.equal(k.root.querySelectorAll('.ui-meter').length, 0);
  assert.doesNotMatch(text(k.root.querySelector('.ui-faceplate')), /0 of 0/);
}));

test('Overview: a counts block that is missing or the wrong type is "Couldn\'t be read", never 0', () => withPage(hub({ overview: overview({
  counts: { tasks: null, gates: {}, decisions: { state: 'unavailable' }, evidence: { of: 'x' }, risks: undefined } }) }), {}, async (k) => {
  await k.load();
  const p = k.panel();
  assert.equal((p.match(/Couldn't be read/g) || []).length, 5);
  assert.doesNotMatch(p, /\b0 open|0 of/);
  assert.equal(k.root.querySelectorAll('.ui-tabs .count').length, 0, 'no count on the tab for a count not read');
}));

test('Overview: an imported plan not yet accepted is Proposed, with Accept revision 1 as the one primary action', () => withPage(hub({ overview: overview({
  initiative: { ...overview().initiative, status: 'proposed' }, revision: rev(1, 'proposed'), proposed: [proposed(1)] }) }), {}, async (k) => {
  await k.load();
  const plate = k.root.querySelector('.ui-faceplate');
  assert.match(text(plate), /Proposed/);
  assert.match(text(plate), /Revision 1, proposed: imported, not accepted yet/);
  const primary = k.root.querySelectorAll('.ui-btn--primary');
  assert.deepEqual(primary.map(text), ['Accept revision 1']);
  assert.deepEqual(k.buttons('Reject').map(text), ['Reject']);
}));

test('Overview: Accept revision n posts the owner verb for the revision seen, and the page reads again', () => {
  const posts = [];
  let accepted = false;
  return withPage(hub({
    overview: () => (accepted ? overview() : overview({ revision: rev(1, 'proposed'), proposed: [proposed(1)] })),
    owner: (_u, o) => { posts.push(JSON.parse(o.body)); accepted = true; return { ok: true, changed: true, revision: { n: 1, status: 'accepted' }, seq: 13 }; },
    changes: () => changes({ seq: 13, views: ['overview', 'evidence'] }) }), {}, async (k) => {
    await k.load();
    k.buttons('Accept revision 1')[0].click();
    await flush();
    assert.deepEqual(posts, [{ verb: 'revision.accept', revision: 1 }]);
    assert.equal(k.toast(), 'Accepted revision 1.');
    assert.equal(k.root.querySelectorAll('.ui-btn--primary').length, 0, 'accepted: nothing to accept');
    assert.match(k.root.querySelector('.ui-faceplate').textContent, /Revision 1, accepted/);
  });
});

test('Overview: a tap in flight disables both buttons and says what it waits for; a double tap sends once', () => {
  let release;
  const posts = [];
  return withPage(hub({ overview: overview({ revision: rev(1, 'proposed'), proposed: [proposed(1)] }),
    owner: (_u, o) => { posts.push(o.body); return new Promise((r) => { release = () => r({ ok: true, changed: false }); }); } }), {}, async (k) => {
    await k.load();
    const accept = k.buttons('Accept revision 1')[0];
    accept.click();
    await flush();
    k.buttons('Accept revision 1')[0].click();
    await flush();
    assert.equal(posts.length, 1);
    assert.ok(k.buttons('Accept revision 1')[0].disabled && k.buttons('Reject')[0].disabled);
    assert.match(text(k.root.querySelector('.ui-faceplate')), /Recording…/);
    release();
    await flush();
  });
});

test('Overview: a failed tap keeps the buttons and says "Not recorded. Try again."; a moved revision says where it is now (409)', async () => {
  for (const [reply, words] of [[fail(500), /Not recorded\. Try again\./], [fail(409, { error: 'conflict', detail: 'Revision 1 is accepted, not proposed.' }), /Revision 1 is accepted, not proposed\. Showing it as it is now\./]]) {
    await withPage(hub({ overview: overview({ revision: rev(1, 'proposed'), proposed: [proposed(1)] }), owner: reply }), {}, async (k) => {
      await k.load();
      k.buttons('Accept revision 1')[0].click();
      await flush();
      assert.match(text(k.root.querySelector('.ui-faceplate')), words);
      assert.equal(k.buttons('Accept revision 1')[0].disabled, false, 'the way out stays');
      assert.equal(k.toast(), '');
    });
  }
});

test('Overview: Reject asks first, naming the revision; "no" sends nothing', async () => {
  const asked = [];
  await withPage(hub({ overview: overview({ revision: rev(1, 'proposed'), proposed: [proposed(1)] }) }), { confirm: async (_t, o) => { asked.push(o); return false; } }, async (k) => {
    await k.load();
    k.buttons('Reject')[0].click();
    await flush();
    assert.match(asked[0].what, /Revision 1 is rejected/);
    assert.equal(k.calls.filter((c) => c.method === 'POST').length, 0);
  });
  await withPage(hub({ overview: overview({ revision: rev(1, 'proposed'), proposed: [proposed(1)] }) }), {}, async (k) => {
    await k.load();
    k.buttons('Reject')[0].click();
    await flush();
    assert.deepEqual(k.calls.filter((c) => c.method === 'POST').map((c) => c.body), [{ verb: 'revision.reject', revision: 1 }]);
  });
});

test('Overview: a second proposed revision waits behind the first, its action disabled with the reason', () => withPage(hub({ overview: overview({
  revision: rev(1, 'proposed'), proposed: [proposed(1), proposed(2)] }) }), {}, async (k) => {
  await k.load();
  assert.equal(k.root.querySelectorAll('.ui-btn--primary').length, 1);
  assert.match(k.panel(), /Revision 2.*Decide the earlier revision first\./);
  assert.equal(k.buttons('Accept revision 2')[0].disabled, true);
}));

test('Overview: a named source that is not answering is said by name, and an unknown one is "not read yet"', () => withPage(hub({ overview: overview({
  sources: [{ name: 'ledger', state: 'ok', as_of: iso(NOW) }, { name: 'github', state: 'unavailable' }, { name: 'localai', state: 'unknown' }] }) }), {}, async (k) => {
  await k.load();
  assert.match(text(k.root.querySelector('div')), /GitHub isn't answering\. What it adds to this page isn't current\./);
  assert.deepEqual(k.state.sources.slice(1), [{ name: 'GitHub', tone: 'bad', word: "isn't answering" }, { name: 'Local AI', tone: 'unknown', word: 'not read yet' }]);
}));

test('Overview: the GitHub source shows when it last checked', () => withPage(hub({ overview: overview({
  sources: [{ name: 'ledger', state: 'ok', as_of: iso(NOW) }, { name: 'github', state: 'ok', last_pass_at: iso(NOW - 60_000) }] }) }), {}, async (k) => {
  await k.load();
  assert.deepEqual(k.state.sources[1], { name: 'GitHub', tone: 'ok', word: 'checked 09:40' });
}));

test('Overview: executions carry shown() labels and provenance; an imported row never claims to be live', () => withPage(hub({ overview: overview({ executions: [
  exec({ id: 'a' }),
  exec({ id: 'b', title: 'Local AI run', source: 'localai', level: 'full', model: null, branch: null, shown: 'Last known 08:58 (PC asleep)', state: 'running', live: false, since: iso(NOW - 2_580_000) }),
  exec({ id: 'c', title: 'Finished session', shown: 'Turn finished 09:30', state: 'turn_finished', live: false, since: iso(NOW - 660_000) }),
  exec({ id: 'd', title: 'Waiting session', shown: 'Waiting for you since 09:20', state: 'waiting_owner', live: false, since: iso(NOW - 1_260_000) }),
  exec({ id: 'e', title: 'Quiet session', shown: 'No report yet', state: 'unknown', live: false, since: null }),
  exec({ id: 'f', title: 'Tool session', shown: 'Running a tool for 4 min', state: 'running_tool', live: true, since: iso(NOW - 240_000) })] }) }), {}, async (k) => {
  await k.load();
  const rows = k.root.querySelectorAll('.ui-row--lamp').filter((r) => /session|run|fix/i.test(text(r)) && r.querySelector('.ui-chip'));
  const by = Object.fromEntries(rows.map((r) => [text(r.querySelector('.ui-row__title')), text(r)]));
  assert.match(by['pi-hub fix/release-test-timing'], /Claude Code · fix\/release-test-timing · Opus 5\.5 \(reported\)/);
  assert.match(by['pi-hub fix/release-test-timing'], /Working Live/);
  assert.match(by['Local AI run'], /Last known 08:58 \(PC asleep\).*Last known/);
  assert.match(by['Finished session'], /Turn finished 09:30.*Reported 09:30/);
  assert.match(by['Waiting session'], /Waiting for you/);
  assert.match(by['Quiet session'], /No report yet.*No report yet/);
  assert.match(by['Tool session'], /Running a tool for 4 min/);
  // Only the two live ones have a live lamp and the kit's live mark.
  assert.equal(k.root.querySelectorAll('.ui-chip--live').length, 2);
  assert.equal(k.root.querySelectorAll('.ui-prov[data-level="live"]').length, 2);
  // Imported rows (the plan, its stage) are hollow marks, never "Live".
  for (const p of k.root.querySelectorAll('.ui-prov[data-level="imported"]')) assert.match(p.textContent, /^Imported from /);
}));

test('Overview: recent events say who and when, with a source label each, and text from a session stays text', () => withPage(hub({ overview: overview({ events: [
  event(14, { text: '<img src=x onerror=alert(1)>' }), event(13, { source: 'owner', type: 'revision.accepted', text: null }), event(12, { source: 'importer', type: 'revision.proposed', text: null }),
  event(11, { source: 'github', type: 'check.completed', text: null }), event(10, { late: true, text: 'Late report' })] }) }), {}, async (k) => {
  await k.load();
  const rows = k.root.querySelectorAll('.ui-section').find((s) => text(s.querySelector('h2')) === 'Recent').querySelectorAll('.ui-row');
  assert.equal(rows.length, 5);
  assert.match(text(rows[0]), /<img src=x onerror=alert\(1\)>/);
  assert.equal(k.root.querySelectorAll('img').length, 0);
  assert.match(text(rows[1]), /Revision accepted.*You.*Recorded by you/);
  assert.match(text(rows[2]), new RegExp(`Import.*Imported from ${FROM}`));
  assert.match(text(rows[3]), /GitHub.*Checked/);
  assert.match(text(rows[4]), /Claude Code · reported late.*Reported/);
}));

// ---- §17.1 page half: the timer ----

test('test_relabel_timer_turns_live_into_no_report_since', () => withPage(hub(), {}, async (k) => {
  await k.load();
  const t0 = k.state.clock.local, reads = k.calls.length;
  const sess = () => k.root.querySelectorAll('.ui-row--lamp').find((r) => text(r).includes('release-test-timing'));
  assert.match(text(sess()), /Working Live/);
  assert.equal(sess().querySelectorAll('.ui-chip--live').length, 1);
  k.mod.relabel(k.state, t0 + 90_000);  // 110 s since its last report: still inside the 2-minute window
  assert.match(text(sess()), /Working Live/);
  k.mod.relabel(k.state, t0 + 100_000);  // 120 s: the window is over
  assert.match(text(sess()), /No report since 09:40/);
  assert.doesNotMatch(text(sess()), /Working|Live/);
  assert.equal(sess().querySelectorAll('.ui-chip--live').length, 0);
  assert.equal(sess().querySelectorAll('.ui-prov[data-level="live"]').length, 0);
  assert.match(text(sess().querySelector('.ui-chip')), /No report/);
  assert.equal(k.calls.length, reads, 'relabelled by the timer, with no new read');
  k.mod.relabel(k.state, t0 + 3_600_000);  // an hour on, still the same words and the same time
  assert.match(text(sess()), /No report since 09:40/);
}));

test('shownNow: a past statement never turns live, a tool counts its minutes, and a read that failed is "Last known"', () => {
  const T = NOW;
  const turn = exec({ shown: 'Turn finished 09:30', state: 'turn_finished', live: false, since: iso(T - 660_000) });
  assert.deepEqual(shownNow(turn, T + 7_200_000), { label: 'Turn finished 09:30', state: 'turn_finished', live: false });
  // The hub writes its own zone's HH:MM; the page writes the same instant in the browser's.
  assert.equal(shownNow(exec({ shown: 'Turn finished 04:12', state: 'turn_finished', live: false, since: iso(T - 29 * 60_000) }), T).label, `Turn finished ${hhmm(T - 29 * 60_000)}`);
  assert.equal(shownNow(exec({ shown: 'No report yet', state: 'unknown', live: false, since: null }), T).label, 'No report yet');
  const tool = exec({ shown: 'Running a tool for under 1 min', state: 'running_tool', live: true, since: iso(T) });
  assert.equal(shownNow(tool, T + 30_000).label, 'Running a tool for under 1 min');
  assert.equal(shownNow(tool, T + 9 * 60_000).label, 'Running a tool for 9 min');
  assert.equal(shownNow(tool, T + 9 * 60_000).live, true, 'no window while a tool runs (§7.5)');
  const work = exec({ since: iso(T) });
  assert.deepEqual(shownNow(work, T + 119_000), { label: 'Working', state: 'working', live: true });
  assert.deepEqual(shownNow(work, T + 120_000), { label: `No report since ${hhmm(T)}`, state: 'silent', live: false });
  assert.deepEqual(shownNow(work, T + 1_000, true), { label: `Last known ${hhmm(T)} (Pi Hub isn't answering)`, state: 'unknown', live: false });
  assert.equal(shownNow(exec({ since: null }), T).live, false, 'a live claim with no time to count from is not one');
  assert.equal(stamp('nonsense'), '');
  assert.equal(stamp('2026-11-23'), new Date(2026, 10, 23).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), 'a date with no time is that day, not midnight UTC');
  assert.doesNotMatch(stamp('2026-11-23'), /\d:\d\d/);
  assert.equal(hhmm(NaN), '');
});

// ---- stale, refused, missing, out of date, loading ----

test('stale: a failed poll keeps the page, says its age, turns live into "Last known", and disables the action with the reason', () => {
  let down = false;
  return withPage(hub({ overview: overview({ revision: rev(1, 'proposed'), proposed: [proposed(1)] }), changes: () => (down ? fail(503) : changes()) }), {}, async (k) => {
    await k.load();
    assert.match(k.panel(), /Working Live/);
    down = true;
    await k.load();
    const t = k.all();
    assert.match(t, /Couldn't refresh: The ledger can't be read\. This is what Pi Hub last said, as of 09:41/);
    assert.match(text(k.root.querySelector('.ui-faceplate')), /Last known: Active/);
    assert.match(text(k.root.querySelector('.ui-faceplate')), /Last read 09:41/);
    assert.doesNotMatch(k.panel(), /Working Live/);
    assert.match(k.panel(), /Last known 09:40 \(Pi Hub isn't answering\)/);
    assert.ok(k.buttons('Accept revision 1')[0].disabled);
    assert.match(text(k.root.querySelector('.ui-faceplate')), /Pi Hub isn't answering, so nothing can be recorded\./);
    assert.deepEqual(k.state.sources[0], { name: 'Ledger', tone: 'warn', word: 'last read 09:41' });
    down = false;
    await k.load();
    assert.doesNotMatch(k.all(), /Couldn't refresh/);
    assert.equal(k.buttons('Accept revision 1')[0].disabled, false);
  });
});

test('the mission can\'t be read: each way it can fail has its own words, and none draws a plate of zeros', async () => {
  for (const [reply, words, action] of [[fail(503), /The ledger can't be read\./, 'Try again'], [new Error('x'), /Pi Hub isn't answering\./, 'Try again'],
    [fail(403), /Sign in as the owner/, 'Open Settings'], [fail(404), /There is no mission at this address\./, 'Open Missions'],
    [overview({ version: 2 }), /older than Pi Hub/, 'Try again'], [{ version: 1, nope: true }, /answer couldn't be read/, 'Try again']]) {
    await withPage(hub({ overview: reply }), {}, async (k) => {
      await k.load();
      assert.match(k.all(), /This mission can't be read/);
      assert.match(k.all(), words);
      assert.match(k.panel(), new RegExp(action));
      assert.doesNotMatch(k.all(), /\b0 of|No stages|No gates|No evidence/);
      assert.equal(k.root.querySelector('.ui-tabs').hidden, true, 'no tabs without a mission');
    });
  }
});

test('an address that is not a mission id is "no mission", with no read made', () => withPage(hub(), { path: '/missions/NOT_A_SLUG' }, async (k) => {
  await k.load();
  assert.match(k.all(), /There is no mission at this address\./);
  assert.equal(k.calls.length, 0);
}));

test('loading: the plate and the panel are skeletons, busy, before the first answer', () => withPage(hub(), {}, async (k) => {
  assert.equal(k.root.querySelector('.ui-faceplate').getAttribute('aria-busy'), 'true');
  assert.ok(k.root.querySelector('#mission-panel .ui-skeleton'));
  assert.equal(k.root.querySelector('.ui-tabs').hidden, true);
}));

test('a refused or newer-contract answer after a good one drops what was drawn: no owner data is kept for a signed-out page', async () => {
  for (const reply of [fail(401), changes({ version: 2 })]) {
    await withPage(hub({ changes: reply }), {}, async (k) => {
      await k.load();
      await k.load();
      assert.match(k.all(), /This mission can't be read/);
      assert.doesNotMatch(k.all(), /Pi Hub draws the Assistant|2 active/);
    });
  }
});

// ---- the poll ----

test('the poll asks for what changed after the overview\'s seq; a quiet answer reads nothing else', () => withPage(hub(), {}, async (k) => {
  await k.load();
  const before = k.calls.length;
  await k.load();
  assert.deepEqual(k.calls.slice(before).map((c) => c.url), ['/api/missions/a34/changes?after=12']);
}));

test('the poll reads the overview again when it says it changed, and the executions come from the poll', () => {
  let seq = 12;
  return withPage(hub({ overview: () => overview({ seq, events: [event(seq, { text: `Event ${seq}` })] }),
    changes: () => changes({ seq: 13, views: ['overview', 'evidence'], executions: [exec({ title: 'Moved on' })] }) }), {}, async (k) => {
    await k.load();
    seq = 13;
    await k.load();
    assert.match(k.panel(), /Event 13/);
    assert.equal(k.state.seq, 13);
    assert.deepEqual(k.calls.slice(-2).map((c) => c.url), ['/api/missions/a34/changes?after=12', '/api/missions/a34?view=overview']);
  });
});

test('a changes answer with an `after` past the log (reset) reads every view again', () => withPage(hub({ changes: changes({ reset: true, views: ['overview', 'decisions', 'evidence'] }) }), {}, async (k) => {
  await k.load();
  await k.tab('decisions');
  const before = k.calls.length;
  await k.load();
  const urls = k.calls.slice(before).map((c) => c.url);
  assert.ok(urls.includes('/api/missions/a34?view=overview') && urls.some((u) => u.includes('view=decisions')), urls.join(' '));
}));

test('a changes body of the wrong shape is "unreadable": the page goes stale, it does not take the body as no change', () => withPage(hub({ changes: { version: 1, seq: 'x' } }), {}, async (k) => {
  await k.load();
  await k.load();
  assert.match(k.all(), /Couldn't refresh: Pi Hub's answer couldn't be read\./);
}));

// ---- Decisions ----

test('Decisions: the open ones through the kit\'s group, then the answered ones newest first with their provenance', () => withPage(hub(), {}, async (k) => {
  await k.load();
  assert.match(text(k.root.querySelector('.ui-tabs')), /Decisions2/);
  await k.tab('decisions');
  assert.equal(k.root.querySelector('[aria-selected="true"]').dataset.tab, 'decisions');
  assert.equal(k.root.querySelectorAll('.ui-decision').length, 2);
  assert.match(text(k.root.querySelector('.ui-decisions__title')), /Decisions \(2\)/);
  assert.match(k.panel(), /Raise the 900 s test limit\?/);
  const answered = k.root.querySelectorAll('.mission-answered .ui-row');
  assert.equal(answered.length, 2);
  assert.match(text(answered[0]), /Where does Activity live\?.*Answered: System.*Recorded by you/);
  assert.match(text(answered[1]), new RegExp(`Pick the stage order.*Answered: P0, P1.*Imported from ${FROM}`));
  assert.match(k.panel(), /Answered \(2\)/);
}));

test('Decisions: nothing open is "Nothing is waiting for you", and no answered ones is said', () => withPage(hub({ decisions: decisions({ open: [], answered: [], total: 0 }) }), { search: '?tab=decisions' }, async (k) => {
  await k.load();
  assert.match(k.panel(), /Nothing is waiting for you\./);
  assert.match(k.panel(), /No decision has been answered yet\./);
  assert.equal(k.root.querySelectorAll('.ui-decision').length, 0);
}));

test('Decisions: the live table unreadable is the kit\'s own error, never an empty group, with the imported answers still drawn', () => withPage(hub({ decisions: decisions({ state: 'unavailable', open: [], answered: [imp('a34:d1', 'Pick the stage order', 'P0', '2026-11-23')], total: 1 }) }), { search: '?tab=decisions' }, async (k) => {
  await k.load();
  assert.match(k.panel(), /Decisions couldn't be read/);
  assert.doesNotMatch(k.panel(), /Nothing is waiting for you/);
  assert.match(k.panel(), /Pick the stage order/);
}));

test('Decisions: paging appends the next answered ones; a failed page says so and keeps the rows', () => {
  const page2 = decisions({ answered: [imp('a34:d2', 'An older question', 'Yes', '2026-11-20')], total: 3, next: null });
  let fails = true;
  return withPage(hub({ decisions: (u) => (u.searchParams.get('offset') ? (fails ? fail(503) : page2) : decisions({ total: 3, next: 2 })) }), { search: '?tab=decisions' }, async (k) => {
    await k.load();
    assert.equal(k.buttons('Show more answers').length, 1);
    k.buttons('Show more answers')[0].click();
    await flush();
    assert.equal(k.toast(), "Couldn't load more. Try again.");
    assert.equal(k.root.querySelectorAll('.mission-answered .ui-row').length, 2);
    fails = false;
    k.buttons('Show more answers')[0].click();
    await flush();
    assert.equal(k.root.querySelectorAll('.mission-answered .ui-row').length, 3);
    assert.match(k.panel(), /An older question/);
    assert.equal(k.buttons('Show more answers').length, 0);
    assert.ok(k.calls.some((c) => c.url.includes('offset=2')));
  });
});

test('Decisions: the tab read failing is its own state with a way out, and Overview stays drawn', () => {
  let ok = false;
  return withPage(hub({ decisions: () => (ok ? decisions() : fail(503)) }), { search: '?tab=decisions' }, async (k) => {
    await k.load();
    assert.match(k.panel(), /Decisions can't be read/);
    assert.match(k.panel(), /The ledger can't be read\./);
    assert.match(text(k.root.querySelector('.ui-faceplate')), /Pi Hub draws the Assistant/);
    ok = true;
    k.buttons('Try again')[0].click();
    await flush();
    assert.equal(k.root.querySelectorAll('.ui-decision').length, 2);
  });
});

test('Decisions: while the hub is not answering the group is the kit\'s "Not current", and a stale list is not drawn as fresh', () => {
  let down = false;
  return withPage(hub({ changes: () => (down ? new Error('x') : changes()) }), { search: '?tab=decisions' }, async (k) => {
    await k.load();
    down = true;
    await k.load();
    assert.match(k.panel(), /Not current: couldn't refresh the decisions/);
    assert.equal(k.root.querySelectorAll('.ui-decision').length, 2, 'the rows last read are kept');
  });
});

test('Decisions: an answer is written by the kit\'s own route and recorded only from what the hub holds', () => {
  const posts = [];
  return withPage(hub({ other: undefined }), { search: '?tab=decisions' }, async (k) => {
    const base = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('/api/decisions/')) {
        posts.push([String(url), JSON.parse(opts.body)]);
        return new Response(JSON.stringify({ ok: true, recorded: true, decision: { ...D1, answered_at: 1795431000, answer: 'No, fix the tests' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return base(url, opts);
    };
    await k.load();
    k.root.querySelector('[data-decision="d1"]').querySelectorAll('button').find((b) => b.textContent.startsWith('No, fix the tests')).click();
    await flush();
    assert.deepEqual(posts, [['/api/decisions/d1/answer', { answer: 'No, fix the tests' }]]);
    assert.match(k.panel(), /Recorded: No, fix the tests/);
  });
});

// ---- Evidence ----

test('Evidence: by trust, then kind, each row with its provenance; the history below with its filters', () => withPage(hub(), { search: '?tab=evidence' }, async (k) => {
  await k.load();
  const heads = k.root.querySelectorAll('#mission-panel h3').map(text);
  assert.deepEqual(heads, ['Trusted: read by Pi Hub', 'Reported by sessions', 'Imported from a reviewed file']);
  const rows = k.root.querySelectorAll('.ui-section')[0].querySelectorAll('.ui-row');
  assert.match(text(rows[0]), /Release 653dc50 is live.*Release.*Checked 09:40/);
  assert.match(text(rows[1]), /PR #315 opened.*Reported 09:40/);
  assert.match(text(rows[2]), new RegExp(`Plan imported.*Imported from ${FROM}`));
  assert.match(k.panel(), /Showing 3 of 3, by trust and then kind\./);
  assert.deepEqual(k.root.querySelectorAll('.ui-chips button').map(text), ['All events', 'Sessions', 'Imports', 'Owner', 'Decisions', 'GitHub']);
  assert.equal(k.root.querySelector('.ui-chips [aria-pressed="true"]').textContent, 'All events');
  const history = k.root.querySelectorAll('.ui-section')[1].querySelectorAll('.ui-row');
  assert.match(text(history[1]), new RegExp(`Revision proposed.*Import.*Imported from ${FROM}`));
}));

test('Evidence: no evidence is said, and is not an error', () => withPage(hub({ evidence: evidence({ evidence: { rows: [], total: 0, next: null }, events: { rows: [], next_before: null, group: null } }) }), { search: '?tab=evidence' }, async (k) => {
  await k.load();
  assert.match(k.panel(), /No evidence has been recorded for this mission yet\./);
  assert.match(k.panel(), /No events yet\./);
}));

test('Evidence: a filter asks the hub for that group, and an empty group says so', () => withPage(hub({ evidence: (u) => (u.searchParams.get('group') === 'github'
  ? evidence({ events: { rows: [], next_before: null, group: 'github' } }) : evidence()) }), { search: '?tab=evidence' }, async (k) => {
  await k.load();
  k.buttons('GitHub')[0].click();
  await flush();
  assert.equal(k.root.querySelector('.ui-chips [aria-pressed="true"]').textContent, 'GitHub');
  assert.match(k.panel(), /No events in this group\./);
  assert.ok(k.calls.some((c) => c.url.includes('view=evidence') && c.url.includes('group=github')));
}));

test('Evidence: paging appends more evidence and earlier events, each with its failed case', () => {
  let fails = true;
  const first = evidence({ evidence: { rows: [ev('e1', 'trusted', 'release', 'Release one')], total: 2, next: 1 }, events: { rows: [event(12)], next_before: 12, group: null } });
  const more = evidence({ evidence: { rows: [ev('e2', 'trusted', 'release', 'Release two')], total: 2, next: null }, events: { rows: [event(5, { text: 'Early event' })], next_before: null, group: null } });
  return withPage(hub({ evidence: (u) => (u.searchParams.get('offset') || u.searchParams.get('before') ? (fails ? fail(503) : more) : first) }), { search: '?tab=evidence' }, async (k) => {
    await k.load();
    for (const label of ['Show more evidence', 'Show earlier events']) {
      k.buttons(label)[0].click();
      await flush();
      assert.equal(k.toast(), "Couldn't load more. Try again.", label);
      assert.equal(k.buttons(label).length, 1, `${label} stays`);
    }
    fails = false;
    k.buttons('Show more evidence')[0].click();
    await flush();
    assert.match(k.panel(), /Release two/);
    assert.match(k.panel(), /Showing 2 of 2/);
    k.buttons('Show earlier events')[0].click();
    await flush();
    assert.match(k.panel(), /Early event/);
    assert.ok(k.calls.some((c) => c.url.includes('offset=1')) && k.calls.some((c) => c.url.includes('before=12')));
  });
});

test('Evidence: the tab read failing is its own state; a body of the wrong shape is unreadable', async () => {
  for (const reply of [fail(503), new Error('x'), { version: 1, evidence: 'x' }]) {
    await withPage(hub({ evidence: reply }), { search: '?tab=evidence' }, async (k) => {
      await k.load();
      assert.match(k.panel(), /Evidence can't be read/);
      assert.doesNotMatch(k.panel(), /No evidence has been recorded/);
      assert.equal(k.buttons('Try again').length, 1);
    });
  }
});

test('the tab strip: three tabs, arrow keys move between them, and the tab chosen stays in the address', () => withPage(hub(), {}, async (k) => {
  await k.load();
  const tabs = k.root.querySelectorAll('[role="tab"]');
  assert.deepEqual(tabs.map((t) => t.dataset.tab), ['overview', 'decisions', 'evidence']);
  assert.deepEqual(tabs.map((t) => t.getAttribute('tabindex')), ['0', '-1', '-1']);
  assert.equal(k.root.querySelector('#mission-panel').getAttribute('aria-labelledby'), 'mission-tab-overview');
  const saved = globalThis.history;
  const seen = [];
  globalThis.history = { replaceState: (_s, _t, url) => seen.push(url) };
  try {
    tabs[0].dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault() {} });
    await flush();
    assert.equal(k.root.querySelector('[aria-selected="true"]').dataset.tab, 'decisions');
    assert.equal(k.root.querySelector('#mission-panel').getAttribute('aria-labelledby'), 'mission-tab-decisions');
    assert.equal(document.activeElement.dataset.tab, 'decisions');
    assert.deepEqual(seen, ['/missions/a34?tab=decisions']);
  } finally { if (saved === undefined) delete globalThis.history; else globalThis.history = saved; }
}));

// ---- §17.8 ----

test('test_no_bare_percentage_in_rendered_dom', async () => {
  const bare = /\d\s*%/;
  const scan = (k, where) => {
    for (const el of k.root.querySelectorAll('*')) {
      for (const [name, value] of el.attributes) {
        if (name === 'style') continue;  // the meter's fill width is geometry, not words
        assert.doesNotMatch(value, bare, `${where}: ${el.tagName} ${name}`);
      }
    }
    assert.doesNotMatch(k.all(), bare, `${where}: text`);
    for (const m of k.root.querySelectorAll('[role="meter"]')) {
      const max = Number(m.getAttribute('aria-valuemax')), now = Number(m.getAttribute('aria-valuenow'));
      assert.ok(Number.isInteger(max) && Number.isInteger(now) && now <= max, `${where}: a meter is n of m`);
      assert.match(m.getAttribute('aria-label'), new RegExp(`^${now} of ${max} `), `${where}: its label carries both numbers`);
    }
  };
  await withPage(hub(), {}, async (k) => {
    await k.load();
    scan(k, 'overview');
    assert.ok(k.root.querySelectorAll('[role="meter"]').length >= 2);
    await k.tab('decisions'); scan(k, 'decisions');
    await k.tab('evidence'); scan(k, 'evidence');
  });
  await withPage(hub(), { path: '/missions', page: 'missions.js' }, async (k) => { await k.load(); scan(k, 'list'); });
  // Even a denominator that makes a tidy fraction (n of 100) is "n of 100", never a percent sign.
  await withPage(hub({ overview: overview({ counts: { ...overview().counts, gates: { met: 50, of: 100 } } }) }), {}, async (k) => {
    await k.load();
    scan(k, 'half');
    assert.match(text(k.root.querySelector('.ui-faceplate')), /50 of 100\s*gates met/);
  });
});

// ---- the router, the server's list, the Versions card, the shell ----

test('the two pages are in the router, in the offline shell, and System lights for a mission', () => {
  const main = read('hub/static/js/main.js'), sw = read('hub/static/sw.js');
  assert.match(main, /^  "\/missions": \["missions", missionsPage\],$/m);
  assert.match(main, /^  "\/missions\/<initiative>": \["mission", missionPage\],$/m);
  for (const f of ['missions.js', 'mission.js', 'mission-parts.js']) assert.ok(sw.includes(`"/static/js/${f}"`), `${f} is in the shell`);
  assert.equal(sectionFor('/missions'), 'system');
  assert.equal(sectionFor('/missions/a34'), 'system');
  assert.equal(sectionFor('/missions/'), '');
  assert.equal(sectionFor('/missions/A_B'), '');
  assert.equal(SITE.page('mission').path, '/missions/<initiative>');
});

test('Versions opens Missions from a card named and described by the page list', async () => {
  const dom = install({ fetch: { '/api/records': { records: [] }, '/api/needs': { items: [] }, '/api/me': { role: 'owner' }, '/api/settings': { releases: { log: [] } } } });
  try {
    const versions = await import('../hub/static/js/versions.js');
    const root = dom.root();
    versions.mount({ root });
    const card = root.querySelector('.missions-card a.ui-row');
    assert.equal(card.getAttribute('href'), '/missions');
    assert.equal(card.getAttribute('data-link'), '');
    assert.match(text(card), /Missions/);
    assert.match(text(card), new RegExp(SITE.page('missions').purpose));
  } finally { dom.uninstall(); }
});
