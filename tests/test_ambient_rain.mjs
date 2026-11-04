// The rain overlay (ambient.css) must draw short streaks, never lines across the page. A layer that is a top-to-bottom
// linear-gradient fills its tile's whole width, so narrow tiles side by side join into one horizontal stripe that slides
// down the screen (owner's iPad, /devices, 4 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../hub/static/ambient.css', import.meta.url), 'utf8');

function rainRule() {
  const at = css.indexOf('html[data-weather="sleet"] .ambient-layer::before {');
  assert.ok(at >= 0, 'the rain rule is where it was');
  return css.slice(at, css.indexOf('}', at));
}

// Split a comma list at the top level only (gradients have commas inside their parentheses).
function layers(value) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

const prop = (rule, name) => (rule.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1];

test('every rain layer is bounded across as well as down, so tiles never join into a line', () => {
  for (const layer of layers(prop(rainRule(), 'background-image'))) {
    const vertical = /^linear-gradient\(\s*(?!to right|to left|90deg|270deg)/.test(layer);
    assert.ok(!vertical, `a top-to-bottom gradient spans its tile's full width: ${layer.slice(0, 60)}`);
  }
});

test('rain tiles leave a gap between streaks', () => {
  for (const size of layers(prop(rainRule(), 'background-size'))) {
    const width = parseFloat(size);
    assert.ok(width >= 20, `tile ${size} is too narrow to leave a gap between streaks`);
  }
});
