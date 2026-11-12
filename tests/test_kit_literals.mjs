// A22 step 13 (docs/superpowers/plans/2026-11-12-step-13-shared-values-and-check.md, H6): the kit's literals check
// (hub/static/ui/literals.mjs, A22 1.5) holds hub/static to .kit-literals-baseline.json. A colour, size, spacing,
// radius, shadow, duration, layer or private name written by hand may not be added; one that is removed lowers the
// baseline in the same PR (`node hub/static/ui/literals.mjs hub/static --write-baseline`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const check = (cwd, ...args) => spawnSync(process.execPath, ['hub/static/ui/literals.mjs', 'hub/static', ...args], { cwd, encoding: 'utf8' });
// A copy of what the check reads, so a test can change a file without touching the checkout.
function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-literals-'));
  // Without the vendored three.js (2 MB, and the allow list skips it): the Pi runs this suite at each release.
  cpSync(join(ROOT, 'hub/static'), join(dir, 'hub/static'), { recursive: true, filter: (src) => !src.endsWith('/hub/static/vendor') });
  for (const f of ['.kit-literals-baseline.json', '.kit-literals-allow.json']) cpSync(join(ROOT, f), join(dir, f));
  return dir;
}

test('hub/static matches the literals baseline', () => {
  const r = check(ROOT);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('adding one hex colour to a stylesheet fails the check, and names the file and the category', () => {
  const dir = copy();
  assert.equal(check(dir).status, 0);
  appendFileSync(join(dir, 'hub/static/pages.css'), '\n.scratch { color: #ff0000; }\n');
  const r = check(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^hub\/static\/pages\.css: colour \d+, the baseline says \d+\. Use the kit's value instead/);
});

test('a new stylesheet starts at zero', () => {
  const dir = copy();
  appendFileSync(join(dir, 'hub/static/new-page.css'), '.n { margin: 4px; }\n');
  const r = check(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hub\/static\/new-page\.css: space 1, the baseline says 0: a new file starts at zero/);
});

test('the allow list is the per-instance names A22 1.4 lists and the vendored three.js, nothing else', () => {
  const allow = JSON.parse(readFileSync(join(ROOT, '.kit-literals-allow.json'), 'utf8'));
  assert.deepEqual(allow.files, ['hub/static/vendor/**']);
  assert.deepEqual(allow.names, ['--pct', '--x', '--y', '--size', '--vx', '--vy', '--vz', '--box', '--wall-*', '--cam-*', '--band-accent']);
});
