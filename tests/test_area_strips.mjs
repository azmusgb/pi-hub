// A6 N2: every area has a page strip, so no page is hidden; Home & network is Devices | Network | Weather; one name for
// each page and tool everywhere (decisions strips, network-split, weather, lists, drives, names, sitemap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ROUTES from '../hub/static/js/routes.js';
import { STRIPS, stripFor, stripItems, pageHeading } from '../hub/static/js/system-strip.js';
import { SECTIONS, sectionFor, redirectFor, railItems } from '../hub/static/js/sections.js';
import { goResults } from '../hub/static/js/command-palette.js';
import { TOOLS } from '../hub/static/ui/tools.js';
import { install, text } from './helpers/fake_dom.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const names = (key) => STRIPS[key].entries.map(([, label]) => label);
const hrefs = (key) => STRIPS[key].entries.map(([href]) => href);

test('each area has its strip, with the approved names in the approved order', () => {
  assert.deepEqual(Object.keys(STRIPS), ['system', 'workshop', 'documents', 'media', 'network']);
  assert.deepEqual(names('documents'), ['Papers', 'Print', 'Lists']);
  assert.deepEqual(hrefs('documents'), ['/documents', '/print', '/lists']);
  assert.deepEqual(names('media'), ['Movies', 'Drives']);
  assert.deepEqual(hrefs('media'), ['/media', '/drives']);
  assert.deepEqual(names('network'), ['Devices', 'Network', 'Weather']);
  assert.deepEqual(hrefs('network'), ['/devices', '/network', '/weather']);
  assert.deepEqual(names('system'), ['Health', 'Backups', 'Versions', 'Alerts', 'Automations', 'Settings', 'Site map']);
  assert.equal(hrefs('system').at(-1), '/map');
  assert.deepEqual(names('workshop'), ['Printer', 'Print lab']);
});

test('every strip page belongs to the section of its strip, and the section lists it', () => {
  const area = { system: 'system', workshop: 'workshop', documents: 'documents', media: 'media', network: 'network' };
  for (const [key, section] of Object.entries(area)) {
    for (const href of hrefs(key)) {
      assert.equal(sectionFor(href), section, href);
      assert.ok(SECTIONS.find((s) => s.key === section).pages.includes(href), `${section} lists ${href}`);
    }
  }
});

test('no page is hidden: every page is on a strip, except Home, the wall and the phone-only More', () => {
  const on = new Set(Object.values(STRIPS).flatMap((s) => s.entries.map(([href]) => href)));
  const hidden = ROUTES.pages.filter((p) => !on.has(p));
  assert.deepEqual(hidden.sort(), ['/', '/more', '/wall']);
});

test('the strip marks the current page and nothing else, on every strip page', () => {
  for (const key of Object.keys(STRIPS)) {
    for (const href of hrefs(key)) {
      assert.deepEqual(stripItems(href).filter((i) => i.current).map((i) => i.href), [href]);
      assert.equal(stripFor(href).label, STRIPS[key].label);
    }
  }
  for (const path of ['/', '/wall', '/more', '/pi']) assert.equal(stripItems(path), null, path);
});

test('a strip page is headed by its area; the tab names the page', () => {
  assert.deepEqual(pageHeading('/documents', 'Papers'), { heading: 'Documents', title: 'Papers · Documents' });
  assert.deepEqual(pageHeading('/drives', 'Drives'), { heading: 'Media', title: 'Drives · Media' });
  assert.deepEqual(pageHeading('/weather', 'Weather'), { heading: 'Home & network', title: 'Weather · Home & network' });
  assert.deepEqual(pageHeading('/map', 'Site map'), { heading: 'System', title: 'Site map · System' });
});

test('Home & network is /devices and /network; Weather moved into it; the old addresses still land', () => {
  assert.ok(ROUTES.pages.includes('/devices') && ROUTES.pages.includes('/network'));
  assert.equal(sectionFor('/weather'), 'network');
  assert.equal(SECTIONS.find((s) => s.key === 'network').path, '/devices');
  assert.ok(!SECTIONS.find((s) => s.key === 'home').pages.includes('/weather'));
  assert.equal(redirectFor('/control'), '/devices');   // /control was the devices page
  assert.equal(redirectFor('/movies'), '/media');
  const html = read('hub/static/index.html');
  assert.match(html, /<a href="\/devices" data-link data-page="network"/);
  assert.deepEqual(railItems(), ['home', 'workshop', 'documents', 'media', 'network', 'system']);
});

