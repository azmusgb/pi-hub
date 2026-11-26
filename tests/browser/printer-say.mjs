// A37 step 2 browser check (plan 2026-11-25-a37-printer-pilot, criteria 2 and 3): Workshop > Printer says its reading.
// At 390 x 844, 1024 x 1366 and 1440 x 900, light and dark, for a printing, a paused, an idle, a finished, a stale, an
// offline and an unanswered printer: the h1 is the sentence and holds the page's name for a screen reader; no purpose line; the
// sentence and the plate's action (phone) or the sentence and the plate's readings (tablet, laptop) are inside the first
// screen; nothing overflows sideways; axe finds nothing serious or critical in the head and the plate. Once, keyboard
// focus on the plate's button survives the page's own refresh. Screenshots go to out/ for a person to look at.
// The printer's card is answered here, so the states don't depend on what the X2D is doing today; every other read
// goes to the preview (the live hub, read-only).
// Usage (from the Mac): cd tests/browser && npm install
//   python3 preview.py &
//   node printer-say.mjs [base-url] [--focus]     (--focus adds the 16 s refresh wait)
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8799').replace(/\/$/, '');
const FOCUS = args.includes('--focus');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const now = () => Date.now() / 1000;
const tel = (status, ago = 20) => ({ status, source: 'Bambuddy', observed_at: new Date(Date.now() - ago * 1000).toISOString() });
const base = { headline: '', detail: '', left: '', minutes_left: null, stale: false, progress: 0, percent: null, since: null,
  nozzle_temp: 219, nozzle_target: 220, bed_temp: 60, bed_target: 60, ams_humidity: 21, filament_type: 'PLA', actions: [] };
