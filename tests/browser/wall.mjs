// Wall display browser check (wall fits any screen, 26 Oct): the wall at phone, tablet, laptop, TV and portrait-monitor
// sizes. Fails on horizontal scrolling anywhere, vertical scrolling from tablet size up, a clock that wraps, a control
// under 44 px, a missing Needs you tile, Needs you out of a phone's first screen, the printer tile not getting the most
// room while it prints, or serious/critical axe findings.
// Usage (from the Mac): cd tests/browser && npm install && npx playwright install chromium
//   node wall.mjs http://127.0.0.1:8131 --stub [--shots=DIR]   (stubbed data: idle, printing and night)
//   node wall.mjs http://10.0.0.30                              (the Pi's live data, read only)
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) || 'http://10.0.0.30';
const STUB = args.includes('--stub');
const SHOTS = (args.find((a) => a.startsWith('--shots=')) || '').slice(8) || new URL('./out/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

export const SIZES = [
  ['phone', 390, 844], ['phone-land', 844, 390], ['ipad-port', 820, 1180], ['ipad-land', 1180, 820],
  ['laptop', 1280, 800], ['tv1080', 1920, 1080], ['portrait-screen', 1080, 1920],
];
// One screen, no scrolling: 768 px or more on the short side, or landscape 1024 × 700 and up.
const fits = (w, h) => (Math.min(w, h) >= 768) || (w >= 1024 && h >= 700 && w > h);

// ---- Stubbed data (only with --stub): the shapes the hub's APIs return, with made-up values.
const HOURS = ['10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM'].map((label, i) => ({
  time: `2026-10-26T${String(10 + i).padStart(2, '0')}:00`, label, temp: 58 + i, rain: i === 5 ? 20 : 0, icon: i === 5 ? 'partly-day' : 'clear-day' }));
const OUTSIDE = {
  weather: { place: 'Home', units: 'F', now: { temp: 64, feels: 62, sky: 'Clear', icon: 'clear-day', raining: false },
    hours: HOURS, days: [{ high: 71, low: 52, sunrise: '7:12 AM', sunset: '6:05 PM' }], soon: '', alerts: [] },
  calendar: [{ title: 'Bins out', all_day: true, start: 1793000000 }, { title: 'Dentist', all_day: false, start: 1793034000 }],
};
const NETWORK = { status: 'ok', orbi_ms: 1.7, att_ms: 2.1, wan_ms: 9.3, dns_ms: 28.9, win_ms: 2.8, printer_ms: 2.9, orbi_down_mbps: 85, orbi_up_mbps: 4.2 };
const PRINTERS = {
  idle: { state: 'idle', headline: 'Ready', detail: 'Ready for next print', nozzle_temp: 27, bed_temp: 24, ams_humidity: 43, actions: [] },
  printing: { state: 'printing', progress: 62, headline: 'Printing, 62%', left: '41 min', minutes_left: 41, nozzle_temp: 210, nozzle_target: 210,
    bed_temp: 60, bed_target: 60, ams_humidity: 43, layer_num: 93, total_layers: 150, job_name: 'hex-tile_E-022.gcode.3mf', actions: ['pause'] },
};
const now = (printer) => ({ status_available: true, summary: 'All good at home', issues: [], printer, network: NETWORK,
  movies: { tone: 'ok' }, home: { tone: 'ok' }, workshop: { display: 'On' }, pi: { tone: 'ok' }, reminders: [], setup_left: null });
const HOME = { connected: true, favourites: ['light-1'], accessories: [{ id: 'light-1', name: 'Workshop Light', kind: 'light', on: true, brightness: 100 }] };
const NEEDS = { count: 0, unread: [], items: [
  { source: 'Bambuddy', tone: 'attention', title: 'Judge the print', detail: 'Look at the first layer.', link: 'tool:bambuddy' },
  ...[1, 2, 3].map((n) => ({ source: 'Printer', tone: 'warn', title: `Extra thing ${n}`, detail: 'Filler to pass the five-item cap.', link: '/workshop' })),
  { source: 'Printer', tone: 'attention', title: 'Clear the plate', detail: 'Finished hex-tile E-021 · 1 h 4 min', link: '/workshop' },
  { source: 'Local AI', tone: 'warn', title: 'Approve the E-023 print', detail: 'The lab has a new experiment ready for the X2D.', link: '/workshop' },
  { source: 'Pi Hub', tone: 'warn', title: 'Sixth', detail: 'x', link: '/' }, { source: 'Pi Hub', tone: 'warn', title: 'Seventh', detail: 'x', link: '/' }] };
NEEDS.count = NEEDS.items.length;
const CAMERA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2b2f36"/><stop offset="1" stop-color="#101216"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/><path d="M180 600 L1100 600 L980 420 L300 420 Z" fill="#3a3f47"/>
  <g fill="#c9a24a"><rect x="560" y="470" width="70" height="50" rx="6"/><rect x="650" y="470" width="70" height="50" rx="6"/></g>
  <rect x="600" y="230" width="90" height="140" rx="8" fill="#5a5f68"/><path d="M630 370 l15 40 l15 -40 Z" fill="#9aa0a8"/></svg>`;

async function stub(page, printer, needs = NEEDS, camera = true) {
  const json = (body) => (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/now', json(now(PRINTERS[printer])));
  await page.route('**/api/outside', json(OUTSIDE));
  await page.route('**/api/home', json(HOME));
  await page.route('**/api/camera', json(camera ? { ok: true, source: 'Pi' } : { ok: false }));
  await page.route('**/api/needs', json(needs));
  await page.route('**/api/camera.jpg*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: CAMERA_SVG }));
}

const problems = [];
const browser = await chromium.launch();
const runs = STUB
  ? [...SIZES.map(([n, w, h]) => ({ n, w, h, printer: 'idle', at: '2026-10-26T12:48:00', shot: `after-${n}` })),
     ...SIZES.map(([n, w, h]) => ({ n, w, h, printer: 'printing', at: '2026-10-26T12:48:00', shot: n === 'tv1080' ? 'after-tv1080-printing' : null })),
     { n: 'tv1080', w: 1920, h: 1080, printer: 'printing', at: '2026-10-26T22:48:00', shot: 'after-tv1080-night' },
     { n: 'laptop', w: 1280, h: 800, printer: 'idle', at: '2026-10-26T12:48:00', shot: 'after-laptop-all-clear', clear: true },
     ...SIZES.map(([n, w, h]) => ({ n, w, h, printer: 'printing', at: '2026-10-26T12:48:00', noCamera: true, shot: n === 'tv1080' || n === 'phone' ? `after-${n}-no-camera` : null }))]
  : SIZES.map(([n, w, h]) => ({ n, w, h, printer: null, shot: `live-${n}` }));

for (const run of runs) {
  const { n, w, h } = run;
  const where = `${n} ${w}x${h}${run.printer ? ` ${run.printer}` : ''}${run.shot?.endsWith('night') ? ' night' : ''}${run.noCamera ? ' no camera' : ''}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  if (run.at) await page.clock.setFixedTime(new Date(run.at));
  if (STUB) await stub(page, run.printer, run.clear ? { count: 0, items: [], unread: [] } : NEEDS, !run.noCamera);
  await page.goto(`${BASE}/wall`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wall-board[data-printing]', { timeout: 15000 }).catch(() => problems.push(`${where}: the wall never loaded`));
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const time = document.querySelector('.wall-time');
    const fs = time ? parseFloat(getComputedStyle(time).fontSize) : 0;
    const small = [...document.querySelectorAll('.wall-board a, .wall-board button')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height > 0)
      .map((e) => ({ text: e.textContent.trim().slice(0, 30), h: e.getBoundingClientRect().height, wraps: e.scrollWidth > e.clientWidth + 1 }))
      .filter((x) => x.h < 44 || x.wraps);
    const area = (s) => { const b = r(s); return b ? b.width * b.height : 0; };
    return {
      sw: doc.scrollWidth, sh: doc.scrollHeight, iw: innerWidth, ih: innerHeight,
      clockH: time ? time.getBoundingClientRect().height : 0, clockFs: fs, clockText: time?.textContent,
      needs: !!document.querySelector('.wall-needs .wall-needs-head h2'),
      needItems: document.querySelectorAll('.wall-needs .ui-need').length,
      needMore: !!document.querySelector('.wall-needs .ui-needs__more a'),
      needEmpty: !!document.querySelector('.wall-needs .ui-needs__empty'),
      needTool: [...document.querySelectorAll('.wall-needs a.ui-need__link[target=_blank]')].map((a) => a.href),
      needInternal: [...document.querySelectorAll('.wall-needs a.ui-need__link:not([target])')].every((a) => a.hasAttribute('data-link')),
      allClear: document.querySelector('.wall-needs-status')?.textContent === 'All clear',
      needsBottom: r('.wall-needs-head')?.bottom ?? Infinity, headBottom: r('.wall-head')?.bottom ?? Infinity,
      weather: !!document.querySelector('.wall-weather .wall-temp'),
      small,
      areas: { print: area('.wall-print'), needs: area('.wall-needs'), house: area('.wall-house') },
      tops: { needs: r('.wall-needs')?.top, print: r('.wall-print')?.top, house: r('.wall-house')?.top },
      camNone: document.querySelector('.kiosk-cam-none') ? r('.kiosk-cam-container')?.height : null,
      layer: (() => { const s = document.querySelector('.kiosk-sub .nowrap'); return s ? { text: s.textContent, lines: s.getClientRects().length } : null; })(),
    };
  });
  if (m.sw > m.iw) problems.push(`${where}: scrolls sideways (${m.sw} > ${m.iw})`);
  if (fits(w, h) && m.sh > m.ih) problems.push(`${where}: scrolls down (${m.sh} > ${m.ih}) on a one-screen size`);
  if (!m.clockText || m.clockH > m.clockFs * 1.3) problems.push(`${where}: the clock "${m.clockText}" wraps (${Math.round(m.clockH)} px at ${m.clockFs} px)`);
  if (!m.needs) problems.push(`${where}: no Needs you tile`);
  if (run.clear && !m.allClear) problems.push(`${where}: Needs you doesn't say All clear when nothing needs you`);
  if (STUB && run.clear && !m.needEmpty) problems.push(`${where}: no kit empty state when nothing needs you`);
  if (STUB && !run.clear) {
    if (m.needItems !== 5) problems.push(`${where}: ${m.needItems} .ui-need items (want exactly 5 of ${NEEDS.items.length})`);
    if (!m.needMore) problems.push(`${where}: no "more on Home" link`);
    if (m.needTool.length !== 1 || new URL(m.needTool[0]).origin === new URL(BASE).origin) problems.push(`${where}: tool: link didn't resolve to the gate address (${m.needTool})`);
    if (!m.needInternal) problems.push(`${where}: an internal need link lacks data-link`);
  }
  if (STUB && !m.weather) problems.push(`${where}: no weather`);
  if (m.needsBottom > m.ih || m.headBottom > m.ih) problems.push(`${where}: clock, weather or Needs you below the first screen`);
  for (const s of m.small) problems.push(`${where}: control "${s.text}" is ${Math.round(s.h)} px tall${s.wraps ? ' and its label wraps' : ''}`);
  if (run.printer === 'printing') {
    const { print, needs, house } = m.areas;
    const wide = w > h && w >= 1000 && h >= 500;
    // The printer is largest for its picture; with no picture it is only as tall as its words.
    if (wide && !run.noCamera && print < Math.max(needs, house)) problems.push(`${where}: the printer tile isn't the largest while printing`);
    if (w < h && !(m.tops.print > m.tops.needs && m.tops.print < m.tops.house)) problems.push(`${where}: the printer isn't first after Needs you while printing`);
  }
  if (run.printer === 'printing' && STUB && (!m.layer || m.layer.lines !== 1)) problems.push(`${where}: "${m.layer?.text}" breaks across lines`);
  if (run.noCamera && !(m.camNone > 0 && m.camNone <= 140)) problems.push(`${where}: no picture, but the camera box is ${Math.round(m.camNone ?? 0)} px tall`);
  if (run.shot) {
    const axe = await new AxeBuilder({ page }).exclude('.kiosk-cam-img').analyze();
    for (const v of axe.violations.filter((v) => ["serious", "critical"].includes(v.impact))) problems.push(`${where}: axe ${v.id} (${v.nodes.map((x) => x.target.join(" ")).join(", ")})`);
    await page.screenshot({ path: `${SHOTS}/${run.shot}.png` });
  }
  await ctx.close();
}
if (STUB) {  // The Home card caps at 4 items.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await stub(page, 'idle');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.home-card--needs .ui-need', { timeout: 15000 }).catch(() => problems.push('home: no Needs you card'));
  const n = await page.locator('.home-card--needs .ui-need').count();
  if (n < 1 || n > 4) problems.push(`home: ${n} .ui-need items on the Home card (want 1 to 4)`);
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : `All ${runs.length} wall views pass.`);
process.exit(problems.length ? 1 : 0);
