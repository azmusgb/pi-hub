import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './helpers/kit.mjs';
import { ASSISTANT_URL, toolUrl, resolveLink, assistantHref, assistantButton } from '../hub/static/js/sections.js';
import { SITE, sectionFor } from '../hub/static/js/site.js';

const redirectFor = SITE.redirectFor;

// A22 2.2 (step 12): five areas, read from the kit's page list. Documents and Media are Household; Home & network is
// Network; the phone's tab bar shows the same five, so there is no More.
test('one menu by task, in the design order', () => {
  assert.deepEqual(SITE.areas.map((a) => a.label), ['Home', 'Workshop', 'Household', 'Network', 'System']);
  assert.deepEqual(SITE.areas.map((a) => a.id), ['home', 'workshop', 'household', 'network', 'system']);
  assert.deepEqual(SITE.areas.map((a) => SITE.page(a.landing).path), ['/', '/workshop', '/media', '/devices', '/system'], 'Household opens on Movies');
  assert.equal(ASSISTANT_URL, 'https://assistant.rahe-home.duckdns.org/');
});

test('every page belongs to a section', () => {
  const want = {
    '/': 'home', '/wall': 'home', '/weather': 'network', '/devices': 'network', '/map': 'system', '/workshop': 'workshop',
    '/documents': 'household', '/print': 'household', '/lists': 'household', '/scan': 'household',
    '/media': 'household', '/network': 'network',
    '/system': 'system', '/backups': 'system', '/pi': 'home', '/alerts': 'system', '/rules': 'system', '/settings': 'system', '/drives': 'household', '/versions': 'system',
    '/more': 'home', '/nowhere': 'home', '/assistant': 'assistant',
  };
  for (const [path, key] of Object.entries(want)) assert.equal(sectionFor(path), key, path);
});

// A22 section 10: /apps/status and /status go to Health (Uptime Kuma is retired), /apps/scan to the Scan page, /more to the Site map.
test('old bookmarks land in the section where the tool now lives', () => {
  const want = {
    '/movies': '/media', '/control': '/devices', '/pi': '/system', '/apps': '/', '/next': '/', '/apps/bambuddy': '/workshop', '/bambuddy': '/workshop',
    '/apps/grafana': '/network', '/grafana': '/network', '/apps/status': '/system', '/status': '/system',
    '/apps/scan': '/scan', '/more': '/map', '/workshop': null, '/': null, '/print': null, '/scan': null,
  };
  for (const [path, to] of Object.entries(want)) assert.equal(redirectFor(path), to, path);
});

