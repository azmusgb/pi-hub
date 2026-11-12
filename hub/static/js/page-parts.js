// The parts of a page (A7 P1, P3, P8), drawn with the kit's classes: the faceplate (the page's only panel), its loading
// skeleton, sections (a heading and rows, no card), lamp-right rows and "Needs you here". Pages build from these so
// every page reads the same.
import { api, h } from "./core.js";
import { resolveLink } from "./sections.js";

const lampChip = (lamp) => lamp ? h("span", { class: `ui-chip ui-chip--${lamp[0]}${lamp[2] ? " ui-chip--live" : ""}` }, lamp[1]) : null;
const present = (v) => v !== null && v !== undefined && v !== "";

// `name` is drawn on the nameplate and names the section; a faceplate with no name to draw (Settings, A22 2.3) passes
// `label` for the section alone. `lamp`: [tone, word, live?]; `readings`: [label, value] pairs, a missing value is left out; `actions`, `aside`: nodes.
export function faceplate({ name = "", label = "", lamp = null, readout = null, unit = "", size = "", caption = null, readings = [], actions = [], aside = null, extra = [] }) {
  const rows = readings.filter(([, v]) => present(v));
  const acts = (actions || []).filter(Boolean);
  return h("section", { class: aside ? "ui-faceplate ui-faceplate--aside" : "ui-faceplate", "aria-label": name || label },
    h("div", { class: "ui-faceplate__main" },
      h("div", { class: "ui-faceplate__nameplate" }, name ? h("span", {}, name) : null, lampChip(lamp)),
      present(readout) ? h("p", { class: size ? `ui-readout ui-readout--${size}` : "ui-readout" }, String(readout),
        unit ? h("span", { class: "ui-readout__unit" }, ` ${unit}`) : null) : null,
      present(caption) ? h("p", { class: "ui-faceplate__caption" }, caption) : null,
      ...(extra || []).filter(Boolean),
      rows.length ? h("dl", { class: "ui-faceplate__readings" }, ...rows.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, String(v))))) : null,
      acts.length ? h("div", { class: "ui-faceplate__actions" }, ...acts) : null),
    aside ? h("div", { class: "ui-faceplate__aside" }, aside) : null);
}

// While the first answer is on its way: the faceplate's shape in skeletons, busy, under the page's name.
export function faceplateLoading(name) {
  const bar = (w, ht = "1em") => h("span", { class: "ui-skeleton", style: `width:${w};height:${ht}` });
  return h("section", { class: "ui-faceplate", "aria-label": name, "aria-busy": "true" },
    h("div", { class: "ui-faceplate__main" }, bar("30%"), bar("40%", "48px"), bar("70%"), bar("85%")));
}

// `lamp`: [tone, word], drawn beside the heading for a section that has a state of its own (Health's disks, updates).
export function section(title, body, { note = null, id = null, lamp = null, cls = "" } = {}) {
  const head = lamp ? h("div", { class: "ui-section__head" }, h("h2", {}, title), lampChip(lamp)) : h("h2", {}, title);
  return h("section", { class: ["ui-section", cls].filter(Boolean).join(" "), ...(id ? { id } : {}) }, head,
    note ? h("p", { class: "ui-section__note" }, note) : null, ...[].concat(body).filter(Boolean));
}

// Rows: title and detail on the left, then the lamp (dot and word), the value and one action on the right (P3).
export function lampRows(rows) {
  return h("ul", { class: "ui-rows" }, ...rows.filter(Boolean).map((r) => h("li", { class: "ui-row ui-row--lamp" },
    h("div", {}, h("span", { class: "ui-row__title" }, r.title), present(r.detail) ? h("span", { class: "ui-row__detail" }, r.detail) : null),
    r.tone ? lampChip([r.tone, r.word || ""]) : null,
    present(r.value) ? h("span", { class: "ui-row__value" }, String(r.value)) : null,
    r.action || null)));
}

// Tabs (the kit's ui-tabs, 2.16): the views of one area. Fills `strip` (a role="tablist" element with class ui-tabs)
// with one button per item; only the selected one is in the Tab order, and the arrow keys, Home and End move to a tab
// and select it (the ARIA tabs pattern). `onSelect(key)` redraws what it needs, then focus goes to the chosen tab.
// `panel(key)` is the id of the panel each tab controls; `extra(key)` is a node after its label (a count).
export function fillTabs(strip, { items, selected, idPrefix, panel, onSelect, extra = () => null }) {
  const keys = items.map((i) => i.key);
  const choose = (key) => {
    onSelect(key);
    strip.querySelector(`#${idPrefix}${key}`)?.focus();
  };
  strip.replaceChildren(...items.map(({ key, label }) => h("button", {
    type: "button", role: "tab", id: `${idPrefix}${key}`, "aria-selected": String(key === selected),
    "aria-controls": panel(key), tabindex: key === selected ? 0 : -1, dataset: { tab: key },
    onclick: () => choose(key),
    onkeydown: (e) => {
      const i = keys.indexOf(key);
      const next = e.key === "ArrowRight" ? keys[(i + 1) % keys.length]
        : e.key === "ArrowLeft" ? keys[(i + keys.length - 1) % keys.length]
        : e.key === "Home" ? keys[0] : e.key === "End" ? keys.at(-1) : null;
      if (next) { e.preventDefault(); choose(next); }
    },
  }, label, extra(key))));
}

// "Needs you here": this page's own items from Needs you, through the kit's list; hidden while there are none or Needs
// you doesn't answer (Home says that, not every page).
export function needsHere() {
  return h("section", { class: "ui-section needs-here", hidden: true, "aria-label": "Needs you here" }, h("h2", {}, "Needs you here"));
}

export async function fillNeedsHere(el, path) {
  let items = [];
  try { items = ((await api("/api/needs")) || {}).items || []; } catch { items = []; }
  const mine = items.filter((i) => typeof i?.link === "string" && (i.link === path || i.link.startsWith(`${path}?`) || i.link.startsWith(`${path}#`)));
  el.hidden = !mine.length;
  const list = mine.length ? ApplianceNeeds.renderList(mine, { resolve: resolveLink, here: new URL(location.href), self: "Pi Hub" }) : null;
  if (list) for (const a of list.querySelectorAll("a")) if (a.origin === location.origin) a.setAttribute("data-link", "");
  el.replaceChildren(el.firstChild, ...(list ? [list] : []));
}
