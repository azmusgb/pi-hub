// System › Versions › Missions › one mission (A35 M1b step H7, spec §10.1-10.3, §10.5): Overview, Decisions and Evidence,
// read from GET /api/missions/<id>?view=… and kept current by polling /changes (never a stream). Plan and Work arrive
// with M3, so the tab strip never shows a tab that does nothing.
//
// Every state is drawn, and none is empty or fine by default: loading; live, with the hub's time; stale, with its age,
// when a refresh fails (a live label then becomes "Last known"); not the owner; no such mission; a newer contract; a
// named source that isn't answering; a table that couldn't be read (never a count of 0); truly empty; imported and
// reported rows, each with where it came from; and actions that are disabled say why. Counts are shown with their
// denominators and the kit's meter only for "n of m": no percentage is ever written as text.
import { askFirst, h, post, toast } from "./core.js";
import { ageLabel } from "./freshness.js";
import { decisionsState, drawDecisions } from "./home-decisions.js";
import { faceplate, faceplateLoading, fillTabs, section } from "./page-parts.js";
import { POLL, SLUG, chip, clockOf, hhmm, hubNow, isCount, meter, notice, prov, readView, shownNow, stamp, statusOf, typeWords, whereIs, words } from "./mission-parts.js";

export const every = POLL;

const TABS = [["overview", "Overview"], ["decisions", "Decisions"], ["evidence", "Evidence"]];
const GROUPS = [["", "All"], ["sessions", "Sessions"], ["imports", "Imports"], ["owner", "You"], ["decisions", "Decisions"], ["github", "GitHub"]];
const PANEL = "mission-panel", TAB = "mission-tab-";
const KEEP = new Set(["failed", "unavailable", "unreadable"]);  // a read that failed keeps the last good body, drawn as old
const has = (b, ...keys) => b && keys.every((k) => Array.isArray(b[k]));
const VALID = {
  overview: (b) => b.initiative && typeof b.initiative.id === "string" && b.counts && has(b, "proposed", "stages", "executions", "events", "sources"),
  decisions: (b) => has(b, "open", "answered"),
  evidence: (b) => has(b.evidence, "rows") && has(b.events, "rows"),
  changes: (b) => Number.isInteger(b.seq) && has(b, "views", "executions", "events"),
};

// ---- the page's parts ----

// Redraws a box only when its words or its `mark` (state words can't show: pressed, busy) changed, and puts focus back
// on the control that had it: a refresh never drops a keyboard user to the top (DESIGN.md, Accessibility).
export function paint(box, nodes, mark = "") {
  const next = h("div", {}, ...nodes.filter(Boolean));
  const sig = `${mark}\u0000${next.textContent}`;
  if (box.dataset.sig === sig && box.childNodes.length) return;
  const at = document.activeElement;
  const was = at && box.contains(at) ? at.textContent : null;
  box.replaceChildren(...next.childNodes);
  box.dataset.sig = sig;
  if (was !== null) [...box.querySelectorAll("a, button, summary")].find((x) => x.textContent === was)?.focus({ preventScroll: true });
}

const note = (text) => h("p", { class: "ui-section__note" }, text);
const empty = (text) => h("p", { class: "ui-empty" }, text);
const skeleton = () => h("p", { class: "ui-skeleton", "aria-busy": "true", style: "width:70%;height:1em" });
const row = (title, ...detail) => h("li", { class: "ui-row ui-row--lamp" }, h("div", {}, h("span", { class: "ui-row__title" }, title),
  ...detail.filter(Boolean).map((d) => h("span", { class: "ui-row__detail" }, d))));
const rowWith = (li, ...extra) => (li.append(...extra.filter(Boolean)), li);

