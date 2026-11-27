// A35 M1b step H7 browser check (plan 2026-11-25-a35-m1b-pi-side, H7 evidence; spec 17.10): /missions and
// /missions/a34 (Overview, Decisions, Evidence) at 320, 390, 820, 1366 and 1920 px, light and dark. Fails on horizontal
// overflow, a serious or critical axe finding, a page error, or a console error. Then, keyboard only at 1366 px: Tab
// reaches Accept revision 1 with a visible focus ring, Enter records it (answered here, never by the hub), and the
// tab strip answers the arrow keys; and the states the fixture can't show on its own: empty, can't be read, not the
// owner, the hub going silent after a good read (live turns into "Last known"), and the relabel timer.
// Screenshots go to $OUT_DIR (default tests/browser/out/).
// Usage (from the Mac): cd tests/browser && npm install
//   python3 preview.py --fixture fixtures/missions &
//   node missions.mjs [base-url]
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8799').replace(/\/$/, '');
const OUT = process.env.OUT_DIR ? process.env.OUT_DIR.replace(/\/?$/, '/') : new URL('./out/', import.meta.url).pathname;
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/missions/${name}.json`, import.meta.url), 'utf8'));
const WIDTHS = [[320, 700], [390, 844], [820, 1000], [1366, 900], [1920, 1080]];
const PAGES = [['list', '/missions'], ['overview', '/missions/a34'], ['decisions', '/missions/a34?tab=decisions'], ['evidence', '/missions/a34?tab=evidence']];
mkdirSync(OUT, { recursive: true });

const problems = [];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const settled = (page) => page.waitForFunction(() => { const p = document.querySelector('#view .page'); return p && p.getAttribute('aria-busy') === 'false'; }, null, { timeout: 15000 })
  // axe samples colours, and a page that is still fading in (the router's reveal) reads as low contrast: wait for every
  // animation that ends (the shell's "Page checked" pulse never does).
  .then(() => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.effect.getComputedTiming().iterations === Infinity), null, { timeout: 15000 }))
  .then(() => page.waitForTimeout(150));
const text = (page) => page.evaluate(() => document.querySelector('#view').innerText);

async function visit(page, path, where) {
  await page.goto(BASE + path, { waitUntil: 'load' });
  await settled(page);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (wide > 1) problems.push(`${where}: ${wide} px of horizontal overflow`);
  const axe = await new AxeBuilder({ page }).exclude('.house-cam-img').analyze();
  for (const v of axe.violations.filter((x) => ['serious', 'critical'].includes(x.impact))) problems.push(`${where}: axe ${v.id} (${v.nodes.length})`);
}

const browser = await chromium.launch();
const newPage = async (width, height, colorScheme) => {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const where = () => `${width} ${colorScheme}`;
  page.on('pageerror', (e) => problems.push(`${where()}: page error ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) problems.push(`${where()}: console ${m.text()}`); });
  return { ctx, page };
};

// 1. Every page, every width, both themes.
for (const [width, height] of WIDTHS) {
  for (const colorScheme of ['light', 'dark']) {
    const { ctx, page } = await newPage(width, height, colorScheme);
    for (const [name, path] of PAGES) {
      await visit(page, path, `${name} ${width} ${colorScheme}`);
      await page.screenshot({ path: `${OUT}${name}-${width}-${colorScheme}.png`, fullPage: true });
    }
    await ctx.close();
  }
}

// 2. Keyboard only: reach Accept, record it, then the tabs.
{
  const { ctx, page } = await newPage(1366, 900, 'light');
  let accepted = false;
  const posts = [];
  await page.route('**/api/missions/a34/owner', (route) => {
    posts.push(route.request().postDataJSON());
    accepted = true;
    return json(route, { ok: true, changed: true, revision: { n: 1, status: 'accepted' }, seq: 32 });
  });
  await page.route(/\/api\/missions\/a34\?view=overview/, (route) => {
    const o = fixture('missions/a34');
    if (!accepted) return json(route, o);
    return json(route, { ...o, seq: 32, initiative: { ...o.initiative, status: 'active' }, revision: { ...o.revision, status: 'accepted' }, proposed: [] });
  });
  await page.route('**/api/missions/a34/changes*', (route) => json(route, { ...fixture('missions/a34/changes'), seq: accepted ? 32 : 31, views: accepted ? ['overview', 'evidence'] : [] }));
  await visit(page, '/missions/a34', 'keyboard');
  await page.screenshot({ path: `${OUT}accept-before-1366-light.png`, fullPage: true });
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => /^Accept revision 1/.test(document.activeElement?.textContent || ''));
  }
  if (!reached) problems.push('keyboard: Tab never reached "Accept revision 1"');
  else {
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { w: parseFloat(s.outlineWidth), style: s.outlineStyle }; });
    if (!(ring.w >= 2 && ring.style !== 'none')) problems.push(`keyboard: no visible focus ring on Accept (${JSON.stringify(ring)})`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    if (JSON.stringify(posts) !== JSON.stringify([{ verb: 'revision.accept', revision: 1 }])) problems.push(`keyboard: posted ${JSON.stringify(posts)}`);
    if (await page.locator('.ui-btn--primary', { hasText: 'Accept revision' }).count()) problems.push('keyboard: Accept is still offered after it was recorded');
    await page.screenshot({ path: `${OUT}accept-after-1366-light.png`, fullPage: true });
  }
  await page.locator('#mission-tab-overview').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => document.activeElement?.dataset?.tab) !== 'decisions') problems.push('keyboard: ArrowRight did not move to the Decisions tab');
  if (!page.url().endsWith('?tab=decisions')) problems.push(`keyboard: the tab is not in the address (${page.url()})`);
  await page.keyboard.press('Tab');
  const inGroup = await page.evaluate(() => !!document.activeElement?.closest('.ui-decisions, .mission-answered, #mission-panel'));
  if (!inGroup) problems.push('keyboard: Tab from the tab strip does not enter the panel');
  await ctx.close();
}

