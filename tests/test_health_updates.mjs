// Health's Updates part says "N software updates waiting" in household words, keeps the package names behind a
// disclosure, and never reads an unreadable check as "up to date".
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

async function renderHealth(pi) {
  const dom = install({ fetch: { '/api/pi': pi, '/api/actions': { actions: [], log: [], updates: {} }, '/api/records': { records: [] } } });
  const { mount, load } = await import('../hub/static/js/health.js');
  const state = { root: dom.root(), context: new URLSearchParams('') };
  mount(state);
  await load(state);
  return { dom, part: state.root.querySelector('[data-health="updates"]') };
}

const PI = (updates) => ({ services: [{ name: 'hub', state: 'active' }], disk: {}, network: {}, updates });

test('pending updates are counted, security ones named only when the data says so, names sit in a disclosure', async () => {
  const { dom, part } = await renderHealth(PI([
    { name: 'vim-common', version: '2:9.1.1230-2+deb13u2', security: true },
    { name: 'vim-tiny', version: '2:9.1.1230-2+deb13u2', security: false },
  ]));
  try {
    assert.match(text(part.querySelector('.updates-summary')), /^2 software updates waiting, 1 of them security\.$/);
    const detail = part.querySelector('details.updates-detail');
    assert.ok(detail, 'package names are in a details disclosure');
    assert.equal(detail.open, false);
    assert.match(text(detail), /vim-common/);
    assert.ok(!text(part.querySelector('.updates-summary')).includes('vim'), 'the summary has no package names');
  } finally { dom.uninstall(); }
});

test('no security flag in the data: nothing is claimed about security', async () => {
  const { dom, part } = await renderHealth(PI([{ name: 'vim-tiny', version: '1' }]));
  try {
    assert.equal(text(part.querySelector('.updates-summary')), '1 software update waiting.');
  } finally { dom.uninstall(); }
});

test('an unreadable updates check is unknown, never "up to date"', async () => {
  for (const updates of [null, undefined, 'oops']) {
    const { dom, part } = await renderHealth(PI(updates));
    try {
      const t = text(part);
      assert.match(t, /Couldn't check for updates/);
      assert.ok(!/up to date/i.test(t), String(updates));
      assert.ok(!part.querySelector('.updates-install'), 'no install button without a reading');
    } finally { dom.uninstall(); }
  }
});

test('an empty list is up to date', async () => {
  const { dom, part } = await renderHealth(PI([]));
  try { assert.match(text(part), /Up to date/); } finally { dom.uninstall(); }
});
