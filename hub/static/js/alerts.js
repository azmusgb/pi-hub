// Alerts: everything the Pi has pushed to your phone, newest first.
import { markAlertsSeen } from "./navigation.js";
import { api, card, empty, h, when } from "./core.js";
import { mergeDropouts } from "./wording.js";
import { rememberOpen } from "./section-links.js";

export const every = 30;

const TONE = { white_check_mark: "ok", tada: "ok", warning: "warn", fire: "warn", rotating_light: "bad" };

// The two most recent days with alerts show; older days sit behind "Show older alerts".
function dayGroups(days) {
  const day = ([label, list]) => h("section", { class: "day" }, h("h3", { class: "sub" }, label),
    h("ul", { class: "log" }, list.map((a) => h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone: TONE[a.tag] || "warn" } }),
      h("span", { class: "log-main" },
        h("strong", {}, a.title, a.count > 1 ? h("span", { class: "meta" }, ` ×${a.count}`) : null),
        a.body && a.body !== a.title ? h("span", { class: "meta" }, a.body) : null),
      h("span", { class: "log-side" }, when(a.ts).split(", ").pop())))));
  const older = days.slice(2);
  return [...days.slice(0, 2).map(day), older.length ? rememberOpen(h("details", { class: "show-all" },
    h("summary", {}, `Show older alerts (${older.reduce((n, [, l]) => n + l.length, 0)})`), ...older.map(day)), "alerts-older") : null];
}

export function mount(state) {
  state.filter = "all";
  state.intro = h("p", { class: "page-intro", role: "status" }, "Checking recent alerts…");
  state.tabs = h("div", { class: "tabs alerts-tabs", role: "tablist", "aria-label": "Filter alerts" });
  state.body = h("div", { class: "cards" });
  state.root.append(state.intro, state.tabs, state.body);
}

export async function load(state) {
  const d = await api("/api/alerts");
  if (state.root.isConnected) markAlertsSeen(d.alerts);

  // A device that drops out and comes back many times in a day is one line; identical titles within 15 minutes are one.
  const collapsed = [];
  for (const a of mergeDropouts(d.alerts)) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.title === a.title && (last.ts - a.ts) <= 900) {
      last.count = (last.count || 1) + 1;
    } else {
      collapsed.push({ ...a });
    }
  }

  const isOk = (a) => TONE[a.tag] === "ok";
  const problemCount = collapsed.filter((a) => !isOk(a)).length;
  const recoveryCount = collapsed.filter(isOk).length;

  state.intro.textContent = `${problemCount} problem alerts and ${recoveryCount} recovery alerts in recent history.`;

  const filters = [
    ["all", "All", collapsed.length],
    ["problems", "Needs you", problemCount],
    ["recovery", "Recovery", recoveryCount],
  ];
  state.tabs.replaceChildren(...filters.map(([key, label, count]) => h("button", {
    class: "tab", role: "tab", "aria-selected": String(key === state.filter),
    onclick: () => { state.filter = key; load(state); },
  }, label, count ? h("span", { class: "count" }, String(count)) : null)));

  const shown = state.filter === "problems"
    ? collapsed.filter((a) => !isOk(a))
    : state.filter === "recovery"
    ? collapsed.filter(isOk)
    : collapsed;

  const byDay = new Map();
  for (const a of shown) {
    const day = new Date(a.ts * 1000).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(a);
  }

  state.body.replaceChildren(
    card("Alert history", { cls: "wide", pill: shown.length ? `${shown.length} shown` : null },
      shown.length
        ? dayGroups([...byDay])
        : empty(state.filter === "all"
            ? "No alerts yet. When something changes, it shows here and on your phone."
            : `No ${state.filter === "problems" ? "problem" : "recovery"} alerts yet.`)),
    card("Get these on your phone", {},
      h("ol", { class: "steps" },
        h("li", {}, "Install the free ntfy app on your iPhone or Android."),
        h("li", {}, "Tap +, then subscribe to your Pi's private topic. Ask Claude for the name if you've lost it."),
        h("li", {}, "Alerts arrive when the movies drive, Plex, Homebridge, the PC or the display changes, and when a print finishes."))),
  );
}
