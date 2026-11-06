// Pi Hub — Print Lab (Workshop › Print lab): the Mac's print-lab index (lab/page_index.py build_index, plus the spool
// colours and the prints outside the lab that lab sync adds), rendered as Local AI's Print lab renders it
// (app/public/print-lab.js and print-lab-evidence.js). Every value from the Mac is escaped; a colour is used only if it
// is #rrggbb and a photo URL only from a 64-hex sha256. The renderers are exported so node can test them.
import { card, empty, ensure, h, toast } from "./core.js";
import { labFetch, recorded, watchRequests } from "./lab-net.js";
import { mountPhotos } from "./lab-photos.js";
import { mountObserve, observeButton, observeSheetHtml } from "./lab-observe.js";
import { evidenceButton, mountEvidenceStudio } from "./lab-evidence.js";
import { changedIds, dialogOpen, isStale, refreshPlan, restore, snapshot } from "./lab-refresh.js";
import { toolUrl } from "./sections.js";

export const every = 15;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (x) => (x === null || x === undefined ? "–" : String(Math.round(Number(x) * 10) / 10));

const STATUS = {
  planned: ["Planned", "neutral"],
  built: ["Built", "neutral"],
  build_failed: ["Build failed", "bad"],
  ready: ["Ready to print", "accent"],
  needs_approval: ["Needs your approval", "attention"],
  approved: ["Approved", "accent"],
  printing: ["Printing", "attention"],
  answered: ["Answered", "good"],
  abandoned: ["Abandoned", "neutral"],
};

// How a usage figure was arrived at (usage.minutes_source / g_source); "observed" is shown bare.
const USAGE_SOURCE = { estimate: "estimated", scaled_estimate: "estimated, partial print", mixed: "partly estimated", none: "no build to estimate from" };

const OUTCOME = {
  supported: ["Prediction supported", "good"],
  refuted: ["Prediction refuted", "accent"],
  unresolved: ["Unresolved", "neutral"],
  inconclusive: ["Inconclusive", "neutral"],
};

const VALIDITY = {
  valid: ["Fair comparison", "good"],
  confounded: ["Confounded", "bad"],
  unknown: ["Can't tell if fair", "attention"],
};

const REASONS = {
  witness_abnormal: "the witness wall printed abnormally",
  witness_inconclusive: "the witness wall couldn't be judged",
  anchor_shifted: "the control reprint came out different",
  anchor_inconclusive: "the control reprint couldn't be judged",
  layer_time_mismatch: "the plates spent different time per layer",
  reference_not_printed: "the reference was never printed",
  reference_unmeasurable: "the reference plate can't be measured",
  cross_plate_no_anchor: "compared across plates with no control reprint",
  cross_plate_by_design: "separate plates are the factor being tested",
  production_mismatch: "this plate differs from how the tile will be printed",
};

const DONE = new Set(["answered", "abandoned"]);
const NEUTRAL = "#8698b1";
const HEX = /^#[0-9a-fA-F]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
const list = (v) => (Array.isArray(v) ? v : []);

function badgeTone(tone) {
  if (tone === "good") return "ok";
  if (tone === "attention") return "warn";
  if (tone === "bad") return "danger";
  return tone;
}

