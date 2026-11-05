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
