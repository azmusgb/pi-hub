// /lab?p= picks the project (platform step 6, PR 6.1): ?p= alongside ?e= and do=judge, an unknown ?p=, and no ?p=.
// do=judge itself is covered in test_lab_page.mjs (judgeOnOpen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setDeps } from '../hub/static/js/lab-net.js';
import { fetchLab, pickProject } from '../hub/static/js/lab.js';

const TWO = [{ name: 'hex-tile', fingerprint: 'a' }, { name: 'bracket', fingerprint: 'b' }];

test('no ?p= opens the first project, as before', () => {
  assert.equal(pickProject(TWO, null).meta.name, 'hex-tile');
  assert.equal(pickProject(TWO, '').meta.name, 'hex-tile');
});

test('?p= opens that project, not the first', () => {
  assert.equal(pickProject(TWO, 'bracket').meta.name, 'bracket');
});

test('a ?p= that names no project says so and lists the real ones, never opening another', () => {
  assert.deepEqual(pickProject(TWO, 'nope'), { missing: 'nope', names: ['hex-tile', 'bracket'] });
});

test('no projects, or only nameless ones, is no lab data', () => {
  assert.equal(pickProject([], 'hex-tile'), null);
  assert.equal(pickProject(undefined, null), null);
  assert.equal(pickProject([{ fingerprint: 'x' }, null], null), null);
});

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function rig() {
  const calls = [];
  setDeps({ fetch: async (path) => { calls.push(path); return path === '/api/lab/projects' ? res(200, { projects: TWO })
    : res(200, path.endsWith('/requests') ? { items: [] } : { meta: {}, index: { experiments: [] } }); },
    ensure: async () => false, hidden: () => false });
  return calls;
}

test('fetchLab reads the ?p= project, and an unknown one fetches nothing else', async () => {
  const calls = rig();
  const state = { context: new URLSearchParams('p=bracket&e=E-025&do=judge') };
  const got = await fetchLab(state);
  assert.ok(got.labData);
  assert.equal(state.currentProject, 'bracket');
  assert.deepEqual(calls.slice(1).sort(), ['/api/lab/bracket', '/api/lab/bracket/requests']);
  const miss = rig();
  assert.deepEqual(await fetchLab({ context: new URLSearchParams('p=nope') }), { missing: 'nope', names: ['hex-tile', 'bracket'] });
  assert.deepEqual(miss, ['/api/lab/projects']);
});

