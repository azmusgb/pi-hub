// A6 N2: every area has a page strip, so no page is hidden; Home & network is Devices | Network | Weather; one name for
// each page and tool everywhere (decisions strips, network-split, weather, lists, drives, names, sitemap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SITE, sectionFor } from '../hub/static/js/site.js';
import { goResults } from '../hub/static/js/command-palette.js';
import { TOOLS } from '../hub/static/ui/tools.js';
import { install, text } from './helpers/fake_dom.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// The strips are read from the kit's page list (A22 step 12): one per area that has more than Home, by its landing.
const AREAS = SITE.areas.filter((a) => a.id !== 'home');
const strip = (key) => SITE.stripFor(SITE.page(SITE.area(key).landing).path);
const names = (key) => strip(key).items.map((i) => i.label);
const hrefs = (key) => strip(key).items.map((i) => i.href);
const stripItems = (path) => SITE.stripFor(path)?.items ?? null;
const heading = (path) => { const { heading: h, title } = SITE.headingFor(path); return { heading: h, title }; };
// The pages main.js draws, read from its source (importing it would start the app).
const drawn = () => [...read('hub/static/js/main.js').matchAll(/^  "(\/[a-z]*)": \["[a-z-]+", [A-Za-z]+\],$/gm)].map((m) => m[1]);

test('each area has its strip, with the approved names in the approved order', () => {
  assert.deepEqual(AREAS.map((a) => a.id), ['workshop', 'household', 'network', 'system']);
  assert.deepEqual(names('household'), ['Movies', 'Papers', 'Scan', 'Print', 'Lists', 'Drives']);
  assert.deepEqual(hrefs('household'), ['/media', '/documents', '/scan', '/print', '/lists', '/drives']);
  assert.deepEqual(names('network'), ['Lights', 'Internet', 'Weather']);
  assert.deepEqual(hrefs('network'), ['/devices', '/network', '/weather']);
  assert.deepEqual(names('system'), ['Health', 'Backups', 'Versions', 'Alerts', 'Automations', 'Settings', 'Site map']);
  assert.equal(hrefs('system').at(-1), '/map');
  assert.deepEqual(names('workshop'), ['Printer', 'Print lab', 'Quick Print']);
});

test('every strip page belongs to the area of its strip', () => {
  for (const { id } of AREAS) for (const href of hrefs(id)) assert.equal(sectionFor(href), id, href);
});

test('no page is hidden: every page is on a strip, except Home, the wall and the Assistant (level 0, A4)', () => {
  const on = new Set(AREAS.flatMap((a) => hrefs(a.id)));
  assert.deepEqual(drawn().filter((p) => !on.has(p)).sort(), ['/', '/assistant', '/wall']);
});

test('the strip marks the current page and nothing else, on every strip page', () => {
  for (const { id, label } of AREAS) {
    for (const href of hrefs(id)) {
      assert.deepEqual(stripItems(href).filter((i) => i.current).map((i) => i.href), [href]);
      assert.equal(SITE.stripFor(href).label, `${label} pages`);
    }
  }
  for (const path of ['/', '/wall', '/more', '/pi']) assert.equal(stripItems(path), null, path);
});

// A22 2.3 (amending A7 P1): the heading is the page's own name, the same word as its strip entry. The area is shown by
// position (the rail and the strip) and in the browser tab.
test('a strip page is headed by its own name; the tab names the page and its area', () => {
  assert.deepEqual(heading('/documents'), { heading: 'Papers', title: 'Papers · Household' });
  assert.deepEqual(heading('/drives'), { heading: 'Drives', title: 'Drives · Household' });
  assert.deepEqual(heading('/weather'), { heading: 'Weather', title: 'Weather · Network' });
  assert.deepEqual(heading('/map'), { heading: 'Site map', title: 'Site map · System' });
});

test("every page's title is its strip word, and no page is headed by its area (A22 brief 1)", () => {
  const main = read('hub/static/js/main.js');
  assert.deepEqual(drawn().filter((p) => p !== '/assistant').sort(), SITE.shellPaths().sort(), 'main.js draws exactly the pages the list has');
  assert.match(main, /title: path === "\/assistant" \? ASSISTANT\.name : SITE\.pageAt\(path\)\.label/, 'a title is the name in the list');
  for (const path of SITE.shellPaths()) {
    const s = SITE.stripFor(path), title = SITE.pageAt(path).label;
    if (!s) { assert.equal(heading(path).heading, title, path); continue; }
    const own = s.items.find((i) => i.current).label;
    assert.equal(heading(path).heading, own, path);
    assert.notEqual(own, SITE.area(s.key).label, `${path} is headed by its area`);
  }
});

