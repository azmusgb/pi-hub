// A6 N3: no page opens with more than six sections. Health and Media show six and fold the rest into a collapsed "More"
// (native <details>, remembered per browser, as Workshop's is); Settings shows one group per screen; the Site map draws
// every page and tool (decisions health, settings, sitemap, and Media's cap from N3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';
import { SITE } from '../hub/static/js/site.js';

// Every page the shell draws: the page list's Pi Hub pages and the Assistant's door (routes.js is gone, A22 step 12).
const ROUTES = { pages: [...SITE.shellPaths(), '/assistant'] };
import { TOOLS, toolUrl } from '../hub/static/ui/tools.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}
function withStorage(store, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: store });
  const done = () => { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; };
  return Promise.resolve(fn()).finally(done);
}
const ids = (nodes) => nodes.map((n) => n.id);

// ---- the shared More list -------------------------------------------------------------------------------------

test('a More list is closed until the viewer opens an item, and remembers which, per browser', async () => {
  const dom = install();
  try {
    const { moreList } = await import('../hub/static/js/section-links.js');
    const store = fakeStorage();
    await withStorage(store, () => {
      const list = moreList({ storeKey: 'k-test', title: 'More', items: [['a', 'Alpha'], ['b', 'Beta']] });
      const [a, b] = list.root.querySelectorAll('details');
      assert.equal(list.root.querySelectorAll('details').length, 2);
      assert.ok(!a.open && !b.open, 'closed by default');
      b.open = true;
      assert.deepEqual(JSON.parse(store.data['k-test']), { b: true });
      const again = moreList({ storeKey: 'k-test', title: 'More', items: [['a', 'Alpha'], ['b', 'Beta']] });
      const [a2, b2] = again.root.querySelectorAll('details');
      assert.ok(!a2.open && b2.open, 'the open item is still open on the next draw');
    });
  } finally { dom.uninstall(); }
});

test('a More list works with storage missing, blocked or holding junk, and hides an item with nothing in it', async () => {
  const dom = install();
  try {
    const { moreList } = await import('../hub/static/js/section-links.js');
    for (const store of [undefined, fakeStorage({ 'k-j': '{{{' }), fakeStorage({ 'k-j': '[1,2]' }),
      { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }]) {
      await withStorage(store, () => {
        const list = moreList({ storeKey: 'k-j', title: 'More', items: [['a', 'Alpha']] });
        const d = list.root.querySelector('details');
        assert.ok(!d.open);
        d.open = true;   // must not throw
        list.fill('a', []);
        assert.equal(d.hidden, true, 'empty: hidden');
        list.fill('a', ['x']);
        assert.equal(d.hidden, false);
      });
    }
  } finally { dom.uninstall(); }
});

// ---- Health -------------------------------------------------------------------------------------------------

const PI = {
  selfcheck: { checks: [{ ok: true, name: 'disk' }], total: 1, failed: 0, at: 1 },
  outages: [], services: [{ name: 'pi-hub', state: 'active' }],
  storage: [{ name: 'USB', mounted: true, used_pct: 40, free_gb: 1, total_gb: 2 }],
  health: {}, history: [], live: {}, network: {},
};
const ROUTES_OK = { '/api/pi': PI, '/api/actions': { actions: [], log: [], updates: {} }, '/api/records': { records: [], events: [] } };

async function health(routes, search = '') {
  const dom = install({ fetch: routes });
  dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
  const m = await import('../hub/static/js/health.js');
  const state = { root: dom.root(), context: new URLSearchParams(search) };
  m.mount(state);
  await m.load(state);
  return { dom, state };
}

test('Health shows six sections in order and folds the rest into a collapsed More', async () => {
  await withStorage(fakeStorage(), async () => {
    const { dom, state } = await health(ROUTES_OK);
    try {
      const more = state.root.querySelector('.health-more');
      assert.ok(more, 'a More section');
      const outside = state.root.querySelectorAll('[data-health]').filter((n) => !more.contains(n));
      assert.deepEqual(outside.map((n) => n.dataset.health), ['selfcheck', 'services', 'disks', 'updates', 'others', 'fix']);
      assert.ok(outside.length <= 6);
      const items = more.querySelectorAll('.more-list-item');
      assert.deepEqual(items.map((d) => d.dataset.key), ['outages', 'network', 'history', 'help']);
      assert.ok(items.every((d) => !d.open), 'More is collapsed');
      assert.match(text(more.querySelector('h2')), /^More/);
      assert.doesNotMatch(text(state.root), /\bnull\b|undefined/, 'no stray null or undefined on the page');
      // the order on the page: sections, More, then the Open in row
      const order = state.root.querySelectorAll('[data-health], .health-more, .open-in').filter((n) => n.dataset.health !== undefined ? !more.contains(n) : true);
      assert.deepEqual(order.map((n) => n.dataset.health || (n.classList.contains('health-more') ? 'more' : 'open-in')),
        ['selfcheck', 'services', 'disks', 'updates', 'others', 'fix', 'more', 'open-in']);
    } finally { dom.uninstall(); }
  });
});

