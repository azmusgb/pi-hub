// Quick Print (A19 P4): an ordinary STL or 3MF goes from this page to a slice the Mac made. Five sections: Model,
// Settings, Slice, Print and History. The faceplate is the job in hand; the lamp says what is known, never what is hoped.
// No 3D library and no layer view yet (P5, P7); Prepare and Start arrive in P6, so Print says so and stays disabled.
import { api, h, post, toast } from "./core.js";
import { layerInspector } from "./quick-layers.js";
import { PRINTER_ACTIONS, runPrinterAction } from "./printer-actions.js";
import { faceplate, faceplateLoading, fillNeedsHere, lampRows, needsHere, section } from "./page-parts.js";

export const every = 10;

// Server-side, A19 Q7. Waiting work that needs nothing from the owner is neutral (unknown); live work is ok + live; what
// needs the owner is warn or bad (DESIGN.md, decided differences 1).
export const STATE_WORDS = {
  draft: ["unknown", "Draft"], ready_to_slice: ["unknown", "Ready to slice"], queued: ["unknown", "Waiting for the Mac"],
  preparing: ["ok", "Preparing", true], slicing: ["ok", "Slicing", true], validating: ["ok", "Checking", true],
  sliced: ["ok", "Sliced"], needs_attention: ["warn", "Needs attention"], failed: ["bad", "Failed"],
  canceled: ["unknown", "Canceled"], stale: ["warn", "Out of date"], staging: ["ok", "Preparing to print", true],
  staged: ["ok", "Ready to print"], queued_in_bambuddy: ["ok", "Queued on the printer"],
  start_requested: ["ok", "Starting", true], start_accepted: ["ok", "Starting", true],
  printing_confirmed: ["ok", "Printing", true], outcome_uncertain: ["bad", "Outcome uncertain"], finished: ["ok", "Finished"],
};
export const stateLamp = (s) => STATE_WORDS[s] || ["unknown", "Unknown"];
const BUSY = new Set(["queued", "preparing", "slicing", "validating"]);
const EDITABLE = new Set(["draft", "ready_to_slice", "sliced", "needs_attention", "failed", "stale", "staged"]);
const SLICEABLE = new Set(["draft", "ready_to_slice", "sliced", "needs_attention", "failed", "stale"]);

// What the hub's slicer worker may be asked for: mirrors print-lab's lab/quick/settings.py. The Mac refuses anything else.
export const SETTINGS = [
  { key: "layer_height", label: "Layer height", unit: "mm", kind: "number", min: 0.08, max: 0.28, step: 0.01 },
  { key: "wall_loops", label: "Walls", kind: "int", min: 1, max: 6 },
  { key: "top_shell_layers", label: "Top layers", kind: "int", min: 2, max: 10 },
  { key: "bottom_shell_layers", label: "Bottom layers", kind: "int", min: 2, max: 10 },
  { key: "sparse_infill_density", label: "Infill", unit: "%", kind: "int", min: 0, max: 90 },
  { key: "sparse_infill_pattern", label: "Infill pattern", kind: "choice", choices: [["grid", "Grid"], ["gyroid", "Gyroid"]] },
  { key: "enable_support", label: "Supports", kind: "bool" },
  { key: "brim_type", label: "Brim", kind: "choice", choices: [["no_brim", "None"], ["outer_only", "Outer"]] },
  { key: "brim_width", label: "Brim width", unit: "mm", kind: "number", min: 1, max: 10, step: 0.5 },
];

