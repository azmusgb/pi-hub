// Pi Hub adopts the kit shell (appliance-ui 2.29.0, ui/shell.js): the rail and the tab bar are ApplianceShell.build's,
// drawn from the page list's five areas by navigation.js, which marks the current area and drives the badges. The Home
// page leads with Needs you. Run in node with the fake DOM (tests/helpers/fake_dom.mjs) and the kit's real shell.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';
import './helpers/kit.mjs';
import { SITE, sectionFor } from '../hub/static/js/site.js';
import { homeCards } from '../hub/static/js/home-cards.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const AREAS = ['home', 'workshop', 'household', 'network', 'system'];

// A page shell with the nav drawn into it, and a fresh copy of navigation.js (its state is the module's).
let copies = 0;
async function drawn(routes = {}) {
  const env = install({ fetch: routes });
  const nav = await import(`../hub/static/js/navigation.js?copy=${++copies}`);
  const shell = env.document.createElement('div');
  shell.className = 'ui-shell';
  shell.append(env.document.createElement('div'));
  env.document.body.append(shell);
  const rail = nav.mountNav(shell);
  const link = (id) => rail.querySelector(`a[data-area="${id}"]`);
  return { env, nav, shell, rail, link, done: () => env.uninstall() };
}
const current = (rail) => rail.querySelectorAll('a[data-area]').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.dataset.area);

test('the nav is drawn from the registry\'s five areas, in order, each opening its landing; no rail is written by hand', async () => {
  const html = read('hub/static/index.html');
  assert.doesNotMatch(html, /<nav\b|data-page=|class="rail/, 'no hand-written rail or tab bar');
  assert.match(html, /<div class="ui-shell shell">[\s\S]*class="ui-shell-stage stage"[\s\S]*<header class="ui-shell-head top" data-ui-shell-head>[\s\S]*<main[^>]*class="ui-shell-main"/, "the kit's markup contract");
  assert.match(html, /<link rel="stylesheet" href="\/static\/ui\/shell\.css">/);
  assert.ok(html.indexOf('/static/ui/shell.js') < html.indexOf('type="module"'), 'shell.js is a classic script before the modules');

  const t = await drawn();
  try {
    assert.equal(t.shell.firstChild, t.rail, 'the nav goes first in the grid');
    assert.equal(t.rail.className, 'ui-rail');
    assert.equal(t.rail.getAttribute('aria-label'), 'Primary navigation');
    const links = t.rail.querySelectorAll('a[data-area]');
    assert.deepEqual(links.map((a) => a.dataset.area), AREAS);
    assert.deepEqual(links.map((a) => a.dataset.area), SITE.areas.map((a) => a.id));
    assert.deepEqual(links.map((a) => text(a)), SITE.areas.map((a) => a.label));
    assert.deepEqual(links.map((a) => a.getAttribute('href')), SITE.areas.map((a) => SITE.page(a.landing).path));
    assert.deepEqual(links.map((a) => a.getAttribute('href')), ['/', '/workshop', '/media', '/devices', '/system']);
    for (const a of links) {
      assert.ok(a.hasAttribute('data-link'), `${a.dataset.area}: Pi Hub's router follows it`);
      assert.equal(a.querySelectorAll('svg').length, 1, `${a.dataset.area} has its icon`);
      assert.ok(a.querySelector('svg').querySelectorAll('path, rect, circle').length > 0);
    }
  } finally { t.done(); }
});

test('the current area is marked on every route, including deep pages; the Assistant and an unknown address mark none', async () => {
  const t = await drawn();
  try {
    const want = { '/': 'home', '/workshop': 'workshop', '/lab': 'workshop', '/media': 'household', '/devices': 'network',
      '/system': 'system', '/settings': 'system', '/assistant': null, '/not-a-page': null };
    for (const [path, area] of Object.entries(want)) {
      t.nav.setCurrentArea(sectionFor(path));
      assert.deepEqual(current(t.rail), area ? [area] : [], path);
      assert.equal(t.rail.querySelectorAll('a[data-area].is-current').length, area ? 1 : 0, `${path}: the class follows`);
    }
  } finally { t.done(); }
  const main = read('hub/static/js/main.js');
  assert.match(main, /const section = sectionFor\(path\);/);
  assert.match(main, /setCurrentArea\(section\);/, 'every route change marks it');
  assert.match(main, /mountNav\(document\.querySelector\("\.ui-shell"\)\);\nshow\(location\.pathname\);/, 'the nav is up before the first page');
});

test('the area is remembered when the page is shown before the nav is drawn', async () => {
  const env = install();
  try {
    const nav = await import(`../hub/static/js/navigation.js?copy=${++copies}`);
    nav.setCurrentArea('network');
    const shell = env.document.createElement('div');
    env.document.body.append(shell);
    assert.deepEqual(current(nav.mountNav(shell)), ['network']);
  } finally { env.uninstall(); }
});

test('the Assistant has one persistent entry: the head\'s button, not a rail area', async () => {
  const html = read('hub/static/index.html');
  assert.equal([...html.matchAll(/href="\/assistant"/g)].length, 1);
  assert.match(html, /<a class="top-assistant" href="\/assistant" data-link/);
  assert.doesNotMatch(html, /rail-assistant/);
  assert.ok(!AREAS.includes('assistant') && !SITE.areas.some((a) => a.id === 'assistant'));
  const t = await drawn();
  try {
    assert.equal(t.rail.querySelectorAll('a[href="/assistant"], [data-area="assistant"]').length, 0, 'not in the nav');
  } finally { t.done(); }
  const main = read('hub/static/js/main.js');
  assert.doesNotMatch(main, /rail-assistant/);
  assert.match(main, /const ASK = "\.top-assistant, \[data-ask-assistant\]";/, 'the head\'s button and a page\'s contextual Ask link share one behaviour');
  assert.match(main, /page\.mod\.mount\(state\);\n  applyAssistant\(\);/, 'a link a page draws gets the Assistant\'s current state');
});

const needsAnswer = (count) => ({ count, items: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, title: `Item ${i}`, tone: 'warn' })), unread: [] });
const badge = (t, id) => t.link(id).querySelector('.ui-rail-badge');

