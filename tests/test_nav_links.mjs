// A6 N1: no page builds a raw :port link or a retired home.arpa link for the owner's browser, tools are linked once
// per page, /movies and /control aren't pages, and Pi Hub's card says "Print lab". The D4 display paths are allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { install } from './helpers/fake_dom.mjs';
import { SECTIONS } from '../hub/static/js/sections.js';
import { TOOLS } from '../hub/static/ui/tools.js';

const JS = new URL('../hub/static/js/', import.meta.url);
const files = readdirSync(JS).filter((f) => f.endsWith('.js'));
const read = (f) => readFileSync(new URL(f, JS), 'utf8');

// Plex is the one port link left until N4 puts it behind the gate; N4 deletes this list.
const PORT_LINK_ALLOWED = { 'movies.js': [32400], 'movie-night.js': [32400] };

test('no page builds a raw :port link with piLink()', () => {
  const bad = [];
  for (const f of files) {
    if (f === 'core.js') continue;  // defines piLink
    for (const m of read(f).matchAll(/piLink\(\s*(\d+)/g)) {
      if (!(PORT_LINK_ALLOWED[f] || []).includes(Number(m[1]))) bad.push(`${f}: piLink(${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no page builds http(s)://<host>:<port> from the page address or a bare IP', () => {
  const bad = [];
  for (const f of files) {
    const src = read(f);
    if (/\$\{[^}]*(hostname|host)[^}]*\}:\d+/.test(src) && !PORT_LINK_ALLOWED[f]) bad.push(`${f}: host:port template`);
    for (const m of src.matchAll(/["'`]https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})\b[^"'`]*/g)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('no static script links a .home.arpa name (the registry\'s D4 display hosts are machine-facing)', () => {
  const bad = files.filter((f) => /home\.arpa/.test(read(f)));
  assert.deepEqual(bad, []);
  // The only home.arpa hosts in the registry are the two D4 entries, and people never see them.
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
  if (!rowOnly) return;
  // A tool's front door is linked only from the "Open in ↗" row; anything else on the page is a deeper path.
  const row = root.querySelector('.open-in');
  const inRow = new Set(row ? row.querySelectorAll('a').map((a) => a.getAttribute('href')) : []);
  const door = (u) => new URL(u).pathname === '/' || /\/status\/home$/.test(u);
  const outside = links.filter((u) => door(u) && !inRow.has(u));
  assert.deepEqual(outside, [], `${label}: a tool's front door is linked outside the Open in row`);
}

async function page(mod, routes = {}) {
  const dom = install({ fetch: { '/api/whoami': { role: 'owner' }, ...routes } });
  dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);  // charts draw SVG
  try {
    const m = await import(`../hub/static/js/${mod}.js`);
    const state = { root: dom.root(), context: new URLSearchParams('') };
    m.mount(state);
    await m.load(state);
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