test("Health's storage card is Pi disks, and the Network and history cards sit under More", async () => {
  await withStorage(fakeStorage(), async () => {
    const { dom, state } = await health(ROUTES_OK);
    try {
      assert.match(text(state.root.querySelector('[data-health="disks"]')), /Pi disks/);
      const more = state.root.querySelector('.health-more');
      assert.match(text(more), /Outages/);
      assert.match(text(more), /Network/);
      assert.match(text(more), /What isn.t working\?/);
    } finally { dom.uninstall(); }
  });
});

test('an item the viewer opened in More is still open after Health refreshes', async () => {
  const store = fakeStorage();
  await withStorage(store, async () => {
    const { dom, state } = await health(ROUTES_OK);
    try {
      state.root.querySelector('.health-more .more-list-item[data-key="network"]').open = true;
      const m = await import('../hub/static/js/health.js');
      await m.load(state);
      assert.ok(state.root.querySelector('.health-more .more-list-item[data-key="network"]').open);
      assert.ok(!state.root.querySelector('.health-more .more-list-item[data-key="help"]').open);
    } finally { dom.uninstall(); }
  });
});

test('with the diagnostics down, Health still shows Other systems and the help guides, and hides the empty More items', async () => {
  await withStorage(fakeStorage(), async () => {
    const { dom, state } = await health({ '/api/records': { records: [], events: [] } });
    try {
      assert.ok(state.root.querySelector('[data-health="others"]'));
      const more = state.root.querySelector('.health-more');
      const shown = more.querySelectorAll('.more-list-item').filter((d) => !d.hidden).map((d) => d.dataset.key);
      assert.deepEqual(shown, ['help']);
    } finally { dom.uninstall(); }
  });
});

test('/system?help=movies puts the guide first and open, as it always has', async () => {
  await withStorage(fakeStorage(), async () => {
    const { dom, state } = await health(ROUTES_OK, 'help=movies');
    try {
      const first = state.root.querySelector('.help-start');
      assert.ok(first);
      assert.ok(first.querySelector('#help-movies').open);
      const more = state.root.querySelector('.health-more');
      assert.ok(!more.querySelector('.more-list-item[data-key="help"]') || more.querySelector('.more-list-item[data-key="help"]').hidden);
    } finally { dom.uninstall(); }
  });
});

// ---- Media --------------------------------------------------------------------------------------------------

const MOVIE = (n) => ({ title: `Film ${n}`, key: String(n), year: 2000 + n, thumb: '', art: '', progress: 40, duration: 100 });
const MEDIA = {
  '/api/movies': {
    playing: [{ user: 'Bill', title: 'Dune', state: 'playing' }],
    continue: [MOVIE(1), MOVIE(2)], recent: [MOVIE(3), MOVIE(4)],
    drive: { state: 'Connected', count: 9, mirror: { state: 'ok', last_ok: Date.now() / 1000 - 3600 } }, drive_events: [], requests: [{ id: 1, text: 'Heat', done: false }],
    stats: { total: 9 }, sections: [{ key: '1', title: 'Movies' }], machine: 'm',
  },
  '/api/movies/catalog': { movies: [MOVIE(5), MOVIE(6)], genres: ['Drama'] },
};

test('Media shows at most six sections and folds the drive, requests, surprise pick and watch history into More', async () => {
  await withStorage(fakeStorage(), async () => {
    const dom = install({ fetch: { '/api/me': { role: 'owner' }, ...MEDIA } });
    dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
    try {
      const m = await import('../hub/static/js/movies.js');
      const state = { root: dom.root(), context: new URLSearchParams('') };
      m.mount(state);
      await m.load(state);
      const more = state.root.querySelector('.media-more');
      assert.ok(more, 'a More section');
      // Every direct child of the page body is More, a section, or one of two named non-sections: the library switcher
      // and the row of links to Plex. Each non-section is identified by what it is (only links), so a seventh section
      // can't hide behind a class name.
      const kids = state.body.children.filter((n) => n !== more);
      const isLinks = (n) => n.querySelectorAll('a').length > 0 && n.querySelectorAll('section, h2, h3, details').length === 0
        && /^(Open Plex|Open in)/.test(text(n).trim());
      const isSwitcher = (n) => n.classList.contains('movie-libraries');
      const sections = kids.filter((n) => !isSwitcher(n) && !isLinks(n));
      assert.ok(kids.length - sections.length <= 2, 'at most the switcher and the links row are not sections');
      assert.ok(sections.length >= 4 && sections.length <= 6, `${sections.length} sections outside More: ${sections.map((n) => n.className).join(' | ')}`);
      const items = more.querySelectorAll('.more-list-item');
      assert.deepEqual(items.map((d) => d.dataset.key), ['surprise', 'drive', 'requests', 'watched']);
      assert.ok(items.every((d) => !d.open), 'More is collapsed');
      assert.match(text(more.querySelector('[data-key="drive"]')), /Movies drive/);
    } finally { dom.uninstall(); }
  });
});

