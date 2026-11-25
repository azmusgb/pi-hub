// The kit's nav as a tab bar (ui-rail, drawn by navigation.js): on each phone width, light, dark and forced colours, a
// badge on a tab (a dot for a print, a count on Home, a "?" for a read that failed) can be seen and sits inside its own
// tab, never over the icon or the name. The badges are made by navigation.js itself (its setNeeds and updateNavigation,
// with /api/now answered by the check), not by a copy of its markup. And the five labels (A22 9.1 F6): at each width and
// at Standard, Large, Larger and 200% text, every label is whole (not cut, not broken mid-word), inside its own tab and
// clear of the next one, and the page does not scroll sideways.
// Usage (from the Mac): node tests/browser/tabbar.mjs [base-url], e.g. against python3 tests/browser/preview.py
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const WIDTHS = [320, 360, 390, 430, 600, 860];
// What each case asks of the real code: Home's needs (null: the read failed), and whether a print is running.
const CASES = [{ needs: { count: 3 }, print: true }, { needs: { count: 12 } }, { needs: { count: 120 } }, { needs: null }];
const TEXT = [1, 1.15, 1.3, 2];  // A14's sizes (the kit's root curve times the scale), and 200%
const LOOKS = [{ colorScheme: 'light' }, { colorScheme: 'dark' }, { colorScheme: 'dark', forcedColors: 'active' }];

const problems = [];
const browser = await chromium.launch();
for (const look of LOOKS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...look });
  const page = await ctx.newPage();
  await page.route('**/api/now', async (route) => {
    try {
      const r = await route.fetch();
      const body = await r.json().catch(() => ({}));
      await route.fulfill({ response: r, json: { ...body, printer: { ...(body.printer || {}), state: page.printing ? 'printing' : 'idle', progress: 42 } } });
    } catch { /* the page closed with a read in flight */ }
  });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('.ui-rail a[data-area="workshop"]');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    for (const scale of TEXT) {
      const found = await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `calc(clamp(100%, 0.9423rem + 0.2564vw, 125%) * ${scale})`;
        const tabs = [...document.querySelectorAll('.ui-rail a[data-area]')];
        const out = [];
        if (tabs.length !== 5) out.push(`${tabs.length} tabs, not five`);
        const spans = tabs.map((a) => a.querySelector('.ui-rail-label'));
        spans.forEach((s, i) => {
          const l = s.getBoundingClientRect(), t = tabs[i].getBoundingClientRect(), next = spans[i + 1]?.getBoundingClientRect();
          const cs = getComputedStyle(s), size = parseFloat(cs.fontSize);
          if (l.left < t.left - 0.5 || l.right > t.right + 0.5) out.push(`"${s.textContent}" leaves its tab (${Math.round(l.width)} of ${Math.round(t.width)} px)`);
          if (next && l.right > next.left - 2) out.push(`"${s.textContent}" meets the next label`);
          if (size < 11.95) out.push(`"${s.textContent}" is ${size.toFixed(1)} px, under 12`);
          // One line, or a word broken in two: a label wider than its tab wraps "anywhere" in the kit.
          const lines = Math.round(l.height / (parseFloat(cs.lineHeight) || size * 1.15));
          if (lines > 1) out.push(`"${s.textContent}" is broken over ${lines} lines`);
          if (s.scrollWidth > s.clientWidth + 1) out.push(`"${s.textContent}" is cut off`);
        });
        const root = document.documentElement;
        if (root.scrollWidth > root.clientWidth + 1) out.push(`the page scrolls sideways (${root.scrollWidth} in ${root.clientWidth} px)`);
        const bar = document.querySelector('.ui-rail').getBoundingClientRect();
        if (bar.bottom > innerHeight + 1 || bar.height > innerHeight / 2) out.push(`the bar is ${Math.round(bar.height)} px tall, bottom at ${Math.round(bar.bottom)} of ${innerHeight}`);
        document.documentElement.style.fontSize = '';
        return out;
      }, scale);
      problems.push(...found.map((p) => `${width} ${look.forcedColors ? 'forced colours' : look.colorScheme} text ×${scale}: ${p}`));
    }
    for (const c of CASES) {
      page.printing = !!c.print;
      // The real code: the print and the alerts through navigation.js's updateNavigation (the check answers /api/now),
      // then Home's own read through its setNeeds, as Home does after it loads.
      await page.evaluate(async ({ needs }) => {
        const nav = await import('/static/js/navigation.js');
        await nav.updateNavigation();
        nav.setNeeds(needs);
      }, c);
      const found = await page.evaluate(() => {
        const out = [];
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        for (const badge of document.querySelectorAll('.ui-rail-badge')) {
          const tab = badge.closest('a[data-area]'), key = tab.dataset.area;
          const r = badge.getBoundingClientRect(), t = tab.getBoundingClientRect();
          const bg = getComputedStyle(badge).backgroundColor;
          const name = `${key} "${badge.textContent || (badge.dataset.dot !== undefined ? 'dot' : '')}"`;
          if (r.width < 6 || r.height < 6 || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') out.push(`${name} can't be seen`);
          if (badge.scrollWidth > badge.clientWidth + 1 && badge.dataset.dot === undefined) out.push(`${name} is cut off`);
          if (hit(r, tab.querySelector('svg').getBoundingClientRect())) out.push(`${name} covers the icon`);
          if (hit(r, tab.querySelector('.ui-rail-label').getBoundingClientRect())) out.push(`${name} covers the name`);
          if (r.left < t.left || r.right > t.right) out.push(`${name} leaves its tab`);
          if (!badge.getAttribute('aria-label')) out.push(`${name} has no name for assistive tech`);
        }
        return out;
      });
      const where = `${width} ${look.forcedColors ? 'forced colours' : look.colorScheme}`;
      problems.push(...found.map((p) => `${where}: ${p}`));
      // A badge for each case is on the page (the check above is not run on nothing).
      const n = await page.locator('.ui-rail-badge').count();
      if (!n) problems.push(`${where}: no badge was drawn for ${JSON.stringify(c)}`);
    }
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await ctx.close();
}
await browser.close();
console.log(problems.length ? [...new Set(problems)].join('\n') : `Tab bar: five labels whole at text ×${TEXT.join(', ×')} and badges clear, at ${WIDTHS.join(', ')}, light, dark and forced colours.`);
process.exit(problems.length ? 1 : 0);
