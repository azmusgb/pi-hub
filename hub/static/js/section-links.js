// A section's list of places: [href, name, what]. Other machines' tools open in their own tab.
import { h } from "./core.js";

export function linkGroup(title, links) {
  return h("section", { class: "more-group" }, title ? h("h2", {}, title) : null,
    h("ul", { class: "more" }, links.map(([href, name, what]) => h("li", {},
      h("a", /^https?:/.test(href) ? { href, target: "_blank", rel: "noopener" } : { href, "data-link": true },
        h("strong", {}, name), h("span", { class: "meta" }, what))))));
}
