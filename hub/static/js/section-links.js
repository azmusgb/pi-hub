// A section's list of places: [href, name, what]. Other machines' tools open in their own tab.
import { h } from "./core.js";

export function linkGroup(title, links) {
  return h("section", { class: "more-group" }, title ? h("h2", {}, title) : null,
    h("ul", { class: "more" }, links.map(([href, name, what]) => h("li", {},
      h("a", /^https?:/.test(href) ? { href, target: "_blank", rel: "noopener" } : { href, "data-link": true },
        h("strong", {}, name), h("span", { class: "meta" }, what))))));
}

// Which "Show all" lists are open, by key, so a page's auto-refresh (which rebuilds the list) doesn't close them.
export const openLists = new Set();

export function rememberOpen(details, key) {
  if (!key) return details;
  details.open = openLists.has(key);
  details.addEventListener("toggle", () => { if (details.open) openLists.add(key); else openLists.delete(key); });
  return details;
}

// A long list shows its newest few; the rest sit behind "Show all" (one tap, no page jump).
export function firstFew(items, { n = 6, cls = "log", noun = "entries", key = "" } = {}) {
  if (items.length <= n) return [h("ul", { class: cls }, items)];
  return [h("ul", { class: cls }, items.slice(0, n)),
    rememberOpen(h("details", { class: "show-all" }, h("summary", {}, `Show all ${items.length} ${noun}`),
      h("ul", { class: cls }, items.slice(n))), key || `${noun}:${cls}`)];
}
