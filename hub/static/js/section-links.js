// A section's list of places: [href, name, what]. Other machines' tools open in their own tab.
import { h } from "./core.js";

export function linkGroup(title, links) {
  return h("section", { class: "more-group" }, title ? h("h2", {}, title) : null,
    h("ul", { class: "more" }, links.map(([href, name, what]) => h("li", {},
      h("a", /^https?:/.test(href) ? { href, target: "_blank", rel: "noopener" } : { href, "data-link": true },
        h("strong", {}, name), h("span", { class: "meta" }, what))))));
}

// A long list shows its newest few; the rest sit behind "Show all" (one tap, no page jump).
export function firstFew(items, { n = 6, cls = "log", noun = "entries" } = {}) {
  if (items.length <= n) return [h("ul", { class: cls }, items)];
  return [h("ul", { class: cls }, items.slice(0, n)),
    h("details", { class: "show-all" }, h("summary", {}, `Show all ${items.length} ${noun}`),
      h("ul", { class: cls }, items.slice(n)))];
}
