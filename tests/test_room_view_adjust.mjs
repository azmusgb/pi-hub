// A23: watching and adjusting the Room view: the controls on the picture, the live channel, drag and keys to frame
// the camera, looks as chips and the panel's tabs. Split from test_room_view.mjs; shared fixtures in
// tests/helpers/room_view.mjs.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { text } from './helpers/fake_dom.mjs';
import {
  down, mod, pressed, workshop, page, CONTROLS, SETTINGS, DEFAULTS, model, ready90, tick, change, ownerPage, panel, wait, bar, adjusting, withStatus,
} from './helpers/room_view.mjs';

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

test('A23: a key or a tap on a bar is the bar\'s, never the picture\'s zoom', async () => {
  const p = await ownerPage();
  try {
    await adjusting(p);
    const frame = p.state.root.querySelector('.ws-cam--room .ws-cam-frame');
    frame.dispatchEvent({ type: 'keydown', key: '+', target: bar(p, 'bar-grid'), preventDefault() {} });
    assert.equal(p.state.set.draft.zoom, 1);
    assert.equal(p.state.viewTools.zoom, 1);
    // On the picture itself, while adjusting, + is the camera's zoom (A23 plan decision 9), never the view's.
    frame.dispatchEvent({ type: 'keydown', key: '+', target: frame, preventDefault() {} });
    assert.equal(p.state.set.draft.zoom, 1.5);
    assert.equal(p.state.viewTools.zoom, 1);
  } finally { p.done(); }
});

