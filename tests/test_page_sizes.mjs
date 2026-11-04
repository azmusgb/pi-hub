// A6 N3: no page opens with more than six sections. Health and Media show six and fold the rest into a collapsed "More"
// (native <details>, remembered per browser, as Workshop's is); Settings shows one group per screen; the Site map draws
// every page and tool (decisions health, settings, sitemap, and Media's cap from N3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';
import ROUTES from '../hub/static/js/routes.js';
import { TOOLS } from '../hub/static/ui/tools.js';

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
    drive: { state: 'Connected', count: 9 }, drive_events: [], requests: [{ id: 1, text: 'Heat', done: false }],
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
      const outside = state.body.children.filter((n) => n !== more && !n.matches('.movie-libraries') && !n.matches('.row'));
      assert.ok(outside.length >= 4 && outside.length <= 6, `${outside.length} sections outside More: ${outside.map((n) => n.className).join(' | ')}`);
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

test('Settings is a strip of its six groups and shows one group per screen, General first', async () => {
  const { dom, state } = await settings();
  try {
    const tabs = state.root.querySelectorAll('.settings-tabs a');
    assert.deepEqual(tabs.map((a) => a.textContent), ['General', 'Home', 'Weather and calendar', 'Phone messages', 'People and access', 'The Pi']);
    assert.deepEqual(visibleGroups(state.root), ['group-general']);
    assert.deepEqual(state.root.querySelectorAll('.settings-tabs [aria-current="true"]').map((a) => a.textContent), ['General']);
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
    assert.deepEqual(state.root.querySelectorAll('.settings-tabs [aria-current="true"]').map((a) => a.textContent), ['The Pi']);
    go('#group-nope');
    assert.deepEqual(visibleGroups(state.root), ['group-pi'], 'junk is ignored');
    assert.equal(listeners.hashchange.length, 1);
    m.leave(state);
    assert.equal(listeners.hashchange.length, 0, 'the listener goes when the page does');
  } finally { dom.uninstall(); }
});

test("the setup steps' links open the group they name", async () => {
  const { dom, state } = await settings();
  try {
    const link = state.root.querySelector('.setup-steps a[href="#group-home"]');
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
    for (const p of ROUTES.pages) assert.ok(links.includes(p), `page ${p}`);
    for (const t of TOOLS.filter((x) => !x.boundary)) assert.ok(links.includes(`https://${t.host}/`), `tool ${t.id}`);
    const body = text(root);
    for (const t of TOOLS.filter((x) => x.boundary)) assert.ok(body.includes(t.name), `machine-facing ${t.id} is named`);
  } finally { dom.uninstall(); }
});
