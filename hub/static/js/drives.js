// Drives: each USB drive's health, and the nightly copy of the PC's movies onto the Pi's drive. A7 P1: the faceplate is
// the worst of the drives and the copy; each drive and the copy are sections.
import { api, ensure, h, post, toast, when, whoami } from "./core.js";
import { faceplate, faceplateLoading, fillNeedsHere, lampRows, needsHere, section } from "./page-parts.js";

export const every = 10;
export const loadDeadline = 160_000;  // the drives report can take 150 s while disks spin up

const gb = (bytes) => bytes ? `${(bytes / 1e9).toFixed(bytes > 1e11 ? 0 : 1)} GB` : "—";

function health(d) {
  const s = d.smart;
  if (!s) return { tone: "none", pill: x => x.mounted ? "Connected" : "Not mounted",
    say: "Its enclosure doesn't pass on a health report, so the hub can't check the disk itself.", facts: [] };
  const bad = (s.reallocated || 0) > 0 || (s.pending || 0) > 0 || (s.uncorrectable || 0) > 0;
  const facts = [
    ["Health check", s.passed ? "Passed" : "Failed"],
    s.hours != null ? ["Hours of use", s.hours.toLocaleString()] : null,
    s.temp != null ? ["Temperature", `${s.temp} °C`] : null,
    s.reallocated != null ? ["Worn-out sectors moved", String(s.reallocated)] : null,
    s.pending != null ? ["Sectors waiting to be checked", String(s.pending)] : null,
    s.ssd_life != null ? ["Life left", `${s.ssd_life}%`] : null,
  ].filter(Boolean);
  if (!s.passed) return { tone: "bad", say: "The drive reports it's failing. Copy what you need off it now.", facts };
  if (bad) return { tone: "warn", say: "The drive has started wearing out. Plan to replace it.", facts };
  return { tone: "ok", say: "Healthy.", facts };
}

const RANK = { ok: 0, unknown: 1, warn: 2, bad: 3 };
const WORD = { ok: "Healthy", warn: "Wearing", bad: "Failing" };

// One drive as the kit draws it: its lamp row (model, size, what it means), then its facts. A drive whose enclosure
// hides its health is shown by whether it is mounted, never as healthy.
function driveTone(x) {
  const hl = health(x);
  return hl.pill ? { tone: x.mounted ? "unknown" : "warn", word: hl.pill(x), hl } : { tone: hl.tone, word: WORD[hl.tone], hl };
}

function copyState(d) {
  const m = d.mirror || { state: "never" };
  const fresh = m.last_ok && Date.now() / 1000 - m.last_ok < 2 * 86400;
  const tone = m.state === "running" ? "ok" : m.state === "ok" && fresh ? "ok" : m.state === "failed" ? "bad" : "warn";
  const word = { running: "Copying", ok: fresh ? "Up to date" : "Out of date", skipped: "Skipped", failed: "Stopped", never: "Not yet" }[m.state] || "Unknown";
  return { m, tone, word };
}

// The faceplate from /api/drives, pure so it is tested without a page. The lamp is the worst of the drives and the copy.
export function drivesPlate(d) {
  if (!d) {
    return faceplate({ name: "Drives", lamp: ["unknown", "Not answering"], readout: "—",
      caption: "The hub's drive report didn't answer. It can take a few minutes while the disks spin up." });
  }
  const drives = Array.isArray(d.drives) ? d.drives : [];
  const copy = copyState(d);
  const states = drives.map(driveTone);
  const worst = [...states.map((s) => s.tone), copy.tone].reduce((w, t) => ((RANK[t] ?? 1) > (RANK[w] ?? 1) ? t : w), "ok");
  const movies = drives.find((x) => x.is_movies);
  const lamp = !drives.length ? ["bad", "No drives"]
    : worst === "ok" ? ["ok", "All healthy"] : worst === "unknown" ? ["unknown", "Health not reported"]
      : [worst, worst === "bad" ? "Needs a look" : "Check"];
  return faceplate({
    name: "Drives", lamp,
    readout: String(drives.length), unit: drives.length === 1 ? "drive connected" : "drives connected", size: "md",
    caption: !drives.length ? (d.ok ? "No drives are plugged in. The movies drive may have dropped out; replug it." : (d.message || "The hub's helper didn't answer."))
      : movies ? `Movies drive: ${driveTone(movies).hl.say}` : "The movies drive isn't among them.",
    readings: [["Copy from the PC", copy.word], ["Movies on the Pi", copy.m.count ?? null]],
  });
}

function driveSection(x) {
  const { tone, word, hl } = driveTone(x);
  return section(x.is_movies ? "Movies drive" : "Other drive", [
    lampRows([{ title: x.model || "USB drive", detail: `${gb(x.size)}${x.serial_end ? `, serial ending ${x.serial_end}` : ""}. ${hl.say}`, tone, word }]),
    hl.facts.length ? h("dl", { class: "facts" }, hl.facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null,
  ]);
}

function copySection(state, d) {
  const { m, tone, word } = copyState(d);
  return section("Copy from the Windows PC", [
    lampRows([{ title: "Nightly copy", detail: m.message || null, tone, word }]),
    h("dl", { class: "facts" },
      h("div", {}, h("dt", {}, "Last good copy"), h("dd", {}, m.last_ok ? when(m.last_ok) : "Never")),
      h("div", {}, h("dt", {}, "Movies on the Pi"), h("dd", {}, m.count ?? "—")),
      h("div", {}, h("dt", {}, "Movies on the PC"), h("dd", {}, m.source_count ?? "—")),
      h("div", {}, h("dt", {}, "PC's share"), h("dd", { dataset: { tone: m.share ? "ok" : "warn" } }, m.share ? "Connected" : "Not connected"))),
    h("button", { type: "button", class: "ui-btn ui-btn--primary", disabled: m.state === "running", onclick: async () => {
      if (!(await ensure("household"))) return;
      try { const r = await post("/api/actions/mirror:movies"); toast(r.message); state.force = true; load(state); } catch (x) { toast(x.message, "bad"); }
    } }, m.state === "running" ? "Copying…" : "Copy new movies now"),
  ], { note: "Plex plays from the Pi's drive, so movies work while the PC is off. New films added on the PC are copied each night at 2:30. Films removed on the PC are kept on the Pi for 30 days first." });
}

export function mount(state) {
  state.plate = h("div", {}, faceplateLoading("Drives"));
  state.needs = needsHere();
  state.body = h("div", { class: "stack" });
  state.root.append(state.plate, state.needs, state.body);
}

export async function load(state) {
  if (!state.force && state.root.contains(document.activeElement) && ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
  state.force = false;
  if (!["household", "owner"].includes((await whoami())?.role)) {
    state.plate.replaceChildren(faceplate({ name: "Drives", lamp: ["unknown", "Signed out"], readout: "—",
      caption: "Drive health is for the household. Sign in to see it.",
      actions: [h("button", { type: "button", class: "ui-btn", onclick: async () => { if (await ensure("household")) { state.force = true; load(state); } } }, "Sign in")] }));
    state.body.replaceChildren();
    return;
  }
  const [d] = await Promise.all([api("/api/drives").catch(() => null), fillNeedsHere(state.needs, "/drives")]);
  state.sources = [d ? { name: "Drive report", tone: "ok" } : { name: "Drive report", tone: "bad", word: "isn't answering" }];
  state.plate.replaceChildren(drivesPlate(d));
  if (!d) return;
  state.body.replaceChildren(...(d.drives || []).map(driveSection), copySection(state, d));
}
