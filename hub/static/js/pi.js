// Raspberry Pi: health and history, every service, updates, storage and network.
import { api, card, duration, empty, fix, h, piLink, spark, when } from "./core.js";

export const every = 20;

const STATE = { active: ["Running", "ok"], inactive: ["Off", "warn"], failed: ["Failed", "bad"], activating: ["Starting", "warn"] };

export function mount(state) {
  state.range = 24;
  state.body = h("div", { class: "cards" });
  state.diagnostic = h("p", { class: "meta", role: "status" }, "Checking system details…");
  const guidance = [
    ["Movies won’t play", "Check the TV’s connection and try Plex again. If movies are missing, check movie storage before restarting anything.", "/movies", "Check Movies"],
    ["Lights aren’t responding", "Check that the light or plug has power. Open Devices to try its controls. If every device is affected, open System checks & advanced fixes below to check the smart-home service.", "/control", "Check Devices"],
    ["Printer won’t print", "Turn on the HP DeskJet and check for paper or an error on its screen. Open Print to see its status and waiting jobs.", "/print", "Check the printer"],
    ["3D printer or workshop problem", "Check the Bambu printer’s screen for errors. Workshop shows the camera, print status and local AI connection.", "/workshop", "Check Workshop"],
  ];
  state.root.append(
    h("section", { class: "help-start", "aria-labelledby": "help-title" },
      h("h2", { id: "help-title" }, "What isn’t working?"),
      h("p", { class: "meta" }, "Start with the problem. These checks won’t restart or change anything."),
      h("div", { class: "help-topics" }, guidance.map(([title, advice, href, label]) =>
        h("details", { class: "help-topic" }, h("summary", {}, title),
          h("p", {}, advice), h("a", { class: "action", href, "data-link": true }, label)))),
      h("a", { class: "action", href: "/drives", "data-link": true }, "Check movie storage")),
    h("details", { class: "system-details" }, h("summary", {}, "System checks & advanced fixes"), state.diagnostic,
      h("p", { class: "meta" }, "Service restarts, updates, charts and diagnostics. Actions ask for confirmation and the household PIN."), state.body));
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

async function loadDiagnostics(state) {
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
      h("div", { class: "stat-cluster" },
        h("div", { class: "stat-numbered" },
          h("span", { class: "stat-label" }, "Power"),
          h("span", { class: "stat-value", dataset: { tone: d.health.power === "Good" ? "ok" : "bad" } }, d.health.power || "—")
        ),
        h("div", { class: "stat-numbered" },
          h("span", { class: "stat-label" }, "Running for"),
          h("span", { class: "stat-value" }, d.health.uptime_h != null ? d.health.uptime_h : "—", h("span", { class: "unit" }, "h"))
        )
      )),
    card("Fix it", { cls: "wide", pill: upd.state === "running" ? "Updates installing" : null, tone: "warn" },
      h("p", { class: "meta" }, "Choose a fix after checking the problem above. You’ll confirm before anything changes."),
      h("div", { class: "fix-grid" }, acts.actions.map((a) => h("button", {
        class: `btn ghost ${a.name === "restart:pi" ? "btn--danger" : ""}`,
        disabled: a.name === "updates:install" && upd.state === "running",
        onclick: async () => { if (await fix(a.name, a.label, { confirmText: CONFIRM[a.name] })) load(state); },
      }, a.label))),
      upd.state === "failed" ? h("p", { class: "note" }, `The last update run didn't finish: ${upd.message}`) : null,
      acts.log.length ? [h("h3", { class: "sub" }, "Recent fixes"), h("ul", { class: "log" }, acts.log.slice(0, 5).map((l) =>
        h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone: /didn't|isn't/.test(l.result) ? "bad" : "ok" } }),
          h("span", { class: "log-main" }, h("strong", {}, l.result), h("span", { class: "meta" }, l.device || "A device")),
          h("span", { class: "log-side" }, when(l.ts)))))] : null),
    selfcheckCard(d.selfcheck),
    h("div", { class: "pi-bottom-grid" },
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
        h("div", {}, h("dt", {}, "Connection"), h("dd", {}, "Network cable"))))
    )
  );
}

// Household guides stay available even when the diagnostic service is down.
export async function load(state) {
  try {
    await loadDiagnostics(state);
    state.diagnostic.textContent = "System checks updated.";
  } catch {
    state.diagnostic.textContent = "System checks unavailable. The help guides above still work.";
    state.body.replaceChildren(card("Couldn’t check the system", {},
      h("p", { class: "meta" }, "The hub’s diagnostic service didn’t answer. We’ll keep trying automatically."),
      h("button", { type: "button", class: "ghost", onclick: () => load(state) }, "Retry system checks")));
  }
}