test('A23 CSS: the bars stack in a grid over the picture, reach 44 px on touch and do not move', () => {
  const css = readFileSync(new URL('../hub/static/workshop-pi-rich.css', import.meta.url), 'utf8');
  const part = css.slice(css.indexOf('/* Adjust (amendment A23'), css.indexOf('/* end A23 */'));
  assert.ok(part.length > 200);
  assert.match(part, /grid-template-areas/);
  assert.match(part, /\.ws-view-tools\[hidden\]/);
  assert.match(part, /min-height: var\(--ui-target\)/);  // the kit's 44 px touch target (test_css_review.mjs holds its value)
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

// ---- A23 P3: drag and keys to frame the camera ----

const zoomed = (zoom = 2, extra = {}) => ({ '/api/camera/room/settings': { ...model(), settings: { ...SETTINGS, zoom, ...extra } } });
const frameOf = (p) => p.state.root.querySelector('.ws-cam--room .ws-cam-frame');
// The live picture laid out 400 × 300 on the page (in the picture's own axes), from a 384 × 288 stream.
async function adjustingSized(p) {
  const d = await adjusting(p);
  const img = p.state.root.querySelectorAll('img.room-img').find((i) => !i.dataset.refresh);
  Object.assign(img, { naturalWidth: 384, naturalHeight: 288, clientWidth: 400, clientHeight: 300 });
  return d;
}
const pointer = (p, type, id, x, y) => frameOf(p).dispatchEvent({ type, pointerId: id, clientX: x, clientY: y, target: frameOf(p) });
const key = (p, k) => frameOf(p).dispatchEvent({ type: 'keydown', key: k, target: frameOf(p), preventDefault() {} });

test('A23 drag: the picture follows the finger at every turn, mirror and flip, and back again', async () => {
  const { dom, ws } = await mod();
  try {
    const size = { zoom: 2, width: 400, height: 300 };
    // Turn 0, nothing flipped: dragging right shows more of the left, so the centre moves left by the crop's share.
    assert.deepEqual(ws.dragToCentre(100, 0, { turn: 0, mirror: false, flip: false, ...size }).map((v) => +v.toFixed(2)), [-12.5, 0]);
    // A quarter turn is the page's: a drag to the right is a move up the picture.
    assert.deepEqual(ws.dragToCentre(100, 0, { turn: 90, mirror: false, flip: false, ...size }).map((v) => +v.toFixed(2)), [0, 16.67]);
    assert.deepEqual(ws.dragToCentre(100, 0, { turn: 270, mirror: false, flip: false, ...size }).map((v) => +v.toFixed(2)), [0, -16.67]);
    // The camera's half turn, mirror and flip are undone, so the crop moves on the sensor the way the picture shows.
    assert.deepEqual(ws.dragToCentre(100, 0, { turn: 180, mirror: false, flip: false, ...size }).map((v) => +v.toFixed(2)), [12.5, 0]);
    assert.deepEqual(ws.dragToCentre(100, 0, { turn: 0, mirror: true, flip: false, ...size }).map((v) => +v.toFixed(2)), [12.5, 0]);
    assert.deepEqual(ws.dragToCentre(100, 0, { turn: 180, mirror: true, flip: false, ...size }).map((v) => +v.toFixed(2)), [-12.5, 0]);
    assert.deepEqual(ws.dragToCentre(0, 100, { turn: 0, mirror: false, flip: true, ...size }).map((v) => +v.toFixed(2)), [0, 16.67]);
    for (const turn of [0, 90, 180, 270]) {
      for (const mirror of [false, true]) {
        for (const flip of [false, true]) {
          const o = { turn, mirror, flip, ...size };
          const [cx, cy] = ws.dragToCentre(37, -21, o);
          assert.deepEqual(ws.centreToShift(cx, cy, o).map((v) => +v.toFixed(6)), [37, -21], JSON.stringify(o));
        }
      }
    }
  } finally { dom.uninstall(); }
});

test('A23 drag: the centre stays where the crop can still move', async () => {
  const { dom, ws } = await mod();
  try {
    assert.deepEqual(ws.centreRange(1), [50, 50]);
    assert.deepEqual(ws.centreRange(2), [25, 75]);
    assert.deepEqual(ws.centreRange(4), [12.5, 87.5]);
  } finally { dom.uninstall(); }
});

test('A23 drag: at 1× a drag sends nothing', async () => {
  const sent = [];
  const p = await ownerPage(liveRoute(sent));
  try {
    await adjustingSized(p);
    pointer(p, 'pointerdown', 1, 100, 100);
    pointer(p, 'pointermove', 1, 200, 100);
    pointer(p, 'pointerup', 1, 200, 100);
    await wait(260);
    assert.deepEqual(sent, []);
    assert.equal(text(p.state.root.querySelector('.ws-bar-line')), 'Camera zoom 1×');
  } finally { p.done(); }
});

test('A23 drag: a long drag sends at most five a second and always where it was let go', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    assert.equal(text(p.state.root.querySelector('.ws-bar-line')), 'Camera zoom 2× · drag to frame');
    pointer(p, 'pointerdown', 1, 0, 0);
    const started = Date.now();
    for (let i = 1; i <= 40; i++) {
      pointer(p, 'pointermove', 1, i * 2, 0);
      await wait(25);
    }
    pointer(p, 'pointerup', 1, 80, 0);
    const seconds = (Date.now() - started) / 1000;
    await wait(500);
    assert.ok(sent.length >= 2 && sent.length <= Math.ceil(seconds * 5) + 1, `${sent.length} sends in ${seconds}s`);
    // Turned 90° (ready90): 80 px right is 80 / (300 × 2) of the picture up, so the centre moves 13% down.
    const last = sent.at(-1);
    assert.deepEqual(last.values ?? { [last.key]: last.value }, { centre_x: 50, centre_y: 63 });
    assert.equal(p.state.set.draft.centre_y, 63);
  } finally { p.done(); }
});

test('A23 drag: the centre stops at the edge of the sensor', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    pointer(p, 'pointerdown', 1, 0, 0);
    pointer(p, 'pointermove', 1, 5000, 0);
    pointer(p, 'pointerup', 1, 5000, 0);
    await wait(260);
    assert.deepEqual(sent.at(-1).values, { centre_x: 50, centre_y: 75 });
  } finally { p.done(); }
});

