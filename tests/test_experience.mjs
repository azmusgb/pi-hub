import test from 'node:test';
import assert from 'node:assert/strict';
import { issueTopic, splitIssues, unreadCount } from '../hub/static/js/experience.js';

test('small alert sets stay visible; larger sets can expand without losing issues', () => {
  for (const n of [0, 1, 2]) {
    const issues = Array.from({ length: n }, (_, id) => ({ id }));
    assert.deepEqual(splitIssues(issues), { shown: issues, remaining: 0 });
  }
  const issues = Array.from({ length: 5 }, (_, id) => ({ id }));
  assert.equal(splitIssues(issues).shown.length, 1);
  assert.equal(splitIssues(issues).remaining, 4);
  assert.deepEqual(splitIssues(issues, true), { shown: issues, remaining: 0 });
  assert.equal(issues.length, 5);
});

test('household symptoms lead to the relevant guide', () => {
  for (const name of ['Movies drive', 'Movies', 'Plex']) assert.equal(issueTopic({ what: name }), 'movies');
  for (const name of ['Homebridge', 'Smart-home controls']) assert.equal(issueTopic({ what: name }), 'devices');
  for (const name of ['Bambu X2D', 'Windows PC', 'Workshop display']) assert.equal(issueTopic({ what: name }), 'workshop');
  assert.equal(issueTopic({ what: 'Home status unavailable' }), 'system');
  assert.equal(issueTopic({}), 'system');
});

test('new-alert count excludes viewed and invalid timestamps', () => {
  const alerts = [{ ts: 100 }, { ts: 101 }, { ts: 102 }, { ts: null }];
  assert.equal(unreadCount(alerts, 100), 2);
  assert.equal(unreadCount(alerts, 102), 0);
});
