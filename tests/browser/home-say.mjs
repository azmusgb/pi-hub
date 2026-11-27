// A37 step 4 browser check (amendment A37, criteria 2 and 3): Home says its reading (R1, R3, R4, R6, R7).
// At 390 x 844, 1024 x 1366 and 1440 x 900, light and dark, across Home's states (printing with an ask, idle with an
// ask and collapsed heads-up, calm, Local AI unread, open decisions, and unreadable Needs you):
//  - the h1 is .ui-say and holds "Home:" in .ui-vh for assistive tech; no purpose line is drawn;
//  - the printer plate (.hd-plate.ui-faceplate--plate) is drawn only while a print runs or is held, with no camera
//    aside, and while shown the X2D row in Systems drops its figure;
//  - First screen (S7 / criterion 3): at 390 x 844 the sentence and either the plate's action or the first ask's
//    action; at 1024 x 1366 and 1440 x 900 the sentence, the plate (when shown) and the first ask;
//  - Systems is drawn on .ui-rows.ui-rows--grid with the lamp following the name and no zero or dash figure;
//  - rail/tab-bar badges count asks per area and System never badges unread alerts;
//  - nothing overflows sideways and axe finds nothing serious or critical in header.top or .home-dash.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8799').replace(/\/$/, '');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const nowSec = () => Math.floor(Date.now() / 1000);
const tel = (status = 'live', ago = 20) => ({ status, source: 'Bambuddy', observed_at: new Date(Date.now() - ago * 1000).toISOString() });
const printingPrinter = () => ({
  state: 'printing', progress: 45, percent: 45, left: '6 h 16 min', minutes_left: 376,
  job_name: 'Rift10_pair70.gcode.3mf', layer_num: 506, total_layers: 1306,
  nozzle_temp: 219, nozzle_target: 220, bed_temp: 60, bed_target: 60, ams_humidity: 21, filament_type: 'PLA',
  as_of: nowSec() - 20, actions: ['pause', 'stop'], telemetry: tel('live'),
});
const idlePrinter = () => ({
  state: 'idle', progress: 0, percent: null, detail: 'Ready for the next print.',
  nozzle_temp: 28, nozzle_target: 0, bed_temp: 25, bed_target: 0, ams_humidity: 21, filament_type: 'PLA',
  as_of: nowSec() - 20, actions: [], telemetry: tel('live'),
});

const ASK = {
  id: 'pi:lab:hex:E-028', source: 'Print lab', tone: 'warn', kind: 'ask',
  title: 'E-028: Fix the plan', detail: 'Missing wall thickness.',
  more: 'outer_wall_mm: required (95.5 / 45 min per test)',
  link: '/lab?p=hex&e=E-028', action: { key: 'fix_plan', link: '/lab?p=hex&e=E-028' },
};
const HEADS_UP = [
  { id: 'pi:Weather', source: 'Pi Hub', tone: 'warn', kind: 'heads_up', title: 'Weather',
    detail: 'Wind advisory', until: new Date(Date.now() + 7200000).toISOString(), link: '/weather', record: 'weather' },
  { id: 'pi:Raspberry Pi', source: 'Pi Hub', tone: 'warn', kind: 'heads_up', title: 'Raspberry Pi',
    detail: 'Pi 71 °C. Slowed by heat earlier.', link: '/system', record: 'pi' },
];

const BASE_RECORDS = (printerState = 'idle') => [
  { id: 'printer', state: printerState, severity: 'ok', detail: printerState === 'printing' ? { progress: 45, layer: 506, total_layers: 1306, job: 'Rift10_pair70' } : {},
    actions: printerState === 'printing' ? [{ name: 'pause' }, { name: 'stop' }] : [] },
  { id: 'pi', state: 'hot', severity: 'attention', headline: 'Running hot' },
  { id: 'internet', state: 'ok', severity: 'ok' },
  { id: 'adguard', state: 'blocking', severity: 'ok' },
  { id: 'pc', state: 'on', severity: 'ok' },
  { id: 'local_ai', state: 'ready', severity: 'ok' },
  { id: 'backups', state: 'ok', severity: 'ok' },
];

