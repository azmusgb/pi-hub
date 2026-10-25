import test from 'node:test';
import assert from 'node:assert/strict';
import { openLists, rememberOpen } from '../hub/static/js/section-links.js';

test('an opened "Show all" stays open when the page refreshes and rebuilds it', () => {
  const fake = () => ({ open: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } });
  const first = rememberOpen(fake(), 'workshop-prints');
  assert.equal(first.open, false);
  first.open = true; first.listeners.toggle();
  assert.ok(openLists.has('workshop-prints'));
  assert.equal(rememberOpen(fake(), 'workshop-prints').open, true);  // the rebuilt one
  const again = rememberOpen(fake(), 'workshop-prints');
  again.open = false; again.listeners.toggle();
  assert.equal(rememberOpen(fake(), 'workshop-prints').open, false);
});
