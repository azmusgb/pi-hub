// A17 P2: the Room view on Workshop › Printer. The printer's camera stays first; the Room view is a second view to
// switch to, stands in with the printer camera's reason when that camera is out, is a still by default and live on
// request, turns a quarter turn by CSS, and is never called "the camera". Rendered with tests/helpers/fake_dom.mjs.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

const ready = { state: 'ready', reason: null, viewers: 0, frame_at: Date.now() / 1000, rotate: 0 };
const down = (reason) => ({ state: 'unavailable', reason, viewers: 0, frame_at: null, rotate: 0 });
const camUp = { ok: true, source: 'Pi', sources: {} };
const camOff = { ok: false, reason: 'liveview_off', sources: { Pi: { up: false } } };

async function mod() {
  const dom = install();
  const ws = await import('../hub/static/js/workshop.js');
  return { dom, ws };
}

const pressed = (el) => el.querySelectorAll('.ws-cam-switch button')
  .map((b) => [text(b), b.getAttribute('aria-pressed')]);

test('choice: the printer camera first, the Room view when picked, standing in when the printer camera is out', async () => {
  const { dom, ws } = await mod();
  try {
    assert.deepEqual(ws.cameraChoice(camUp, ready, 'printer'), { view: 'printer', switcher: true, standIn: false });
    assert.deepEqual(ws.cameraChoice(camUp, ready, 'room'), { view: 'room', switcher: true, standIn: false });
    assert.deepEqual(ws.cameraChoice(camOff, ready, 'printer'), { view: 'room', switcher: false, standIn: true });
    assert.deepEqual(ws.cameraChoice(camOff, down('not_detected'), 'printer'), { view: 'none', switcher: false, standIn: false });
    // No Room view state (not signed in, or the hub didn't answer): exactly the page as before A17.
    assert.deepEqual(ws.cameraChoice(camUp, null, 'room'), { view: 'printer', switcher: false, standIn: false });
    assert.deepEqual(ws.cameraChoice(camOff, null, 'room'), { view: 'printer', switcher: false, standIn: false });
  } finally { dom.uninstall(); }
});

test('preference: kept per device, junk or blocked storage is the printer camera', async () => {
  const { dom, ws } = await mod();
  try {
    const box = new Map();
    const store = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, String(v)) };
    assert.equal(ws.readCamPref(store), 'printer');
    ws.writeCamPref('room', store);
    assert.equal(ws.readCamPref(store), 'room');
    box.set('hub-workshop-camera', '"junk"');
    assert.equal(ws.readCamPref(store), 'printer');
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(ws.readCamPref(blocked), 'printer');
    ws.writeCamPref('room', blocked); // no throw
  } finally { dom.uninstall(); }
});

test('printer camera up: two buttons, the printer camera pressed, and its picture', async () => {
  const { dom, ws } = await mod();
  try {
    const a = ws.cameraAside(camUp, { room: ready, pref: 'printer' });
    assert.deepEqual(pressed(a), [['Printer camera', 'true'], ['Room view', 'false']]);
    assert.equal(a.querySelector('.ws-cam-switch').getAttribute('role'), 'group');
    assert.ok(a.querySelector('img.cam-img[data-refresh="/api/camera.jpg"]'));
    assert.ok(!a.querySelector('.room-img'));
  } finally { dom.uninstall(); }
});

