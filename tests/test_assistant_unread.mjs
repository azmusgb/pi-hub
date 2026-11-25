// A34 P1a/P2: what the status and models pages draw when there is nothing true to draw (hub/static/js/assistant-pages.js):
// Pi Hub's own cap with nothing kept, and a source marked ok whose list isn't there. Never a zero, an empty list or "down".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';
import './helpers/kit.mjs';

const contract = (name) => JSON.parse(readFileSync(new URL(`./fixtures/localai-contract/${name}.json`, import.meta.url), 'utf8'));
const live = (data) => ({ state: 'live', mirror: false, fetched_at: 1, data });

async function pages() {
  const dom = install();
  const mod = await import('../hub/static/js/assistant-pages.js');
  return { mod, draw: (nodes) => { const box = document.createElement('div'); box.append(...nodes.filter(Boolean)); return box; }, done: dom.uninstall };
}

test('Pi Hub already asking, with nothing kept (busy), is not drawn as the Assistant being down', async () => {
  const { mod, draw, done } = await pages();
  try {
    for (const [body, what] of [[mod.statusBody, 'status'], [mod.modelsBody, 'models']]) {
      const box = draw(body({ state: 'busy', why: 'busy', fetched_at: 1, data: null }));
      assert.match(text(box), new RegExp(`Pi Hub is already asking the Assistant\\. In a moment this page reads the ${what}\\.`));
      assert.doesNotMatch(text(box), /isn't answering|Check the Assistant|asleep|Wake the PC/);
      assert.equal(box.querySelector('.ui-notice'), null, 'no warning: nothing is known to be wrong');
      assert.equal(box.querySelector('.ui-faceplate'), null, 'and no plate of zeros');
    }
  } finally { done(); }
});

test('models: a source marked ok whose list is missing or the wrong type is a read that could not be made, never 0 or nothing', async () => {
  const { mod, draw, done } = await pages();
  try {
    for (const bad of [undefined, null, 'none', {}, 3]) {
      const noInstalled = { ...contract('models_ok'), installed: bad };
      if (bad === undefined) delete noInstalled.installed;
      let box = draw(mod.modelsBody(live(noInstalled)));
      const plate = text(box.querySelector('.ui-faceplate'));
      assert.match(plate, /Unknown/);
      assert.doesNotMatch(plate, /\b0\b|installed model|Runtime ready|Runtime not answering/);
      assert.doesNotMatch(text(box), /No models are installed/);
      assert.match(text(box), /Installed.*The Assistant's answer couldn't be read\./);
      assert.match(text(box.querySelector('#models-sources')), /Installed models.*Couldn't be read/);
      assert.match(text(box.querySelector('#models-sources')), /Loaded models.*Read/, 'a source that did answer is still read');

      box = draw(mod.modelsBody(live({ ...contract('models_ok'), pulls: bad })));
      assert.doesNotMatch(text(box), /Nothing is downloading|in progress/);
      assert.match(text(box), /Downloads.*The Assistant's answer couldn't be read\./);
      assert.match(text(box.querySelector('#models-sources')), /Downloads.*Couldn't be read/);
      assert.match(text(box.querySelector('.ui-faceplate')), /1.*installed model/, 'the rest is drawn');

      box = draw(mod.modelsBody(live({ ...contract('models_ok'), loaded: bad })));
      assert.doesNotMatch(text(box.querySelector('.ui-faceplate')), /loaded now/);
      assert.match(text(box.querySelector('.ui-faceplate')), /Loaded models not read/);
      assert.doesNotMatch(text(box), /Not loaded/, 'no model is called not loaded when what is loaded was not read');
    }
    const empty = draw(mod.modelsBody(live({ ...contract('models_ok'), pulls: [] })));
    assert.match(text(empty), /Nothing is downloading\./, 'a real empty list still says so');
  } finally { done(); }
});

test('status: services marked ok but missing is a read that could not be made; a null entry in the list is skipped, not thrown on', async () => {
  const { mod, draw, done } = await pages();
  try {
    for (const bad of [undefined, null, 'x', {}]) {
      const box = draw(mod.statusBody(live({ ...contract('status_ok'), services: bad })));
      const plate = text(box.querySelector('.ui-faceplate'));
      assert.match(plate, /Unknown/);
      assert.doesNotMatch(plate, /Working/);
      assert.match(text(box), /The Assistant's answer couldn't be read\. Its services couldn't be read\./);
      assert.doesNotMatch(text(box), /Local AI isn't answering/, 'it did answer; what it said could not be read');
    }
    const d = contract('status_ok');
    const n = d.services.length;
    d.services = [null, ...d.services, undefined, 7, 'x'];
    const box = draw(mod.statusBody(live(d)));
    assert.match(text(box.querySelector('.ui-faceplate')), /Working/);
    const ok = draw(mod.statusBody(live(contract('status_ok'))));
    assert.equal(box.querySelectorAll('.ui-row').length, ok.querySelectorAll('.ui-row').length);
    assert.ok(n > 0);
  } finally { done(); }
});
