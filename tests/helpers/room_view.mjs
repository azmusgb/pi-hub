// Shared fixtures for the Room view tests (test_room_view*.mjs): the room states, the page loaded with stubbed
// answers (as tests/test_workshop_render.mjs does), and the camera settings model. Rendered with fake_dom.mjs.
import { readFileSync } from 'node:fs';
import { install, text } from './fake_dom.mjs';

export const ready = { state: 'ready', reason: null, viewers: 0, frame_at: Date.now() / 1000, rotate: 0 };
export const down = (reason) => ({ state: 'unavailable', reason, viewers: 0, frame_at: null, rotate: 0 });
export const camUp = { ok: true, source: 'Pi', sources: {} };
export const camOff = { ok: false, reason: 'liveview_off', sources: { Pi: { up: false } } };

export async function mod() {
  const dom = install();
  const ws = await import('../../hub/static/js/workshop.js');
  return { dom, ws };
}

export const pressed = (el) => el.querySelectorAll('.ws-cam-switch button')
  .map((b) => [text(b), b.getAttribute('aria-pressed')]);

// The page itself, loaded with stubbed answers (as tests/test_workshop_render.mjs does).
export const T = Math.floor(Date.now() / 1000);

export const workshop = { printer: { state: 'idle', headline: 'Idle', detail: '', progress: 0, stale: false, actions: [], telemetry: { status: 'live', source: 'Bambuddy' } },
  prints: [], prints_available: true, week: { finished: 0, hours: 0 }, spools: [], ams_trays: [], lab: { needs: [], active: [], questions: [] },
  filament_month: { prints_logged: 0 }, as_of: T };

export async function page(routes) {
  const dom = install({ fetch: { '/api/workshop': workshop, '/api/projects': { available: true, projects: [] }, ...routes } });
  const kit = { exports: {} };
  new Function('module', readFileSync(new URL('../../hub/static/ui/needs.js', import.meta.url), 'utf8'))(kit);
  globalThis.ApplianceNeeds = kit.exports;
  const core = await import('../../hub/static/js/core.js');
  core.forgetMe();
  const ws = await import('../../hub/static/js/workshop.js');
  const state = { root: dom.root() };
  ws.mount(state);
  return { dom, state, ws, done() { ws.leave(state); dom.uninstall(); } };
}

export const CONTROLS = [
  { key: 'turn', label: 'Turn', group: 'Orientation', kind: 'choice', options: [{ value: 0, label: '0°' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }], default: 0 },
  { key: 'mirror', label: 'Mirror', group: 'Orientation', kind: 'switch', default: false },
  { key: 'zoom', label: 'Zoom', group: 'Framing', kind: 'number', min: 1, max: 4, step: 0.5, default: 1, unit: '×' },
  { key: 'centre_x', label: 'Centre across', group: 'Framing', kind: 'number', min: 0, max: 100, step: 1, default: 50, unit: '%' },
  { key: 'ev', label: 'Exposure compensation', group: 'Light', kind: 'number', min: -2, max: 2, step: 0.5, default: 0, unit: 'EV' },
  { key: 'manual', label: 'Manual exposure', group: 'Light', kind: 'switch', default: false },
  { key: 'shutter', label: 'Shutter', group: 'Light', kind: 'choice', options: [{ value: 1000, label: '1/1000 s' }, { value: 33333, label: '1/30 s' }], default: 33333 },
  { key: 'awb', label: 'White balance', group: 'Colour', kind: 'choice', options: [{ value: 'auto', label: 'Auto' }, { value: 'tungsten', label: 'Tungsten' }], default: 'auto' },
  { key: 'sharpness', label: 'Sharpness', group: 'Detail', kind: 'number', min: 0, max: 2, step: 0.05, default: 1 },
  { key: 'preset', label: 'Live quality', group: 'Live quality', kind: 'choice', options: [{ value: 'saver', label: 'Data saver (about 1.4 Mbit/s)' }, { value: 'sharp', label: 'Sharp (about 22 Mbit/s)' }], default: 'saver' },
];

export const SETTINGS = { turn: 90, mirror: false, zoom: 1, centre_x: 50, ev: 0, manual: false, shutter: 33333, awb: 'auto', sharpness: 1, preset: 'saver' };
export const DEFAULTS = { ...SETTINGS, turn: 0 };
export const model = () => ({ settings: { ...SETTINGS }, defaults: { ...DEFAULTS }, controls: CONTROLS, applying: false });
export const ready90 = { ...ready, rotate: 90, size: [640, 480], engine: 'picamera2' };
export const tick = () => new Promise((r) => setTimeout(r, 0));

export function change(el, value) {
  if (el.type === 'checkbox') el.checked = value; else el.value = String(value);
  el.dispatchEvent({ type: el.tagName === 'INPUT' && el.type === 'range' ? 'input' : 'change', target: el });
}

export async function ownerPage(extra = {}, room = ready90) {
  try { globalThis.localStorage?.removeItem?.('hub-workshop-camera'); } catch { /* a storage that throws (A23 P4 test) */ }  // not every Node has localStorage (the Pi's 20 doesn't)
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camOff, '/api/camera/room': room,
    '/api/camera/room/settings': model(), '/api/camera/room.jpg': {}, ...extra });
  await p.ws.load(p.state);
  await tick();
  return p;
}

export const panel = (p) => p.state.root.querySelector('details.ws-set');
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const bar = (p, key) => p.state.root.querySelector(`.ws-bars [data-key="${key}"]`);

// Open Adjust and let the live picture's first frame arrive, so the controls on the picture can take a change.
export async function adjusting(p) {
  const d = panel(p);
  d.open = true;
  d.dispatchEvent({ type: 'toggle', target: d });
  await tick(); await tick();
  const img = p.state.root.querySelectorAll('img.room-img').find((i) => !i.dataset.refresh);
  img.naturalWidth = 384;
  img.onload?.();
  return d;
}

export function withStatus(p, status, body) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (opts?.method === 'POST' && String(url).startsWith('/api/camera/room/settings')
    ? new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) : real(url, opts));
}
