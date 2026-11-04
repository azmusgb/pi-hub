// A6 N1: no page builds a raw :port link or a retired home.arpa link for the owner's browser, tools are linked once
// per page, /movies and /control aren't pages, and Pi Hub's card says "Print lab". The D4 display paths are allowed.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { install } from './helpers/fake_dom.mjs';
import { SECTIONS } from '../hub/static/js/sections.js';
import { TOOLS } from '../hub/static/ui/tools.js';

const JS = new URL('../hub/static/js/', import.meta.url);
const files = readdirSync(JS).filter((f) => f.endsWith('.js'));
const read = (f) => readFileSync(new URL(f, JS), 'utf8');

// Plex is the one port link left until N4 moves it; only port 32400, only in these two files. N4 deletes this list.
const PLEX_PORT = { 'movies.js': 32400, 'movie-night.js': 32400 };

test('no page builds a raw :port link with piLink(), whatever its first argument', () => {
  const bad = [];
  for (const f of files) {
    if (f === 'core.js') continue;  // defines piLink
    for (const m of read(f).matchAll(/piLink\(\s*([^,)\s]+)/g)) {
      if (!(PLEX_PORT[f] && Number(m[1]) === PLEX_PORT[f])) bad.push(`${f}: piLink(${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

// Each form a port link can take, so a rewrite of the same mistake doesn't slip past.
const PORT_FORMS = [
  [/:\$\{\s*\w*port\w*\s*\}/i, ':${PORT}'],
  [/(hostname|host)\s*\+\s*["'`]:\d{2,5}/, 'hostname + ":8000"'],
  [/\$\{[^}]*(hostname|host)[^}]*\}:\d+/, '${hostname}:8000'],
  [/https?:\/\/[\w.-]+\.(?:duckdns\.org|arpa|local|ts\.net):\d{2,5}/, 'a literal https://name:port'],
  [/https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/, 'a bare IP address'],
];

test('no page builds a host:port link in any form (template, concatenation, literal or bare IP)', () => {
  const bad = [];
  for (const f of files) {
    if (f === 'core.js') continue;  // piLink itself builds host:port; the first test forbids calling it
    const src = read(f);
    for (const [re, what] of PORT_FORMS) if (re.test(src)) bad.push(`${f}: ${what}`);
  }
  assert.deepEqual(bad, []);
});

test('the forms the guard looks for are the ones it catches', () => {
  const samples = ['`http://x:${PORT}/`', 'location.hostname + ":8000"', 'https://pi.rahe-home.duckdns.org:9090/', '`http://${location.hostname}:8000${path}`', 'http://10.0.0.30/'];
  for (const s of samples) assert.ok(PORT_FORMS.some(([re]) => re.test(s)), s);
});

test('no static script, and not the shell page, links a .home.arpa name (the registry\'s D4 lines are machine-facing)', () => {
  const ui = new URL('../hub/static/ui/', import.meta.url);
  const targets = [
    ...files.map((f) => [`js/${f}`, read(f)]),
    ...readdirSync(ui).filter((f) => f.endsWith('.js')).map((f) => [`ui/${f}`, readFileSync(new URL(f, ui), 'utf8')]),
    ['index.html', readFileSync(new URL('../hub/static/index.html', import.meta.url), 'utf8')],
  ];
  const bad = [];
  for (const [name, src] of targets) {
    for (const line of src.split('\n')) if (/home\.arpa/.test(line) && !/"boundary":"D4"/.test(line)) bad.push(`${name}: ${line.trim().slice(0, 80)}`);
  }
  assert.deepEqual(bad, []);
  for (const t of TOOLS.filter((x) => x.host.endsWith('home.arpa'))) assert.equal(t.boundary, 'D4', t.id);
});

test("/movies and /control aren't listed as pages (they are redirects)", () => {
  const pages = SECTIONS.flatMap((s) => s.pages);
  assert.ok(!pages.includes('/movies'));
  assert.ok(!pages.includes('/control'));
});

test("Workshop's Bambuddy links use the registry address, paths kept", async () => {
  const { bambuddyUrl } = await import('../hub/static/js/workshop.js');
  assert.equal(bambuddyUrl('/inventory'), 'https://bambuddy.rahe-home.duckdns.org/inventory');
  assert.equal(bambuddyUrl('/projects/7'), 'https://bambuddy.rahe-home.duckdns.org/projects/7');
});

const hrefs = (root) => root.querySelectorAll('a').map((a) => a.getAttribute('href')).filter(Boolean);
const toolHosts = TOOLS.filter((t) => !t.boundary).map((t) => t.host);
const toolLinks = (root) => hrefs(root).filter((u) => toolHosts.some((h) => u.startsWith(`https://${h}`)));

function assertOnce(root, label, { rowOnly = true } = {}) {
  const links = toolLinks(root);
  const seen = new Map();
  for (const u of links) seen.set(u, (seen.get(u) || 0) + 1);
  assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([u]) => u), [], `${label}: a tool URL appears twice`);
  const row = root.querySelector('.open-in');
  if (!rowOnly || !row) return;   // a page with no Open in row has nowhere else to put its one link
  // A tool's front door is linked only from the "Open in ↗" row; anything else on the page is a deeper path. Uptime
  // Kuma's front door is its public status page, /status/home (its root is a login).
  const inRow = new Set(row.querySelectorAll('a').map((a) => a.getAttribute('href')));
  const door = (u) => new URL(u).pathname === '/' || new URL(u).pathname === '/status/home';
  const outside = links.filter((u) => door(u) && !inRow.has(u));
  assert.deepEqual(outside, [], `${label}: a tool's front door is linked outside the Open in row`);
}