test('the wall is the Wall display, in its title and its tab', () => {
  assert.equal(SITE.pageAt('/wall').label, 'Wall display');
  assert.match(read('hub/static/js/main.js'), /wallMode \? "Wall display" : title/);
});

test('Network is /devices and /network; Weather is in it; the old addresses still land', () => {
  assert.ok(drawn().includes('/devices') && drawn().includes('/network'));
  assert.equal(sectionFor('/weather'), 'network');
  assert.equal(SITE.page(SITE.area('network').landing).path, '/devices');
  assert.notEqual(sectionFor('/weather'), 'home');
  assert.equal(SITE.redirectFor('/control'), '/devices');   // /control was the devices page
  assert.equal(SITE.redirectFor('/movies'), '/media');
  const html = read('hub/static/index.html');
  assert.match(html, /<a href="\/devices" data-link data-page="network"/);
  assert.deepEqual([...html.matchAll(/data-link data-page="([a-z]+)"/g)].map((m) => m[1]), SITE.areas.map((a) => a.id));
});

test("the router draws /devices and /map, each under the name its strip gives it", () => {
  const title = (path) => (drawn().includes(path) ? SITE.pageAt(path).label : undefined);
  assert.equal(title('/devices'), 'Lights');
  assert.equal(title('/map'), 'Site map');
  for (const [path, label] of [['/documents', 'Papers'], ['/print', 'Print'], ['/lists', 'Lists'], ['/media', 'Movies'],
    ['/drives', 'Drives'], ['/network', 'Internet'], ['/weather', 'Weather']]) assert.equal(title(path), label, path);
  assert.ok(!SITE.rows.some((p) => p.label === 'Storage'), 'nothing is called Storage');
});

test('⌘K lists every strip page once, under the strip names; Storage is Drives', () => {
  const go = goResults('').filter((r) => r.area !== 'Tools');
  for (const { id } of AREAS) {
    for (const { href, label } of strip(id).items) {
      const hits = go.filter((r) => r.href === href && r.label === label);
      assert.equal(hits.length, 1, `${id} ${href}`);
    }
  }
  assert.ok(!go.some((r) => r.label === 'Storage'));
  assert.deepEqual(goResults('storage').map((r) => r.label).filter((l) => l === 'Drives'), ['Drives']);  // old word still finds it
  assert.ok(goResults('documents').some((r) => r.href === '/documents'));  // the old area name still finds its page
});

test('the phone More page is gone: /more is an old address of the Site map (step 12)', () => {
  assert.equal(SITE.redirectFor('/more'), '/map');
  assert.equal(existsSync(new URL('../hub/static/js/more.js', import.meta.url)), false);
});

test('Uptime Kuma is called Uptime Kuma, and the Open in rows name tools by their registry names', () => {
  for (const f of ['now.js', 'health.js', 'network.js', 'home-cards.js']) assert.ok(!/Open Status/.test(read(`hub/static/js/${f}`)), f);
  assert.equal(TOOLS.find((t) => t.id === 'status').name, 'Uptime Kuma');
});

test('Storage is three names today and Drives, Movies drive and Pi disks after A6', async () => {
  assert.match(read('hub/static/js/drives.js'), /name: "Drives"/);
  assert.match(read('hub/static/js/drives.js'), /"Movies drive"/);
  assert.ok(!/"Movies drive \(Pi\)"/.test(read('hub/static/js/drives.js')));
  const { driveCard } = await import('../hub/static/js/movies.js');
  const dom = install();
  try {
    const c = driveCard({ state: 'Connected', count: 3 }, []);
    assert.equal(text(c.querySelector('h2, h3')), 'Movies drive status');
  } finally { dom.uninstall(); }
  const health = read('hub/static/js/health.js');
  assert.match(health, /function storageCard[\s\S]{0,200}"Pi disks"/);
  assert.ok(!/"Check movie storage"/.test(health));
});

const BASE = { '/api/whoami': { role: 'owner' } };
async function render(mod, routes = {}) {
  const dom = install({ fetch: { ...BASE, ...routes } });
  const m = await import(`../hub/static/js/${mod}.js`);
  const state = { root: dom.root(), context: new URLSearchParams('') };
  m.mount(state);
  await m.load(state);
  return { dom, state };
}
const openIn = (root) => root.querySelector('.open-in')?.querySelectorAll('a').map((a) => a.textContent) ?? [];