export const bytes = (n) => !Number.isFinite(n) ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} kB` : `${n} B`;

export function ago(ts, now = Date.now() / 1000) {
  if (!Number.isFinite(ts)) return "";
  const s = Math.max(0, Math.round(now - ts));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

// Measured here, from the file the browser already holds: triangle count and size of an STL. null when it isn't one.
export function stlFacts(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 84) return null;
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let bad = false;
  const take = (x, y, z) => { [x, y, z].forEach((v, i) => { if (!Number.isFinite(v)) bad = true; if (v < lo[i]) lo[i] = v; if (v > hi[i]) hi[i] = v; }); };
  if (n > 0 && 84 + 50 * n === buf.byteLength) {
    for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
      const o = 84 + 50 * t + 12 + 12 * v;
      take(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
    }
    return bad ? null : finish(n, lo, hi);
  }
  const text = new TextDecoder("ascii").decode(buf);
  if (!/^\s*solid/i.test(text)) return null;
  let count = 0;
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) { take(+m[1], +m[2], +m[3]); count++; }
  return !bad && count && count % 3 === 0 ? finish(count / 3, lo, hi) : null;
}
const finish = (n, lo, hi) => [...lo, ...hi].every(Number.isFinite)
  ? { triangles: n, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((v) => Math.round(v * 10) / 10) } : null;

// The worker as the page may say it: never idle for a Mac that hasn't asked lately.
export function workerNotice(w) {
  if (!w || w.state === "idle" || w.state === "busy") return null;
  const text = w.state === "none" ? "No slicing worker yet. The Mac hasn't asked for a slice, so a slice will wait."
    : `${w.text || "Mac asleep"}. A slice waits until it wakes.`;
  return h("p", { class: "ui-notice ui-notice--warn quick-worker", role: "status" }, text);
}

export function jobPlate(job, worker, { onChoose } = {}) {
  const choose = h("button", { type: "button", class: "ui-btn ui-btn--primary", onclick: onChoose }, "Choose a model");
  if (!job) {
    return faceplate({ name: "Quick Print", lamp: ["unknown", "No model yet"], readout: "—",
      caption: "Print an ordinary STL or 3MF. The Mac slices it with Bambu Studio and you look at the result before anything is sent.",
      actions: [choose] });
  }
  const [tone, word, live] = stateLamp(job.state);
  const info = job.slice_info || {};
  const reading = job.state === "sliced" && Number.isFinite(info.minutes) ? [`about ${Math.round(info.minutes)}`, "min to print"] : null;
  return faceplate({
    name: "Quick Print", lamp: [tone, word, live],
    readout: reading ? reading[0] : null, unit: reading ? reading[1] : "", size: "md",
    caption: job.state === "outcome_uncertain" ? "The hub can't tell whether the printer started. It won't try again by itself."
      : job.reason || null,
    readings: [["Model", job.name], ["Worker", worker && worker.state !== "none" ? worker.text : null]],
    actions: [choose],
  });
}

// Facts, each said with who found it out (decision 3): the hub checks structure, the browser measures what it holds.
export function modelRows(job, measured) {
  if (!job) return [];
  return [
    { title: "File", detail: "checked by the hub", value: `${job.name}, ${bytes(job.model_bytes)}` },
    { title: "Triangles", detail: measured ? "measured here" : "not measured (STL files only)", value: measured ? measured.triangles.toLocaleString() : "Not reported" },
    { title: "Size", detail: measured ? "measured here" : "not measured (STL files only)", value: measured ? `${measured.size.join(" × ")} mm` : "Not reported" },
    { title: "Watertight, parts, thin walls", detail: "needs the Mac's inspection", value: "Not measured yet" },
  ];
}

function field(spec, value, disabled) {
  const id = `quick-set-${spec.key}`;
  let input;
  if (spec.kind === "choice") {
    input = h("select", { id, class: "ui-field", disabled }, h("option", { value: "" }, "Preset default"),
      ...spec.choices.map(([v, l]) => h("option", { value: v, selected: value === v }, l)));
  } else if (spec.kind === "bool") {
    input = h("select", { id, class: "ui-field", disabled }, h("option", { value: "" }, "Preset default"),
      h("option", { value: "1", selected: value === true }, "On"), h("option", { value: "0", selected: value === false }, "Off"));
  } else {
    input = h("input", { id, class: "ui-field", type: "number", inputmode: "decimal", min: spec.min, max: spec.max,
      step: spec.step || 1, placeholder: "Preset default", value: value ?? "", disabled });
  }
  return h("div", { class: "quick-field" }, h("label", { for: id }, spec.label, spec.unit ? ` (${spec.unit})` : ""), input);
}

// The form's values as the hub's settings object: only what was filled in; null (with a reason) when one is out of range.
export function readSettings(form) {
  const out = {};
  for (const spec of SETTINGS) {
    const el = form.querySelector(`#quick-set-${spec.key}`);
    const raw = el ? String(el.value ?? "").trim() : "";
    if (raw === "") continue;
    if (spec.kind === "bool") out[spec.key] = raw === "1";
    else if (spec.kind === "choice") out[spec.key] = raw;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < spec.min || n > spec.max || (spec.kind === "int" && !Number.isInteger(n))) {
        return { error: `${spec.label} must be ${spec.kind === "int" ? "a whole number " : ""}from ${spec.min} to ${spec.max}.` };
      }
      out[spec.key] = n;
    }
  }
  if (out.brim_type === "no_brim") delete out.brim_width;
  return { settings: out };
}

export function settingsForm(job, onSave) {
  const editable = !!job && EDITABLE.has(job.state);
  const have = job?.settings || {};
  const form = h("form", { class: "quick-settings", novalidate: true }, ...SETTINGS.map((s) => field(s, have[s.key], !editable)));
  const note = h("p", { class: "meta", id: "quick-settings-note", role: "status" },
    !job ? "Choose a model first." : editable ? "Leave a setting blank to use the preset's own." : "Settings can't change while a slice runs or after a print starts.");
  const save = h("button", { type: "submit", class: "ui-btn", disabled: !editable }, "Save settings");
  form.append(note, save);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = readSettings(form);
    if (r.error) { note.textContent = r.error; return; }
    onSave(r.settings);
  });
  return form;
}