// A count line with its denominator ("3 active · 2 done of 31 tasks"): the parts that are 0 are left out, and a
// denominator of 0 says the plan has none, so a target of 0 is never a meter.
const parts = (pairs) => pairs.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`).join(" · ");
const DONE = ["done", "verified", "reviewed", "accepted"];

// ---- Overview ----

export function progress(ov, rev, answer) {
  const c = ov.counts, from = rev?.provenance?.from;
  const plan = (what) => [prov("imported", { from }), ` ${what}`];
  const g = c.gates, t = c.tasks, d = c.decisions, e = c.evidence, r = c.risks;
  const stage = ov.stages.find((s) => s.status === "active");
  const state = t?.by_state || {};
  const done = DONE.reduce((n, k) => n + (isCount(state[k]) ? state[k] : 0), 0);
  const rows = [
    row("Stage", ov.stages.length ? (stage ? `P${stage.n} ${stage.title}` : "No stage is active") : "No stages in this plan",
      stage ? h("span", {}, prov("imported", { from: stage.provenance?.from })) : null),
    isCount(g?.met) && isCount(g?.of) ? row("Gates", g.of ? `${g.met} of ${g.of} met` : "No gates in this plan", meter(g.met, g.of, `${g.met} of ${g.of} gates met`), h("span", {}, ...plan(rev ? `Plan, revision ${rev.n}` : "Plan"))) : row("Gates", "Couldn't be read"),
    isCount(t?.of) ? row("Tasks", t.of ? `${parts([[state.active || 0, "active"], [state.blocked || 0, "blocked"], [done, "done"]]) || "None started"} of ${t.of} tasks` : "No tasks in this plan",
      meter(done, t.of, `${done} of ${t.of} tasks done`), isCount(t.reported) && t.reported ? `${t.reported} with a state a session reported` : null) : row("Tasks", "Couldn't be read"),
    d?.state === "ok" && isCount(d.open) ? rowWith(row("Decisions", d.open + d.answered ? `${d.open} open${d.blocking ? ` (${d.blocking} blocking)` : ""} · ${d.answered} answered` : "No decisions yet"),
      d.open ? h("button", { class: "ui-btn", type: "button", onclick: answer }, "Answer them") : null) : row("Decisions", "Couldn't be read"),
    isCount(e?.of) ? row("Evidence", e.of ? `${parts([[e.trusted, "trusted"], [e.owner, "from you"], [e.reported, "reported"], [e.imported, "imported"]])} of ${e.of}` : "No evidence yet") : row("Evidence", "Couldn't be read"),
    isCount(r?.of) ? row("Risks", r.of ? `${parts([[r.open, "open"], [r.mitigated, "mitigated"]]) || "None open"} of ${r.of}` : "No risks in this plan") : row("Risks", "Couldn't be read"),
  ];
  return rows;
}

const WORD = { turn_finished: "Turn finished", waiting_owner: "Waiting for you", unknown: "Not reported", ended: "Ended", done: "Done", failed: "Failed", cancelled: "Cancelled", queued: "Queued" };

export function executionRow(ex, now, stale) {
  const s = shownNow(ex, now, stale);
  const word = s.live ? (s.state === "running_tool" ? "Running a tool" : s.state === "running" ? "Running" : "Working")
    : /^No report/.test(s.label) ? "No report" : /^Last known/.test(s.label) ? "Last known" : WORD[s.state] || "Not reported";
  const tone = s.live ? "ok" : s.state === "failed" ? "bad" : s.state === "waiting_owner" ? "warn" : "unknown";
  const meta = [whereIs(ex.source), ex.branch, ex.model ? `${ex.model} (reported)` : null, ex.workstream].filter(Boolean).join(" · ");
  const mark = s.live ? prov("live") : prov(/^No report/.test(s.label) || !ex.since ? "unavailable" : "reported", { at: ex.since });
  return rowWith(row(ex.title || "A session", meta, h("span", {}, `${s.label} `, mark)), chip([tone, word], s.live));
}

const eventProv = (ev, from) => (ev.source === "importer" ? prov("imported", { from }) : ev.source === "owner" ? prov("owner")
  : ev.source === "github" ? prov("trusted", { at: ev.at }) : prov("reported", { at: ev.at }));
export const eventRow = (ev, from) => row(ev.text || typeWords(ev.type),
  h("span", {}, `${stamp(ev.at)} · ${whereIs(ev.source)}${ev.late ? " · reported late" : ""} `, eventProv(ev, from)));

const manifestFrom = (ov) => (ov.initiative.manifest ? `${ov.initiative.manifest.repo}@${String(ov.initiative.manifest.commit).slice(0, 7)}` : null);

function overviewNodes(state, ov, stale, now) {
  const rev = ov.revision, from = manifestFrom(ov);
  const waiting = ov.proposed.slice(1);
  return [
    section("Where it stands", h("ul", { class: "ui-rows" }, ...progress(ov, rev, () => select(state, "decisions")))),
    waiting.length ? section("Revisions waiting", h("ul", { class: "ui-rows" }, ...waiting.map((p) => rowWith(row(`Revision ${p.n}`, "Decide the earlier revision first."),
      h("button", { class: "ui-btn", type: "button", disabled: true }, `Accept revision ${p.n}`))))) : null,
    section("Executions", ov.executions.length ? h("ul", { class: "ui-rows" }, ...ov.executions.map((ex) => executionRow(ex, now, stale)))
      : empty("No session or run is attached to this mission."), { note: "A session says what it is doing; Pi Hub marks it live only while it keeps reporting." }),
    section("Recent", ov.events.length ? h("ul", { class: "ui-rows" }, ...ov.events.map((ev) => eventRow(ev, from))) : empty("Nothing has happened on this mission yet.")),
  ];
}

// The one primary action (§10.1): accept the oldest proposed revision, or reject it. Disabled, with the reason beside it,
// while the hub can't be reached or a tap is in flight.
function actions(state, ov, stale) {
  const p = ov.proposed[0];
  if (!p) return { buttons: [], why: null };
  const busy = state.busy, off = stale || !!busy;
  const why = stale ? "Pi Hub isn't answering, so nothing can be recorded." : busy ? "Recording…" : state.result;
  const b = (label, verb, cls) => {
    const button = h("button", { class: cls, type: "button", disabled: off, onclick: () => decide(state, p.n, verb, button) }, label);
    return button;
  };
  return { buttons: [b(`Accept revision ${p.n}`, "revision.accept", "ui-btn ui-btn--primary"), b("Reject", "revision.reject", "ui-btn")], why };
}

export function plateOf(state, ov, stale, now) {
  const i = ov.initiative, rev = ov.revision, g = ov.counts.gates, asOf = hhmm(state.clock.asOf);
  const [tone, word] = statusOf(i.status);
  const { buttons, why } = actions(state, ov, stale);
  const gates = isCount(g?.met) && isCount(g?.of) && g.of > 0 ? g : null;
  return faceplate({
    name: i.title, lamp: stale ? ["unknown", `Last known: ${word}`] : [tone, word], readout: gates ? `${gates.met} of ${gates.of}` : null, unit: "gates met", size: "md",
    caption: rev ? `Revision ${rev.n}, ${rev.status}${rev.status === "proposed" ? ": imported, not accepted yet" : ""}. ${stale ? "Last read" : "As of"} ${asOf}.` : "No plan has been imported yet.",
    extra: [prov("imported", { from: (rev?.provenance || i.provenance)?.from }), why ? h("p", { class: "ui-faceplate__caption", role: "status" }, why) : null],
    actions: buttons,
  });
}

// The owner's tap (A35 §6.2 "Owner writes"): sent, accepted, done. A repeat is safe (the hub answers 200 unchanged), and
// a revision that moved says where it is now (409): nothing is shown recorded that the hub didn't answer.
async function decide(state, n, verb, trigger) {
  if (state.busy) return;
  if (verb === "revision.reject" && !(await askFirst(trigger, `Revision ${n} is rejected and does not become the plan.`, { confirm: `Reject revision ${n}` }))) return;
  state.busy = { n, verb };
  state.result = null;
  draw(state);
  try {
    await post(`/api/missions/${state.id}/owner`, { verb, revision: n });
    toast(verb === "revision.accept" ? `Accepted revision ${n}.` : `Rejected revision ${n}.`);
  } catch (e) {
    state.result = e?.status === 409 ? `${e.body?.detail || "That has changed."} Showing it as it is now.` : "Not recorded. Try again.";
  }
  state.busy = null;
  state.views = state.views.overview ? { overview: state.views.overview } : {};  // the other views may have moved; the poll reads the overview again
  await load(state);
}

// ---- Decisions ----

const answerText = (a) => (Array.isArray(a) ? a.join(", ") : a == null || a === "" ? "No answer recorded" : String(a));
export function answeredRow(d) {
  const p = d.provenance || {};
  return row(d.question || "A decision", `Answered: ${answerText(d.answer)}`,
    h("span", {}, `${stamp(d.when)} `, prov(p.trust || "unavailable", { from: p.from, at: p.at || d.when })));
}

function decisionsPanel(state, stale) {
  const v = state.views.decisions;
  if (!v?.body) return paint(state.panel, [v?.fail ? failure(state, "decisions") : skeleton()], `d:${v?.fail || ""}`);
  const b = v.body;
  if (!state.panel.querySelector(".mission-open")) {
    state.panel.replaceChildren(h("div", { class: "mission-open" }), h("div", { class: "mission-answered" }));
    delete state.panel.dataset.sig;
  }
  const slot = state.panel.querySelector(".mission-open"), list = state.panel.querySelector(".mission-answered");
  // The kit draws the open group; a live half that couldn't be read is its own state, never an empty group.
  const data = b.state === "unavailable" ? { decisions: null } : { decisions: { open: b.open } };
  if (stale && !state.ds.owner) drawDecisions(state.ds, data, () => load(state));  // a stale group keeps the rows last read, so one must have been
  const node = drawDecisions(state.ds, stale ? null : data, () => load(state));
  if (node) { if (slot.firstChild !== node) { slot.replaceChildren(node); delete slot.dataset.sig; } }
  else paint(slot, [b.state === "unavailable" ? null : empty("Nothing is waiting for you.")], "none");
  paint(list, [v.fail ? notice("warn", "Couldn't refresh the decisions. This is the last read.") : null,
    section(`Answered (${b.total})`, b.answered.length ? h("ul", { class: "ui-rows" }, ...b.answered.map(answeredRow)) : empty("No decision has been answered yet.")),
    b.next != null ? more(state, "decisions", "Show more answers") : null], `${b.next}:${state.more || ""}`);
}

// ---- Evidence ----

const TRUST = { trusted: "Trusted: read by Pi Hub", owner: "From you", reported: "Reported by sessions", imported: "Imported from a reviewed file" };

export function evidenceRow(r) {
  return row(r.summary || typeWords(r.kind), h("span", {}, `${typeWords(r.kind)} · ${stamp(r.observed_at)} `,
    prov(r.trust, { from: r.provenance?.from, at: r.observed_at })));
}

function evidencePanel(state) {
  const v = state.views.evidence;
  if (!v?.body) return paint(state.panel, [v?.fail ? failure(state, "evidence") : skeleton()], `e:${v?.fail || ""}`);
  const { evidence: e, events: ev } = v.body;
  const groups = Object.keys(TRUST).map((t) => [t, e.rows.filter((r) => r.trust === t)]).filter(([, rows]) => rows.length);
  const kinds = (rows) => h("ul", { class: "ui-rows" }, ...rows.map(evidenceRow));
  paint(state.panel, [
    v.fail ? notice("warn", "Couldn't refresh the evidence. This is the last read.") : null,
    section("Evidence", e.total ? [note(`Showing ${e.rows.length} of ${e.total}, by trust and then kind.`),
      ...groups.map(([t, rows]) => h("div", {}, h("h3", {}, TRUST[t]), kinds(rows))), e.next != null ? more(state, "evidence", "Show more evidence") : null]
      : empty("No evidence has been recorded for this mission yet.")),
    section("History", [h("ul", { class: "ui-chips", "aria-label": "Show events from" }, ...GROUPS.map(([key, label]) =>
      h("li", {}, h("button", { type: "button", "aria-pressed": String(state.group === key), onclick: () => group(state, key) }, label)))),
    ev.rows.length ? h("ul", { class: "ui-rows" }, ...ev.rows.map((x) => eventRow(x, manifestFrom(state.views.overview.body)))) : empty(state.group ? "No events in this group." : "No events yet."),
    ev.next_before != null ? more(state, "history", "Show earlier events") : null]),
  ], `${state.group}:${e.next}:${ev.next_before}:${state.more || ""}`);
}

// Paging: one more page appended, from the offset (decisions, evidence) or the event before the last one (history).
const more = (state, what, label) => h("button", { class: "ui-btn", type: "button", disabled: !!state.more, onclick: () => page(state, what) }, state.more === what ? "Loading…" : label);

async function page(state, what) {
  const tab = what === "history" ? "evidence" : what, b = state.views[tab]?.body;
  if (!b || state.more) return;
  state.more = what;
  draw(state);
  const at = what === "decisions" ? `&offset=${b.next}` : what === "evidence" ? `&offset=${b.evidence.next}` : `&before=${b.events.next_before}`;
  const r = await fetchTab(state, tab, at, true);
  state.more = null;
  if (r.state === "ok") {
    if (what === "decisions") Object.assign(b, { answered: [...b.answered, ...r.body.answered], next: r.body.next, total: r.body.total });
    else if (what === "evidence") Object.assign(b.evidence, { rows: [...b.evidence.rows, ...r.body.evidence.rows], next: r.body.evidence.next, total: r.body.evidence.total });
    else Object.assign(b.events, { rows: [...b.events.rows, ...r.body.events.rows], next_before: r.body.events.next_before });
    state.views[tab].fail = null;
  } else toast("Couldn't load more. Try again.");
  draw(state);
}

function group(state, key) {
  state.group = key;
  delete state.views.evidence;
  draw(state);
  load(state);
}

// ---- reading ----

// One view. A tab view that fails keeps its last good body (drawn as old) unless the answer says the page shouldn't go
// on showing it (not the owner, a newer contract). `keep`: a page of "more" doesn't replace the view.
async function fetchTab(state, tab, extra = "", keep = false) {
  const q = tab === "evidence" && state.group ? `&group=${state.group}` : "";
  const r = await readView(`/api/missions/${state.id}?view=${tab}${q}${extra}`, VALID[tab]);
  if (keep) return r;
  const v = (state.views[tab] ||= { body: null, fail: null });
  if (r.state === "ok") Object.assign(v, { body: r.body, fail: null });
  else { v.fail = r.state; if (!KEEP.has(r.state)) v.body = null; }
  if (tab === "overview") {
    if (r.state === "ok") Object.assign(state, { fail: null, clock: clockOf(r.body.as_of), seq: r.body.seq });
    else state.fail = { state: r.state, at: state.fail?.at ?? Date.now() };
  }
  return r;
}

// What changed since the last read of the overview (plan decision 9): the executions as they read now, and which views
// to read again. The ones nobody is looking at are dropped and read when their tab opens.
async function poll(state) {
  const r = await readView(`/api/missions/${state.id}/changes?after=${state.seq}`, VALID.changes);
  if (r.state !== "ok") {
    state.fail = { state: r.state, at: state.fail?.at ?? Date.now() };
    if (!KEEP.has(r.state)) state.views = {};
    return;
  }
  const b = r.body;
  Object.assign(state, { fail: null, clock: clockOf(b.as_of) });
  const ov = state.views.overview.body;
  ov.executions = b.executions;
  for (const v of b.views) if (v !== "overview" && v !== state.tab) delete state.views[v];
  if (b.views.includes("overview")) await fetchTab(state, "overview");
  if (state.tab !== "overview" && b.views.includes(state.tab)) await fetchTab(state, state.tab);
}

export async function load(state) {
  if (!SLUG.test(state.id)) state.fail = { state: "missing" };
  else if (!state.views.overview?.body) await fetchTab(state, "overview");
  else await poll(state);
  if (state.views.overview?.body && state.tab !== "overview" && !state.views[state.tab]?.body) await fetchTab(state, state.tab);
  draw(state);
}

// ---- drawing ----

const SOURCE = { ledger: "Ledger", manifest: "Plan", github: "GitHub", localai: "Local AI" };
export function sourcesOf(state, ov) {
  const stale = !!state.fail;
  return ov.sources.map((s) => {
    const name = SOURCE[s.name] || typeof s.name === "string" && s.name || "A source";
    if (s.state !== "ok") return { name, tone: s.state === "unknown" ? "unknown" : "bad", word: s.state === "unknown" ? "not read yet" : "isn't answering" };
    const word = s.name === "ledger" ? `${stale ? "last read" : "as of"} ${hhmm(state.clock.asOf)}` : s.repo ? `${s.repo}@${String(s.commit || "").slice(0, 7)}`
            : s.last_pass_at ? `checked ${hhmm(typeof s.last_pass_at === "number" ? s.last_pass_at * 1000 : Date.parse(s.last_pass_at))}` : "";
    return { name, tone: s.name === "ledger" && stale ? "warn" : "ok", word };
  });
}

// The notice above the plate: the hub not answering (with the last read's age), or a source it names as down.
function drawNotice(state, ov, now) {
  const f = state.fail, bad = ov ? ov.sources.filter((s) => s.state !== "ok").map((s) => SOURCE[s.name] || s.name) : [];
  paint(state.notice, [
    ov && f ? notice("warn", `Couldn't refresh: ${words(f.state)} This is what Pi Hub last said, as of ${hhmm(state.clock.asOf)} (${ageLabel((now - state.clock.local) / 1000)}).`) : null,
    ...bad.map((n) => notice("warn", `${n} isn't answering. What it adds to this page isn't current.`)),
  ]);
}

