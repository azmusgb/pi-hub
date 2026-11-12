// A7 H6 / step 7a, Pi Hub's half (amendment A4, requirements 1 and 4-8): /assistant frames Local AI on its own origin,
// says pc_off or assistant_down itself, keeps its address in step with the frame and hands context to an open frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';
import './helpers/kit.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ORIGIN = 'https://assistant.rahe-home.duckdns.org';
const flush = () => new Promise((r) => setImmediate(r));

// The page in a fake shell: window's message listeners, the address and history, and /api/assistant answering `status`.
async function page(status, { search = '' } = {}) {
  const dom = install({ fetch: { '/api/assistant': status } });
  const listeners = new Set();
  globalThis.window = { addEventListener: (t, f) => t === 'message' && listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) };
  Object.assign(globalThis.location, { pathname: '/assistant', search });
  const replaced = [];
  globalThis.history = { state: null, replaceState: (_s, _t, url) => { replaced.push(url); const u = new URL(url, 'http://hub.test'); location.search = u.search; } };
  const view = document.createElement('main');
  view.id = 'view';
  document.body.append(view);
  const root = document.createElement('div');
  view.append(root);
  const mod = await import('../hub/static/js/assistant.js');
  const state = { root, context: new URLSearchParams(search) };
  mod.mount(state);
  await mod.load(state);
  const done = dom.uninstall;
  dom.uninstall = () => { mod.leave(state); done(); };  // no frame timer outlives the test
  const frame = () => root.querySelector('iframe');
  const post = (data, { origin = ORIGIN, source } = {}) => { for (const f of listeners) f({ data, origin, source: source ?? frame()?.contentWindow }); };
  return { dom, mod, state, root, frame, post, replaced, listeners };
}

test('the frame is Local AI at its own origin, with the hand-off or the page asked for in its address', async () => {
  const { frameSrc, cleanRoute, cleanContext } = await import('../hub/static/js/assistant.js');
  assert.equal(frameSrc(''), `${ORIGIN}/`);
  assert.equal(frameSrc('?to=run%2Fabc'), `${ORIGIN}/#run/abc`);
  assert.equal(frameSrc('?to=architecture%3Frepo%3Dpi-hub%26commit%3Dabc'), `${ORIGIN}/#architecture?repo=pi-hub&commit=abc`);
  assert.equal(frameSrc('?context=Pi%20Hub%20%E2%80%BA%20Workshop&to=work'), `${ORIGIN}/#ask?context=Pi%20Hub%20%E2%80%BA%20Workshop`, 'the hand-off wins');
  assert.equal(frameSrc('?to=a%0Ab'), `${ORIGIN}/`, 'a control character is no route');
  assert.equal(cleanRoute('#/work'), 'work');
  assert.equal(cleanRoute(42), null);
  assert.equal(cleanRoute('x'.repeat(601)), null);
  const long = cleanContext('😀'.repeat(400));
  assert.equal(Array.from(long).length, 300);
  assert.ok(long.endsWith('…') && !/[\uD800-\uDBFF]…$/.test(long), 'never half an emoji');
  assert.equal(cleanContext('a\n<b>\tc'), 'a <b> c', 'text, never markup: Local AI shows it as text');
});

test('Ready and Unknown open the frame; it has a title, sits in the page and nothing else loads Local AI', async () => {
  for (const state of ['Ready', 'Unknown']) {
    const { dom, frame, mod, state: s } = await page({ state, pc: 'unknown' });
    try {
      assert.ok(frame(), `${state}: a frame`);
      assert.equal(frame().getAttribute('title'), 'Assistant');  // A22 8.1: one name, Assistant
      assert.equal(frame().getAttribute('src'), `${ORIGIN}/`);
      assert.equal(document.documentElement.dataset.assistant, '1');
      mod.leave(s);
      assert.equal(frame(), null, 'removed on leave (requirement 6)');
      assert.equal(document.documentElement.dataset.assistant, undefined);
    } finally { dom.uninstall(); }
  }
  // Requirement 6: only /assistant makes the frame.
  for (const f of ['now.js', 'control-room.js', 'workshop.js', 'health.js', 'main.js']) assert.doesNotMatch(read(`hub/static/js/${f}`), /iframe/, f);
});

