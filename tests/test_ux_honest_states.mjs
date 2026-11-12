// Honest states and one of each: unknown is never "Offline", one notice per source that isn't answering, one link to
// a tool per page, and System's strip pages share one heading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("no telemetry source is \"No answer\", never \"Offline\"", async () => {
  const { telemetryLabel } = await import('../hub/static/js/now.js');
  assert.equal(telemetryLabel({ telemetry: { status: 'offline', source: 'No source' } }).label, 'No answer');
  // Bambuddy answered and reported the printer offline (connected: false): that is an observation, so Offline.
  assert.deepEqual(
    (({ state, label }) => ({ state, label }))(telemetryLabel({ state: 'offline', telemetry: { status: 'offline', source: 'Bambuddy' } })),
    { state: 'offline', label: 'Offline' });
  assert.equal(telemetryLabel({ telemetry: { status: 'offline', source: 'No source' } }).state, 'none');
  assert.equal(telemetryLabel({}).label, 'No answer');
  assert.equal(telemetryLabel({ telemetry: { status: 'live' } }).label, 'Live');
  assert.equal(telemetryLabel({ telemetry: { status: 'degraded' } }).label, 'Backup readings');
  // A printer that is printing is physically there, whatever the telemetry says.
  assert.equal(telemetryLabel({ state: 'printing', telemetry: { status: 'offline' } }).label, 'Backup readings');
});

test('the chip for no answer is neutral, not the error colour', () => {
  const css = read('hub/static/app.css');
  assert.match(css, /\.printer-source\[data-state="offline"\] \.printer-source__dot \{ background: var\(--state-error\)/);
  assert.match(css, /\.printer-source\[data-state="none"\] \.printer-source__dot \{ background: var\(--state-unknown/);
});

test('a source that isn\'t answering is named once, in the kit\'s source_down words', async () => {
  await import('./helpers/kit.mjs');
  const { sourceDown } = await import('../hub/static/js/sections.js');
  assert.equal(sourceDown('Bambuddy'), "Bambuddy isn't answering");
  const { bambuddyDown } = await import('../hub/static/js/workshop.js');
  assert.equal(bambuddyDown({ prints_available: false, spools: null }), true);
  assert.equal(bambuddyDown({ prints_available: true, spools: [] }), false);
  const src = read('hub/static/js/workshop.js');
  assert.equal(src.match(/Bambuddy isn't answering/g), null, 'cards no longer repeat the outage');
});

test('Workshop links to Bambuddy once, in its "Open in" row', () => {
  const src = read('hub/static/js/workshop.js');
  assert.equal(src.match(/"Open Bambuddy ↗"/g), null);
});

test('Health says the checks failed once: the status line is for screen readers, the faceplate is what is seen', () => {
  const src = read('hub/static/js/health.js');
  assert.match(src, /class: "sr",\n\s+role: "status"/);
  assert.match(src, /The help guides below still work\./);
});

test("System's strip pages are headed by their own names (A22 2.3); the tab title says the page and the area", async () => {
  // Step 12: the heading and the tab title are read from the page list (site.js); /more is no longer a page.
  const { SITE } = await import('../hub/static/js/site.js');
  const heading = (path) => { const { heading: h, title } = SITE.headingFor(path); return { heading: h, title }; };
  assert.deepEqual(heading('/system'), { heading: 'Health', title: 'Health · System' });
  assert.deepEqual(heading('/backups'), { heading: 'Backups', title: 'Backups · System' });
  assert.equal(SITE.headingFor('/more'), null);
  assert.match(read('hub/static/js/main.js'), /SITE\.headingFor\(path\)/);
});

// Step 12: Household has six pages, and A22 2.2 puts Papers second "so it is on screen at 320 px without scrolling":
// every strip is one line that scrolls, as System's has been since A10 decision 16, and a faded edge says more is past it.
test('every strip keeps one line and scrolls; a faded edge hints the entries past it (A22 2.2)', () => {
  const css = read('hub/static/app.css');
  assert.match(css, /^\.ui-strip\.page-strip \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto/m);
  assert.doesNotMatch(css, /\.ui-strip\.page-strip[^{]*\{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.ui-strip\.page-strip\[data-more="end"\] \{ mask-image:/);
});

test('the Bambuddy notice: said once when it goes down, recovery said once, then cleared without a word', async () => {
  const { nextSourceNotice } = await import('../hub/static/js/workshop.js');
  let s = nextSourceNotice(undefined, false);
  assert.deepEqual(s, { state: 'up', text: '', changed: false });
  s = nextSourceNotice(s.state, true);
  assert.equal(s.changed, true);
  assert.equal(s.text, "Bambuddy isn't answering. Print history and spools show again when it answers.");
  s = nextSourceNotice(s.state, true);
  assert.equal(s.changed, false, 'a refresh while still down announces nothing');
  s = nextSourceNotice(s.state, false);
  assert.deepEqual(s, { state: 'recovered', text: 'Bambuddy is answering again.', changed: true });
  s = nextSourceNotice(s.state, false);
  assert.deepEqual(s, { state: 'up', text: '', changed: true }, 'the next render clears it');
  s = nextSourceNotice(s.state, false);
  assert.equal(s.changed, false);
});

test("while Bambuddy is down its cards carry no pill of their own: the one notice says it", async () => {
  const { cardPills } = await import('../hub/static/js/workshop.js');
  assert.deepEqual(cardPills({ prints_available: false, spools: null, week: null }), { history: null, filament: null });
  assert.equal(cardPills({ prints_available: true, spools: [], week: { finished: 2 } }).history.pill, '2 finished this week');
});

test('A7 H2: a stale reading says No answer with when it was last seen, never Backup readings while printing', async () => {
  const { telemetryLabel, telemetryAge } = await import('../hub/static/js/now.js');
  const s = telemetryLabel({ state: 'printing', telemetry: { status: 'stale', source: 'Bambuddy' } });
  assert.equal(s.label, 'No answer');
  assert.equal(s.state, 'none');
  assert.match(s.why, /Bambuddy isn't answering/);
  const ago = new Date(Date.now() - 12 * 60000).toISOString();
  assert.equal(telemetryAge(ago, true), 'last seen 12m ago');
  assert.equal(telemetryAge(ago), 'checked 12m ago');
});

test('A7 H2 (P5): the job is the plate name, not its path; a target of 0 is no target', async () => {
  const { jobTitle, tempText } = await import('../hub/static/js/now.js');
  assert.equal(jobTitle('/data/Metadata/plate 1'), 'Plate 1');
  assert.equal(jobTitle('/sdcard/RIFT_marked.gcode.3mf'), 'RIFT marked');
  assert.equal(jobTitle('christmas tree coaster'), 'christmas tree coaster');
  assert.equal(tempText(27, 0), '27°C');
  assert.equal(tempText(25, null), '25°C');
  assert.equal(tempText(220, 220), '220°C / 220°C');
  assert.equal(tempText(null, 220), null);
});
