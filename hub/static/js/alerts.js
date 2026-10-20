// Alerts: everything the Pi has pushed to your phone, newest first.
import { api, card, empty, h, when } from "./core.js";

export const every = 30;

const TONE = { white_check_mark: "ok", tada: "ok", warning: "warn", fire: "warn", rotating_light: "bad" };

export function mount(state) {
  state.body = h("div", { class: "cards" });
  state.root.append(state.body);
}

export async function load(state) {
  const d = await api("/api/alerts");
  const byDay = new Map();
  for (const a of d.alerts) {
    const day = new Date(a.ts * 1000).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(a);
  }
  state.body.replaceChildren(
    card("Alert history", { cls: "wide", pill: d.alerts.length ? `${d.alerts.length} recent` : null },
      d.alerts.length
        ? [...byDay].map(([day, list]) => h("section", { class: "day" }, h("h3", { class: "sub" }, day),
          h("ul", { class: "log" }, list.map((a) => h("li", { class: "log-row" },
            h("span", { class: "dot", dataset: { tone: TONE[a.tag] || "warn" } }),
            h("span", { class: "log-main" }, h("strong", {}, a.title), a.body && a.body !== a.title ? h("span", { class: "meta" }, a.body) : null),
            h("span", { class: "log-side" }, when(a.ts).split(", ").pop()))))))
        : empty("No alerts yet. When something changes, it shows here and on your phone.")),
    card("Get these on your phone", {},
      h("ol", { class: "steps" },
        h("li", {}, "Install the free ntfy app on your iPhone or Android."),
        h("li", {}, "Tap +, then subscribe to your Pi's private topic. Ask Claude for the name if you've lost it."),
        h("li", {}, "Alerts arrive when the movies drive, Plex, Homebridge, the PC or the display changes, and when a print finishes."))),
  );
}
