// A7 H4: risky actions ask first, inline (P7); versions are named by their change (P5, decision 4); fixes group (P6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

const JS = new URL('../hub/static/js/', import.meta.url);

test('no page uses the browser\'s confirm(): every risky action asks inline with the kit', () => {
  for (const f of readdirSync(JS).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(new URL(f, JS), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /window\.confirm|(?<![\w.])confirm\(/, f);
  }
});

test('versions: a merge is named by its change and number, never "Merge pull request"', async () => {
  const dom = install();
  try {
    const { versionName } = await import('../hub/static/js/versions.js');
    assert.equal(versionName({ subject: 'Off-site backup accepted #109' }), 'Off-site backup accepted #109');
    assert.equal(versionName({ subject: 'Merge pull request #109 from azmusgb/docs/c1-accepted' }), 'C1 accepted #109');
    assert.equal(versionName({ subject: 'Merge pull request #117 from azmusgb/feat/a7-h3-pages' }), 'A7 h3 pages #117');
    assert.equal(versionName({ subject: 'Fix the gate (#42)' }), 'Fix the gate #42');
    assert.equal(versionName({ sha: 'abc1234' }), 'abc1234');
  } finally { dom.uninstall(); }
});

test('recent fixes: the same fix with the same outcome on one day is one row with a count; another day is its own', async () => {
  const dom = install();
  try {
    const { groupFixLog } = await import('../hub/static/js/health.js');
    const day = new Date(2026, 10, 5, 9, 0).getTime() / 1000;
    const log = [
      { ts: day, action: 'restart:plex', result: 'Plex restarted.', device: 'iPad' },
      { ts: day + 3600, action: 'restart:plex', result: 'Plex restarted.', device: 'Mac' },
      { ts: day + 7200, action: 'restart:plex', result: 'Plex restarted.', device: 'iPad' },
      { ts: day + 7300, action: 'restart:plex', result: "Restart Plex didn't work. The hub's helper isn't running." },
      { ts: day - 86400, action: 'restart:plex', result: 'Plex restarted.' },
      { ts: 'junk', action: 'restart:plex', result: 'Plex restarted.' },
    ];
    const g = groupFixLog(log);
    assert.deepEqual(g.map((x) => x.count), [1, 3, 1], 'newest first; the failure is its own row; yesterday is its own');
    assert.deepEqual(g[1].devices, ['iPad', 'Mac']);
    assert.equal(g[1].first, day);
    assert.equal(g[1].last, day + 7200);
  } finally { dom.uninstall(); }
});

test('a fix asks first, inline under its button, and runs nothing when the answer is no', async () => {
  let posts = 0, asked = null;
  const dom = install({ fetch: { '/api/me': { role: 'owner' }, '/api/actions/restart%3Aplex': () => { posts += 1; return { ok: true, message: 'Plex restarted.' }; } },
    confirm: async (trigger, o) => { asked = { trigger, ...o }; return false; } });
  try {
    const core = await import('../hub/static/js/core.js');
    const btn = dom.document.createElement('button');
    btn.textContent = 'Restart';
    assert.equal(await core.fix('restart:plex', 'Restart Plex', { trigger: btn }), false);
    assert.equal(posts, 0);
    assert.equal(asked.trigger, btn);
    assert.equal(asked.confirm, 'Restart Plex', 'the confirm button repeats the verb');
    assert.match(asked.what, /Plex stops and starts again/);
    // No trigger, nowhere to ask: nothing runs.
    assert.equal(await core.fix('restart:plex', 'Restart Plex'), false);
    assert.equal(posts, 0);
  } finally { dom.uninstall(); }
});

test('Restart the Pi asks with the danger button; every action the server offers says what it will do', async () => {
  const dom = install();
  try {
    const { FIX_WHAT } = await import('../hub/static/js/core.js');
    const py = readFileSync(new URL('../hub/actions.py', import.meta.url), 'utf8');
    const names = [...py.matchAll(/^\s+"([a-z]+:[a-z]+)": \(/gm)].map((m) => m[1]);
    assert.ok(names.length >= 10);
    for (const n of names) assert.ok(FIX_WHAT[n], `${n} says what it will do`);
    const health = readFileSync(new URL('health.js', JS), 'utf8');
    assert.match(health, /name === "restart:pi" \? "ui-btn--danger"/);
    assert.match(health, /h\("details", \{ class: "ui-section health-fixes"/, 'Fixes is a closed section');
    const settings = readFileSync(new URL('settings.js', JS), 'utf8');
    assert.match(settings, /class: "ui-btn ui-btn--danger"[^\n]*\n[^\n]*askFirst[^\n]*\n[^\n]*\n[^\n]*"Sign out on this device"/);
  } finally { dom.uninstall(); }
});
