// Raspberry Pi: health and history, every service, updates, storage and network.
import { api, card, duration, empty, fix, h, piLink, spark, when } from "./core.js";

export const every = 20;

const STATE = { active: ["Running", "ok"], inactive: ["Off", "warn"], failed: ["Failed", "bad"], activating: ["Starting", "warn"] };

export function mount(state) {
  state.range = 24;
  state.body = h("div", { class: "cards" });
  state.root.append(state.body);
}

function chart(title, series, unit, max, current) {
  return h("figure", { class: "chart" },
    h("figcaption", {}, h("span", {}, title), h("strong", {}, current != null ? `${Math.round(current)}${unit}` : "—")),
    spark(series, { max, height: 40 }));
}

function selfcheckCard(c) {
  if (!c) return card("Self-check", {}, empty("The first self-check runs tonight at 4:15. Tap “Run a self-check” above to run one now."));
  const bad = c.checks.filter((x) => !x.ok);
  return card("Self-check", { pill: c.passed ? `All ${c.total} passed` : `${c.failed} of ${c.total} failed`, tone: c.passed ? "ok" : "bad" },
    h("p", { class: "meta" }, `Last run ${when(c.ts)}. Every page, every API, the services, free space, last night's backup and the temperature.`),
    bad.length ? h("ul", { class: "log" }, bad.map((x) => h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone: "bad" } }),
      h("span", { class: "log-main" }, h("strong", {}, x.name), h("span", { class: "meta" }, x.detail))))) : null);
}

export async function load(state) {
  const [d, acts] = await Promise.all([api(`/api/pi?hours=${state.range}`), api("/api/actions")]);
  const CONFIRM = {
    "restart:pi": "Restart the Pi? Plex, Homebridge and the hub go away for about a minute.",
    "updates:install": "Install all waiting updates now? Plex or Homebridge may restart.",
  };
  const upd = acts.updates || {};
  const hist = d.history;
  const live = d.live;
  const ranges = [[6, "6 hours"], [24, "Day"], [168, "Week"]];
  state.body.replaceChildren(
    card("Health", { cls: "wide", pill: d.health.power === "Good" ? "Healthy" : "Check", tone: d.health.power === "Good" ? "ok" : "warn" },
      h("div", { class: "seg", role: "group", "aria-label": "Chart range" }, ranges.map(([hrs, label]) =>
        h("button", { class: "seg-btn", "aria-pressed": String(state.range === hrs), onclick: () => { state.range = hrs; load(state); } }, label))),
      h("div", { class: "charts" },
        chart("Temperature", hist.map((p) => p.temp), " °C", 90, live.temp_series?.at(-1)),
        chart("Processor", hist.map((p) => p.cpu), "%", 100, live.cpu_series?.at(-1)),
        chart("Memory used", hist.map((p) => p.mem), "%", 100, live.mem_series?.at(-1))),
      hist.length < 3 ? h("p", { class: "meta" }, "History builds up over the next hour.") : null,
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Power"), h("dd", { dataset: { tone: d.health.power === "Good" ? "ok" : "bad" } }, d.health.power || "—")),
        h("div", {}, h("dt", {}, "Running for"), h("dd", {}, d.health.uptime_h != null ? `${d.health.uptime_h} h` : "—")))),
    card("Fix it", { cls: "wide", pill: upd.state === "running" ? "Updates installing" : null, tone: "warn" },
      h("p", { class: "meta" }, "One tap. The first time on each device, it asks for the household PIN."),
      h("div", { class: "fix-grid" }, acts.actions.map((a) => h("button", {
        class: "fix-tile", disabled: a.name === "updates:install" && upd.state === "running",
        onclick: async () => { if (await fix(a.name, a.label, { confirmText: CONFIRM[a.name] })) load(state); },
      }, a.label))),
      upd.state === "failed" ? h("p", { class: "note" }, `The last update run didn't finish: ${upd.message}`) : null,
      acts.log.length ? [h("h3", { class: "sub" }, "Recent fixes"), h("ul", { class: "log" }, acts.log.slice(0, 5).map((l) =>
        h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone: /didn't|isn't/.test(l.result) ? "bad" : "ok" } }),
          h("span", { class: "log-main" }, h("strong", {}, l.result), h("span", { class: "meta" }, l.device || "A device")),
          h("span", { class: "log-side" }, when(l.ts)))))] : null),
    selfcheckCard(d.selfcheck),
    card("Outages", { pill: d.outages.length ? `${d.outages.length} in 30 days` : "None", tone: d.outages.length ? "warn" : "ok" },
      d.outages.length ? h("ul", { class: "log" }, d.outages.slice(0, 10).map((o) => h("li", { class: "log-row" },
        h("span", { class: "dot", dataset: { tone: o.end ? "warn" : "bad" } }),
        h("span", { class: "log-main" }, h("strong", {}, o.what), h("span", { class: "meta" }, when(o.start))),
        h("span", { class: "log-side" }, o.end ? duration(o.end - o.start) : "Still down"))))
        : empty("Nothing has gone down in the last 30 days."),
      h("p", { class: "meta" }, "The Windows PC, the movies drive, Plex and Homebridge, as the hub saw them.")),
    card("Services", {},
      h("ul", { class: "log" }, d.services.map((s) => {
        const [label, tone] = STATE[s.state] || [s.state, "warn"];
        return h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone } }),
          h("span", { class: "log-main" }, h("strong", {}, s.name), h("span", { class: "meta" }, s.what)),
          h("span", { class: "log-side", dataset: { tone } }, label));
      })),
      h("a", { class: "action", href: piLink(9090, "/system/services", "https"), target: "_blank", rel: "noopener" }, "More in Cockpit")),
    card("Storage", {},
      d.storage.map((s) => h("div", { class: "store" },
        h("div", { class: "store-head" }, h("strong", {}, s.name), h("span", { class: "meta" }, s.mounted ? `${s.free_gb} GB free of ${s.total_gb} GB` : "Not connected")),
        s.mounted ? h("span", { class: "meter" }, h("i", { style: `width:${s.used_pct}%`, dataset: { tone: s.used_pct > 90 ? "bad" : s.used_pct > 75 ? "warn" : "ok" } })) : null))),
    card("Updates", { pill: d.updates?.length ? `${d.updates.length} waiting` : "Up to date", tone: d.updates?.length ? "warn" : "ok" },
      d.updates?.length ? h("ul", { class: "pkg" }, d.updates.slice(0, 12).map((u) => h("li", {}, h("strong", {}, u.name), h("span", { class: "meta" }, u.version))))
        : empty("Everything's up to date. Security fixes install by themselves each day."),
      d.updates?.length ? h("button", { class: "ghost", onclick: async () => { if (await fix("updates:install", "Install updates", { confirmText: CONFIRM["updates:install"] })) load(state); } }, "Install them now") : null),
    card("Network", {},
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Name"), h("dd", {}, d.network.name)),
        h("div", {}, h("dt", {}, "Address"), h("dd", {}, d.network.ip || "—")),
        h("div", {}, h("dt", {}, "Connection"), h("dd", {}, "Network cable")))),
  );
}
