// A6 N4 (decision plex, approved 4 Nov 2026): Plex is a tool of the registry at plex.rahe-home.duckdns.org, Media links it
// once, in its Open in row, and its posters and Open Plex links use that address, not a raw :32400.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from './helpers/fake_dom.mjs';
import { TOOLS, toolsFor, toolUrl } from '../hub/static/ui/tools.js';
import { goResults } from '../hub/static/js/command-palette.js';
import { siteMap } from '../hub/static/js/map.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Plex is in the registry, in Media, on its real name', () => {
  const plex = TOOLS.find((t) => t.id === 'plex');
  assert.ok(plex);
  assert.equal(plex.host, 'plex.rahe-home.duckdns.org');
  assert.equal(plex.name, 'Plex');
  assert.equal(plex.area, 'media');
  assert.deepEqual(toolsFor('media').map((t) => t.id), ['plex']);
  assert.equal(toolUrl('plex', '/web'), 'https://plex.rahe-home.duckdns.org/web');
});

test('Plex has a palette entry and a place on the Site map', () => {
  const hit = goResults('plex').find((r) => r.label === 'Open Plex');
  assert.equal(hit?.href, 'https://plex.rahe-home.duckdns.org/');
  const media = siteMap().find((g) => g.key === 'media');
  assert.deepEqual(media.tools.map((t) => t.id), ['plex']);
});

test("Media's posters and Open Plex use the registry address, with the movie's path kept", async () => {
  const { plexUrl } = await import('../hub/static/js/movies.js');
  assert.equal(plexUrl('abc', '42'), 'https://plex.rahe-home.duckdns.org/web/index.html#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F42');
  assert.equal(plexUrl('', ''), 'https://plex.rahe-home.duckdns.org/web');
  const { watchUrl } = await import('../hub/static/js/movie-night.js');
  assert.equal(watchUrl('abc', '42'), plexUrl('abc', '42'));
  assert.equal(watchUrl('', ''), 'https://plex.rahe-home.duckdns.org/web');
});

test('the Media page links Plex once, in its Open in row, and builds no port link', async () => {
  const movie = (n) => ({ title: `Film ${n}`, key: String(n), year: 2000 + n, thumb: '', art: '', progress: 40, duration: 100 });
  const dom = install({ fetch: { '/api/me': { role: 'owner' },
    '/api/movies': { playing: [], continue: [movie(1)], recent: [movie(2)], drive: { state: 'Connected', count: 3 }, drive_events: [], requests: [], stats: null, sections: [], machine: 'abc' },
    '/api/movies/catalog': { movies: [movie(3)], genres: [] } } });
  dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
  try {
    const m = await import('../hub/static/js/movies.js');
    const state = { root: dom.root(), context: new URLSearchParams('') };
    m.mount(state);
    await m.load(state);
    const links = state.root.querySelectorAll('a').map((a) => a.getAttribute('href')).filter(Boolean);
    assert.deepEqual(links.filter((u) => /:\d{4,5}(\/|$)/.test(u.replace(/^https?:\/\//, ''))), [], 'no raw port');
    assert.deepEqual(links.filter((u) => u === 'https://plex.rahe-home.duckdns.org/'), ['https://plex.rahe-home.duckdns.org/']);
    const row = state.root.querySelector('.open-in');
    assert.deepEqual(row.querySelectorAll('a').map((a) => a.textContent), ['Plex ↗']);
    assert.ok(links.some((u) => u.startsWith('https://plex.rahe-home.duckdns.org/web/index.html#!/server/abc/details')), 'a poster opens its movie');
  } finally { dom.uninstall(); }
});

test('no static script builds a Plex port link any more', () => {
  for (const f of ['movies.js', 'movie-night.js']) assert.ok(!/32400/.test(read(`hub/static/js/${f}`)), f);
  assert.ok(!/PORT_LINK_ALLOWED/.test(read('tests/test_nav_links.mjs')), 'the guard has no allow-list left');
});