// A page that starts a timer (Workshop's camera, say) is left again after each test, or node never exits.
const LIVE = [];
afterEach(() => { while (LIVE.length) { const [m, state] = LIVE.pop(); try { m.leave?.(state); } catch { /* nothing to stop */ } } });

async function page(mod, routes = {}) {
  const dom = install({ fetch: { '/api/me': { role: 'owner' }, ...routes } });
  dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);  // charts draw SVG
  globalThis.window.addEventListener ||= () => {};  // Settings listens for hashchange
  globalThis.window.removeEventListener ||= () => {};
  try {
    const m = await import(`../hub/static/js/${mod}.js`);
    const state = { root: dom.root(), context: new URLSearchParams('') };
    LIVE.push([m, state]);
    m.mount(state);
    try { await m.load(state); } catch { /* a page whose data isn't there still drew what it could */ }
    return { dom, state };
  } catch (e) { dom.uninstall(); throw e; }
}

test('Documents links Paperless and Scan once, in the Open in row', async () => {
  const { dom, state } = await page('documents', { '/api/documents': { available: true, results: [] } });
  try {
    assertOnce(state.root, 'documents');
    assert.ok(toolLinks(state.root).some((u) => u.startsWith('https://paperless.')), 'Paperless is in the row');
    assert.ok(toolLinks(state.root).some((u) => u.startsWith('https://scan.')), 'Scan is in the row');
  } finally { dom.uninstall(); }
});

test('Home & network links AdGuard, Grafana and Uptime Kuma once, in the Open in row', async () => {
  const net = { orbi_ms: 3, att_ms: 5, wan_ms: 9, dns_ms: 4, win_ms: 2, status: 'ok' };
  const { dom, state } = await page('network', { '/api/home': { connected: false, message: 'x' }, '/api/now': { network: net }, '/api/network/adguard': { available: true, blocked: 1, queries: 9, protection: true } });
  try {
    assertOnce(state.root, 'network');
    for (const h of ['adguard.', 'network.', 'status.']) assert.ok(toolLinks(state.root).some((u) => u.startsWith(`https://${h}`)), h);
    // Uptime Kuma's root is its login; the link keeps the public status page it always had.
    const row = state.root.querySelector('.open-in').querySelectorAll('a').map((a) => a.getAttribute('href'));
    assert.ok(row.includes('https://status.rahe-home.duckdns.org/status/home'), `Kuma link keeps status/home: ${row}`);
  } finally { dom.uninstall(); }
});

test("Health's Cockpit links are the registry address, never port 9090", async () => {
  const { dom, state } = await page('health', { '/api/pi': { services: [{ name: 'hub', state: 'running' }], disk: {}, network: {} }, '/api/actions': { actions: [], log: [], updates: {} }, '/api/records': { records: [], events: [] } });
  try {
    const all = hrefs(state.root);
    assert.ok(state.root.querySelector('.service-list, .card'), 'the cards drew');
    assert.ok(state.root.textContent.includes('More in Cockpit'), 'the services card (with its Cockpit link) drew');
    assert.deepEqual(all.filter((u) => /:\d{2,5}(\/|$)/.test(u.replace(/^https?:\/\//, ''))), []);
    assert.ok(all.includes('https://pi.rahe-home.duckdns.org/system/services'), 'the services deep link is the registry address, path kept');
    assertOnce(state.root, 'health', { rowOnly: false });  // its Network card reaches Grafana and Uptime Kuma, which aren't in System's row
  } finally { dom.uninstall(); }
});

test('Pi Hub\'s lab card is named "Print lab"', () => {
  assert.doesNotMatch(read('lab-v2.js'), /Print Lab v3<\/div>/);
  assert.match(read('lab-v2.js'), /lab-v2-kicker">Print lab</);
});

// Every page that carries tools or Open in links: no tool URL twice, no front door outside the row where there is one.
const MOUNTED = [
  ['workshop', { '/api/workshop': { printer: {}, spools: [], prints: [], projects: [] }, '/api/records': { records: [], events: [] } }, true],
  ['backups', { '/api/backups': { available: false, repos: [] } }, true],
  ['versions', { '/api/records': { records: [], events: [] } }, true],
  ['alerts', { '/api/alerts': { events: [] } }, true],
  ['rules', { '/api/rules': { rules: [] } }, true],
  ['settings', { '/api/settings': { homebridge: { connected: false }, wifi: null, digest: { on: false, at: '07:00' }, quiet: { on: false, from: '22:00', to: '07:00' }, place: '', units: 'F', calendar_set: false, backups: [], pc_copy: null, alerts_ready: true, devices: { listed: [], this: null, login: '' }, shortcut_keys: [], log: [] }, '/api/display/pair/status': { paired: false } }, true],
];
for (const [mod, routes] of MOUNTED) {
  test(`${mod}: a tool is linked once`, async () => {
    const { dom, state } = await page(mod, routes);
    try {
      assert.ok(state.root.querySelectorAll('*').length >= 1, `${mod} drew something`);
      assertOnce(state.root, mod);
    } finally { await new Promise((r) => setTimeout(r, 20)); dom.uninstall(); }
  });
}

test('Workshop ends with Bambuddy once in its Open in row; its deeper links are paths', async () => {
  const { dom, state } = await page('workshop', MOUNTED[0][1]);
  try {
    const row = state.root.querySelector('.open-in');
    assert.deepEqual(row.querySelectorAll('a').map((a) => a.getAttribute('href')), ['https://bambuddy.rahe-home.duckdns.org/']);
  } finally { dom.uninstall(); }
});
