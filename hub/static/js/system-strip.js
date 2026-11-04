// An area's page strip: one row of the area's pages, shown on each of them. System's (§5.6 `/system`, platform step 7,
// PR 7.3) came first; Workshop's Printer | Print lab (§5.1, workshop flow W.1) is the same component, and A6 gives
// Documents, Media and Home & network theirs, so no page is hidden.
import { h } from "./core.js";

export const STRIP = [
  ["/system", "Health"],
  ["/backups", "Backups"],
  ["/versions", "Versions"],
  ["/alerts", "Alerts"],
  ["/rules", "Automations"],
  ["/settings", "Settings"],
  ["/map", "Site map"],
];

// Each strip names its area: the pages' heading and the strip's accessible name.
export const STRIPS = {
  system: { label: "System", entries: STRIP },
  workshop: { label: "Workshop", entries: [["/workshop", "Printer"], ["/lab", "Print lab"]] },
  documents: { label: "Documents", entries: [["/documents", "Papers"], ["/print", "Print"], ["/lists", "Lists"]] },
  media: { label: "Media", entries: [["/media", "Movies"], ["/drives", "Drives"]] },
  network: { label: "Home & network", entries: [["/devices", "Devices"], ["/network", "Network"], ["/weather", "Weather"]] },
};

// The strip a page belongs to, with its entries, or null when the page isn't on one.
export function stripFor(path) {
  for (const [key, { label, entries }] of Object.entries(STRIPS)) {
    if (entries.some(([href]) => href === path)) {
      return { key, label, items: entries.map(([href, name]) => ({ href, label: name, current: href === path })) };
    }
  }
  return null;
}

export function stripItems(path) {
  return stripFor(path)?.items ?? null;
}

// A strip page is headed by its area, the rail's word for it; the strip marks the page and the browser tab names it by
// its strip entry. Any other page is headed by its own title.
export function pageHeading(path, title) {
  const strip = stripFor(path);
  if (!strip) return { heading: title, title };
  const here = strip.items.find((i) => i.current);
  return { heading: strip.label, title: `${here.label} · ${strip.label}` };
}

export function pageStrip(path) {
  const strip = stripFor(path);
  if (!strip) return null;
  return h("nav", { class: `tabs page-strip ${strip.key}-strip`, "aria-label": strip.label },
    ...strip.items.map(({ href, label, current }) =>
      h("a", { href, "data-link": true, "aria-current": current ? "page" : null }, label)));
}

// On a phone the strip scrolls sideways: once it is on the page, bring the current entry into view (Settings is last).
export function revealCurrent(strip) {
  const here = strip?.querySelector('[aria-current="page"]');
  if (here && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, here.offsetLeft - strip.offsetLeft - 8);
}