export function sliceBody(job, worker, { onSlice, onCancel } = {}) {
  if (!job) return h("p", { class: "ui-empty" }, "Choose a model, then slice it.");
  const st = job.state;
  const out = [];
  const info = job.slice_info;
  if (st === "sliced" && info) {
    out.push(lampRows([
      { title: "Print time", detail: "Bambu Studio's estimate", value: Number.isFinite(info.minutes) ? `about ${Math.round(info.minutes)} min` : "Not reported" },
      { title: "Filament", detail: "Bambu Studio's estimate", value: Number.isFinite(info.grams) ? `about ${info.grams} g` : "Not reported" },
      { title: "Layers", detail: "from the sliced file", value: Number.isFinite(info.layers) ? String(info.layers) : "Not reported" },
      { title: "Start sequence", detail: "checked by the Mac and again by the hub", tone: "ok", word: "X2D start sequence present" },
      { title: "Slicer", detail: "Bambu Studio", value: info.studio_version || "Not reported" },
    ]));
    out.push(h("p", { class: "ui-row__detail quick-hash" }, "sha256 ", h("code", {}, (job.slice_sha256 || "").slice(0, 16) + "…")));
  } else if (BUSY.has(st)) {
    const waiting = st === "queued";
    out.push(h("p", { class: "meta", role: "status" }, waiting
      ? (worker && worker.state === "idle" ? "Waiting for the Mac to pick it up (it asks about once a minute)…" : "Waiting for the Mac…")
      : `${stateLamp(st)[1]}… the Mac reports every 15 seconds; this page checks every 10.`));
  } else if (st === "needs_attention" || st === "failed" || st === "stale") {
    out.push(h("p", { class: `ui-notice ui-notice--${st === "failed" ? "bad" : "warn"}`, role: "status" }, job.reason || stateLamp(st)[1]));
  } else if (st === "canceled") {
    out.push(h("p", { class: "meta" }, "This job was canceled and can't be sliced. Upload the model again."));
  }
  const acts = [];
  if (SLICEABLE.has(st)) {
    const again = st !== "draft" && st !== "ready_to_slice";
    acts.push(h("button", { type: "button", class: again ? "ui-btn" : "ui-btn ui-btn--primary", onclick: onSlice }, again ? "Slice again" : "Slice on the Mac"));
  }
  if (BUSY.has(st) || st === "draft" || st === "ready_to_slice" || st === "sliced") {
    acts.push(h("button", { type: "button", class: "ui-btn", onclick: onCancel }, "Cancel this job"));
  }
  if (acts.length) out.push(h("div", { class: "quick-actions" }, ...acts));
  return h("div", { class: "quick-slice" }, ...out);
}

// The Print section (A19 P6). Prepare puts the file in Bambuddy and starts nothing; Start is its own tap, with the two
// ticks beside it. The page says Printing only when the hub has seen the printer print the job (the server decides).
const WORKING = new Set(["staging", "queued_in_bambuddy", "start_requested", "start_accepted"]);

function tick(id, label, on, onChange) {
  const box = h("input", { type: "checkbox", id, class: "quick-tick__box" });
  box.checked = on;
  box.addEventListener("change", () => onChange(box.checked, id));
  return h("label", { class: "quick-tick", for: id }, box, h("span", {}, label));
}

export function holdLine(check) {
  if (check?.hold) {
    const bed = Number.isFinite(check.hold.bed) ? ` (the bed is ${Math.round(check.hold.bed)} °C)` : "";
    return `Waiting for the bed to cool${bed}. It starts by itself, for up to ${check.hold.minutes} minutes, if nothing else gets in the way.`;
  }
  return check?.last?.say || null;
}

// What the printer reports, as reported: a missing figure is "Not reported", never 0 (P8).
const num = (v) => Number.isFinite(v) ? v : null;
const deg = (v) => num(v) === null ? "Not reported" : `${Math.round(v)} °C`;
const left = (m) => num(m) === null ? "Not reported" : m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
const minutes = (m) => num(m) === null ? "Not reported" : left(m);
const grams = (g) => num(g) === null ? "Not reported" : `${Math.round(g * 10) / 10} g`;

