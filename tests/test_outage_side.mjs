import test from 'node:test';
import assert from 'node:assert/strict';
import { outageSide } from '../hub/static/js/health.js';

// An outage the hub knows is over reads "Ended", even when it never saw the end (7 Nov: Plex "still down" since 20 Oct).
test('an outage reads Still down only while it is ongoing', () => {
  assert.equal(outageSide({ start: 1, end: null, ongoing: true }), 'Still down');
  assert.equal(outageSide({ start: 1, end: null, ongoing: false }), 'Ended');
  assert.equal(outageSide({ start: 1, end: 60, ongoing: false }), 'Ended');
  assert.equal(outageSide({ start: 1, end: null }), 'Still down');
  assert.equal(outageSide(null), 'Still down');
});