function failure(state, tab) {
  const why = tab ? state.views[tab]?.fail : state.fail?.state, back = h("a", { href: "/missions", "data-link": true }, "Open Missions");
  return notice("bad", h("strong", {}, tab === "decisions" ? "Decisions can't be read" : tab === "evidence" ? "Evidence can't be read" : "This mission can't be read"), ` ${words(why)} `,
    why === "missing" ? back : why === "refused" ? h("a", { href: "/settings#group-people", "data-link": true }, "Open Settings")
      : h("button", { class: "ui-btn", type: "button", onclick: () => { if (tab) delete state.views[tab]; load(state); } }, "Try again"));
}

function drawTabs(state, ov) {
  const d = ov.counts.decisions, n = d?.state === "ok" && isCount(d.open) ? d.open : 0;
  const sig = `${state.tab}:${n}`;
  state.tabs.hidden = false;
  if (state.tabs.dataset.sig === sig) return;
  state.tabs.dataset.sig = sig;
  fillTabs(state.tabs, { items: TABS.map(([key, label]) => ({ key, label })), selected: state.tab, idPrefix: TAB, panel: () => PANEL,
    extra: (key) => (key === "decisions" && n ? h("span", { class: "count" }, String(n)) : null), onSelect: (key) => select(state, key) });
}

