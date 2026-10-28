import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, sectionFor, redirectFor, phoneTabs, railItems, ASSISTANT_URL, toolUrl, resolveLink, assistantHref, assistantButton } from '../hub/static/js/sections.js';

test('one menu by task, in the design order', () => {
  assert.deepEqual(SECTIONS.map((s) => s.title), ['Home', 'Workshop', 'Documents', 'Media', 'Home & network', 'System']);
  assert.deepEqual(railItems(), ['home', 'workshop', 'documents', 'media', 'network', 'system']);
  assert.deepEqual(phoneTabs(), ['home', 'workshop', 'documents', 'media', 'more']);
  assert.equal(ASSISTANT_URL, 'https://assistant.home.arpa/');
});

test('every page belongs to a section', () => {
  const want = {
    '/': 'home', '/wall': 'home', '/weather': 'home', '/workshop': 'workshop',
    '/documents': 'documents', '/print': 'documents', '/lists': 'documents',
    '/media': 'media', '/movies': 'media', '/network': 'network', '/control': 'network',
    '/system': 'system', '/pi': 'system', '/alerts': 'system', '/rules': 'system', '/settings': 'system', '/drives': 'system',
    '/more': 'more', '/nowhere': 'home',
  };
  for (const [path, key] of Object.entries(want)) assert.equal(sectionFor(path), key, path);
});

test('old bookmarks land in the section where the tool now lives', () => {
  const want = {
    '/movies': '/media', '/control': '/network', '/apps': '/', '/apps/bambuddy': '/workshop', '/bambuddy': '/workshop',
    '/apps/grafana': '/network', '/grafana': '/network', '/apps/status': '/network', '/status': '/network',
    '/apps/scan': '/documents', '/workshop': null, '/': null, '/print': null,
  };
  for (const [path, to] of Object.entries(want)) assert.equal(redirectFor(path), to, path);
});

test('the menu markup matches the sections', () => {
  const html = readFileSync(new URL('../hub/static/index.html', import.meta.url), 'utf8');
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const pages = [...nav.matchAll(/data-page="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(pages, [...railItems(), 'more']);
  assert.ok(nav.includes(`href="${ASSISTANT_URL}"`), 'Assistant at the rail foot');
  assert.ok(!/data-page="[^"]*"[^>]*>[^<]*<span class="nav-badge"/.test(nav));
});

test('tool links use the gate names on home.arpa and the old address elsewhere', () => {
  assert.equal(toolUrl('paperless', 'home.home.arpa'), 'https://paperless.home.arpa/');
  assert.equal(toolUrl('paperless', '10.0.0.30'), 'http://10.0.0.21:8010/');
  assert.equal(toolUrl('scan', '10.0.0.30'), '/scan/');
  assert.equal(toolUrl('bambuddy', 'pi'), 'http://pi:8000/');
});

test('server links name a tool, and the page resolves it for the address in use', () => {
  assert.equal(resolveLink('tool:paperless/documents/42/details', 'home.home.arpa'), 'https://paperless.home.arpa/documents/42/details');
  assert.equal(resolveLink('tool:paperless/documents/42/details', '10.0.0.30'), 'http://10.0.0.21:8010/documents/42/details');
  assert.equal(resolveLink('tool:assistant', '10.0.0.30'), 'https://10.0.0.21/');
  assert.equal(resolveLink('/workshop', '10.0.0.30'), '/workshop');
});

test('assistantHref carries the page and its facts', () => {
  assert.equal(assistantHref('home.home.arpa', 'Workshop', 'Printing, 40% · done 3:10 PM'),
    'https://assistant.home.arpa/#ask?context=' + encodeURIComponent('Pi Hub › Workshop: Printing, 40% · done 3:10 PM'));
  assert.equal(assistantHref('10.0.0.30', 'Home'), 'https://10.0.0.21/#ask?context=' + encodeURIComponent('Pi Hub › Home'));
});

test('assistantHref keeps the context to 300 characters', () => {
  const ctx = decodeURIComponent(assistantHref('home.home.arpa', 'System', 'x'.repeat(1000)).split('context=')[1]);
  assert.equal(ctx.length, 300);
  assert.ok(ctx.endsWith('…'));
});

test('assistantHref never sends "undefined" and collapses whitespace', () => {
  assert.ok(!assistantHref('home.home.arpa', 'Media', undefined).includes('undefined'));
  assert.equal(decodeURIComponent(assistantHref('home.home.arpa', 'Home', ' Two\n things  ').split('context=')[1]), 'Pi Hub › Home: Two things');
});

test('assistantButton says the PC is off only when Local AI is down', () => {
  assert.deepEqual(assistantButton('Down'), { label: 'The PC is off', disabled: true });
  assert.deepEqual(assistantButton('Unknown'), { label: 'Assistant', disabled: false });
  assert.deepEqual(assistantButton('Ready'), { label: 'Assistant', disabled: false });
  assert.deepEqual(assistantButton(undefined), { label: 'Assistant', disabled: false });
});

test('assistantHref never cuts an emoji in half', () => {
  // A lone surrogate makes encodeURIComponent throw, so the button would stop working on that page.
  const facts = 'x'.repeat(283) + '😀 more facts after the cut';  // the emoji straddles the 299th unit
  const href = assistantHref('home.home.arpa', 'Home', facts);
  const ctx = decodeURIComponent(href.split('context=')[1]);
  assert.ok(ctx.length <= 300 && ctx.endsWith('…'));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(ctx));
});

test('the Assistant state is checked again when the page comes back into view', async () => {
  const fs = await import('node:fs');
  const main = fs.readFileSync(new URL('../hub/static/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /addEventListener\("visibilitychange", \(\) => \{ if \(!document\.hidden\) checkAssistant\(\); \}\)/);
});

test('a print row links the Print lab experiment on the Assistant tool', async () => {
  const { printLabUrl } = await import('../hub/static/js/sections.js');
  assert.equal(printLabUrl('E-023', 'pi.home.arpa'), 'https://assistant.home.arpa/#printLab?e=E-023');
});
