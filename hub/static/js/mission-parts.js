// What the Missions pages share (A35 §7.5, §8, §10.5; M1b plan H7): one read that says what went wrong, times in words,
// an execution's label as the page sees it between polls, and the small parts every row uses (provenance, a notice, a
// count with its denominator). Nothing here makes up a number: a read that failed or can't be told is its own state,
// never 0, empty or idle, and a freshness claim is only made while the page can still stand behind it.
import { api, h } from "./core.js";
import { ageLabel } from "./freshness.js";

export const CONTRACT = 1;         // the `version` the hub's bodies carry (hub/missions/views.py head())
export const WINDOW_MS = 120_000;  // a session is live this long after its last report (§7.5; hub/missions/shown.py WINDOW)
export const POLL = 15;            // seconds between polls
export const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;  // an initiative's id, as the hub takes it (contract.valid_slug)

// ---- reads ----

// What each failed read says. `refused`: not the owner. `missing`: no such mission. `unavailable`: the hub answered that
// its ledger can't be read (503). `failed`: the hub didn't answer. `unreadable`: it answered with something that isn't
// the shape this page reads. `out_of_date`: it answers a newer contract than this page was written for.
const WORDS = {
  refused: "Sign in as the owner to read missions.",
  missing: "There is no mission at this address.",
  unavailable: "The ledger can't be read.",
  failed: "Pi Hub isn't answering.",
  unreadable: "Pi Hub's answer couldn't be read.",
  out_of_date: "This page is older than Pi Hub. Reload it to read missions.",
};
export const words = (state) => WORDS[state] || WORDS.failed;
const kind = (status) => (status === 401 || status === 403 ? "refused" : status === 404 ? "missing" : status === 503 ? "unavailable" : "failed");

// One GET: {state: "ok", body}, or {state: <why not>}. `valid(body)` is the shape the caller reads; anything else is
// "unreadable", never an empty answer.
export async function readView(path, valid) {
  let body;
  try { body = await api(path); } catch (e) { return { state: kind(e?.status) }; }
  if (!body || typeof body !== "object" || body.version === undefined) return { state: "unreadable" };
  if (body.version !== CONTRACT) return { state: "out_of_date" };
  return valid(body) ? { state: "ok", body } : { state: "unreadable" };
}

// ---- times ----

