// A deploy reaches a page that is already open (shell-update.js): serves a copy of hub/static through preview.py, swaps
// sw.js to a new SHELL while the page stays open, and checks in Chromium that coming back to the page fetches the new
// worker; that a page holding typed text is left alone; that the next in-app link is a full load; that a return with
// nothing typed reloads; and that the first install reloads nothing. Its own preview, with no live hub behind it (every
// /api answer is 502), on a port of its own.
// Usage (from the Mac): node tests/browser/shell-update.mjs [port]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.argv[2] || 8797);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO = new URL('../../', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'pi-hub-shell-'));
const STATIC = join(root, 'static');
cpSync(join(REPO, 'hub/static'), STATIC, { recursive: true });
const SW = join(STATIC, 'sw.js');
const bump = () => {
  const s = readFileSync(SW, 'utf8');
  const v = Number(/pi-hub-shell-v(\d+)/.exec(s)[1]);
  writeFileSync(SW, s.replace(`pi-hub-shell-v${v}`, `pi-hub-shell-v${v + 1}`));
};

const server = spawn('python3', [join(REPO, 'tests/browser/preview.py'), '--port', String(PORT), '--static', STATIC, '--upstream', 'http://127.0.0.1:9'],
  { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => { server.stdout.once('data', ok); server.once('exit', () => fail(new Error('preview.py exited'))); });

const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // Marks this document; a full load loses it. Counts controllerchange as the page sees it.
  const mark = () => page.evaluate(() => {
    window.__same = true; window.__changes = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => { window.__changes++; });
  });
  const same = () => page.evaluate(() => window.__same === true);
  const back = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));  // the page is visible
  const typeDraft = () => page.evaluate(() => {
    const t = document.createElement('textarea');
    t.id = 'draft';
    document.getElementById('view').append(t);
    t.value = 'A typed answer';
  });

  // First install: no controller at load, then the worker claims the page. Nothing reloads; links stay in-app.
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await mark();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  await back();
  await page.waitForTimeout(500);
  check(await same(), 'the first install reloaded the page');
  await page.click('.rail a[data-page="workshop"]');
  await page.waitForFunction(() => location.pathname === '/workshop');
  check(await same(), 'after the first install, an in-app link did a full load');

  // A page that loaded with a controller (the phone's case). A deploy lands while it's open.
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await mark();
  bump();
  await back();
  await page.waitForFunction(() => window.__changes > 0, null, { timeout: 15000 }).catch(() => problems.push('coming back did not fetch the new worker'));
  check(await same(), 'the new worker reloaded the page under the person');
  await typeDraft();
  await back();
  await page.waitForTimeout(500);
  check(await same(), 'coming back reloaded a page holding typed text');
  check(await page.evaluate(() => document.getElementById('draft')?.value) === 'A typed answer', 'the typed text was lost');
  await Promise.all([page.waitForEvent('load', { timeout: 5000 }).catch(() => null), page.click('.rail a[data-page="workshop"]')]);
  check(!(await same()), 'an out-of-date page navigated in-app instead of a full load');
  check(new URL(page.url()).pathname === '/workshop', `the full load went to ${page.url()}, not /workshop`);

  // Another deploy; nothing typed: the next return reloads.
  await mark();
  bump();
  await back();
  await page.waitForFunction(() => window.__changes > 0, null, { timeout: 15000 }).catch(() => problems.push('the second deploy was not fetched'));
  await Promise.all([page.waitForEvent('load', { timeout: 5000 }).catch(() => null), back()]);
  check(!(await page.evaluate(() => window.__same === true).catch(() => false)), 'coming back with nothing typed did not reload');
} finally {
  await browser.close();
  server.kill();
  rmSync(root, { recursive: true, force: true });
}

if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log('shell update: first install, typed text, in-app link and return all behave');
