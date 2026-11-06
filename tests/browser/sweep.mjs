// Amendment A10 D6 (plan decision 8): every page from 320 to 2560 px in 20 px steps, dark and light. Fails on
// horizontal overflow, clipped text, text under 12 px (plan decision 12), a control under its 44 px touch target, or two
// marked labels overlapping, on any page not still PENDING its A10 PR. Writes out/sweep.json and screenshots at the named sizes for a person to look at.
// Usage (from the Mac): cd tests/browser && npm install
//   python3 preview.py &            (this checkout's pages, the live hub's data, read-only)
//   node sweep.mjs [base-url] [--pages /,/workshop] [--no-shots]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const BASE = (args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--pages') || 'http://127.0.0.1:8799').replace(/\/$/, '');
const OUT = new URL('./out/', import.meta.url).pathname;
const ALL = { '/': 'home', '/workshop': 'workshop', '/lab': 'lab', '/documents': 'documents', '/media': 'media', '/network': 'network', '/system': 'system' };
const PAGES = opt('--pages') ? Object.fromEntries(opt('--pages').split(',').map((p) => [p, ALL[p] || p.replace(/\W/g, '') || 'home'])) : ALL;
// Pages whose A10 PR hasn't merged: reported, not gated. Each area PR deletes its page; the last asserts it is empty.
// 'shell' (the rail, tab bar and page head on every page) is gated from P3.
const PENDING = new Set(['/documents', '/system']);
const SHOTS = [320, 390, 820, 1024, 1180, 1366, 1440, 1920, 2560];
// The 20 px steps, plus the named sizes that fall between them (390, 1024, 1366).
const WIDTHS = [...new Set([...Array.from({ length: (2560 - 320) / 20 + 1 }, (_, i) => 320 + i * 20), ...SHOTS])].sort((a, b) => a - b);
const TARGET = 44;
const SMALL = 12;  // decision 12: the kit's fs1 is 0.75rem, 12 px at its smallest
mkdirSync(OUT, { recursive: true });

// Runs in the page: every problem visible at this width, keyed by a short, stable path to the element.
function check({ TARGET, SMALL }) {
  const SHELL = '.rail, .top, .tabbar, .foot, .skip-link';
  const path = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 4; n = n.parentElement) {
      const cls = [...n.classList].filter((c) => !/^(is-|has-)/.test(c)).slice(0, 2).join('.');
      parts.unshift(n.id ? `#${n.id}` : cls ? `${n.tagName.toLowerCase()}.${cls}` : n.tagName.toLowerCase());
      if (n.id) break;
    }
    return parts.join(' > ');
  };
  const shown = (el) => {
    if (el.closest('[hidden], [aria-hidden="true"], .ui-skeleton, details:not([open]) > :not(summary)')) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0;
  };
  const out = [];
  const add = (kind, el, detail) => out.push({ kind, area: el && el.closest(SHELL) ? 'shell' : 'page', where: el ? path(el) : 'document', detail });

  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) {
    // The widest culprit: the element whose right edge is furthest past the window.
    let worst = null, edge = innerWidth + 1;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > edge && shown(el)) { edge = r.right; worst = el; }
    }
    add('overflow', worst, `${doc.scrollWidth} px wide in ${innerWidth}`);
  }

  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !shown(el)) continue;
    const s = getComputedStyle(el);
    const clips = /hidden|clip/.test(s.overflowX) || /hidden|clip/.test(s.overflow);
    if (!clips || el.scrollWidth <= el.clientWidth + 1) continue;
    const full = el.title || el.getAttribute('aria-label') || el.closest('[title]')?.title;
    if (s.textOverflow === 'ellipsis' && full) continue;
    add('clipped', el, `${el.scrollWidth} in ${el.clientWidth}${s.textOverflow === 'ellipsis' ? ', ellipsis without the full text' : ''}`);
  }

  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !shown(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < SMALL - 0.05) add('small', el, `${Math.round(size * 10) / 10} px`);
  }

  for (const el of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [tabindex="0"]')) {
    if (!shown(el)) continue;
    const s = getComputedStyle(el);
    // WCAG 2.5.8's inline exception: a link inside a sentence is sized by the line it sits in.
    if (el.tagName === 'A' && s.display === 'inline' && [...el.parentElement.childNodes].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim())) continue;
    // A checkbox or radio is 24 px by design (enhance.css): the label wrapping it is the target, so the label is measured.
    const box = /^(checkbox|radio)$/.test(el.type) && el.closest('label');
    const r = (box || el).getBoundingClientRect();
    if (r.width < TARGET - 0.5 || r.height < TARGET - 0.5) add('target', el, `${Math.round(r.width)} × ${Math.round(r.height)}`);
  }

  for (const box of document.querySelectorAll('[data-no-overlap]')) {
    if (!shown(box)) continue;
    let items;
    try { items = [...box.querySelectorAll(box.dataset.noOverlap)].filter(shown); } catch { add('overlap', box, `bad selector ${box.dataset.noOverlap}`); continue; }
    const rects = items.map((el) => el.getBoundingClientRect());
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = rects[i], b = rects[j];
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) add('overlap', items[i], `with ${path(items[j])}`);
      }
    }
  }
  return out;
}

