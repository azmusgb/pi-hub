// /assistant/status and /assistant/models: the Assistant's own readings, drawn by Pi Hub from /api/ai/* (A34 P1a, P2).
// Read-only. Every state is drawn and none is empty or fine by default:
//   live; a mirror of the last answer with its age (the PC asleep, or the Assistant not answering); never read, needing
//   the PC; out of date (the Assistant is older than this page needs); refused; and, source by source, ok, failed
//   (with the Assistant's own impact and what to do) or not read yet. Text from the Assistant is set as text.
import { api, h } from "./core.js";
import { ageLabel } from "./freshness.js";
import { faceplate, faceplateLoading, lampRows, section } from "./page-parts.js";
import { ASSISTANT_URL, phrase, sourceDown } from "./sections.js";
import { PAGES as KIT_PAGES } from "../ui/pages.js";

export const every = 30;
const kitRow = (id) => KIT_PAGES.find((p) => p.id === id) || {};
export const TITLES = { status: kitRow("status").label || "Assistant status", models: kitRow("models").label || "Models" };
export const PURPOSES = { status: kitRow("status").purpose || "", models: kitRow("models").purpose || "" };

// How each Windows service reads when it is down: the Assistant's wording (tracker, "Windows services"). `impact` is used
// when the Assistant's own reply carries none; `action` is what to do. A name that isn't here gets neither.
const WORDS = [
  [/ollama/i, "Chat, research and missions are unavailable.", "Start Ollama on the Windows host."],
  [/comfy/i, "Images are unavailable.", "Start ComfyUI on the Windows host."],
  [/^(home|dsh)$/i, "Core appliance unaffected.", "Open the Local AI app on your Mac."],
  [/n8n/i, "Workflows and scheduled automations are paused.", "Start its container in Docker Desktop on the Windows host."],
  [/searx|^search$/i, "Research and current facts are unavailable.", "Start its container in Docker Desktop on the Windows host."],
  [/proxy/i, "Apps that talk to Local AI through its compatible endpoint are cut off.", "Start its container in Docker Desktop on the Windows host."],
  [/grid ?craft|excel/i, "Spreadsheets: Windows computer not answering.", "Check that it is on and GridCraft is open, then choose Refresh."],
  [/art ?craft/i, "Windows computer not answering.", ""],
  [/workshop/i, "Status unavailable.", ""],
];
const wordsFor = (name) => WORDS.find(([re]) => re.test(String(name || ""))) || [null, "", ""];
const SOURCE_LABELS = { services: "Local AI services", gridcraft: "GridCraft / Excel", artcraft: "ArtCraft", workshop: "Workshop display", watch: "Watch",
  installed: "Installed models", loaded: "Loaded models", pulls: "Downloads", routing: "Routing" };
const labelOf = (k) => SOURCE_LABELS[k] || `${String(k).charAt(0).toUpperCase()}${String(k).slice(1)}`;
const SERVICE_TONE = { HEALTHY: ["ok", "Working"], DEGRADED: ["warn", "Degraded"], DOWN: ["bad", "Down"] };

const num = (v) => typeof v === "number" && Number.isFinite(v);
const stateOf = (d, k) => d?.sources?.[k]?.state || "unknown";

// The notice above a reading when it isn't live. `r` is the adapter's answer.
export function banner(r) {
  const age = typeof r.age === "number" ? ageLabel(r.age) : "";
  if (r.state === "mirror") {
    const why = r.why === "pc_off" ? phrase("pc_off") : r.why === "busy" ? "Pi Hub is busy" : phrase("assistant_down");
    return h("p", { class: "ui-notice ui-notice--warn", role: "status" }, `${why}. This is the Assistant's last answer, read ${age}.`);
  }
  if (r.state === "needs_pc") return h("p", { class: "ui-notice ui-notice--warn", role: "status" }, `${phrase("pc_off")}. This page needs the PC, and Pi Hub has no earlier answer for it.`);
  if (r.state === "unreachable") return h("p", { class: "ui-notice ui-notice--warn", role: "status" }, `${phrase("assistant_down")}. Pi Hub has no earlier answer for this page.`);
  if (r.state === "out_of_date") return h("p", { class: "ui-notice ui-notice--warn", role: "status" }, "Assistant out of date. It is older than this page needs, so nothing is shown rather than a guess.");
  if (r.state === "refused") return h("p", { class: "ui-notice ui-notice--bad", role: "status" }, r.error || "Pi Hub can't ask the Assistant.");
  return null;
}

const SOURCE_TONE = { ok: ["ok", "Read"], failed: ["bad", "Isn't answering"], unknown: ["unknown", "Not read yet"] };

