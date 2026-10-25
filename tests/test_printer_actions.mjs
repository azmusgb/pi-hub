import test from 'node:test';
import assert from 'node:assert/strict';
import { PRINTER_ACTIONS, printerActionList, runPrinterAction } from '../hub/static/js/printer-actions.js';

test('printerActionList follows the status', () => {
  assert.deepEqual(printerActionList({ actions: ['clear'] }).map((a) => a.label), ['Clear the plate']);
  assert.deepEqual(printerActionList({ actions: ['pause', 'nope'] }).map((a) => a.action), ['pause']);
  assert.deepEqual(printerActionList(null), []);
  assert.deepEqual(printerActionList({}), []);
  assert.equal(PRINTER_ACTIONS.clear.ask, 'Is the plate empty? Bambuddy may start the next print in the queue.');
  assert.equal(PRINTER_ACTIONS.pause.ask, 'Pause the print? It waits on the plate until you resume it.');
  assert.equal(PRINTER_ACTIONS.resume.ask, null);
});

function fakes(over = {}) {
  const seen = { posts: [], toasts: [], done: 0 };
  let release;
  const deps = {
    confirm: () => true, ensure: async () => true,
    post: (path) => { seen.posts.push(path); return new Promise((r) => { release = () => r({ ok: true, say: 'Paused. Resume it here or on the printer.' }); }); },
    toast: (msg, tone) => seen.toasts.push([msg, tone]),
    ...over,
  };
  return { seen, deps, release: () => release() };
}

test('runPrinterAction sends once and disables while in flight', async () => {
  const buttons = [{ disabled: false }, { disabled: false }];
  const { seen, deps, release } = fakes();
  const first = runPrinterAction('pause', buttons, () => seen.done++, deps);
  const second = runPrinterAction('pause', buttons, () => seen.done++, deps);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(seen.posts, ['/api/printer/pause']);
  assert.ok(buttons.every((b) => b.disabled));
  release();
  await Promise.all([first, second]);
  assert.ok(buttons.every((b) => !b.disabled));
  assert.equal(seen.done, 1);
  assert.deepEqual(seen.toasts, [['Paused. Resume it here or on the printer.', 'ok']]);
});

test('runPrinterAction does nothing when the plate question is declined', async () => {
  const { seen, deps } = fakes({ confirm: () => false });
  await runPrinterAction('clear', [{ disabled: false }], () => seen.done++, deps);
  assert.deepEqual(seen.posts, []);
  assert.equal(seen.done, 0);
});

test('runPrinterAction stops when the owner does not sign in', async () => {
  const { seen, deps } = fakes({ ensure: async () => false });
  await runPrinterAction('resume', [{ disabled: false }], () => seen.done++, deps);
  assert.deepEqual(seen.posts, []);
});

test('runPrinterAction shows Bambuddy errors and still refreshes', async () => {
  const buttons = [{ disabled: false }];
  const { seen, deps } = fakes({ post: async () => { throw new Error("Bambuddy isn't answering. Check the Pi, or use the printer's screen."); } });
  await runPrinterAction('resume', buttons, () => seen.done++, deps);
  assert.deepEqual(seen.toasts, [["Bambuddy isn't answering. Check the Pi, or use the printer's screen.", 'bad']]);
  assert.equal(buttons[0].disabled, false);
  assert.equal(seen.done, 1);
});
