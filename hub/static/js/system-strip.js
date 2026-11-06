// An area's page strip: one row of the area's pages, shown on each of them. System's (§5.6 `/system`, platform step 7,
// PR 7.3) came first; Workshop's Printer | Print lab (§5.1, workshop flow W.1) is the same component, and A6 gives
// Documents, Media and Home & network theirs, so no page is hidden. A7 (P4) draws it as the kit's underlined strip, the
// same in Pi Hub and the Assistant.
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
  return h("nav", { class: `ui-strip page-strip ${strip.key}-strip`, "aria-label": strip.label },
    ...strip.items.map(({ href, label, current }) =>
      h("a", { href, "data-link": true, "aria-current": current ? "page" : null }, label)));
}

// Which edges of a sideways-scrolling strip have pages past them: "", "start", "end" or "both".
export function moreEdges({ scrollLeft, clientWidth, scrollWidth }) {
  const start = scrollLeft > 1, end = scrollLeft + clientWidth < scrollWidth - 1;
  return start && end ? "both" : start ? "start" : end ? "end" : "";
}

// System's strip scrolls sideways where its seven pages don't fit (A10 plan decision 16): once it is on the page, bring
// the current entry into view (Settings is near the end), and fade the edges that have pages past them.
export function revealCurrent(strip) {
  if (!strip) return;
  const here = strip.querySelector('[aria-current="page"]');
  // How far a link sits inside the strip's left and right edges, as drawn now.
  const inset = (link) => {
    const s = strip.getBoundingClientRect(), l = link.getBoundingClientRect();
    return { left: l.left - s.left, right: s.right - l.right };
  };
  const pad = () => parseFloat(getComputedStyle(strip).scrollPaddingInlineStart) || 8;
  const reveal = () => {
    if (here && strip.scrollWidth > strip.clientWidth) strip.scrollLeft += inset(here).left - pad();
  };
  // A focused link that is already in view isn't scrolled by the browser, so it can sit under a faded edge: move it clear.
  strip.addEventListener("focusin", (e) => {
    const p = pad(), { left, right } = inset(e.target);
    if (left < p) strip.scrollLeft -= p - left;
    else if (right < p) strip.scrollLeft += p - right;
  });
  const mark = () => { strip.dataset.more = moreEdges(strip); };
  reveal();
  mark();
  strip.addEventListener("scroll", mark, { passive: true });
  // The links widen when the web font replaces the fallback, which doesn't resize the strip itself: reveal again then.
  document.fonts?.ready.then(() => { if (strip.isConnected) { reveal(); mark(); } });
  // A page change replaces the strip; the observer lets go of the old one when it leaves the page (its size drops to 0).
  // It watches the links too, since their growth changes what is past each edge.
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => { if (strip.isConnected) mark(); else ro.disconnect(); });
    ro.observe(strip);
    for (const link of strip.children) ro.observe(link);
  }
}
