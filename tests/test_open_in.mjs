// A10 plan decision 17: the Open in row is a wrapping row of links with gaps, never joined with " · ", so no line
// starts with a dot when it wraps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install } from './helpers/fake_dom.mjs';

test('Open in: the label and one link per tool, with no separator text between them', async () => {
  const dom = install();
  try {
    const { openInRow } = await import('../hub/static/js/section-links.js');
    const row = openInRow('system');
    const links = row.querySelectorAll('a');
    assert.ok(links.length >= 2, 'system has several tools');
    assert.doesNotMatch(row.textContent, /·/);
    assert.equal(row.childNodes.length, links.length + 1, 'the label, then only the links');
    assert.equal(row.childNodes[0].textContent, 'Open in');
  } finally { dom.uninstall(); }
});