test('Room view picked: its still, refreshed, with Watch live; never called "the camera"', async () => {
  const { dom, ws } = await mod();
  try {
    const a = ws.cameraAside(camUp, { room: ready, pref: 'room' });
    assert.deepEqual(pressed(a), [['Printer camera', 'false'], ['Room view', 'true']]);
    const img = a.querySelector('img.room-img');
    assert.equal(img.dataset.refresh, '/api/camera/room.jpg');
    assert.match(img.getAttribute('alt'), /^Room view/);
    assert.equal(text(a.querySelector('[data-key="room-live"]')), 'Watch live');
    const words = text(a);
    assert.match(words, /Room view/);
    assert.doesNotMatch(words, /\bthe camera\b/i);
    assert.doesNotMatch(words, /printer's camera/i);
  } finally { dom.uninstall(); }
});

test("stand-in: the printer camera is out, the Room view shows with that camera\'s reason in words", async () => {
  const { dom, ws } = await mod();
  try {
    const a = ws.cameraAside(camOff, { room: ready, pref: 'printer' });
    assert.ok(!a.querySelector('.ws-cam-switch'), 'nothing to switch to');
    assert.ok(a.querySelector('img.room-img'));
    assert.match(text(a), /Room view\. The printer's camera is unavailable: LAN Only Liveview is off on the printer\./);
    const unreachable = ws.cameraAside({ ok: false, reason: 'printer_unreachable' }, { room: ready });
    assert.match(text(unreachable), /unavailable: the printer isn't answering on the network\./);
  } finally { dom.uninstall(); }
});

test('both out: "No camera" with both reasons, and no picture', async () => {
  const { dom, ws } = await mod();
  try {
    const a = ws.cameraAside(camOff, { room: down('not_detected') });
    assert.equal(text(a.querySelector('.ws-cam-word')), 'No camera');
    assert.match(text(a), /LAN Only Liveview/);
    assert.match(text(a), /The Pi's camera isn't detected\. Check its ribbon cable\./);
    assert.ok(!a.querySelector('img'));
  } finally { dom.uninstall(); }
});

test('Room view picked but unavailable: says why in its place, the switch stays to go back', async () => {
  const { dom, ws } = await mod();
  try {
    const a = ws.cameraAside(camUp, { room: down('capture_failed'), pref: 'room' });
    assert.deepEqual(pressed(a), [['Printer camera', 'false'], ['Room view', 'true']]);
    assert.match(text(a), /The Pi's camera isn't giving pictures right now\./);
    assert.ok(!a.querySelector('img'));
    assert.ok(!a.querySelector('[data-key="room-live"]'));
  } finally { dom.uninstall(); }
});

test('live: the stream and Stop live; stopped, the still and Watch live again', async () => {
  const { dom, ws } = await mod();
  try {
    const a = ws.cameraAside(camUp, { room: ready, pref: 'room', live: { on: true } });
    const img = a.querySelector('img.room-img');
    assert.match(img.getAttribute('src'), /^\/api\/camera\/room\/live/);
    assert.equal(img.dataset.refresh, undefined, 'live is never swapped for stills');
    assert.equal(text(a.querySelector('[data-key="room-live"]')), 'Stop live');
    const stopped = ws.cameraAside(camUp, { room: ready, pref: 'room', live: { on: false, note: ws.LIVE_PAUSED } });
    assert.equal(text(stopped.querySelector('[data-key="room-live"]')), 'Watch live');
    assert.ok(stopped.querySelector('img.room-img[data-refresh]'), 'stills continue');
    // The note is the page's one status line (so it is announced), not part of the redrawn aside.
    assert.ok(!stopped.querySelector('.ws-cam-note'));
  } finally { dom.uninstall(); }
});

test('rotation: a quarter turn is a class that reserves the turned shape; 0 and 180 are plain', async () => {
  const { dom, ws } = await mod();
  try {
    for (const [rotate, cls] of [[90, 'ws-cam--turn90'], [270, 'ws-cam--turn270']]) {
      const a = ws.cameraAside(camUp, { room: { ...ready, rotate }, pref: 'room' });
      assert.ok(a.querySelector(`.ws-cam.${cls} .ws-cam-frame img.room-img`), cls);
    }
    for (const rotate of [0, 180, 45]) {
      const a = ws.cameraAside(camUp, { room: { ...ready, rotate }, pref: 'room' });
      assert.ok(!a.querySelector('.ws-cam--turn90, .ws-cam--turn270'), String(rotate));
    }
  } finally { dom.uninstall(); }
});

test('without a Room view state the aside is exactly the old one', async () => {
  const { dom, ws } = await mod();
  try {
    const a = ws.cameraAside(camOff);
    assert.match(text(a), /Camera unavailable/);
    assert.ok(!a.querySelector('.ws-cam-switch'));
  } finally { dom.uninstall(); }
});

test('CSS: the turned frame, the 4:3 picture and no motion are defined', () => {
  const css = readFileSync(new URL('../hub/static/workshop-pi-rich.css', import.meta.url), 'utf8');
  assert.match(css, /#view \.ws-cam--turn90 \.ws-cam-frame img[^{]*\{[^}]*rotate\(90deg\)/);
  assert.match(css, /#view \.ws-cam--turn270 \.ws-cam-frame img[^{]*\{[^}]*rotate\(270deg\)/);
  // Held to the page's #view img rule, the turned picture would sit inside its frame instead of filling it.
  assert.match(css, /#view \.ws-cam--turn90 \.ws-cam-frame img, #view \.ws-cam--turn270 \.ws-cam-frame img \{[^}]*max-width: none/);
  // The picture's shape is its live preset's (A18): --w by --h on the figure, 4:3 when not given.
  assert.match(css, /\.room-img \{[^}]*aspect-ratio: var\(--w, 4\) \/ var\(--h, 3\)/);
  assert.match(css, /ws-cam--turn270 \.ws-cam-frame \{[^}]*aspect-ratio: var\(--h, 3\) \/ var\(--w, 4\)/);
  const room = css.slice(css.indexOf('/* Room view'), css.indexOf('.ws-skeleton {'));
  assert.ok(room.length > 100);
  assert.doesNotMatch(room.replace(/\/\*[\s\S]*?\*\//g, ''), /transition|animation/);
});

// The page itself, loaded with stubbed answers (as tests/test_workshop_render.mjs does).
const T = Math.floor(Date.now() / 1000);
const workshop = { printer: { state: 'idle', headline: 'Idle', detail: '', progress: 0, stale: false, actions: [], telemetry: { status: 'live', source: 'Bambuddy' } },
  prints: [], prints_available: true, week: { finished: 0, hours: 0 }, spools: [], ams_trays: [], lab: { needs: [], active: [], questions: [] },
  filament_month: { prints_logged: 0 }, as_of: T };

async function page(routes) {
  const dom = install({ fetch: { '/api/workshop': workshop, '/api/projects': { available: true, projects: [] }, ...routes } });
  const kit = { exports: {} };
  new Function('module', readFileSync(new URL('../hub/static/ui/needs.js', import.meta.url), 'utf8'))(kit);
  globalThis.ApplianceNeeds = kit.exports;
  const core = await import('../hub/static/js/core.js');
  core.forgetMe();
  const ws = await import('../hub/static/js/workshop.js');
  const state = { root: dom.root() };
  ws.mount(state);
  return { dom, state, ws, done() { ws.leave(state); dom.uninstall(); } };
}

test('page: the owner, with the printer camera out: the Room view stands in on load', async () => {
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camOff, '/api/camera/room': ready });
  try {
    await p.ws.load(p.state);
    const aside = p.state.root.querySelector('.ui-faceplate__aside');
    assert.ok(aside.querySelector('img.room-img'));
    assert.match(text(aside), /The printer's camera is unavailable: LAN Only Liveview is off/);
  } finally { p.done(); }
});

test('page: anyone but the owner (signed out, or household): the Room view is never asked for, the aside as before', async () => {
  for (const role of ['none', 'household']) {
    let asked = 0;
    const p = await page({ '/api/me': { role }, '/api/camera': camOff, '/api/camera/room': () => { asked += 1; return ready; } });
    try {
      await p.ws.load(p.state);
      assert.equal(asked, 0, role);
      assert.match(text(p.state.root.querySelector('.ui-faceplate__aside')), /Camera unavailable/);
    } finally { p.done(); }
  }
});

test('page: picking the Room view switches, and the printer camera coming back puts the view back on it', async () => {
  let cam = camUp;
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': () => cam, '/api/camera/room': ready });
  try {
    await p.ws.load(p.state);
    p.state.root.querySelector('[data-key="cam-room"]').click();
    assert.ok(p.state.root.querySelector('.ui-faceplate__aside img.room-img'));
    cam = camOff;
    await p.ws.load(p.state);
    cam = camUp;
    await p.ws.load(p.state);
    assert.deepEqual(pressed(p.state.root.querySelector('.ui-faceplate__aside')), [['Printer camera', 'true'], ['Room view', 'false']]);
  } finally { p.done(); }
});

test('page: Watch live starts the stream and keeps focus on its button; Stop live goes back to the still', async () => {
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camOff, '/api/camera/room': ready });
  try {
    await p.ws.load(p.state);
    const watch = p.state.root.querySelector('[data-key="room-live"]');
    watch.focus();
    watch.click();
    const img = p.state.root.querySelector('img.room-img');
    assert.match(img.getAttribute('src'), /\/api\/camera\/room\/live/);
    assert.equal(text(p.dom.document.activeElement), 'Stop live');
    await p.ws.load(p.state); // a refresh while live leaves the stream alone
    assert.equal(p.state.root.querySelector('img.room-img'), img);
    p.state.root.querySelector('[data-key="room-live"]').click();
    assert.ok(p.state.root.querySelector('img.room-img[data-refresh]'));
  } finally { p.done(); }
});

test('page: live fails with four watching: the busy note in the one status line, kept across redraws', async () => {
  let room = ready;
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camOff, '/api/camera/room': () => room });
  try {
    await p.ws.load(p.state);
    const note = p.state.root.querySelector('.ws-cam-note');
    assert.equal(note.getAttribute('role'), 'status');
    assert.equal(text(note), '');
    p.state.root.querySelector('[data-key="room-live"]').click();
    room = { ...ready, viewers: 4 };
    await p.state.root.querySelector('img.room-img').onerror();
    assert.equal(p.state.live.on, false);
    assert.equal(p.state.root.querySelector('.ws-cam-note'), note, 'the same status element, so the change is heard');
    assert.equal(text(note), 'Live is busy: four people are already watching.');
    assert.ok(p.state.root.querySelector('img.room-img[data-refresh]'));
  } finally { p.done(); }
});

test('page: a stale live failure does not stop the session started after it', async () => {
  let answer;
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camOff, '/api/camera/room': () => answer ?? ready });
  try {
    await p.ws.load(p.state);
    p.state.root.querySelector('[data-key="room-live"]').click();
    let release;
    answer = new Promise((r) => { release = r; });
    const failing = p.state.root.querySelector('img.room-img').onerror();
    p.state.root.querySelector('[data-key="room-live"]').click(); // Stop live
    p.state.root.querySelector('[data-key="room-live"]').click(); // Watch live again
    release(ready);
    await failing;
    assert.equal(p.state.live.on, true);
    assert.match(p.state.root.querySelector('img.room-img').getAttribute('src'), /\/live/);
  } finally { p.done(); }
});

test('page: the Room view going unavailable mid-live closes the stream instead of leaving it open', async () => {
  let room = ready;
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camUp, '/api/camera/room': () => room });
  try {
    await p.ws.load(p.state);
    p.state.root.querySelector('[data-key="cam-room"]').click();
    p.state.root.querySelector('[data-key="room-live"]').click();
    const live = p.state.root.querySelector('img.room-img');
    room = down('capture_failed');
    await p.ws.load(p.state);
    assert.equal(p.state.live.on, false);
    assert.equal(live.getAttribute('src'), null, 'its src is gone, so the connection closes');
    assert.match(text(p.state.root.querySelector('.ui-faceplate__aside')), /Room view unavailable/);
    room = ready;
    await p.ws.load(p.state);
    assert.ok(p.state.root.querySelector('img.room-img[data-refresh]'), 'it comes back as a still, never live by itself');
  } finally { p.done(); }
});

