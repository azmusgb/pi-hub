import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecovery } from '../hub/static/js/recovery.js';
import { readingText } from '../hub/static/js/freshness.js';

test('source text distinguishes fresh response, old reading, failed check and absent setup', () => {
  const row = { state: 'current', confirmed_at: 1000, max_age: 20, reading: 'Ready' };
  assert.match(readingText(row, 1010), /Last response: Ready · 10 seconds ago/);
  assert.match(readingText(row, 1021), /Earlier reading.*current state unconfirmed/);
  assert.match(readingText(row, 1010, true), /Earlier reading/);
  assert.match(readingText({state: 'unavailable'}, 1010), /Couldn’t check.*no earlier/);
  assert.equal(readingText({state: 'not_configured'}, 1010), 'Not set up');
});

test('recovery retries only read-only checks and finishes when the integration returns', async () => {
  let checks = 0, waits = 0;
  const result = await verifyRecovery('restart:plex', {
    check: async () => ({state: ++checks === 2 ? 'recovered' : 'unavailable'}),
    wait: async () => { waits++; },
  });
  assert.equal(result.state, 'recovered');
  assert.equal(checks, 2);
  assert.equal(waits, 1);
});

test('failed recovery is bounded and preserves a concrete next step', async () => {
  let checks = 0;
  const result = await verifyRecovery('remount:movies', {
    check: async () => { checks++; return {state: 'needs_attention', next_step: 'Check the cable'}; }, wait: async () => {},
  });
  assert.equal(checks, 3);
  assert.equal(result.next_step, 'Check the cable');
});

test('navigation cancels followup checks and setup errors do not keep retrying', async () => {
  let active = true, checks = 0;
  const result = await verifyRecovery('restart:plex', {
    active: () => active, check: async () => { checks++; active = false; return {state: 'unavailable'}; },
  });
  assert.equal(result.state, 'cancelled'); assert.equal(checks, 1);
  const setup = await verifyRecovery('restart:homebridge', {
    check: async () => ({state:'needs_setup'}), wait: () => assert.fail('Do not retry setup'),
  });
  assert.equal(setup.state, 'needs_setup');
});

test('network errors cannot become a successful recovery', async () => {
  const result = await verifyRecovery('restart:plex', {
    check: async () => { throw Error('network'); }, wait: async () => {},
  });
  assert.equal(result.state, 'unavailable');
});
