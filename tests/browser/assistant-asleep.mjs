// The Assistant's two unavailable states (the phrase table's pc_off and assistant_down), in a real browser: the head's
// button and Home's contextual Ask link both show the reason, are aria-disabled, keep a tab stop with no href, and a click
// goes nowhere. Starts its own read-only previews (preview.py --fixture) on two ports.
// Usage (from the Mac): node tests/browser/assistant-asleep.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const CASES = [
  { port: 8821, fixture: 'assistant-pc-off', words: 'The PC is asleep' },
  { port: 8822, fixture: 'assistant-down', words: "The Assistant isn't answering" },
];
const problems = [];
const servers = CASES.map((c) => spawn('python3', [new URL('./preview.py', import.meta.url).pathname, '--port', String(c.port),
  '--fixture', new URL(`./fixtures/${c.fixture}`, import.meta.url).pathname], { stdio: 'ignore' }));
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch();
try {
  for (const c of CASES) {
    for (const colorScheme of ['light', 'dark']) {
      for (const [width, height] of [[390, 844], [1366, 900]]) {
        const where = `${c.fixture} ${width} ${colorScheme}`;
        const page = await (await browser.newContext({ viewport: { width, height }, colorScheme })).newPage();
        for (const path of ['/', '/system']) {
          await page.goto(`http://127.0.0.1:${c.port}${path}`, { waitUntil: 'load' });
          await page.waitForSelector('.top-assistant[aria-disabled="true"]', { timeout: 8000 }).catch(() => {});
          const links = await page.$$eval('.top-assistant, [data-ask-assistant]', (a) => a.map((x) => ({
            ask: x.hasAttribute('data-ask-assistant'), disabled: x.getAttribute('aria-disabled'), href: x.getAttribute('href'),
            name: x.getAttribute('aria-label'), text: x.textContent.trim(), tab: x.tabIndex, role: x.getAttribute('role') })));
          const want = path === '/' ? 2 : 1;
          if (links.length !== want) problems.push(`${where} ${path}: ${links.length} Assistant links, want ${want}`);
          for (const l of links) {
            const who = `${where} ${path} ${l.ask ? 'Ask link' : 'head button'}`;
            if (l.disabled !== 'true') problems.push(`${who}: not aria-disabled`);
            if (l.href !== null) problems.push(`${who}: still has an href (${l.href})`);
            if (l.name !== c.words) problems.push(`${who}: name "${l.name}", want "${c.words}"`);
            if (l.tab !== 0) problems.push(`${who}: not a tab stop`);
            if (l.role !== 'link') problems.push(`${who}: role ${l.role}`);
            if (!l.ask && width >= 861 && l.text !== c.words) problems.push(`${who}: shows "${l.text}"`);
            if (l.ask && l.text !== c.words) problems.push(`${who}: shows "${l.text}"`);
          }
          await page.click('.top-assistant').catch(() => {});
          if (new URL(page.url()).pathname !== path) problems.push(`${where} ${path}: a click on the disabled button navigated to ${page.url()}`);
          if (width === 1366 && path === '/' && colorScheme === 'light') await page.screenshot({ path: new URL(`./out/asleep-${c.fixture}.png`, import.meta.url).pathname });
        }
      }
    }
  }
} finally { await browser.close(); servers.forEach((s) => s.kill()); }
console.log(problems.length ? problems.join('\n') : 'Assistant unavailable: the head button and Home\'s Ask link are disabled with the reason, for pc_off and assistant_down.');
process.exit(problems.length ? 1 : 0);