test('A23 keys: adjusting, arrows move the centre 1% and + − 0 are the camera zoom', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    key(p, 'ArrowRight');  // more of the right of the screen: turned 90°, that is the top of the picture
    await wait(260);
    key(p, 'ArrowUp');
    await wait(260);
    key(p, '+');
    await wait(260);
    key(p, '0');
    await wait(260);
    assert.deepEqual(sent, [{ values: { centre_x: 50, centre_y: 49 } }, { values: { centre_x: 49, centre_y: 49 } },
      { key: 'zoom', value: 2.5 }, { values: { zoom: 1, centre_x: 50, centre_y: 50 } }]);
    assert.equal(p.state.viewTools.zoom, 1, 'the view zoom is untouched');
  } finally { p.done(); }
});

test('A23 keys: watching, + − 0 and arrows keep their view meanings, and entering Adjust resets the view zoom', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) });
  try {
    key(p, '+');
    assert.equal(p.state.viewTools.zoom, 1.5);
    await adjustingSized(p);
    assert.equal(p.state.viewTools.zoom, 1, 'two zooms never stack');
    await wait(260);
    assert.deepEqual(sent, []);
  } finally { p.done(); }
});

test('A23 drag: pinch does nothing while adjusting', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    pointer(p, 'pointerdown', 1, 100, 100);
    pointer(p, 'pointerdown', 2, 200, 100);
    pointer(p, 'pointermove', 1, 50, 100);
    pointer(p, 'pointermove', 2, 250, 100);
    pointer(p, 'pointerup', 1, 50, 100);
    pointer(p, 'pointerup', 2, 250, 100);
    await wait(260);
    assert.deepEqual(sent, []);
    assert.equal(p.state.viewTools.zoom, 1);
  } finally { p.done(); }
});

test('A23 drag: with the fallback engine a drag does nothing, and the line says why', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) }, { ...ready90, engine: 'rpicam' });
  try {
    await adjustingSized(p);
    assert.equal(text(p.state.root.querySelector('.ws-bar-line')), 'Camera zoom 2× · drag needs live adjust');
    pointer(p, 'pointerdown', 1, 0, 0);
    pointer(p, 'pointermove', 1, 80, 0);
    pointer(p, 'pointerup', 1, 80, 0);
    await wait(260);
    assert.deepEqual(sent, []);
    assert.equal(p.state.set.draft.centre_y ?? 50, 50);
  } finally { p.done(); }
});

// ---- A23 P3 review: the frame's shift is only ever the distance the camera has still to move ----

const shiftOf = (p) => [frameOf(p).style.getPropertyValue('--vx'), frameOf(p).style.getPropertyValue('--vy')];

test('A23 drag: zooming out from an edge, or a saved off-centre value at 1×, leaves no shift', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(4, { centre_x: 87 }), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    for (let i = 0; i < 6; i++) { bar(p, 'bar-zoom-out').click(); await wait(230); }
    await wait(900);
    assert.equal(p.state.set.confirmed.zoom, 1);
    assert.deepEqual(shiftOf(p), ['0px', '0px']);
  } finally { p.done(); }
  const q = await ownerPage({ ...zoomed(1, { centre_x: 80 }) });
  try {
    await adjustingSized(q);
    assert.deepEqual(shiftOf(q), ['0px', '0px']);
  } finally { q.done(); }
});

test('A23 drag: the shift holds until the camera has had time to show the new centre, then goes', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    pointer(p, 'pointerdown', 1, 0, 0);
    pointer(p, 'pointermove', 1, 60, 0);
    pointer(p, 'pointerup', 1, 60, 0);
    assert.equal(shiftOf(p)[0], '60px', 'the picture is where the finger left it');
    await wait(300);  // the hub has said yes; the stream still shows the old crop
    assert.equal(p.state.set.confirmed.centre_y, 60);
    assert.equal(shiftOf(p)[0], '60px');
    await wait(900);
    assert.deepEqual(shiftOf(p), ['0px', '0px']);
  } finally { p.done(); }
});

