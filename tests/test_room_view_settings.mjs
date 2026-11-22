// A18 P2–P4 and A20: the Room view's Camera settings panel, quick looks, viewing tools and snapshot gallery on
// Workshop › Printer. Split from test_room_view.mjs; shared fixtures in tests/helpers/room_view.mjs.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { text } from './helpers/fake_dom.mjs';
import {
  ready, down, camUp, camOff, mod, pressed, workshop, page, CONTROLS, SETTINGS, DEFAULTS, model, ready90, tick, change, ownerPage, panel, bar, adjusting, withStatus,
} from './helpers/room_view.mjs';

// ---- Camera settings (A18 P2) ----

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

test("page: the owner gets a closed Camera settings panel under the Room view, drawn from the hub's table", async () => {
  const p = await ownerPage();
  try {
    const d = panel(p);
    assert.ok(d && !d.hidden && !d.open);
    assert.equal(text(d.querySelector('summary > span')), 'Adjust');
    assert.ok(d.querySelector('.ws-set-unsaved').hidden, 'nothing unsaved is running');
    // Orientation's controls, Zoom and the centre are on the picture now (A23 D2, D3): one fieldset per tab (Light,
    // Colour, Detail: A23 D6), and nothing left below them.
    assert.equal(d.querySelectorAll('fieldset').length, 3);
    assert.ok(!d.querySelector('#set-turn') && !d.querySelector('#set-mirror') && !d.querySelector('#set-zoom'));
    assert.ok(!d.querySelector('#set-centre_x'), 'no centre slider: drag and the arrow keys frame the camera');
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
    assert.ok(d.querySelector('#set-shutter').disabled, 'shutter only with manual exposure');
    const zoom = bar(p, 'bar-zoom-in');
    zoom.click();
    zoom.click();
    assert.equal(text(d.querySelector('.ws-set-note')), 'Not saved.');
    assert.equal(text(p.state.root.querySelector('.ws-bar-line')), 'Camera zoom 2× · drag to frame');
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
    assert.match(p.state.root.querySelector('figure.ws-cam--room').style.cssText, /--cam-w: 1920; --cam-h: 1080/);
  } finally { p.done(); }
});

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
  // One tab's controls at a time (A23 D6): the chosen panel's group and the Manual exposure fold flow into columns.
  assert.match(block, /\.ws-set-body > \[role=tabpanel\] > \.ws-set-group, \.ws-set-fold \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 15rem\), 1fr\)\)/);
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
    assert.match(p.state.root.querySelector('figure.ws-cam--room').style.cssText, /--cam-w: 1920; --cam-h: 1080/);
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
    withStatus(p, 422, { field: 'shutter', reason: 'Shutter needs manual exposure.' });
    const d = panel(p);
    assert.ok(d.querySelector('#set-shutter').disabled, 'manual exposure is off');
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    assert.equal(p.dom.document.activeElement, d.querySelector('.ws-set-note'));
    assert.equal(text(d.querySelector('#set-shutter-err')), 'Shutter needs manual exposure.');
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