test('the menu markup matches the sections', () => {
  const html = readFileSync(new URL('../hub/static/index.html', import.meta.url), 'utf8');
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const pages = [...nav.matchAll(/data-page="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(pages, SITE.areas.map((a) => a.id), 'the five areas and nothing else: no More');
  assert.ok(nav.includes('class="rail-assistant" href="/assistant" data-link'), 'Assistant at the rail foot, in the shell (A4)');
  assert.ok(!/data-page="[^"]*"[^>]*>[^<]*<span class="nav-badge"/.test(nav));
});

// One home, step 6: the old addresses are retired, so every tool link is its gate name, whatever address the page has.
test('tool links are always the gate names', () => {
  for (const host of ['hub.rahe-home.duckdns.org', '10.0.0.80', 'pi', 'pi.tailfa018e.ts.net', '']) {
    assert.equal(toolUrl('paperless', host), 'https://paperless.rahe-home.duckdns.org/');
    assert.equal(toolUrl('bambuddy', host), 'https://bambuddy.rahe-home.duckdns.org/');
    assert.equal(toolUrl('scan', host), 'https://scan.rahe-home.duckdns.org/');
    assert.equal(toolUrl('pi', host), 'https://pi.rahe-home.duckdns.org/');
  }
});

test('server links name a tool, and the page resolves it to the gate', () => {
  assert.equal(resolveLink('tool:paperless/documents/42/details', '10.0.0.80'), 'https://paperless.rahe-home.duckdns.org/documents/42/details');
  assert.equal(resolveLink('tool:assistant', '10.0.0.80'), '/assistant', 'the Assistant opens in the shell (A4)');
  assert.equal(resolveLink('/workshop', '10.0.0.80'), '/workshop');
});

test('assistantHref carries the page and its facts to /assistant in the shell (A4)', () => {
  assert.equal(assistantHref('hub.rahe-home.duckdns.org', 'Workshop', 'Printing, 40% · done 3:10 PM'),
    '/assistant?context=' + encodeURIComponent('Pi Hub › Workshop: Printing, 40% · done 3:10 PM'));
  assert.equal(assistantHref('10.0.0.80', 'Home'), '/assistant?context=' + encodeURIComponent('Pi Hub › Home'));
});

test('assistantHref keeps the context to 300 characters', () => {
  const ctx = decodeURIComponent(assistantHref('hub.rahe-home.duckdns.org', 'System', 'x'.repeat(1000)).split('context=')[1]);
  assert.equal(ctx.length, 300);
  assert.ok(ctx.endsWith('…'));
});

test('assistantHref never sends "undefined" and collapses whitespace', () => {
  assert.ok(!assistantHref('hub.rahe-home.duckdns.org', 'Media', undefined).includes('undefined'));
  assert.equal(decodeURIComponent(assistantHref('hub.rahe-home.duckdns.org', 'Home', ' Two\n things  ').split('context=')[1]), 'Pi Hub › Home: Two things');
});

test('assistantButton: pc_off when the PC is off, assistant_down when only Local AI is down, unknown stays enabled', () => {
  const on = { label: 'Assistant', phrase: '', disabled: false };
  assert.deepEqual(assistantButton('Down', 'off'), { label: 'The PC is asleep', phrase: 'pc_off', disabled: true });
  assert.deepEqual(assistantButton('Unknown', 'off'), { label: 'The PC is asleep', phrase: 'pc_off', disabled: true });
  assert.deepEqual(assistantButton('Down', 'on'), { label: "The Assistant isn't answering", phrase: 'assistant_down', disabled: true });
  assert.deepEqual(assistantButton('Down', 'unknown'), { label: "The Assistant isn't answering", phrase: 'assistant_down', disabled: true });
  assert.deepEqual(assistantButton('Down'), { label: "The Assistant isn't answering", phrase: 'assistant_down', disabled: true });
  assert.deepEqual(assistantButton('Unknown', 'unknown'), on);
  assert.deepEqual(assistantButton('Ready', 'on'), on);
  assert.deepEqual(assistantButton(undefined), on);
});

test('assistantHref never cuts an emoji in half', () => {
  // A lone surrogate makes encodeURIComponent throw, so the button would stop working on that page.
  const facts = 'x'.repeat(283) + '😀 more facts after the cut';  // the emoji straddles the 299th unit
  const href = assistantHref('hub.rahe-home.duckdns.org', 'Home', facts);
  const ctx = decodeURIComponent(href.split('context=')[1]);
  assert.ok(ctx.length <= 300 && ctx.endsWith('…'));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(ctx));
});

test('the Assistant state is checked again when the page comes back into view', async () => {
  const fs = await import('node:fs');
  const main = fs.readFileSync(new URL('../hub/static/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /addEventListener\("visibilitychange", \(\) => \{ if \(!document\.hidden\) checkAssistant\(\); \}\)/);
});

test('a print row links the hub\'s own /lab page on the experiment', async () => {
  const { printLabUrl } = await import('../hub/static/js/sections.js');
  assert.equal(printLabUrl('E-022'), '/lab?e=E-022');
  assert.equal(printLabUrl('E-023'), '/lab?e=E-023');
});

// Real names (docs/superpowers/specs/2026-11-01-real-names-design.md): a hub opened on the real name links to the tools
// on it, so a tool's sign-in hand-back stays on one suffix.
test('tool links follow a hub opened on the real name', () => {
  assert.equal(toolUrl('bambuddy', 'hub.rahe-home.duckdns.org'), 'https://bambuddy.rahe-home.duckdns.org/');
  assert.equal(toolUrl('scan', 'hub.rahe-home.duckdns.org:443'), 'https://scan.rahe-home.duckdns.org/');
  assert.equal(toolUrl('bambuddy', 'evilrahe-home.duckdns.org'), 'https://bambuddy.rahe-home.duckdns.org/');
});

test("a PC record of off doesn't disable an Assistant that answers", () => {
  assert.equal(assistantButton("Ready", "off").disabled, false);
  assert.equal(assistantButton("Busy", "off").disabled, false);
  assert.equal(assistantButton("Unknown", "off").phrase, "pc_off");
});