test('A23 drag: when live adjust is off (409) the picture is not shown moved', async () => {
  const p = await ownerPage(zoomed(2));
  try {
    await adjustingSized(p);
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts) => (String(url).startsWith('/api/camera/room/live-controls')
      ? new Response(JSON.stringify({ reason: "Live adjust isn't running. Use Apply." }), { status: 409, headers: { 'content-type': 'application/json' } })
      : real(url, opts));
    pointer(p, 'pointerdown', 1, 0, 0);
    pointer(p, 'pointermove', 1, 60, 0);
    pointer(p, 'pointerup', 1, 60, 0);
    await wait(300);
    assert.equal(p.state.set.draft.centre_y, 60, 'kept for Apply');
    assert.deepEqual(shiftOf(p), ['0px', '0px']);
  } finally { p.done(); }
});

test('A23 drag: a wide preset crops less of the sensor down than across, and the scale follows', async () => {
  const { dom, ws } = await mod();
  try {
    assert.deepEqual(ws.cropShare(2, [640, 480]), [0.5, 0.5]);
    assert.deepEqual(ws.cropShare(2, [1920, 1080]).map((v) => +v.toFixed(4)), [0.5, 0.375]);
    const [, cy] = ws.dragToCentre(0, 100, { turn: 0, share: [0.5, 0.375], width: 400, height: 225 });
    assert.equal(+cy.toFixed(3), -16.667);
    assert.deepEqual(ws.centreRange(2, 0.375), [18.75, 81.25]);
  } finally { dom.uninstall(); }
});

test('A23 drag: in the phone overlay the picture is not turned, so a drag is not mapped as turned', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(2), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    const fig = p.state.root.querySelector('.ws-cam--turn90');
    fig.classList.remove('ws-cam--turn90');  // as when the frame sits in the overlay, outside its turned figure
    pointer(p, 'pointerdown', 1, 0, 0);
    pointer(p, 'pointermove', 1, 80, 0);
    pointer(p, 'pointerup', 1, 80, 0);
    await wait(260);
    assert.deepEqual(sent.at(-1).values, { centre_x: 40, centre_y: 50 });
  } finally { p.done(); }
});

test('A23 drag: no drag while the camera has not taken the new zoom yet', async () => {
  const sent = [];
  const p = await ownerPage({ ...zoomed(1), ...liveRoute(sent) });
  try {
    await adjustingSized(p);
    bar(p, 'bar-zoom-in').click();  // draft 1.5×, the camera still 1×
    pointer(p, 'pointerdown', 1, 0, 0);
    pointer(p, 'pointermove', 1, 80, 0);
    pointer(p, 'pointerup', 1, 80, 0);
    await wait(260);
    assert.deepEqual(sent, [{ key: 'zoom', value: 1.5 }]);
  } finally { p.done(); }
});

// ---- A23 P4: looks as chips with Auto first, the panel's tabs, Manual exposure folded ----

const liveModel = (settings = {}) => ({ '/api/camera/room/settings': { ...model(), settings: { ...SETTINGS, ...settings },
  controls: CONTROLS.map((c) => ({ ...c, live: true })) } });
const looksRoute = (looks = []) => ({ '/api/camera/room/looks': { looks: [
  { name: 'Night', builtin: true, values: { ev: 1.5, awb: 'tungsten' } }, ...looks] } });
const chip = (p, name) => panel(p).querySelectorAll('.ws-look-chip').find((b) => text(b) === name);
// A storage that works, or one that throws on every call (private mode, blocked site data).
function withStorage(kind) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  const store = kind === 'throws'
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
    : { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  return { data, restore: () => (had ? Object.defineProperty(globalThis, 'localStorage', had) : delete globalThis.localStorage) };
}

test('A23 P4: Auto returns Light, Colour and Detail to the defaults in one request, never the framing or the preset', async () => {
  const sent = [];
  const p = await ownerPage({ ...liveModel({ ev: 1, awb: 'tungsten', zoom: 2, preset: 'sharp' }), ...looksRoute(), ...liveRoute(sent) });
  try {
    await adjusting(p);
    await tick();
    chip(p, 'Auto').click();
    await wait(260);
    assert.deepEqual(sent, [{ values: { ev: 0, manual: false, shutter: 33333, awb: 'auto', sharpness: 1 } }]);
    assert.equal(p.state.set.draft.zoom, 2);
    assert.equal(p.state.set.draft.preset, 'sharp');
    assert.equal(chip(p, 'Auto').getAttribute('aria-pressed'), 'true');
  } finally { p.done(); }
});

