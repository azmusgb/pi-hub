// A7 P1, P3, P8: the page parts every page draws with the kit's classes (faceplate, sections, lamp-right rows).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

const load = async () => {
  const dom = install({ fetch: { '/api/needs': { items: [
    { id: 'a', source: 'Pi Hub', tone: 'warn', title: 'Ad blocking', detail: 'Off.', link: '/network', action: { key: 'open_network', link: '/network' } },
    { id: 'b', source: 'Pi Hub', tone: 'warn', title: 'Raspberry Pi', detail: 'Hot.', link: '/system' },
  ] } } });
  const kit = { exports: {} };
  new Function('module', readFileSync(new URL('../hub/static/ui/needs.js', import.meta.url), 'utf8'))(kit);
  globalThis.ApplianceNeeds = kit.exports;
  return { dom, parts: await import('../hub/static/js/page-parts.js') };
};

test('faceplate: nameplate and lamp, readout and unit, caption, readings, actions, in the kit classes', async () => {
  const { dom, parts } = await load();
  try {
    const f = parts.faceplate({ name: 'Internet', lamp: ['ok', 'Internet OK'], readout: '9.3', unit: 'ms', caption: 'Out to the wider internet.',
      readings: [['Down', '63 Mbps'], ['Up', null], ['Guest Wi-Fi', 'Hare']], actions: [dom.document.createElement('button')] });
    assert.equal(f.className, 'ui-faceplate');
    assert.equal(f.getAttribute('aria-label'), 'Internet');
    assert.equal(text(f.querySelector('.ui-faceplate__nameplate span')), 'Internet');
    assert.equal(text(f.querySelector('.ui-faceplate__nameplate .ui-chip')), 'Internet OK');
    assert.equal(f.querySelector('.ui-chip').className, 'ui-chip ui-chip--ok');
    assert.equal(text(f.querySelector('.ui-readout')), '9.3 ms');
    assert.equal(text(f.querySelector('.ui-faceplate__caption')), 'Out to the wider internet.');
    // A reading with no value is left out, never "null" or "undefined".
    assert.deepEqual(f.querySelectorAll('dt').map(text), ['Down', 'Guest Wi-Fi']);
    assert.equal(f.querySelectorAll('.ui-faceplate__actions button').length, 1);
  } finally { dom.uninstall(); }
});

test('loading: the faceplate is a busy skeleton in its own shape, never a blank page', async () => {
  const { dom, parts } = await load();
  try {
    const f = parts.faceplateLoading('Weather');
    assert.equal(f.getAttribute('aria-busy'), 'true');
    assert.ok(f.querySelectorAll('.ui-skeleton').length >= 3);
    assert.equal(f.getAttribute('aria-label'), 'Weather');
  } finally { dom.uninstall(); }
});

test('sections are a heading and rows on the page, no card; rows put the lamp on the right', async () => {
  const { dom, parts } = await load();
  try {
    const s = parts.section('Ad blocking', parts.lampRows([{ title: 'Protection is paused', detail: '0 of 12 blocked today.', tone: 'warn', word: 'Off', value: '12 lookups' }]), { note: 'From AdGuard.' });
    assert.equal(s.className, 'ui-section');
    assert.equal(text(s.querySelector('h2')), 'Ad blocking');
    assert.equal(text(s.querySelector('.ui-section__note')), 'From AdGuard.');
    const row = s.querySelector('.ui-row');
    assert.equal(row.className, 'ui-row ui-row--lamp');
    assert.deepEqual(row.children.map((c) => c.className), ['', 'ui-chip ui-chip--warn', 'ui-row__value']);
    assert.equal(text(row.querySelector('.ui-row__title')), 'Protection is paused');
  } finally { dom.uninstall(); }
});

test('Needs you here: only this page\'s items, hidden when none', async () => {
  const { dom, parts } = await load();
  try {
    const el = parts.needsHere();
    await parts.fillNeedsHere(el, '/network');
    assert.equal(el.hidden, false);
    assert.deepEqual(el.querySelectorAll('.ui-need__title').map(text), ['Ad blocking']);
    await parts.fillNeedsHere(el, '/weather');
    assert.equal(el.hidden, true);
  } finally { dom.uninstall(); }
});
