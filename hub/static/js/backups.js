// System › Backups (platform step 7, PR 7.3): each Backrest repository and when it last backed up, and where to restore.
import { api, h } from "./core.js";
import { toolUrl } from "./sections.js";
import { agoText } from "./wording.js";

export const every = 300;

export function mount(state) {
  state.backups = h("div");
  state.root.append(
    h("section", { class: "more-group" }, h("h2", {}, "Backups"), state.backups,
      h("p", { class: "open-in" },
        h("a", { class: "tool-link", href: toolUrl("backups"), target: "_blank", rel: "noopener" }, "Restore a file in Backrest ↗"))));
}

export async function load(state) {
  const b = await api("/api/system/backups").catch(() => null);
  state.facts = b?.available ? b.repos.map((r) => `${r.name} ${r.hours === null ? "has no backup" : `backed up ${agoText(r.hours)}`}`).join(", ") : "";
  state.backups.replaceChildren(b?.available
    ? b.repos.length
      ? h("ul", { class: "status-list" }, b.repos.map((r) => h("li", {},
        h("span", { class: "dot", dataset: { tone: r.hours === null || r.hours > 36 ? "warn" : "ok" }, "aria-hidden": "true" }),
        h("strong", {}, r.name === "Pi" ? "The Pi" : r.name === "Mac" ? "The Mac" : r.name),
        h("span", { class: "meta" }, ""), h("span", { class: "status-side" }, r.hours === null ? "No backup found" : `Backed up ${agoText(r.hours)}`))))
      : h("p", { class: "meta" }, "No backup repositories are set up yet.")
    : h("p", { class: "meta" }, "Couldn't read the backups just now."));
}
