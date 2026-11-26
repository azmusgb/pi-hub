// A37 R1: on a page that says its reading, the shell's h1 is the sentence (the kit's ui-say); the page's name stays
// in it for assistive tech, and the purpose line is not drawn. Every other page keeps its plain title and purpose,
// and nothing of a saying page is left behind when the next page opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, text } from './helpers/fake_dom.mjs';

const load = async ({ kit = true } = {}) => {
  const dom = install();
  if (kit) {
    const mod = { exports: {} };
    new Function('module', readFileSync(new URL('../hub/static/ui/say.js', import.meta.url), 'utf8'))(mod);
    globalThis.ApplianceSay = mod.exports;
  } else delete globalThis.ApplianceSay;
  const parts = await import('../hub/static/js/page-parts.js');
  const el = (tag, attrs = {}) => Object.assign(dom.document.createElement(tag), attrs);
  const header = el('header', { className: 'ui-shell-head top' });
  const h1 = el('h1', { className: 'brand', id: 'page-title' });
  const sub = el('p', { className: 'top-sub', id: 'page-subtitle' });
  header.append(h1, sub);
  dom.document.body.append(header);
  return { dom, parts, header, h1, sub };
};
const done = (dom) => { delete globalThis.ApplianceSay; dom.uninstall(); };
const printing = { label: 'Printer', sentences: ['The X2D is 45% through Clip.', 'About 6 h 16 min left.'], loading: false };

test('a saying page: the h1 is ui-say, busy with a skeleton and the hidden name, and no purpose line', async () => {
  const { dom, parts, header, h1, sub } = await load();
  try {
    parts.pageHead(h1, sub, { label: 'Printer', purpose: 'The X2D and what it is printing', says: true });
    assert.equal(h1.className, 'ui-say', 'the plain title\'s class is off, so its size does not fight the kit\'s');
    assert.equal(h1.getAttribute('aria-busy'), 'true');
    assert.equal(text(h1.querySelector('.ui-vh')), 'Printer:');
    assert.equal(h1.querySelectorAll('.ui-skeleton').length, 2);
    assert.equal(text(h1), 'Printer:', 'loading is a skeleton, never text beyond the name');
    assert.equal(sub.textContent, '');
    assert.ok(header.classList.contains('top--say'));
  } finally { done(dom); }
});

test('sayHead writes the sentences, keeps the name, and leaves the DOM alone when nothing changed', async () => {
  const { dom, parts, h1, sub } = await load();
  try {
    parts.pageHead(h1, sub, { label: 'Printer', purpose: 'x', says: true });
    assert.equal(parts.sayHead(printing, h1), true);
    assert.equal(h1.getAttribute('aria-busy'), null);
    assert.deepEqual(h1.querySelectorAll('.ui-say__s').map(text), printing.sentences);
    assert.equal(text(h1.querySelector('.ui-vh')), 'Printer:');
    const first = h1.querySelector('.ui-say__s');
    assert.equal(parts.sayHead({ ...printing }, h1), false);
    assert.equal(h1.querySelector('.ui-say__s'), first, 'the same nodes: a refresh with the same reading redraws nothing');
  } finally { done(dom); }
});

test('the next page gets the plain head back: no ui-say, data-say, aria-busy or sentence left behind', async () => {
  const { dom, parts, header, h1, sub } = await load();
  try {
    parts.pageHead(h1, sub, { label: 'Printer', purpose: 'x', says: true });
    parts.sayHead(printing, h1);
    parts.pageHead(h1, sub, { label: 'Health', purpose: 'The Pi and its services', says: false });
    assert.equal(h1.className, 'brand');
    assert.equal(text(h1), 'Health');
    assert.equal(h1.dataset.say, undefined);
    assert.equal(h1.getAttribute('aria-busy'), null);
    assert.equal(h1.querySelector('span'), null);
    assert.equal(sub.textContent, 'The Pi and its services');
    assert.equal(header.classList.contains('top--say'), false);
  } finally { done(dom); }
});

test('a late answer from the page just left does not write on the next page\'s head', async () => {
  const { dom, parts, h1, sub } = await load();
  try {
    parts.pageHead(h1, sub, { label: 'Printer', purpose: 'x', says: true });
    parts.pageHead(h1, sub, { label: 'Health', purpose: 'y', says: false });
    assert.equal(parts.sayHead(printing, h1), false);
    assert.equal(text(h1), 'Health');
  } finally { done(dom); }
});

test('opening the same saying page again starts from loading, not from the last visit\'s sentence', async () => {
  const { dom, parts, h1, sub } = await load();
  try {
    parts.pageHead(h1, sub, { label: 'Printer', purpose: 'x', says: true });
    parts.sayHead(printing, h1);
    parts.pageHead(h1, sub, { label: 'Printer', purpose: 'x', says: true });
    assert.equal(h1.getAttribute('aria-busy'), 'true');
    assert.equal(h1.querySelectorAll('.ui-say__s').length, 0);
  } finally { done(dom); }
});

test('without the kit\'s say.js (an old cached shell) a saying page keeps its plain title and purpose', async () => {
  const { dom, parts, header, h1, sub } = await load({ kit: false });
  try {
    parts.pageHead(h1, sub, { label: 'Printer', purpose: 'The X2D and what it is printing', says: true });
    assert.equal(h1.className, 'brand');
    assert.equal(text(h1), 'Printer');
    assert.equal(sub.textContent, 'The X2D and what it is printing');
    assert.equal(header.classList.contains('top--say'), false);
    assert.equal(parts.sayHead(printing, h1), false);
    assert.equal(text(h1), 'Printer');
  } finally { done(dom); }
});
