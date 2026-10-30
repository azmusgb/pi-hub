// System: backups first ("Restore a file"), then alerts, automations, help and settings.
import { api, h } from "./core.js";
import { toolUrl } from "./sections.js";
import { agoText } from "./wording.js";
import { linkGroup } from "./section-links.js";

export const every = 300;

export function mount(state) {
  state.backups = h("div");
  state.containers = h("div", { class: "system-containers" });
  state.root.append(
    h("section", { class: "more-group" }, h("h2", {}, "Restore a file"), state.backups,
      h("a", { class: "tool-link", href: toolUrl("backups"), target: "_blank", rel: "noopener" }, "Open Backrest ↗")),
    h("section", { class: "more-group" },
      h("h2", {}, "Appliance Services & Containers"),
      state.containers
    ),
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
  const [b, act] = await Promise.all([
    api("/api/system/backups").catch(() => null),
    api("/api/actions").catch(() => null),
  ]);
  state.facts = b?.available ? b.repos.map((r) => `${r.name} ${r.hours === null ? "has no backup" : `backed up ${agoText(r.hours)}`}`).join(", ") : "";
  state.backups.replaceChildren(b?.available
    ? h("ul", { class: "status-list" }, b.repos.map((r) => h("li", {},
      h("span", { class: "dot", dataset: { tone: r.hours === null || r.hours > 36 ? "warn" : "ok" }, "aria-hidden": "true" }),
      h("strong", {}, r.name === "Pi" ? "The Pi" : r.name === "Mac" ? "The Mac" : r.name),
      h("span", { class: "meta" }, ""), h("span", { class: "status-side" }, r.hours === null ? "No backup found" : `Backed up ${agoText(r.hours)}`))))
    : h("p", { class: "meta" }, "Couldn't read the backups just now."));

  renderContainers(state, act);
}

function renderContainers(state, act) {
  if (!act?.actions?.length) {
    state.containers.replaceChildren(h("p", { class: "meta" }, "Sign in with household PIN to manage services."));
    return;
  }
  const restartActions = act.actions.filter((a) => a.name.startsWith("restart:"));
  state.containers.replaceChildren(
    h("div", { class: "admin-actions-grid" },
      restartActions.map((a) => {
        const btn = h("button", {
          type: "button",
          class: "btn btn-ghost admin-action-btn",
          onclick: async () => {
            btn.disabled = true;
            btn.textContent = "Restarting…";
            try {
              const res = await api(`/api/actions/${a.name}`, { method: "POST" });
              btn.textContent = "✓ Done";
              setTimeout(() => { btn.disabled = false; btn.textContent = a.label; }, 2000);
            } catch (err) {
              btn.textContent = "Failed";
              setTimeout(() => { btn.disabled = false; btn.textContent = a.label; }, 2500);
            }
          }
        }, a.label);
        return btn;
      })
    )
  );
}
