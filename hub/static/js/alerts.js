// Alerts: everything the Pi has pushed to your phone, newest first. A7 P6: the same alert on one day is one row with a
// count and a time range; a problem and its recovery are one row ("The Pi ran hot, then cooled down · 6 times").
import { markAlertsSeen } from "./navigation.js";
import { api, empty, h } from "./core.js";
import { lampRows, section } from "./page-parts.js";
import { rememberOpen } from "./section-links.js";

export const every = 30;

const TONE = { white_check_mark: "ok", tada: "ok", warning: "warn", fire: "warn", rotating_light: "bad" };
const WORD = { ok: "OK", warn: "Warning", bad: "Problem" };

// A problem and its recovery in one sentence (the causes are hub/system.py ALERT_CAUSES and the Mac watchdog's outage).
const PAIR_SAY = {
  hot: "The Pi ran hot, then cooled down",
  drive: "The movies drive dropped out, then came back",
  plex: "Plex stopped, then ran again",
  homebridge: "Homebridge stopped, then ran again",
  pc: "The Windows PC stopped answering, then came back",
  display: "The workshop display went offline, then came back",
  "mac-watch:outage": "The Mac watchdog saw an outage, then the house came back",
};

const dayOf = (ts) => new Date(ts * 1000).toDateString();
const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Groups by cause per local day (decision 5); the history and the API stay one entry per alert. An alert without a
// cause (an older hub) is its own cause by its title. Newest group first; within a group the newest alert decides
// whether it is over ("back now") or not.
export function groupAlerts(alerts) {
  const list = (Array.isArray(alerts) ? alerts : []).filter((a) => a && Number.isFinite(Number(a.ts)) && a.title)
    .map((a) => ({ ...a, ts: Number(a.ts), cause: a.cause || `title:${a.title}`, side: a.side || "event" }))
    .sort((a, b) => b.ts - a.ts);
  const groups = new Map();
  for (const a of list) {
    const key = `${dayOf(a.ts)}|${a.cause}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  // Whether a cause is over is judged from its newest alert of all, so a drop at 11:50 PM that came back at 12:10 AM is
  // "back now" on the day before too.
  const latest = new Map();
  for (const a of list) if (!latest.has(a.cause)) latest.set(a.cause, a);
  return [...groups.values()].map((items) => {
    const newest = items[0], oldest = items[items.length - 1];
    const over = latest.get(newest.cause).side === "recovery";
    const problems = items.filter((a) => a.side === "problem").length;
    const recoveries = items.filter((a) => a.side === "recovery").length;
    const paired = problems > 0 && recoveries > 0;
    const count = paired ? problems : items.length;
    const tone = paired && over ? "ok" : paired ? TONE[items.find((a) => a.side === "problem")?.tag] || "warn" : TONE[newest.tag] || "warn";
    return {
      ts: newest.ts, first: oldest.ts, last: newest.ts, count, tone, cause: newest.cause,
      title: paired ? PAIR_SAY[newest.cause] || `${items.find((a) => a.side === "problem").title}, then ${items.find((a) => a.side === "recovery").title.toLowerCase()}` : newest.title,
      body: paired || (problems && over) ? (over ? "Back now." : "Still out.") : newest.body && newest.body !== newest.title ? newest.body : "",
      problem: problems || recoveries ? !over : TONE[newest.tag] !== "ok",
    };
  });
}

const when = (g) => g.count > 1 ? `${g.count} times · ${clock(g.first)}–${clock(g.last)}` : clock(g.last);

function daySection([label, groups]) {
  return section(label, lampRows(groups.map((g) => ({ title: g.title, detail: g.body, tone: g.tone, word: WORD[g.tone], value: when(g) }))));
}

// The two most recent days show; older days sit behind "Show older alerts".
function days(byDay) {
  const older = byDay.slice(2);
  return [...byDay.slice(0, 2).map(daySection), older.length ? rememberOpen(h("details", { class: "ui-section show-all" },
    h("summary", {}, h("h2", {}, `Older alerts (${older.reduce((n, [, l]) => n + l.length, 0)})`)), ...older.map(daySection)), "alerts-older") : null];
}

export function mount(state) {
  state.filter = "all";
  state.intro = h("p", { class: "page-intro", role: "status" }, "Checking recent alerts…");
  state.tabs = h("div", { class: "ui-chips alerts-filter", role: "group", "aria-label": "Show" });
  state.body = h("div", { class: "stack" });
  state.root.append(state.intro, state.tabs, state.body, section("Get these on your phone", h("ol", { class: "steps" },
    h("li", {}, "Install the free ntfy app on your iPhone or Android."),
    h("li", {}, "Tap +, then subscribe to your Pi's private topic. Ask Claude for the name if you've lost it."),
    h("li", {}, "Alerts arrive when the movies drive, Plex, Homebridge, the PC or the display changes, and when a print finishes."))));
}

export async function load(state) {
  const d = await api("/api/alerts");
  if (state.root.isConnected) markAlertsSeen(d.alerts);
  const groups = groupAlerts(d.alerts);
  const problemCount = groups.filter((g) => g.problem).length;
  const okCount = groups.length - problemCount;
  state.intro.textContent = groups.length ? `${problemCount} still a problem or warning, ${okCount} over or fine, in recent history.` : "";

  // Filters are chips (A7 P4), each pressed or not; the count is part of its name.
  const filters = [["all", "All", groups.length], ["problems", "Needs you", problemCount], ["recovery", "Over", okCount]];
  state.tabs.replaceChildren(...filters.map(([key, label, count]) => h("button", {
    type: "button", "aria-pressed": String(key === state.filter),
    onclick: () => { state.filter = key; load(state); },
  }, label, h("span", { class: "count" }, String(count)))));

  const shown = state.filter === "problems" ? groups.filter((g) => g.problem) : state.filter === "recovery" ? groups.filter((g) => !g.problem) : groups;
  const byDay = new Map();
  for (const g of shown) {
    const day = new Date(g.ts * 1000).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  }
  state.body.replaceChildren(...(shown.length ? days([...byDay]).filter(Boolean)
    : [empty(state.filter === "all" ? "No alerts yet. When something changes, it shows here and on your phone."
      : state.filter === "problems" ? "Nothing in recent history needs you." : "No alerts that are over yet.")]));
}