const pad = (n) => String(n).padStart(2, "0");
export const ms = (iso) => { const t = typeof iso === "string" ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
export const hhmm = (t) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// A time in words for a row: HH:MM today, with the day before it on any other. "" when the hub sent none.
const DATE = { weekday: "short", day: "numeric", month: "short" };
export function stamp(iso, now = Date.now()) {
  // A manifest's date with no time (an imported answer's) is that day wherever the page is read, not midnight UTC.
  const day = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (day) return new Date(+day[1], +day[2] - 1, +day[3]).toLocaleDateString([], DATE);
  const t = ms(iso);
  if (t === null) return "";
  const d = new Date(t), n = new Date(now);
  const today = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return today ? hhmm(t) : `${d.toLocaleDateString([], DATE)}, ${hhmm(t)}`;
}

// The hub's clock as the page can know it: `as_of` when a read arrived, then counted on the page's own clock, so a
// page whose clock is wrong still relabels by the hub's.
export const clockOf = (asOf, local = Date.now()) => ({ asOf: ms(asOf) ?? local, local });
export const hubNow = (clock, now = Date.now()) => clock.asOf + (now - clock.local);

// An execution as it reads now (§7.5): the hub's label while it is a statement about the past, and a live label turned
// into "No report since HH:MM" once the window passes between polls. `stale` (the page can't reach the hub) turns every
// live label into "Last known": a read this page can't renew is not "Live".
export function shownNow(ex, now, stale = false) {
  const since = ms(ex.since);
  // The hub writes its own HH:MM in its label; the page writes every time in the browser's zone, from the same instant.
  const said = since === null || typeof ex.shown !== "string" ? ex.shown : ex.shown.replace(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/, hhmm(since));
  const base = { label: said, state: ex.state, live: ex.live === true };
  if (!base.live) return base;
  if (stale) return { label: since === null ? "Not known" : `Last known ${hhmm(since)} (Pi Hub isn't answering)`, state: "unknown", live: false };
  if (since === null) return { label: said, state: "unknown", live: false };  // a live claim with no time to count from isn't one
  if (ex.state === "running_tool") {
    const min = Math.max(0, Math.floor((now - since) / 60_000));
    return { ...base, label: min ? `Running a tool for ${min} min` : "Running a tool for under 1 min" };
  }
  if (ex.state === "working" && now - since >= WINDOW_MS) return { label: `No report since ${hhmm(since)}`, state: "silent", live: false };
  return base;
}

// ---- parts ----

const WHERE = { claude: "Claude Code", localai: "Local AI", importer: "Import", owner: "You", github: "GitHub" };
export const whereIs = (source) => WHERE[source] || String(source || "A source");
// Seconds as "(n minutes ago)" for a notice, and nothing under a minute: "1 second ago" says nothing a page that just
// failed can use.
export const agePart = (seconds) => (seconds < 60 ? "" : ` (${ageLabel(seconds)})`);
// An evidence row's kind in words (the hub's kinds are short codes).
const KINDS = { pr: "Pull request", doc: "Document", release: "Release", check: "Check", commit: "Commit", test: "Test run", review: "Review", note: "Note", issue: "Issue" };
export const kindWords = (k) => KINDS[k] || typeWords(k);
// A label, then its mark, kept apart.
export const withMark = (text, mark) => (text ? [`${text} · `, mark] : [mark]);
export const typeWords = (t) => { const s = String(t || "").replace(/[._]/g, " ").trim(); return s ? s[0].toUpperCase() + s.slice(1) : "An event"; };

// Where a fact came from, as the kit's one label (ApplianceNeeds.provenance). `trust`: imported, trusted (read by Pi
// Hub itself), owner, reported, live or unavailable. A level missing the words the kit needs would draw nothing, so it
// says what is missing instead: a row never loses its source.
export function prov(trust, { from = null, at = null } = {}) {
  const when = stamp(at);
  let level = ["imported", "owner", "live", "unavailable"].includes(trust) ? trust : trust === "trusted" ? "checked" : "reported";
  if (level === "reported" && !when) level = "unavailable";  // a report with no time is no report we can date
  const node = globalThis.ApplianceNeeds?.provenance?.(level, { when, source: from });
  return node || h("span", { class: "ui-prov", dataset: { level: "unavailable" } }, `${typeWords(trust)}, source not recorded`);
}

export const notice = (tone, ...kids) => h("p", { class: `ui-notice ui-notice--${tone}`, role: "status" }, ...kids);

// "n of m" as the kit's meter, named by its own numbers. Nothing is drawn for a denominator of 0 (no target).
export function meter(n, of, label) {
  if (!(of > 0)) return null;
  const done = Math.min(n, of);
  return h("span", { class: "ui-meter", role: "meter", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": of, "aria-valuenow": done },
    h("i", { style: `width:${((100 * done) / of).toFixed(1)}%` }));
}

// The initiative's own status as a lamp: Active is running and fine; Proposed and Retired are neither (hollow).
const STATUS = { proposed: ["unknown", "Proposed"], active: ["ok", "Active"], paused: ["warn", "Paused"], done: ["ok", "Done"], retired: ["unknown", "Retired"] };
export const statusOf = (s) => STATUS[s] || ["unknown", typeof s === "string" && s ? s : "Unknown"];
export const chip = ([tone, word], live = false) => h("span", { class: `ui-chip ui-chip--${tone}${live ? " ui-chip--live" : ""}` }, word);

export const isCount = (v) => Number.isInteger(v) && v >= 0;
