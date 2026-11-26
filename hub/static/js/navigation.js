// Small device-local indicators. Nothing is uploaded or tracked across devices.
import { api } from "./core.js";
import { unreadCount } from "./experience.js";
import { SITE } from "./site.js";

const ALERTS_SEEN_KEY = "hub-alerts-seen";

const SVG = "http://www.w3.org/2000/svg";
// The rail's icons, one per area (24 x 24, drawn as strokes): the shapes the rail has always had.
const ICONS = {
  home: [["path", { d: "M4 11 12 4l8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" }]],
  workshop: [["path", { d: "M5 4h14v4H5zM8 8v6l4 3 4-3V8M12 17v3" }]],
  household: [["path", { d: "M5 12V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 12h18v5H3zM6 17v2M18 17v2" }]],
  network: [["path", { d: "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0" }], ["circle", { cx: 12, cy: 19.2, r: 1.2 }]],
  system: [["rect", { x: 5, y: 5, width: 14, height: 14, rx: 2 }],
    ["path", { d: "M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" }]],
};

function icon(areaId) {
  const parts = ICONS[areaId];

  if (!parts) return null;

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("focusable", "false");

  for (const [tag, attrs] of parts) {
    const part = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, String(value));
    svg.append(part);
  }

  return svg;
}

let seen = readSeenTimestamp();
// What each badge reads. undefined: not asked yet (no badge); null: the read failed (a "?" badge, never a count that
// may be out of date, never nothing); otherwise the answer.
let alerts;       // /api/alerts: unread count is System's badge
let print;        // /api/now: "" when nothing prints, else the words ("3D print running, 42%")
let needs;        // /api/needs: its count is the Home tab's badge (one home, D7)
let pending = false;
let nav = null;   // the kit's nav (ApplianceShell.build), drawn by mountNav
let area = "";    // the area marked current; "" when the page is in none (the Assistant, an unknown address)

function readSeenTimestamp() {
  const now = Math.floor(Date.now() / 1000);

  try {
    const saved = Number(localStorage.getItem(ALERTS_SEEN_KEY));

    if (Number.isFinite(saved) && saved >= 0) {
      return saved;
    }

    localStorage.setItem(ALERTS_SEEN_KEY, String(now));
  } catch {
    // localStorage can be unavailable in private/restricted contexts.
  }

  return now;
}

function saveSeenTimestamp(value) {
  try {
    localStorage.setItem(ALERTS_SEEN_KEY, String(value));
  } catch {
    // Navigation indicators are non-critical. Ignore storage failures.
  }
}

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function printerStatus(printer) {
  if (!printer || typeof printer !== "object") {
    return "";
  }

  if (printer.state === "printing") {
    return `3D print running, ${clampPercent(printer.progress)}%`;
  }

  if (printer.state === "paused") {
    return "3D print paused";
  }

  return "";
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// One area's badge: { count, say } for the kit's setBadge and the words that name it for assistive tech. `text` replaces
// the number ("?" for a read that failed); `dot` shows a small dot with no number (a print running has no count).
function badgeFor(id) {
  if (id === "home" && needs !== undefined) {
    if (needs === null) return { count: 1, text: "?", say: "couldn't check what needs you" };
    const n = Number(needs.count) || 0;
    return n > 0 ? { count: n, say: `${n} need${n === 1 ? "s" : ""} you` } : null;
  }
  if (id === "system" && alerts !== undefined) {
    if (alerts === null) return { count: 1, text: "?", say: "couldn't check the alerts" };
    const n = unreadCount(alerts, seen);
    return n > 0 ? { count: n, say: plural(n, "new alert", "new alerts") } : null;
  }
  if (id === "workshop" && print !== undefined) {
    if (print === null) return { count: 1, text: "?", say: "couldn't check the printer" };
    return print ? { count: 1, text: "", dot: true, say: print } : null;
  }
  return null;
}

function render() {
  const shell = globalThis.ApplianceShell;
  if (!nav || !shell) return;

  for (const link of nav.querySelectorAll("a[data-area]")) {
    const id = link.dataset.area;
    const name = link.querySelector(".ui-rail-label")?.textContent || id;
    const badge = badgeFor(id);

    shell.setBadge(nav, id, badge || 0);

    if (badge) {
      link.setAttribute("aria-label", `${name}, ${badge.say}`);
      link.title = `${name}: ${badge.say}`;
    } else {
      link.removeAttribute("aria-label");
      link.removeAttribute("title");
    }
  }
}

// The kit's navigation: the rail on a wide window and the tab bar on a narrow one, one link per area of the page list,
// in its order. Pi Hub keeps the routing (main.js follows every a[data-link]). Call once, with the .ui-shell element;
// the nav goes first in it. Starts the kit's head-height and keyboard-inset variables.
export function mountNav(shell) {
  const kit = globalThis.ApplianceShell;
  nav = kit.build(document, { areas: SITE.areas, pages: SITE.rows, current: area, icon, label: "Primary navigation" });
  for (const link of nav.querySelectorAll("a[data-area]")) link.setAttribute("data-link", "");
  shell.prepend(nav);
  kit.watch(window);
  render();
  return nav;
}

// Marks the area the open page belongs to ("" for none: every link loses its mark).
export function setCurrentArea(id) {
  area = typeof id === "string" ? id : "";
  if (nav) globalThis.ApplianceShell.setCurrent(nav, area);
}

export function markAlertsSeen(items) {
  if (Array.isArray(items)) {
    alerts = items;

    const timestamps = items
      .map((alert) => toTimestamp(alert?.ts))
      .filter((timestamp) => timestamp !== null);

    if (timestamps.length) {
      seen = Math.max(seen, ...timestamps);
      saveSeenTimestamp(seen);
    }
  }

  render();
}

export async function updateNavigation() {
  if (pending || document.hidden) {
    return;
  }

  pending = true;

  try {
    const [alertsResult, nowResult, needsResult] = await Promise.allSettled([
      api("/api/alerts"),
      api("/api/now"),
      api("/api/needs"),
    ]);

    /*
     * A read that failed is its own state: its badge becomes "?" until the next good answer. The count from the last
     * good read is not kept: it may no longer be true, and nothing at all would read as "nothing needs you".
     */
    alerts = alertsResult.status === "fulfilled" && Array.isArray(alertsResult.value?.alerts)
      ? alertsResult.value.alerts
      : null;

    needs = needsResult.status === "fulfilled" && needsResult.value && typeof needsResult.value === "object"
      ? needsResult.value
      : null;

    print = nowResult.status === "fulfilled" && nowResult.value && typeof nowResult.value === "object"
      ? printerStatus(nowResult.value.printer)
      : null;

    render();
  } finally {
    pending = false;
  }
}

// Home shares what it just loaded, so the badge and the Needs you card never disagree. null: Home couldn't read it.
export function setNeeds(value) {
  needs = value === undefined ? needs : value;
  render();
}