const badge = ([label, tone]) => `<span class="badge badge--${esc(badgeTone(tone))}">${esc(label)}</span>`;
// Variant and factor values keep two decimals (Local AI rounds to one, which shows 0.05 mm as 0.1).
const n2 = (x) => (x === null || x === undefined ? "–" : String(Math.round(Number(x) * 100) / 100));
// A value the Mac's records leave free-form (a grade, a factor value, an AI assessment, a defect, the filament) may be an
// object: shown as "key value" pairs joined by " · ", empty values left out, never as [object Object]. Not escaped here.
export function plain(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join(", ");
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => [k, plain(x)]).filter(([, x]) => x !== "").map(([k, x]) => `${k} ${x}`).join(" · ");
  return String(v);
}
// A variant's grade: a string as it is; the per-criterion object build_index sends as "print clean · apart no".
export const gradeText = (g) => plain(g);
const value = (v) => (Array.isArray(v) ? [...new Set(v.map(plain))].join("/") : typeof v === "number" ? n2(v) : v && typeof v === "object" ? plain(v) : String(v ?? "").includes("/") ? String(v).split("/").pop() : String(v ?? ""));
const when = (iso) => {
  const d = new Date(iso);
  return !iso || isNaN(d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return !isFinite(m) ? "" : m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

function makeRequestId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return "rq-" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function prepareJpeg(file) {
  let blob = file;
  try {
    const bmp = await createImageBitmap(file);
    let w = bmp.width, h = bmp.height;
    const max = 2400;
    if (w > max || h > max) {
      if (w > h) { h = Math.round((h * max) / w); w = max; }
      else { w = Math.round((w * max) / h); h = max; }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  } catch {}
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const sha = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  return { blob, sha };
}

const STALE_MS = 120000;
export function requestsHtml(items, now = Date.now()) {
  if (!items || !items.length) return "";
  return items.slice(0, 5).map((r) => {
    const tone = recorded(r.status) ? "ok" : r.status === "refused" ? "danger" : "warn";
    const title = r.kind ? r.kind[0].toUpperCase() + r.kind.slice(1) : "Request";
    const age = r.at ? now - Date.parse(r.at) : 0;
    const note = r.message || (r.status === "pending" && age > STALE_MS ? "The Mac hasn't picked this up yet" : "");
    return `<div class="lab-request"><span class="badge badge--${tone}">${esc(title)} · ${esc(r.status)}</span>${note ? ` <span class="meta">${esc(note)}</span>` : ""}</div>`;
  }).join("");
}
const renderRequestsList = requestsHtml;

// ---- the buttons' requests (Start, Approve, Drop): built here, sent to the hub, applied by the Mac ----
const ACT = new Set(["start", "approve", "abandon"]);
export const PICKUP = "The Mac hasn't picked this up yet. It runs when the Mac is awake.";
export const actText = (r, now = Date.now()) => r.status === "pending" ? (now - new Date(r.at) > STALE_MS ? PICKUP : "Waiting for the Mac")
  : r.status === "refused" ? (r.message || "The Mac refused it.") : `Done. ${r.message || ""}`.trim();
// The tap time is when it started (the Mac keeps it if plausible); the run the page saw stops a stale tap.
export const startRequest = (x, now = Date.now()) => ({
  id: makeRequestId(), kind: "start", experiment: x.id, run_seen: x.run || null, payload: { tapped_at: new Date(now).toISOString() },
});
// What an approval covers: the guards needing approval on the experiment's last build, from its record. null when
// the Mac hasn't checked that build.
export function approveGuards(record) {
  const b = list(record && record.payload && record.payload.builds).slice(-1)[0];
  const guards = list(b && b.check && b.check.guards).filter((g) => g && !g.ok && g.result === "needs_approval");
  return b && b.check && guards.length ? { build: String(b.id), guards } : null;
}
export function approveRequest(x, record, reason) {
  const cover = approveGuards(record), why = String(reason ?? "").trim();
  if (!cover || !why) return null;
  return { id: makeRequestId(), kind: "approve", experiment: x.id, payload: { reason: why, build_seen: cover.build, reasons_seen: cover.guards.map((g) => String(g.code)) } };
}
export function dropRequest(x, reason) {
  const why = String(reason ?? "").trim();
  return why ? { id: makeRequestId(), kind: "abandon", experiment: x.id, payload: { reason: why } } : null;
}

// Local AI's verdict form: every criterion has a "–" (not judged) chip, sent as null; the light is never assumed.
export const NOT_JUDGED = "–";
export const verdictChoices = (c) => [...list(c && c.choices), NOT_JUDGED];
export function verdictPayload(draft, isReplace = false) {
  const d = draft || {};
  const grades = {};
  for (const [tab, crits] of Object.entries(d.grades || {})) {
    grades[tab] = Object.fromEntries(Object.entries(crits || {}).map(([k, v]) => [k, v === NOT_JUDGED ? null : v]));
  }
  return {
    grades,
    lighting: d.lighting || null,
    note: d.note || null,
    inconclusive: d.inconclusive ? (d.inconclusiveReason || "unspecified") : null,
    replace: Boolean(isReplace),
  };
}

// Only a real sha256 makes a photo URL.
export function photoUrl(project, p) {
  return `/api/lab/${encodeURIComponent(project || "")}/photo/${p.sha256}.jpg`;
}
export const realPhotos = (x) => list(x.photos).filter((p) => p && SHA.test(p.sha256 || ""));

// The longest colour name found in the filament text wins ("light matte terracotta" before "terracotta"); only a
// #rrggbb value is ever returned, so it is safe in a style attribute.
export function spoolColour(filament, colours) {
  const text = String(filament || "").toLowerCase();
  const c = colours && typeof colours === "object" ? colours : {};
  const name = Object.keys(c).sort((a, b) => b.length - a.length).find((k) => k && text.includes(k.toLowerCase()) && HEX.test(String(c[k])));
  return name ? String(c[name]) : NEUTRAL;
}

// Bambuddy's print for a run, and the prints made outside the lab (runs[].print, entered_on_mac, outside).
const bambuLink = (id) => (id == null ? "" : `<a href="${esc(toolUrl("bambuddy"))}" target="_blank" rel="noopener">from Bambuddy print #${esc(id)} ↗</a>`);

export function runLines(x) {
  const runs = list(x && x.runs);
  return runs.map((r) => {
    const p = r && r.print;
    if (!p && !(r && r.entered_on_mac)) return "";
    const word = p ? esc(p.status_word) + (p.failed_at_estimate != null ? ` at ~${Math.round(p.failed_at_estimate * 100)} % (estimate)` : "") + (p.failure_reason ? ` (${esc(p.failure_reason)})` : "") : "";
    const parts = [
      runs.length > 1 ? esc(r.id) : "",
      word,
      p && p.minutes != null ? dur(Math.round(p.minutes)) : "",
      p && p.grams != null ? `${Math.round(p.grams)} g` : "",
      p ? bambuLink(p.id) : "",
      r.entered_on_mac ? "entered on the Mac" : "",
    ].filter(Boolean);
    return `<p class="meta lab-print">${parts.join(" · ")}</p>`;
  }).join("");
}

// The newest eight, the rest behind "Show all (n)" (A10 plan decision 13).
const SHOWN = 8;
export function outsideHtml(items) {
  if (!Array.isArray(items) || !items.length) return "";
  const row = (o) => `<p class="meta">${[esc(o.name || `Print #${o.print}`), esc(o.status_word), esc(when(o.started)), bambuLink(o.print)].filter(Boolean).join(" · ")}</p>`;
  const rest = items.slice(SHOWN);
  return `<section class="card lab-outside"><h2>Outside the lab</h2>${items.slice(0, SHOWN).map(row).join("")}` +
    (rest.length ? `<details class="lab-more" id="lab-outside-more"><summary>Show all (${items.length})</summary>${rest.map(row).join("")}</details>` : "") + `</section>`;
}

function meter(label, spent, next, total, unit) {
  total = Number(total) || 1;
  const a = Math.min(100, (100 * (spent || 0)) / total);
  const b = Math.min(100 - a, (100 * (next || 0)) / total);
  const over = (spent || 0) + (next || 0) > total + 1e-9;
  return `<div class="lab-meter${over ? " lab-meter--over" : ""}"><div class="lab-meter__head"><span>${esc(label)}</span><span>${n(spent)} / ${n(total)} ${unit}</span></div>` +
    `<div class="lab-meter__track" role="img" aria-label="${n(spent)} of ${n(total)} ${unit} used${next ? `, the next test adds ${n(next)}` : ""}"><span class="lab-meter__spent" style="width:${a.toFixed(1)}%"></span><span class="lab-meter__next" style="width:${b.toFixed(1)}%"></span></div></div>`;
}

const byIdOf = (ix) => Object.fromEntries(list(ix && ix.experiments).map((x) => [x.id, x]));

// A print still on the printer isn't ready to judge: until its estimated end it says when, with no command.
export function needView(need, now = Date.now(), byId = {}) {
  const look = `Look at: ${byId[need.id]?.judge_on || "the face"}. Photos help.`;
  if (need.due_at && now < new Date(need.due_at)) return { action: "Printing", why: `Done about ${clock(need.due_at)} (estimate). Then l${look.slice(1)}`, command: null };
  return { action: need.action, why: need.due_at ? look : need.why, command: need.command };
}

// ?do=judge opens the verdict sheet only when that experiment has a due "Judge the print" need; otherwise the link just
// opens and scrolls to the experiment. due_at is only an estimate, so it isn't tested here: the printer may be done early.
export function judgeOnOpen(ix, id, doParam) {
  if (doParam !== "judge" || !id) return false;
  return list(ix && ix.needs).some((n) => n && n.id === id && n.action === "Judge the print");
}

const FILAMENT_TYPES = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC"];

// Decision 8 of the A12 plan: the build's filament against the AMS tray in slot 1. "match" pre-ticks the check, "mismatch"
// blocks Start (the build names another type), "unknown" leaves the tick to the owner. Only the type can be compared:
// Bambuddy reports a tray's type and colour, the lab records a filament as free text.
export function startFilament(filament, trays) {
  const tray = list(trays).find((t) => t && t.slot === 1);
  const loaded = tray ? `${tray.type || "Filament"}${tray.name && tray.name !== tray.type ? ` (${tray.name})` : ""}` : "";
  if (!tray) return { state: "unknown", text: "The printer doesn't report what's in slot 1." };
  const words = String(plain(filament) || "").toUpperCase().split(/[^A-Z]+/);
  const named = FILAMENT_TYPES.filter((t) => words.includes(t));
  const type = String(tray.type || "").toUpperCase();
  if (!named.length) return { state: "unknown", text: `Slot 1 has ${loaded}.${filament ? ` The build is set for ${plain(filament)}.` : ""} Check it matches.`, color: tray.color };
  if (named.includes(type)) return { state: "match", text: `Slot 1 has ${loaded}, as the build needs.`, color: tray.color };
  return { state: "mismatch", text: `Slot 1 has ${loaded}, but the build is set for ${plain(filament)}. Load the right filament first.`, color: tray.color };
}

// What the sheet's Start button says and whether it can be pressed: both ticks, no reason from the hub, no mismatch.
export function startReady(check, ticks, filament) {
  const reasons = list(check && check.reasons);
  if (!check) return { ok: false, why: "Checking the printer…" };
  if (reasons.length) return { ok: false, why: reasons.join(" ") };
  if (filament && filament.state === "mismatch") return { ok: false, why: filament.text };
  if (!(ticks && ticks.plate && ticks.filament)) return { ok: false, why: "Tick both to start." };
  return { ok: true, why: "" };
}

// The button(s) for a Needs you item, or "" when it needs the Mac (Fix the plan, Run the check or build).
function actButtons(x, exp, busy) {
  const id = esc(x.id), off = busy ? " disabled" : "";
  if (x.action === "Judge the print") {
    return (exp && exp.criteria && exp.criteria.length ? `<button type="button" class="btn-primary lab-record-verdict" data-exp="${id}"${off}>Judge it</button>` : "") +
      `<button type="button" class="btn-outline lab-add-photos" data-exp="${id}"${off}>Add photos</button><input type="file" accept="image/*" multiple class="visually-hidden" aria-label="Add photos for ${id}" data-exp="${id}">`;
  }
  if (x.action === "Send it to the printer" && exp && exp.staged) {
    return `<button type="button" class="btn-primary lab-start-print" data-exp="${id}"${off}>Start ${id}…</button>` +
      `<button type="button" class="btn-outline lab-start" data-exp="${id}"${off}>It's printing now</button>`;
  }
  if (x.action === "Send it to the printer") return `<button type="button" class="btn-primary lab-start" data-exp="${id}"${off}>It's printing now</button>`;
  if (x.action === "Approve or drop") return `<button type="button" class="btn-primary lab-approve" data-exp="${id}"${off}>Approve</button><button type="button" class="btn-danger lab-drop" data-exp="${id}"${off}>Drop</button>`;
  return "";
}

const latestAct = (requests, id) => list(requests).find((r) => ACT.has(r.kind) && r.experiment === id);

function needsHtml(ix, byId, now, requests = []) {
  const needs = list(ix.needs);
  if (!needs.length) return '<p class="meta">Nothing needs you right now.</p>';
  return `<ul class="list-group lab-needs">${needs.map((raw) => {
    const x = { ...raw, ...needView(raw, now, byId) };
    const cmd = x.command ? `<div class="lab-cmd"><code>${esc(x.command)}</code><button type="button" class="btn-outline lab-copy" data-copy="${esc(x.command)}" aria-label="Copy the command for ${esc(x.id)}">Copy</button></div>` : "";
    const r = latestAct(requests, x.id), busy = Boolean(r && r.status === "pending");
    const acts = actButtons(x, byId[x.id], busy);
    const tail = acts
      ? `<div class="lab-acts">${acts}</div>${x.action === "Send it to the printer" ? `<p class="meta">${byId[x.id]?.staged ? "Staged in Bambuddy: Start sends exactly the checked build. Use It's printing now only for a print sent from Bambu Connect." : "Only once it's actually printing."}</p>` : ""}` +
        `<p class="lab-act-status" data-act-status="${esc(x.id)}" role="status"${r ? ` data-tone="${r.status === "refused" ? "bad" : "ok"}"` : " hidden"}>${r ? esc(actText(r, now)) : ""}</p>` +
        (cmd ? `<details class="lab-mac" id="lab-mac-${esc(x.id)}"><summary>Run it on the Mac instead</summary>${cmd}</details>` : "")
      // only the Mac can do it: the card leads with what needs doing, the command one tap away (decision 14)
      : cmd ? `<details class="lab-mac" id="lab-mac-${esc(x.id)}"><summary>Command</summary>${cmd}</details>` : "";
    return `<li class="list-row"><div class="list-row__main"><div class="list-row__title"><a href="#lab-${esc(x.id)}" data-lab-open="${esc(x.id)}">${esc(x.action)} · ${esc(x.id)}</a></div>` +
      `<div class="list-row__sub">${esc(byId[x.id]?.question_text)}</div><div class="list-row__sub">${esc(x.why)}</div>${tail}</div></li>`;
  }).join("")}</ul>`;
}

function plansHtml(q) {
  const rows = list(q.plans).map((p) => `<li>After ${esc(p.after)}, if ${esc(p.if)}: ${esc(p.next)}</li>`).join("");
  return rows ? `<h3 class="label">Plans</h3><ul class="lab-plans">${rows}</ul>` : "";
}

export function questionHtml(q, ix) {
  const byId = byIdOf(ix);
  const s = q.spent || {}, b = q.budget || {}, nx = q.next, st = q.stop || {}, ev = q.evidence;
  const ids = list(q.experiments);
  const cur = [...ids].reverse().map((i) => byId[i]).find((x) => x && !DONE.has(x.status));
  const text = String(st.text || "");
  const stop = st.kind
    ? `<p class="lab-stop lab-stop--${st.kind === "owner" ? "bad" : "attention"}">${esc(text.charAt(0).toUpperCase() + text.slice(1))}</p>`
    : '<p class="lab-stop">Continue: nothing has stopped this question.</p>';
  const head = [esc(q.id), `${Number(q.answered) || 0} of ${ids.length} answered`, ev ? `${Number(ev.informative) || 0} informative, ${Number(ev.uninformative) || 0} not` : ""].filter(Boolean).join(" · ");
  return `<section class="card lab-question"><p class="meta">${head}</p><h2>${esc(q.question)}</h2>` +
    meter("Time", s.minutes, nx && nx.minutes, b.minutes, "min") + meter("Material", s.g, nx && nx.g, b.g, "g") +
    (nx ? `<p class="meta">${esc(nx.id)} would add ${n(nx.minutes)} min, ${n(nx.g)} g</p>` : "") + stop + plansHtml(q) +
    (cur ? `<div class="lab-now"><p class="meta"><a href="#lab-${esc(cur.id)}" data-lab-open="${esc(cur.id)}">${esc(cur.id)}</a> ${badge(STATUS[cur.status] || [cur.status, "neutral"])}</p><p class="lab-now__q">${esc(cur.question_text)}</p>${cur.why_this_test ? `<p class="meta"><b>Why this test?</b> ${esc(cur.why_this_test)}</p>` : ""}</div>` : "") +
    "</section>";
}

// An AI reading with no confidence says so rather than "0% sure".
const aiHtml = (x) => list(x.ai_observations).map((o) => {
  const sure = typeof o.confidence === "number" ? `${Math.round(o.confidence * 100)}% sure` : "";
  const how = [sure, o.confirmed ? "" : "unconfirmed"].filter(Boolean).join(", ");
  return `<p class="lab-ai">AI reading${how ? ` (${how})` : ""}: ${esc(plain(o.assessment))}</p>`;
}).join("");

export function experimentHtml(x, ix, requests = []) {
  const project = ix && ix.project;
  const f = x.factor || {};
  const b = [badge(STATUS[x.status] || [x.status, "neutral"])];
  if (x.outcome) {
    b.push(badge(OUTCOME[x.outcome] || [x.outcome, "neutral"]));
    if (x.validity) b.push(badge(VALIDITY[x.validity.status] || [x.validity.status, "neutral"]));
  }
  if (x.verdict && x.verdict.kind === "acceptance") b.push(badge(x.verdict.good_enough ? ["Accepted", "good"] : ["Not good enough", "bad"]));

  const meta = [
    String(x.test_kind || "").replace(/_/g, " "),
    f.name ? `${String(f.name).replace(/_/g, " ")}: ${list(f.values).map(value).join(" vs ")}` : "",
    x.provenance && x.provenance !== "prospective" ? x.provenance : "",
  ].filter(Boolean).join(" · ");
  const vars = list(x.variants).map((v) => {
    const u = v.unit ? ` ${v.unit}` : "";
    const name = v.tab || v.id;
    return `<li>${esc(name)}: ${v.realized != null && v.as_asked === false ? `${esc(value(v.requested))} asked, ${n2(v.realized)} printed${esc(u)}` : `${esc(v.realized != null ? n2(v.realized) : value(v.requested))}${esc(u)}`}${gradeText(v.grade) ? ` · ${esc(gradeText(v.grade))}` : ""}</li>`;
  }).join("");

  const qty = (v, unit, src) => `${n(v)} ${unit}${src && src !== "observed" ? ` (${USAGE_SOURCE[src] || "estimated"})` : ""}`;
  const cost = [
    x.estimate && `estimated ${n(x.estimate.minutes)} min, ${n(x.estimate.g)} g`,
    x.usage && `used ${qty(x.usage.minutes, "min", x.usage.minutes_source)}, ${qty(x.usage.g, "g", x.usage.g_source)}`,
    x.reserved && `reserved ${n(x.reserved.minutes)} min, ${n(x.reserved.g)} g while it prints`,
    x.layer_time_median_s && `${n(x.layer_time_median_s)} s per layer`,
  ].filter(Boolean).join(", ");

  const why = x.outcome && x.validity ? list(x.validity.reasons).map((r) => REASONS[r.code] || r.code).join("; ") : "";
  const v = x.verdict;
  const said = v && (v.note || (v.kind === "acceptance" ? (v.good_enough ? "good enough" : "not good enough") : v.kind));
  const shots = realPhotos(x).map((p, i) => `<a href="${photoUrl(project, p)}" target="_blank" rel="noopener"${i ? "" : ' class="lab-shots__first"'}><img src="${photoUrl(project, p)}" alt="${esc(x.id)} print ${esc(p.run || "")}${p.tab ? ` tab ${esc(p.tab)}` : ""}" loading="lazy"></a>`).join("");
  const guards = list((x.check || {}).guards).filter((g) => !g.ok).map((g) => `<li class="lab-guard--${g.result === "blocked" ? "bad" : "attention"}">${esc(g.message)}</li>`).join("");
  const dl = [
    ["Hypothesis", x.hypothesis],
    ["Prediction", x.prediction],
    ["Why this test", x.why_this_test],
    ["Judge on", x.judge_on],
    ["Abandoned because", x.abandoned_reason],
    ["Filament", x.filament],
  ].map(([k, t]) => [k, plain(t)]).filter((r) => r[1]).map(([k, t]) => `<dt>${esc(k)}</dt><dd>${esc(t)}</dd>`).join("");

  let actions = "";
  if (x.status === "printing" && !x.verdict) {
    const hint = '<p class="meta lab-light-hint">Raking light from one side, same distance, tab in frame.</p>';
    const addBtn = `<button type="button" class="btn-outline lab-add-photos" data-exp="${esc(x.id)}">Add photos</button><input type="file" accept="image/*" multiple class="visually-hidden" aria-label="Add photos for ${esc(x.id)}" data-exp="${esc(x.id)}">`;
    const verdictBtn = x.criteria && x.criteria.length ? `<button type="button" class="btn-outline lab-record-verdict" data-exp="${esc(x.id)}">Record verdict</button>` : "";
    const expReqs = (requests || []).filter((r) => r.experiment === x.id);
    const reqsHtml = `<div class="lab-requests" id="lab-requests-${esc(x.id)}" aria-live="polite">${renderRequestsList(expReqs)}</div>`;
    actions = `${hint}<div class="lab-checklist" data-lab-checklist="${esc(x.id)}"></div><div class="lab-actions">${addBtn}${verdictBtn}${observeButton(x)}</div>${reqsHtml}`;
  } else if (observeButton(x)) {
    actions = `<div class="lab-actions">${observeButton(x)}</div>`;
  }

  const spine = spoolColour(plain(x.filament), ix && ix.colours);
  return `<article class="card lab-exp" id="lab-${esc(x.id)}" style="--spine:${spine}"><header class="lab-exp__head"><span class="lab-swatch" aria-hidden="true"></span><span class="lab-exp__id">${esc(x.id)}</span>${b.join("")}</header><h3>${esc(x.question_text)}</h3>` +
    (meta ? `<p class="meta">${esc(meta)}</p>` : "") +
    (vars ? `<ul class="lab-variants">${vars}</ul>` : "") +
    (cost ? `<p class="meta">${esc(cost)}</p>` : "") +
    runLines(x) +
    (why ? `<p class="meta">Why: ${esc(why)}</p>` : "") +
    (said ? `<p class="lab-verdict">Your verdict: ${esc(said)} <span class="meta">${esc(when(v.at))}</span></p>` : "") +
    (v && list(v.defects).length ? `<p class="meta lab-defects">Defects: ${esc(v.defects.map(plain).filter(Boolean).join("; "))}</p>` : "") +
    (x.finding ? `<p class="lab-verdict">Finding: ${esc(x.finding)}</p>` : "") +
    aiHtml(x) +
    actions +
    (evidenceButton(x, ix) ? `<div class="lab-actions lab-evidence-action">${evidenceButton(x, ix)}</div>` : "") +
    (shots ? `<div class="lab-photos" data-lab-photos="${esc(x.id)}"><div class="lab-shots">${shots}</div></div>` : "") +
    (shots && list(x.reference_variants).length ? `<div class="lab-wipe-slot" data-lab-wipe="${esc(x.id)}"></div>` : "") +
    `<details class="lab-details" id="lab-d-${esc(x.id)}" data-lab-details="${esc(x.id)}"><summary>Details</summary><dl>${dl}</dl>${guards ? `<h4>Last check (${esc(String(x.check.status || "").replace(/_/g, " "))})</h4><ul class="lab-guards">${guards}</ul>` : ""}</details></article>`;
}

// Above the faceplate, only when the Mac's mirror is stale: how old, and why (A7 P8); with requests waiting, the phrase
// table's mac_waiting words. Fresh, it is an empty placeholder (the sources line says when the Mac synced). The quiet
// refresh swaps just this.
export function syncedHtml(meta, now = Date.now(), requests = []) {
  const at = meta && meta.synced_at;
  if (!at || !isStale(at, now)) return '<p class="lab-synced" hidden></p>';
  const waiting = list(requests).some((r) => r && r.status === "pending");
  return `<p class="ui-notice ui-notice--warn lab-synced" role="status">Synced from the Mac ${esc(ago(at))}. The Mac may be asleep; ` +
    `the experiments below are as they were then.${waiting ? " The Mac hasn't picked this up. It runs when the Mac is awake." : ""}</p>`;
}

// The sources line at the foot of the page (A7 P1): the Mac, and when it last synced.
export function labSources(meta) {
  const at = meta && meta.synced_at;
  if (!at || !Number.isFinite(Date.parse(at))) return [{ name: "The Mac", tone: "unknown", word: "never synced" }];
  return [{ name: "The Mac", tone: isStale(at) ? "warn" : "ok", word: `synced ${ago(at)}` }];
}

// Each card's HTML by experiment id, to see which ones changed between renders.
export const cardSignatures = (data, requests = []) => Object.fromEntries(list(data && data.index && data.index.experiments).map((x) => [x.id, experimentHtml(x, data.index, requests)]));

export function renderNotebook(data, requests = [], now = Date.now()) {
  const ix = data.index || {}, meta = data.meta || {}, byId = byIdOf(ix);
  const exps = list(ix.experiments), problems = list(ix.problems), needs = list(ix.needs);
  const open = list(ix.questions).filter((q) => !["answered", "stopped"].includes(q.status));
  // Answered in the last three days stays in view: the newest result is what the owner comes to check.
  const recent = (x) => x.status === "answered" && x.verdict && now - new Date(x.verdict.at) < 3 * 864e5;
  const active = exps.filter((x) => !DONE.has(x.status) || recent(x));
  const earlier = exps.filter((x) => DONE.has(x.status) && !recent(x));
  const cardOf = (x) => experimentHtml(x, ix, requests);

  const jumps = [
    needs.length ? `<a href="#lab-sec-needs" class="lab-jump__chip">Needs you <span class="badge badge--warn">${needs.length}</span></a>` : "",
    open.length ? `<a href="#lab-sec-questions" class="lab-jump__chip">Questions (${open.length})</a>` : "",
    active.length ? `<a href="#lab-sec-notebook" class="lab-jump__chip">Notebook (${active.length})</a>` : "",
    earlier.length ? `<a href="#lab-earlier" class="lab-jump__chip">Earlier (${earlier.length})</a>` : "",
  ].filter(Boolean).join("");

  return syncedHtml(meta, now, requests) +
    (problems.length ? `<div class="lab-problems" role="alert"><strong>Records the Mac can't read</strong><ul>${problems.map((p) => `<li><b>${esc(p.file)}</b> ${esc(p.error)}</li>`).join("")}</ul></div>` : "") +
    (jumps ? `<nav class="lab-jump" aria-label="Jump to section">${jumps}</nav>` : "") +
    `<div class="lab-layout"><div class="lab-side"><section class="card lab-needs-card" id="lab-sec-needs"><h2>Needs you</h2>${needsHtml(ix, byId, now, requests)}</section>` +
    `<div class="lab-questions" id="lab-sec-questions">${open.map((q) => questionHtml(q, ix)).join("") || '<section class="card"><div class="empty-state"><div class="empty-state__title">No open question.</div><div>Start one on the Mac with lab question new.</div></div></section>'}</div>` +
    `</div><div class="lab-notebook" id="lab-sec-notebook"><h2>Notebook</h2>${active.map(cardOf).join("") || '<p class="meta">No open experiments.</p>'}` +
    (earlier.length ? `<details class="lab-earlier" id="lab-earlier"><summary>Earlier (${earlier.length})</summary>${earlier.map(cardOf).join("")}</details>` : "") +
    outsideHtml(ix.outside) +
    "</div></div>";
}

function sheetsHtml() {
  return observeSheetHtml() + `
<dialog id="labVerdictSheet" class="lab-sheet" aria-labelledby="labVerdictTitle">
  <form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head">
      <h2 id="labVerdictTitle" class="lab-sheet__title">Record verdict</h2>
      <button type="button" id="labVerdictCancel" class="btn-outline" aria-label="Cancel verdict">Cancel</button>
    </div>
    <div id="labVerdictBody" class="lab-sheet__body"></div>
    <div class="lab-sheet__section">
      <label class="lab-checkbox-label">
        <input type="checkbox" id="labVerdictInconclusiveToggle">
        <span>Print failed or can't tell</span>
      </label>
      <div id="labVerdictInconclusiveBox" class="lab-sheet__field" hidden>
        <label for="labVerdictInconclusiveReason">Reason</label>
        <input type="text" id="labVerdictInconclusiveReason" placeholder="e.g. bed adhesion failure">
      </div>
    </div>
    <div class="lab-sheet__section">
      <div class="lab-sheet__field">
        <label for="labVerdictLighting">Light used</label>
        <select id="labVerdictLighting">
          <option value="" selected disabled>Choose the light…</option>
          <option value="diagnostic">Diagnostic (raking light from one side)</option>
          <option value="room">Room light</option>
          <option value="installed">Installed (where the tile will live)</option>
        </select>
      </div>
      <div class="lab-sheet__field">
        <label for="labVerdictNote">Note</label>
        <input type="text" id="labVerdictNote" placeholder="What you see">
      </div>
    </div>
    <p id="labVerdictStatus" class="lab-sheet__status" role="status" aria-live="polite" hidden></p>
    <p id="labVerdictError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions">
      <button type="button" id="labVerdictReplace" class="btn-outline" hidden>Replace verdict</button>
      <button type="button" id="labVerdictSend" class="primary" disabled>Send to the Mac</button>
    </div>
  </form>
</dialog>
<dialog id="labPhotosSheet" class="lab-sheet" aria-labelledby="labPhotosTitle">
  <form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head">
      <h2 id="labPhotosTitle" class="lab-sheet__title">Add photos</h2>
      <button type="button" id="labPhotosCancel" class="btn-outline" aria-label="Cancel photos">Cancel</button>
    </div>
    <p class="meta lab-sheet__hint">Choose which tab each photo shows:</p>
    <div id="labPhotosList" class="lab-sheet__body"></div>
    <p id="labPhotosStatus" class="lab-sheet__status" role="status" aria-live="polite" hidden></p>
    <p id="labPhotosError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions">
      <button type="button" id="labPhotosSend" class="primary">Send photos</button>
    </div>
  </form>
</dialog>
<dialog id="labApproveSheet" class="lab-sheet" aria-labelledby="labApproveTitle">
  <form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head">
      <h2 id="labApproveTitle" class="lab-sheet__title">Approve</h2>
      <button type="button" id="labApproveCancel" class="btn-outline" aria-label="Cancel approval">Cancel</button>
    </div>
    <p id="labApproveHint" class="meta lab-sheet__hint"></p>
    <ul id="labApproveGuards" class="lab-guards"></ul>
    <div class="lab-sheet__field">
      <label for="labApproveReason">Why you're approving it</label>
      <input type="text" id="labApproveReason" maxlength="500" autocomplete="off">
    </div>
    <p id="labApproveStatus" class="lab-sheet__status" role="status" aria-live="polite" hidden></p>
    <p id="labApproveError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions">
      <button type="button" id="labApproveSend" class="primary" disabled>Approve</button>
    </div>
  </form>
</dialog>
<dialog id="labStartSheet" class="lab-sheet" aria-labelledby="labStartTitle">
  <form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head">
      <h2 id="labStartTitle" class="lab-sheet__title">Start</h2>
      <button type="button" id="labStartCancel" class="btn-outline" aria-label="Close without starting">Cancel</button>
    </div>
    <dl id="labStartFacts" class="lab-start__facts"></dl>
    <ul id="labStartReasons" class="lab-guards" hidden></ul>
    <fieldset class="lab-checklist__set">
      <legend>Before it starts</legend>
      <label class="lab-checkbox-label"><input type="checkbox" id="labStartPlate"><span>The plate is clear and dry</span></label>
      <label class="lab-checkbox-label"><input type="checkbox" id="labStartFilament"><span>The filament matches</span></label>
      <p id="labStartFilamentNote" class="meta lab-start__note"></p>
    </fieldset>
    <p id="labStartWhy" class="meta lab-sheet__hint" aria-live="polite"></p>
    <ol id="labStartSteps" class="lab-start__steps" aria-live="polite" hidden></ol>
    <p id="labStartError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions">
      <button type="button" id="labStartSend" class="primary" disabled>Start</button>
    </div>
  </form>
</dialog>
<dialog id="labDropSheet" class="lab-sheet" aria-labelledby="labDropTitle">
  <form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head">
      <h2 id="labDropTitle" class="lab-sheet__title">Drop</h2>
      <button type="button" id="labDropCancel" class="btn-outline" aria-label="Cancel drop">Cancel</button>
    </div>
    <div class="lab-sheet__field">
      <label for="labDropReason">Why you're dropping it</label>
      <input type="text" id="labDropReason" maxlength="500" autocomplete="off">
    </div>
    <p id="labDropConfirm" class="lab-sheet__error" role="alert" hidden></p>
    <p id="labDropStatus" class="lab-sheet__status" role="status" aria-live="polite" hidden></p>
    <p id="labDropError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions">
      <button type="button" id="labDropSend" class="btn-danger" disabled>Drop</button>
    </div>
  </form>
</dialog>`;
}

// A refused Approve or Drop frees the open sheet for another try (true when it did).
export function actRetryable(ctx, r) {
  if (!ctx || !r || r.status !== "refused" || ctx.reqId !== r.id) return false;
  ctx.reqId = null;
  return true;
}
// The page must not be redrawn under an open dialog, nor while the photo picker is open: the redraw would replace the
// file input whose change event carries the chosen photos.
export const holdRender = (state, doc = globalThis.document) => dialogOpen(doc) || Boolean(state && state.picking);
// The photos sheet's previews are object URLs: let them go when the sheet closes.
export function releasePreviews(state, revoke = (u) => URL.revokeObjectURL(u)) {
  for (const u of list(state && state.previewUrls)) { try { revoke(u); } catch { /* already gone */ } }
  if (state) state.previewUrls = [];
}
// A first load that ended at a cancelled sign-in sheet (a 401 with nothing shown yet) offers a Sign in button.
export const signInOffer = (state, err) => !(state && state.currentData) && Boolean(err && err.status === 401);

export function mount(state) {
  state.left = false;
  state.picking = false;
  state.previewUrls = [];
  state.currentProject = "";
  state.currentData = null;
  state.currentRequests = [];
  state.currentExp = null;
  state.currentReqId = null;
  state.stopWatch = null;
  state.watching = new Set();
  state.sentAt = {};
  state.triedOnce = false;
  state.renderedFp = undefined;
  state.cardSigs = null;
  state.selectedPhotoFiles = [];
  state.selectedPhotoTabs = [];
  state.currentPhotosExp = null;
  state.approveCtx = null;
  state.dropCtx = null;
  state.startCtx = null;

  state.box = h("div", { class: "lab-body", id: "labBody", "aria-live": "polite" });
  state.sheetsContainer = h("div", { id: "labSheets" });
  state.sheetsContainer.innerHTML = sheetsHtml();

  state.root.append(state.box, state.sheetsContainer);

  const verdictSheet = state.sheetsContainer.querySelector("#labVerdictSheet");
  const photosSheet = state.sheetsContainer.querySelector("#labPhotosSheet");

  state.openExperiment = (id) => {
    const cardEl = state.box.querySelector(`#lab-${CSS.escape(id)}`);
    if (!cardEl) return;
    const earlier = cardEl.closest(".lab-earlier");
    if (earlier) earlier.open = true;
    const d = cardEl.querySelector(".lab-details");
    if (d) d.open = true;
    cardEl.scrollIntoView({ block: "start" });
    cardEl.setAttribute("tabindex", "-1");
    cardEl.focus({ preventScroll: true });
  };

  function validateVerdict() {
    const sendBtn = state.sheetsContainer.querySelector("#labVerdictSend");
    const incToggle = state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle");
    const incReason = state.sheetsContainer.querySelector("#labVerdictInconclusiveReason");
    if (!sendBtn) return;
    if (incToggle && incToggle.checked) {
      state.sheetsContainer.querySelectorAll("#labVerdictBody .lab-verdict-row").forEach((r) => r.classList.remove("lab-row--missing"));
      sendBtn.disabled = !incReason?.value.trim();
      return;
    }
    let allComplete = true;
    const rows = state.sheetsContainer.querySelectorAll("#labVerdictBody .lab-verdict-row");
    rows.forEach((row) => {
      let rowComplete = true;
      for (const crit of state.currentExp?.criteria || []) {
        const checked = row.querySelector(`button[data-criterion="${CSS.escape(String(crit.key))}"][aria-checked="true"]`);
        if (!checked) { rowComplete = false; break; }
      }
      if (!rowComplete) {
        allComplete = false;
        row.classList.add("lab-row--missing");
      } else {
        row.classList.remove("lab-row--missing");
      }
    });
    // The light is never assumed: only the diagnostic light can support or refute a prediction, so it is asked for.
    const light = state.sheetsContainer.querySelector("#labVerdictLighting")?.value;
    sendBtn.disabled = !allComplete || !light;
  }

  function saveVerdictDraft() {
    if (!state.currentExp) return;
    const draft = {
      grades: {},
      inconclusive: Boolean(state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle")?.checked),
      inconclusiveReason: state.sheetsContainer.querySelector("#labVerdictInconclusiveReason")?.value || "",
      lighting: state.sheetsContainer.querySelector("#labVerdictLighting")?.value || "",
      note: state.sheetsContainer.querySelector("#labVerdictNote")?.value || "",
    };
    state.sheetsContainer.querySelectorAll("#labVerdictBody .lab-verdict-row").forEach((row) => {
      const tab = row.dataset.tab;
      draft.grades[tab] = {};
      row.querySelectorAll('button[aria-checked="true"]').forEach((btn) => {
        draft.grades[tab][btn.dataset.criterion] = btn.dataset.choice;
      });
    });
    try {
      localStorage.setItem("printLab:draft:" + state.currentExp.id, JSON.stringify(draft));
    } catch {}
  }

  state.openVerdictSheet = (exp) => {
    state.currentExp = exp;
    state.currentReqId = null;
    const body = state.sheetsContainer.querySelector("#labVerdictBody");
    const title = state.sheetsContainer.querySelector("#labVerdictTitle");
    if (!verdictSheet || !body) return;
    if (title) title.textContent = `Record verdict · ${exp.id}`;

    const tabs = (exp.variants || []).map((v) => v.tab || v.id).filter(Boolean);
    body.innerHTML = tabs.map((tab) => {
      const critRows = (exp.criteria || []).map((c) => `
        <div class="lab-verdict-criterion" role="radiogroup" aria-label="${esc(c.label)} for ${esc(tab)}">
          <span class="lab-verdict-criterion__label">${esc(c.label)}</span>
          <div class="lab-chips">
            ${verdictChoices(c).map((ch) => `<button type="button" class="btn-outline lab-chip" role="radio" aria-checked="false" data-tab="${esc(tab)}" data-criterion="${esc(c.key)}" data-choice="${esc(ch)}"${ch === NOT_JUDGED ? ' aria-label="not judged"' : ""}>${esc(ch)}</button>`).join("")}
          </div>
        </div>
      `).join("");
      return `<div class="lab-verdict-row" data-tab="${esc(tab)}"><div class="lab-verdict-row__title">Strip ${esc(tab)}</div>${critRows}</div>`;
    }).join("");

    let draft = { grades: {}, inconclusive: false, inconclusiveReason: "", lighting: "", note: "" };
    try {
      const saved = localStorage.getItem("printLab:draft:" + exp.id);
      if (saved) draft = Object.assign(draft, JSON.parse(saved));
    } catch {}

    for (const [tab, crits] of Object.entries(draft.grades || {})) {
      for (const [critKey, choice] of Object.entries(crits || {})) {
        const btn = body.querySelector(`button[data-tab="${CSS.escape(tab)}"][data-criterion="${CSS.escape(critKey)}"][data-choice="${CSS.escape(String(choice))}"]`);
        if (btn) btn.setAttribute("aria-checked", "true");
      }
    }

    const incToggle = state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle");
    const incBox = state.sheetsContainer.querySelector("#labVerdictInconclusiveBox");
    const incReason = state.sheetsContainer.querySelector("#labVerdictInconclusiveReason");
    if (incToggle) incToggle.checked = Boolean(draft.inconclusive);
    if (incBox) incBox.hidden = !draft.inconclusive;
    if (incReason) incReason.value = draft.inconclusiveReason || "";

    const lightingSelect = state.sheetsContainer.querySelector("#labVerdictLighting");
    if (lightingSelect) lightingSelect.value = draft.lighting || "";
    const noteInput = state.sheetsContainer.querySelector("#labVerdictNote");
    if (noteInput) noteInput.value = draft.note || "";

    const statusEl = state.sheetsContainer.querySelector("#labVerdictStatus");
    const errorEl = state.sheetsContainer.querySelector("#labVerdictError");
    const replaceBtn = state.sheetsContainer.querySelector("#labVerdictReplace");
    if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
    if (replaceBtn) replaceBtn.hidden = true;

    validateVerdict();
    if (!verdictSheet.open) verdictSheet.showModal();
  };

  function addOrUpdateCardRequest(item) {
    if (!item || !item.experiment) return;
    const idx = state.currentRequests.findIndex((r) => r.id === item.id);
    if (idx >= 0) state.currentRequests[idx] = Object.assign({}, state.currentRequests[idx], item);
    else state.currentRequests.unshift(item);
    const el = state.box.querySelector("#lab-requests-" + CSS.escape(String(item.experiment)));
    if (el) {
      const expReqs = state.currentRequests.filter((r) => r.experiment === item.experiment);
      el.innerHTML = renderRequestsList(expReqs);
    }
  }

  // One poller for every pending request on the page (verdicts and photos); it is stopped in leave().
  function track(reqId) {
    if (state.left) return; // a send that finished after leaving the page starts no poller
    state.sentAt[reqId] = Date.now();
    state.watching.add(reqId);
    if (state.stopWatch) state.stopWatch();
    state.stopWatch = watchRequests(state.currentProject, [...state.watching], onRequestUpdate);
  }

  function onRequestUpdate(item) {
    addOrUpdateCardRequest(item);
    if (recorded(item.status) || item.status === "refused") state.watching.delete(item.id);
    updateActStatuses();
    if (state.observeUpdate) state.observeUpdate(item);
    if (item.id !== state.currentReqId) return;
    const statusEl = state.sheetsContainer.querySelector("#labVerdictStatus");
    const errorEl = state.sheetsContainer.querySelector("#labVerdictError");
    const replaceBtn = state.sheetsContainer.querySelector("#labVerdictReplace");
    if (recorded(item.status)) {
      if (statusEl) { statusEl.hidden = false; statusEl.textContent = item.status === "duplicate" ? "Already recorded on the Mac" : "Recorded"; }
      if (errorEl) errorEl.hidden = true;
      try { localStorage.removeItem("printLab:draft:" + (state.currentExp && state.currentExp.id)); } catch {}
    } else if (item.status === "refused") {
      if (statusEl) statusEl.hidden = true;
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = item.message || "Verdict refused by the Mac";
      }
      if (item.message && item.message.includes("already has a verdict") && replaceBtn) replaceBtn.hidden = false;
      const sendBtn = state.sheetsContainer.querySelector("#labVerdictSend");
      if (sendBtn) sendBtn.disabled = false;
    } else if (statusEl && Date.now() - (state.sentAt[item.id] || Date.now()) > STALE_MS) {
      statusEl.textContent = "The Mac hasn't picked this up yet. It runs when the Mac is awake.";
    }
  }

  async function sendVerdict(isReplace = false) {
    if (!state.currentExp) return;
    const statusEl = state.sheetsContainer.querySelector("#labVerdictStatus");
    const errorEl = state.sheetsContainer.querySelector("#labVerdictError");
    const replaceBtn = state.sheetsContainer.querySelector("#labVerdictReplace");
    const sendBtn = state.sheetsContainer.querySelector("#labVerdictSend");

    let draft = {};
    try { draft = JSON.parse(localStorage.getItem("printLab:draft:" + state.currentExp.id) || "{}"); } catch {}

    const reqId = isReplace ? makeRequestId() : (state.currentReqId || makeRequestId());
    state.currentReqId = reqId;

    if (statusEl) { statusEl.hidden = false; statusEl.textContent = "Waiting for the Mac"; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
    if (replaceBtn) replaceBtn.hidden = true;
    if (sendBtn) sendBtn.disabled = true;

    const payload = verdictPayload(draft, isReplace);

    try {
      await labFetch(`/api/lab/${encodeURIComponent(state.currentProject)}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reqId,
          kind: "verdict",
          experiment: state.currentExp.id,
          run: state.currentExp.run || null,
          payload,
        }),
      });

      addOrUpdateCardRequest({ id: reqId, kind: "verdict", experiment: state.currentExp.id, status: "pending" });
      track(reqId);
    } catch (err) {
      if (statusEl) statusEl.hidden = true;
      if (errorEl) { errorEl.hidden = false; errorEl.textContent = err.message || "Network error"; }
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  state.openPhotosSheet = (exp, files) => {
    releasePreviews(state);
    state.currentPhotosExp = exp;
    state.selectedPhotoFiles = files;
    state.selectedPhotoTabs = new Array(files.length).fill(null);
    const list = state.sheetsContainer.querySelector("#labPhotosList");
    const title = state.sheetsContainer.querySelector("#labPhotosTitle");
    const statusEl = state.sheetsContainer.querySelector("#labPhotosStatus");
    const errorEl = state.sheetsContainer.querySelector("#labPhotosError");
    const sendBtn = state.sheetsContainer.querySelector("#labPhotosSend");
    if (!photosSheet || !list) return;

    if (title) title.textContent = `Add photos · ${exp.id}`;
    if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
    if (sendBtn) sendBtn.disabled = false;

    const tabs = (exp.variants || []).map((v) => v.tab || v.id).filter(Boolean);
    list.innerHTML = files.map((file, idx) => {
      const previewUrl = URL.createObjectURL(file);
      state.previewUrls.push(previewUrl);
      const tabChips = tabs.map((t) => `<button type="button" class="btn-outline lab-chip" data-tab="${esc(t)}" aria-checked="false">${esc(t)}</button>`).join("");
      return `<div class="lab-photo-row" data-photo-idx="${idx}"><img class="lab-photo-thumb" src="${previewUrl}" alt="Photo ${idx + 1}"><div class="lab-photo-tabs" role="group" aria-label="Select tab for photo ${idx + 1}">${tabChips}</div></div>`;
    }).join("");

    if (!photosSheet.open) photosSheet.showModal();
  };

  // ---- Start, Approve, Drop ----
  const sheetEl = (id) => state.sheetsContainer.querySelector("#" + id);
  const expById = (id) => state.currentData?.index?.experiments?.find((x) => x.id === id);
  function setStatus(el, text, bad) {
    if (!el) return;
    el.textContent = text; el.hidden = !text;
    if (bad) el.dataset.tone = "bad"; else delete el.dataset.tone;
  }

  function updateActStatuses() {
    for (const el of state.box.querySelectorAll("[data-act-status]")) {
      const r = latestAct(state.currentRequests, el.dataset.actStatus);
      setStatus(el, r ? actText(r) : "", r && r.status === "refused");
      el.parentElement.querySelectorAll(".lab-acts button").forEach((b) => { b.disabled = Boolean(r && r.status === "pending"); });
    }
    for (const [ctx, s, e, again] of [[state.approveCtx, "labApproveStatus", "labApproveError", validateApprove], [state.dropCtx, "labDropStatus", "labDropError", () => armDrop(false)]]) {
      const r = ctx && ctx.reqId && state.currentRequests.find((q) => q.id === ctx.reqId);
      if (!r) continue;
      setStatus(sheetEl(s), r.status === "refused" ? "" : actText(r));
      setStatus(sheetEl(e), r.status === "refused" ? actText(r) : "", true);
      if (actRetryable(ctx, r)) again(); // the Mac said no: the sheet stays open and can send again
    }
  }

  state.refreshStatuses = updateActStatuses;
  async function sendAct(req) {
    await labFetch(`/api/lab/${encodeURIComponent(state.currentProject)}/requests`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
    });
    addOrUpdateCardRequest({ id: req.id, kind: req.kind, experiment: req.experiment, status: "pending", message: null, at: new Date().toISOString() });
    track(req.id);
    updateActStatuses();
    return req.id;
  }

  async function startPrint(btn) {
    const x = expById(btn.dataset.exp);
    if (!x) return;
    btn.disabled = true;
    try { await sendAct(startRequest(x)); }
    catch (err) {
      btn.disabled = false;
      setStatus(btn.closest("li")?.querySelector("[data-act-status]"), err.message || "Couldn't send it to the Mac.", true);
    }
  }

  function validateApprove() {
    const b = sheetEl("labApproveSend"), c = state.approveCtx;
    if (b) b.disabled = !(c && c.build && !c.reqId && sheetEl("labApproveReason").value.trim());
  }

  // The guards being approved and the build they bind to come from the experiment's record; the Mac refuses if either changed.
  async function openApprove(id) {
    const sheet = sheetEl("labApproveSheet");
    if (!sheet) return;
    const ctx = state.approveCtx = { id, record: null, reqId: null };
    sheetEl("labApproveTitle").textContent = `Approve · ${id}`;
    const guards = sheetEl("labApproveGuards"), reason = sheetEl("labApproveReason"), hint = sheetEl("labApproveHint");
    guards.replaceChildren(); reason.value = "";
    hint.textContent = "Reading what this approval covers…";
    setStatus(sheetEl("labApproveStatus"), ""); setStatus(sheetEl("labApproveError"), "", true);
    validateApprove();
    if (!sheet.open) sheet.showModal();
    try {
      const rec = await labFetch(`/api/lab/${encodeURIComponent(state.currentProject)}/record/${encodeURIComponent(id)}`);
      if (ctx !== state.approveCtx) return;
      const cover = approveGuards(rec);
      if (!cover) { hint.textContent = "The Mac hasn't checked this build yet. Run the check on the Mac."; return; }
      ctx.record = rec; ctx.build = cover.build;
      hint.textContent = `You're approving build ${cover.build} for:`;
      for (const g of cover.guards) guards.append(h("li", { class: "lab-guard--attention" }, String(g.message || g.code)));
    } catch { if (ctx === state.approveCtx) hint.textContent = "Couldn't read the experiment. Try again."; }
    validateApprove();
  }

  async function sendApprove() {
    const ctx = state.approveCtx;
    if (!ctx || !ctx.record) return;
    const req = approveRequest(expById(ctx.id) || { id: ctx.id }, ctx.record, sheetEl("labApproveReason").value);
    if (!req) return;
    sheetEl("labApproveSend").disabled = true;
    try { ctx.reqId = await sendAct(req); }
    catch (err) { setStatus(sheetEl("labApproveError"), err.message || "Couldn't send it to the Mac.", true); validateApprove(); }
  }

  // Start a staged lab print (A12): the hub's checks at open and again at the tap, both ticks, then Sent, Accepted,
  // Printing as each happens. The hub refuses anything the sheet missed; the sheet only explains it first.
  const startUrl = (id) => `/api/printer/start/${encodeURIComponent(state.currentProject)}/${encodeURIComponent(id)}`;

  function renderStart() {
    const c = state.startCtx;
    if (!c) return;
    const reasons = sheetEl("labStartReasons");
    reasons.replaceChildren(...list(c.check && c.check.reasons).map((r) => h("li", { class: "lab-guard--attention" }, r)));
    reasons.hidden = !reasons.children.length;
    const note = sheetEl("labStartFilamentNote");
    note.textContent = c.filament ? c.filament.text : "";
    const ready = startReady(c.check, { plate: sheetEl("labStartPlate").checked, filament: sheetEl("labStartFilament").checked }, c.filament);
    const sending = Boolean(c.sent);
    sheetEl("labStartPlate").disabled = sheetEl("labStartFilament").disabled = sending;
    sheetEl("labStartWhy").textContent = sending || reasons.children.length ? "" : ready.why;  // the list says it already
    sheetEl("labStartSend").disabled = sending || !ready.ok;
  }

  async function openStart(id) {
    const sheet = sheetEl("labStartSheet"), x = expById(id);
    if (!sheet || !x) return;
    const ctx = state.startCtx = { id, check: null, filament: null, sent: false, poll: null };
    sheetEl("labStartTitle").textContent = `Start · ${id}`;
    const est = x.estimate || {};
    const facts = [["Build", x.shown_build], ["Time", est.minutes != null ? `${Math.round(est.minutes)} min` : null],
      ["Filament", est.g != null ? `${Math.round(est.g)} g${x.filament ? ` of ${plain(x.filament)}` : ""}` : plain(x.filament)]];
    sheetEl("labStartFacts").replaceChildren(...facts.filter(([, v]) => v).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, String(v))]));
    sheetEl("labStartPlate").checked = false;
    sheetEl("labStartFilament").checked = false;
    const steps = sheetEl("labStartSteps");
    steps.replaceChildren(); steps.hidden = true;
    setStatus(sheetEl("labStartError"), "", true);
    sheetEl("labStartSend").textContent = `Start ${id}`;
    renderStart();
    if (!sheet.open) sheet.showModal();
    try {
      const check = await labFetch(startUrl(id));
      if (ctx !== state.startCtx) return;
      ctx.check = check;
      ctx.filament = startFilament(x.filament, check.printer && check.printer.trays);
      sheetEl("labStartFilament").checked = ctx.filament.state === "match";
    } catch (err) {
      if (ctx === state.startCtx) ctx.check = { reasons: [err.message || "Couldn't read the printer. Try again."] };
    }
    renderStart();
  }

  function startStep(text) {
    const steps = sheetEl("labStartSteps");
    steps.hidden = false;
    steps.append(h("li", {}, text));
  }

  async function sendStart() {
    const c = state.startCtx;
    if (!c || c.sent) return;
    c.sent = true;
    renderStart();
    setStatus(sheetEl("labStartError"), "", true);
    startStep("Sent");
    try {
      const r = await labFetch("/api/printer/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: state.currentProject, experiment: c.id, plate_clear: true, filament_ok: true }),
      });
      if (c !== state.startCtx) return;
      startStep(`Accepted by Bambuddy (queue item ${r.queue_item})`);
      let tries = 0;
      c.poll = setInterval(async () => {
        tries += 1;
        try {
          const now = await labFetch(startUrl(c.id), {}, { prompt: false });
          const st = now && now.printer && now.printer.state;
          if (st === "RUNNING" || st === "PREPARE") {
            clearInterval(c.poll); c.poll = null;
            startStep("Printing. The lab records it at its next pull.");
          }
        } catch { /* the next try reads it again */ }
        if (c.poll && tries >= 24) {  // 2 minutes
          clearInterval(c.poll); c.poll = null;
          startStep("The printer hasn't reported printing yet. Check it on the Workshop page.");
        }
      }, 5000);
    } catch (err) {
      if (c !== state.startCtx) return;
      c.sent = false;
      sheetEl("labStartSteps").replaceChildren(); sheetEl("labStartSteps").hidden = true;
      setStatus(sheetEl("labStartError"), err.message || "Couldn't start it.", true);
      try { c.check = await labFetch(startUrl(c.id)); } catch { /* keep the last check */ }
      renderStart();
    }
  }
  state.openStart = openStart;

  // Drop closes the experiment, so it needs a reason and a second tap.
  function openDrop(id) {
    const sheet = sheetEl("labDropSheet");
    if (!sheet) return;
    state.dropCtx = { id, armed: false, reqId: null };
    sheetEl("labDropTitle").textContent = `Drop · ${id}`;
    sheetEl("labDropReason").value = "";
    setStatus(sheetEl("labDropStatus"), ""); setStatus(sheetEl("labDropError"), "", true);
    armDrop(false);
    if (!sheet.open) sheet.showModal();
  }

  function armDrop(on) {
    const c = state.dropCtx;
    if (!c) return;
    c.armed = on;
    const b = sheetEl("labDropSend"), conf = sheetEl("labDropConfirm");
    conf.hidden = !on; conf.textContent = on ? `Dropping closes ${c.id} for good. Tap again to drop it.` : "";
    b.textContent = on ? `Yes, drop ${c.id}` : "Drop";
    b.disabled = Boolean(c.reqId) || !sheetEl("labDropReason").value.trim();
  }

  async function sendDrop() {
    const ctx = state.dropCtx;
    if (!ctx || ctx.reqId) return;
    if (!ctx.armed) { armDrop(true); return; }
    const req = dropRequest(expById(ctx.id) || { id: ctx.id }, sheetEl("labDropReason").value);
    if (!req) return;
    sheetEl("labDropSend").disabled = true;
    try { ctx.reqId = await sendAct(req); sheetEl("labDropConfirm").hidden = true; }
    catch (err) { setStatus(sheetEl("labDropError"), err.message || "Couldn't send it to the Mac.", true); armDrop(false); }
  }

  async function sendPhotos() {
    if (!state.currentPhotosExp || !state.selectedPhotoFiles.length) return;
    const sendBtn = state.sheetsContainer.querySelector("#labPhotosSend");
    const statusEl = state.sheetsContainer.querySelector("#labPhotosStatus");
    const errorEl = state.sheetsContainer.querySelector("#labPhotosError");

    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) { statusEl.hidden = false; statusEl.textContent = "Uploading photos…"; }
    if (errorEl) errorEl.hidden = true;

    try {
      const uploaded = [];
      for (let i = 0; i < state.selectedPhotoFiles.length; i++) {
        const file = state.selectedPhotoFiles[i];
        const tab = state.selectedPhotoTabs[i] || null;
        const { blob, sha } = await prepareJpeg(file);
        await labFetch(`/api/lab/${encodeURIComponent(state.currentProject)}/incoming/${sha}.jpg`, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        uploaded.push({ sha256: sha, tab });
      }

      const reqId = makeRequestId();
      await labFetch(`/api/lab/${encodeURIComponent(state.currentProject)}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reqId,
          kind: "photos",
          experiment: state.currentPhotosExp.id,
          run: state.currentPhotosExp.run || null,
          payload: {
            run: state.currentPhotosExp.run || null,
            photos: uploaded,
          },
        }),
      });

      addOrUpdateCardRequest({ id: reqId, kind: "photos", experiment: state.currentPhotosExp.id, status: "pending" });
      track(reqId);
      if (photosSheet.open) photosSheet.close();
      toast("Photos uploaded. The Mac will verify them.");
    } catch (err) {
      if (statusEl) statusEl.hidden = true;
      if (errorEl) { errorEl.hidden = false; errorEl.textContent = err.message || "Failed to upload photos"; }
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // Click handler on state.box
  state.box.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      const t = c.dataset.copy;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(t).then(() => toast("Copied command.")).catch(() => {});
      } else {
        const code = c.previousElementSibling;
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
      return;
    }
    const o = e.target.closest("[data-lab-open]");
    if (o) {
      e.preventDefault();
      history.replaceState(history.state, "", `/lab?e=${encodeURIComponent(o.dataset.labOpen)}`);
      state.openExperiment(o.dataset.labOpen);
      return;
    }
    const addBtn = e.target.closest(".lab-add-photos");
    if (addBtn) {
      const expId = addBtn.dataset.exp;
      const input = state.box.querySelector(`input[type="file"][data-exp="${CSS.escape(expId)}"]`);
      if (input) {
        // Until the picker closes, a refresh must not replace this input (see holdRender).
        state.picking = true;
        const done = () => { state.picking = false; };
        input.addEventListener("cancel", done, { once: true });
        window.addEventListener("focus", () => setTimeout(done, 1000), { once: true }); // back from the picker; change comes first
        input.click();
      }
      return;
    }
    const startPrintBtn = e.target.closest(".lab-start-print");
    if (startPrintBtn) { openStart(startPrintBtn.dataset.exp); return; }
    const startBtn = e.target.closest(".lab-start");
    if (startBtn) { startPrint(startBtn); return; }
    const apprBtn = e.target.closest(".lab-approve");
    if (apprBtn) { openApprove(apprBtn.dataset.exp); return; }
    const obsBtn = e.target.closest(".lab-observe");
    if (obsBtn) { state.openObserve(obsBtn.dataset.exp); return; }
    const dropBtn = e.target.closest(".lab-drop");
    if (dropBtn) { openDrop(dropBtn.dataset.exp); return; }
    const recBtn = e.target.closest(".lab-record-verdict");
    if (recBtn) {
      const expId = recBtn.dataset.exp;
      const exp = state.currentData?.index?.experiments?.find((x) => x.id === expId);
      if (exp) state.openVerdictSheet(exp);
      return;
    }
  });

  state.box.addEventListener("change", (e) => {
    const fileInput = e.target.closest("input[type=\"file\"][data-exp]");
    if (fileInput) state.picking = false;
    if (fileInput && fileInput.files && fileInput.files.length) {
      const expId = fileInput.dataset.exp;
      const exp = state.currentData?.index?.experiments?.find((x) => x.id === expId);
      if (exp) state.openPhotosSheet(exp, Array.from(fileInput.files));
      fileInput.value = "";
    }
  });

  mountObserve(state, {
    send: (req) => sendAct(req), watch: (id) => track(id), makeId: makeRequestId, expById, requests: () => state.currentRequests,
    stale: (item) => Date.now() - (item.at ? new Date(item.at) : state.sentAt[item.id] || Date.now()) > STALE_MS,
  });
  mountEvidenceStudio(state);

  // Sheet handlers
  const startSheet = sheetEl("labStartSheet");
  if (startSheet) {
    startSheet.addEventListener("click", (e) => {
      if (e.target.closest("#labStartCancel")) startSheet.close();
      else if (e.target.closest("#labStartSend")) sendStart();
    });
    startSheet.addEventListener("change", renderStart);
    startSheet.addEventListener("close", () => {
      if (state.startCtx && state.startCtx.poll) clearInterval(state.startCtx.poll);
      state.startCtx = null;
    });
  }
  const apprSheet = sheetEl("labApproveSheet"), dropSheet = sheetEl("labDropSheet");
  if (apprSheet) {
    apprSheet.addEventListener("click", (e) => {
      if (e.target.closest("#labApproveCancel")) apprSheet.close();
      else if (e.target.closest("#labApproveSend")) sendApprove();
    });
    apprSheet.addEventListener("input", validateApprove);
    apprSheet.addEventListener("close", () => { state.approveCtx = null; });
  }
  if (dropSheet) {
    dropSheet.addEventListener("click", (e) => {
      if (e.target.closest("#labDropCancel")) dropSheet.close();
      else if (e.target.closest("#labDropSend")) sendDrop();
    });
    dropSheet.addEventListener("input", () => armDrop(false)); // editing the reason un-arms the second tap
    dropSheet.addEventListener("close", () => { state.dropCtx = null; });
  }
  if (verdictSheet) {
    verdictSheet.addEventListener("click", (e) => {
      const chip = e.target.closest("#labVerdictBody button[data-choice]");
      if (chip) {
        const wrap = chip.closest(".lab-chips");
        if (wrap) wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b === chip ? "true" : "false"));
        saveVerdictDraft();
        validateVerdict();
        return;
      }
      if (e.target.closest("#labVerdictCancel")) {
        verdictSheet.close();
        return;
      }
      if (e.target.closest("#labVerdictSend")) {
        sendVerdict(false);
        return;
      }
      if (e.target.closest("#labVerdictReplace")) {
        sendVerdict(true);
        return;
      }
    });

    const incToggle = state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle");
    const incBox = state.sheetsContainer.querySelector("#labVerdictInconclusiveBox");
    const incReason = state.sheetsContainer.querySelector("#labVerdictInconclusiveReason");
    if (incToggle) {
      incToggle.addEventListener("change", () => {
        if (incBox) incBox.hidden = !incToggle.checked;
        saveVerdictDraft();
        validateVerdict();
      });
    }
    if (incReason) {
      incReason.addEventListener("input", () => {
        saveVerdictDraft();
        validateVerdict();
      });
    }
    const lightingSelect = state.sheetsContainer.querySelector("#labVerdictLighting");
    if (lightingSelect) lightingSelect.addEventListener("change", () => { saveVerdictDraft(); validateVerdict(); });
    const noteInput = state.sheetsContainer.querySelector("#labVerdictNote");
    if (noteInput) noteInput.addEventListener("input", saveVerdictDraft);
  }

  if (photosSheet) {
    photosSheet.addEventListener("close", () => releasePreviews(state));
    photosSheet.addEventListener("click", (e) => {
      const tabBtn = e.target.closest(".lab-photo-row button[data-tab]");
      if (tabBtn) {
        const row = tabBtn.closest(".lab-photo-row");
        const idx = Number(row.dataset.photoIdx);
        state.selectedPhotoTabs[idx] = tabBtn.dataset.tab;
        row.querySelectorAll("button[data-tab]").forEach((b) => b.setAttribute("aria-checked", b === tabBtn ? "true" : "false"));
        return;
      }
      if (e.target.closest("#labPhotosCancel")) {
        photosSheet.close();
        return;
      }
      if (e.target.closest("#labPhotosSend")) {
        sendPhotos();
        return;
      }
    });
  }
}

// ?p= picks the project (platform step 6, Decision 1); without it, the first one. A ?p= that names no project returns
// {missing, names} so the page says so, instead of silently opening another project. null when there are none.
export function pickProject(projects, wanted) {
  const named = list(projects).filter((p) => p && typeof p.name === "string" && p.name);
  if (!named.length) return null;
  if (wanted === null || wanted === undefined || wanted === "") return { meta: named[0] };
  const meta = named.find((p) => p.name === wanted);
  return meta ? { meta } : { missing: String(wanted), names: named.map((p) => p.name) };
}

// What a refresh fetches. The first attempt after mount may open the sign-in sheet, once, whatever its outcome; every
// later refresh (main.js repeats load every 15 s) is quiet. Returns null when there is no lab data yet. When the Mac's
// fingerprint is the one already drawn, the project itself isn't fetched again: `labData` is null and `unchanged` is true.
export async function fetchLab(state) {
  const quiet = { prompt: !state.triedOnce };
  state.triedOnce = true;
  const projects = ((await labFetch("/api/lab/projects", {}, quiet)) || {}).projects;
  const pick = pickProject(projects, state.context?.get("p"));
  if (!pick) return null;
  if (pick.missing) return { missing: pick.missing, names: pick.names };
  const meta = pick.meta, pName = meta.name;
  state.currentProject = pName;
  const unchanged = refreshPlan(meta, state.renderedFp, false) === "quiet";
  const [labData, reqData] = await Promise.all([
    unchanged ? null : labFetch(`/api/lab/${encodeURIComponent(pName)}`, {}, quiet),
    labFetch(`/api/lab/${encodeURIComponent(pName)}/requests`, {}, { prompt: false }).catch(() => ({ items: [] })),
  ]);
  if (unchanged) return { labData: null, reqData, meta, unchanged: true };
  return labData ? { labData, reqData, meta } : null;
}

// Re-draw the notebook in place: open <details>, scroll and focus come back, and the cards that changed flash.
function renderInPlace(state, labData) {
  if (state.left) return;
  const snap = snapshot(state.box);
  const sigs = cardSignatures(labData, state.currentRequests);
  const flash = changedIds(state.cardSigs, sigs);
  state.box.innerHTML = renderNotebook(labData, state.currentRequests);
  mountPhotos(state.box, labData.index);
  restore(state.box, snap);
  for (const id of flash) state.box.querySelector(`#lab-${CSS.escape(id)}`)?.classList.add("lab-changed");
  state.cardSigs = sigs;
}

export async function load(state) {
  const got = await fetchLab(state);
  if (state.left) return; // the owner left while this was loading: the page it would draw on is gone
  if (!got) {
    state.box.replaceChildren(card("Print lab", { cls: "wide" }, empty("No lab data yet. Run lab sync on the Mac.")));
    state.sources = labSources(null);
    state.renderedFp = undefined;
    state.cardSigs = null;
    return;
  }
  if (got.missing) {
    const links = h("ul", { class: "lab-projects" }, ...got.names.map((name) =>
      h("li", {}, h("a", { href: `/lab?p=${encodeURIComponent(name)}`, "data-link": true }, name))));
    state.box.replaceChildren(card("Print lab", { cls: "wide" }, empty(`No project called ${got.missing}.`), links));
    state.renderedFp = undefined;
    state.cardSigs = null;
    state.currentData = null;
    state.currentProject = ""; // nothing to send requests to until a real project is open
    return;
  }
  const { labData, reqData, meta } = got;
  state.currentRequests = (reqData && reqData.items) || [];
  const plan = got.unchanged ? "quiet" : refreshPlan(meta, state.renderedFp, holdRender(state));
  if (plan !== "render") {
    // Nothing to redraw (or a dialog is open and must not be disturbed): keep the statuses and the sync age current.
    if (state.currentData && state.currentData.meta) state.currentData.meta = { ...state.currentData.meta, synced_at: meta.synced_at };
    const line = state.box.querySelector(".lab-synced");
    if (line && meta.synced_at) line.outerHTML = syncedHtml({ synced_at: meta.synced_at }, Date.now(), state.currentRequests);
    state.sources = labSources(meta);
    for (const x of list(state.currentData && state.currentData.index && state.currentData.index.experiments)) {
      const el = state.box.querySelector("#lab-requests-" + CSS.escape(String(x.id)));
      if (el) el.innerHTML = requestsHtml(state.currentRequests.filter((r) => r.experiment === x.id));
    }
    if (state.refreshStatuses) state.refreshStatuses();
    return;
  }
  const first = !state.currentData;
  state.currentData = labData;
  state.sources = labSources(meta);
  state.renderedFp = typeof meta.fingerprint === "string" && meta.fingerprint ? meta.fingerprint : undefined;
  renderInPlace(state, labData);

  // ?e= and #lab-<id> open one experiment once, when the page first draws; a refresh must not scroll back to it.
  const e = first && (state.context.get("e") || (location.hash.startsWith("#lab-") ? location.hash.slice(5) : null));
  if (e) {
    state.openExperiment(e);
    if (judgeOnOpen(labData?.index, e, state.context.get("do"))) {
      const exp = labData.index.experiments?.find((x) => x.id === e);
      if (exp) state.openVerdictSheet(exp);
    } else if (state.context.get("do") === "start" && labData?.index?.experiments?.find((x) => x.id === e)?.staged) {
      state.openStart(e);  // Needs you's "Ready to print" (A12)
    }
  }
}

// main.js calls this when load() throws. A cancelled sign-in is the one failure the page can fix with a tap; the tap may open
// the sign-in sheet, while the 15 s refresh still never does.
export function failed(state, err) {
  if (!signInOffer(state, err) || !state.box) return;
  const btn = h("button", { class: "btn-primary", type: "button", onclick: async () => {
    btn.disabled = true;
    try {
      if (await ensure("household")) {
        await load(state);
        const notice = state.root && state.root.parentNode && state.root.parentNode.querySelector(".page-notice");
        if (notice && state.currentData) { notice.hidden = true; state.root.classList.remove("offline"); }
      }
    } catch { /* main.js's next refresh says what went wrong */ } finally { btn.disabled = false; }
  } }, "Sign in");
  state.box.replaceChildren(card("Print lab", { cls: "wide" }, empty("The lab needs the owner."), btn));
}

export function leave(state) {
  state.left = true;
  releasePreviews(state);
  if (state.stopWatch) {
    state.stopWatch();
    state.stopWatch = null;
  }
  if (state.watching) state.watching.clear();
  const vs = state.sheetsContainer?.querySelector("#labVerdictSheet");
  if (vs && vs.open) vs.close();
  const ps = state.sheetsContainer?.querySelector("#labPhotosSheet");
  if (ps && ps.open) ps.close();
  for (const id of ["labViewer", "labCompare", "labEvidenceStudio"]) {
    const d = document.getElementById(id);
    if (d && d.open) d.close();
  }
  for (const id of ["#labApproveSheet", "#labDropSheet"]) {
    const sh = state.sheetsContainer?.querySelector(id);
    if (sh && sh.open) sh.close();
  }
}