test('page: a printer camera read that times out keeps the Room view chosen', async () => {
  let cam = camUp;
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': () => cam, '/api/camera/room': ready });
  try {
    await p.ws.load(p.state);
    p.state.root.querySelector('[data-key="cam-room"]').click();
    cam = new Error('no answer'); // the hub didn't answer: not the printer saying its camera is out
    await p.ws.load(p.state);
    cam = camUp;
    await p.ws.load(p.state);
    assert.deepEqual(pressed(p.state.root.querySelector('.ui-faceplate__aside')), [['Printer camera', 'false'], ['Room view', 'true']]);
  } finally { p.done(); }
});

test('page: a still that arrives after leaving is dropped, with no picture made for it', async () => {
  let release;
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camOff, '/api/camera/room': ready,
    '/api/camera/room.jpg': () => new Promise((r) => { release = r; }) });
  try {
    await p.ws.load(p.state);
    const img = p.state.root.querySelector('img.room-img[data-refresh]');
    const before = img.getAttribute('src');
    const pending = p.ws.refreshRoomStill(p.state, img);
    await new Promise((r) => setTimeout(r, 0));
    p.ws.leave(p.state);
    release({});
    await pending;
    assert.equal(p.state.roomUrl ?? null, null);
    assert.equal(img.getAttribute('src'), before);
  } finally { p.done(); }
});


// ---- Camera settings (A18 P2) ----

const CONTROLS = [
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
const SETTINGS = { turn: 90, mirror: false, zoom: 1, centre_x: 50, ev: 0, manual: false, shutter: 33333, awb: 'auto', sharpness: 1, preset: 'saver' };
const DEFAULTS = { ...SETTINGS, turn: 0 };
const model = () => ({ settings: { ...SETTINGS }, defaults: { ...DEFAULTS }, controls: CONTROLS, applying: false });
const ready90 = { ...ready, rotate: 90, size: [640, 480], engine: 'picamera2' };

const tick = () => new Promise((r) => setTimeout(r, 0));
function change(el, value) {
  if (el.type === 'checkbox') el.checked = value; else el.value = String(value);
  el.dispatchEvent({ type: el.tagName === 'INPUT' && el.type === 'range' ? 'input' : 'change', target: el });
}

test("settings fields: the hub's groups in order, each control a native input with a visible label", async () => {
  const { dom, ws } = await mod();
  try {
    const groups = ws.settingsFields(CONTROLS, SETTINGS);
    assert.deepEqual(groups.map((g) => text(g.querySelector('legend'))), ['Orientation', 'Framing', 'Light', 'Colour', 'Detail', 'Live quality']);
    const all = { children: groups };
    const q = (sel) => groups.map((g) => g.querySelector(sel)).find(Boolean);
    assert.equal(q('#set-turn').tagName, 'SELECT');
    assert.equal(q('#set-turn option[selected]').getAttribute('value'), '90');
    assert.equal(q('#set-mirror').getAttribute('type'), 'checkbox');
    assert.equal(q('#set-zoom').getAttribute('type'), 'range');
    assert.equal(q('#set-zoom').getAttribute('step'), '0.5');
    assert.equal(text(q('label[for="set-ev"]')), 'Exposure compensation 0 EV');
    assert.equal(q('#set-ev').getAttribute('aria-describedby'), 'set-ev-err');
    assert.equal(q('label[for="set-preset"]').getAttribute('class'), 'sr', 'not shown twice under its own heading');
    assert.equal(q('label[for="set-turn"]').getAttribute('class'), null);
    assert.match(text(q('#set-preset')), /Data saver \(about 1\.4 Mbit\/s\).*Sharp \(about 22 Mbit\/s\)/);
    void all;
  } finally { dom.uninstall(); }
});

async function ownerPage(extra = {}, room = ready90) {
  globalThis.localStorage?.removeItem?.('hub-workshop-camera');  // not every Node has localStorage (the Pi's 20 doesn't)
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camOff, '/api/camera/room': room,
    '/api/camera/room/settings': model(), '/api/camera/room.jpg': {}, ...extra });
  await p.ws.load(p.state);
  await tick();
  return p;
}
const panel = (p) => p.state.root.querySelector('details.ws-set');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bar = (p, key) => p.state.root.querySelector(`.ws-bars [data-key="${key}"]`);
// Open Adjust and let the live picture's first frame arrive, so the controls on the picture can take a change.
async function adjusting(p) {
  const d = panel(p);
  d.open = true;
  d.dispatchEvent({ type: 'toggle', target: d });
  await tick(); await tick();
  const img = p.state.root.querySelectorAll('img.room-img').find((i) => !i.dataset.refresh);
  img.naturalWidth = 384;
  img.onload?.();
  return d;
}

test("page: the owner gets a closed Camera settings panel under the Room view, drawn from the hub's table", async () => {
  const p = await ownerPage();
  try {
    const d = panel(p);
    assert.ok(d && !d.hidden && !d.open);
    assert.equal(text(d.querySelector('summary > span')), 'Adjust');
    assert.ok(d.querySelector('.ws-set-unsaved').hidden, 'nothing unsaved is running');
    // Orientation's controls and Zoom are on the picture now (A23 D2); the centre stays until drag to frame (P3).
    // One fieldset per tab (Light, Colour, Detail: A23 D6), and Framing below them until drag replaces the centre.
    assert.equal(d.querySelectorAll('fieldset').length, 4);
    assert.ok(!d.querySelector('#set-turn') && !d.querySelector('#set-mirror') && !d.querySelector('#set-zoom'));
    assert.equal(text(d.querySelector('.ws-set-note')), '');
    assert.equal(d.querySelector('.ws-set-note').getAttribute('role'), 'status');
  } finally { p.done(); }
});

