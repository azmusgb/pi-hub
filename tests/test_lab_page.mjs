// /lab renders the real print-lab index (lab/page_index.py build_index, plus colours and outside from lab sync).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  esc, questionHtml, experimentHtml, runLines, outsideHtml, spoolColour, needView, renderNotebook, verdictPayload, verdictChoices, requestsHtml, judgeOnOpen,
} from '../hub/static/js/lab.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/lab-index.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(FIXTURE);
const exp = (ix, id) => ix.experiments.find((x) => x.id === id);
const HOSTILE = '<img src=x onerror=alert(1)>"';
const NOW = Date.parse('2026-10-28T12:00:00Z');
const page = (ix, now = NOW) => renderNotebook({ index: ix, meta: { synced_at: '2026-10-28T11:50:00Z' } }, [], now);

test('esc escapes markup and quotes, and gives "" for null', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('the question card shows the real question, Time and Material meters, the next test and the stop line', () => {
  const ix = fresh();
  const html = questionHtml(ix.questions[0], ix);
  assert.match(html, /Does the edge-only seam come apart by hand with a clean face\?/);
  assert.match(html, /<span>Time<\/span><span>24 \/ 540 min<\/span>/);
  assert.match(html, /<span>Material<\/span><span>19\.8 \/ 200 g<\/span>/);
  assert.match(html, /E-103 would add 261\.2 min, 85\.9 g/);
  assert.match(html, /Continue: nothing has stopped this question\./);
  assert.match(html, /Q-005 · 1 of 2 answered · 1 informative, 0 not/);
  assert.match(html, /After E-102, if the pair welds: widen the seam gap to 0\.15 mm/);
  assert.match(html, /data-lab-open="E-102"/, 'the current experiment is the latest one not done');
  assert.doesNotMatch(html, /undefined|NaN|Coupons/);
});

test('the stop line says why a question stopped, red when the owner stopped it', () => {
  const ix = fresh();
  const q = ix.questions[0];
  q.stop = { kind: 'owner', text: 'stopped by you: enough' };
  assert.match(questionHtml(q, ix), /<p class="lab-stop lab-stop--bad">Stopped by you: enough<\/p>/);
  q.stop = { kind: 'auto', text: 'time budget spent' };
  assert.match(questionHtml(q, ix), /lab-stop--attention">Time budget spent/);
});

test('the experiment card shows test kind and factor, not the guessed plan/build fields', () => {
  const ix = fresh();
  const html = experimentHtml(exp(ix, 'E-102'), ix);
  assert.match(html, /paired comparison · seam gap: 0\.05 vs 0\.1/);
  assert.match(html, /<li>2A: 0\.05 mm · apart hard<\/li><li>2B: 0\.1 asked, 0\.12 printed mm · print clean · apart no<\/li>/);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.doesNotMatch(experimentHtml(exp(ix, 'E-101'), ix), /undefined|NaN/);
  assert.doesNotMatch(experimentHtml(exp(ix, 'E-100'), ix), /undefined|NaN/);
  assert.match(experimentHtml(exp(ix, 'E-100'), ix), /full part · ribs: on · retrospective/);
});

test('a run linked to Bambuddy names its print; one entered on the Mac says so', () => {
  const ix = fresh();
  const one = runLines(exp(ix, 'E-101'));
  assert.match(one, /Failed at ~82 % \(estimate\) \(spaghetti\) · 1 h 27 min · 30 g · <a href="[^"]*" target="_blank" rel="noopener">from Bambuddy print #13 ↗<\/a>/);
  assert.doesNotMatch(one, /PR-101-01/, 'a lone run is not named');
  const two = runLines(exp(ix, 'E-102'));
  assert.match(two, /<p class="meta lab-print">PR-102-01 · entered on the Mac<\/p>/);
  assert.match(two, /PR-102-02 · Printing · 4 h 25 min · <a [^>]*>from Bambuddy print #14 ↗<\/a>/);
  assert.equal(runLines({ runs: [{ id: 'PR-1', print: null, entered_on_mac: false }] }), '');
  assert.equal(runLines({}), '');
  assert.match(experimentHtml(exp(ix, 'E-101'), ix), /from Bambuddy print #13/);
});

test('outside the lab: nothing when empty or absent, a nameless print by its number', () => {
  assert.equal(outsideHtml([]), '');
  assert.equal(outsideHtml(undefined), '');
  assert.equal(outsideHtml(null), '');
  const html = outsideHtml(fresh().outside);
  assert.match(html, /<h2>Outside the lab<\/h2>/);
  assert.match(html, /RIFT_ab-pair · Failed · .* · <a [^>]*>from Bambuddy print #33 ↗<\/a>/);
  assert.match(html, /Print #32 · Finished/);
});

// A10 plan decision 13: a list longer than eight shows the newest eight and the rest behind "Show all (n)".
test('outside the lab: eight shown, the rest behind Show all', () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ print: 100 - i, name: `P${i}`, status_word: 'Finished', started: '2026-10-28T10:00:00Z' }));
  const html = outsideHtml(items);
  const [shown, rest] = html.split('<details');
  assert.equal((shown.match(/<p class="meta">/g) || []).length, 8);
  assert.match(rest, /<summary>Show all \(11\)<\/summary>/);
  assert.equal((rest.match(/<p class="meta">/g) || []).length, 3);
  assert.doesNotMatch(outsideHtml(items.slice(0, 8)), /<details/, 'eight or fewer: no disclosure');
});

test('spoolColour picks the longest colour name and only ever returns #rrggbb', () => {
  const { colours } = fresh();
  assert.equal(spoolColour('Kexcelled K5 PLA M, Light Matte Terracotta', colours), '#D9825B');
  assert.equal(spoolColour('Terracotta PLA', colours), '#C8643C');
  assert.equal(spoolColour('Bambu PLA Blue', colours), '#8698b1', 'a value that is not #rrggbb is refused');
  assert.equal(spoolColour('Matte Grey', { grey: 'red;background:url(x)' }), '#8698b1');
  assert.equal(spoolColour(null, colours), '#8698b1');
  assert.equal(spoolColour('grey', undefined), '#8698b1');
  const ix = fresh();
  assert.match(experimentHtml(exp(ix, 'E-101'), ix), /style="--spine:#D9825B"[^]*class="lab-swatch"/);
});

test('hostile text from the Mac is shown as text everywhere', () => {
  const ix = fresh();
  const x = exp(ix, 'E-101');
  x.filament = HOSTILE;
  x.variants[0].tab = HOSTILE;
  x.verdict.note = HOSTILE;
  x.verdict.defects = [HOSTILE];
  x.finding = HOSTILE;
  x.ai_observations[0].assessment = HOSTILE;
  x.runs[0].print.status_word = HOSTILE;
  x.runs[0].print.failure_reason = HOSTILE;
  x.runs[0].print.id = HOSTILE;
  x.photos[0].tab = HOSTILE;
  x.photos[0].run = HOSTILE;
  ix.colours[HOSTILE] = HOSTILE;
  ix.outside[0].name = HOSTILE;
  ix.outside[0].status_word = HOSTILE;
  ix.questions[0].question = HOSTILE;
  ix.questions[0].plans[0].next = HOSTILE;
  ix.needs[0].why = HOSTILE;
  ix.needs[0].command = HOSTILE;
  const html = page(ix) + outsideHtml(ix.outside) + experimentHtml(x, ix);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /onerror=alert\(1\)>"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;/);
  assert.match(experimentHtml(x, ix), /style="--spine:#8698b1"/);
});

test('a photo URL is built only from a real sha256', () => {
  const ix = fresh();
  const x = exp(ix, 'E-101');
  x.photos.push({ run: 'PR-101-01', sha256: '../../etc/passwd"' });
  const html = experimentHtml(x, ix);
  assert.match(html, /photo\/ddd8da66[0-9a-f]+\.jpg/);
  assert.doesNotMatch(html, /passwd/);
});

test('badges, defects, finding, AI readings and where usage figures came from', () => {
  const ix = fresh();
  const x = exp(ix, 'E-101');
  let html = experimentHtml(x, ix);
  assert.match(html, /badge--ok">Accepted</);
  assert.match(html, /Prediction supported/);
  assert.match(html, /Fair comparison/);
  assert.match(html, /Your verdict: good enough/);
  assert.match(html, /Defects: strings along the top edge/);
  assert.match(html, /Finding: The top edge holds up to Z 132\./);
  assert.match(html, /AI reading \(80% sure, unconfirmed\): Soft bands across the face\./);
  assert.match(html, /used 102 min, 29\.1 g \(estimated\)/);
  assert.match(html, /1A: hexagon_v58\.3mf · clean/);
  x.ai_observations[0].confidence = null;
  assert.match(experimentHtml(x, ix), /AI reading \(unconfirmed\): Soft bands/, 'no confidence is not "0% sure"');
  x.verdict.good_enough = false;
  html = experimentHtml(x, ix);
  assert.match(html, /badge--danger">Not good enough</);
  const old = experimentHtml(exp(ix, 'E-100'), ix);
  assert.match(old, /used 30 min \(estimated, partial print\), 12 g \(partly estimated\)/);
  assert.match(experimentHtml(exp(ix, 'E-102'), ix), /reserved 110 min, 40 g while it prints/);
});

test('needView: a print still on the printer says when it will be done', () => {
  const ix = fresh();
  const byId = Object.fromEntries(ix.experiments.map((x) => [x.id, x]));
  const need = { ...ix.needs[0], due_at: '2026-10-28T13:30:00Z' };
  const v = needView(need, NOW, byId);
  assert.equal(v.action, 'Printing');
  assert.match(v.why, /^Done about \d\d:\d\d \(estimate\)\. Then look at: fronts under one low side light\. Photos help\.$/);
  assert.equal(v.command, null);
  const after = needView(need, Date.parse('2026-10-28T14:00:00Z'), byId);
  assert.equal(after.action, 'Judge the print');
  assert.equal(after.command, need.command);
  const plain = needView(ix.needs[0], NOW, byId);
  assert.equal(plain.why, ix.needs[0].why);
});

test('answered in the last 3 days stays in the notebook; older moves to Earlier', () => {
  const ix = fresh();
  const notebook = (html) => html.slice(html.indexOf('id="lab-sec-notebook"'), html.indexOf('id="lab-earlier"'));
  const earlier = (html) => html.slice(html.indexOf('id="lab-earlier"'));
  let html = page(ix);
  assert.doesNotMatch(notebook(html), /id="lab-E-101"/);
  assert.match(earlier(html), /id="lab-E-101"/);
  exp(ix, 'E-101').verdict.at = new Date(NOW - 2 * 864e5).toISOString();
  html = page(ix);
  assert.match(notebook(html), /id="lab-E-101"/);
  assert.match(earlier(html), /id="lab-E-100"/);
  assert.match(notebook(html), /id="lab-E-102"/);
});

test('jump chips link to section anchors that exist', () => {
  const html = page(fresh());
  const chips = [...html.matchAll(/<a href="#(lab-[a-z-]+)" class="lab-jump__chip"/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['lab-sec-needs', 'lab-sec-questions', 'lab-sec-notebook', 'lab-earlier']);
  for (const id of chips) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<section class="card lab-outside">/);
  assert.ok(html.indexOf('lab-outside') > html.indexOf('id="lab-earlier"'), 'Outside the lab comes after Earlier');
});

test('an index from an older print-lab (no outside, colours, plans or run prints) renders', () => {
  const ix = fresh();
  delete ix.outside;
  delete ix.colours;
  delete ix.problems;
  for (const q of ix.questions) { delete q.plans; delete q.evidence; delete q.next; delete q.reserved; }
  for (const x of ix.experiments) {
    delete x.runs; delete x.finding; delete x.ai_observations; delete x.reserved; delete x.factor;
    delete x.test_kind; delete x.provenance; delete x.photos; delete x.variants;
  }
  const html = page(ix);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.doesNotMatch(html, /lab-outside|lab-print/);
  assert.match(html, /style="--spine:#8698b1"/);
});

test('verdict payload: "–" is sent as null, lighting has no default', () => {
  const p = verdictPayload({ grades: { A: { seam: 'clean', face: '–' } }, note: '', inconclusive: false }, false);
  assert.deepEqual(p.grades, { A: { seam: 'clean', face: null } });
  assert.equal(p.lighting, null);
  assert.equal(p.note, null);
  assert.equal(p.inconclusive, null);
  assert.equal(p.replace, false);
  assert.equal(verdictPayload({ lighting: 'diagnostic', inconclusive: true, inconclusiveReason: 'bed lifted' }, true).inconclusive, 'bed lifted');
});

test('every criterion offers a "–" (not judged) chip after its own choices', () => {
  assert.deepEqual(verdictChoices({ choices: ['clean', 'rough'] }), ['clean', 'rough', '–']);
  assert.deepEqual(verdictChoices({}), ['–']);
});

test('a request pending for over 120 s says the Mac has not picked it up; a fresh one does not', () => {
  const old = { id: 'rq-1', kind: 'verdict', status: 'pending', at: '2026-10-28T11:55:00Z' };
  const young = { id: 'rq-2', kind: 'photos', status: 'pending', at: '2026-10-28T11:59:30Z' };
  assert.match(requestsHtml([old], NOW), /The Mac hasn&#39;t picked this up yet/);
  assert.doesNotMatch(requestsHtml([young], NOW), /picked this up/);
  assert.doesNotMatch(requestsHtml([{ ...old, status: 'applied' }], NOW), /picked this up/);
});

// ---- Task 3: start, approve, drop ----
import { startRequest, approveRequest, dropRequest, approveGuards, actText } from '../hub/static/js/lab.js';
const golden = (n) => JSON.parse(readFileSync(new URL(`./fixtures/lab-requests/${n}.json`, import.meta.url), 'utf8'));
const RECORD = { payload: { builds: [
  { id: 'E-102-2', check: { guards: [{ code: 'x', ok: false, result: 'needs_approval', message: 'old' }] } },
  { id: 'E-102-3', check: { guards: [
    { code: 'no_verdict', ok: false, result: 'needs_approval', message: 'No verdict yet' },
    { code: 'fine', ok: true, result: 'ok', message: 'fine' },
    { code: 'blocked_one', ok: false, result: 'blocked', message: 'blocked' },
    { code: 'old_build', ok: false, result: 'needs_approval', message: 'Old build' }] } }] } };
const withId = (r, g) => ({ ...r, id: g.id });

test('start builder matches the golden payload', () => {
  const x = exp(fresh(), 'E-102');
  assert.deepEqual(withId(startRequest(x, Date.parse('2026-10-28T09:00:00Z')), golden('start')), golden('start'));
  const none = startRequest({ ...x, run: null }, 0);
  assert.equal(none.run_seen, null);
  assert.match(none.id, /^rq-[0-9a-f]{16}$/);
});

test('approve builder matches the golden payload and reads the last build guards', () => {
  const x = exp(fresh(), 'E-102');
  assert.deepEqual(approveGuards(RECORD), { build: 'E-102-3', guards: RECORD.payload.builds[1].check.guards.filter((g) => g.code !== 'fine' && g.code !== 'blocked_one') });
  assert.deepEqual(withId(approveRequest(x, RECORD, '  Looks right '), golden('approve')), golden('approve'));
  assert.equal(approveGuards({ payload: { builds: [] } }), null);
  assert.equal(approveGuards({ payload: { builds: [{ id: 'E-1-1', check: { guards: [] } }] } }), null);
  assert.equal(approveRequest(x, { payload: { builds: [] } }, 'ok'), null);
});

test('drop builder matches the golden payload', () => {
  const x = exp(fresh(), 'E-102');
  assert.deepEqual(withId(dropRequest(x, ' Wrong filament '), golden('abandon')), golden('abandon'));
});

const needsPage = (action, requests = [], mod = (x) => x) => {
  const ix = fresh();
  ix.needs[0].action = action; ix.needs[0].due_at = null;
  mod(ix);
  return renderNotebook({ index: ix, meta: {} }, requests, NOW);
};
const needsPart = (html) => html.split('id="lab-sec-needs"')[1].split('lab-questions')[0];

test('needs-you buttons follow the action', () => {
  const judge = needsPart(needsPage('Judge the print'));
  assert.match(judge, /lab-record-verdict[^>]*>Judge it</);
  assert.match(judge, /lab-add-photos[^>]*>Add photos</);
  assert.doesNotMatch(judge, /lab-start|lab-approve|lab-drop/);
  const send = needsPart(needsPage('Send it to the printer'));
  assert.match(send, /class="btn-primary lab-start" data-exp="E-102">It's printing now</);
  assert.match(send, /Only once it's actually printing\./);
  const appr = needsPart(needsPage('Approve or drop'));
  assert.match(appr, /lab-approve[^>]*>Approve</);
  assert.match(appr, /lab-drop[^>]*>Drop</);
  assert.doesNotMatch(needsPart(needsPage('Fix the plan')), /<button type="button" class="btn-(primary|danger)/);
  assert.match(needsPart(needsPage('Judge the print', [], (ix) => { ix.experiments[1].criteria = []; })), /^(?:(?!Judge it)[\s\S])*$/);
});

// A10 plan decision 14: a need only the Mac can do keeps its command, behind a "Command" disclosure.
test('a Mac-only need puts its command behind a Command disclosure', () => {
  const html = needsPart(needsPage('Fix the plan', [], (ix) => { ix.needs[0].command = 'uv run lab exp fix E-102'; }));
  assert.match(html, /<details class="lab-mac" id="lab-mac-E-102"><summary>Command<\/summary><div class="lab-cmd"><code>uv run lab exp fix E-102<\/code>/);
});

test('buttons are disabled while that experiment has a pending request, and the status says so', () => {
  const pend = [{ id: 'rq-1', kind: 'start', experiment: 'E-102', status: 'pending', at: new Date(NOW - 5000).toISOString() }];
  const html = needsPart(needsPage('Send it to the printer', pend));
  assert.match(html, /lab-start" data-exp="E-102" disabled/);
  assert.match(html, /data-act-status="E-102"[^>]*>Waiting for the Mac</);
  const other = [{ id: 'rq-2', kind: 'start', experiment: 'E-999', status: 'pending', at: new Date(NOW).toISOString() }];
  assert.doesNotMatch(needsPart(needsPage('Send it to the printer', other)), /disabled/);
  const old = [{ ...pend[0], at: new Date(NOW - 130000).toISOString() }];
  assert.match(needsPart(needsPage('Send it to the printer', old)), /hasn&#39;t picked this up/);
});

test('actText: waiting, refused and done', () => {
  assert.equal(actText({ status: 'refused', message: 'Nope' }, NOW), 'Nope');
  assert.equal(actText({ status: 'refused' }, NOW), 'The Mac refused it.');
  assert.equal(actText({ status: 'applied', message: 'Started.' }, NOW), 'Done. Started.');
  assert.equal(actText({ status: 'applied' }, NOW), 'Done.');
});

test('a whitespace-only reason is refused by the builders', () => {
  const x = exp(fresh(), 'E-102');
  assert.equal(dropRequest(x, '   '), null);
  assert.equal(approveRequest(x, RECORD, '  \n'), null);
});

test('do=judge opens the verdict sheet only for an experiment with a due "Judge the print" need', () => {
  const ix = (needs) => ({ needs });
  const judge = { id: 'E-022', action: 'Judge the print' };
  assert.equal(judgeOnOpen(ix([judge]), 'E-022', 'judge', NOW), true);
  assert.equal(judgeOnOpen(ix([{ ...judge, due_at: '2026-10-28T11:00:00Z' }]), 'E-022', 'judge', NOW), true);
  assert.equal(judgeOnOpen(ix([{ ...judge, due_at: '2026-10-28T13:00:00Z' }]), 'E-022', 'judge', NOW), true, 'printer finished, due_at in future');
  assert.equal(judgeOnOpen(ix([{ ...judge, due_at: 'not a date' }]), 'E-022', 'judge', NOW), true, 'bad time');
  assert.equal(judgeOnOpen(ix([{ id: 'E-022', action: 'Approve or drop' }]), 'E-022', 'judge', NOW), false);
  assert.equal(judgeOnOpen(ix([judge]), 'E-023', 'judge', NOW), false);
  assert.equal(judgeOnOpen(ix([judge]), 'E-022', null, NOW), false);
  assert.equal(judgeOnOpen(ix([judge]), 'E-022', 'other', NOW), false);
  assert.equal(judgeOnOpen({}, 'E-022', 'judge', NOW), false);
  assert.equal(judgeOnOpen(null, 'E-022', 'judge', NOW), false);
});
