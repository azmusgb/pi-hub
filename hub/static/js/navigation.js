// Small device-local indicators. Nothing is uploaded or tracked across devices.
import { api } from "./core.js";
import { SITE, sectionFor } from "./site.js";
import { tool } from "../ui/tools.js";

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

const AREA_IDS = new Set(SITE.areas.filter((a) => a.id !== "home").map((a) => a.id));
const AREA_BY_LABEL = new Map([
  ...SITE.areas.filter((a) => a.id !== "home").map((a) => [a.label.toLowerCase(), a.id]),
  ["print lab", "workshop"],
]);

// Which non-Home area an ask belongs to (A37 R7): from its own area or source when named, else from its link's
// address or tool. Null when it has none (or points to Home or the Assistant), so it badges Home alone.
export function askArea(item) {
  if (!item || typeof item !== "object" || item.kind === "heads_up") return null;
  for (const raw of [item.area, item.source]) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (AREA_IDS.has(key)) return key;
    if (AREA_BY_LABEL.has(key)) return AREA_BY_LABEL.get(key);
  }
  const link = typeof item.link === "string" ? item.link.trim() : "";
  if (link.startsWith("tool:")) {
    const a = tool(link.slice(5))?.area;
    return AREA_IDS.has(a) ? a : null;
  }
  const path = link.startsWith("/") ? link.split(/[?#]/)[0] : "";
  const a = path ? sectionFor(path) : "";
  return AREA_IDS.has(a) ? a : null;
}

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

// What each badge reads. undefined: not asked yet (no badge); null: the read failed (a "?" badge, never a count that
// may be out of date, never nothing); otherwise the answer.
let print;        // /api/now: "" when nothing prints, else the words ("3D print running, 42%")
let needs;        // /api/needs: asks badge Home and their own area (A36 D6, A37 R7)
let pending = false;
let nav = null;   // the kit's nav (ApplianceShell.build), drawn by mountNav
let area = "";    // the area marked current; "" when the page is in none (the Assistant, an unknown address)

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

  // A reading the source stopped refreshing says nothing of the present: no dot, never "running" (DESIGN.md Honest states).
  // Home's sentence and the printer's own ask say the print went quiet.
  if (printer.stale || printer.telemetry?.status === "stale") {
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

function askItems(n) {
  return Array.isArray(n?.items) ? n.items.filter((i) => i && typeof i === "object" && i.kind !== "heads_up") : [];
}

// One area's badge (A37 R7): asks only (System no longer counts unread alerts). An ask with an area badges that area
// and Home; one without badges Home. When Workshop has no asks, a running or paused print shows its dot: the mark that
// something is running there (A37 S6 says nothing against it; the kit's dot is warn-coloured and has no quieter form).
function badgeFor(id) {
  if (id === "home") {
    if (needs === undefined) return null;
    if (needs === null) return { count: 1, text: "?", say: "couldn't check what needs you" };
    const items = askItems(needs);
    const n = Array.isArray(needs.items) && needs.items.length ? items.length : Number(needs.count) || 0;
    return n > 0 ? { count: n, say: `${n} need${n === 1 ? "s" : ""} you` } : null;
  }
  if (needs && typeof needs === "object") {
    const n = askItems(needs).filter((i) => askArea(i) === id).length;
    if (n > 0) return { count: n, say: `${n} need${n === 1 ? "s" : ""} you` };
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
  if (!Array.isArray(items)) return;
  const ts = items.map((a) => Number(a?.ts)).filter(Number.isFinite);
  if (!ts.length) return;
  try { localStorage.setItem(ALERTS_SEEN_KEY, String(Math.max(...ts))); } catch {}
}

export async function updateNavigation() {
  if (pending || document.hidden) {
    return;
  }

  pending = true;

  try {
    const [nowResult, needsResult] = await Promise.allSettled([
      api("/api/now"),
      api("/api/needs"),
    ]);

    /*
     * A read that failed is its own state: its badge becomes "?" until the next good answer. The count from the last
     * good read is not kept: it may no longer be true, and nothing at all would read as "nothing needs you".
     */
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