export function monitorRows(m) {
  const p = m?.printer;
  if (!p) return [];
  const conn = p.source === "ok" ? ["ok", "Connected"] : p.source === "disconnected" ? ["bad", "Disconnected"] : ["unknown", "Can't read"];
  const target = (v, t) => (num(t) !== null && num(v) !== null ? `${deg(v)} (target ${Math.round(t)} °C)` : deg(v));
  return [
    { title: "The printer", detail: p.source === "ok" ? "as the printer reports it" : p.source === "disconnected" ? "Bambuddy says the printer is disconnected" : "the hub couldn't read the printer just now", tone: conn[0], word: conn[1] },
    { title: "State", detail: "the printer's own word", value: p.state ? String(p.state).toLowerCase() : "Not reported" },
    { title: "Progress", detail: "percent", value: num(p.progress) === null ? "Not reported" : `${Math.round(p.progress)}%` },
    { title: "Layer", value: num(p.layer) === null ? "Not reported" : `${p.layer}${num(p.total_layers) === null ? "" : ` of ${p.total_layers}`}` },
    { title: "Time left", value: left(p.remaining_minutes) },
    { title: "Nozzle", value: target(p.nozzle, p.nozzle_target) },
    { title: "Bed", value: target(p.bed, p.bed_target) },
  ];
}

export function monitorBody(job, m, { onAction = () => {}, stale = null } = {}) {
  const out = [];
  const p = m?.printer;
  if (!m) { out.push(h("p", { class: "ui-notice ui-notice--warn", role: "status" }, "The hub couldn't read the printer's status just now, so no figures are shown. It keeps trying.")); return out; }
  if (stale) out.push(h("p", { class: "ui-notice ui-notice--warn", role: "status" }, `These figures are stale: the hub last read the printer ${stale}.`));
  if (p?.source === "ok" && p.this_job === false) out.push(h("p", { class: "ui-notice ui-notice--warn", role: "status" }, "The printer isn't showing this job right now, so there are no figures for it."));
  out.push(lampRows(monitorRows(m)));
  const acts = (m.actions || []).filter((a) => PRINTER_ACTIONS[a]);
  const btns = acts.map((a) => h("button", { type: "button", class: "ui-btn", onclick: (e) => onAction(a, e.currentTarget) }, PRINTER_ACTIONS[a].label));
  if (btns.length) out.push(h("div", { class: "quick-actions" }, ...btns));
  out.push(h("p", { class: "meta" }, "Pause and resume are the printer's own actions. To stop this print, use the printer; the hub has no stop of its own."));
  return out;
}

export function outcomeBody(job, m, { onReprint = () => {} } = {}) {
  const o = job.outcome || m?.outcome;
  const out = [];
  const bad = job.state === "failed";
  out.push(h("p", { class: `ui-notice${bad ? " ui-notice--bad" : ""}`, role: "status" }, bad ? (job.reason || "The print didn't finish.") : "Finished. Bambuddy's print log says this print completed."));
  const c = m?.compare;
  if (o) out.push(lampRows([
    { title: "Outcome", detail: "from Bambuddy's print log", tone: bad ? "bad" : "ok", word: o.word || o.status || "Unknown" },
    { title: "Time", detail: `estimated ${minutes(c?.estimate_minutes)}`, value: minutes(c?.actual_minutes) },
    { title: "Filament", detail: `estimated ${grams(c?.estimate_grams)}`, value: grams(c?.actual_grams) },
  ]));
  if (job.file_removed) {
    out.push(h("p", { class: "ui-notice ui-notice--warn", role: "status" }, "Its files were removed to make room, so a reprint needs a new slice: upload the model again."));
  } else {
    out.push(h("p", { class: "meta" }, "A reprint makes a new job from the stored files after they pass the same checks. It still needs Prepare and Start with both ticks."));
    out.push(h("div", { class: "quick-actions" }, h("button", { type: "button", class: "ui-btn ui-btn--primary", onclick: onReprint }, "Reprint")));
  }
  return out;
}