test('page: not the owner, or the printer camera chosen: no settings panel', async () => {
  const p = await page({ '/api/me': { role: 'household' }, '/api/camera': camOff, '/api/camera/room': ready });
  try {
    await p.ws.load(p.state);
    assert.ok(!panel(p) || panel(p).hidden);
  } finally { p.done(); }
  const q = await page({ '/api/me': { role: 'owner' }, '/api/camera': camUp, '/api/camera/room': ready, '/api/camera/room/settings': model() });
  try {
    await q.ws.load(q.state);
    assert.ok(panel(q).hidden, 'the printer camera is the chosen view');
    q.state.root.querySelector('[data-key="cam-room"]').click();
    assert.ok(!panel(q).hidden);
  } finally { q.done(); }
});

test('page: an edit says not applied yet, enables what depends on it, and survives the aside being redrawn', async () => {
  let room = ready90;
  const p = await ownerPage({ '/api/camera/room': () => room, '/api/camera/room/live-controls': (u, o) => JSON.parse(o.body) });
  try {
    const d = await adjusting(p);
    assert.ok(d.querySelector('#set-centre_x').disabled, 'centre only means something when zoomed');
    assert.ok(d.querySelector('#set-shutter').disabled, 'shutter only with manual exposure');
    const zoom = bar(p, 'bar-zoom-in');
    zoom.click();
    zoom.click();
    assert.equal(text(d.querySelector('.ws-set-note')), 'Not saved.');
    assert.equal(text(p.state.root.querySelector('.ws-bar-line')), 'Camera zoom 2×');
    assert.ok(!d.querySelector('#set-centre_x').disabled);
    change(d.querySelector('#set-manual'), true);
    assert.ok(!d.querySelector('#set-shutter').disabled);
    room = { ...ready90, rotate: 270 };  // the aside redraws
    await p.ws.load(p.state);
    assert.equal(panel(p), d);
    assert.ok(d.open);
    assert.equal(bar(p, 'bar-zoom-in'), zoom, 'the same button, moved into the new frame, not a rebuilt one');
    assert.equal(p.state.set.draft.zoom, 2);
    assert.equal(text(d.querySelector('.ws-set-note')), 'Not saved.');
  } finally { p.done(); }
});

test('page: Apply sends every setting, says Applied, and the picture takes the new shape', async () => {
  let sent;
  const p = await ownerPage({ '/api/camera/room/settings': (url, opts) => {
    if (opts?.method === 'POST') {
      sent = JSON.parse(opts.body);
      return { ...model(), settings: sent, state: { ...ready90, size: [1920, 1080] } };
    }
    return model();
  } });
  try {
    const d = panel(p);
    change(d.querySelector('#set-preset'), 'sharp');
    d.querySelector('[data-key="cam-apply"]').click();
    assert.equal(text(d.querySelector('.ws-set-note')), 'Applying…');
    assert.equal(d.querySelector('[data-key="cam-apply"]').getAttribute('aria-disabled'), 'true');
    await tick(); await tick(); await tick();
    assert.deepEqual(Object.keys(sent).sort(), Object.keys(SETTINGS).sort());
    assert.equal(sent.preset, 'sharp');
    assert.equal(text(d.querySelector('.ws-set-note')), 'Applied.');
    assert.equal(d.querySelector('[data-key="cam-apply"]').getAttribute('aria-disabled'), null);
    assert.match(p.state.root.querySelector('figure.ws-cam--room').style.cssText, /--w: 1920; --h: 1080/);
  } finally { p.done(); }
});

function withStatus(p, status, body) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (opts?.method === 'POST' && String(url).startsWith('/api/camera/room/settings')
    ? new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) : real(url, opts));
}

test('page: a refused setting is named beside its field, focused, and nothing is applied', async () => {
  const p = await ownerPage();
  try {
    withStatus(p, 422, { field: 'ev', reason: 'Exposure compensation is from -2 to 2.' });
    const d = panel(p);
    change(d.querySelector('#set-ev'), 1);
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    assert.equal(text(d.querySelector('.ws-set-note')), 'Not applied: Exposure compensation is from -2 to 2.');
    const err = d.querySelector('#set-ev-err');
    assert.ok(!err.hidden);
    assert.equal(text(err), 'Exposure compensation is from -2 to 2.');
    assert.equal(d.querySelector('#set-ev').getAttribute('aria-invalid'), 'true');
    assert.equal(p.dom.document.activeElement, d.querySelector('#set-ev'));
    change(d.querySelector('#set-ev'), 0.5);  // editing the field clears its reason
    assert.ok(d.querySelector('#set-ev-err').hidden);
  } finally { p.done(); }
});

test('page: busy and no answer each say so, and change nothing', async () => {
  const p = await ownerPage();
  try {
    const d = panel(p);
    withStatus(p, 409, { field: null, reason: 'The camera is still applying the last change.' });
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    assert.equal(text(d.querySelector('.ws-set-note')), 'The camera is still applying the last change.');
    globalThis.fetch = async () => { throw new Error('offline'); };
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick();
    assert.equal(text(d.querySelector('.ws-set-note')), "The hub didn't answer. Nothing changed.");
    assert.equal(p.state.set.model.settings.turn, 90);
  } finally { p.done(); }
});

test('page: Reset asks first; declined, nothing is sent', async () => {
  let posts = 0;
  const p = await ownerPage({ '/api/camera/room/settings/reset': () => { posts += 1; return { ...model(), settings: { ...DEFAULTS } }; } });
  try {
    globalThis.ApplianceConfirm = { ask: async () => false };
    panel(p).querySelector('[data-key="cam-reset"]').click();
    await tick(); await tick();
    assert.equal(posts, 0);
    globalThis.ApplianceConfirm = { ask: async () => true };
    panel(p).querySelector('[data-key="cam-reset"]').click();
    await tick(); await tick(); await tick(); await tick();
    assert.equal(posts, 1);
    assert.equal(text(panel(p).querySelector('.ws-set-note')), 'Every setting is back to its default.');
    assert.equal(p.state.set.draft.turn, 0, 'the draft is what the hub stored');
    await adjusting(p);
    assert.equal(text(bar(p, 'bar-turn')), 'Turn 0°', 'the picture shows what the hub stored');
  } finally { p.done(); }
});

