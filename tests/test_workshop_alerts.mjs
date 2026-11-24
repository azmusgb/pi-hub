// Workshop › Printer and Home agree on the printer's alerts (23 Nov: Home listed "Printer needs attention (0x2000b)"
// while Workshop showed a green Printing and left it out of Needs you here). Workshop reads the same /api/records and
// /api/needs Home reads and merges them with Home's own mergeProblems/problemItems, keeping the Printer alerts (hms) and
// Failure detection (obico) rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeProblems, problemItems } from '../hub/static/js/control-room.js';
import { workshopView } from '../hub/static/js/workshop.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const T = 1793770000;

const card = (state, extra = {}) => ({ state, headline: state, detail: '', progress: 0, left: '', minutes_left: null,
  stale: false, actions: [], layer_num: null, total_layers: null, ...extra });
const workshop = (over = {}) => ({
  printer: card('printing', { progress: 42, actions: ['pause'] }), prints: [], prints_available: true,
  week: { finished: 0, hours: 0 }, spools: [], ams_trays: [], lab: { needs: [], active: [], questions: [] },
  filament_month: { prints_logged: 0 }, ...over,
});
const owner = { role: 'owner', now: T };

// Records as /api/records gives them (records.make + merge: severity from records.KINDS).
const rec = (id, state, severity, extra = {}) => ({ id, state, severity, headline: state, source: 'bambuddy', cause: '',
  actions: [], detail: {}, since: T - 600, as_of: T - 5, stale: false, ...extra });
const printing = rec('printer', 'printing', 'ok', { headline: 'Printing' });
const hmsNotice = rec('hms', 'notice', 'attention', { headline: 'Printer needs attention (0x2000b)',
  detail: { errors: [{ code: '0x2000b', severity: 3 }] } });
const hmsStopped = rec('hms', 'stopped', 'problem', { headline: 'Printer needs attention (0x2000b)',
  detail: { errors: [{ code: '0x2000b', severity: 2 }] } });
const hmsClear = rec('hms', 'clear', 'ok', { headline: 'No printer alerts', detail: { errors: [] } });
// After Bambuddy went quiet: the last "clear" kept, marked stale, raised to attention (records._not_answering).
const hmsStale = rec('hms', 'clear', 'attention', { headline: 'No printer alerts', stale: true,
  cause: 'Bambuddy not answering since 12:40; last read 4 min ago.' });

// /api/needs items as hub/needs.py build() writes them for those records.
const hmsItem = (sev) => ({ id: 'pi:source:hms:0x2000b', source: 'Pi Hub', tone: sev === 3 ? 'warn' : 'bad',
  title: 'Printer needs attention (0x2000b)',
  detail: `${sev === 3 ? 'The print carries on.' : 'It pauses the print.'} Alert 0x2000b.`, link: '/workshop',
  record: 'hms', about: 'printer', action: { key: 'open_printer', link: '/workshop' } });
const needsOf = (...items) => ({ count: items.length, items, unread: [] });

// What Home lists for the same answers (home-dashboard.js renderDashboard: mergeProblems, then the kit's items).
const home = (records, needs) => problemItems(mergeProblems(records || [], needs));
const alerts = (v) => v.needs.filter((n) => n.kind === 'alert');

test('an hms notice is in Needs you here, with the headline and tone Home shows', () => {
  const records = [printing, hmsNotice];
  const needs = needsOf(hmsItem(3));
  const v = workshopView(workshop(), { ...owner, records, needs });
  const shown = alerts(v);
  assert.equal(shown.length, 1, 'the printer alert is missing from Needs you here');
  const [want] = home(records, needs);
  assert.equal(shown[0].item.title, want.title);
  assert.equal(shown[0].item.title, 'Printer needs attention (0x2000b)');
  assert.equal(shown[0].item.tone, want.tone);
  assert.notEqual(shown[0].item.tone, 'bad');
  assert.equal(shown[0].item.detail, 'The print carries on. Alert 0x2000b.');
  assert.equal(v.needsShown, true);
});

