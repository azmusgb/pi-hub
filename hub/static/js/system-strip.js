// System's page strip (§5.6 `/system`, platform step 7, PR 7.3): one row of System's pages, shown on each of them.
import { h } from "./core.js";

export const STRIP = [
  ["/system", "Health"],
  ["/backups", "Backups"],
  ["/versions", "Versions"],
  ["/alerts", "Alerts"],
  ["/rules", "Automations"],
  ["/settings", "Settings"],
];

// The strip's entries for a page, or null when the page isn't one of System's strip pages.
export function stripItems(path) {
  if (!STRIP.some(([href]) => href === path)) return null;
  return STRIP.map(([href, label]) => ({ href, label, current: href === path }));
}

// System's strip pages are headed "System", the rail's word for them; the strip marks the page and the browser tab
// names it. Any other page is headed by its own title.
export function pageHeading(path, title) {
  return stripItems(path) ? { heading: "System", title: `${title} · System` } : { heading: title, title };
}

export function systemStrip(path) {
  const items = stripItems(path);
  if (!items) return null;
  return h("nav", { class: "tabs system-strip", "aria-label": "System" },
    ...items.map(({ href, label, current }) =>
      h("a", { href, "data-link": true, "aria-current": current ? "page" : null }, label)));
}

// On a phone the strip scrolls sideways: once it is on the page, bring the current entry into view (Settings is last).
export function revealCurrent(strip) {
  const here = strip?.querySelector('[aria-current="page"]');
  if (here && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, here.offsetLeft - strip.offsetLeft - 8);
}