test('/devices is the controls and Homebridge only; /network is internet, ad blocking and Wi-Fi', async () => {
  const dev = await render('devices', { '/api/home': { connected: false, message: 'Homebridge is off' }, '/api/laundry': { configured: false } });
  try {
    const t = text(dev.state.root);
    assert.match(t, /Homebridge is off/);
    assert.doesNotMatch(t, /Internet|Ad blocking|Guest Wi-Fi/);
    assert.deepEqual(openIn(dev.state.root), ['Homebridge ↗']);
  } finally { dev.dom.uninstall(); }
  const net = await render('network', { '/api/now': { network: { orbi_ms: 3, att_ms: 5, wan_ms: 9, dns_ms: 4, win_ms: 2, status: 'ok' } }, '/api/network/adguard': { available: true, blocked: 1, queries: 9, protection: true }, '/api/wifi': { set: false } });
  try {
    const t = text(net.state.root);
    assert.match(t, /Internet/);
    assert.match(t, /Ad blocking/);
    assert.doesNotMatch(t, /Lights|Plugs|Favourites/);
    assert.deepEqual(openIn(net.state.root), ['AdGuard ↗', 'Grafana ↗']);  // Uptime Kuma is no longer used (kit 2.17)
  } finally { net.dom.uninstall(); }
});

test('records and cards that mean the devices open /devices; internet and ad blocking open /network', async () => {
  const { RECORD_PATHS } = await import('../hub/static/js/control-room.js');
  assert.equal(RECORD_PATHS.devices, '/devices');
  assert.equal(RECORD_PATHS.internet, '/network');
  assert.equal(RECORD_PATHS.adguard, '/network');
  assert.equal(RECORD_PATHS.weather, '/weather');
  const { homeCards } = await import('../hub/static/js/home-cards.js');
  const card = homeCards({ now: {}, needs: { items: [] }, backups: undefined, home: null }).find((c) => c.key === 'network');
  assert.equal(card.action.href, '/devices');
  const { helpGuidance } = await import('../hub/static/js/health.js');
  assert.equal(helpGuidance().find(([k]) => k === 'devices')[3], '/devices');
});

test('the Site map is a page of System, drawn by map.js', () => {
  assert.ok(drawn().includes('/map'));
  assert.equal(sectionFor('/map'), 'system');
  assert.match(read('hub/static/js/main.js'), /import \* as mapPage from "\.\/map\.js"/);
  const sw = read('hub/static/sw.js');
  for (const f of ['map.js', 'devices.js']) assert.ok(sw.includes(`/static/js/${f}"`), `${f} is in the shell`);
});

test('the Site map lists every page and every registry tool, built from the page list and the registry', async () => {
  const { siteMap } = await import('../hub/static/js/map.js');
  const map = siteMap();
  const links = map.flatMap((g) => g.pages.map((p) => p.href));
  for (const p of drawn()) assert.ok(links.includes(p), `page ${p}`);
  const listed = map.flatMap((g) => g.tools.map((t) => t.id));
  for (const t of TOOLS) assert.ok(listed.includes(t.id), `tool ${t.id}`);
  for (const g of map) for (const p of g.pages) assert.ok(p.label && !p.label.startsWith('/'), `${p.href} has a name`);
  assert.deepEqual(map.map((g) => g.title).slice(0, 6), ['Home', 'Workshop', 'Household', 'Network', 'System', 'Assistant']);
});

test('the Site map reads at a glance: one band per area, its pages in strip order with their addresses, then its tools past the line', async () => {
  const { mount } = await import('../hub/static/js/map.js');
  const dom = install();
  try {
    const root = document.createElement('div');
    mount({ root });
    const grid = root.querySelector('.map-areas');
    assert.ok(grid, 'the areas sit in one grid');
    assert.equal(grid.querySelectorAll('.more-group').length, root.querySelectorAll('.more-group').length);
    const workshop = root.querySelector('[data-area="workshop"]');
    assert.deepEqual(workshop.querySelectorAll('.map-run a').map((a) => a.getAttribute('href')), ['/workshop', '/lab', '/lab', '/quick'], 'the strip\'s order, a page\'s views after it (Print lab › Experiments)');
    assert.ok(workshop.querySelector('.map-out a[target="_blank"]'), 'tools sit on the far side of the line');
    const printer = [...root.querySelectorAll('.map-run a[data-link]')].find((a) => a.getAttribute('href') === '/workshop');
    assert.equal(text(printer).replace(/\s+/g, ' ').trim(), 'Printer /workshop');
    const bambuddy = [...root.querySelectorAll('a[target="_blank"]')].find((a) => /Bambuddy/.test(text(a)));
    assert.match(text(bambuddy), /opens in a new tab/);
    const machine = root.querySelector('[data-area="machine"] li');
    assert.match(text(machine), /^Workshop display feed\s*·?\s+home\.home\.arpa/, 'name and host never run together');
  } finally { dom.uninstall(); }
  const css = read('hub/static/enhance.css');
  assert.match(css, /\.map-areas\s*\{[^}]*grid-template-columns/, 'name, pages and tools are columns');
  assert.match(css, /\.map-band\s*\{[^}]*grid-template-columns:\s*subgrid/, 'every band shares them, so the line falls in one place');
});

