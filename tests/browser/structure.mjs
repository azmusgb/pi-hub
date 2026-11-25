// One home step 2 browser check: each section at phone and desktop sizes, light and dark. Fails on serious or
// critical axe findings, a wrong active tab, a bottom bar covering the last card, or a badged Assistant button.
// Usage (from the Mac): cd tests/browser && npm install && npx playwright install chromium && node structure.mjs http://10.0.0.80
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://10.0.0.80';
const OUT = new URL('./out/', import.meta.url).pathname;
// The wall (kiosk) has no menu or Assistant button: only its contrast and fit are checked (wall.mjs checks each screen size).
const WALL = '/wall';
// Each page and the area its tab lights (A22 step 12: five areas; Scan and the Site map are pages of theirs).
const PAGES = { '/wall': 'wall', '/': 'home', '/workshop': 'workshop', '/media': 'household', '/documents': 'household', '/scan': 'household',
  '/devices': 'network', '/network': 'network', '/system': 'system', '/settings': 'system', '/map': 'system' };
const shot = (path) => path.replace(/\W/g, '') || 'home';
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
      const current = await page.$$eval('.ui-rail [data-area][aria-current="page"]', (a) => a.map((x) => x.dataset.area));
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
        await page.screenshot({ path: `${OUT}${shot(path)}-${width}-${colorScheme}.png` }); continue;
      }
      // The header's controls (Search, the Assistant) and the footer line up with the content's right edge: the head is
      // the kit's full-width bar, so it is its last control that is measured.
      if (width >= 861) {
        // Each edge is where its content stops: a box's right edge less its own right padding.
        const edges = await page.evaluate(() => [...[...document.querySelectorAll('.top > *')].filter((e) => e.checkVisibility()).slice(-1).map((e) => e.getBoundingClientRect().right),
          ...['#view', '.foot'].map((s) => document.querySelector(s).getBoundingClientRect().right - parseFloat(getComputedStyle(document.querySelector(s)).paddingRight))].map(Math.round));
        if (Math.max(...edges) - Math.min(...edges) > 2) problems.push(`${where}: header, content and footer end at ${edges.join(', ')}`);
      }
      // The Assistant has one persistent entry on every width: the head's button, never badged, and no second one in the nav.
      const assistant = page.locator('.top-assistant');
      if (!(await assistant.isVisible())) problems.push(`${where}: Assistant not visible`);
      if (await assistant.locator('.ui-rail-badge').count()) problems.push(`${where}: Assistant has a badge`);
      if (await page.locator('.ui-rail a[href="/assistant"]').count()) problems.push(`${where}: a second Assistant entry in the nav`);
      if (width < 861) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);
        const covered = await page.evaluate(() => {
          const bar = document.querySelector('.ui-rail').getBoundingClientRect();
          const last = [...document.querySelectorAll('main section, main .home-card')].filter((e) => e.checkVisibility()).at(-1);  // not inside a closed "Show all"
          return last ? last.getBoundingClientRect().bottom > bar.top + 1 : false;
        });
        if (covered) problems.push(`${where}: the bottom bar covers the last section`);
      }
      await page.screenshot({ path: `${OUT}${shot(path)}-${width}-${colorScheme}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : `All ${Object.keys(PAGES).length * 4} views pass.`);
process.exit(problems.length ? 1 : 0);
