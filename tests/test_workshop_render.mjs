// W.2 review (#91): the Printer page rendered with a small DOM (tests/helpers/fake_dom.mjs) and stubbed APIs: a refresh
// keeps focus and a busy button, Bambuddy down is one notice, stale trays aren't shown as current, and the loading,
// camera off and page-order states as drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

const T = Math.floor(Date.now() / 1000);
const printer = (state, extra = {}) => ({ state, headline: state === 'stopped' ? 'Finished: clear the plate' : state, detail: '',
  progress: 0, left: '', minutes_left: null, stale: false, actions: [], ...extra });
const judge = { project: 'hex-tile', id: 'E-007', action: 'Judge the print', judge_on: 'Top surface gloss', question_text: '' };
const prints = [{ id: 40, name: 'Cable clip x4', status: 'completed', word: 'Finished', started: T - 86400, ended: T - 80000, seconds: 6400 }];
const workshop = (over = {}) => ({
  printer: printer('idle'), prints, prints_available: true, week: { finished: 6, hours: 14.2 },
  spools: [{ colour: 'White', material: 'PETG', hex: '#f5f5f5', grams_left: 90, grams_total: 1000, measured: true, low: true }],
  ams_trays: [{ slot: 1, type: 'PLA', color: '#2b6cb0', remain: 64 }], lab: { needs: [], active: [], questions: [] },
  filament_month: { prints_logged: 0 }, ...over,
});

// Mount and load the page with these API answers; `routes` values may be functions (url, opts) => body.
async function page(routes) {
  const dom = install({ fetch: { '/api/camera': { ok: true, source: 'Pi', sources: {} }, '/api/projects': { available: true, projects: [] },
    '/api/me': { role: 'owner' }, ...routes } });
  const toast = dom.document.createElement('div');
  toast.id = 'toast';
  dom.document.body.append(toast);
  const core = await import('../hub/static/js/core.js');
  core.forgetMe();
  const ws = await import('../hub/static/js/workshop.js');
  const state = { root: dom.root() };
  ws.mount(state);
  return { dom, state, ws, done() { ws.leave(state); dom.uninstall(); } };
}

const answers = (root) => root.querySelectorAll('*').filter((el) => el.children.length === 0 || el.tagName === 'P')
  .map(text).filter((t) => /answer/i.test(t));

test('loading: before the first answer the band is a busy skeleton and the camera a placeholder of its size', async () => {
  const p = await page({});
  try {
    const band = p.state.root.querySelector('.ws-band .band');
    assert.equal(band.getAttribute('aria-busy'), 'true');
    assert.match(text(band), /Loading the printer/);
    assert.ok(p.state.root.querySelector('.ws-cam .ws-cam-placeholder'));
    assert.equal(p.state.root.querySelector('.ws-needs').hidden, true);
  } finally { p.done(); }
});

test('the page in the plan order: notice, Now, Needs you here, Materials, This week, More in the workshop, Open in', async () => {
  const p = await page({ '/api/workshop': workshop() });
  try {
    await p.ws.load(p.state);
    const kids = p.state.root.children.map((c) => c.className.split(' ').find((k) => k.startsWith('ws-') && k !== 'ws-section') || c.className);
    assert.deepEqual(kids.slice(1), ['ws-now', 'ws-needs', 'ws-materials', 'ws-week', 'ws-more', 'open-in']);
    assert.equal(p.state.root.children[0].getAttribute('role'), 'status');
    const summaries = p.state.root.querySelectorAll('.ws-more-item > summary').map(text);
    assert.deepEqual(summaries.map((s) => s.replace(/\d.*$/, '').trim()), ['Filament', 'Print history', 'Projects', 'Print lab & queue']);
    assert.ok(p.state.root.querySelectorAll('.ws-more-item').every((d) => !d.open), 'closed by default');
  } finally { p.done(); }
});

test('camera off: says the camera is unavailable and why, and never that the printer is off', async () => {
  const p = await page({ '/api/workshop': workshop(), '/api/camera': { ok: false, reason: 'liveview_off', sources: { Pi: { up: false } } } });
  try {
    await p.ws.load(p.state);
    const cam = text(p.state.root.querySelector('.ws-cam'));
    assert.match(cam, /Camera unavailable/);
    assert.match(cam, /LAN Only Liveview/);
    assert.doesNotMatch(cam, /printer (is|may be) off/i);
  } finally { p.done(); }
});

test('a refresh keeps keyboard focus on the same control, in the band and in Needs you', async () => {
  const p = await page({ '/api/workshop': workshop({ printer: printer('printing', { progress: 42, actions: ['pause'] }),
    lab: { needs: [judge], active: [], questions: [] } }) });
  try {
    await p.ws.load(p.state);
    const pause = p.state.root.querySelector('.ws-band button');
    assert.equal(text(pause), 'Pause the print');
    pause.focus();
    await p.ws.load(p.state);
    const now = p.dom.document.activeElement;
    assert.ok(now.isConnected, 'focus is on the page, not lost to body');
    assert.equal(text(now), 'Pause the print');
    const link = p.state.root.querySelector('.ws-needs a');
    link.focus();
    await p.ws.load(p.state);
    assert.equal(p.dom.document.activeElement, link, 'an unchanged Needs list is left as it is');
    assert.ok(link.isConnected);
  } finally { p.done(); }
});