// "320-400, 1180" from [320, 340, ..., 400, 1180].
const ranges = (ws) => {
  const out = [];
  for (const w of [...new Set(ws)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && w - last[1] <= 20) last[1] = w; else out.push([w, w]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
};

const browser = await chromium.launch();
const found = new Map();
let loaded = 0;
for (const colorScheme of ['dark', 'light']) {
  // A touch context: pointer: coarse and the 44 px floor apply at every width, since any width can be a tablet.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const [path, key] of Object.entries(PAGES)) {
    const res = await page.goto(BASE + path, { waitUntil: 'load' }).catch((e) => ({ ok: () => false, status: () => e.message }));
    if (!res.ok()) { console.error(`${path}: could not load (${res.status()})`); process.exitCode = 2; continue; }
    await page.waitForTimeout(2500);
    loaded++;
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width >= 1920 ? 1080 : 900 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(120);
      for (const p of await page.evaluate(check, { TARGET, SMALL })) {
        const gate = p.area === 'shell' ? 'shell' : path;
        const id = `${gate}|${colorScheme}|${p.kind}|${p.where}`;
        if (!found.has(id)) found.set(id, { page: gate, scheme: colorScheme, kind: p.kind, where: p.where, detail: p.detail, widths: [] });
        found.get(id).widths.push(width);
      }
    }
    // Screenshots after the checks: a full-page screenshot turns Chromium's touch emulation off until the next load
    // (pointer: coarse stops matching), so each one gets a fresh load and none comes before a check.
    if (!args.includes('--no-shots')) {
      for (const width of SHOTS) {
        await page.setViewportSize({ width, height: width >= 1920 ? 1080 : 900 });
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${OUT}sweep-${key}-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
  }
  await ctx.close();
}
await browser.close();

const problems = [...found.values()].map((p) => ({ ...p, widths: ranges(p.widths) }));
const gated = problems.filter((p) => !PENDING.has(p.page));
const byPage = {};
for (const p of problems) (byPage[p.page] ||= {})[p.kind] = ((byPage[p.page] ||= {})[p.kind] || 0) + 1;
writeFileSync(`${OUT}sweep.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), widths: '320-2560 step 20',
  pending: [...PENDING], summary: byPage, problems }, null, 2));

console.log(`swept ${loaded} page loads × ${WIDTHS.length} widths; ${problems.length} problems (${gated.length} gated). Report: ${OUT}sweep.json`);
for (const [pg, kinds] of Object.entries(byPage)) console.log(`  ${PENDING.has(pg) ? 'pending' : 'GATED  '} ${pg}: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
for (const pg of PENDING) if (!byPage[pg] && (pg === 'shell' || PAGES[pg])) console.log(`  ${pg} is clean: delete it from PENDING`);
for (const p of gated) console.log(`FAIL ${p.page} ${p.scheme} ${p.kind} ${p.where} (${p.detail}) at ${p.widths}`);
if (gated.length) process.exitCode = 1;
