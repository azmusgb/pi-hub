// The printer card (/api/now and /api/workshop give the same one) as the kit's reading, for the page's sentence
// (A37 R2: Pi Hub supplies facts, ApplianceSay writes the words). Pure and import-free, so Home can use it too.
// A fact the card doesn't have is left out or null: never zero, never a guess.

// How old the readings are: "checked …" while the source answers, "last seen …" once it has stopped.
export function telemetryAge(iso, stale = false) {
  const word = stale ? "last seen" : "checked";
  const parsed = Date.parse(iso || "");
  const ms = Date.now() - parsed;
  if (!Number.isFinite(parsed) || !Number.isFinite(ms) || ms < 0) return stale ? "last seen a while ago" : "checked now";
  const sec = Math.floor(ms / 1000);
  if (sec < 10) return stale ? "last seen just now" : "checked now";
  if (sec < 60) return `${word} ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${word} ${min}m ago`;
  return `${word} ${Math.floor(min / 60)}h ago`;
}

// A temperature and its target. The printer reports a target of 0 when that heater is off: that is no target, so one
// number (A7 decision 6), not "27°C / 0°C".
export function tempText(now, target) {
  if (now === null || now === undefined || now === "") return null;
  return `${now}°C${target ? ` / ${target}°C` : ""}`;
}

// A file name as a title: no extension, and "RIFT_MARKED_10IN_SINGLE" as "Rift marked 10in single". Mixed-case names
// are kept as they were written.
export function jobTitle(name) {
  // A print started from the printer's own storage names its file by path ("/data/Metadata/plate 1"): the name is the
  // last part, said like a name (A7 P5: no paths in page text).
  const raw = String(name || "");
  const path = /[\\/]/.test(raw);
  const base = raw.split(/[\\/]/).pop().replace(/\.(gcode\.3mf|3mf|gcode)$/i, "").trim();
  if (!base) return "";
  const spaced = base.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (path && spaced === spaced.toLowerCase()) return spaced[0].toUpperCase() + spaced.slice(1);
  if (spaced !== spaced.toUpperCase()) return spaced;
  const lower = spaced.toLowerCase();
  return lower[0].toUpperCase() + lower.slice(1);
}

// The readings' source, as a chip. "Offline" only when a source answered and said so (Bambuddy with connected: false);
// no source answering says nothing about the printer, so that is "No answer" in the neutral colour (spec section 9).
export function telemetryLabel(p) {
  const telemetry = p?.telemetry || {};
  // The source stopped answering (a stale record): the readings shown are its last, so "No answer", whatever they say.
  if (telemetry.status === "stale") {
    return { state: "none", label: "No answer", why: `${telemetry.source || "The printer's source"} isn't answering; these are its last readings.`, stale: true };
  }
  const reported = telemetry.status === "offline" && telemetry.source && telemetry.source !== "No source";
  let state = ["live", "degraded"].includes(telemetry.status) ? telemetry.status : reported ? "offline" : "none";
  // A printer that is printing or paused is physically there, whatever the telemetry says.
  if (state !== "live" && state !== "degraded" && (p?.state === "printing" || p?.state === "paused")) state = "degraded";
  // "Fallback" said nothing (iPad, 1 Nov): degraded means Bambuddy isn't connected and the Pi's status is read instead.
  const label = state === "live" ? "Live" : state === "degraded" ? "Backup readings" : state === "offline" ? "Offline" : "No answer";
  const why = state === "degraded"
    ? "Bambuddy isn't connected to the printer, so these readings come from the Pi's status service and update less often."
    : state === "none" ? "No source has answered with the printer's state." : telemetry.source || "Printer telemetry";
  return { state, label, why };
}

// The card's state words (hub/now.py PRINTER_STATE) -> the kit's status.
const STATUS = { printing: "printing", paused: "paused", stopped: "finished", error: "failed", idle: "idle" };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ms = (seconds) => (num(seconds) === null ? null : seconds * 1000);

// What the card says the printer was doing, whatever its freshness; null when the card names no status we know.
function facts(card, title) {
  const status = Object.hasOwn(STATUS, card?.state) ? STATUS[card.state] : null;
  if (!status) return null;
  const out = { status, percent: num(card.percent) };
  const job = title(card.job_name);
  if (job) out.job = job;
  const asOf = ms(card.as_of);
  if (asOf !== null) out.as_of = asOf;
  return out;
}

// `card`: the printer card, or null before the first answer. `failed`: the hub's own status didn't answer this time;
// `last` is then the card last read, said in the past tense with Pi Hub as the source that went quiet.
// `title`: how the page names a job (now.js jobTitle).
export function printerReading(card, { failed = false, last = null, title = (name) => (typeof name === "string" ? name : "") } = {}) {
  if (failed) {
    // A last card that was already stale keeps its own source and age: that source went quiet first, and Pi Hub
    // was still answering when it said so.
    if (last?.stale === true || last?.telemetry?.status === "stale") return printerReading(last, { title });
    const was = facts(last, title);
    return was ? { ...was, state: "stale", source: "Pi Hub" } : { state: "unavailable" };
  }
  if (card === null || card === undefined) return { state: "loading" };
  const tel = card?.telemetry?.status;
  if (tel === "offline") return { state: "unavailable" };
  const said = facts(card, title);
  const stale = card?.stale === true || tel === "stale";
  // Stale with no status (it was offline or unknown when its source went quiet): it has reported before, so not
  // "hasn't reported yet"; nothing is known now.
  if (!said) return { state: stale ? "unavailable" : "unknown" };
  if (stale) {
    const source = typeof card.telemetry?.source === "string" ? card.telemetry.source : "";
    return { ...said, state: "stale", ...(source ? { source } : {}) };
  }
  // "degraded" is the Pi's backup readings: current, so still the present tense.
  if (tel !== "live" && tel !== "degraded") return { state: "unknown" };
  const out = { ...said, state: "live" };
  const left = num(card.minutes_left);
  if (said.status === "printing" && left !== null) {
    out.left_min = left;
    // Counted from when the reading was taken, so the estimate doesn't slide later with every redraw.
    if (said.as_of !== undefined) out.done_at = said.as_of + left * 60000;
  }
  const since = ms(card.since);
  if (said.status === "finished" && since !== null) out.finished_at = since;
  if (Array.isArray(card.actions) && card.actions.includes("clear")) out.plate_ask = true;
  return out;
}
