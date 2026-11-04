// A section's list of places: [href, name, what]. Other machines' tools open in their own tab.
import { h } from "./core.js";
import { toolsFor, toolUrl } from "./sections.js";

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

// Every area page ends with its tools (§5.3): one "Open in …↗" row of the area's gated tools, from the registry.
// `only` narrows it to some of the area's tools, for an area whose pages split them (Home & network: Devices | Network).
export function openInRow(area, only = null) {
  const tools = toolsFor(area).filter((t) => !only || only.includes(t.id));
  if (!tools.length) return null;
  return h("p", { class: "open-in" }, "Open in ", ...tools.flatMap((t, i) => [i ? " · " : "",
    h("a", { class: "tool-link", href: toolUrl(t.id), target: "_blank", rel: "noopener", title: t.purpose }, `${t.name} ↗`)]));
}

// A "More" list (A6): a heading and one native <details> per item, closed until this viewer opens one. Which are open is
// kept in this browser under `storeKey`; storage can be missing, blocked or hold junk, and then every item starts closed.
// `fill(key, nodes)` puts an item's content in; an item with nothing in it is hidden, so a source that didn't answer
// leaves no empty row.
function openMap(storeKey) {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(storeKey) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function rememberItem(storeKey, key, open) {
  try { globalThis.localStorage?.setItem(storeKey, JSON.stringify({ ...openMap(storeKey), [key]: !!open })); } catch { /* not remembered this time */ }
}

export function moreList({ storeKey, title, cls = "", items }) {
  const opened = openMap(storeKey);
  const titleId = `${storeKey}-title`;
  const slots = {};
  const root = h("section", { class: ["more-list", cls].filter(Boolean).join(" "), "aria-labelledby": titleId },
    h("h2", { class: "section-title", id: titleId }, title),
    ...items.map(([key, label]) => {
      const body = h("div", { class: "more-list-body" });
      const el = h("details", { class: "more-list-item", dataset: { key } }, h("summary", {}, label), body);
      el.open = opened[key] === true;
      el.addEventListener("toggle", () => rememberItem(storeKey, key, el.open));
      slots[key] = { el, body };
      return el;
    }));
  return {
    root,
    items: slots,
    fill(key, nodes) {
      const slot = slots[key];
      if (!slot) return;
      const kids = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
      slot.body.replaceChildren(...kids);
      slot.el.hidden = kids.length === 0;
    },
  };
}