test('no card or description still says Storage once the page is Drives (A6 N2 review)', async () => {
  const health = read('hub/static/js/health.js');
  assert.ok(!/"Storage"/.test(health) && !/Storage information/.test(health) && !/`\$\{storageItem\?\.name \|\| "Storage"\}/.test(health));
  assert.ok(!/\bstorage\b/i.test(read('hub/static/js/wall.js')), 'wall descriptions say drives, not storage');
});

test('Media\'s drive card is not named like the Drives page card', async () => {
  const { driveCard } = await import('../hub/static/js/movies.js');
  const dom = install();
  try {
    const c = driveCard({ state: 'Connected', count: 3 }, []);
    const title = text(c.querySelector('h2, h3'));
    assert.equal(title, 'Movies drive status');
    assert.notEqual(title, 'Movies drive');
  } finally { dom.uninstall(); }
  assert.match(read('hub/static/js/drives.js'), /x\.is_movies \? "Movies drive"/);
});

test('the Site map is easy to find: a footer link on every page, and the old More address', async () => {
  const shell = read('hub/static/index.html');
  const footer = shell.match(/<footer[\s\S]*?<\/footer>/)?.[0] || '';
  assert.match(footer, /href="\/map"[\s\S]{0,80}data-link="true"|data-link="true"[\s\S]{0,80}href="\/map"/, 'a /map link in the footer');
  assert.match(footer, /Site map/);
  assert.ok(footer.indexOf('href="/wall"') > -1 && footer.indexOf('/map') > -1, 'beside the Wall display link');
  assert.ok(shell.match(/<footer/g).length === 1, 'one shell, so one footer for every page');
  assert.equal(SITE.redirectFor('/more'), '/map', 'the old More address lands on it');
});

test('the Site map filters as you type: every word must match, an area name keeps its area, nothing left says so', async () => {
  const { mount, applyFilter } = await import('../hub/static/js/map.js');
  const dom = install();
  try {
    const root = document.createElement('div');
    mount({ root });
    const areas = root.querySelectorAll('.map-areas > section');
    const shownAreas = () => areas.filter((a) => !a.hidden).map((a) => a.dataset.area);
    const shownRows = () => areas.filter((a) => !a.hidden).flatMap((a) => a.querySelectorAll('li').filter((li) => !li.hidden));

    assert.equal(applyFilter(areas, '/lab'), 2);  // the page and its first view, Print lab › Experiments
    assert.deepEqual(shownAreas(), ['workshop']);
    assert.match(text(shownRows()[0]), /Print lab/);
    const workshop = areas.find((a) => a.dataset.area === 'workshop');
    assert.ok(workshop.querySelector('.map-out li').hidden, 'a tool that does not match is hidden');
    assert.ok(!workshop.querySelector('.map-out').hidden, 'but its list stays, so the band keeps its line');
    const other = areas.find((a) => a.dataset.area === 'other');
    applyFilter(areas, 'more');
    assert.ok(other.querySelector('.map-none').hidden, '"No tools" is not a match');
    applyFilter(areas, '');
    assert.ok(!other.querySelector('.map-none').hidden, 'and it is back with no query');

    applyFilter(areas, 'backups restoring');
    assert.deepEqual(shownRows().map((li) => text(li).trim().split(/\s/)[0]), ['Backrest'], 'every word must match');

    const all = areas.find((a) => a.dataset.area === 'household').querySelectorAll('li').length;
    assert.equal(applyFilter(areas, 'HOUSEHOLD'), all, 'an area named by the query shows all of it, any case');

    assert.equal(applyFilter(areas, 'zzz'), 0);
    assert.deepEqual(shownAreas(), []);

    const total = applyFilter(areas, '');
    assert.equal(total, root.querySelectorAll('.map-areas li').filter((li) => li.dataset.find !== undefined).length, 'an empty query shows everything');
    assert.match(text(root.querySelector('#map-count')), new RegExp(`^${total} pages and tools$`));
    assert.ok(root.querySelector('.map-empty').hidden);
    assert.equal(root.querySelector('label[for="map-find"]') && text(root.querySelector('label[for="map-find"]')), 'Find a page or tool');
  } finally { dom.uninstall(); }
});