test("the router draws /devices and /map, each under the name its strip gives it", () => {
  const main = read('hub/static/js/main.js');
  const title = (path) => new RegExp(`"${path}": \\{ key: "[a-z-]+", title: "([^"]+)"`).exec(main)?.[1];
  assert.equal(title('/devices'), 'Devices');
  assert.equal(title('/map'), 'Site map');
  for (const [path, label] of [['/documents', 'Papers'], ['/print', 'Print'], ['/lists', 'Lists'], ['/media', 'Movies'],
    ['/drives', 'Drives'], ['/network', 'Network'], ['/weather', 'Weather']]) assert.equal(title(path), label, path);
  assert.ok(!/title: "Storage"/.test(main), 'nothing is called Storage');
});

test('⌘K lists every strip page once, under the strip names; Storage is Drives', () => {
  const go = goResults('').filter((r) => r.area !== 'Tools');
  for (const [key, { entries }] of Object.entries(STRIPS)) {
    for (const [href, label] of entries) {
      const hits = go.filter((r) => r.href === href);
      assert.equal(hits.length, 1, `${key} ${href}`);
      assert.equal(hits[0].label, label, href);
    }
  }
  assert.ok(!go.some((r) => r.label === 'Storage'));
  assert.deepEqual(goResults('storage').map((r) => r.label).filter((l) => l === 'Drives'), ['Drives']);  // old word still finds it
  assert.ok(goResults('documents').some((r) => r.href === '/documents'));  // the area name still finds its first page
});

test("More lists the two areas the bottom bar leaves out, by their first page; Weather is in a strip now", async () => {
  const dom = install();
  try {
    const { mount } = await import('../hub/static/js/more.js');
    const root = dom.root();
    mount({ root });
    const links = root.querySelectorAll('a').map((a) => a.getAttribute('href'));
    assert.deepEqual(links, ['/devices', '/system']);
  } finally { dom.uninstall(); }
});

test('Uptime Kuma is called Uptime Kuma, and the Open in rows name tools by their registry names', () => {
  for (const f of ['now.js', 'health.js', 'network.js', 'home-cards.js']) assert.ok(!/Open Status/.test(read(`hub/static/js/${f}`)), f);
  assert.equal(TOOLS.find((t) => t.id === 'status').name, 'Uptime Kuma');
});

test('Storage is three names today and Drives, Movies drive and Pi disks after A6', async () => {
  assert.match(read('hub/static/js/drives.js'), /card\("Drives"/);
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
    assert.deepEqual(openIn(net.state.root), ['AdGuard ↗', 'Grafana ↗', 'Uptime Kuma ↗']);
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
  assert.ok(ROUTES.pages.includes('/map'));
  assert.equal(sectionFor('/map'), 'system');
  assert.match(read('hub/static/js/main.js'), /import \* as mapPage from "\.\/map\.js"/);
  const sw = read('hub/static/sw.js');
  for (const f of ['map.js', 'devices.js']) assert.ok(sw.includes(`/static/js/${f}"`), `${f} is in the shell`);
});

test('the Site map lists every page and every registry tool, built from routes.js and the registry', async () => {
  const { siteMap } = await import('../hub/static/js/map.js');
  const map = siteMap();
  const links = map.flatMap((g) => g.pages.map((p) => p.href));
  for (const p of ROUTES.pages) assert.ok(links.includes(p), `page ${p}`);
  const listed = map.flatMap((g) => g.tools.map((t) => t.id));
  for (const t of TOOLS) assert.ok(listed.includes(t.id), `tool ${t.id}`);
  for (const g of map) for (const p of g.pages) assert.ok(p.label && !p.label.startsWith('/'), `${p.href} has a name`);
  assert.deepEqual(map.map((g) => g.title).slice(0, 6), ['Home', 'Workshop', 'Documents', 'Media', 'Home & network', 'System']);
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