test('the Home badge follows the needs count and says so when the read fails: no stale count is shown as current', async () => {
  let needs = needsAnswer(3);
  const t = await drawn({
    '/api/needs': () => needs,
    '/api/alerts': { alerts: [] },
    '/api/now': { printer: { state: 'idle' } },
  });
  try {
    await t.nav.updateNavigation();
    assert.equal(text(badge(t, 'home')), '3');
    assert.equal(text(badge(t, 'home')), String(homeCards({ needs: needsAnswer(3) }).find((c) => c.key === 'needs').count), 'the card and the badge agree');
    assert.equal(badge(t, 'home').getAttribute('aria-label'), '3 need you');
    assert.equal(t.link('home').getAttribute('aria-label'), 'Home, 3 need you');
    assert.equal(badge(t, 'workshop'), null);
    assert.equal(badge(t, 'system'), null);

    needs = needsAnswer(1);
    await t.nav.updateNavigation();
    assert.equal(text(badge(t, 'home')), '1');
    assert.equal(badge(t, 'home').getAttribute('aria-label'), '1 needs you');

    needs = needsAnswer(0);
    await t.nav.updateNavigation();
    assert.equal(badge(t, 'home'), null, 'a read that found nothing has no badge');
    assert.equal(t.link('home').getAttribute('aria-label'), null);

    needs = needsAnswer(120);
    await t.nav.updateNavigation();
    assert.equal(text(badge(t, 'home')), '99+');
    assert.equal(badge(t, 'home').dataset.short, '9+', 'the kit draws 9+ on a narrow bar');

    needs = undefined;  // the fake answers 503: the read failed
    await t.nav.updateNavigation();
    assert.equal(text(badge(t, 'home')), '?', 'unknown, not 120 and not none');
    assert.notEqual(text(badge(t, 'home')), '99+', 'not the count it had');
    assert.equal(badge(t, 'home').getAttribute('aria-label'), "couldn't check what needs you");
    assert.equal(t.link('home').getAttribute('aria-label'), "Home, couldn't check what needs you");
    assert.equal(badge(t, 'system'), null, 'the other reads answered: their badges are theirs');
  } finally { t.done(); }
});

