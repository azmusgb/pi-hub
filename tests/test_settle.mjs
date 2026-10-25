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
