// 4 Nov 2026: a Safari full-page screenshot (a PDF) of a foggy evening drew a dark ellipse down the page. PDF renderers
// blend a gradient's `transparent` stop (transparent black) through dark grey; the browser does not. Every weather and
// house layer fades to its own colour at zero alpha instead, which looks the same on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../hub/static/ambient.css', import.meta.url), 'utf8');

test('no ambient gradient fades through the transparent keyword', () => {
  for (const g of css.match(/(?:radial|linear|conic)-gradient\([^;]*\)/g) || []) {
    assert.doesNotMatch(g, /\btransparent\b/, g);
  }
});

test('each layer fades to its own colour: fog stays blue-grey, storm and cinema stay dark', () => {
  assert.match(css, /data-weather="fog"\] \.ambient-layer::before\s*\{[^}]*rgba\(180, 200, 220, 0\) 30%, rgba\(180, 200, 220, \.12\) 100%/);
  assert.match(css, /data-weather="storm"\] \.ambient-layer::before\s*\{[^}]*rgba\(20, 20, 30, 0\) 40%/);
  assert.match(css, /data-house="cinema"\] \.ambient-layer::after\s*\{[^}]*rgba\(0, 0, 0, 0\) 45%/);
});