export function draw(state, now = Date.now()) {
  const ov = state.views.overview?.body;
  drawNotice(state, ov, now);
  if (!ov) {
    if (state.fail) {
      state.plate.replaceChildren(faceplate({ name: "Mission", lamp: ["unknown", "Not read"], caption: "This mission couldn't be read just now." }));
      state.tabs.hidden = true;
      paint(state.panel, [failure(state)], `o:${state.fail.state}`);
    }
    return;
  }
  const stale = !!state.fail;
  paint(state.plate, [plateOf(state, ov, stale, now)], `${state.busy ? "busy" : ""}${stale ? "stale" : ""}`);
  drawTabs(state, ov);
  const tab = state.tab;
  if (state.panel.dataset.tab !== tab) { state.panel.replaceChildren(); delete state.panel.dataset.sig; state.panel.dataset.tab = tab; }
  state.panel.setAttribute("aria-labelledby", `${TAB}${tab}`);
  if (tab === "overview") paint(state.panel, overviewNodes(state, ov, stale, hubNow(state.clock, now)), stale ? "stale" : "");
  else if (tab === "decisions") decisionsPanel(state, stale);
  else evidencePanel(state);
  state.sources = sourcesOf(state, ov);
}

// The tab chosen, kept in the address (?tab=) so a refresh or a shared link lands in the same place.
function select(state, key) {
  if (!TABS.some(([k]) => k === key)) return;
  state.tab = key;
  try { history.replaceState({}, "", key === "overview" ? location.pathname : `${location.pathname}?tab=${key}`); } catch { /* no history in a test */ }
  draw(state);
  load(state);
}

