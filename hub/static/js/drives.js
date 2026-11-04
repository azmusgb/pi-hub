// Drives: each USB drive's health, and the nightly copy of the PC's movies onto the Pi's drive.
import { api, card, empty, ensure, h, post, toast, when, whoami } from "./core.js";

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

function copyCard(state, d) {
  const m = d.mirror || { state: "never" };
  const fresh = m.last_ok && Date.now() / 1000 - m.last_ok < 2 * 86400;
  const tone = m.state === "running" ? "ok" : m.state === "ok" && fresh ? "ok" : m.state === "failed" ? "bad" : "warn";
  const pill = { running: "Copying", ok: fresh ? "Up to date" : "Out of date", skipped: "Skipped", failed: "Stopped", never: "Not yet" }[m.state] || "Unknown";
  return card("Copy from the Windows PC", { cls: "wide", pill, tone },
    h("p", {}, m.message || ""),
    h("dl", { class: "facts" },
      h("div", {}, h("dt", {}, "Last good copy"), h("dd", {}, m.last_ok ? when(m.last_ok) : "Never")),
      h("div", {}, h("dt", {}, "Movies on the Pi"), h("dd", {}, m.count ?? "—")),
      h("div", {}, h("dt", {}, "Movies on the PC"), h("dd", {}, m.source_count ?? "—")),
      h("div", {}, h("dt", {}, "PC's share"), h("dd", { dataset: { tone: m.share ? "ok" : "warn" } }, m.share ? "Connected" : "Not connected"))),
    h("p", { class: "meta" }, "Plex plays from the Pi's drive, so movies work while the PC is off. New films added on the PC are copied each night at 2:30. Films removed on the PC are kept on the Pi for 30 days first."),
    h("button", { class: "primary", disabled: m.state === "running", onclick: async () => {
      if (!(await ensure("household"))) return;
      try { const r = await post("/api/actions/mirror:movies"); toast(r.message); load(state); } catch (x) { toast(x.message, "bad"); }
    } }, m.state === "running" ? "Copying…" : "Copy new movies now"));
}

export function mount(state) {
  state.body = h("div", { class: "cards" });
  state.root.append(state.body);
}

export async function load(state) {
  if (!state.force && state.root.contains(document.activeElement) && ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
  state.force = false;
  if (!["household", "owner"].includes((await whoami())?.role)) {
    state.body.replaceChildren(card("Storage", {},
      h("p", { class: "meta" }, "Drive health is for the owner. Sign in to see it."),
      h("button", { type: "button", class: "btn", onclick: async () => { if (await ensure("household")) { state.force = true; load(state); } } }, "Sign in")));
    return;
  }
  const d = await api("/api/drives");
  state.body.replaceChildren(
    ...(d.drives.length ? d.drives.map((x) => {
      const hl = health(x);
      return card(x.is_movies ? "Movies drive (Pi)" : "Other drive", { pill: hl.pill ? hl.pill(x) : hl.tone === "ok" ? "Healthy" : hl.tone === "bad" ? "Failing" : "Check", tone: hl.pill ? (x.mounted ? "ok" : "warn") : hl.tone },
        h("p", { class: "big" }, `${x.model || "USB drive"}`),
        h("p", { class: "meta" }, `${gb(x.size)}${x.serial_end ? `, serial ending ${x.serial_end}` : ""}`),
        h("p", {}, hl.say),
        hl.facts.length ? h("dl", { class: "facts" }, hl.facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null);
    }) : [card("No USB drives", {}, empty(d.ok ? "No drives are plugged in. The movies drive may have dropped out; replug it." : (d.message || "The hub's helper didn't answer.")))]),
    copyCard(state, d),
  );
}