test('A23 P4: a look is one request; the chip in force is pressed and a later change un-presses it', async () => {
  const sent = [];
  const p = await ownerPage({ ...liveModel({ ev: 1 }), ...looksRoute(), ...liveRoute(sent) });
  try {
    const d = await adjusting(p);
    await tick();
    assert.equal(chip(p, 'Auto').getAttribute('aria-pressed'), 'false', 'Exposure is not the default');
    chip(p, 'Night').click();
    await wait(260);
    assert.deepEqual(sent, [{ values: { ev: 1.5, awb: 'tungsten' } }]);
    assert.equal(chip(p, 'Night').getAttribute('aria-pressed'), 'true');
    change(d.querySelector('#set-ev'), 0.5);
    assert.equal(chip(p, 'Night').getAttribute('aria-pressed'), 'false');
  } finally { p.done(); }
});

test('A23 P4: the panel shows one of Light, Colour and Detail; Manual exposure is folded inside Light', async () => {
  const st = withStorage('works');
  const p = await ownerPage(liveModel());
  try {
    const d = await adjusting(p);
    const tabs = d.querySelector('.ui-tabs[role="tablist"]');
    assert.deepEqual(tabs.querySelectorAll('[role="tab"]').map(text), ['Light', 'Colour', 'Detail']);
    const shown = () => d.querySelectorAll('[role="tabpanel"]').filter((x) => !x.hidden);
    assert.equal(shown().length, 1);
    assert.ok(shown()[0].querySelector('#set-ev'));
    const fold = shown()[0].querySelector('details.ws-set-fold');
    assert.equal(text(fold.querySelector('summary')), 'Manual exposure');
    assert.ok(!fold.open, 'closed by default');
    assert.ok(fold.querySelector('#set-manual') && fold.querySelector('#set-shutter'));
    assert.ok(fold.querySelector('#set-shutter').disabled, 'until Manual exposure is on');
    tabs.querySelectorAll('[role="tab"]')[2].click();
    assert.ok(shown()[0].querySelector('#set-sharpness') && shown()[0].querySelector('#set-preset'), 'Live quality is in Detail');
    assert.equal(shown()[0].querySelector('label[for="set-preset"]').getAttribute('class'), null, 'its label shows: no heading of its own here');
    assert.equal(st.data.get('hub-room-adjust-tab'), 'Detail');
    assert.ok(!d.querySelector('#set-centre_x'), 'the centre is framed on the picture (P3), so nothing sits below the tabs');
  } finally { p.done(); st.restore(); }
});

test('A23 P4: the arrow keys move between tabs, and the last tab survives a reload', async () => {
  const st = withStorage('works');
  try {
    const p = await ownerPage(liveModel());
    try {
      const d = await adjusting(p);
      const tab = (n) => d.querySelectorAll('[role="tab"]')[n];
      tab(0).dispatchEvent({ type: 'keydown', key: 'ArrowRight', target: tab(0), preventDefault() {} });
      assert.equal(tab(1).getAttribute('aria-selected'), 'true');
      assert.equal(p.dom.document.activeElement, tab(1));
      assert.equal(tab(1).getAttribute('tabindex'), '0', 'only the chosen tab is in the Tab order');
      assert.equal(tab(0).getAttribute('tabindex'), '-1');
      tab(1).dispatchEvent({ type: 'keydown', key: 'End', target: tab(1), preventDefault() {} });
      assert.equal(tab(2).getAttribute('aria-selected'), 'true');
      tab(2).dispatchEvent({ type: 'keydown', key: 'ArrowRight', target: tab(2), preventDefault() {} });
      assert.equal(tab(0).getAttribute('aria-selected'), 'true', 'wraps');
      tab(0).dispatchEvent({ type: 'keydown', key: 'ArrowLeft', target: tab(0), preventDefault() {} });
    } finally { p.done(); }
    const q = await ownerPage(liveModel());
    try {
      const d = await adjusting(q);
      assert.equal(d.querySelector('[role="tab"][aria-selected="true"]') && text(d.querySelector('[role="tab"][aria-selected="true"]')), 'Detail');
    } finally { q.done(); }
  } finally { st.restore(); }
});