// One row per source the Assistant named: ok, failed (with its error and what to do) or not read yet.
export function sourceRows(d, names = Object.keys(d?.sources || {})) {
  return lampRows(names.filter((k) => d.sources[k]).map((k) => {
    const s = d.sources[k];
    const [tone, word] = SOURCE_TONE[s.state] || SOURCE_TONE.unknown;
    const [, impact, action] = wordsFor(k);
    const more = s.state === "failed" ? [s.error, impact, action] : [];
    return { title: labelOf(k), detail: more.filter(Boolean).join(" "), tone, word };
  }));
}

const sourcesLine = (d) => Object.entries(d?.sources || {}).map(([k, s]) => ({ name: labelOf(k), tone: (SOURCE_TONE[s.state] || SOURCE_TONE.unknown)[0],
  word: s.state === "failed" ? "isn't answering" : s.state === "unknown" ? "not read yet" : "" }));

// The plate for a state with nothing to read: a skeleton-free faceplate with the reason in its words.
function bare(name, r) {
  const word = r.state === "needs_pc" ? "Needs the PC" : r.state === "out_of_date" ? "Out of date" : r.state === "refused" ? "Refused" : "Not read";
  return faceplate({ name, lamp: ["unknown", word], readout: "—", caption: "Nothing to show yet." });
}

// ---- status ----

function serviceRows(d) {
  return lampRows((Array.isArray(d.services) ? d.services : []).map((s) => {
    const [tone, word] = SERVICE_TONE[s.state] || ["unknown", "Not reported"];
    const [, impact, action] = wordsFor(s.name);
    const down = s.state === "DOWN" || s.state === "DEGRADED";
    const detail = [s.required ? "Required" : "Optional", ...(down ? [s.error, s.impact || impact, action] : [])].filter(Boolean).join(" · ");
    return { title: s.label || s.name || "Service", detail, tone, word, value: num(s.latencyMs) ? `${Math.round(s.latencyMs)} ms` : null };
  }));
}

export function statusBody(r) {
  const d = r.data;
  const note = banner(r);
  if (!d) return [note, bare(TITLES.status, r)];
  const appliance = stateOf(d, "services");
  const [tone, word] = appliance === "ok" ? SERVICE_TONE[d.overall] || ["unknown", "Not reported"] : ["unknown", appliance === "failed" ? "Isn't answering" : "Not read yet"];
  const stale = r.state === "mirror";
  const summary = d.serviceSummary && typeof d.serviceSummary === "object" ? d.serviceSummary : null;
  const n = (k) => (num(summary?.[k]) ? summary[k] : null);
  const plate = faceplate({ name: TITLES.status, lamp: stale ? ["unknown", "Last known"] : [tone, word], readout: appliance === "ok" ? word : "Unknown", size: "md",
    caption: stale ? `Read ${ageLabel(r.age)}` : "Read just now",
    readings: [["Required services", n("core")], ["Required, not working", n("coreUnhealthy")], ["Optional services", n("optional")], ["Optional, not working", n("optionalUnhealthy")]] });
  const services = appliance === "ok"
    ? section("Services", serviceRows(d), { note: "Required services run the Assistant; optional ones add to it." })
    : section("Services", h("p", { class: "ui-notice ui-notice--warn", role: "status" }, `${sourceDown("Local AI")}. Its services couldn't be read.`));
  const others = Object.keys(d.sources).filter((k) => k !== "services");
  return [note, plate, services, others.length ? section("Other sources", sourceRows(d, others)) : null];
}

// ---- models ----

const sourceError = (d, k) => (typeof d?.sources?.[k]?.error === "string" ? d.sources[k].error : "");
const sizeText = (b) => (num(b) && b > 0 ? `${(b / 1e9).toFixed(1)} GB` : "");
const nameOf = (m) => (typeof m === "string" ? m : typeof m?.name === "string" ? m.name : "");

function listSection(title, d, key, rows, emptyText) {
  const state = stateOf(d, key);
  if (state !== "ok") {
    return section(title, h("p", { class: "ui-notice ui-notice--warn", role: "status" },
      state === "failed" ? `${sourceDown(key === "installed" || key === "loaded" ? "Ollama" : "The Assistant")}.${(key === "installed" || key === "loaded") && (d.runtimeError || sourceError(d, key)) ? ` ${d.runtimeError || sourceError(d, key)}.` : ""}` : "Not read yet."));
  }
  return section(title, rows.length ? lampRows(rows) : h("p", { class: "ui-empty" }, emptyText));
}

