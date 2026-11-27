// What Home reads of the printer (A37 R2 to R4): the card Home sentences and draws its plate from, the plate's rule, the
// notice for a print whose source went quiet, and the input Home hands ApplianceSay.compose. Split from home-dashboard.js.
import { h } from "./core.js";
import { sayHead } from "./page-parts.js";
import { jobTitle, printerReading } from "./printer-reading.js";
import { sourceDown } from "./sections.js";
import { actionNames } from "./control-room.js";

// The source Home names when /api/records didn't answer. Singular, so the kit's "{name} wasn't read" and the source-down
// phrase both read as English.
export const RECORDS = "Pi Hub's record list";

// The printer card Home reads for its sentence and its plate (A37 R3, R4): /api/now's printer card, enriched by the
// printer record when present (or built from the record alone when a test passes only records).
export function homePrinterCard(d, records) {
  const p = d?.printer && typeof d.printer === "object" ? d.printer : null;
  const pr = (records || []).find((r) => r?.id === "printer") || null;
  if (!p?.state && !pr?.state) return p;
  const dt = pr?.detail || {};
  const pct = typeof p?.percent === "number" ? p.percent : Number.isFinite(dt.progress) ? Math.round(dt.progress) : null;
  const stale = Boolean(p?.stale || pr?.stale || p?.telemetry?.status === "stale");
  const asOf = p?.as_of ?? pr?.as_of ?? null;
  const tel = p?.telemetry || (pr ? { status: stale ? "stale" : "live", source: "Bambuddy", observed_at: Number.isFinite(asOf) ? new Date(asOf * 1000).toISOString() : "" } : undefined);
  return {
    ...p, state: p?.state || pr?.state, stale, as_of: asOf, percent: pct, progress: p?.progress ?? pct ?? 0,
    job_name: p?.job_name ?? dt.job ?? "", layer_num: p?.layer_num ?? dt.layer ?? null, total_layers: p?.total_layers ?? dt.total_layers ?? null,
    minutes_left: p?.minutes_left ?? dt.minutes_left ?? null, actions: Array.isArray(p?.actions) && p.actions.length ? p.actions : actionNames(pr?.actions),
    telemetry: tel, lab: dt.lab?.experiment || dt.lab_experiment || dt.lab || "", labProject: dt.lab?.project || dt.lab_project || "",
  };
}

// Home draws the printer plate only while a print runs or is held (A37 R4, Call 3); idle, the sentence says so.
// With the record list unread the X2D row says "No answer", so a plate beside it would be two honest states for one printer.
export function homePlateShown(card, recordsRead = true) {
  return Boolean(recordsRead && card && (card.state === "printing" || card.state === "paused") && !card.stale && card.telemetry?.status !== "stale");
}

// A print that was running or held when its source went quiet: the sentence and a notice say so, because the plate is
// withheld and a reading nobody refreshes must not read as the print's present.
function homeStalePrint(card) {
  return Boolean(card && (card.state === "printing" || card.state === "paused") && (card.stale || card.telemetry?.status === "stale"));
}

// "Last reading 12 min ago", from the kit's ages (ApplianceNeeds.ago: null from an hour on); nothing said when the age is unknown.
function lastReading(card, nowTs) {
  if (!Number.isFinite(card?.as_of) || card.as_of > nowTs) return "";
  const sec = nowTs - card.as_of;
  const said = sec < 60 ? "a moment ago" : globalThis.ApplianceNeeds?.ago?.(sec) || "over an hour ago";
  return `Last reading ${said}.`;
}

export function printerNote(card, nowTs) {
  if (!homeStalePrint(card)) return null;
  const source = typeof card.telemetry?.source === "string" && card.telemetry.source ? card.telemetry.source : "The printer's source";
  return h("p", { class: "hd-printer-note ui-notice ui-notice--warn", role: "status" }, [`X2D: ${sourceDown(source)}.`, lastReading(card, nowTs)].filter(Boolean).join(" "));
}

const conditionTitle = (p) => (p?.source === "Pi Hub" && typeof p.detail === "string" && p.detail.trim()
  ? p.detail.split(". ")[0].trim() : typeof p?.title === "string" ? p.title.trim() : "");

// What Home hands ApplianceSay.compose (A37 R2, R3): the asks count equals the ask rows Home drew; part unread names
// the source that wasn't read; no asks with open decisions says how many decisions wait; bad conditions beat the
// running print, which beats warn heads-up.
export function homeReading(src = {}, { asks = null, headsUp = [], probs = null, decisions = undefined } = {}) {
  const unread = [...(Array.isArray(src.needs?.unread) ? src.needs.unread : []),
    ...(!src.needs && asks?.length ? ["Needs you"] : []), ...(src.needs && !src.records ? [RECORDS] : [])];
  const count = !src.needs && !asks?.length ? null : Array.isArray(asks) ? asks.length : null;
  const bad = (probs || []).filter((p) => p?.tone === "bad").map((p) => ({ tone: "bad", title: conditionTitle(p) }));
  const warn = (headsUp || []).filter((p) => p?.tone !== "bad").map((p) => ({ tone: "warn", title: conditionTitle(p) }));
  const card = homePrinterCard(src.now, src.records);
  const printer = card?.state ? printerReading(card, { title: jobTitle }) : undefined;
  // A held print, or one whose source went quiet, is not "running": the kit's Home sentence has no clause for it, so
  // the printer's own sentence (written by the kit, sayHome) joins the conditions.
  const held = card && (card.state === "paused" || homeStalePrint(card)) ? printer : undefined;
  return { page: "home", label: "Home", asks: count, unread, ...(decisions !== undefined ? { decisions } : {}),
    conditions: [...bad, ...warn], printer, ...(held ? { held } : {}) };
}

export function sayHome(input, now = Date.now()) {
  const kit = globalThis.ApplianceSay;
  if (!kit) return false;
  const opts = { now, ago: globalThis.ApplianceNeeds?.ago };
  const { held, ...kitInput } = input;
  const line = held ? kit.compose({ page: "printer", label: "Printer", reading: held }, opts).sentences[0] : "";
  if (line) {
    // After the bad conditions, ahead of the warn ones (sentence two: a bad condition, the running print, a warn heads-up).
    const at = kitInput.conditions.filter((c) => c.tone === "bad").length;
    kitInput.conditions = [...kitInput.conditions.slice(0, at), { tone: "warn", title: line }, ...kitInput.conditions.slice(at)];
  }
  return sayHead(kit.compose(kitInput, opts), "now");
}