test('Down says the phrase-table words and loads no frame; Try again opens it once the PC answers', async () => {
  const off = await page({ state: 'Down', pc: 'off' });
  try {
    assert.equal(off.frame(), null);
    assert.equal(text(off.root.querySelector('h2')), 'The PC is asleep');
  } finally { off.dom.uninstall(); }
  let status = { state: 'Down', pc: 'on' };
  const p = await page(() => status);
  try {
    assert.equal(p.frame(), null);
    assert.equal(text(p.root.querySelector('h2')), "The Assistant isn't answering");
    status = { state: 'Ready', pc: 'on' };
    p.root.querySelector('button').dispatchEvent({ type: 'click' });
    await flush(); await flush();
    assert.ok(p.frame(), 'Try again opens the Assistant');
  } finally { p.dom.uninstall(); }
});

test('a frame that says nothing for 10 s is assistant_down with Try again, and stays so until asked', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = await page({ state: 'Unknown', pc: 'unknown' });
  try {
    assert.ok(p.frame());
    t.mock.timers.tick(10_000);
    assert.equal(p.frame(), null);
    assert.equal(text(p.root.querySelector('h2')), "The Assistant isn't answering");
    await p.mod.load(p.state);
    assert.equal(p.frame(), null, 'the next refresh does not reload a frame that timed out');
  } finally { p.dom.uninstall(); }
});

test('the address follows the frame: only Local AI\'s route post from this frame counts, by replaceState', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = await page({ state: 'Ready', pc: 'on' }, { search: '?context=Pi%20Hub%20%E2%80%BA%20Home' });
  try {
    p.frame().contentWindow = { postMessage() {} };
    p.post({ type: 'assistant-route', route: 'run/abc' }, { origin: 'https://evil.example' });
    p.post({ type: 'assistant-route', route: 'run/abc' }, { source: {} });
    p.post({ type: 'assistant-route', route: 'run/abc', extra: '<img>' }, { origin: 'https://hub.rahe-home.duckdns.org' });
    p.post('assistant-route');
    assert.deepEqual(p.replaced, [], 'another origin, another window or a bare string changes nothing');
    p.post({ type: 'assistant-route', route: 'run/abc' });
    assert.deepEqual(p.replaced, ['/assistant?to=run%2Fabc']);
    t.mock.timers.tick(10_000);
    assert.ok(p.frame(), 'Local AI answered, so no timeout');
    p.post({ type: 'assistant-route', route: 'run/abc' });
    assert.equal(p.replaced.length, 1, 'the same route writes nothing');
    p.post({ type: 'assistant-route', route: '' });
    assert.deepEqual(p.replaced.at(-1), '/assistant', 'Local AI\'s Home is /assistant');
    // A reload of the address the page wrote opens the same Assistant page; a route is Local AI's location.hash, already
    // encoded, and comes back unchanged (never encoded twice).
    const { frameSrc, addressFor } = p.mod;
    assert.equal(frameSrc('?to=run%2Fabc'), `${ORIGIN}/#run/abc`);
    const route = 'ask?context=Pi%20Hub%20%E2%80%BA%20Home';
    assert.equal(frameSrc(new URL(addressFor(route), 'http://hub.test').search), `${ORIGIN}/#${route}`);
    assert.equal(frameSrc('?to=a%20b%23c'), `${ORIGIN}/#a%20b%23c`, 'a space or # is encoded for the fragment');
  } finally { p.dom.uninstall(); }
});