export function modelsBody(r) {
  const d = r.data;
  const note = banner(r);
  if (!d) return [note, bare(TITLES.models, r)];
  const stale = r.state === "mirror";
  const okOf = (k) => stateOf(d, k) === "ok";
  const installed = (Array.isArray(d.installed) ? d.installed : []).map(nameOf).filter(Boolean);
  const loaded = (Array.isArray(d.loaded) ? d.loaded : []).map(nameOf).filter(Boolean);
  // Local AI names no runtime flag: the installed-models source is the runtime answering (or not). An explicit flag wins.
  const up = d.runtimeAvailable ?? (stateOf(d, "installed") === "ok" ? true : stateOf(d, "installed") === "failed" ? false : null);
  const runtime = up === true ? ["ok", "Runtime ready"] : up === false ? ["bad", "Runtime not answering"] : ["unknown", "Runtime not reported"];
  const plate = faceplate({ name: TITLES.models, lamp: stale ? ["unknown", "Last known"] : runtime,
    readout: okOf("installed") ? String(installed.length) : "Unknown", unit: okOf("installed") ? `installed model${installed.length === 1 ? "" : "s"}` : "",
    size: "md", caption: [okOf("loaded") ? `${loaded.length} loaded now` : "Loaded models not read", stale ? `read ${ageLabel(r.age)}` : "read just now"].join(" · "),
    readings: [["Default", typeof d.default === "string" ? d.default : null], ["Runtime", up === false ? d.runtimeError || sourceError(d, "installed") || "Not answering" : null]],
    actions: [h("a", { class: "ui-btn", href: `${ASSISTANT_URL}#models`, target: "_blank", rel: "noopener noreferrer" }, "Manage models on the PC ↗")] });
  const sizes = Object.fromEntries((Array.isArray(d.installed) ? d.installed : []).map((m) => [nameOf(m), sizeText(m?.sizeBytes)]));
  const rows = installed.map((n) => ({ title: n, detail: [n === d.default ? "Default" : "", sizes[n]].filter(Boolean).join(" · "), tone: loaded.includes(n) ? "ok" : "unknown", word: loaded.includes(n) ? "Loaded" : "Not loaded" }));
  const pulls = Array.isArray(d.pulls) ? d.pulls.length : null;
  // Local AI's routing: a table of what runs where (label, where). Read as text; anything else is left out.
  const table = Array.isArray(d.routing?.table) ? d.routing.table.filter((r) => typeof r?.label === "string") : [];
  const routing = table.map((r) => [r.label, typeof r.where === "string" ? r.where : ""]);
  return [note, plate, listSection("Installed", d, "installed", rows, "No models are installed. Pull one on the PC."),
    stateOf(d, "pulls") === "ok" ? section("Downloads", h("p", { class: pulls ? "" : "ui-empty" }, pulls ? `${pulls} in progress.` : "Nothing is downloading.")) : listSection("Downloads", d, "pulls", [], ""),
    routing.length && okOf("routing") ? section("Routing", lampRows(routing.map(([k, v]) => ({ title: k, detail: v })))) : stateOf(d, "routing") === "ok" ? null : listSection("Routing", d, "routing", [], ""),
    section("Sources", sourceRows(d), { id: "models-sources" })];
}

// ---- the two pages ----

// Redraw only what changed in words, and put focus back on the same control: a refresh never drops a keyboard user.
export function redraw(box, nodes) {
  const next = h("div", {}, ...nodes);
  if (next.textContent === box.textContent && box.childNodes.length) return;
  const at = document.activeElement;
  const was = at && box.contains(at) ? at.textContent : null;
  box.replaceChildren(...nodes);
  if (was !== null) [...box.querySelectorAll("a, button, summary")].find((x) => x.textContent === was)?.focus({ preventScroll: true });
}

function page(key, path, build) {
  return {
    every,
    mount(state) {
      state.body = h("div", { class: `assistant-read assistant-read--${key}` }, faceplateLoading(TITLES[key]));
      state.root.append(h("nav", { class: "page-trail", "aria-label": "Breadcrumb" }, h("a", { href: "/assistant", "data-link": true }, "Assistant"),
        h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, TITLES[key])), state.body);
    },
    async load(state) {
      const r = await api(path);  // a hub that doesn't answer throws: main.js shows its own "couldn't refresh" notice
      redraw(state.body, build(r).filter(Boolean));
      state.facts = r.data ? `${TITLES[key]}: ${r.state === "live" ? "read just now" : "last known answer"}` : "";
      state.sources = sourcesLine(r.data);
    },
  };
}

export const statusPage = page("status", "/api/ai/status", statusBody);
export const modelsPage = page("models", "/api/ai/models", modelsBody);