test('page: the camera failing locks the fields but keeps Reset; not detected locks both', async () => {
  const p = await ownerPage({}, down('capture_failed'));
  try {
    const d = panel(p);
    assert.ok(!d.hidden, 'still there, so a setting that broke the capture can be reset');
    assert.ok([...d.querySelectorAll('fieldset')].every((f) => f.disabled));
    assert.ok(d.querySelector('[data-key="cam-apply"]').disabled);
    assert.ok(!d.querySelector('[data-key="cam-reset"]').disabled);
    assert.match(text(d.querySelector('.ws-set-note')), /Reset to defaults puts every setting back/);
  } finally { p.done(); }
  const q = await ownerPage({ '/api/camera': camUp }, down('not_detected'));
  try {
    q.state.root.querySelector('[data-key="cam-room"]').click();  // the Room view chosen, saying why it's out
    const d = panel(q);
    assert.ok(!d.hidden);
    assert.ok(d.querySelector('[data-key="cam-reset"]').disabled);
    assert.match(text(d.querySelector('.ws-set-note')), /isn't detected/);
  } finally { q.done(); }
});

test('page: the hub not answering for the settings says so instead of an empty panel', async () => {
  const p = await ownerPage({ '/api/camera/room/settings': new Error('down') });
  try {
    assert.match(text(panel(p).querySelector('.ws-set-body')), /The hub didn't answer/);
    assert.ok(panel(p).querySelector('[data-key="cam-apply"]').disabled);
  } finally { p.done(); }
});

test('CSS: the settings panel has no motion and wraps its groups', () => {
  const css = readFileSync(new URL('../hub/static/workshop-pi-rich.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* Camera settings (amendment A18)'), css.indexOf('.ws-skeleton {'));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ''), /transition|animation/);
  assert.match(block, /\.ws-set-body \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 15rem\), 1fr\)\)/);
});

// ---- P2 review fixes ----

test('page: the fields lock while applying, so nothing edited then is lost', async () => {
  let release;
  const p = await ownerPage({ '/api/camera/room/settings': (url, opts) => (opts?.method === 'POST'
    ? new Promise((r) => { release = () => r({ ...model(), settings: JSON.parse(opts.body), state: ready90 }); }) : model()) });
  try {
    const d = panel(p);
    change(d.querySelector('#set-ev'), 1);
    d.querySelector('[data-key="cam-apply"]').click();
    await tick();
    assert.ok([...d.querySelectorAll('fieldset')].every((f) => f.disabled));
    release();
    await tick(); await tick(); await tick();
    assert.ok([...d.querySelectorAll('fieldset')].every((f) => !f.disabled));
    assert.equal(text(d.querySelector('.ws-set-note')), 'Applied.');
  } finally { p.done(); }
});

test('page: a room read that began before an apply answered does not undo the new picture shape', async () => {
  let roomAnswer = ready90;
  let hold = null;
  const p = await ownerPage({
    '/api/camera/room': () => (hold ? hold.promise : roomAnswer),
    '/api/camera/room/settings': (url, opts) => (opts?.method === 'POST'
      ? { ...model(), settings: JSON.parse(opts.body), state: { ...ready90, size: [1920, 1080] } } : model()),
  });
  try {
    let resolve;
    hold = { promise: new Promise((r) => { resolve = r; }) };
    const slowLoad = p.ws.load(p.state);  // started before the apply, answers after it
    await tick();
    hold = null;
    panel(p).querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    resolve(ready90);  // the old shape
    await slowLoad;
    assert.match(p.state.root.querySelector('figure.ws-cam--room').style.cssText, /--w: 1920; --h: 1080/);
  } finally { p.done(); }
});

test('page: after Applied, the camera failing says why and that Reset puts it back', async () => {
  let room = ready90;
  const p = await ownerPage({ '/api/camera/room': () => room });
  try {
    const d = panel(p);
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    assert.equal(text(d.querySelector('.ws-set-note')), 'Applied.');
    room = down('capture_failed');
    p.state.set.appliedAt = 0;  // a later read, not one from before the apply
    await p.ws.load(p.state);
    assert.match(text(d.querySelector('.ws-set-note')), /Reset to defaults puts every setting back/);
  } finally { p.done(); }
});

test('page: a still that failed while an apply restarted the camera does not lock the panel', async () => {
  let fail;
  const p = await ownerPage({ '/api/camera/room.jpg': () => new Promise((r) => { fail = () => r(undefined); }) });
  try {
    const img = p.state.root.querySelector('img.room-img[data-refresh]');
    const pending = p.ws.refreshRoomStill(p.state, img);  // asked before the apply
    await tick();
    panel(p).querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    fail();  // 503 during the restart
    await pending;
    assert.equal(p.state.room.state, 'ready');
    assert.ok(!panel(p).querySelector('[data-key="cam-apply"]').disabled);
  } finally { p.done(); }
});

test('page: a refusal for a field that cannot take focus moves focus to the status line', async () => {
  const p = await ownerPage();
  try {
    withStatus(p, 422, { field: 'centre_x', reason: 'Centre across is from 0 to 100.' });
    const d = panel(p);
    assert.ok(d.querySelector('#set-centre_x').disabled, 'zoom is 1×');
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    assert.equal(p.dom.document.activeElement, d.querySelector('.ws-set-note'));
    assert.equal(text(d.querySelector('#set-centre_x-err')), 'Centre across is from 0 to 100.');
  } finally { p.done(); }
});

test('page: Reset after a failed capture checks for a picture and unlocks when there is one', async () => {
  const p = await ownerPage({ '/api/camera/room/settings/reset': () => ({ ...model(), settings: { ...DEFAULTS }, state: down('capture_failed') }) },
    down('capture_failed'));
  try {
    globalThis.ApplianceConfirm = { ask: async () => true };
    const d = panel(p);
    assert.ok([...d.querySelectorAll('fieldset')].every((f) => f.disabled));
    d.querySelector('[data-key="cam-reset"]').click();
    for (let i = 0; i < 8; i += 1) await tick();
    assert.equal(p.state.room.state, 'ready', 'a picture came back, so the camera is no longer out');
    assert.ok([...d.querySelectorAll('fieldset')].every((f) => !f.disabled));
  } finally { p.done(); }
});

// ---- P3: Live sliders, quick looks, Save & fallback engine ----

test('page: opening settings starts live stream and loads quick looks', async () => {
  const p = await ownerPage({
    '/api/camera/room/looks': { looks: [
      { name: 'Night', builtin: true, values: { ev: 1.5 } },
      { name: 'Custom Look', builtin: false, values: { contrast: 1.2 } },
    ] },
  });
  try {
    const d = panel(p);
    assert.equal(p.state.live.on, false);
    d.open = true;
    d.dispatchEvent({ type: 'toggle', target: d });
    await tick(); await tick();
    assert.equal(p.state.live.on, true, 'live stream automatically started');
    // Auto first and Save this look last (A23 D5).
    assert.deepEqual(d.querySelectorAll('.ws-look-chip').map(text), ['Auto', 'Night', 'Custom Look', 'Save this look']);
  } finally { p.done(); }
});

test('page: tapping a quick look applies its values and marks chip active', async () => {
  let liveSent = [];
  const p = await ownerPage({
    '/api/camera/room/looks': { looks: [
      { name: 'Night', builtin: true, values: { ev: 1.5, brightness: 0.1 } },
    ] },
    '/api/camera/room/live-controls': (url, opts) => {
      liveSent.push(JSON.parse(opts.body));
      return { ok: true };
    },
  });
  try {
    const d = panel(p);
    d.open = true;
    d.dispatchEvent({ type: 'toggle', target: d });
    await tick(); await tick();
    const nightChip = d.querySelector('[data-key="look-Night"]');
    assert.ok(nightChip);
    nightChip.click();
    await tick();
    const updatedChip = d.querySelector('[data-key="look-Night"]');
    assert.equal(updatedChip.getAttribute('aria-pressed'), 'true');
    assert.equal(p.state.set.draft.ev, 1.5);
    assert.equal(p.state.set.draft.brightness, 0.1);
  } finally { p.done(); }
});