test('A23 P4: a storage that throws still gives Light, and choosing a tab still works', async () => {
  const st = withStorage('throws');
  try {
    const p = await ownerPage(liveModel());
    try {
      const d = await adjusting(p);
      assert.equal(text(d.querySelector('[role="tab"][aria-selected="true"]')), 'Light');
      d.querySelectorAll('[role="tab"]')[1].click();
      assert.equal(text(d.querySelector('[role="tab"][aria-selected="true"]')), 'Colour');
    } finally { p.done(); }
  } finally { st.restore(); }
});

test('A23 P4: Save this look names the look-able settings in force, and a refusal keeps the name and says why', async () => {
  const posted = [];
  let answer = (b) => ({ look: b, looks: [{ name: 'Night', builtin: true, values: {} }, b] });
  const p = await ownerPage({ ...liveModel({ ev: 1, zoom: 2 }), ...looksRoute(),
    '/api/camera/room/looks': (u, o) => {
      if (o?.method === 'POST') { const b = JSON.parse(o.body); posted.push(b); return answer(b); }
      return { looks: [{ name: 'Night', builtin: true, values: { ev: 1.5 } }] };
    } });
  try {
    const d = await adjusting(p);
    await tick();
    chip(p, 'Save this look').click();
    const name = d.querySelector('#look-name');
    assert.ok(name && !name.closest('[hidden]'));
    assert.equal(p.dom.document.activeElement, name);
    name.value = 'Bench';
    d.querySelector('[data-key="look-save-confirm"]').click();
    await tick(); await tick();
    assert.deepEqual(posted, [{ name: 'Bench', values: { ev: 1, manual: false, shutter: 33333, awb: 'auto', sharpness: 1 } }]);
    assert.equal(chip(p, 'Bench').getAttribute('aria-pressed'), 'true');
    assert.ok(!d.querySelector('#look-name') || d.querySelector('#look-name').closest('[hidden]'), 'the form closes');
    answer = () => ({ __status: 422 });
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts) => (opts?.method === 'POST' && String(url) === '/api/camera/room/looks'
      ? new Response(JSON.stringify({ field: 'name', reason: "A look called 'Bench' already exists." }), { status: 422, headers: { 'content-type': 'application/json' } })
      : real(url, opts));
    chip(p, 'Save this look').click();
    d.querySelector('#look-name').value = 'Bench';
    d.querySelector('[data-key="look-save-confirm"]').click();
    await tick(); await tick();
    assert.equal(d.querySelector('#look-name').value, 'Bench');
    assert.equal(text(d.querySelector('#look-name-err')), "A look called 'Bench' already exists.");
    assert.equal(d.querySelector('#look-name').getAttribute('aria-invalid'), 'true');
  } finally { p.done(); }
});

test('A23 P4: a look named with a quote or a backslash still keeps the keyboard on its chip', async () => {
  const odd = 'Desk "lamp" \\ on';
  const p = await ownerPage({ ...liveModel(), ...looksRoute([{ name: odd, values: { ev: 0.5 } }]),
    '/api/camera/room/looks': (u, o) => (o?.method === 'POST'
      ? { look: JSON.parse(o.body), looks: [{ name: odd, values: { ev: 0.5 } }, JSON.parse(o.body)] }
      : { looks: [{ name: odd, values: { ev: 0.5 } }] }) });
  try {
    const d = await adjusting(p);
    await tick();
    chip(p, odd).focus();
    change(d.querySelector('#set-ev'), 0.5);  // redraws the chips
    assert.equal(p.dom.document.activeElement, chip(p, odd), 'focus stays on the same chip');
    chip(p, 'Save this look').click();
    d.querySelector('#look-name').value = 'Say "hi" \\';
    d.querySelector('[data-key="look-save-confirm"]').click();
    await tick(); await tick();
    assert.equal(p.dom.document.activeElement, chip(p, 'Say "hi" \\'), 'the new chip takes focus');
  } finally { p.done(); }
});

