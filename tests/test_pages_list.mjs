// A22 step 12 (docs/superpowers/plans/2026-11-12-step-12-page-list-and-frame.md): the frame reads the kit's page list.
// The six test_pages_* checks, the Site map check (3.5), the search-words check (decision 8) and the label-change test
// (criterion 4: one label, four places). The server's half (paths and aliases) is tests/test_routes.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AREAS, PAGES } from '../hub/static/ui/pages.js';
import { TOOLS } from '../hub/static/ui/tools.js';
import { SITE, makeSite } from '../hub/static/js/site.js';
import { KEYWORDS, goResults } from '../hub/static/js/command-palette.js';
import { siteMap } from '../hub/static/js/map.js';
import { pageStrip } from '../hub/static/js/system-strip.js';
import { install, text } from './helpers/fake_dom.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const JS = new URL('../hub/static/js/', import.meta.url);
const main = read('hub/static/js/main.js');
const html = read('hub/static/index.html');
// The Pi Hub rows a person can open today, and the ones a later step builds.
const HUB = PAGES.filter((p) => p.system === 'hub');
const BUILT = HUB.filter((p) => p.built !== false);
const plain = (path) => path.split('#')[0];
// main.js's route table, read from its source (importing it would start the app): address -> [key, module].
const ROUTES = new Map([...main.matchAll(/^  "(\/[a-z]*)": \["([a-z-]+)", ([A-Za-z]+)\],$/gm)].map((m) => [m[1], [m[2], m[3]]]));
const heading = (site, path) => { const { heading: h, title } = site.headingFor(path); return { heading: h, title }; };

test('test_pages_routes: main.js draws exactly the list\'s Pi Hub pages, each with a module in the shell', () => {
  assert.ok(BUILT.length >= 20, 'the list is not empty');
  const shell = [...new Set(BUILT.filter((p) => p.role !== 'standalone').map((p) => plain(p.path)))];
  assert.deepEqual([...ROUTES.keys()].filter((p) => p !== '/assistant').sort(), shell.sort());
  assert.deepEqual(SITE.shellPaths().sort(), shell.sort(), 'site.js answers the same pages');
  const sw = read('hub/static/sw.js');
  for (const [path, [, mod]] of ROUTES) {
    const file = new RegExp(`^import \\* as ${mod} from "\\./([a-z-]+\\.js)";$`, 'm').exec(main)?.[1];
    assert.ok(file, `${path}: ${mod} is imported`);
    assert.ok(sw.includes(`"/static/js/${file}"`), `${file} is in the offline shell`);
  }
  // A row a later step builds draws nothing: no route, no strip entry, no ⌘K row, no Site map row.
  const later = HUB.filter((p) => p.built === false);
  assert.deepEqual(later.map((p) => p.id).sort(), ['lab-designs', 'lab-tools']);
  for (const p of later) {
    assert.equal(SITE.page(p.id), null, p.id);
    assert.ok(!goResults('').some((r) => r.label.endsWith(p.label)), `${p.id} is not in ⌘K`);
    assert.ok(!siteMap().some((g) => g.pages.some((q) => q.label.endsWith(p.label))), `${p.id} is not on the Site map`);
  }
  // The Assistant's rows are in the list for step 14 and are not drawn from it yet (decision 3).
  assert.ok(PAGES.some((p) => p.system === 'assistant'));
  assert.ok(SITE.rows.every((p) => p.system === 'hub'));
});

