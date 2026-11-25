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
    if (afterTab.inNav) bad(`one Tab from the first link stays in the nav (on "${afterTab.what}"): the links are all tab stops, not one (needs kit 2.31.0 sync: roving tabindex)`);

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

// Nothing collides with the tab bar or the sticky head, at 320 to 430 px and at 200% text: a badge never meets the icon
// or the label; a focused Ask link, Needs you action or field never intersects the bar or the head (boxes, not only
// "inside the container").
const hit = '(a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom';
for (const width of [320, 360, 390, 430]) {
  for (const colorScheme of ['light', 'dark']) {
    for (const scale of ['100%', '200%']) {
      const where = `${width}x844 ${colorScheme} text ${scale}`;
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      for (const path of ['/', '/documents']) {
        await page.goto(BASE + path, { waitUntil: 'load' });
        await page.waitForSelector('.ui-rail a[data-area]');
        await page.waitForTimeout(1800);
        await page.evaluate((scale) => { document.documentElement.style.fontSize = scale; }, scale);
        // The real badges (navigation.js): a count of two digits and the print dot, then 99+.
        for (const needs of [{ count: 12 }, { count: 120 }, null]) {
          await page.evaluate(async (needs) => { const nav = await import('/static/js/navigation.js'); nav.setNeeds(needs); }, needs);
          const bad1 = await page.evaluate((hitSrc) => {
            const hit = eval(hitSrc);
            const out = [];
            for (const b of document.querySelectorAll('.ui-rail-badge')) {
              const tab = b.closest('a[data-area]'), r = b.getBoundingClientRect();
              if (r.width === 0) continue;
              if (hit(r, tab.querySelector('svg').getBoundingClientRect())) out.push(`${tab.dataset.area} badge "${b.textContent}" meets its icon`);
              if (hit(r, tab.querySelector('.ui-rail-label').getBoundingClientRect())) out.push(`${tab.dataset.area} badge "${b.textContent}" meets its label`);
            }
            return out;
          }, hit);
          for (const m of bad1) problems.push(`${where} ${path}: ${m}`);
        }
        // Focus brings each into view; none ends under the bar or the head.
        const sel = path === '/' ? ['[data-ask-assistant]', '.hd-needs a, .hd-needs button', '.hd-rack a'] : ['main input:not([type=hidden]):not([type=checkbox]):not([type=radio])'];
        for (const q of sel) {
          const els = page.locator(q);
          const n = Math.min(await els.count(), 3);
          for (let i = 0; i < n; i++) {
            const el = els.nth(i);
            if (!(await el.isVisible())) continue;
            await el.focus();
            await page.waitForTimeout(150);
            const r = await page.evaluate(([hitSrc]) => {
              const hit = eval(hitSrc), e = document.activeElement.getBoundingClientRect();
              const bar = document.querySelector('.ui-rail').getBoundingClientRect(), head = document.querySelector('.ui-shell-head').getBoundingClientRect();
              return { bar: hit(e, bar), head: hit(e, head), tall: e.height > innerHeight - bar.height - head.height };
            }, [hit]);
            if (r.tall) continue;
            if (r.bar) problems.push(`${where} ${path}: focused ${q} #${i} is under the tab bar`);
            if (r.head) problems.push(`${where} ${path}: focused ${q} #${i} is under the sticky head`);
          }
        }
      }
      await ctx.close();
    }
  }
}

// Page navigation semantics: the nav is a named landmark; the current link says so; a route change moves focus to the
// page and updates the title and the heading; Back and Forward keep the current area right.
for (const [width, height] of SIZES) {
  const where = `${width}x${height} semantics`;
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('.ui-rail a[data-area]');
  await page.waitForTimeout(1500);
  const lm = await page.$$eval('nav[aria-label]', (n) => n.map((x) => x.getAttribute('aria-label')));
  if (!lm.some((l) => l.trim())) problems.push(`${where}: no navigation landmark with a name`);
  const cur = async () => page.$$eval('.ui-rail a[aria-current="page"]', (a) => a.map((x) => x.dataset.area).join());
  if (await cur() !== 'home') problems.push(`${where}: Home is not marked current at /`);
  const title0 = await page.title();
  await page.click('.ui-rail a[data-area="workshop"]');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ path: location.pathname, title: document.title, h1: document.querySelector('#page-title').textContent, focus: document.activeElement?.id || document.activeElement?.tagName }));
  if (after.path !== '/workshop') problems.push(`${where}: the Workshop link went to ${after.path}`);
  if (after.title === title0 || !/Printer|Workshop/.test(after.title)) problems.push(`${where}: the title is "${after.title}" after the route change`);
  if (!/Printer|Workshop/.test(after.h1)) problems.push(`${where}: the heading is "${after.h1}"`);
  if (after.focus !== 'view') problems.push(`${where}: focus is on ${after.focus} after the route change, not the page`);
  if (await cur() !== 'workshop') problems.push(`${where}: Workshop not current after the click (${await cur()})`);
  await page.click('.ui-rail a[data-area="system"]');
  await page.waitForTimeout(1200);
  await page.goBack();
  await page.waitForTimeout(1200);
  if (await cur() !== 'workshop') problems.push(`${where}: after Back the current area is "${await cur()}", want workshop`);
  await page.goBack();
  await page.waitForTimeout(1200);
  if (await cur() !== 'home') problems.push(`${where}: after Back twice the current area is "${await cur()}", want home`);
  await page.goForward();
  await page.waitForTimeout(1200);
  if (await cur() !== 'workshop') problems.push(`${where}: after Forward the current area is "${await cur()}", want workshop`);
  if (!/Printer|Workshop/.test(await page.title())) problems.push(`${where}: the title after Forward is "${await page.title()}"`);
}
await browser.close();
console.log(problems.length ? problems.join('\n') : `Shell: keys, scrolling, keyboard inset, Assistant and 200% text pass at ${SIZES.map((s) => s.join('x')).join(' and ')}, light and dark.`);
process.exit(problems.length ? 1 : 0);