const CARDS = {
  printing: () => ({ ...base, state: 'printing', progress: 45, percent: 45, left: '6 h 16 min', minutes_left: 376,
    job_name: 'Rift10_pair70.gcode.3mf', layer_num: 506, total_layers: 1306, as_of: now() - 20, actions: ['pause'], telemetry: tel('live') }),
  paused: () => ({ ...base, state: 'paused', progress: 45, percent: 45, job_name: 'Rift10_pair70.gcode.3mf', layer_num: 506, total_layers: 1306,
    detail: 'Resume it here or on the printer.', as_of: now() - 20, actions: ['resume'], telemetry: tel('live') }),
  idle: () => ({ ...base, state: 'idle', detail: 'Ready for the next print.', as_of: now() - 20, telemetry: tel('live') }),
  stale: () => ({ ...base, state: 'printing', progress: 45, percent: 45, job_name: 'Rift10_pair70.gcode.3mf', layer_num: 506, total_layers: 1306,
    stale: true, detail: 'Bambuddy not answering; last read 12 min ago.', as_of: now() - 720, telemetry: tel('stale', 720) }),
  offline: () => ({ ...base, state: 'none', detail: 'Check that the printer is on and Bambuddy can reach it.', as_of: now() - 20, telemetry: tel('offline') }),
  finished: () => ({ ...base, state: 'stopped', progress: 100, job_name: 'Rift10_pair70.gcode.3mf', since: now() - 600,
    detail: 'Ready for the next one once the plate is clear.', as_of: now() - 20, actions: ['clear'], telemetry: tel('live') }),
  down: null,  // /api/workshop answers 500
};
const SAYS = {
  printing: [/^The X2D is 45% through Rift10 pair70\.$/, /^About 6 h 16 min left, done around /],
  paused: [/^The X2D is paused at 45%\.$/],
  idle: [/^The X2D is idle\.$/],
  stale: [/^The X2D was 45% through Rift10 pair70 12 min ago\.$/, /^Bambuddy hasn't answered since /],
  offline: [/^The X2D isn't answering\.$/],
  finished: [/^The X2D finished Rift10 pair70 at /, /^Clear the plate\.$/],
  down: [/^The X2D isn't answering\.$/],
};
// An idle printer shows its last print as a line in the plate; with it the plate's text once collapsed at tablet widths.
const LAST = { id: 7, name: 'Rift10_pair70', status: 'completed', started: Math.floor(Date.now() / 1000) - 7200, ended: Math.floor(Date.now() / 1000) - 600, seconds: 6600 };
const workshop = (printer) => ({ printer, prints: printer.state === 'idle' ? [LAST] : [], prints_available: true, week: { finished: 0, hours: 0 }, display: { state: 'Online' },
  spools: [], queue: [], ams_trays: [], lab: null, filament_month: {}, ai: { state: 'Unknown', models: [] } });

const problems = [];
const browser = await chromium.launch();
for (const [width, height] of [[390, 844], [1024, 1366], [1440, 900]]) {
  for (const colorScheme of ['light', 'dark']) {
    for (const name of Object.keys(CARDS)) {
      const where = `${name} ${width} ${colorScheme}`;
      const bad = (m) => problems.push(`${where}: ${m}`);
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.route('**/api/workshop', (route) => (CARDS[name]
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(workshop(CARDS[name]())) })
        : route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"fixture: no answer"}' })));
      await page.route('**/api/me', (route) => route.fulfill({ contentType: 'application/json', body: '{"role":"owner","name":"Owner"}' }));
      await page.goto(`${BASE}/workshop`, { waitUntil: 'load' });
      try {
        await page.waitForSelector('#page-title.ui-say .ui-say__s', { timeout: 20000 });
      } catch {
        bad('the head never said a sentence'); await ctx.close(); continue;
      }
      await page.waitForTimeout(800);

      const seen = await page.evaluate(() => {
        const h1 = document.getElementById('page-title');
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
        const label = h1.querySelector('.ui-vh');
        return {
          h1s: document.querySelectorAll('h1').length,
          cls: h1.className, busy: h1.getAttribute('aria-busy'), name: h1.textContent.trim(),
          sentences: [...h1.querySelectorAll('.ui-say__s')].map((s) => s.textContent),
          label: box(label), h1: box(h1),
          purpose: document.getElementById('page-subtitle')?.textContent || '',
          plates: document.querySelectorAll('.ws-now .ui-faceplate').length,
          readout: !!document.querySelector('.ws-now .ui-readout'),
          lamp: document.querySelector('.ws-now .ui-faceplate__nameplate .ui-chip')?.textContent || '',
          main: box(document.querySelector('.ws-now .ui-faceplate__main')),
          nameplate: box(document.querySelector('.ws-now .ui-faceplate__nameplate')),
          action: box(document.querySelector('.ws-now .ui-faceplate__actions button')),
          meter: box(document.querySelector('.ws-now .ui-meter')),
          clear: box(document.querySelector('.ws-needs [data-key="clear"], [data-key="clear"]')),
          // The plate's own lines of text: each as wide as the plate's text column allows, never a sliver beside the readings.
          lines: [...document.querySelectorAll('.ws-now .ui-faceplate__main > p')].map((p) => ({ w: p.getBoundingClientRect().width,
            rows: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)), text: p.textContent.slice(0, 30) })),
          mainW: document.querySelector('.ws-now .ui-faceplate__main')?.getBoundingClientRect().width || 0,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          title: document.title,
        };
      });
      if (seen.h1s !== 1) bad(`${seen.h1s} h1 elements`);
      if (seen.busy) bad('the head is still busy');
      if (!seen.name.startsWith('Printer:')) bad(`the h1's name is "${seen.name.slice(0, 40)}", want it to start with the page's name`);
      if (!seen.label || seen.label.w > 1.5 || seen.label.h > 1.5) bad('the page name in the h1 is not visually hidden');
      if (!/^Printer · /.test(seen.title)) bad(`document.title is "${seen.title}"`);
      if (seen.purpose) bad(`a purpose line is drawn: "${seen.purpose}"`);
      const want = SAYS[name];
      if (seen.sentences.length !== want.length || want.some((re, i) => !re.test(seen.sentences[i] || ''))) bad(`said ${JSON.stringify(seen.sentences)}`);
      if (seen.plates !== 1) bad(`${seen.plates} faceplates`);
      if (seen.readout) bad('the plate still has a readout');
      if (seen.overflow > 0) bad(`the page overflows sideways by ${seen.overflow}px`);
      // A meter is a current fraction: a stale card's last percent is said in the sentence, under the "Last readings" lamp.
      const running = ['printing', 'paused'].includes(name);
      if (running !== !!seen.meter) bad(seen.meter ? 'a meter with no current fraction' : 'no meter while a print is running');
      for (const l of seen.lines) if (l.w < seen.mainW * 0.6 || l.rows > 3) bad(`the plate's line "${l.text}" is ${Math.round(l.w)}px wide in ${Math.round(seen.mainW)}px, ${l.rows} rows`);
      if (name === 'idle' && !seen.lines.some((l) => /^Last print/.test(l.text))) bad('the idle plate has no last-print line to check');
      if (name === 'stale' && seen.lamp !== 'Last readings') bad(`a stale plate's lamp says "${seen.lamp}"`);
      // First screen (criterion 3): the sentence, and on the phone the plate's action; wider, the plate's own readings.
      if (seen.h1.bottom > height) bad(`the sentence ends at ${Math.round(seen.h1.bottom)}px, below the first screen`);
      // While the plate needs clearing the ask and its button lead; otherwise the plate does.
      if (name === 'finished') {
        if (!seen.clear) bad('no Clear the plate button for the owner');
        else if (seen.clear.bottom > height) bad(`Clear the plate ends at ${Math.round(seen.clear.bottom)}px, below the first screen`);
      } else if (!seen.nameplate || seen.nameplate.bottom > height) bad('the plate\'s nameplate is below the first screen');
      if (name === 'printing' || name === 'paused') {
        if (!seen.action) bad('the plate has no action for the owner');
        else if (seen.action.bottom > height) bad(`the plate's action ends at ${Math.round(seen.action.bottom)}px, below the first screen`);
        else if (seen.action.h < 44) bad(`the plate's action is ${Math.round(seen.action.h)}px tall`);
      }
      if (width >= 1024 && name !== 'finished' && seen.main && seen.main.bottom > height) bad(`the plate ends at ${Math.round(seen.main.bottom)}px, below the first screen`);

      const axe = await new AxeBuilder({ page }).include('header.top').include('.ws-now').analyze();
      for (const v of axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))) bad(`axe ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target}`);
      await page.screenshot({ path: `${OUT}printer-say-${name}-${width}-${colorScheme}.png` });

      // Keyboard focus survives the page's own 15 s refresh (once: it is the same code at every size).
      if (FOCUS && name === 'printing' && width === 390 && colorScheme === 'dark') {
        await page.focus('.ws-now .ui-faceplate__actions button');
        const before = await page.evaluate(() => document.activeElement?.textContent);
        await page.waitForTimeout(16500);
        const after = await page.evaluate(() => ({ text: document.activeElement?.textContent, tag: document.activeElement?.tagName }));
        if (after.tag !== 'BUTTON' || after.text !== before) bad(`focus moved from "${before}" to ${after.tag} "${after.text}" across a refresh`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} problem(s)`); process.exit(1); }
console.log(`printer-say: ${Object.keys(CARDS).length} states x 3 sizes x 2 schemes, no problems${FOCUS ? ', focus kept across a refresh' : ''}`);