test('test_pages_headings: every page is headed by its name in the list; the tab reads "Page · Area"', () => {
  for (const path of SITE.shellPaths()) {
    const p = SITE.pageAt(path), a = AREAS.find((x) => x.id === p.area);
    const got = SITE.headingFor(path);
    assert.equal(got.heading, p.label, path);
    assert.equal(got.title, a.label === p.label ? p.label : `${p.label} · ${a.label}`, path);
    assert.equal(got.purpose, p.purpose, path);
    assert.ok(p.role !== 'page' || p.purpose, `${path} has its one line`);
    assert.notEqual(got.heading, a.label === p.label ? null : a.label, `${path} is headed by its area`);
  }
  assert.equal(SITE.headingFor('/nowhere'), null);
  // The shell takes all three from site.js and writes no page name of its own.
  assert.match(main, /SITE\.headingFor\(path\)/);
  assert.match(main, /title: path === "\/assistant" \? ASSISTANT\.name : SITE\.pageAt\(path\)\.label/);
  assert.match(main, /const purposeOf = \(path\) => \(path === "\/assistant" \? ASSISTANT\.purpose : SITE\.headingFor\(path\)\?\.purpose \|\| ""\);/);
  const named = [...main.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(named, ['Page not found'], 'the only title main.js writes is the one for no page');
  for (const p of BUILT) if (p.label.includes(' ')) assert.ok(!main.includes(`"${p.label}"`) || p.id === 'wall', `main.js writes "${p.label}"`);
});

test('test_pages_reach: every page is reached the ways the list says, and no other way hides one', () => {
  const go = goResults('').filter((r) => r.area !== 'Tools' && r.area !== 'Assistant');
  const map = siteMap().filter((g) => g.key !== 'assistant').flatMap((g) => g.pages.map((p) => ({ ...p, group: g.key })));
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
  for (const p of BUILT) {
    const name = SITE.fullLabel(p);
    assert.ok(p.reach.includes('palette') && p.reach.includes('map'), `${p.id}: every Pi Hub page is in ⌘K and on the Site map`);
    assert.equal(go.filter((r) => r.href === p.path && r.label === name).length, 1, `${p.id} in ⌘K once`);
    assert.equal(map.filter((r) => r.href === p.path && r.label === name).length, 1, `${p.id} on the Site map once`);
    const strip = SITE.stripFor(plain(p.path));
    if (p.reach.includes('strip')) {
      assert.equal(strip.key, p.area, p.id);
      assert.deepEqual(strip.items.filter((i) => i.current).map((i) => i.label), [p.label], `${p.id} is on its area's strip`);
    }
    if (p.reach.includes('rail')) assert.equal(AREAS.find((a) => a.id === p.area).landing, p.id, `${p.id} is its area's landing`);
    if (p.reach.includes('foot')) assert.ok(footer.includes(`href="${p.path}"`), `${p.id} is linked in the footer`);
    if (p.reach.includes('tabs')) assert.ok(SITE.page(p.parent), `${p.id} has a parent page`);
  }
  assert.equal(go.length, BUILT.length, '⌘K has no page the list does not');
  assert.equal(map.length, BUILT.length, 'the Site map has no page the list does not');
  // A page with no strip is Home, the Wall display or the Privacy note, and nothing else.
  const loose = BUILT.filter((p) => !p.parent && !p.reach.includes('strip')).map((p) => p.id);
  assert.deepEqual(loose.sort(), ['home', 'privacy', 'wall']);
  for (const a of AREAS) assert.ok(SITE.page(a.landing).reach.includes('rail'), `${a.id}'s landing is in the rail`);
});

test('test_pages_redirects: every old address in the list lands on its page (section 10)', () => {
  const aliases = BUILT.flatMap((p) => (p.aliases || []).map((a) => [a, plain(p.path)]));
  assert.ok(aliases.length >= 13, `${aliases.length} old addresses`);
  for (const [from, to] of aliases) {
    assert.equal(SITE.redirectFor(from), to, from);
    assert.equal(SITE.pageAt(from), null, `${from} is not also a page`);
    assert.ok(SITE.shellPaths().includes(to), `${from} lands on a page the shell draws`);
    assert.ok(!ROUTES.has(from), `${from} has no page module`);
  }
  assert.deepEqual(SITE.aliases(), Object.fromEntries(aliases));
  for (const [from, to] of [['/more', '/map'], ['/apps/scan', '/scan'], ['/apps/status', '/system'], ['/status', '/system']]) assert.equal(SITE.redirectFor(from), to, from);
  for (const path of SITE.shellPaths()) assert.equal(SITE.redirectFor(path), null, path);
  // The router moves an old address before it draws, keeping the query.
  assert.match(main, /const moved = SITE\.redirectFor\(path\);/);
  assert.match(main, /history\.replaceState\(\{\}, "", moved \+ location\.search\)/);
});

test('test_pages_areas: the rail and tab bar are the list\'s five areas, in order, each opening its landing', () => {
  assert.deepEqual(AREAS.map((a) => a.label), ['Home', 'Workshop', 'Household', 'Network', 'System']);
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const links = [...nav.matchAll(/<a href="([^"]+)" data-link data-page="([a-z]+)" aria-label="([^"]+)" title="([^"]+)"[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<span>([^<]+)<\/span>/g)]
    .map(([, href, id, name, title, word]) => ({ href, id, name, title, word }));
  assert.deepEqual(links, AREAS.map((a) => ({ href: SITE.page(a.landing).path, id: a.id, name: a.label, title: a.label, word: a.label })));
  assert.equal([...nav.matchAll(/data-page="/g)].length, AREAS.length, 'five areas and no More');
  assert.doesNotMatch(html, /href="\/more"|phone-only|class="extra"/);
  assert.equal(SITE.page(AREAS.find((a) => a.id === 'household').landing).path, '/media', 'Household opens on Movies');
  // Every page lights its own area in the rail; the shell marks the link whose data-page is that area.
  for (const p of BUILT.filter((x) => x.area)) assert.equal(SITE.areaOf(plain(p.path)), p.area, p.id);
  assert.match(main, /a\.dataset\.page === section/);
  // Five labels fit a 320 px bar at any text size (9.1 F6, plan decision 16): sized by the bar's own width, never cut.
  const css = read('hub/static/app.css');
  assert.match(css, /\.rail \{[^}]*container-type: inline-size;/);
  assert.match(css, /\.rail a\[data-page\] \{[^}]*font-size: min\(var\(--ui-fs-1\), 3\.85cqi\);[^}]*white-space: nowrap;/);
  assert.doesNotMatch(css, /\.rail a\[data-page\][^{]*\{[^}]*text-overflow/);
});

test('test_pages_tools: a page\'s "Open in" row is its tools in the list, asked for by the page\'s id', () => {
  const calls = new Map();
  for (const f of readdirSync(JS).filter((n) => n.endsWith('.js') && n !== 'section-links.js')) {
    for (const [, id] of readFileSync(new URL(f, JS), 'utf8').matchAll(/openInRow\("([a-z-]+)"/g)) calls.set(id, [...(calls.get(id) || []), f]);
  }
  const withTools = BUILT.filter((p) => p.tools?.length);
  assert.deepEqual([...calls.keys()].sort(), withTools.map((p) => p.id).sort(), 'a row for each page that has tools, and for no other');
  for (const [id, files] of calls) assert.equal(files.length, 1, `${id} is asked for once (${files})`);
  for (const p of withTools) {
    const tools = SITE.toolsOf(p.id);
    assert.deepEqual(tools.map((t) => t.id), p.tools, p.id);
    for (const t of tools) assert.ok(!t.retired && !t.boundary, `${p.id}: ${t.id} is in use and for people`);
  }
  assert.deepEqual(SITE.toolsOf('print'), []);
  assert.deepEqual(SITE.toolsOf('nope'), []);
  const dom = install();
  return import('../hub/static/js/section-links.js').then(({ openInRow }) => {
    assert.deepEqual(openInRow('scan').querySelectorAll('a').map((a) => a.textContent), ['Scan ↗']);
    assert.deepEqual(openInRow('internet').querySelectorAll('a').map((a) => a.textContent), ['AdGuard ↗', 'Grafana ↗']);
    assert.equal(openInRow('print'), null);
  }).finally(() => dom.uninstall());
});

test('the Site map check (3.5): every row is generated, every page and tool is on it once, nothing is written by hand', () => {
  const map = siteMap();
  assert.deepEqual(map.map((g) => g.key), ['home', 'workshop', 'household', 'network', 'system', 'assistant', 'other', 'retired', 'machine']);
  assert.deepEqual(map.slice(0, 5).map((g) => [g.title, g.path]), AREAS.map((a) => [a.label, SITE.page(a.landing).path]));
  for (const a of AREAS) {
    const g = map.find((x) => x.key === a.id);
    assert.deepEqual(g.pages.map((p) => p.label), BUILT.filter((p) => p.area === a.id).map((p) => SITE.fullLabel(p)), `${a.id}: the list's pages in the list's order`);
  }
  const listed = map.flatMap((g) => g.tools.map((t) => t.id));
  assert.deepEqual([...listed].sort(), TOOLS.map((t) => t.id).sort(), 'every tool once');
  assert.deepEqual(map.find((g) => g.key === 'retired').tools.map((t) => t.id).sort(), ['homebox', 'status']);
  assert.ok(map.slice(0, 6).every((g) => g.tools.every((t) => !t.retired && !t.boundary)));
  assert.deepEqual(map.find((g) => g.key === 'other').pages, [{ href: '/privacy', label: 'Privacy note', plain: true }]);
  // map.js names no Pi Hub page: the only address it writes is the Assistant's door.
  const src = read('hub/static/js/map.js').replace(/\/\/.*$/gm, '');
  assert.deepEqual([...new Set([...src.matchAll(/"(\/[a-z#-]*)"/g)].map((m) => m[1]))], ['/assistant']);
  for (const p of BUILT) if (p.id !== 'map') assert.ok(!src.includes(`"${p.label}"`), `map.js writes "${p.label}"`);
});

test('search words are keyed by page id: a key that is not a page fails (decision 8)', () => {
  const ids = new Set(SITE.entries('palette').map((e) => e.id));
  for (const key of Object.keys(KEYWORDS)) assert.ok(ids.has(key), `KEYWORDS.${key} is not a page in ⌘K`);
  // The words the old names answer to still find the page under its new name.
  for (const [word, label] of [['devices', 'Lights'], ['network', 'Internet'], ['documents', 'Papers'], ['media', 'Movies'], ['storage', 'Drives'], ['more', 'Site map']]) {
    assert.ok(goResults(word).some((r) => r.label === label), `"${word}" finds ${label}`);
  }
  assert.ok(goResults('household').some((r) => r.label === 'Scan'), 'an area name finds its pages');
});

// Criterion 4: changing a `label` in the list changes the strip, the title, ⌘K and the Site map together.
test('the label-change test: one label in a copy of the list changes the strip, the title, ⌘K and the Site map', () => {
  const pages = PAGES.map((p) => (p.id === 'papers' ? { ...p, label: 'Paperwork' } : p.id === 'settings' ? { ...p, label: 'Setup' } : p));
  const areas = AREAS.map((a) => (a.id === 'household' ? { ...a, label: 'House' } : a));
  const site = makeSite(areas, pages);

  // 1. The strip, as data and as drawn.
  assert.deepEqual(site.stripFor('/documents').items.map((i) => i.label), ['Movies', 'Paperwork', 'Scan', 'Print', 'Lists', 'Drives']);
  assert.equal(site.stripFor('/documents').label, 'House pages');
  const dom = install();
  try {
    const nav = pageStrip('/documents', site);
    assert.equal(nav.getAttribute('aria-label'), 'House pages');
    assert.deepEqual(nav.querySelectorAll('a').map((a) => text(a)), ['Movies', 'Paperwork', 'Scan', 'Print', 'Lists', 'Drives']);
    assert.deepEqual(nav.querySelectorAll('a').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => text(a)), ['Paperwork']);
  } finally { dom.uninstall(); }
  // 2. The heading and the browser tab.
  assert.deepEqual(heading(site, '/documents'), { heading: 'Paperwork', title: 'Paperwork · House' });
  assert.deepEqual(heading(site, '/settings'), { heading: 'Setup', title: 'Setup · System' });
  // 3. ⌘K, a tab's full name following its parent.
  const go = goResults('', null, site);
  assert.deepEqual(go.filter((r) => r.href === '/documents').map((r) => [r.label, r.area]), [['Paperwork', 'House']]);
  assert.ok(go.some((r) => r.label === 'Setup › Phone messages' && r.href === '/settings#group-phone'));
  assert.ok(!go.some((r) => /^(Papers|Settings)\b/.test(r.label)), 'the old names are nowhere in ⌘K');
  // 4. The Site map.
  const map = siteMap(site);
  const house = map.find((g) => g.key === 'household');
  assert.equal(house.title, 'House');
  assert.deepEqual(house.pages.filter((p) => p.href === '/documents').map((p) => p.label), ['Paperwork']);
  assert.ok(map.find((g) => g.key === 'system').pages.some((p) => p.label === 'Setup › The Pi'));
  assert.ok(!map.flatMap((g) => g.pages).some((p) => /^(Papers|Settings)\b/.test(p.label)), 'the old names are nowhere on the map');

  // The shipped list is untouched, and says the shipped names in the same four places.
  assert.deepEqual(heading(SITE, '/documents'), { heading: 'Papers', title: 'Papers · Household' });
  assert.ok(goResults('').some((r) => r.label === 'Papers' && r.area === 'Household'));
  assert.ok(siteMap().find((g) => g.key === 'household').pages.some((p) => p.label === 'Papers'));
});
