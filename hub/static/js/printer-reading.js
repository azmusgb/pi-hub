// The printer card (/api/now and /api/workshop give the same one) as the kit's reading, for the page's sentence
// (A37 R2: Pi Hub supplies facts, ApplianceSay writes the words). Pure and import-free, so Home can use it too.
// A fact the card doesn't have is left out or null: never zero, never a guess.

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
    const was = facts(last, title);
    return was ? { ...was, state: "stale", source: "Pi Hub" } : { state: "unavailable" };
  }
  if (card === null || card === undefined) return { state: "loading" };
  const tel = card?.telemetry?.status;
  if (tel === "offline") return { state: "unavailable" };
  const said = facts(card, title);
  if (!said) return { state: "unknown" };
  if (card.stale === true || tel === "stale") {
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
