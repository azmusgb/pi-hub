// Drives: each USB drive's health, and the helper that moves the movies onto a new drive.
import { api, card, empty, ensure, h, post, toast, when } from "./core.js";

export const every = 10;

const gb = (bytes) => bytes ? `${(bytes / 1e9).toFixed(bytes > 1e11 ? 0 : 1)} GB` : "—";

function health(d) {
  const s = d.smart;
  if (!s) return { tone: "warn", say: "This drive's enclosure doesn't pass on its health report.", facts: [] };
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

function moveCard(state, d) {
  const m = d.move || {};
  const candidates = d.drives.filter((x) => !x.is_movies);
  if (m.state === "running") {
    const pct = m.percent ?? 0;
    return card("Moving the movies", { cls: "wide", pill: `${pct}%`, tone: "warn" },
      h("p", { class: "big" }, m.step || "Working"),
      h("span", { class: "meter" }, h("i", { style: `width:${pct}%`, dataset: { tone: "ok" } })),
      h("p", { class: "meta" }, `${gb(m.copied)} of ${gb(m.total)} copied. Started ${when(m.started)}. Keep both drives plugged in.`),
      m.failed?.length ? h("p", { class: "note" }, `${m.failed.length} file${m.failed.length > 1 ? "s" : ""} couldn't be read so far.`) : null);
  }
  if (m.state === "copied") {
    return card("Ready to switch", { cls: "wide", pill: "Copy finished", tone: "ok" },
      h("p", {}, `Everything that could be read is on the new drive. ${m.missing?.length ? `${m.missing.length} file${m.missing.length > 1 ? "s" : ""} didn't copy.` : "Every file copied."}`),
      m.missing?.length || m.failed?.length ? h("details", {}, h("summary", {}, "Files that didn't copy"),
        h("ul", { class: "pkg" }, [...new Set([...(m.failed || []), ...(m.missing || [])])].slice(0, 100).map((f) => h("li", {}, f)))) : null,
      h("p", { class: "meta" }, "Switching makes the new drive the movies drive. Plex restarts and rescans; the old drive is left as it is, so you can unplug it afterwards."),
      h("button", { class: "primary", onclick: async () => {
        if (!(await ensure("owner"))) return;
        if (!confirm("Switch Plex to the new drive now?")) return;
        try { const r = await post("/api/drives/switch"); toast(r.message); load(state); } catch (x) { toast(x.message, "bad"); }
      } }, "Switch to the new drive"));
  }
  if (m.state === "switched") {
    return card("Movies moved", { cls: "wide", pill: "Done", tone: "ok" },
      h("p", {}, `The movies have been on the new drive since ${when(m.switched)}. You can unplug the old drive.`));
  }
  const pick = h("select", { id: "move-to", name: "device" }, candidates.map((x) => h("option", { value: x.name }, `${x.model || "USB drive"}, ${gb(x.size)}`)));
  const confirmBox = h("input", { type: "text", id: "move-confirm", name: "confirm", autocomplete: "off", autocapitalize: "characters", placeholder: "ERASE" });
  return card("Move the movies to a new drive", { cls: "wide", pill: m.state === "failed" ? "Stopped" : null, tone: "bad" },
    m.state === "failed" ? h("p", { class: "note" }, `${m.message || "The last move stopped."} Start it again to carry on from where it stopped.`) : null,
    h("ol", { class: "steps" },
      h("li", {}, "Plug the new drive into the Pi, next to the old one. A powered hub helps."),
      h("li", {}, "Pick it below and type ERASE. The new drive is wiped; the old one is only read."),
      h("li", {}, "The hub copies every movie it can read, lists any it can't, then asks before switching.")),
    candidates.length
      ? h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault();
        if (!(await ensure("owner"))) return;
        try {
          const r = await post("/api/drives/move", { device: pick.value, confirm: confirmBox.value });
          toast(r.message); load(state);
        } catch (x) { toast(x.message, "bad"); }
      } },
      h("label", { class: "field", for: "move-to" }, h("span", {}, "New drive"), pick),
      h("label", { class: "field", for: "move-confirm" }, h("span", {}, "Type ERASE to wipe the new drive"), confirmBox),
      h("button", { type: "submit", class: "primary" }, m.state === "failed" ? "Carry on with the move" : "Start the move"))
      : empty("No new drive is plugged in yet."));
}

export function mount(state) {
  state.body = h("div", { class: "cards" });
  state.root.append(state.body);
}

export async function load(state) {
  if (!state.force && state.root.contains(document.activeElement) && ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
  state.force = false;
  const d = await api("/api/drives");
  state.body.replaceChildren(
    ...(d.drives.length ? d.drives.map((x) => {
      const hl = health(x);
      return card(x.is_movies ? "Movies drive" : "Other drive", { pill: hl.tone === "ok" ? "Healthy" : hl.tone === "bad" ? "Failing" : "Unknown", tone: hl.tone },
        h("p", { class: "big" }, `${x.model || "USB drive"}`),
        h("p", { class: "meta" }, `${gb(x.size)}${x.serial_end ? `, serial ending ${x.serial_end}` : ""}`),
        h("p", {}, hl.say),
        hl.facts.length ? h("dl", { class: "facts" }, hl.facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null);
    }) : [card("No USB drives", {}, empty(d.ok ? "No drives are plugged in. The movies drive may have dropped out; replug it." : (d.message || "The hub's helper didn't answer.")))]),
    moveCard(state, d),
  );
}
