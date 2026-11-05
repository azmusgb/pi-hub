// A print history row from the lab opens its experiment in its own project: with several projects, ?e= alone can
// open the wrong one.
import test from 'node:test';
import assert from 'node:assert/strict';

test("a lab print's history link names its project", async () => {
  const { printLabHref } = await import('../hub/static/js/workshop.js');
  assert.equal(printLabHref({ lab: { project: 'mount-v2', exp: 'E-007', build: 'BLD-007-03' } }), '/lab?p=mount-v2&e=E-007');
});

test("a lab print without a project still opens its experiment", async () => {
  const { printLabHref } = await import('../hub/static/js/workshop.js');
  assert.equal(printLabHref({ lab: { exp: 'E-007', build: 'BLD-007-03' } }), '/lab?e=E-007');
});

test("a print outside the lab has no lab link", async () => {
  const { printLabHref } = await import('../hub/static/js/workshop.js');
  assert.equal(printLabHref({ lab: null }), null);
});