export function printBody(job, check, { onPrepare, onUnprepare, onStart, onResolve, onCancelHold, monitor = null, monitorStale = null, onAction, onReprint, ticks = { plate: false, filament: false }, onTick = () => {} } = {}) {
  const st = job?.state;
  if (!job) return h("div", { class: "quick-print" }, h("p", { class: "ui-empty" }, "Slice a model first."));
  const out = [];
  if (st === "sliced") {
    out.push(h("p", { class: "meta" }, "Prepare sends the sliced file to the printer's library and checks it came through unchanged. It does not start the printer."));
    if (job.reason) out.push(h("p", { class: "ui-notice ui-notice--warn", role: "status" }, job.reason));
    out.push(h("div", { class: "quick-actions" }, h("button", { type: "button", class: "ui-btn ui-btn--primary", onclick: onPrepare }, "Prepare to print")));
  } else if (st === "staging") {
    out.push(h("p", { class: "meta", role: "status" }, "Sending the file to the printer's library and checking it came back byte for byte…"));
  } else if (st === "staged") {
    const known = !!check;
    const reasons = check?.reasons || [];
    const bedOnly = !!check?.bed_only;
    const info = job.slice_info || {};
    out.push(h("p", {}, h("strong", {}, job.name), " is ready. ",
      Number.isFinite(info.minutes) ? `About ${Math.round(info.minutes)} min` : "Time not reported",
      check?.needs?.length ? `, ${check.needs.join(" + ")} filament.` : "."));
    out.push(lampRows([
      { title: "The file", detail: "in the printer's library, identical to the slice", tone: "ok", word: "Prepared" },
      { title: "The printer", detail: !known ? "the hub couldn't read the printer's state just now" : reasons.length ? reasons.join(" ") : "connected, idle, no error, bed cool, filament loaded", tone: !known ? "unknown" : reasons.length ? (bedOnly ? "warn" : "bad") : "ok", word: !known ? "Can't read" : reasons.length ? (bedOnly ? "Bed warm" : "Not ready") : "Ready" },
    ]));
    const line = holdLine(check);
    if (check?.hold) {
      out.push(h("p", { class: "ui-notice ui-notice--warn", role: "status" }, line));
      out.push(h("div", { class: "quick-actions" }, h("button", { type: "button", class: "ui-btn", onclick: onCancelHold }, "Cancel waiting")));
    } else {
      if (line) out.push(h("p", { class: "meta", role: "status" }, line));
      if (job.reason) out.push(h("p", { class: "ui-notice ui-notice--warn", role: "status" }, job.reason));
      const ticked = ticks.plate && ticks.filament;
      out.push(h("div", { class: "quick-ticks" },
        tick("quick-tick-plate", "The plate is clear and dry", ticks.plate, (v, id) => onTick({ ...ticks, plate: v }, id)),
        tick("quick-tick-filament", "The filament matches", ticks.filament, (v, id) => onTick({ ...ticks, filament: v }, id))));
      const why = !known ? "The printer's state can't be read, so Start is off." : !ticked ? "Tick both first." : reasons.length && !bedOnly ? reasons.join(" ") : null;
      const start = h("button", { type: "button", class: "ui-btn ui-btn--primary", disabled: !!why, "aria-describedby": why ? "quick-start-why" : null,
        onclick: () => onStart(bedOnly) }, bedOnly ? "Start when the bed is cool" : "Start print");
      out.push(h("div", { class: "quick-actions" }, start,
        h("button", { type: "button", class: "ui-btn", onclick: onUnprepare }, "Take it back out of the printer's library")));
      if (why) out.push(h("p", { class: "meta", id: "quick-start-why" }, why));
    }
  } else if (st === "queued_in_bambuddy" || st === "start_requested" || st === "start_accepted") {
    out.push(h("p", { class: "meta", role: "status" }, "Sent to the printer. This says Printing only once the hub sees the printer printing it."));
  } else if (st === "printing_confirmed") {
    out.push(h("p", { class: "ui-notice", role: "status" }, "Printing. The hub saw the printer print this job. It says Finished only when Bambuddy's print log says so."));
    out.push(...monitorBody(job, monitor, { onAction, stale: monitorStale }));
  } else if (st === "finished" || (st === "failed" && job.outcome)) {
    out.push(...outcomeBody(job, monitor, { onReprint }));
  } else if (st === "outcome_uncertain") {
    out.push(h("p", { class: "ui-notice ui-notice--bad", role: "status" }, job.reason || "The hub isn't sure whether this started."));
    out.push(h("p", { class: "meta" }, "Look at the printer. The hub will not send it again by itself. If the printer shows it printing, the page will say so within a few seconds. If it isn't printing, this puts the job back to Prepared (it checks the printer and the queue first); starting again needs both ticks again."));
    out.push(...monitorBody(job, monitor, { onAction, stale: monitorStale }));
    out.push(h("div", { class: "quick-actions" }, h("button", { type: "button", class: "ui-btn", onclick: onResolve }, "It isn't printing: go back")));
  } else {
    out.push(h("p", { class: "meta" }, "Slice a model first."));
  }
  return h("div", { class: "quick-print" }, ...out);
}

