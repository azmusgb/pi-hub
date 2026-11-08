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

test('stand-in: the printer camera is out, the Room view shows with that camera\'s reason in words', async () => {
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
  assert.match(css, /\.room-img \{[^}]*aspect-ratio: 4 \/ 3/);
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