test('a refresh while Clear the plate is running keeps it disabled: a second tap sends nothing', async () => {
  let release;
  let posts = 0;
  const p = await page({ '/api/workshop': workshop({ printer: printer('stopped', { actions: ['clear'] }) }),
    '/api/printer/clear': () => { posts += 1; return new Promise((r) => { release = () => r({ say: 'Cleared.' }); }); } });
  try {
    await p.ws.load(p.state);
    const first = p.state.root.querySelector('.ws-needs button');
    assert.equal(text(first), 'Clear the plate');
    first.focus();
    first.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(posts, 1);
    await p.ws.load(p.state);  // the 15 s refresh, mid-action
    const shown = p.state.root.querySelector('.ws-needs button');
    assert.equal(shown.disabled, true, 'still busy after the refresh');
    assert.equal(p.dom.document.activeElement, shown, 'focus stays on Clear the plate');
    shown.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(posts, 1, 'no second request');
    release();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(p.state.root.querySelector('.ws-needs button').disabled, false, 'usable again once it answered');
  } finally { p.done(); }
});

test('Bambuddy down: one notice (with when it was last seen), lab items still there, then one recovery line', async () => {
  const down = workshop({ printer: printer('printing', { stale: true, as_of: T - 600, detail: 'Bambuddy not answering since 12:40; last read 10 min ago.' }),
    prints: [], prints_available: false, week: null, spools: null, lab: { needs: [judge], active: [], questions: [] } });
  let answer = down;
  const p = await page({ '/api/workshop': () => answer, '/api/projects': () => (answer === down ? { available: false } : { available: true, projects: [] }) });
  try {
    await p.ws.load(p.state);
    const said = answers(p.state.root);
    assert.equal(said.length, 1, `one notice, got: ${JSON.stringify(said)}`);
    assert.match(said[0], /^Bambuddy isn't answering · last seen /);
    assert.match(text(p.state.root.querySelector('.ws-needs')), /E-007: Judge the print/);
    assert.equal(p.state.root.querySelector('.ws-materials').hidden, true);
    assert.equal(p.state.root.querySelector('.ws-week').hidden, true);
    answer = workshop();
    await p.ws.load(p.state);
    assert.deepEqual(answers(p.state.root), ['Bambuddy is answering again.']);
    await p.ws.load(p.state);
    assert.deepEqual(answers(p.state.root), []);
  } finally { p.done(); }
});

test('Bambuddy down after it answered: history and spools show the last known, marked with its time', async () => {
  let answer = workshop();
  const p = await page({ '/api/workshop': () => answer });
  try {
    await p.ws.load(p.state);
    answer = workshop({ printer: printer('idle', { stale: true }), prints: [], prints_available: false, week: null, spools: null });
    await p.ws.load(p.state);
    const hist = p.state.root.querySelector('#ws-history');
    assert.equal(hist.hidden, false);
    assert.match(text(hist), /Last known, from .*Cable clip x4/);
    assert.match(text(p.state.root.querySelector('#ws-filament')), /Last known, from .*White/);
    assert.equal(answers(p.state.root).length, 1);
  } finally { p.done(); }
});

test('stale printer readings: the AMS trays are not shown as current', async () => {
  const p = await page({ '/api/workshop': workshop({ printer: printer('idle', { stale: true }) }) });
  try {
    await p.ws.load(p.state);
    assert.doesNotMatch(text(p.state.root.querySelector('.ws-materials')), /AMS 1/);
  } finally { p.done(); }
});

test('colours from Bambuddy and the AMS go into styles only as hex; anything else is a neutral grey', async () => {
  const p = await page({ '/api/workshop': workshop({
    ams_trays: [{ slot: 1, type: 'PLA', color: 'red;background:url(x)', remain: 5 }, { slot: 2, type: 'PETG', color: '2B6CB0FF', remain: 50 }],
    spools: [{ colour: 'Odd', material: 'PLA', hex: 'url(javascript:1)', grams_left: 50, grams_total: 1000, measured: true, low: true }] }) });
  try {
    await p.ws.load(p.state);
    const styles = p.state.root.querySelectorAll('.swatch').map((s) => s.style.cssText);
    assert.ok(styles.length >= 3);
    for (const s of styles) assert.match(s, /^background:#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, s);
    assert.ok(styles.includes('background:#2B6CB0FF'));
    assert.ok(styles.includes('background:#888'));
  } finally { p.done(); }
});

test('missing numbers are left out, never "undefined h" or "null g left"', async () => {
  const p = await page({ '/api/workshop': workshop({ week: { finished: 2 },
    spools: [{ colour: 'Grey', material: null, grams_left: null, grams_total: null, measured: false, low: true }] }) });
  try {
    await p.ws.load(p.state);
    const all = text(p.state.root);
    assert.doesNotMatch(all, /undefined|null|NaN/);
    assert.match(text(p.state.root.querySelector('.ws-week')), /2 finished this week/);
    assert.match(text(p.state.root.querySelector('.ws-materials')), /Grey running low/);
  } finally { p.done(); }
});