// "· 61 min · 9.4 g" from the print log's own figures; a figure the log didn't give is left out, not zeroed.
export function outcomeBits(j) {
  const o = j.outcome;
  if (!o) return "";
  const parts = [num(o.seconds) === null ? null : `${Math.round(o.seconds / 60)} min`, num(o.grams) === null ? null : grams(o.grams)].filter(Boolean);
  return ` · ${o.word || o.status || "ended"}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
}

export function historyRows(jobs, selected, onOpen) {
  return lampRows(jobs.map((j) => {
    const [tone, word] = stateLamp(j.state);
    return { title: j.name, detail: `${ago(j.updated)}${outcomeBits(j)}${j.file_removed ? " · file removed, needs a new slice" : ""}`, tone, word,
      action: h("button", { type: "button", class: "ui-btn", "aria-current": j.id === selected ? "true" : null, onclick: () => onOpen(j.id) }, j.id === selected ? "Open (shown)" : "Open") };
  }));
}

const ERROR_TEXT = (e) => (e && e.message) || "The hub didn't accept that.";

export function mount(state) {
  state.selected = new URLSearchParams(location.search).get("j");
  state.measured = {};
  state.upload = null;
  state.plate = h("div", {}, faceplateLoading("Quick Print"));
  state.needs = needsHere();
  state.notice = h("div", { class: "quick-notices" });
  state.file = h("input", { type: "file", id: "quick-file", class: "quick-file", accept: ".stl,.3mf", "aria-label": "Choose an STL or 3MF model" });
  state.file.addEventListener("change", () => { const f = state.file.files?.[0]; if (f) startUpload(state, f); state.file.value = ""; });
  state.modelBox = h("div");
  state.settingsBox = h("div");
  state.sliceBox = h("div");
  state.layersBox = h("div", { class: "quick-layers-box" });
  state.view3dBox = h("div", { class: "quick-3d-box" });
  state.printBox = h("div");
  state.historyBox = h("div");
  state.root.append(state.notice, state.plate, state.needs,
    section("Model", [state.modelBox], { id: "quick-model" }),
    section("Settings", [state.settingsBox], { id: "quick-settings", note: "Standard 0.20 mm PLA, X2D 0.4 mm nozzle. Only settings checked on the Mac are offered." }),
    section("Slice", [state.sliceBox, state.layersBox, state.view3dBox], { id: "quick-slice" }),
    section("Print", [state.printBox], { id: "quick-print-section" }),
    section("History", [state.historyBox], { id: "quick-history" }));
  drawUpload(state);
}

// The 3D view (A19 P7) is a separate module, fetched only when asked for. If it can't load, the 2D layers and every
// other step on the page carry on, so the failure is one line here and nothing else changes.
export function open3d(state, jobId) {
  const msg = h("p", { class: "quick-3d-box__msg", role: "status" });
  const btn = h("button", { type: "button", class: "ui-btn", onclick: async () => {
    btn.disabled = true;
    msg.className = "quick-3d-box__msg";
    msg.textContent = "Loading the 3D view…";
    try {
      const { view3d } = await import("./quick-3d.js");
      msg.textContent = "";
      state.view3d?.destroy();
      state.view3d = view3d(state.view3dBox, jobId);
      btn.hidden = true;
    } catch (e) {
      btn.disabled = false;
      msg.className = "quick-3d-box__msg ui-notice ui-notice--warn";
      msg.textContent = "The 3D view couldn't load. The 2D layers above and every other step still work.";
    }
  } }, "Open 3D view");
  return h("div", { class: "quick-3d-box__open" }, h("p", { class: "ui-muted" }, "An optional 3D look at the model and toolpaths. It isn't needed to slice, review or print."), btn, msg);
}

function select(state, id) {
  state.selected = id;
  const u = new URL(location.href);
  if (id) u.searchParams.set("j", id); else u.searchParams.delete("j");
  history.replaceState({}, "", u.pathname + u.search);
  draw(state);
}

function drawUpload(state) {
  const u = state.upload;
  const drop = h("label", { class: "drop quick-drop", for: "quick-file" }, h("span", { class: "drop-title" }, u ? "Sending…" : "Choose a model, or drop one here"),
    h("span", { class: "meta" }, "STL or 3MF, up to 50 MB."), state.file);
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) startUpload(state, f); });
  const parts = [drop];
  if (u) {
    parts.push(h("div", { class: "quick-progress", role: "status" },
      h("span", {}, `${u.name}: ${bytes(u.sent)} of ${bytes(u.size)}`),
      h("span", { class: "ui-meter", role: "meter", "aria-label": "Upload progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(100 * u.sent / u.size) },
        h("i", { style: `width:${Math.round(100 * u.sent / u.size)}%` })),
      h("button", { type: "button", class: "ui-btn", onclick: () => cancelUpload(state) }, "Cancel the upload")));
  }
  const err = u?.error || state.uploadError;
  if (err) parts.push(h("p", { class: "ui-notice ui-notice--bad", role: "alert" }, err));
  state.uploadBox = h("div", { class: "quick-upload" }, ...parts);
  state.drawModel?.();
}

async function startUpload(state, file) {
  if (state.upload && !state.upload.error) return;
  state.uploadError = null;
  const ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (![".stl", ".3mf"].includes(ext)) { state.upload = { name: file.name, size: 1, sent: 0, error: "Only STL and 3MF models can be printed here." }; drawUpload(state); return; }
  if (file.size === 0 || file.size > 50 * 1048576) { state.upload = { name: file.name, size: Math.max(file.size, 1), sent: 0, error: file.size ? "That file is over 50 MB." : "That file is empty." }; drawUpload(state); return; }
  const u = state.upload = { name: file.name, size: file.size, sent: 0, abort: new AbortController() };
  drawUpload(state);
  try {
    const buf = await file.arrayBuffer();
    const facts = ext === ".stl" ? stlFacts(buf) : null;
    const start = await post("/api/quick/uploads", { filename: file.name, size: file.size }, { signal: u.abort.signal });
    u.id = start.id;
    let offset = 0, last = null;
    while (offset < file.size) {
      const end = Math.min(offset + (start.chunk || 8388608), file.size);
      try {
        last = await api(`/api/quick/uploads/${start.id}?offset=${offset}`, { method: "PUT", body: buf.slice(offset, end),
          headers: { "Content-Type": "application/octet-stream" }, signal: u.abort.signal });
      } catch (e) {
        // Out of step (a retry after a dropped answer): the hub says where it is; carry on from there.
        if (e.status === 409 && Number.isInteger(e.body?.offset) && e.body.offset !== offset && e.body.offset <= file.size) { offset = e.body.offset; u.sent = offset; continue; }
        throw e;
      }
      offset = last.done ? file.size : last.offset;
      u.sent = offset;
      drawUpload(state);
    }
    state.upload = null;
    if (last?.job) { state.measured[last.job.id] = facts; toast(`Uploaded ${file.name}.`); select(state, last.job.id); }
    await load(state);
  } catch (e) {
    if (u.abort.signal.aborted) return;
    const dup = e.body?.duplicate_of;
    state.upload = null;
    state.uploadError = dup ? `${ERROR_TEXT(e)} It is open below.` : ERROR_TEXT(e);
    if (dup) { drawUpload(state); await load(state).catch(() => {}); select(state, dup); } else drawUpload(state);
  }
}

async function cancelUpload(state) {
  const u = state.upload;
  if (!u) return;
  u.abort?.abort();
  if (u.id) await api(`/api/quick/uploads/${u.id}`, { method: "DELETE" }).catch(() => {});
  state.upload = null;
  drawUpload(state);
  toast("Canceled the upload.");
}

function current(state) {
  return (state.jobs || []).find((j) => j.id === state.selected) || null;
}

function draw(state) {
  const job = current(state);
  state.plate.replaceChildren(jobPlate(job, state.worker, { onChoose: () => state.file.click() }));
  state.notice.replaceChildren(...[workerNotice(state.worker)].filter(Boolean));
  state.drawModel = () => state.modelBox.replaceChildren(state.uploadBox || h("div"), ...(job ? [lampRows(modelRows(job, state.measured[job.id]))] : []));
  state.drawModel();
  // Redraw the settings form only when what it shows changed, so typing isn't lost to the 10 s refresh.
  const key = job ? `${job.id}|${job.state}|${JSON.stringify(job.settings)}` : "";
  if (state.settingsKey !== key) {
    state.settingsKey = key;
    state.settingsBox.replaceChildren(settingsForm(job, async (settings) => {
      try { await api(`/api/quick/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ settings }), headers: { "Content-Type": "application/json" } }); toast("Saved the settings."); await load(state); }
      catch (e) { toast(ERROR_TEXT(e), "bad"); }
    }));
  }
  state.sliceBox.replaceChildren(sliceBody(job, state.worker, {
    onSlice: async () => {
      try { await post(`/api/quick/jobs/${job.id}/slice`); toast("Sent to the Mac."); await load(state); }
      catch (e) { toast(ERROR_TEXT(e), "bad"); }
    },
    onCancel: async () => {
      try { await post(`/api/quick/jobs/${job.id}/cancel`); toast("Canceled."); await load(state); }
      catch (e) { toast(ERROR_TEXT(e), "bad"); }
    },
  }));
  // The layer inspector keeps its canvas and place across the 10 s refresh: it is rebuilt only for another slice.
  const lkey = job && job.state === "sliced" && job.slice_sha256 ? `${job.id}|${job.slice_sha256}` : "";
  if (state.layersKey !== lkey) {
    state.layers?.destroy();
    state.layers = null;
    state.view3d?.destroy();
    state.view3d = null;
    state.layersKey = lkey;
    state.layersBox.replaceChildren();
    state.view3dBox.replaceChildren();
    if (lkey) {
      state.layers = layerInspector(state.layersBox, job.id);
      state.view3dBox.append(open3d(state, job.id));
    }
  }
  drawPrint(state, job);
  state.historyBox.replaceChildren((state.jobs || []).length ? historyRows(state.jobs, state.selected, (id) => select(state, id)) : h("p", { class: "ui-empty" }, "Nothing sliced yet. Choose a model above."));
}