test('page: fallback engine rpicam shows Apply with fallback notice', async () => {
  const p = await ownerPage({}, { ...ready90, engine: 'rpicam' });
  try {
    const d = panel(p);
    assert.ok(!d.querySelector('[data-key="cam-apply"]').hidden, 'Apply is shown');
    assert.ok(d.querySelector('[data-key="cam-save"]').hidden, 'Save is hidden');
    assert.match(text(d.querySelector('.ws-set-note')), /Live adjust isn't available, so changes apply with Apply/);
  } finally { p.done(); }
});

test('page: picamera2 engine shows Save button', async () => {
  const p = await ownerPage({}, { ...ready90, engine: 'picamera2' });
  try {
    const d = panel(p);
    assert.ok(d.querySelector('[data-key="cam-apply"]').hidden, 'Apply is hidden');
    assert.ok(!d.querySelector('[data-key="cam-save"]').hidden, 'Save is shown');
  } finally { p.done(); }
});

test('page: every control changes live, so none says it restarts the picture', async () => {
  const { dom, ws } = await mod();
  try {
    const groups = ws.settingsFields(CONTROLS, SETTINGS, () => {}, 'picamera2');
    assert.ok(!groups.some((g) => g.querySelector('.ws-set-restart')), 'no restart hint');
  } finally { dom.uninstall(); }
});

// ---- P4: Viewing tools & Snapshot gallery ----

test('page: viewing tools bar renders fullscreen, view zoom, grid and hist buttons', async () => {
  const p = await ownerPage();
  try {
    const aside = p.state.root.querySelector('.ui-faceplate__aside');
    const tools = aside.querySelector('.ws-view-tools');
    assert.ok(tools, 'viewing tools toolbar rendered');
    assert.ok(tools.querySelector('[data-key="cam-fullscreen"]'));
    assert.ok(tools.querySelector('[data-key="cam-view-zoom"]'));
    assert.ok(tools.querySelector('[data-key="cam-grid"]'));
    assert.ok(tools.querySelector('[data-key="cam-hist"]'));
  } finally { p.done(); }
});

test('page: toggling grid adds has-grid class to frame', async () => {
  const p = await ownerPage();
  try {
    const aside = p.state.root.querySelector('.ui-faceplate__aside');
    const gridBtn = aside.querySelector('[data-key="cam-grid"]');
    const frame = aside.querySelector('.ws-cam-frame');
    assert.ok(!frame.classList.contains('has-grid'));
    assert.equal(gridBtn.getAttribute('aria-pressed'), 'false');

    gridBtn.click();
    assert.ok(p.state.viewTools.grid);
    const updatedFrame = p.state.root.querySelector('.ws-cam-frame');
    assert.ok(updatedFrame.classList.contains('has-grid'));
  } finally { p.done(); }
});

test('page: a viewing tool changes the picture where it stands: the frame and the image are the same elements', async () => {
  const p = await ownerPage();
  try {
    const aside = p.state.root.querySelector('.ui-faceplate__aside');
    const frame = aside.querySelector('.ws-cam-frame');
    const img = frame.querySelector('img');
    const srcAtStart = img.getAttribute('src');
    aside.querySelector('[data-key="cam-grid"]').click();
    aside.querySelector('[data-key="cam-view-zoom"]').click();
    frame.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault() {} });
    aside.querySelector('[data-key="cam-hist"]').click();
    const now = p.state.root.querySelector('.ws-cam-frame');
    assert.equal(now, frame, 'the frame was not rebuilt');
    assert.equal(now.querySelector('img'), img, 'the picture was not rebuilt, so a live stream is not reopened');
    assert.equal(img.getAttribute('src'), srcAtStart);
    assert.ok(frame.classList.contains('has-grid'));
    assert.equal(frame.style.getPropertyValue('--vz'), '2');
    assert.equal(frame.style.getPropertyValue('--vx'), '20px');
    assert.equal(aside.querySelector('[data-key="cam-view-zoom"]').textContent, 'View zoom: 2.0×');
    assert.equal(aside.querySelector('[data-key="cam-grid"]').getAttribute('aria-pressed'), 'true');
    assert.equal(frame.querySelector('.ws-hist-canvas').hidden, false);
    p.state.viewTools.histTimer && clearInterval(p.state.viewTools.histTimer);
  } finally { p.done(); }
});

test('page: keyboard zoom and pan keys adjust view zoom and pan', async () => {
  const p = await ownerPage();
  try {
    const aside = p.state.root.querySelector('.ui-faceplate__aside');
    const frame = aside.querySelector('.ws-cam-frame');
    assert.equal(p.state.viewTools.zoom, 1);

    // Zoom in with '+'
    frame.dispatchEvent({ type: 'keydown', key: '+', preventDefault() {} });
    assert.equal(p.state.viewTools.zoom, 1.5);

    // Pan with arrow keys
    frame.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault() {} });
    assert.equal(p.state.viewTools.panX, 20);

    // Reset with '0'
    frame.dispatchEvent({ type: 'keydown', key: '0', preventDefault() {} });
    assert.equal(p.state.viewTools.zoom, 1);
    assert.equal(p.state.viewTools.panX, 0);
  } finally { p.done(); }
});

test('page: save snapshot button sends POST /api/camera/room/snapshots and updates gallery', async () => {
  let snapSaved = false;
  const mockSnap = { id: '1700000000123', created_at: 1700000000.123, preset: 'saver' };
  const p = await ownerPage({
    '/api/camera/room/snapshots': (url, opts) => {
      if (opts?.method === 'POST') {
        snapSaved = true;
        return { snapshot: mockSnap };
      }
      return { snapshots: snapSaved ? [mockSnap] : [] };
    },
  });
  try {
    await adjusting(p);
    const snapBtn = bar(p, 'cam-snapshot');  // on the picture's bottom bar now (A23 D2)
    assert.ok(snapBtn);
    snapBtn.click();
    await tick(); await tick();

    assert.ok(snapSaved, 'snapshot POST sent');
    assert.equal(p.state.snaps.items.length, 1);
    const card = p.state.snapshotsSection.querySelector('[data-key="snap-card-1700000000123"]');
    assert.ok(card, 'snapshot card rendered in gallery');
  } finally { p.done(); }
});

test('page: delete snapshot in gallery sends DELETE /api/camera/room/snapshots/{id} after confirm', async () => {
  let deletedId = null;
  const mockSnap = { id: '1700000000123', created_at: 1700000000.123, preset: 'saver' };
  const p = await ownerPage({
    '/api/camera/room/snapshots': { snapshots: [mockSnap] },
    '/api/camera/room/snapshots/1700000000123': (url, opts) => {
      if (opts?.method === 'DELETE') {
        deletedId = '1700000000123';
        return { ok: true };
      }
      return {};
    },
  });
  try {
    const d = panel(p);
    d.open = true;
    d.dispatchEvent({ type: 'toggle', target: d });
    await tick(); await tick();

    const delBtn = p.state.snapshotsSection.querySelector('[data-key="snap-del-1700000000123"]');
    assert.ok(delBtn);
    delBtn.click();
    await tick(); await tick();

    assert.equal(deletedId, '1700000000123');
    assert.equal(p.state.snaps.items.length, 0);
  } finally { p.done(); }
});

