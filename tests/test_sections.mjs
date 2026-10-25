import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, sectionFor, redirectFor, phoneTabs, railItems, ASSISTANT_URL, toolUrl } from '../hub/static/js/sections.js';

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
