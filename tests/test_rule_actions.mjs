// A10 plan decision 17 (Automations): on a narrow row each rule's Preview and Remove sit in the row's disclosure; on a
// wide row they are the row's buttons. Same buttons, same names, either way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

const css = readFileSync(new URL('../hub/static/household-features.css', import.meta.url), 'utf8');

test('a rule has its two buttons inline and the same two in a disclosure', async () => {
  const dom = install();
  try {
    const { ruleActions } = await import('../hub/static/js/rules.js');
    const [inline, more] = ruleActions({}, { id: 'r1', text: 'When a print finishes, send a phone alert.' });
    assert.ok(inline.classList.contains('feature-actions'));
    assert.deepEqual(inline.querySelectorAll('button').map((b) => text(b)), ['Preview', 'Remove']);
    assert.equal(more.tagName.toLowerCase(), 'details');
    assert.ok(more.classList.contains('rule-more'));
    assert.equal(text(more.querySelector('summary')), 'Preview or remove');
    assert.deepEqual(more.querySelectorAll('button').map((b) => text(b)), ['Preview', 'Remove']);
    assert.equal(more.querySelectorAll('button')[1].getAttribute('aria-label'), 'Remove When a print finishes, send a phone alert.');
  } finally { dom.uninstall(); }
});

test('which of the two shows is decided by the list\'s own width (34rem)', () => {
  assert.match(css, /\.page-rules \.rule-more\s*\{\s*display:\s*none;?\s*\}/);
  const q = css.slice(css.indexOf('@container rules (max-width:34rem)'));
  assert.ok(q.length > 0 && css.includes('@container rules (max-width:34rem)'));
  assert.match(q, /\.page-rules \.rule > \.feature-actions\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(q, /\.page-rules \.rule-more\s*\{[^}]*display:\s*block/);
});