test('A23 P4: after Reset, or a change the camera refused, no look chip claims to be in force', async () => {
  const p = await ownerPage({ ...liveModel({ ev: 1 }), ...looksRoute(), ...liveRoute([]),
    '/api/camera/room/settings/reset': () => ({ ...model(), settings: { ...DEFAULTS, ev: 1 } }) });
  try {
    await adjusting(p);
    await tick();
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts) => (String(url).startsWith('/api/camera/room/live-controls')
      ? new Response(JSON.stringify({ field: 'ev', reason: 'Not now.' }), { status: 422, headers: { 'content-type': 'application/json' } })
      : real(url, opts));
    chip(p, 'Night').click();
    await wait(260);
    assert.equal(chip(p, 'Night').getAttribute('aria-pressed'), 'false', 'the camera never took Night');
    globalThis.fetch = real;
    chip(p, 'Night').click();
    await wait(260);
    assert.equal(chip(p, 'Night').getAttribute('aria-pressed'), 'true');
    globalThis.ApplianceConfirm = { ask: async () => true };
    panel(p).querySelector('[data-key="cam-reset"]').click();
    for (let i = 0; i < 6; i += 1) await tick();
    assert.equal(chip(p, 'Night').getAttribute('aria-pressed'), 'false', 'Reset is not Night');
  } finally { p.done(); }
});

test('A23 P4: a refused setting in another tab or the closed fold is shown before it takes focus', async () => {
  const st = withStorage('works');
  const p = await ownerPage();
  try {
    const d = panel(p);
    const selected = () => text(d.querySelector('[role="tab"][aria-selected="true"]'));
    assert.equal(selected(), 'Light');
    withStatus(p, 422, { field: 'awb', reason: 'White balance is one of: auto.' });
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    assert.equal(selected(), 'Colour');
    assert.ok(!d.querySelector('#set-awb').closest('[role="tabpanel"]').hidden);
    assert.equal(p.dom.document.activeElement, d.querySelector('#set-awb'));
    assert.equal(st.data.get('hub-room-adjust-tab') ?? null, null, 'a refusal is not a choice to remember');
    withStatus(p, 422, { field: 'manual', reason: 'Manual exposure needs a shutter time.' });
    d.querySelector('[data-key="cam-apply"]').click();
    await tick(); await tick(); await tick();
    assert.equal(selected(), 'Light');
    assert.ok(d.querySelector('details.ws-set-fold').open, 'the fold opens');
    assert.equal(p.dom.document.activeElement, d.querySelector('#set-manual'));
  } finally { p.done(); st.restore(); }
});

test('A23 P4: with eight saved looks, Save this look is off and says why', async () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `Look ${i + 1} with a long name`, values: { ev: 0 } }));
  const p = await ownerPage({ ...liveModel(), ...looksRoute(eight) });
  try {
    const d = await adjusting(p);
    await tick();
    assert.ok(chip(p, 'Save this look').disabled);
    assert.match(text(d.querySelector('.ws-looks-note')), /8 saved looks/);
  } finally { p.done(); }
});

test('A23 P4: below the panel, a line says changes apply live and Save keeps them', async () => {
  const p = await ownerPage(liveModel());
  try {
    const d = await adjusting(p);
    assert.equal(text(d.querySelector('.ws-set-hint')), 'Changes apply live. Save keeps them.');
    assert.ok(!d.querySelector('.ws-set-hint').hidden);
  } finally { p.done(); }
  const q = await ownerPage(liveModel(), { ...ready90, engine: 'rpicam' });
  try {
    assert.ok(panel(q).querySelector('.ws-set-hint').hidden, 'the fallback says Apply instead');
  } finally { q.done(); }
});

test('A23 P4 CSS: the looks row wraps, and the fold and tabs come from the kit', () => {
  const css = readFileSync(new URL('../hub/static/workshop-pi-rich.css', import.meta.url), 'utf8');
  assert.match(css, /\.ws-looks\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.ok(!/\.ws-set .*\.ui-tabs/.test(css), 'no local copy of the tabs');
});