test('a hand-off to an open frame goes by message to the Assistant\'s origin, never "*"; the button on its own page refocuses', async () => {
  const p = await page({ state: 'Ready', pc: 'on' });
  try {
    const sent = [];
    p.frame().contentWindow = { postMessage: (m, o) => sent.push([m, o]) };
    const url = (q) => new URL(`http://hub.test/assistant${q}`);
    assert.equal(p.mod.retarget(p.state, url('?context=Pi%20Hub%20%E2%80%BA%20Workshop')), false, 'not before Local AI has answered');
    p.post({ type: 'assistant-route', route: 'home' });
    assert.equal(p.mod.retarget(p.state, url('?context=Pi%20Hub%20%E2%80%BA%20Workshop')), true);
    assert.deepEqual(sent, [[{ type: 'assistant-context', context: 'Pi Hub › Workshop' }, ORIGIN]]);
    assert.equal(p.mod.retarget(p.state, url('')), true, 'the button on /assistant keeps the frame');
    assert.equal(document.activeElement, p.frame());
    assert.equal(p.mod.retarget(p.state, url('?to=work')), false, 'another Assistant page opens afresh, in place');
  } finally { p.dom.uninstall(); }
  const src = read('hub/static/js/assistant.js');
  assert.doesNotMatch(src, /postMessage\([^)]*["']\*["']/);
});

test('the shell: /assistant is a page, the button opens it with the page\'s facts, links to the Assistant stay in the shell', async () => {
  const { assistantHref, resolveLink } = await import('../hub/static/js/sections.js');
  const { sectionFor } = await import('../hub/static/js/site.js');
  assert.equal(assistantHref('hub.test', 'Workshop', 'printing 40%'), `/assistant?context=${encodeURIComponent('Pi Hub › Workshop: printing 40%')}`);
  assert.equal(resolveLink('tool:assistant/#run/r-1'), '/assistant?to=run%2Fr-1');
  assert.equal(resolveLink('tool:assistant'), '/assistant');
  assert.equal(resolveLink('tool:bambuddy/'), 'https://bambuddy.rahe-home.duckdns.org/', 'other tools are unchanged');
  assert.equal(sectionFor('/assistant'), 'assistant', 'no rail area is marked: the button is');
  const main = read('hub/static/js/main.js');
  assert.match(main, /^  "\/assistant": \["assistant", assistantPage\],$/m);
  assert.match(main, /title: path === "\/assistant" \? ASSISTANT\.name :/, "titled by its name in the tool list, Assistant");
  assert.match(main, /current\?\.mod\.retarget\?\.\(current\.state, url\)/);
  assert.match(main, /history\.replaceState\(\{\}, "", destination\)/, 'on /assistant, another Assistant link replaces: Back leaves in one step');
  const html = read('hub/static/index.html');
  for (const c of ['rail-assistant', 'top-assistant']) assert.match(html, new RegExp(`class="${c}" href="/assistant" data-link`));
  assert.doesNotMatch(html, /href="https:\/\/assistant\./, 'no button leaves the shell');
  assert.ok(read('hub/static/sw.js').includes('"/static/js/assistant.js"'));
  const css = read('hub/static/app.css');
  assert.match(css, /\[data-assistant\] \.stage \{ height: 100dvh; min-height: 0; \}/, 'the stage stops at the screen: the frame is the one scroller');
});

test('Versions opens Atlas in the shell, and the Site map lists the Assistant\'s areas as pages there', async () => {
  const { versionRows } = await import('../hub/static/js/versions.js');
  const commit = 'a'.repeat(40);
  const [row] = versionRows([{ id: 'release:pi-hub', state: 'live', detail: { target: 'pi-hub', commit, last: { result: 'deployed' } } }]);
  assert.equal(row.atlas, `/assistant?to=${encodeURIComponent(`architecture?repo=pi-hub&commit=${commit}`)}`);
  assert.match(read('hub/static/js/versions.js'), /href: v\.atlas, "data-link": true \}, "Architecture at this commit"/);
  const { siteMap } = await import('../hub/static/js/map.js');
  const g = siteMap().find((x) => x.key === 'assistant');
  assert.equal(g.path, '/assistant');
  assert.deepEqual(g.pages.map((p) => [p.label, p.href]), [['Home', '/assistant'], ['Work', '/assistant?to=work'],
    ['Projects', '/assistant?to=projects'], ['Improve', '/assistant?to=backlog'], ['System', '/assistant?to=status']]);
  assert.ok(!siteMap().some((x) => x.key === 'other' && x.pages.some((p) => p.href === '/assistant')));
});
