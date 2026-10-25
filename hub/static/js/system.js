// System: backups first ("Restore a file"), then alerts, automations, help and settings.
import { api, h } from "./core.js";
import { toolUrl } from "./sections.js";
import { agoText } from "./wording.js";
import { linkGroup } from "./section-links.js";

export const every = 300;

export function mount(state) {
  state.backups = h("div");
  state.root.append(
    h("section", { class: "more-group" }, h("h2", {}, "Restore a file"), state.backups,
      h("a", { class: "tool-link", href: toolUrl("backups"), target: "_blank", rel: "noopener" }, "Open Backrest ↗")),
    linkGroup("Look after the hub", [
      ["/alerts", "Alerts", "Recent events and warnings"],
      ["/rules", "Automations", "Choose what happens automatically"],
      ["/pi", "Help & system", "Solve a problem and check the hub"],
      ["/drives", "Movie storage", "The movies drive and its health"],
      ["/settings", "Settings", "Household access, connections and backups"],
      [toolUrl("pi"), "The Pi's admin ↗", "Services, updates and logs, in Cockpit"],
    ]));
}

export async function load(state) {
  const b = await api("/api/system/backups").catch(() => null);
  state.backups.replaceChildren(b?.available
    ? h("ul", { class: "status-list" }, b.repos.map((r) => h("li", {},
      h("span", { class: "dot", dataset: { tone: r.hours === null || r.hours > 36 ? "warn" : "ok" }, "aria-hidden": "true" }),
      h("strong", {}, r.name === "Pi" ? "The Pi" : r.name === "Mac" ? "The Mac" : r.name),
      h("span", { class: "meta" }, ""), h("span", { class: "status-side" }, r.hours === null ? "No backup found" : `Backed up ${agoText(r.hours)}`))))
    : h("p", { class: "meta" }, "Couldn't read the backups just now."));
}