function drawPrint(state, job) {
  const c = state.check;
  const key = job ? [job.id, job.state, job.reason, JSON.stringify(c?.reasons), c?.hold?.expires, c?.hold ? "" : c?.last?.at, c?.bed_only, JSON.stringify(state.monitor?.printer), JSON.stringify(state.monitor?.actions), state.monitorFailed, JSON.stringify(job.outcome)].join("|") : "";
  if (state.printKey === key) return; // the ticks live in the DOM: redraw only when what the sheet shows changed
  state.printKey = key;
  const act = (path, method, body, ok) => async () => {
    try {
      const r = await api(`/api/quick/jobs/${job.id}/${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
      toast(ok || (r && r.say) || "Done.");
    } catch (e) { toast(ERROR_TEXT(e), "bad"); }
    state.printKey = null;
    await load(state);
  };
  const ticks = state.ticks?.job === job?.id ? state.ticks : { job: job?.id, plate: false, filament: false };
  state.ticks = ticks;
  state.printBox.replaceChildren(printBody(job, c, {
    ticks, onTick: (t, id) => { state.ticks = { job: job.id, ...t }; state.printKey = null; draw(state); document.getElementById(id)?.focus(); },
    onPrepare: act("prepare", "POST"), onUnprepare: act("prepare", "DELETE", null, "Taken back out."),
    onStart: (wait) => act("start", "POST", { plate_clear: ticks.plate, filament_ok: ticks.filament, wait_for_bed: wait })(),
    onResolve: act("resolve", "POST"), onCancelHold: act("start", "DELETE", null, "Stopped waiting."),
    monitor: state.monitor, monitorStale: state.monitorFailed && state.monitorAt ? ago(state.monitorAt / 1000) || "a while ago" : null,
    onAction: (a, btn) => runPrinterAction(a, [btn], () => { state.printKey = null; load(state); }),
    onReprint: async () => {
      try {
        const r = await post(`/api/quick/jobs/${job.id}/reprint`);
        toast("Made a new job from the stored files. Prepare it to print again.");
        state.selected = r.job.id;
      } catch (e) { toast(ERROR_TEXT(e), "bad"); }
      state.printKey = null;
      await load(state);
    },
  }));
}

export async function load(state) {
  const [jobs, worker] = await Promise.all([api("/api/quick/jobs"), api("/api/quick/worker").catch(() => null), fillNeedsHere(state.needs, "/quick")]);
  state.jobs = jobs.jobs || [];
  state.worker = worker;
  if (!state.selected && state.jobs[0]) state.selected = state.jobs[0].id;
  if (state.selected && !state.jobs.some((j) => j.id === state.selected)) state.selected = state.jobs[0]?.id || null;
  const sel = state.jobs.find((j) => j.id === state.selected);
  state.check = sel && sel.state === "staged" ? await api(`/api/quick/jobs/${sel.id}/start`).catch(() => null) : null;
  const watched = sel && (["printing_confirmed", "outcome_uncertain", "finished"].includes(sel.state) || (sel.state === "failed" && sel.outcome));
  if (watched) {
    if (state.monitorJob !== sel.id) { state.monitor = null; state.monitorAt = null; state.monitorJob = sel.id; }
    try { state.monitor = await api(`/api/quick/jobs/${sel.id}/monitor`); state.monitorAt = Date.now(); state.monitorFailed = false; }
    catch { state.monitorFailed = true; } // the last figures stay, marked stale, never shown as current
  } else { state.monitor = null; state.monitorJob = null; state.monitorAt = null; state.monitorFailed = false; }
  state.sources = [{ name: "The hub", tone: "ok" },
    worker ? { name: "The Mac's slicer", tone: worker.state === "idle" || worker.state === "busy" ? "ok" : "unknown", word: worker.state === "none" ? "not heard from yet" : worker.state === "asleep" ? (ago(worker.last_seen) ? `asleep, seen ${ago(worker.last_seen)}` : "asleep") : worker.state === "busy" ? "slicing" : "ready" }
      : { name: "The Mac's slicer", tone: "unknown", word: "can't be read" }];
  draw(state);
}

export function failed(state) {
  state.sources = [{ name: "The hub", tone: "bad", word: "isn't answering" }];
  if (!state.jobs) state.plate.replaceChildren(faceplate({ name: "Quick Print", lamp: ["unknown", "Not answering"], readout: "—",
    caption: "The hub didn't answer, so Quick Print can't show your jobs. It keeps trying." }));
}

export function leave(state) {
  state.upload?.abort?.abort();
  state.layers?.destroy();
  state.view3d?.destroy();
}
