// A33 P2 browser check (plan 2026-11-21-a33-owner-decisions, criteria 2 and 6): Home's Needs you as the owner with two
// open decisions, at 390 and 1366 px, light and dark. Keyboard only: Tab to an option and press Enter; the row leaves and
// says what was recorded, the other stays. Then a failed answer (the hub answers 500) keeps its row and says so. axe
// (no serious or critical findings) and screenshots before and after.
// The answers never leave the browser: /api/needs and the answer POST are answered here (the preview is read-only and
// refuses POSTs anyway). The seed is fixtures/decisions/needs.json, which the preview also serves with --fixture.
// Usage (from the Mac): cd tests/browser && npm install
//   python3 preview.py --fixture fixtures/decisions &
//   node decisions.mjs [base-url]
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8799').replace(/\/$/, '');
const OUT = new URL('./out/', import.meta.url).pathname;
const SEED = JSON.parse(readFileSync(new URL('./fixtures/decisions/needs.json', import.meta.url), 'utf8'));
const [FIRST, SECOND] = SEED.decisions.open;
const PICK = FIRST.options[1];   // the recommended option: answered, and recorded
const FAIL = SECOND.options[0];  // answered, and the hub fails the write
mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch();
for (const [width, height] of [[390, 844], [1366, 900]]) {
  for (const colorScheme of ['light', 'dark']) {
    const where = `${width} ${colorScheme}`;
    const bad = (m) => problems.push(`${where}: ${m}`);
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    // The hub as the owner sees it: open decisions leave the list once answered.
    const answered = new Map();
    const posts = [];
    await page.route('**/api/needs', (route) => {
      const open = SEED.decisions.open.filter((d) => !answered.has(d.id));
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...SEED, decisions: { open, answered: [] } }) });
    });
    await page.route('**/api/decisions/*/answer', (route) => {
      const req = route.request();
      const id = decodeURIComponent(new URL(req.url()).pathname.split('/')[3]);
      const { answer } = req.postDataJSON() || {};
      posts.push({ id, answer, method: req.method() });
      if (id !== FIRST.id) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' });
      const d = { ...FIRST, answered_at: 1795431000, answer };
      answered.set(id, d);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, recorded: true, decision: d }) });
    });

    await page.goto(BASE + '/', { waitUntil: 'load' });
    try {
      await page.waitForSelector('.hd-needs .ui-decision', { timeout: 15000 });
    } catch {
      bad('no decision rows drawn'); await ctx.close(); continue;
    }
    await page.waitForTimeout(1500);
    const rows = () => page.$$eval('.hd-needs .ui-decision', (r) => r.map((x) => ({ id: x.dataset.decision, state: x.dataset.state,
      note: x.querySelector('.ui-decision__note')?.textContent || '' })));
    const status = () => page.$eval('.hd-needs .ui-decisions__status', (s) => s.textContent);
    const axe = async (when) => {
      const r = await new AxeBuilder({ page }).include('.hd-needs').analyze();
      for (const v of r.violations.filter((v) => ['serious', 'critical'].includes(v.impact))) bad(`${when}: axe ${v.id} (${v.nodes.length})`);
    };
    const shot = async (when) => {
      await page.locator('.hd-needs').scrollIntoViewIfNeeded();
      await page.locator('.hd-needs').screenshot({ path: `${OUT}decisions-${when}-${width}-${colorScheme}.png` });
    };

    if ((await rows()).length !== 2) bad(`want 2 rows, got ${(await rows()).length}`);
    // The count is the condition rows alone (the hub's records join them through the preview); decisions never add.
    const [count, conditions] = await page.evaluate(() => [document.querySelector('.hd-needs__count').textContent,
      document.querySelectorAll('.hd-needs__list .ui-need').length]);
    if (count !== String(conditions)) bad(`Needs you's count is "${count}" for ${conditions} condition rows`);
    await axe('two open');
    await shot('open');

    // Keyboard only: Tab until the option has focus (and say how far that was), then Enter.
    const tabTo = async (id, label) => {
      for (let n = 1; n <= 250; n++) {
        await page.keyboard.press('Tab');
        const at = await page.evaluate(() => {
          const a = document.activeElement;
          const s = a && getComputedStyle(a);
          return { id: a?.closest('.ui-decision')?.dataset.decision, text: a?.firstChild?.textContent?.trim(),
            ring: s ? s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 : false };
        });
        if (at.id === id && at.text === label) { if (!at.ring) bad(`"${label}" has no visible focus ring`); return n; }
      }
      bad(`Tab never reached "${label}"`);
      return 0;
    };
    if (await tabTo(FIRST.id, PICK)) {
      await page.keyboard.press('Enter');
      await page.waitForFunction((id) => !document.querySelector(`.ui-decision[data-decision="${id}"]`), FIRST.id, { timeout: 5000 })
        .catch(() => bad('the answered row stayed'));
    }
    if (posts.length !== 1 || posts[0].id !== FIRST.id || posts[0].answer !== PICK || posts[0].method !== 'POST') {
      bad(`want one POST of "${PICK}" for ${FIRST.id}, got ${JSON.stringify(posts)}`);
    }
    if (await status() !== `Recorded: ${PICK}`) bad(`status reads "${await status()}"`);
    const left = await rows();
    if (left.length !== 1 || left[0].id !== SECOND.id) bad(`the other row should stay: ${JSON.stringify(left)}`);
    const focused = await page.evaluate(() => document.activeElement?.closest('.hd-needs') ? document.activeElement.textContent.trim() : null);
    if (focused === null) bad('focus left Needs you after the answer');

    // A failed write: the row stays, says so, and keeps focus on the option.
    const before = posts.length;
    if (await tabTo(SECOND.id, FAIL)) {
      await page.keyboard.press('Enter');
      await page.waitForFunction((id) => document.querySelector(`.ui-decision[data-decision="${id}"]`)?.dataset.state === 'failed', SECOND.id, { timeout: 5000 })
        .catch(() => bad('the failed row never said so'));
    }
    if (posts.length !== before + 1) bad(`want one POST for the failed answer, got ${posts.length - before}`);
    const after = await rows();
    if (after.length !== 1 || after[0].note !== 'Not recorded. Try again.') bad(`after a failed POST: ${JSON.stringify(after)}`);
    const back = await page.evaluate(() => document.activeElement?.closest('.ui-decision')?.dataset.decision);
    if (back !== SECOND.id) bad('focus did not stay on the failed row');
    await axe('one recorded, one failed');
    await shot('answered');
    await page.screenshot({ path: `${OUT}decisions-page-${width}-${colorScheme}.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'Decisions: all 4 views pass (keyboard answer, failed write, axe).');
process.exit(problems.length ? 1 : 0);
