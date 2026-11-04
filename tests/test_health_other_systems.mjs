// W.1 review (#90): Health renders Local AI, the touchscreen and the PC even when the Pi's diagnostics fail, and its
// workshop guide sends the AI connection to that card, not to Workshop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

const RECORDS = { as_of: 1, events: [], records: [
  { id: 'local_ai', state: 'down', severity: 'problem', headline: "Local AI isn't answering", cause: 'The PC is on; Local AI itself isn\'t answering.', detail: {} },
  { id: 'workshop_display', state: 'online', severity: 'ok', headline: 'The touchscreen is online', cause: '', detail: { firmware: '1.4.2' } },
] };

async function renderHealth(routes) {
  const dom = install({ fetch: routes });
  const { mount, load } = await import('../hub/static/js/health.js');
  const state = { root: dom.root(), context: new URLSearchParams('') };
  mount(state);
  await load(state);
  return { dom, state };
}

test('with /api/pi failing, Health still shows Other systems from the records', async () => {
  const { dom, state } = await renderHealth({ '/api/records': RECORDS, '/api/actions': { actions: [], log: [], updates: {} } });
  try {
    const page = text(state.root);
    assert.match(page, /Couldn’t check the system/);  // the diagnostics card still says so
    const card = state.root.querySelector('[data-system="local_ai"]')?.closest('.card');
    assert.ok(card, 'the Other systems card is on the page');
    assert.match(text(card), /Local AI isn't answering/);
    assert.match(text(card), /The touchscreen is online/);
    assert.match(text(card), /Windows PC Not checked yet/);
  } finally { dom.uninstall(); }
});

test('with /api/records failing too, Other systems says not checked rather than nothing (or off)', async () => {
  const { dom, state } = await renderHealth({});
  try {
    const rows = state.root.querySelectorAll('[data-system]');
    assert.deepEqual(rows.map((r) => r.dataset.system), ['local_ai', 'workshop_display', 'pc']);
    for (const r of rows) assert.match(text(r), /Not checked yet/);
  } finally { dom.uninstall(); }
});

test("the workshop guide: camera and print status on Workshop, Local AI and the display on this page's Other systems", async () => {
  const { helpGuidance } = await import('../hub/static/js/health.js');
  const [, , advice, href, label] = helpGuidance().find(([k]) => k === 'workshop');
  assert.doesNotMatch(advice, /local AI connection/i);
  assert.match(advice, /Workshop shows the camera and print status/);
  assert.match(advice, /Other systems/);
  assert.equal(href, '/workshop');
  assert.equal(label, 'Check Workshop');
});

test('operations.md lists the workshop display under System, not Workshop', () => {
  const ops = readFileSync(new URL('../docs/operations.md', import.meta.url), 'utf8');
  const row = (name) => ops.split('\n').find((l) => l.startsWith(`| ${name} |`));
  assert.doesNotMatch(row('Workshop'), /workshop display/i);
  assert.match(row('System'), /workshop display/i);
});