// The timer between polls (§7.5): a live label is turned into "No report since HH:MM" here when its window passes, so a
// silent session never stays "Live" while the page waits for the next read.
export function relabel(state, now = Date.now()) {
  if (state.views.overview?.body) draw(state, now);
}

export function mount(state) {
  const id = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
  const tab = state.context?.get?.("tab");
  Object.assign(state, { id, tab: TABS.some(([k]) => k === tab) ? tab : "overview", views: {}, seq: 0, fail: null, group: "", ds: decisionsState(), busy: null, more: null, result: null });
  state.notice = h("div");
  state.plate = h("div", {}, faceplateLoading("Mission"));
  state.tabs = h("div", { class: "ui-tabs", role: "tablist", "aria-label": "Mission", hidden: true });
  state.panel = h("section", { id: PANEL, role: "tabpanel", tabindex: "-1" }, skeleton());
  state.root.append(h("nav", { class: "page-trail", "aria-label": "Breadcrumb" }, h("a", { href: "/missions", "data-link": true }, "Missions"),
    h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, SLUG.test(id) ? id : "Mission")),
  state.notice, state.plate, state.tabs, state.panel);
  state.timer = setInterval(() => relabel(state), POLL * 1000);
}

export function leave(state) {
  clearInterval(state.timer);
}