const pausedPrinter = () => ({ ...printingPrinter(), state: 'paused', actions: ['resume', 'stop'] });
const stalePrinter = () => ({ ...printingPrinter(), stale: true, as_of: nowSec() - 720, telemetry: tel('stale', 720) });

const CASES = {
  printing: () => ({
    printer: printingPrinter(),
    records: BASE_RECORDS('printing'),
    needs: { count: 1, heads_up_count: 2, unread: [], items: [ASK, ...HEADS_UP] },
    want: [/^One thing needs you\.$/, /^The X2D is 45% through its print, done about /],
    plate: true,
    askShown: true,
    badges: { home: '1', workshop: '1', system: null },
  }),
  idle_ask: () => ({
    printer: idlePrinter(),
    records: BASE_RECORDS('idle'),
    needs: { count: 1, heads_up_count: 2, unread: [], items: [ASK, ...HEADS_UP] },
    want: [/^One thing needs you\.$/, /^Wind advisory\.$/],
    plate: false,
    askShown: true,
    badges: { home: '1', workshop: '1', system: null },
  }),
  calm: () => ({
    printer: idlePrinter(),
    records: BASE_RECORDS('idle').map((r) => (r.id === 'pi' ? { ...r, state: 'ok', severity: 'ok' } : r)),
    needs: { count: 0, heads_up_count: 0, unread: [], items: [] },
    want: [/^Nothing needs you\.$/],
    plate: false,
    askShown: false,
    badges: { home: null, workshop: null, system: null },
  }),
  unread_ai: () => ({
    printer: printingPrinter(),
    records: BASE_RECORDS('printing'),
    needs: { count: 0, heads_up_count: 0, unread: ['Local AI'], items: [] },
    want: [/^Nothing needs you here\.$/, /^Local AI wasn't read\.$/],
    plate: true,
    askShown: false,
    badges: { home: null, workshop: '', system: null },
  }),
  decisions: () => ({
    printer: idlePrinter(),
    records: BASE_RECORDS('idle'),
    needs: {
      count: 0, heads_up_count: 0, unread: [], items: [],
      decisions: { open: [
        { id: 'd1', kind: 'choice', question: 'Keep the nightly backup window?', options: ['Yes', 'No'] },
        { id: 'd2', kind: 'choice', question: 'Archive experiment E-026?', options: ['Yes', 'No'] },
      ] },
    },
    want: [/^Two decisions are waiting\.$/, /^Raspberry Pi: Running hot\.$/],
    plate: false,
    askShown: false,
    badges: { home: null, workshop: null, system: null },
  }),
  paused: () => ({
    printer: pausedPrinter(),
    records: BASE_RECORDS('paused'),
    needs: { count: 1, heads_up_count: 2, unread: [], items: [ASK, ...HEADS_UP] },
    want: [/^One thing needs you\.$/, /^The X2D is paused at 45%\.$/],
    plate: true,
    askShown: true,
    badges: { home: '1', workshop: '1', system: null },
  }),
  stale: () => ({
    printer: stalePrinter(),
    records: BASE_RECORDS('printing').map((r) => (r.id === 'printer' ? { ...r, stale: true, as_of: nowSec() - 720 } : r)),
    needs: { count: 1, heads_up_count: 0, unread: [], items: [ASK] },
    want: [/^One thing needs you\.$/, /^The X2D was 45% through .* 12 min ago\.$/],
    plate: false,
    note: /^X2D: Bambuddy isn't answering\. Last reading 12 min ago\.$/,
    askShown: true,
    badges: { home: '1', workshop: '1', system: null },
  }),
  records_down_printing: () => ({
    printer: printingPrinter(),
    records: null,
    needs: { count: 0, heads_up_count: 0, unread: [], items: [] },
    want: [/^Nothing needs you here\.$/, /^Pi Hub's record list wasn't read\.$/],
    plate: false,
    askShown: false,
    badges: { home: null, workshop: '', system: null },
  }),
  down: () => ({
    printer: idlePrinter(),
    records: null,
    needs: null,
    want: [/^Couldn't read what needs you\.$/],
    plate: false,
    askShown: false,
    badges: { home: '?', workshop: null, system: null },
  }),
};

const problems = [];
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
for (const [width, height] of [[390, 844], [1024, 1366], [1440, 900]]) {
  for (const colorScheme of ['light', 'dark']) {
    for (const [name, build] of Object.entries(CASES)) {
      const c = build();
      const where = `${name} ${width}x${height} ${colorScheme}`;
      const bad = (m) => problems.push(`${where}: ${m}`);
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, serviceWorkers: 'block' });
      const page = await ctx.newPage();

      await page.route('**/api/now', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          summary: "Everything's running", issues: [], printer: c.printer,
          pi: { temp: 71.2, mem_total_gb: 3.7, mem_free_gb: 1.7, uptime_h: 264, updates: 0 },
          network: { orbi_ms: 2.1, wan_ms: 9.4 },
        }),
      }));
      await page.route('**/api/needs', (route) => (c.needs
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(c.needs) })
        : route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"fixture: needs down"}' })));
      await page.route('**/api/records', (route) => (c.records
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ records: c.records }) })
        : route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"fixture: records down"}' })));
      await page.route('**/api/alerts', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ alerts: [{ ts: nowSec() + 100 }, { ts: nowSec() + 200 }] }),
      }));
      await page.route('**/api/me', (route) => route.fulfill({ contentType: 'application/json', body: '{"role":"owner","name":"Owner"}' }));

      await page.goto(`${BASE}/`, { waitUntil: 'load' });
      try {
        await page.waitForSelector('#page-title.ui-say .ui-say__s', { timeout: 20000 });
      } catch {
        bad('the head never said a sentence'); await ctx.close(); continue;
      }
      await page.waitForTimeout(600);

      const seen = await page.evaluate(() => {
        const h1 = document.getElementById('page-title');
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
        const badgeText = (id) => {
          const b = document.querySelector(`.ui-rail a[data-area="${id}"] .ui-rail-badge`);
          return b ? b.textContent : null;
        };
        return {
          h1s: document.querySelectorAll('h1').length,
          busy: h1.getAttribute('aria-busy'),
          name: h1.textContent.trim(),
          sentences: [...h1.querySelectorAll('.ui-say__s')].map((s) => s.textContent),
          label: box(h1.querySelector('.ui-vh')),
          h1: box(h1),
          purpose: document.getElementById('page-subtitle')?.textContent || '',
          plate: box(document.querySelector('.hd-plate.ui-faceplate--plate')),
          plateAside: !!document.querySelector('.hd-plate.ui-faceplate--aside'),
          plateReadout: !!document.querySelector('.hd-plate .ui-readout'),
          plateAction: box(document.querySelector('.hd-plate .ui-faceplate__actions button')),
          firstAsk: box(document.querySelector('.hd-needs__list > .ui-needs .ui-need')),
          askLink: box(document.querySelector('.hd-needs__list > .ui-needs .ui-need a.ui-need__link')),
          askAction: box(document.querySelector('.hd-needs__list > .ui-needs .ui-need .ui-need__action')),
          note: document.querySelector('.hd-printer-note.ui-notice--warn')?.textContent || null,
          x2dFig: document.querySelector('[data-row="printer"] .ui-row__figure')?.textContent || null,
          rackGrid: !!document.querySelector('.hd-rack > ul.ui-rows.ui-rows--grid'),
          rackRows: document.querySelectorAll('.hd-rack > ul.ui-rows.ui-rows--grid > li > a.ui-row').length,
          figures: [...document.querySelectorAll('.hd-rack .ui-row__figure')].map((f) => f.firstChild?.textContent || ''),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          badges: { home: badgeText('home'), workshop: badgeText('workshop'), system: badgeText('system') },
        };
      });

      if (seen.h1s !== 1) bad(`${seen.h1s} h1 elements`);
      if (seen.busy) bad('the head is still busy');
      if (!seen.name.startsWith('Home:')) bad(`h1 text starts with "${seen.name.slice(0, 30)}", want "Home:"`);
      if (!seen.label || seen.label.w > 1.5 || seen.label.h > 1.5) bad('.ui-vh is not visually hidden');
      if (seen.purpose) bad(`purpose line drawn: "${seen.purpose}"`);
      if (seen.sentences.length !== c.want.length || c.want.some((re, i) => !re.test(seen.sentences[i] || ''))) {
        bad(`said ${JSON.stringify(seen.sentences)}`);
      }
      if (!!seen.plate !== c.plate) bad(c.plate ? 'plate missing while printing' : 'plate drawn while idle');
      if (c.note ? !c.note.test(seen.note || '') : seen.note) bad(`printer notice is ${JSON.stringify(seen.note)}`);
      if (seen.plateAside) bad('Home plate has a camera aside');
      if (seen.plateReadout) bad('Home plate has a big readout');
      if (c.plate && seen.x2dFig !== null) bad(`X2D row kept figure "${seen.x2dFig}" while plate is shown`);
      if (!seen.rackGrid || seen.rackRows !== 5) bad(`Systems rack rows: ${seen.rackRows} (grid=${seen.rackGrid})`);
      for (const f of seen.figures) if (f === '0' || f === '—' || f === '0%' || f === '0°') bad(`zero or dash figure "${f}"`);
      if (seen.overflow > 0) bad(`overflows sideways by ${seen.overflow}px`);

      for (const [area, wantBadge] of Object.entries(c.badges)) {
        if (seen.badges[area] !== wantBadge) bad(`badge(${area}) is ${JSON.stringify(seen.badges[area])}, want ${JSON.stringify(wantBadge)}`);
      }

      // First screen (S7 / criterion 3)
      if (seen.h1.bottom > height) bad(`sentence ends at ${Math.round(seen.h1.bottom)}px, below ${height}px`);
      if (width === 390) {
        if (c.plate) {
          if (!seen.plateAction || seen.plateAction.bottom > height) bad(`phone plate action below first screen (${Math.round(seen.plateAction?.bottom || 0)}px)`);
          else if (seen.plateAction.h < 44) bad(`phone plate action height ${Math.round(seen.plateAction.h)}px < 44px`);
        } else if (c.askShown) {
          if (!seen.askAction || seen.askAction.bottom > height) bad(`phone first ask action below first screen (${Math.round(seen.askAction?.bottom || 0)}px)`);
          else if (!seen.askLink || seen.askLink.h < 44) bad(`phone first ask link height ${Math.round(seen.askLink?.h || 0)}px < 44px`);
        }
      } else {
        if (c.plate && seen.plate.bottom > height) bad(`plate ends at ${Math.round(seen.plate.bottom)}px, below ${height}px`);
        if (c.askShown && (!seen.firstAsk || seen.firstAsk.bottom > height)) bad(`first ask ends at ${Math.round(seen.firstAsk?.bottom || 0)}px, below ${height}px`);
      }

      const axe = await new AxeBuilder({ page }).include('header.top').include('.home-dash').analyze();
      for (const v of axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))) {
        bad(`axe ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target}`);
      }
      await page.screenshot({ path: `${OUT}home-say-${name}-${width}-${colorScheme}.png` });
      await ctx.close();
    }
  }
}
await browser.close();
if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} problem(s)`); process.exit(1); }
console.log(`home-say: ${Object.keys(CASES).length} states x 3 sizes x 2 schemes, no problems`);
