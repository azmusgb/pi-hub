// The kit's shell as Pi Hub uses it (ui-shell; navigation.js draws the nav), at a phone and a laptop width, light and dark:
//  - the arrow keys, Home and End move between the nav's links, and Tab leaves the nav;
//  - the document scrolls (not an inner box): the head stays at the top and the tab bar (or the rail) stays put;
//  - a focused field is not covered by the tab bar, with the on-screen keyboard's height set as the kit sets it
//    (--ui-kb-inset; a headless browser has no keyboard, so the variable is set the way the kit's watcher does);
//  - the Assistant's one entry is the head's button; no area is marked on /assistant or an unknown address;
//  - text at 200% (the root's font size) scrolls nothing sideways on the Home and System pages.
// Usage (from the Mac): node tests/browser/shell-nav.mjs [base-url], e.g. against python3 tests/browser/preview.py
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:8799').replace(/\/$/, '');
const SIZES = [[390, 844], [1366, 900]];
const problems = [];
const browser = await chromium.launch();

for (const [width, height] of SIZES) {
  for (const colorScheme of ['light', 'dark']) {
    const where = `${width}x${height} ${colorScheme}`;
    const phone = width < 861;
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, hasTouch: phone, isMobile: phone });
    const page = await ctx.newPage();
    const bad = (msg) => problems.push(`${where}: ${msg}`);
    const focused = () => page.evaluate(() => document.activeElement?.dataset?.area || document.activeElement?.tagName || '');
    const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector('.ui-rail a[data-area]'); await page.waitForTimeout(1500); };

    // Keyboard on the nav.
    await go('/');
    const areas = await page.$$eval('.ui-rail a[data-area]', (a) => a.map((x) => x.dataset.area));
    if (areas.join() !== 'home,workshop,household,network,system') bad(`the nav's areas are ${areas}`);
    await page.focus('.ui-rail a[data-area="home"]');
    const seen = [];
    for (const key of ['ArrowDown', 'ArrowRight', 'End', 'ArrowRight', 'Home', 'ArrowUp', 'ArrowLeft']) { await page.keyboard.press(key); seen.push(await focused()); }
    // from home: Down -> workshop, Right -> household, End -> system, Right wraps -> home, Home -> home, Up wraps -> system, Left -> network
    if (seen.join() !== 'workshop,household,system,home,home,system,network') bad(`arrow keys went ${seen.join(' > ')}`);
    await page.focus('.ui-rail a[data-area="home"]');
    await page.keyboard.press('Tab');
    const afterTab = await page.evaluate(() => ({ inNav: !!document.activeElement?.closest('.ui-rail'), what: document.activeElement?.dataset?.area || document.activeElement?.className || document.activeElement?.tagName }));
    if (afterTab.inNav) bad(`one Tab from the first link stays in the nav (on "${afterTab.what}"): the links are all tab stops, not one`);

    // The document scrolls; the head and the bar stay.
    await go('/system');
    const geometry = () => page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { y: scrollY, tall: document.documentElement.scrollHeight > innerHeight + 50, head: r('.ui-shell-head').top, bar: r('.ui-rail'), vh: innerHeight,
        inner: [...document.querySelectorAll('.ui-shell, .ui-shell-stage, .ui-shell-main, #view, body')].filter((e) => e.scrollHeight > e.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).map((e) => e.className || e.tagName) };
    });
    const before = await geometry();
    if (!before.tall) bad('/system is not taller than the screen, so scrolling is not tested');
    await page.evaluate(() => scrollTo(0, 400));
    await page.waitForTimeout(300);
    const after = await geometry();
    if (after.y < 100) bad(`the document did not scroll (scrollY ${after.y})`);
    if (Math.abs(after.head) > 1) bad(`the head moved to ${after.head} px when the page scrolled`);
    if (phone && Math.abs(after.bar.bottom - after.vh) > 1) bad(`the tab bar's bottom is ${after.bar.bottom} of ${after.vh} after scrolling`);
    if (!phone && Math.abs(after.bar.top) > 1) bad(`the rail's top is ${after.bar.top} after scrolling`);
    if (after.inner.length) bad(`an inner scroller: ${after.inner.join(', ')}`);

    // A focused field is not under the tab bar, with the keyboard up.
    if (phone) {
      await go('/documents');
      const inset = 300;
      await page.evaluate((inset) => document.documentElement.style.setProperty('--ui-kb-inset', `${inset}px`), inset);
      const field = page.locator('main input:not([type=hidden]):not([type=checkbox]):not([type=radio])').first();
      if (!(await field.count())) bad('/documents has no field to focus');
      else {
        await field.scrollIntoViewIfNeeded();
        await field.focus();
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await field.focus();
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => {
          const f = document.activeElement.getBoundingClientRect(), bar = document.querySelector('.ui-rail').getBoundingClientRect();
          return { fieldBottom: f.bottom, barTop: bar.top, barBottom: bar.bottom, vh: innerHeight, last: document.documentElement.scrollHeight - scrollY - innerHeight };
        });
        if (Math.abs(r.barBottom - (r.vh - inset)) > 1) bad(`with the keyboard at ${inset} px the tab bar ends at ${r.barBottom}, not ${r.vh - inset}`);
        if (r.fieldBottom > r.barTop + 1) bad(`the focused field ends at ${r.fieldBottom}, under the tab bar (top ${r.barTop})`);
        // The page's end, scrolled to, is clear of the bar: the footer's last line is above it.
        const foot = await page.evaluate(() => { const el = document.querySelector('.foot'), f = el.getBoundingClientRect(), bar = document.querySelector('.ui-rail').getBoundingClientRect(); return f.bottom - parseFloat(getComputedStyle(el).paddingBottom) - bar.top; });
        if (foot > 1) bad(`the page's footer runs ${Math.round(foot)} px under the tab bar at the end of the page`);
      }
    }

    // The Assistant: one entry; no area marked on /assistant or an unknown address.
    for (const path of ['/assistant', '/no-such-page']) {
      await go(path);
      const marked = await page.$$eval('.ui-rail a[aria-current="page"]', (a) => a.map((x) => x.dataset.area));
      if (marked.length) bad(`${path} marks ${marked} in the nav`);
    }
    await go('/');
    if ((await page.locator('.top-assistant').count()) !== 1 || (await page.locator('.ui-rail a[href="/assistant"]').count())) bad('the Assistant has not exactly one persistent entry, the head\'s button');
    const asks = await page.locator('[data-ask-assistant]').count();
    if (asks !== 1) bad(`Home has ${asks} contextual Ask links, not one`);

    // Text at 200%: nothing scrolls sideways.
    for (const path of ['/', '/system', '/workshop']) {
      await go(path);
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => { const r = document.documentElement; return r.scrollWidth - r.clientWidth; });
      if (over > 1) bad(`${path} at 200% text scrolls sideways by ${over} px`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : `Shell: keys, scrolling, keyboard inset, Assistant and 200% text pass at ${SIZES.map((s) => s.join('x')).join(' and ')}, light and dark.`);
process.exit(problems.length ? 1 : 0);