// ---- Settings -----------------------------------------------------------------------------------------------

const SETTINGS = {
  '/api/me': { role: 'owner' },
  '/api/display/pair/status': { paired: false },
  '/api/settings': {
    homebridge: { connected: false }, wifi: null, digest: { on: false, at: '07:00' }, quiet: { on: false, from: '22:00', to: '07:00' },
    place: '', units: 'F', calendar_set: false, backups: [], pc_copy: null, alerts_ready: true,
    devices: { listed: [], this: null, login: '' }, shortcut_keys: [], log: [],
  },
};

async function settings(hash = '') {
  const listeners = {};
  const dom = install({ fetch: SETTINGS });
  globalThis.location.hash = hash;
  globalThis.window.addEventListener = (t, fn) => { (listeners[t] ||= []).push(fn); };
  globalThis.window.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); };
  const m = await import(`../hub/static/js/settings.js?${Math.random()}`);
  const state = { root: dom.root(), context: new URLSearchParams('') };
  m.mount(state);
  await m.load(state);
  const go = (h) => { globalThis.location.hash = h; (listeners.hashchange || []).forEach((f) => f()); };
  await new Promise((r) => setTimeout(r, 20));   // the display card's own status poll settles before the DOM is taken away
  return { dom, state, m, go, listeners };
}
const visibleGroups = (root) => root.querySelectorAll('.settings-group').filter((g) => !g.hidden).map((g) => g.id);

// A22 2.1 (step 12, H5): the row is a tablist of six tabs, so the chosen one is aria-selected, not a link with aria-current.
const selectedTabs = (root) => root.querySelectorAll('.settings-tabs [role="tab"]').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);

test('Settings is a row of its six groups and shows one group per screen, General first', async () => {
  const { dom, state } = await settings();
  try {
    const tabs = state.root.querySelectorAll('.settings-tabs [role="tab"]');
    assert.deepEqual(tabs.map((a) => a.textContent), ['General', 'Home', 'Weather and calendar', 'Phone messages', 'People and access', 'The Pi']);
    assert.deepEqual(visibleGroups(state.root), ['group-general']);
    assert.deepEqual(selectedTabs(state.root), ['General']);
    assert.equal(state.root.querySelectorAll('.settings-group').length, 6);
  } finally { dom.uninstall(); }
});

test('a #group- address, and a tap on a tab, switch the screen; a refresh keeps it; an unknown one falls back to General', async () => {
  const { dom, state, m, go, listeners } = await settings('#group-people');
  try {
    assert.deepEqual(visibleGroups(state.root), ['group-people']);
    go('#group-pi');
    assert.deepEqual(visibleGroups(state.root), ['group-pi']);
    await m.load(state);    // the page refreshes itself every minute
    assert.deepEqual(visibleGroups(state.root), ['group-pi']);
    assert.deepEqual(selectedTabs(state.root), ['The Pi']);
    go('#group-nope');
    assert.deepEqual(visibleGroups(state.root), ['group-pi'], 'junk is ignored');
    assert.equal(listeners.hashchange.length, 1);
    m.leave(state);
    assert.equal(listeners.hashchange.length, 0, 'the listener goes when the page does');
  } finally { dom.uninstall(); }
});

test("the setup faceplate's steps open the group they name (A7 P1: no checklist)", async () => {
  const { dom, state } = await settings();
  try {
    assert.ok(!state.root.querySelector('.setup-steps'), 'the checklist is gone');
    const link = state.root.querySelector('.ui-faceplate a[href="#group-home"]');
    assert.ok(link, 'a step links to the Home group');
    assert.ok(state.root.querySelector('#group-home'), 'and that group exists');
  } finally { dom.uninstall(); }
});

