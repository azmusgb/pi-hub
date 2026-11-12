// A7 H5: Automations opens on a faceplate, not a hero; Settings on its setup faceplate, not a checklist (P1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

test('Automations: no all-caps hero; the faceplate counts what is on and lights when a run needs a look', async () => {
  const src = readFileSync(new URL('../hub/static/js/rules.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /A HOUSE THAT EXPLAINS ITSELF|Trust the result|PREVIEW · NO ACTIONS RUN|card\(/);
  const dom = install();
  try {
    const { automationsPlate } = await import('../hub/static/js/rules.js');
    const p = automationsPlate({ rules: [{ enabled: true }, { enabled: false }], runs: [{ ts: 1, status: 'failed' }], alerts_ready: false });
    assert.equal(text(p.querySelector('.ui-readout')), '1 on');
    assert.equal(p.querySelector('.ui-chip').className, 'ui-chip ui-chip--warn');
    assert.ok(p.querySelectorAll('dd').map(text).includes('Not set up'));
    const none = automationsPlate({ rules: [], runs: [] });
    assert.ok(!none.querySelector('.ui-chip'), 'nothing to say, no lamp');
    assert.match(text(none.querySelector('.ui-faceplate__caption')), /No automations yet/);
  } finally { dom.uninstall(); }
});

test('Settings: the setup faceplate says how much is done, and each step left is a button to its group', async () => {
  const dom = install();
  try {
    const { setupPlate } = await import('../hub/static/js/settings.js');
    const p = setupPlate([['Connect Homebridge', true, 'home', 'why a'], ['Set your town', false, 'outside', 'for the weather']]);
    assert.equal(text(p.querySelector('.ui-readout')), '1 of 2 done');
    assert.equal(text(p.querySelector('.ui-chip')), '1 step left');
    assert.deepEqual(p.querySelectorAll('.ui-faceplate__actions a').map((a) => a.getAttribute('href')), ['#group-outside']);
    assert.equal(text(setupPlate([['A', true, 'x', 'y']]).querySelector('.ui-chip')), 'All set');
  } finally { dom.uninstall(); }
});

// A22 step 11, H2: the leftover names. One name per thing (A22 8.1).
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("Settings' faceplate has no nameplate text (A22 2.3) and is still named for a screen reader", async () => {
  const dom = install();
  try {
    const { setupPlate } = await import('../hub/static/js/settings.js');
    const p = setupPlate([['Connect Homebridge', true, 'home', 'why a'], ['Set your town', false, 'outside', 'for the weather']]);
    assert.equal(p.getAttribute('aria-label'), 'Setup progress');
    const plate = p.querySelector('.ui-faceplate__nameplate');
    assert.deepEqual([...plate.children].map((c) => c.className.split(' ')[0]), ['ui-chip'], 'only the lamp is drawn, no name');
    assert.equal(text(p.querySelector('.ui-faceplate__nameplate')), '1 step left', 'the lamp stays');
    const { faceplate } = await import('../hub/static/js/page-parts.js');
    const named = faceplate({ name: 'Bambu X2D' });
    assert.equal(named.getAttribute('aria-label'), 'Bambu X2D');
    assert.equal(text(named.querySelector('.ui-faceplate__nameplate').children[0]), 'Bambu X2D');
  } finally { dom.uninstall(); }
});

test('the app is named Pi Hub, and the Assistant is only ever called Assistant', () => {
  const manifest = JSON.parse(src('hub/static/manifest.webmanifest'));
  assert.equal(manifest.name, 'Pi Hub');
  assert.equal(manifest.short_name, 'Pi Hub');
  for (const f of ['hub/static/index.html', 'hub/static/js/main.js', 'hub/static/js/assistant.js', 'hub/static/js/sections.js', 'hub/static/js/command-palette.js']) {
    assert.doesNotMatch(src(f), /Assistant \(Local AI\)/, f);
  }
  assert.doesNotMatch(src('hub/static/js/main.js'), /"\/assistant": "Local AI/, "the Assistant's purpose line doesn't say Local AI");
  assert.doesNotMatch(src('hub/static/index.html'), /Home network/, 'the brand carries no second name');
});

test("the kit copy names the hub Pi Hub (kit 2.16.1)", async () => {
  const { TOOLS } = await import('../hub/static/ui/tools.js');
  assert.equal(TOOLS.find((t) => t.id === 'hub').name, 'Pi Hub');
  assert.ok(JSON.parse(src('hub/static/ui/VERSION')).version >= '2.16.1');
});
