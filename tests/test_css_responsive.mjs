// Amendment A10 D2 (plan decision 7): no stylesheet switches its layout at a window width, except the shell's rail and
// tab bar, marked "A10 D2: shell switch" in the comment before the rule, and the wall's own board (A10, Not changed).
// Files not converted yet are PENDING; each A10 PR deletes its files from the list, which only shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIC = fileURLToPath(new URL('../hub/static/', import.meta.url));
const MARK = 'A10 D2: shell switch';
const PENDING = new Set([
  'household-features.css', 'lab.css', 'movies.css', 'workshop-pi-rich.css',
]);

// The block after an at-rule's "{", by matching braces (comments and strings are short here and hold no braces).
function block(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return css.slice(open + 1);
}

// A selector list split at its top-level commas (not those inside :is(), :has() or :not()).
function splitTop(list) {
  const out = [];
  let paren = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') paren++;
    else if (list[i] === ')') paren--;
    else if (list[i] === ',' && paren === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

// The selectors of a block's top-level rules.
function selectors(body) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') { if (depth++ === 0) out.push(...splitTop(body.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, ''))); }
    else if (body[i] === '}' && --depth === 0) start = i + 1;
  }
  return out;
}

// The wall (kiosk) board's own classes: body.wall, .wall-*, .kiosk-*.
const WALL = /body\.wall\b|\.wall-[\w-]|\.kiosk-[\w-]/;

// Each @media whose condition names a width, and is neither marked as the shell's switch nor wholly the wall's.
export function violations(css) {
  const found = [];
  for (const m of css.matchAll(/@media([^{]*)\{/g)) {
    if (!/\bwidth\b/.test(m[1])) continue;
    const before = css.slice(Math.max(0, m.index - 200), m.index);
    const lastComment = before.lastIndexOf('/*') >= 0 ? before.slice(before.lastIndexOf('/*')) : '';
    // Marked only by the comment right before it: no rule ends between the comment and the @media.
    if (lastComment.includes(MARK) && !lastComment.slice(lastComment.indexOf('*/') + 2).includes('}')) continue;
    const sels = selectors(block(css, m.index + m[0].length - 1));
    if (sels.length && sels.every((s) => WALL.test(s))) continue;
    const line = css.slice(0, m.index).split('\n').length;
    found.push({ line, query: m[1].trim() });
  }
  return found;
}

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []);
}

test('no stylesheet switches at a window width outside the shell and the wall (A10 D2)', () => {
  const bad = [];
  for (const f of cssFiles(STATIC)) {
    const name = relative(STATIC, f);
    if (PENDING.has(name)) continue;
    for (const v of violations(readFileSync(f, 'utf8'))) bad.push(`${name}:${v.line} @media ${v.query}`);
  }
  assert.deepEqual(bad, [], 'replace these with intrinsic grids, container queries or clamp(), or mark the shell switch');
});

test('every pending file still has a window switch, so the list only shrinks', () => {
  for (const name of PENDING) {
    const v = violations(readFileSync(join(STATIC, name), 'utf8'));
    assert.ok(v.length > 0, `${name} has no window switch left: delete it from PENDING`);
  }
});

test('the check catches an unmarked switch and allows the marked shell switch, the wall, and non-width queries', () => {
  assert.equal(violations('@media (max-width: 640px) { .x { display: none } }').length, 1);
  assert.equal(violations('@media screen and (min-width:861px){.a{b:c}}').length, 1);
  assert.equal(violations(`/* ${MARK}: rail vs tab bar */\n@media (max-width: 860px) { .rail { display: none } }`).length, 0);
  // A mark further up, before another rule, doesn't cover a later switch.
  assert.equal(violations(`/* ${MARK} */\n.y{z:1}\n@media (max-width: 860px) { .x { a: b } }`).length, 1);
  assert.equal(violations('@media (min-width: 900px) { body.wall .stage { a: b } .wall-board { c: d } }').length, 0);
  assert.equal(violations('@media (min-width: 900px) { body.wall .stage { a: b } .home { c: d } }').length, 1);
  assert.equal(violations('@media (min-width: 900px) { .wall-head:has(.dot, .x) { a: b } #view .kiosk-cam-img { c: d } }').length, 0);
  assert.equal(violations('@media (pointer: coarse) { .x { min-height: 44px } }').length, 0);
  assert.equal(violations('@media (prefers-reduced-motion: no-preference) { .x { a: b } }').length, 0);
  assert.equal(violations('@container (min-width: 30rem) { .x { a: b } }').length, 0);
});
