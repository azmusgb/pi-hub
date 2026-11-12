// A6 N4 (decision plex, revised 4 Nov 2026): Plex is not gated. It is an outside tool of the registry at
// app.plex.tv/desktop; Media's Open in row and the per-movie links go there, posters stay same-origin, and no raw :32400
// link is left anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from './helpers/fake_dom.mjs';
import { TOOLS, toolsFor, toolUrl } from '../hub/static/ui/tools.js';
import { goResults } from '../hub/static/js/command-palette.js';
import { siteMap } from '../hub/static/js/map.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FRONT = 'https://app.plex.tv/desktop';

test('Plex is in the registry as an outside tool of Household (Media until step 12), at app.plex.tv/desktop', () => {
  const plex = TOOLS.find((t) => t.id === 'plex');
  assert.ok(plex);
  assert.equal(plex.host, 'app.plex.tv');
  assert.equal(plex.external, true);
  assert.equal(plex.area, 'household');
  assert.ok(toolsFor('household').some((t) => t.id === 'plex'));
  assert.equal(toolUrl('plex'), FRONT);
});

test('Plex has a palette entry and a place on the Site map', () => {
  assert.equal(goResults('plex').find((r) => r.label === 'Open Plex')?.href, FRONT);
  assert.ok(siteMap().find((g) => g.key === 'household').tools.some((t) => t.id === 'plex'));
});

test('a movie links to its page in Plex by the server id and the rating key; with no server id it is the front door', async () => {
  const { plexUrl } = await import('../hub/static/js/sections.js');
  assert.equal(plexUrl('abc', '42'), `${FRONT}/#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F42`);
  assert.equal(plexUrl('', ''), FRONT);
  assert.equal(plexUrl('abc', ''), FRONT);
  const { watchUrl } = await import('../hub/static/js/movie-night.js');
  assert.equal(watchUrl('abc', '42'), plexUrl('abc', '42'));
  assert.equal(watchUrl('', ''), FRONT);
});

test('Media links Plex once in its Open in row, per-movie links go to app.plex.tv, posters stay on this origin', async () => {
  const movie = (n) => ({ title: `Film ${n}`, key: String(n), year: 2000 + n, thumb: `/library/metadata/${n}/thumb`, art: '', progress: 40, duration: 100 });
  const dom = install({ fetch: { '/api/me': { role: 'owner' },
    '/api/movies': { playing: [], continue: [movie(1)], recent: [movie(2)], drive: { state: 'Connected', count: 3, mirror: { state: 'ok', last_ok: Date.now() / 1000 - 60 } }, drive_events: [], requests: [], stats: null, sections: [], machine: 'abc' },
    '/api/movies/catalog': { movies: [movie(3)], genres: [] } } });
  dom.document.createElementNS ||= (ns, tag) => dom.document.createElement(tag);
  try {
    const m = await import('../hub/static/js/movies.js');
    const state = { root: dom.root(), context: new URLSearchParams('') };
    m.mount(state);
    await m.load(state);
    const links = state.root.querySelectorAll('a').map((a) => a.getAttribute('href')).filter(Boolean);
    assert.deepEqual(links.filter((u) => /:\d{4,5}(\/|$)/.test(u.replace(/^https?:\/\//, ''))), [], 'no raw port');
    assert.deepEqual(links.filter((u) => u === FRONT), [FRONT], 'the front door once');
    assert.deepEqual(state.root.querySelector('.open-in').querySelectorAll('a').map((a) => a.textContent), ['Plex ↗']);
    assert.ok(links.some((u) => u.startsWith(`${FRONT}/#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F`)), 'a movie opens its page');
    const imgs = state.root.querySelectorAll('img').map((i) => i.getAttribute('src')).filter(Boolean);
    assert.ok(imgs.length > 0 && imgs.every((s) => s.startsWith('/api/plex/thumb')), 'posters are same-origin');
  } finally { dom.uninstall(); }
});

test('no raw :32400 link is left in a static script, the guard has no Plex exemption, and Caddy has no Plex name', () => {
  for (const f of ['movies.js', 'movie-night.js']) assert.ok(!/32400/.test(read(`hub/static/js/${f}`)), f);
  assert.ok(!/PLEX_PORT/.test(read('tests/test_nav_links.mjs')), 'the guard has no allow-list left');
  assert.ok(!/plex\.rahe-home/.test(read('deploy/caddy/Caddyfile')), 'Plex gets no gated name');
  assert.ok(!/\bplex\b/.test(read('deploy/gate-check.sh').match(/^NAMES=\(.*\)$/m)[0]), 'the gate check does not name it');
});
