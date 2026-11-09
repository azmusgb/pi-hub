// A19 P7 evidence: the Quick Print 3D view in a real browser, against a mocked hub. Serves hub/static itself, answers
// /api/quick/jobs/j1/* from memory, and checks: it draws; keyboard and focus ring; no animation loop at rest; reduced mode on
// a phone; the module blocked, WebGL missing and a lost context each leave a plain message and the rest alone; timings on a
// large model. Usage: cd tests/browser && npm install && node quick3d.mjs   (exit 1 on any failure)
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const STATIC = new URL('../../hub/static/', import.meta.url).pathname;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
const HARNESS = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href=/static/app.css><link rel=stylesheet href=/static/quick.css>
<body><div id=two>2D layers stay here</div><div id=box></div>
<script type=module>
const q = new URLSearchParams(location.search);
if (q.get('open')) {
  const { open3d } = await import('/static/js/quick.js');
  const state = { view3dBox: document.getElementById('box') };
  state.view3dBox.append(open3d(state, 'j1'));
} else window.v = (await import('/static/js/quick-3d.js')).view3d(document.getElementById('box'), 'j1', q.get('reduced') ? { reduced: true } : {});
</script>`;

function stlBuffer(n) {
  const b = Buffer.alloc(84 + 50 * n);
  b.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i + 12, x = (i % 600) * 0.2, y = Math.floor(i / 600) * 0.2;
    [x, y, 0, x + 0.2, y, 0, x, y + 0.2, ((i * 7) % 40) / 4].forEach((v, k) => b.writeFloatLE(v, o + 4 * k));
  }
  return b;
}
function layer(i, segs) {
  const p = [];
  for (let k = 0; k <= segs; k++) p.push(20 + (k % 100) * 2, 20 + Math.floor(k / 100) * 2 + (k % 2));
  return { i, z: Math.round((i + 1) * 20) / 100, extrusion: [{ f: 'Outer wall', s: 60, p }, { f: 'Sparse infill', s: 200, p: p.map((v) => v + 1) }], travel: [] };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/harness') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(HARNESS); }
  const f = normalize(join(STATIC, u.pathname.replace(/^\/static\//, '')));
  if (u.pathname.startsWith('/static/') && f.startsWith(STATIC) && existsSync(f) && statSync(f).isFile()) {
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    return res.end(readFileSync(f));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

async function mock(page, { layers = 40, segs = 400, tris = 2000, model = true } = {}) {
  const l = Array.from({ length: layers }, (_, i) => ({ i, z: Math.round((i + 1) * 20) / 100, features: ['Outer wall', 'Sparse infill'], extrusion_mm: 10, travel_mm: 1, filament_mm: 1, speed: [60, 200] }));
  const stl = model ? stlBuffer(tris) : null;
  await page.route('**/api/quick/jobs/j1/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/layers')) return route.fulfill({ json: { state: 'ready', progress: 1, built: layers, layers: l, bounds: [20, 20, 220, 220], plate: { area: [0, 0, 256, 256], height: 261 }, truncated: null, reason: null } });
    if (p.endsWith('/model')) return stl ? route.fulfill({ body: stl, contentType: 'model/stl' }) : route.fulfill({ status: 404, json: { detail: 'none' } });
    const m = p.match(/layers\/(\d+)$/);
    return m ? route.fulfill({ json: layer(Number(m[1]), segs) }) : route.fulfill({ status: 404, json: {} });
  });
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const open = async (opts = {}, { width = 1280, height = 900, reducedMotion, query = '', before } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reducedMotion || 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (before) await before(page);
  await mock(page, opts);
  await page.goto(`${BASE}/harness${query}`);
  return { page, ctx, errors };
};
const done = (page) => page.waitForFunction(() => /layers from the sliced file|couldn't start|can't draw|no layers/.test(document.querySelector('.quick-3d__status')?.textContent || ''), null, { timeout: 60000 });

// 1. it draws, and says what it drew
{
  const { page, ctx, errors } = await open();
  await done(page);
  const s = await page.textContent('.quick-3d__status');
  check('draws the toolpaths and the stored model', /40 layers from the sliced file/.test(s) && /translucent shape/.test(s), s);
  const shot = await page.locator('.quick-3d__stage').screenshot();
  check('the canvas is not blank', new Set(shot).size > 40);
  check('no page errors', errors.length === 0, errors.join('|'));
  check('the 2D area is untouched', (await page.textContent('#two')) === '2D layers stay here');

  // 2. keyboard turns the view, with a visible focus ring
  await page.focus('.quick-3d__stage');
  const ring = await page.evaluate(() => getComputedStyle(document.querySelector('.quick-3d__stage')).outlineStyle);
  check('the stage shows a focus ring', ring !== 'none', ring);
  const before = await page.locator('.quick-3d__stage').screenshot();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const after = await page.locator('.quick-3d__stage').screenshot();
  check('arrow keys turn the view', !before.equals(after));
  await page.keyboard.press('0'); await page.waitForTimeout(200);
  const reset = await page.locator('.quick-3d__stage').screenshot();
  check('0 resets it', !after.equals(reset));
  // views and cameras
  for (const v of ['Top', 'Front', 'Back', 'Left', 'Right', 'Bottom']) await page.getByRole('button', { name: v, exact: true }).click();
  await page.getByRole('button', { name: 'Orthographic' }).click();
  check('orthographic switches the button', (await page.getByRole('button', { name: 'Perspective' }).count()) === 1);
  // section plane
  const full = await page.locator('.quick-3d__stage').screenshot();
  await page.locator('.quick-3d__cut input').fill('5'); await page.waitForTimeout(200);
  check('the section plane cuts the print', !full.equals(await page.locator('.quick-3d__stage').screenshot()) && /Up to layer 6/.test(await page.textContent('.quick-3d__cut output')));
  // at rest: no animation loop
  const frames = await page.evaluate(() => new Promise((r) => { let n = 0; const o = requestAnimationFrame; window.requestAnimationFrame = (f) => { n++; return o(f); }; setTimeout(() => r(n), 1000); }));
  check('no animation loop at rest', frames === 0, `${frames} frames`);
  await ctx.close();
}

// 3. reduced motion preference and phone width: reduced mode, said on screen, no horizontal scroll
{
  const { page, ctx } = await open({ layers: 300, segs: 600, tris: 100000 }, { width: 390, height: 800, reducedMotion: 'reduce', query: '?reduced=1' });
  await done(page);
  const note = await page.textContent('.quick-3d__note');
  check('reduced mode is said on screen', /^Reduced mode for this device/.test(note) && /every 5th layer/.test(note) && /thinned to/.test(note), note);
  check('no horizontal scroll at 390 px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ctx.close();
}

// 4. failures leave a plain message and the rest alone
{
  const { page, ctx } = await open({}, { before: (p) => p.route('**/vendor/three-0.187.0/three.module.js', (r) => r.abort()) });
  await done(page);
  const s = await page.textContent('.quick-3d__status');
  check('module blocked: plain message, 2D intact', /couldn't start/.test(s) && /still work/.test(s) && (await page.textContent('#two')) === '2D layers stay here', s);
  await ctx.close();
}
{
  const { page, ctx } = await open({}, { before: (p) => p.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; }) });
  await done(page);
  check('WebGL unavailable: plain message', /can't draw 3D here/.test(await page.textContent('.quick-3d__status')));
  await ctx.close();
}
{
  const { page, ctx } = await open();
  await done(page);
  await page.evaluate(() => document.querySelector('.quick-3d__canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => /graphics context was lost/.test(document.querySelector('.quick-3d__status')?.textContent || ''), null, { timeout: 5000 });
  check('context loss: plain message, stage hidden, 2D intact', await page.evaluate(() => document.querySelector('.quick-3d__stage').hidden && document.getElementById('two').textContent === '2D layers stay here'));
  await ctx.close();
}
{
  const { page, ctx } = await open({ model: false });
  await done(page);
  check('no STL stored: says so, still draws the toolpaths', /no STL model is stored/.test(await page.textContent('.quick-3d__status')));
  await ctx.close();
}

// 4b. the page's own button: with the 3D module's file blocked, one line and nothing else changes; unblocked, it opens
{
  const { page, ctx } = await open({}, { query: '?open=1', before: (p) => p.route('**/static/js/quick-3d.js', (r) => r.abort()) });
  await page.getByRole('button', { name: 'Open 3D view' }).click();
  await page.waitForSelector('.quick-3d-box__msg.ui-notice');
  const m = await page.textContent('.quick-3d-box__msg');
  check('3D file blocked: the button says so in a line and can be retried', /couldn't load/.test(m) && await page.getByRole('button', { name: 'Open 3D view' }).isEnabled(), m);
  await ctx.close();
}
{
  const { page, ctx } = await open({}, { query: '?open=1' });
  await page.waitForSelector('text=Open 3D view');
  const early = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /vendor\/three|quick-3d/.test(n)).length);
  check('nothing of three.js loads before the click', early === 0, `${early} files`);
  await page.getByRole('button', { name: 'Open 3D view' }).click();
  await done(page);
  check('the page button opens the 3D view', /layers from the sliced file/.test(await page.textContent('.quick-3d__status')));
  await ctx.close();
}

// 5. timings on a large model and a long slice
{
  const t0 = Date.now();
  const { page, ctx } = await open({ layers: 800, segs: 4000, tris: 1000000 });
  await done(page);
  const ms = Date.now() - t0;
  console.log(`TIMING  full mode, 1,000,000 triangles + 800 layers x ~8,000 segments: ready in ${ms} ms`);
  console.log(`NOTE    ${await page.textContent('.quick-3d__note')}`);
  check('a large model and slice are ready inside 60 s', ms < 60000, `${ms} ms`);
  await ctx.close();
}
await browser.close(); server.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
