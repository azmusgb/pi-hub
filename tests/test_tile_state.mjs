// A light or plug whose on/off Homebridge didn't report is "No answer" and can't be toggled: unknown is never Off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tileState } from '../hub/static/js/wording.js';

test("on and off read as reported, with brightness", () => {
  assert.deepEqual(tileState({ on: true, brightness: 40 }), { text: 'On, 40%', known: true, on: true });
  assert.deepEqual(tileState({ on: true, brightness: null }), { text: 'On', known: true, on: true });
  assert.deepEqual(tileState({ on: false, brightness: 40 }), { text: 'Off', known: true, on: false });
});

test("no on/off is No answer, not Off, and not a known state", () => {
  for (const on of [null, undefined]) {
    assert.deepEqual(tileState({ on, brightness: null }), { text: 'No answer', known: false, on: null });
  }
});

test("an appliance whose power Homebridge didn't report says No answer, not Off", async () => {
  const { groupAppliances } = await import('../hub/static/js/wording.js');
  const acc = (id, name, on) => ({ id, name, room: 'Bosch', kind: 'switch', on });
  const status = (on) => groupAppliances([acc('p', 'Dishwasher Power', on), acc('r', 'Dishwasher Active', false)]).appliances[0].status;
  assert.equal(status(true), 'On');
  assert.equal(status(false), 'Off');
  assert.equal(status(null), 'No answer');
});