test('Home shares its own read with the badge, and a read that failed there is "?" too', async () => {
  const t = await drawn();
  try {
    t.nav.setNeeds(needsAnswer(2));
    assert.equal(text(badge(t, 'home')), '2');
    t.nav.setNeeds(null);
    assert.equal(text(badge(t, 'home')), '?');
    t.nav.setNeeds(needsAnswer(0));
    assert.equal(badge(t, 'home'), null);
  } finally { t.done(); }
  assert.match(read('hub/static/js/now.js'), /setNeeds\(needs \? problemsBadge\(needs, state\.probs \|\| \[\]\) : null\);/);
});

test('the Workshop dot, the System unread count and their failed reads', async () => {
  let printer = { state: 'printing', progress: 42 };
  let alerts = { alerts: [{ ts: Math.floor(Date.now() / 1000) + 100 }, { ts: Math.floor(Date.now() / 1000) + 200 }] };
  const t = await drawn({ '/api/needs': needsAnswer(0), '/api/alerts': () => alerts, '/api/now': () => ({ printer }) });
  try {
    await t.nav.updateNavigation();
    const dot = badge(t, 'workshop');
    assert.equal(text(dot), '', 'a print has no number');
    assert.ok(dot.dataset.dot !== undefined);
    assert.equal(dot.getAttribute('aria-label'), '3D print running, 42%');
    assert.equal(t.link('workshop').getAttribute('aria-label'), 'Workshop, 3D print running, 42%');
    assert.equal(text(badge(t, 'system')), '2');
    assert.equal(badge(t, 'system').getAttribute('aria-label'), '2 new alerts');

    printer = { state: 'idle' };
    await t.nav.updateNavigation();
    assert.equal(badge(t, 'workshop'), null);

    alerts = undefined;
    printer = undefined;
    await t.nav.updateNavigation();
    assert.equal(text(badge(t, 'system')), '?');
    assert.equal(badge(t, 'system').getAttribute('aria-label'), "couldn't check the alerts");
  } finally { t.done(); }
});

test('Home leads with Needs you, then the one Ask link, Systems, and Today; a failed read is its own state', async () => {
  const env = install();
  try {
    const { mountDashboard, renderDashboard } = await import('../hub/static/js/home-dashboard.js');
    const state = {}, parent = env.root();
    mountDashboard(state, parent);
    assert.deepEqual(state.hd.root.children.map((c) => c.className), ['hd-needs', 'hd-ask', 'hd-rack', 'hd-band']);
    assert.deepEqual(state.hd.root.children.map((c) => c.querySelector('h2')?.textContent ?? null), ['Needs you', null, 'Systems', 'Today so far']);

    const ask = state.hd.root.querySelector('a[data-ask-assistant]');
    assert.equal(ask.getAttribute('href'), '/assistant');
    assert.ok(ask.hasAttribute('data-link'));
    assert.equal(text(ask), 'Ask the Assistant');
    assert.equal(state.hd.root.querySelectorAll('a[href="/assistant"]').length, 1, 'one Ask entry');

    // /api/needs didn't answer, and neither did the records: not "nothing needs you", and not an empty count.
    renderDashboard(state, { today: null, records: null, needs: null }, () => {});
    assert.match(text(state.hd.needs), /Needs you isn't answering/);
    assert.doesNotMatch(text(state.hd.needs), /Nothing needs you/);
    assert.equal(text(state.hd.needsCount), '?');
    // it answers with nothing: that is the only time the page says so
    renderDashboard(state, { today: null, records: [], needs: { count: 0, items: [], unread: [] } }, () => {});
    assert.match(text(state.hd.needs), /Nothing needs you right now/);
    assert.equal(text(state.hd.needsCount), '');
  } finally { env.uninstall(); }
  const now = read('hub/static/js/now.js');
  assert.match(now, /state\.root\.append\(state\.dash, state\.hero\);/, 'the page: the dashboard, then the summary and the weather');
});
