// A10 plan decision 15: a poster's title and year sit under the artwork, not on it (white text on a photo fails
// contrast on light posters), and the shelf fits two or three across on a phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from './helpers/fake_dom.mjs';

const css = readFileSync(new URL('../hub/static/movies.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';');

test('the badges, progress and time left sit on the artwork; the title and year follow it', async () => {
  const dom = install();
  try {
    const { poster } = await import('../hub/static/js/movies.js');
    const li = poster({ title: 'Heat', year: 1995, minutes: 170, progress: 40, rating: 8.3, content_rating: 'R', key: '/library/metadata/1' }, 'm1');
    const card = li.querySelector('.poster-card');
    assert.deepEqual(card.childNodes.map((n) => n.className), ['poster-art', 'poster-meta']);
    const art = card.querySelector('.poster-art');
    for (const sel of ['.poster-badges', '.poster-bar', '.poster-left']) assert.ok(art.querySelector(sel), `${sel} on the art`);
    assert.equal(card.querySelector('.poster-meta .poster-title').textContent, 'Heat');
  } finally { dom.uninstall(); }
});

test('no text over the photo: the words are in the flow, in the theme colours, and the shelf is fluid', () => {
  assert.doesNotMatch(rule('.poster-meta'), /position:\s*absolute/);
  assert.doesNotMatch(css, /\.poster-card \.poster-(meta|title)[^{]*\{[^}]*#fff/);
  assert.match(rule('.poster-shelf'), /repeat\(auto-fill, minmax\(min\(100%, 8rem\), 1fr\)\)/);
});

test('a narrow poster keeps its parts apart: one track the cell wide, time left clear of the badges', () => {
  // A word longer than the cell would widen an auto track past its neighbour; minmax(0, 1fr) holds it to the cell.
  assert.match(rule('.poster-card'), /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(rule('.poster-title'), /overflow-wrap:\s*anywhere/);
  // On an 8rem poster "170m left" at the top right ran into "★ 8.3" at the top left.
  assert.match(rule('.poster-left'), /bottom:/);
  assert.doesNotMatch(rule('.poster-left'), /top:/);
});