test('an hms fault that pauses the print is a problem, as on Home', () => {
  const records = [printing, hmsStopped];
  const needs = needsOf(hmsItem(2));
  const [item] = alerts(workshopView(workshop(), { ...owner, records, needs })).map((n) => n.item);
  assert.equal(item.tone, 'bad');
  assert.equal(item.tone, home(records, needs)[0].tone);
  assert.equal(item.detail, 'It pauses the print. Alert 0x2000b.');
});

test('the record alone (Needs you unanswered) still puts the alert there, as Home falls back to the records', () => {
  const v = workshopView(workshop(), { ...owner, records: [printing, hmsStopped], needs: null });
  const [item] = alerts(v).map((n) => n.item);
  assert.equal(item.title, home([printing, hmsStopped], null)[0].title);
  assert.equal(item.tone, 'bad');
  assert.equal(v.alertsUnread, false);
});

test('clear hms adds nothing; Needs you stays hidden while nothing else waits', () => {
  const v = workshopView(workshop(), { ...owner, records: [printing, hmsClear], needs: needsOf() });
  assert.deepEqual(v.needs, []);
  assert.equal(v.needsShown, false);
});

test('a stale hms record is not read as fine: it is listed as Home lists it', () => {
  const quiet = { id: 'pi:Printer alerts', source: 'Pi Hub', tone: 'warn', title: 'Printer alerts',
    detail: 'Bambuddy not answering since 12:40; last read 4 min ago.', link: '/workshop', record: 'hms', about: 'printer',
    action: { key: 'open_printer', link: '/workshop' } };
  const v = workshopView(workshop(), { ...owner, records: [printing, hmsStale], needs: needsOf(quiet) });
  const [item] = alerts(v).map((n) => n.item);
  assert.equal(item.title, 'Printer alerts');
  assert.match(item.detail, /not answering/);
  // From the records alone too.
  const fromRecords = alerts(workshopView(workshop(), { ...owner, records: [printing, hmsStale], needs: null }));
  assert.equal(fromRecords.length, 1);
  assert.equal(fromRecords[0].item.title, home([printing, hmsStale], null)[0].title);
});

test('failure detection: a warning or failure is listed, watching is not', () => {
  const warning = rec('obico', 'warning', 'attention', { headline: 'Possible failure spotted' });
  const failure = rec('obico', 'failure', 'problem', { headline: 'Print failure spotted' });
  const watching = rec('obico', 'watching', 'ok', { headline: 'Watching for failures' });
  const w = alerts(workshopView(workshop(), { ...owner, records: [printing, warning], needs: null }));
  assert.equal(w[0].item.title, home([printing, warning], null)[0].title);
  assert.equal(w[0].item.tone, 'attention');
  const f = alerts(workshopView(workshop(), { ...owner, records: [printing, failure], needs: null }));
  assert.equal(f[0].item.tone, 'bad');
  assert.deepEqual(alerts(workshopView(workshop(), { ...owner, records: [printing, watching], needs: null })), []);
});

test('the printer record and other areas stay out: the band and Clear the plate already say them', () => {
  const finished = rec('printer', 'finished', 'attention', { headline: 'Finished' });
  const drive = rec('movies_drive', 'missing', 'problem', { headline: 'Movies drive missing' });
  const v = workshopView(workshop({ printer: card('stopped', { actions: ['clear'] }) }),
    { ...owner, records: [finished, drive, hmsStopped], needs: null });
  assert.deepEqual(v.needs.map((n) => n.kind), ['alert', 'clear']);
});

test('neither source answered: the last alerts stay, marked as not refreshed, never as nothing to do', () => {
  const before = workshopView(workshop(), { ...owner, records: [printing, hmsStopped], needs: null });
  const v = workshopView(workshop(), { ...owner, records: null, needs: null, lastAlerts: alerts(before) });
  assert.equal(v.alertsUnread, true);
  assert.deepEqual(alerts(v), alerts(before));
  const cold = workshopView(workshop(), { ...owner, records: null, needs: null });
  assert.equal(cold.alertsUnread, true);
  assert.equal(cold.needsShown, true);
});

test('load reads the records and Needs you, and a change to the alerts redraws the page', () => {
  const src = read('hub/static/js/workshop.js');
  assert.match(src, /api\("\/api\/records"\)/);
  assert.match(src, /api\("\/api\/needs"\)/);
  assert.match(src, /RELOAD_ON\.has\(ch\?\.id\)/);
});
