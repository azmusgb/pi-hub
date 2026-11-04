// Honest states and one of each: unknown is never "Offline", one notice per source that isn't answering, one link to
// a tool per page, and System's strip pages share one heading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("no telemetry source is \"No answer\", never \"Offline\"", async () => {
  const { telemetryLabel } = await import('../hub/static/js/now.js');
  assert.equal(telemetryLabel({ telemetry: { status: 'offline', source: 'No source' } }).label, 'No answer');
  assert.equal(telemetryLabel({ telemetry: { status: 'offline', source: 'No source' } }).state, 'none');
  assert.equal(telemetryLabel({}).label, 'No answer');
  assert.equal(telemetryLabel({ telemetry: { status: 'live' } }).label, 'Live');
  assert.equal(telemetryLabel({ telemetry: { status: 'degraded' } }).label, 'Backup readings');
  // A printer that is printing is physically there, whatever the telemetry says.
  assert.equal(telemetryLabel({ state: 'printing', telemetry: { status: 'offline' } }).label, 'Backup readings');
});

test('the chip for no answer is neutral, not the error colour', () => {
  const css = read('hub/static/app.css');
  assert.doesNotMatch(css, /\.printer-source\[data-state="offline"\]/);
  assert.match(css, /\.printer-source\[data-state="none"\] \.printer-source__dot \{ background: var\(--state-unknown/);
});

test('a source that isn\'t answering is named once, in the kit\'s source_down words', async () => {
  const { sourceDown } = await import('../hub/static/js/sections.js');
  assert.equal(sourceDown('Bambuddy'), "Bambuddy isn't answering");
  const { bambuddyDown } = await import('../hub/static/js/workshop.js');
  assert.equal(bambuddyDown({ prints_available: false, spools: null }), true);
  assert.equal(bambuddyDown({ prints_available: true, spools: [] }), false);
  const src = read('hub/static/js/workshop.js');
  assert.equal(src.match(/Bambuddy isn't answering/g), null, 'cards no longer repeat the outage');
  assert.match(src, /if \(state\.down !== down\)/, 'the live notice changes only when the outage does');
});

test('Workshop links to Bambuddy once, in its "Open in" row', () => {
  const src = read('hub/static/js/workshop.js');
  assert.equal(src.match(/"Open Bambuddy ↗"/g), null);
});

test('Health says the checks failed once: the status line is for screen readers, the card is what is seen', () => {
  const src = read('hub/static/js/health.js');
  assert.match(src, /state\.diagnostic\.classList\.toggle\("sr", true\)/);
  assert.match(src, /The help guides below still work\./);
});

test("System's strip pages are headed System; the strip and the tab title say which page", async () => {
  const { pageHeading } = await import('../hub/static/js/system-strip.js');
  assert.deepEqual(pageHeading('/system', 'Health'), { heading: 'System', title: 'Health · System' });
  assert.deepEqual(pageHeading('/backups', 'Backups'), { heading: 'System', title: 'Backups · System' });
  assert.deepEqual(pageHeading('/workshop', 'Workshop'), { heading: 'Workshop', title: 'Workshop' });
  assert.match(read('hub/static/js/main.js'), /pageHeading\(path, page\.title\)/);
});

test('on a phone the strip shows all six entries, in two rows of three', () => {
  const css = read('hub/static/app.css');
  assert.match(css, /@media \(max-width: 560px\) \{\s*\.tabs\.system-strip \{[^}]*grid-template-columns: repeat\(3, 1fr\)/);
});
