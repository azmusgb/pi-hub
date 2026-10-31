// One home step 2 browser check: each section at phone and desktop sizes, light and dark. Fails on serious or
// critical axe findings, a wrong active tab, a bottom bar covering the last card, or a badged Assistant button.
// Usage (from the Mac): cd tests/browser && npm install && npx playwright install chromium && node structure.mjs http://10.0.0.30
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://10.0.0.30';
const OUT = new URL('./out/', import.meta.url).pathname;
// The wall (kiosk) has no menu or Assistant button: only its contrast and fit are checked (wall.mjs checks each screen size).
const WALL = '/wall';
const PAGES = { '/wall': 'wall', '/': 'home', '/workshop': 'workshop', '/documents': 'documents', '/media': 'media', '/network': 'network', '/system': 'system' };
mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch();
for (const [width, height] of [[390, 844], [1440, 900]]) {
  for (const colorScheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme });
    const page = await ctx.newPage();
    for (const [path, key] of Object.entries(PAGES)) {
      const where = `${path} ${width} ${colorScheme}`;
      // 'load', not 'networkidle': the shell keeps an EventSource on /api/records/stream open, so the network is never idle.
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      const current = await page.$$eval('.rail [data-page][aria-current="page"]', (a) => a.map((x) => x.dataset.page));
      if (path !== WALL && !current.includes(key)) problems.push(`${where}: active tab ${current} (want ${key})`);
      const axe = await new AxeBuilder({ page }).exclude('.house-cam-img').analyze();
      for (const v of axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))) {
        problems.push(`${where}: axe ${v.id} (${v.nodes.length})`);
      }
      if (path === WALL) {
        // Wide screens: the wall's cards use the whole width, not a narrow column beside an empty one.
        if (width >= 1200) {
          const used = await page.evaluate(() => {
            const head = document.querySelector('.wall-head').getBoundingClientRect();
            const tiles = ['.wall-needs', '.wall-print', '.wall-house'].map((q) => document.querySelector(q).getBoundingClientRect());
            return (Math.max(...tiles.map((r) => r.right)) - Math.min(...tiles.map((r) => r.left))) / head.width;
          });
          if (used < 0.9) problems.push(`${where}: the wall's cards use ${Math.round(used * 100)}% of its width`);
        }
        await page.screenshot({ path: `${OUT}${key}-${width}-${colorScheme}.png` }); continue;
      }
      // The header (with the clock) and the footer line up with the content's right edge.
      if (width >= 861) {
        const edges = await page.evaluate(() => ['.top', '#view', '.foot'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().right)));
        if (Math.max(...edges) - Math.min(...edges) > 2) problems.push(`${where}: header, content and footer end at ${edges.join(', ')}`);
      }
      const assistant = page.locator(width < 861 ? '.top-assistant' : '.rail-assistant');
      if (!(await assistant.isVisible())) problems.push(`${where}: Assistant not visible`);
      if (await assistant.locator('.nav-badge').count()) problems.push(`${where}: Assistant has a badge`);
      if (width < 861) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);
        const covered = await page.evaluate(() => {
          const bar = document.querySelector('.rail').getBoundingClientRect();
          const last = [...document.querySelectorAll('main section, main .home-card')].filter((e) => e.checkVisibility()).at(-1);  // not inside a closed "Show all"
          return last ? last.getBoundingClientRect().bottom > bar.top + 1 : false;
        });
        if (covered) problems.push(`${where}: the bottom bar covers the last section`);
      }
      await page.screenshot({ path: `${OUT}${key}-${width}-${colorScheme}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : `All ${Object.keys(PAGES).length * 4} views pass.`);
process.exit(problems.length ? 1 : 0);
