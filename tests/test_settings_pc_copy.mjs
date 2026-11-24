// Settings' line for the Windows PC's copy of the Pi's backup: copied, never copied, and a copy file the hub
// couldn't read are three different things (an unreadable file used to read as "Not copied to the PC yet.").
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

const NOW = Date.UTC(2026, 10, 24, 12) / 1000;

async function line(reading) {
  const dom = install({});
  try {
    const { pcCopyLine } = await import('../hub/static/js/settings.js');
    const el = pcCopyLine(reading, NOW);
    return { words: text(el), tone: el.querySelector('.dot')?.dataset.tone ?? null };
  } finally { dom.uninstall(); }
}

test('a copy from this morning is ok, one 50 h old or more is a warning', async () => {
  const fresh = await line({ ts: NOW - 3 * 3600, name: 'pi-hub.tgz' });
  assert.match(fresh.words, /^Copied to the Windows PC /);
  assert.equal(fresh.tone, 'ok');
  assert.equal((await line({ ts: NOW - 240 * 3600, name: 'pi-hub.tgz' })).tone, 'warn');
});

test('never copied says so', async () => {
  assert.deepEqual(await line('never'), { words: 'Not copied to the PC yet.', tone: null });
});

test('an unreadable copy file is unknown, never "not copied yet" and never ok', async () => {
  for (const r of ['unreadable', null, { ts: 'x' }]) {
    assert.deepEqual(await line(r), { words: "Couldn't read when the PC last copied the backup.", tone: 'unknown' }, String(r));
  }
});
