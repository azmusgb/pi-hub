// A section's list of places: [href, name, what]. Other machines' tools open in their own tab.
import { h } from "./core.js";
import { toolsFor, toolPath } from "./sections.js";

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

// A tool whose front door isn't its root: Uptime Kuma's root is a login, its public status page is the one people want.
const FRONT_DOOR = { status: "status/home" };

// Every area page ends with its tools (§5.3): one "Open in …↗" row of the area's gated tools, from the registry.
// `only` narrows it to some of the area's tools, for an area whose pages split them (Home & network: Devices | Network).
export function openInRow(area, only = null) {
  const tools = toolsFor(area).filter((t) => !only || only.includes(t.id));
  if (!tools.length) return null;
  return h("p", { class: "open-in" }, "Open in ", ...tools.flatMap((t, i) => [i ? " · " : "",
    h("a", { class: "tool-link", href: toolPath(t.id, FRONT_DOOR[t.id] || ""), target: "_blank", rel: "noopener", title: t.purpose }, `${t.name} ↗`)]));
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

// A page that redraws itself on a timer (Media's Requests every 30 s, Health's range buttons every 20 s) must not drop the
// keyboard out from under someone using it: note which control inside `container` has focus (by its place in the tree,
// and the caret), run `redraw`, and give the control at the same place focus back.
export function keepFocus(container, redraw) {
  const active = globalThis.document?.activeElement;
  let path = null;
  let caret = null;
  if (active && active !== container && container.contains(active)) {
    path = [];
    for (let n = active; n && n !== container; n = n.parentNode) {
      const up = n.parentNode;
      if (!up) { path = null; break; }
      path.unshift(Array.from(up.children).indexOf(n));
    }
    try { if (active.selectionStart != null) caret = [active.selectionStart, active.selectionEnd]; } catch { /* a control with no caret */ }
  }
  redraw();
  if (!path || path.includes(-1)) return;
  let target = container;
  for (const i of path) target = target?.children?.[i];
  if (!target?.focus || target === globalThis.document.activeElement) return;
  target.focus();
  try { if (caret && target.setSelectionRange) target.setSelectionRange(caret[0], caret[1]); } catch { /* not a text control */ }
}

// An item named in `alerts` whose content is warn or bad (a card's pill says so) shows a badge on its summary and opens by itself, once,
// when it starts to be one: the viewer can close it again and it stays closed until it changes.
const ALERT_RANK = { warn: 1, bad: 2 };
const ALERT_SAY = { warn: "Check", bad: "Needs a look" };

function alertOf(nodes) {
  let worst = null;
  for (const node of nodes) {
    const pills = [node, ...(node?.querySelectorAll?.(".pill") || [])];
    for (const p of pills) {
      const tone = p?.classList?.contains("pill") ? p.dataset?.tone : null;
      if ((ALERT_RANK[tone] || 0) > (ALERT_RANK[worst] || 0)) worst = tone;
    }
  }
  return worst;
}

// Open-state keys an earlier version used, moved once into the list's own: { item: "old key" }. The old state could be a
// browser key or the page's in-memory set of open lists; an answer already stored under the new key wins.
function migrate(storeKey, legacy) {
  for (const [key, old] of Object.entries(legacy)) {
    let was = openLists.has(old);
    try {
      const v = globalThis.localStorage?.getItem(old);
      if (v != null) { was = was || v === "1" || v === "true"; globalThis.localStorage.removeItem(old); }
    } catch { /* storage is blocked; nothing to move */ }
    openLists.delete(old);
    if (was && openMap(storeKey)[key] === undefined) rememberItem(storeKey, key, true);
  }
}

export function moreList({ storeKey, title, cls = "", items, legacy = {}, alerts = [] }) {
  migrate(storeKey, legacy);
  const opened = openMap(storeKey);
  const titleId = `${storeKey}-title`;
  const slots = {};
  const root = h("section", { class: ["more-list", cls].filter(Boolean).join(" "), "aria-labelledby": titleId },
    h("h2", { class: "section-title", id: titleId }, title),
    ...items.map(([key, label]) => {
      const body = h("div", { class: "more-list-body" });
      const summary = h("summary", {}, label);
      const el = h("details", { class: "more-list-item", dataset: { key } }, summary, body);
      el.open = opened[key] === true;
      const slot = { el, body, summary, alert: null, auto: false, badge: null };
      el.addEventListener("toggle", () => {
        if (slot.auto) { slot.auto = false; return; }   // opened for the viewer, not by them: not remembered
        rememberItem(storeKey, key, el.open);
      });
      slots[key] = slot;
      return el;
    }));
  return {
    root,
    items: slots,
    keepFocus: (redraw) => keepFocus(root, redraw),
    fill(key, nodes) {
      const slot = slots[key];
      if (!slot) return;
      const kids = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
      keepFocus(slot.body, () => slot.body.replaceChildren(...kids));
      slot.el.hidden = kids.length === 0;
      const alert = kids.length && alerts.includes(key) ? alertOf(kids) : null;
      if (alert !== slot.alert) {
        slot.badge?.remove();
        slot.badge = alert ? h("span", { class: "more-badge", dataset: { tone: alert } }, ALERT_SAY[alert]) : null;
        if (slot.badge) slot.summary.append(slot.badge);
        if (alert && !slot.alert && !slot.el.open) { slot.auto = true; slot.el.open = true; }
        slot.alert = alert;
      }
    },
  };
}
