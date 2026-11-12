// An area's page strip: one row of the area's pages, shown on each of them (A6: no page is hidden; A7 P4: the kit's
// underlined strip). Which pages, in which order and by which names is the kit's page list (A22 step 12).
import { h } from "./core.js";
import { SITE } from "./site.js";

// The strip's `nav` is named "{Area} pages" (A22 9.1), so it is told apart from the rail, which names the areas.
export function pageStrip(path, site = SITE) {
  const strip = site.stripFor(path);
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
