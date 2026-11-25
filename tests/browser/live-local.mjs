// live-local: drives Pi Hub pages against a real local Local AI (throwaway stack). Not part of the gates.
// Usage: HUB=http://localhost:38800 TOKEN=<owner token> node live-local.mjs text <path> | shot <path> <name> [w h scheme]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HUB = process.env.HUB || 'http://localhost:38800';
const [cmd, path, name, w = '390', h = '844', scheme = 'light'] = process.argv.slice(2);
const OUT = new URL('./out/live-local/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, colorScheme: scheme });
await ctx.addCookies([{ name: 'hub_session', value: process.env.TOKEN, url: HUB }]);
const page = await ctx.newPage();
await page.goto(HUB + path, { waitUntil: 'load' });
await page.waitForTimeout(+(process.env.WAIT || 2500));
if (process.env.OPEN) await page.locator('.assistant-task summary').click().catch(() => {});
console.log((await page.locator('#view').innerText()).slice(0, 1800));
if (process.env.INJECT) console.log('INJECT', JSON.stringify(await page.evaluate(() => ({ pwn: window.__pwn ?? null, scripts: document.querySelectorAll('#view script').length, imgs: document.querySelectorAll('#view img').length, onerror: document.querySelectorAll('#view [onerror]').length }))));
if (cmd === 'shot') await page.screenshot({ path: `${OUT}${name}-${w}-${scheme}.png`, fullPage: true });
await browser.close();