// ---- Site map ----------------------------------------------------------------------------------------------

test('the Site map page shows a link to every route and every registry tool', async () => {
  const dom = install();
  try {
    const { mount } = await import('../hub/static/js/map.js');
    const root = dom.root();
    mount({ root });
    const links = root.querySelectorAll('a').map((a) => a.getAttribute('href'));
    assert.ok(ROUTES.pages.length > 10 && TOOLS.length > 5, 'the lists the map is drawn from are not empty');
    for (const p of ROUTES.pages) assert.ok(links.includes(p), `page ${p}`);
    for (const t of TOOLS.filter((x) => !x.boundary)) assert.ok(links.includes(toolUrl(t.id)), `tool ${t.id}`);
    const body = text(root);
    for (const t of TOOLS.filter((x) => x.boundary)) assert.ok(body.includes(t.name), `machine-facing ${t.id} is named`);
  } finally { dom.uninstall(); }
});

// ---- review fixes (A6 N3): alerts in More, deep links, the old key, focus -----------------------------------

import { readFileSync, readdirSync } from 'node:fs';
const js = (f) => readFileSync(new URL(`../hub/static/js/${f}`, import.meta.url), 'utf8');
const pill = (tone, label = 'x') => ({ __pill: [tone, label] });

async function pillCard(tone) {
  const { card } = await import('../hub/static/js/core.js');
  return card('Thing', tone ? { pill: 'Look', tone } : {}, 'body');
}

test('a More item whose content is warn or bad shows a badge on its summary and opens by itself; calm content does not', async () => {
  const dom = install();
  try {
    const { moreList } = await import('../hub/static/js/section-links.js');
    await withStorage(fakeStorage(), async () => {
      const list = moreList({ storeKey: 'k-alert', title: 'More', alerts: ['a', 'c'], items: [['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']] });
      list.fill('a', [await pillCard('warn')]);
      list.fill('b', [await pillCard('ok')]);
      list.fill('c', [await pillCard('bad')]);
      const [a, b, c] = list.root.querySelectorAll('details');
      assert.ok(a.open && c.open, 'warn and bad open');
      assert.ok(!b.open, 'ok stays closed');
      assert.ok(a.querySelector('summary .more-badge') && c.querySelector('summary .more-badge'), 'a badge on the summary');
      assert.ok(!b.querySelector('.more-badge'));
      assert.match(text(c.querySelector('.more-badge')), /\S/);
      assert.equal(c.querySelector('.more-badge').dataset.tone, 'bad');
      // it clears when the content calms down
      list.fill('a', [await pillCard('ok')]);
      assert.ok(!a.querySelector('.more-badge'));
      // a viewer who closes an alerting item keeps it closed through a refresh, the badge still says why
      c.open = false;
      list.fill('c', [await pillCard('bad')]);
      assert.ok(!c.open, 'not forced open again while the alert is unchanged');
      assert.ok(c.querySelector('.more-badge'));
    });
  } finally { dom.uninstall(); }
});

test('Health opens and badges Outages when there are outages and Network when a hop does not answer', async () => {
  await withStorage(fakeStorage(), async () => {
    const calm = await health(ROUTES_OK);
    try {
      assert.ok(calm.state.root.querySelectorAll('.health-more .more-badge').length === 0, 'nothing wrong, no badge');
    } finally { calm.dom.uninstall(); }
    const bad = await health({ ...ROUTES_OK, '/api/pi': { ...PI,
      outages: [{ start: 1000, end: 1600 }],
      network: { name: 'pi', ip: '10.0.0.80', metrics: { orbi_ms: 3, att_ms: 4, wan_ms: null, dns_ms: 5 } } } });
    try {
      const item = (k) => bad.state.root.querySelector(`.health-more .more-list-item[data-key="${k}"]`);
      assert.ok(item('outages').open && item('outages').querySelector('summary .more-badge'), 'Outages');
      assert.ok(item('network').open && item('network').querySelector('summary .more-badge'), 'Network');
      assert.ok(!item('history').open && !item('help').open, 'the rest stay closed');
    } finally { bad.dom.uninstall(); }
  });
});

test('Media opens and badges the drive item when the drive is bad, and not when it is connected', async () => {
  await withStorage(fakeStorage(), async () => {
    for (const [drive, alert] of [[{ state: 'Connected', count: 9, mirror: { state: 'ok', last_ok: Date.now() / 1000 - 60 } }, false], [{ state: 'Missing', count: 0 }, true]]) {
      const dom = install({ fetch: { '/api/me': { role: 'owner' }, ...MEDIA, '/api/movies': { ...MEDIA['/api/movies'], drive } } });
      dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
      try {
        const m = await import('../hub/static/js/movies.js');
        const state = { root: dom.root(), context: new URLSearchParams('') };
        m.mount(state);
        await m.load(state);
        const d = state.root.querySelector('.media-more .more-list-item[data-key="drive"]');
        assert.equal(d.open, alert, `open when ${drive.state}`);
        assert.equal(!!d.querySelector('summary .more-badge'), alert);
      } finally { dom.uninstall(); }
    }
  });
});

