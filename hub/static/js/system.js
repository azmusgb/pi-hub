// System: backups first, then the Pi's services, alerts, automations, help and settings.
import { api, fix, h } from "./core.js";
import { toolUrl } from "./sections.js";
import { agoText } from "./wording.js";
import { linkGroup } from "./section-links.js";
import { displayCard } from "./display-pair.js";

export const every = 300;

export function mount(state) {
  state.backups = h("div");
  state.containers = h("div", { class: "system-containers" });
  state.root.append(
    h("section", { class: "more-group" }, h("h2", {}, "Backups"), state.backups,
      h("a", { class: "tool-link", href: toolUrl("backups"), target: "_blank", rel: "noopener" }, "Restore a file in Backrest ↗")),
    h("section", { class: "more-group" },
      h("h2", {}, "Services on the Pi"),
      state.containers
    ),
    displayCard(),
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
  const [b, act, recs] = await Promise.all([
    api("/api/system/backups").catch(() => null),
    api("/api/actions").catch(() => null),
    api("/api/records").catch(() => null),
  ]);
  state.facts = b?.available ? b.repos.map((r) => `${r.name} ${r.hours === null ? "has no backup" : `backed up ${agoText(r.hours)}`}`).join(", ") : "";
  state.backups.replaceChildren(b?.available
    ? h("ul", { class: "status-list" }, b.repos.map((r) => h("li", {},
      h("span", { class: "dot", dataset: { tone: r.hours === null || r.hours > 36 ? "warn" : "ok" }, "aria-hidden": "true" }),
      h("strong", {}, r.name === "Pi" ? "The Pi" : r.name === "Mac" ? "The Mac" : r.name),
      h("span", { class: "meta" }, ""), h("span", { class: "status-side" }, r.hours === null ? "No backup found" : `Backed up ${agoText(r.hours)}`))))
    : h("p", { class: "meta" }, "Couldn't read the backups just now."));

  renderContainers(state, act, recs);
}

// Which record speaks for each restartable service; the rest have no record, so their row says nothing about health.
const SERVICE_RECORD = { plex: "plex", homebridge: "devices", adguard: "adguard", backrest: "backups", bambuddy: "printer" };
const TONE = { ok: "ok", attention: "warn", problem: "bad" };

export function serviceRows(actions = [], records = []) {
  const byId = new Map((records || []).map((r) => [r.id, r]));
  return actions
    .filter((a) => a?.name?.startsWith("restart:") && a.name !== "restart:pi")
    .map((a) => {
      const key = a.name.slice("restart:".length);
      const rec = byId.get(SERVICE_RECORD[key]);
      const known = rec && rec.state !== "unknown" && !rec.stale;
      return { action: a, name: a.label.replace(/^Restart\s+/i, ""),
        tone: known ? TONE[rec.severity] || "" : "", status: known ? rec.headline : "" };
    });
}

// One row per service: how it is, and a small Restart beside it. Restarting is the rare thing, so it is never the
// whole section (iPad, 1 Nov: eight identical Restart buttons and no status).
function renderContainers(state, act, recs) {
  if (!act?.actions?.length) {
    state.containers.replaceChildren(h("p", { class: "meta" }, "Sign in with household PIN to manage services."));
    return;
  }
  const rows = serviceRows(act.actions, recs?.records || recs);
  state.containers.replaceChildren(
    h("ul", { class: "status-list service-list" },
      rows.map(({ action: a, name, tone, status }) => {
        const btn = h("button", {
          type: "button",
          class: "btn btn--ghost",
          "aria-label": a.label,
          onclick: async () => {
            btn.disabled = true;
            btn.textContent = "Restarting…";
            btn.setAttribute("aria-label", `Restarting ${name}`);
            // fix() asks first, shows the outcome (or the reason it failed) and returns false on cancel or failure.
            const done = await fix(a.name, a.label, {
              confirmText: `${a.label}? Anyone using it is cut off for a moment.`,
              isCurrent: () => btn.isConnected,
            });
            btn.textContent = done ? "Restarted" : "Restart";
            setTimeout(() => { btn.disabled = false; btn.textContent = "Restart"; btn.setAttribute("aria-label", a.label); }, done ? 2000 : 0);
          }
        }, "Restart");
        return h("li", {},
          h("span", { class: "dot", dataset: { tone }, "aria-hidden": "true" }),
          h("strong", {}, name),
          h("span", { class: "meta" }, status),
          h("span", { class: "status-side" }, btn));
      })
    )
  );
}