// 3. States.
for (const colorScheme of ['light', 'dark']) {
  const { ctx, page } = await newPage(390, 844, colorScheme);
  const shot = (name) => page.screenshot({ path: `${OUT}${name}-390-${colorScheme}.png`, fullPage: true });
  const expect = async (name, re) => { if (!re.test(await text(page))) problems.push(`${name} ${colorScheme}: expected ${re}`); };
  const empty = { ...fixture('missions'), missions: [] };
  await page.route('**/api/missions', (route) => json(route, empty));
  await visit(page, '/missions', `empty ${colorScheme}`);
  await expect('empty', /No missions yet/);
  await shot('state-list-empty');
  await page.unroute('**/api/missions');
  for (const [name, status, re] of [['unavailable', 503, /Missions can't be read[\s\S]*ledger can't be read/], ['refused', 403, /Missions can't be read[\s\S]*Sign in as the owner/]]) {
    await page.route('**/api/missions', (route) => json(route, { detail: 'No.' }, status));
    await visit(page, '/missions', `${name} ${colorScheme}`);
    await expect(`list ${name}`, re);
    await shot(`state-list-${name}`);
    await page.unroute('**/api/missions');
  }
  await page.route(/\/api\/missions\/a34\?view=overview/, (route) => json(route, { detail: 'No.' }, 503));
  await visit(page, '/missions/a34', `mission unavailable ${colorScheme}`);
  await expect('mission unavailable', /This mission can't be read/);
  await shot('state-mission-unavailable');
  await page.unroute(/\/api\/missions\/a34\?view=overview/);
  // The hub goes silent after a good read: the page keeps what it had, says how old, and nothing stays "Live".
  let silent = false;
  await page.route('**/api/missions/a34/changes*', (route) => (silent ? route.abort() : json(route, fixture('missions/a34/changes'))));
  await visit(page, '/missions/a34', `silent ${colorScheme}`);
  await expect('live before', /Working\s*Live/);
  silent = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => /Couldn.t refresh/.test(document.querySelector('#view').innerText), null, { timeout: 40000 }).catch(() => problems.push(`silent ${colorScheme}: no "Couldn't refresh" notice`));
  const after = await text(page);
  if (/Working\s*Live/.test(after)) problems.push(`silent ${colorScheme}: still Live after the hub went silent`);
  if (!/Last known/.test(after)) problems.push(`silent ${colorScheme}: no "Last known" label`);
  if (!(await page.locator('button', { hasText: 'Accept revision 1' }).first().isDisabled())) problems.push(`silent ${colorScheme}: Accept is enabled with the hub silent`);
  await shot('state-mission-silent');
  await ctx.close();
}

// 4. The relabel timer, in a real page: a session last heard 20 s before the read turns into "No report since" by itself.
{
  const { ctx, page } = await newPage(1366, 900, 'light');
  // The hub's clock moves between polls (the fixture's does not): its as_of advances, the session's last report doesn't.
  const t0 = Date.now(), c = fixture('missions/a34/changes');
  await page.route('**/api/missions/a34/changes*', (route) => json(route, { ...c, as_of: new Date(Date.parse(c.as_of) + Date.now() - t0).toISOString() }));
  await visit(page, '/missions/a34', 'timer');
  if (!/Working\s*Live/.test(await text(page))) problems.push('timer: not Live at first');
  await page.waitForFunction(() => /No report since \d\d:\d\d/.test(document.querySelector('#view').innerText), null, { timeout: 130000, polling: 1000 })
    .catch(() => problems.push('timer: Live never turned into "No report since" without a new read'));
  await page.screenshot({ path: `${OUT}state-mission-no-report-1366-light.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`missions.mjs: ${WIDTHS.length * 2 * PAGES.length} page views, the keyboard walk and the states are clean; screenshots in ${OUT}`);