test('page: the printer camera takes a new still every second; the Room view keeps its 2 seconds (A17 R4)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let roomStills = 0;
  const p = await page({ '/api/me': { role: 'owner' }, '/api/camera': camUp, '/api/camera/room': ready,
    '/api/camera/room.jpg': () => { roomStills += 1; return {}; } });
  try {
    await p.ws.load(p.state);
    const still = () => p.state.root.querySelector('.ui-faceplate__aside img.cam-img[data-refresh="/api/camera.jpg"]');
    const before = still().getAttribute('src');
    await new Promise((r) => setTimeout(r, 2));
    t.mock.timers.tick(1000);
    assert.notEqual(still().getAttribute('src'), before, 'a new printer still after 1 s');

    p.state.root.querySelector('[data-key="cam-room"]').click();
    roomStills = 0;
    for (let i = 0; i < 4; i += 1) {
      t.mock.timers.tick(1000);
      await new Promise((r) => setTimeout(r, 0));
    }
    assert.equal(roomStills, 2, 'two Room stills in 4 s: one every 2 s, not every second');
  } finally { p.done(); }
});

// ---- A23 P2: watching and adjusting, the controls on the picture, the live channel ----

function liveRoute(sent, answer = (b) => b) {
  return { '/api/camera/room/live-controls': (u, o) => { const b = JSON.parse(o.body); sent.push(b); return answer(b); } };
}

test('A23: watching, the picture carries no camera controls and the view tools show', async () => {
  const p = await ownerPage();
  try {
    const frame = p.state.root.querySelector('.ws-cam--room .ws-cam-frame');
    assert.ok(!frame.querySelector('.ws-bars'));
    assert.ok(!p.state.root.querySelector('.ws-view-tools').hidden);
  } finally { p.done(); }
});

test('A23: adjusting puts three bars on the picture, in reading order, and hides the watching toolbar', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    const bars = p.state.root.querySelector('.ws-cam--room .ws-cam-frame > .ws-bars');
    assert.ok(bars);
    assert.equal(bars.dataset.theme, 'dark');
    assert.deepEqual(bars.querySelectorAll('button').map((b) => b.dataset.key), ['bar-turn', 'bar-flip', 'bar-mirror',
      'bar-zoom-in', 'bar-zoom-out', 'bar-fit', 'bar-grid', 'bar-hist', 'cam-snapshot', 'bar-fullscreen']);
    assert.equal(bar(p, 'bar-zoom-in').getAttribute('aria-label'), 'Zoom in');
    assert.ok(p.state.root.querySelector('.ws-view-tools').hidden);
    const d = panel(p);
    d.open = false;
    d.dispatchEvent({ type: 'toggle', target: d });
    assert.ok(!p.state.root.querySelector('.ws-bars'), 'leaving Adjust takes them off the picture');
    assert.ok(!p.state.root.querySelector('.ws-view-tools').hidden);
  } finally { p.done(); }
});

test('A23: until the first live frame, the camera buttons are off and the badge says Starting', async () => {
  const p = await ownerPage();
  try {
    const d = panel(p);
    d.open = true;
    d.dispatchEvent({ type: 'toggle', target: d });
    await tick(); await tick();
    assert.equal(text(p.state.root.querySelector('.ws-bar-badge')), 'Starting…');
    assert.ok(bar(p, 'bar-turn').disabled && bar(p, 'cam-snapshot').disabled && bar(p, 'bar-fit').disabled);
    assert.ok(!bar(p, 'bar-grid').disabled, 'a view tool needs no camera');
    const img = p.state.root.querySelectorAll('img.room-img').find((i) => !i.dataset.refresh);
    img.naturalWidth = 384;
    img.onload();
    assert.equal(text(p.state.root.querySelector('.ws-bar-badge')), 'Live');
    assert.ok(!bar(p, 'bar-turn').disabled);
    p.ws.leave(p.state);  // live stops
  } finally { p.done(); }
});

test('A23: live stopping turns the camera buttons off with Paused', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    p.state.root.querySelector('[data-key="room-live"]').click();  // Stop live
    assert.equal(text(p.state.root.querySelector('.ws-bar-badge')), 'Paused');
    assert.ok(bar(p, 'bar-turn').disabled);
  } finally { p.done(); }
});

test('A23: four quick taps on Turn send one value, the last', async () => {
  const sent = [];
  const p = await ownerPage(liveRoute(sent));
  try {
    await adjusting(p);
    for (let i = 0; i < 3; i += 1) bar(p, 'bar-turn').click();
    bar(p, 'bar-flip').click();
    assert.equal(text(bar(p, 'bar-turn')), 'Turn 0°', 'shown at once: 90 + 3 quarter turns');
    assert.equal(bar(p, 'bar-flip').getAttribute('aria-pressed'), 'true');
    await wait(260);
    assert.deepEqual(sent, [{ values: { turn: 0, flip: true } }]);
    assert.equal(p.state.set.confirmed.turn, 0);
  } finally { p.done(); }
});

test('A23: a refused change goes back to what the camera confirmed, and says why', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts) => (String(url).startsWith('/api/camera/room/live-controls')
      ? new Response(JSON.stringify({ field: 'turn', reason: 'Turn is one of: 0°, 90°.' }), { status: 422, headers: { 'content-type': 'application/json' } })
      : real(url, opts));
    bar(p, 'bar-turn').click();
    assert.equal(text(bar(p, 'bar-turn')), 'Turn 180°');
    await wait(260);
    assert.equal(text(bar(p, 'bar-turn')), 'Turn 90°', 'back to the confirmed turn');
    assert.equal(p.state.set.draft.turn, 90);
    assert.equal(text(panel(p).querySelector('.ws-set-note')), 'Turn is one of: 0°, 90°.');
  } finally { p.done(); }
});

test('A23: no answer for a change puts it back too', async () => {
  const p = await ownerPage({ '/api/camera/room/live-controls': () => new Error('down') });
  try {
    await adjusting(p);
    bar(p, 'bar-mirror').click();
    await wait(260);
    assert.equal(bar(p, 'bar-mirror').getAttribute('aria-pressed'), 'false');
  } finally { p.done(); }
});

test('A23: a look reaches the camera whole, in one request (the one-slot defect)', async () => {
  const sent = [];
  const p = await ownerPage({ ...liveRoute(sent),
    // As the hub's table: every control changes live (A20 D1).
    '/api/camera/room/settings': { ...model(), controls: CONTROLS.map((c) => ({ ...c, live: true })) },
    '/api/camera/room/looks': { looks: [{ name: 'Night', builtin: true, values: { sharpness: 1.2, awb: 'tungsten' } }] } });
  try {
    const d = await adjusting(p);
    await tick();
    d.querySelector('[data-key="look-Night"]').click();
    await wait(260);
    assert.deepEqual(sent, [{ values: { sharpness: 1.2, awb: 'tungsten' } }]);
  } finally { p.done(); }
});

