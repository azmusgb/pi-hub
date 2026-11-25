// A34 P2, P2n browser check: the Assistant pages Pi Hub draws (Assistant status, Models, a task in each state, and the
// Start a task form on /assistant) at phone and desktop widths, light and dark, against the fixture preview (no live
// Local AI): fails on serious or critical axe findings, horizontal overflow, a page without its heading, or text left as
// "undefined". Writes screenshots to out/ for a person to look at.
// Usage (from the Mac): cd tests/browser && npm install
//   python3 preview.py --port 8851 --fixture fixtures/assistant &          (PC on: status with a failed source, models, tasks)
//   python3 preview.py --port 8852 --fixture fixtures/assistant-asleep &   (PC off: status from the mirror, models needs the PC)
//   node assistant.mjs [on-url] [asleep-url]
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const [ON, ASLEEP] = [process.argv[2] || 'http://127.0.0.1:8851', process.argv[3] || 'http://127.0.0.1:8852'];
const OUT = new URL('./out/', import.meta.url).pathname;
const RUN = (s) => `/assistant/run/run-fixture-${s}`;
// base, path, what the page must say
const PAGES = [
  [ON, '/assistant/status', /Assistant status[\s\S]*Services/], [ON, '/assistant/models', /Models[\s\S]*Installed/],
  [ON, RUN('queued'), /Queued/], [ON, RUN('running'), /1 of 5 steps/], [ON, RUN('awaiting'), /Open Decisions/],
  [ON, RUN('completed'), /Answer/], [ON, RUN('failed'), /Why it stopped/], [ON, RUN('cancelled'), /Cancelled/],
  [ASLEEP, '/assistant/status', /The PC is asleep\. This is the Assistant's last answer/], [ASLEEP, '/assistant/models', /Wake the PC, then this page reads the models\./],
  [ASLEEP, RUN('running'), /Can't reach the Assistant/],
  [ON, '/assistant', /Start a task/],
];
mkdirSync(OUT, { recursive: true });
const shot = (path, tag) => `${path.replace(/\W+/g, '-').replace(/^-|-$/g, '')}-${tag}`;
const problems = [];
const browser = await chromium.launch();
for (const [width, height] of [[390, 844], [1366, 900]]) {
  for (const colorScheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme });
    const page = await ctx.newPage();
    for (const [base, path, words] of PAGES) {
      const where = `${base.slice(-4)}${path} ${width} ${colorScheme}`;
      await page.goto(base + path, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      if (path === '/assistant') await page.locator('.assistant-task summary').click().catch(() => {});
      const text = await page.locator('#view').innerText();
      if (!words.test(text)) problems.push(`${where}: missing ${words}`);
      if (/undefined|\[object/.test(text)) problems.push(`${where}: shows undefined or [object]`);
      const head = (await page.locator('#page-title').innerText()).trim();
      if (!head) problems.push(`${where}: no page heading`);
      if (path.startsWith('/assistant/run/') && (head !== 'Task' || /A run/.test(text))) problems.push(`${where}: the task page says "${head}", not one name`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (wide > 1) problems.push(`${where}: ${wide}px of horizontal overflow`);
      const axe = await new AxeBuilder({ page }).analyze();
      for (const v of axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))) problems.push(`${where}: axe ${v.id} (${v.nodes.length})`);
      await page.screenshot({ path: `${OUT}${shot(path, `${base.endsWith('1') ? 'on' : 'asleep'}-${width}-${colorScheme}`)}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : `All ${PAGES.length * 4} views pass.`);
process.exit(problems.length ? 1 : 0);
