import test from 'node:test';
import assert from 'node:assert/strict';
import { settle, deadline } from '../hub/static/js/core.js';

const never = new Promise(() => {});

test('a source that never answers gives its fallback instead of holding the page', async () => {
  assert.deepEqual(await settle(never, 20, { ok: false }), { ok: false });
  assert.equal(await settle(Promise.resolve(7), 20, 0), 7);
  assert.equal(await settle(Promise.reject(new Error('x')), 20, 'fallback'), 'fallback');
});

test('a page load that hangs fails after its deadline, so the next refresh can try again', async () => {
  await assert.rejects(deadline(never, 20), /took too long/);
  assert.equal(await deadline(Promise.resolve('done'), 20), 'done');
});

test('a load that missed its deadline finishes before another starts', async () => {
  const { loadOnce } = await import('../hub/static/js/core.js');
  const page = {};
  let release;
  const slow = loadOnce(page, () => new Promise((r) => { release = r; }), 20);
  await assert.rejects(slow, /took too long/);
  let started = false;
  assert.deepEqual(await loadOnce(page, () => { started = true; }, 20), { skipped: true });
  assert.equal(started, false);
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await loadOnce(page, () => { started = true; }, 20), { skipped: false });
  assert.equal(started, true);
});
