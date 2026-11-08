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
const ready90 = { ...ready, rotate: 90, size: [640, 480] };

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

test("page: the owner gets a closed Camera settings panel under the Room view, drawn from the hub's table", async () => {
  const p = await ownerPage();
  try {
    const d = panel(p);
    assert.ok(d && !d.hidden && !d.open);
    assert.equal(text(d.querySelector('summary')), 'Camera settings');
    assert.equal(d.querySelectorAll('fieldset').length, 6);
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
  const p = await ownerPage({ '/api/camera/room': () => room });
  try {
    const d = panel(p);
    d.open = true;
    assert.ok(d.querySelector('#set-centre_x').disabled, 'centre only means something when zoomed');
    assert.ok(d.querySelector('#set-shutter').disabled, 'shutter only with manual exposure');
    const zoom = d.querySelector('#set-zoom');
    change(zoom, 2);
    assert.equal(text(d.querySelector('.ws-set-note')), 'Not applied yet.');
    assert.equal(text(d.querySelector('label[for="set-zoom"] output')), '2 ×');
    assert.ok(!d.querySelector('#set-centre_x').disabled);
    change(d.querySelector('#set-manual'), true);
    assert.ok(!d.querySelector('#set-shutter').disabled);
    room = { ...ready90, rotate: 270 };  // the aside redraws
    await p.ws.load(p.state);
    assert.equal(panel(p), d);
    assert.ok(d.open);
    assert.equal(d.querySelector('#set-zoom'), zoom, 'the same field, not a rebuilt one');
    assert.equal(p.state.set.draft.zoom, 2);
    assert.equal(text(d.querySelector('.ws-set-note')), 'Not applied yet.');
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
    assert.equal(panel(p).querySelector('#set-turn option[selected]').getAttribute('value'), '0', 'the fields show what the hub stored');
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
