// Tab bar badges: on each phone width, light, dark and forced colours, a badge on a tab ("Print" on Workshop, a count on
// Home) can be seen and sits beside the tab's icon and above its name, inside its own tab, never over the icon or the
// name. The badge is built as navigation.js render() builds it.
// Usage (from the Mac): node tests/browser/tabbar.mjs [base-url], e.g. against python3 tests/browser/preview.py
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const WIDTHS = [320, 360, 390, 430, 600, 860];
const CASES = [{ workshop: 'Print', home: '3' }, { home: '12' }, { home: '99+' }];
const LOOKS = [{ colorScheme: 'light' }, { colorScheme: 'dark' }, { colorScheme: 'dark', forcedColors: 'active' }];

const problems = [];
const browser = await chromium.launch();
for (const look of LOOKS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...look });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('.rail a[data-page="workshop"]');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    for (const badges of CASES) {
      const found = await page.evaluate((badges) => {
        const out = [];
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        for (const tab of document.querySelectorAll('.rail a[data-page]')) tab.querySelector('.nav-badge')?.remove();
        for (const [key, text] of Object.entries(badges)) {
          const tab = document.querySelector(`.rail a[data-page="${key}"]`);
          const badge = Object.assign(document.createElement('span'), { className: 'nav-badge', textContent: text });
          badge.setAttribute('aria-hidden', 'true');
          if (/^\d+\+?$/.test(text)) badge.setAttribute('data-count', '');
          if (text === '99+') badge.setAttribute('data-short', '9+');
          tab.append(badge);
          const r = badge.getBoundingClientRect();
          const t = tab.getBoundingClientRect();
          const bg = getComputedStyle(badge).backgroundColor;
          if (r.width < 6 || r.height < 6 || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') out.push(`${key}: "${text}" can't be seen`);
          if (badge.scrollWidth > badge.clientWidth + 1 && badge.hasAttribute('data-count')) out.push(`${key}: "${text}" is cut off`);
          if (hit(r, tab.querySelector('svg').getBoundingClientRect())) out.push(`${key}: "${text}" covers the icon`);
          if (hit(r, tab.querySelector('span:not(.nav-badge)').getBoundingClientRect())) out.push(`${key}: "${text}" covers the name`);
          if (r.left < t.left || r.right > t.right) out.push(`${key}: "${text}" leaves its tab`);
        }
        return out;
      }, badges);
      const where = `${width} ${look.forcedColors ? 'forced colours' : look.colorScheme}`;
      problems.push(...found.map((p) => `${where}: ${p}`));
    }
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? [...new Set(problems)].join('\n') : `Tab bar badges clear at ${WIDTHS.join(', ')}, light, dark and forced colours.`);
process.exit(problems.length ? 1 : 0);