test('A23: Fit is one change of zoom and centre; zoom stops at its ends', async () => {
  const sent = [];
  const p = await ownerPage(liveRoute(sent));
  try {
    await adjusting(p);
    assert.ok(bar(p, 'bar-zoom-out').disabled, 'already at 1×');
    bar(p, 'bar-zoom-in').click();
    await wait(260);
    bar(p, 'bar-fit').click();
    await wait(260);
    assert.deepEqual(sent, [{ key: 'zoom', value: 1.5 }, { values: { zoom: 1, centre_x: 50, centre_y: 50 } }]);
    assert.equal(text(p.state.root.querySelector('.ws-bar-line')), 'Camera zoom 1×');
  } finally { p.done(); }
});

test('A23: a quarter turn moves the same bars into the redrawn frame', async () => {
  const sent = [];
  const p = await ownerPage(liveRoute(sent, (b) => ({ ...b, state: { ...ready90, rotate: 0, size: [640, 480] } })));
  try {
    await adjusting(p);
    const bars = p.state.bars.el;
    const before = bars.parentNode;
    bar(p, 'bar-turn').click();  // 90 → 180: the hub says rotate 0, so the figure is redrawn
    await wait(260);
    assert.ok(p.state.root.querySelector('figure.ws-cam--room:not(.ws-cam--turn90)') || !p.state.root.querySelector('.ws-cam--turn90'));
    assert.notEqual(bars.parentNode, before, 'a new frame');
    assert.ok(bars.isConnected && bars.parentNode.classList.contains('ws-cam-frame'));
  } finally { p.done(); }
});

test('A23: on a phone without element full screen, the frame itself moves to the overlay and back', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    const frame = p.state.root.querySelector('.ws-cam--room .ws-cam-frame');
    const imgs = () => p.dom.document.body.querySelectorAll('img.room-img').length;
    const before = imgs();
    bar(p, 'bar-fullscreen').click();
    const overlay = p.dom.document.body.querySelector('.ws-cam-fullscreen-overlay');
    assert.ok(overlay && overlay.querySelector('.ws-cam-frame') === frame, 'the same frame, not a copy');
    assert.equal(imgs(), before, 'no second picture, so no second stream');
    assert.ok(frame.querySelector('.ws-bars'), 'the bars come along');
    assert.equal(overlay.getAttribute('aria-modal'), 'true');
    overlay.querySelector('[data-key="cam-fs-close"]').click();
    assert.ok(!p.dom.document.body.querySelector('.ws-cam-fullscreen-overlay'));
    assert.equal(p.state.root.querySelector('.ws-cam--room .ws-cam-frame'), frame, 'back where it was');
  } finally { p.done(); }
});

test('A23: the summary says Unsaved changes while the camera runs a try, and not after Save', async () => {
  const p = await ownerPage({ '/api/camera/room/settings': () => ({ ...model(), state: { ...ready90, live_values: {} } }) },
    { ...ready90, live_values: { ev: 1 } });
  try {
    const d = panel(p);
    assert.ok(!d.querySelector('.ws-set-unsaved').hidden);
    assert.equal(p.state.set.draft.ev, 1, 'the panel shows what the picture shows');
    d.querySelector('[data-key="cam-save"]').click();
    await tick(); await tick(); await tick();
    assert.ok(d.querySelector('.ws-set-unsaved').hidden);
  } finally { p.done(); }
});

test('A23: on the fallback engine a tap is kept for Apply, never sent live', async () => {
  const sent = [];
  const p = await ownerPage(liveRoute(sent), { ...ready90, engine: 'rpicam' });
  try {
    await adjusting(p);
    bar(p, 'bar-flip').click();
    await wait(260);
    assert.deepEqual(sent, []);
    assert.equal(p.state.set.draft.flip, true);
    assert.match(text(panel(p).querySelector('.ws-set-note')), /apply with Apply/);
  } finally { p.done(); }
});

test('A23: a key or a tap on a bar is the bar\'s, never the view\'s zoom or pan', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    const frame = p.state.root.querySelector('.ws-cam--room .ws-cam-frame');
    frame.dispatchEvent({ type: 'keydown', key: '+', target: bar(p, 'bar-grid'), preventDefault() {} });
    assert.equal(p.state.viewTools.zoom, 1);
    frame.dispatchEvent({ type: 'keydown', key: '+', target: frame, preventDefault() {} });
    assert.equal(p.state.viewTools.zoom, 1.5);
  } finally { p.done(); }
});

test('A23 CSS: the bars stack in a grid over the picture, reach 44 px on touch and do not move', () => {
  const css = readFileSync(new URL('../hub/static/workshop-pi-rich.css', import.meta.url), 'utf8');
  const part = css.slice(css.indexOf('/* Adjust (amendment A23'), css.indexOf('/* end A23 */'));
  assert.ok(part.length > 200);
  assert.match(part, /grid-template-areas/);
  assert.match(part, /\.ws-view-tools\[hidden\]/);
  assert.match(part, /min-height: 44px/);
  assert.doesNotMatch(part.replace(/\/\*[\s\S]*?\*\//g, ''), /transition|animation|#[0-9a-f]{3,6}\b|rgba?\(/i);
});

// ---- A23 P2 review findings ----

test('A23: the first live frame does not redraw the picture (no second stream)', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    const img = p.state.root.querySelectorAll('img.room-img').find((i) => !i.dataset.refresh);
    await p.ws.load(p.state);
    await tick();
    assert.equal(p.state.root.querySelectorAll('img.room-img').find((i) => !i.dataset.refresh), img, 'the same live picture');
    assert.ok(!bar(p, 'bar-turn').disabled);
  } finally { p.done(); }
});

test('A23: a turn that redraws the picture keeps focus on Turn', async () => {
  const p = await ownerPage(liveRoute([], (b) => ({ ...b, state: { ...ready90, rotate: 0, size: [640, 480] } })));
  try {
    await adjusting(p);
    bar(p, 'bar-turn').focus();
    bar(p, 'bar-turn').click();
    await wait(260);
    assert.equal(p.dom.document.activeElement, bar(p, 'bar-turn'));
  } finally { p.done(); }
});

test('A23: in the iPhone overlay, Grid draws on the picture and stopping live closes the stream', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    const frame = p.state.root.querySelector('.ws-cam--room .ws-cam-frame');
    const img = frame.querySelector('img.room-img');
    bar(p, 'bar-fullscreen').click();
    frame.querySelector('[data-key="bar-grid"]').click();
    assert.ok(frame.classList.contains('has-grid'));
    p.state.root.querySelector('[data-key="room-live"]').click();  // Stop live
    assert.equal(img.getAttribute('src'), null, 'the picture let go of its stream');
    assert.ok(!p.dom.document.body.querySelector('.ws-cam-fullscreen-overlay'));
  } finally { p.done(); }
});