test('every in-app link to /settings names the group it means', () => {
  const NAV = new Set(['site.js', 'sections.js', 'system-strip.js', 'main.js', 'command-palette.js']);   // the page lists themselves
  const bad = [];
  let seen = 0;
  for (const f of readdirSync(new URL('../hub/static/js/', import.meta.url)).filter((n) => n.endsWith('.js') && !NAV.has(n))) {
    for (const m of js(f).matchAll(/["'`]\/settings(#[^"'`]*)?["'`]/g)) { seen++; if (!/^#group-(general|home|outside|phone|people|pi)$/.test(m[1] || '')) bad.push(`${f}: ${m[0]}`); }
  }
  assert.ok(seen >= 4, `found the links (${seen})`);
  assert.deepEqual(bad, []);
  assert.match(js('health.js'), /\/settings#group-home/);
  assert.match(js('weather.js'), /\/settings#group-outside/);
  assert.match(js('control.js'), /\/settings#group-home/);
});

test("Media's old open-state key movies-stats moves to hub-media-more once", async () => {
  const store = fakeStorage({ 'movies-stats': '1' });
  await withStorage(store, async () => {
    const dom = install({ fetch: { '/api/me': { role: 'owner' }, ...MEDIA } });
    dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
    try {
      const m = await import('../hub/static/js/movies.js');
      const state = { root: dom.root(), context: new URLSearchParams('') };
      m.mount(state);
      await m.load(state);
      assert.ok(state.root.querySelector('.media-more [data-key="watched"]').open, 'it was open, so it still is');
      assert.equal(store.getItem('movies-stats'), null, 'the old key is gone');
      assert.deepEqual(JSON.parse(store.getItem('hub-media-more')).watched, true);
    } finally { dom.uninstall(); }
  });
  // an old key that says closed, and a key the viewer already set under the new name, are respected
  const store2 = fakeStorage({ 'movies-stats': '0', 'hub-media-more': JSON.stringify({ watched: true }) });
  await withStorage(store2, async () => {
    const dom = install({ fetch: { '/api/me': { role: 'owner' }, ...MEDIA } });
    dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
    try {
      const m = await import('../hub/static/js/movies.js');
      const state = { root: dom.root(), context: new URLSearchParams('') };
      m.mount(state);
      await m.load(state);
      assert.ok(state.root.querySelector('.media-more [data-key="watched"]').open, 'the new key wins');
      assert.equal(store2.getItem('movies-stats'), null);
    } finally { dom.uninstall(); }
  });
});

test('a refresh inside an open More keeps keyboard focus and typed text (Media requests, Health history range)', async () => {
  await withStorage(fakeStorage({ 'hub-media-more': JSON.stringify({ requests: true }) }), async () => {
    const dom = install({ fetch: { '/api/me': { role: 'owner' }, ...MEDIA } });
    dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
    try {
      const m = await import('../hub/static/js/movies.js');
      const state = { root: dom.root(), context: new URLSearchParams('') };
      m.mount(state);
      await m.load(state);
      const input = state.root.querySelector('#req-new');
      input.focus();
      input.value = 'Alien';
      input.dispatchEvent({ type: 'input', target: input });
      state.force = true;
      await m.load(state);
      const after = state.root.querySelector('#req-new');
      assert.notEqual(after, input, 'the card was redrawn');
      assert.equal(globalThis.document.activeElement, after, 'focus is back on the field');
      assert.equal(after.value, 'Alien', 'and so is what was typed');
    } finally { dom.uninstall(); }
  });
  await withStorage(fakeStorage({ 'hub-health-more': JSON.stringify({ history: true }) }), async () => {
    const { dom, state } = await health(ROUTES_OK);
    try {
      const btns = () => state.root.querySelectorAll('.health-more [data-key="history"] button');
      assert.ok(btns().length >= 2, 'range buttons');
      const second = btns()[1];
      second.focus();
      const m = await import('../hub/static/js/health.js');
      await m.load(state);
      assert.equal(globalThis.document.activeElement, btns()[1], 'focus stays on the same range button');
    } finally { dom.uninstall(); }
  });
});
