// System › Site map: every area, page and tool on one page. It is drawn from routes.js (the pages the server knows), the
// area strips and the tool registry, so a page or tool added there appears here with no edit (A6 decision sitemap).
import { h } from "./core.js";
import { faceplate } from "./page-parts.js";
import ROUTES from "./routes.js";
import { SECTIONS, toolUrl } from "./sections.js";
import { STRIPS } from "./system-strip.js";
import { TOOLS } from "../ui/tools.js";
import { ASSISTANT_PAGES, addressFor } from "./assistant.js";

export const every = 600;

// Pages that aren't on a strip have no strip name: these are theirs. A page with neither gets its address as its name,
// which the Site map test refuses, so a new page can't ship unnamed.
const OTHER_NAMES = { "/": "Home", "/wall": "Wall display", "/more": "More (the phone's menu)" };

const pageNames = () => new Map([
  ...Object.entries(OTHER_NAMES),
  ...Object.values(STRIPS).flatMap(({ entries }) => entries),
]);

// The map as data: one group per area (the rail's six, in its order), the Assistant, pages in no area, and the tools that
// are machine-facing. Pure, so it is tested without a page. The Assistant's areas are pages in the shell (/assistant,
// A4); its registry entry stays as the tool, Local AI opened on its own.
export function siteMap(routes = ROUTES, tools = TOOLS) {
  const names = pageNames();
  const named = (href) => ({ href, label: names.get(href) || href });
  const placed = new Set(["/assistant"]);
  const groups = SECTIONS.map((s) => {
    const pages = s.pages.filter((p) => routes.pages.includes(p));
    pages.forEach((p) => placed.add(p));
    const mine = tools.filter((t) => t.area === s.key && !t.boundary);
    return { key: s.key, title: s.title, path: s.path, pages: pages.map(named), tools: mine };
  });
  const loose = routes.pages.filter((p) => !placed.has(p));
  const used = new Set(groups.flatMap((g) => g.tools.map((t) => t.id)));
  const assistant = tools.filter((t) => t.area === "assistant" && !t.boundary);
  assistant.forEach((t) => used.add(t.id));
  const machine = tools.filter((t) => t.boundary);
  machine.forEach((t) => used.add(t.id));
  const rest = tools.filter((t) => !used.has(t.id));
  return [
    ...groups,
    { key: "assistant", title: "Assistant", path: "/assistant",
      pages: ASSISTANT_PAGES.map(([to, label]) => ({ href: addressFor(to), label })), tools: assistant },
    ...(loose.length || rest.length ? [{ key: "other", title: "Other", path: "", pages: loose.map(named), tools: rest }] : []),
    { key: "machine", title: "Machine-facing, not for browsing", path: "", pages: [], tools: machine, machine: true },
  ];
}

// The " " between a name and its line keeps them apart when read aloud or copied; the layout puts the line below.
function toolItem(t, machine) {
  return h("li", {}, machine
    ? [h("strong", {}, t.name), " ", h("span", { class: "meta" }, `${t.host} · ${t.purpose}`)]
    : h("a", { href: toolUrl(t.id), target: "_blank", rel: "noopener" }, h("strong", {}, `${t.name} ↗`),
      h("span", { class: "visually-hidden" }, " (opens in a new tab)"), " ", h("span", { class: "meta" }, t.purpose)));
}

// The faceplate (A7 P1): what the map holds. It has no state of its own, so no lamp.
export function mapPlate(groups) {
  const pages = groups.reduce((n, g) => n + g.pages.length, 0);
  const tools = groups.filter((g) => !g.machine).reduce((n, g) => n + g.tools.length, 0);
  return faceplate({ name: "Site map", readout: String(pages), unit: "pages", size: "md",
    caption: "Every page and tool, drawn from the menu and the tool list, so it is always current.",
    readings: [["Areas", String(SECTIONS.length)], ["Tools", String(tools)]] });
}

// What a filter matches against: a page's name and address, a tool's name, purpose and host. Lower case, one string.
const findText = (...parts) => parts.filter(Boolean).join(" ").toLowerCase();

// Show only what matches every word of the query; an area whose own name matches keeps all of it. Returns the count shown.
export function applyFilter(areas, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s) => words.every((w) => s.includes(w));
  let shown = 0;
  for (const area of areas) {
    const whole = words.length > 0 && hit(area.dataset.find);
    let inArea = 0;
    for (const list of area.querySelectorAll("[data-list]")) {
      let inList = 0;
      for (const li of list.querySelectorAll("li")) {
        li.hidden = !(whole || hit(li.dataset.find));
        if (!li.hidden) inList++;
      }
      list.hidden = inList === 0;
      if (list.dataset.list === "tools") { const sub = area.querySelector(".map-sub"); if (sub) sub.hidden = inList === 0; }
      inArea += inList;
    }
    area.hidden = inArea === 0;
    shown += inArea;
  }
  return shown;
}

function areaSection(g) {
  const pages = g.pages.length ? h("ul", { class: "more", dataset: { list: "pages" } }, g.pages.map((p) =>
    h("li", { dataset: { find: findText(p.label, p.href) } },
      h("a", { href: p.href, "data-link": true }, h("strong", {}, p.label), " ", h("span", { class: "meta" }, p.href))))) : null;
  // A tool leaves Pi Hub, so its rows sit under their own small heading rather than among the pages.
  const tools = g.tools.length ? [
    g.machine ? null : h("h3", { class: "map-sub" }, "Tools, in a new tab"),
    h("ul", { class: "more", dataset: { list: "tools" } }, g.tools.map((t) => {
      const li = toolItem(t, g.machine);
      li.dataset.find = findText(t.name, t.purpose, t.host);
      return li;
    }))] : [];
  return h("section", { class: "more-group", dataset: { area: g.key, find: findText(g.title) } },
    h("h2", {}, g.path ? h("a", { href: g.path, "data-link": true }, g.title) : g.title), pages, ...tools);
}

export function mount(state) {
  const groups = siteMap();
  const areas = groups.map(areaSection);
  const total = groups.reduce((n, g) => n + g.pages.length + g.tools.length, 0);
  const input = h("input", { type: "search", id: "map-find", class: "ui-field", autocomplete: "off", spellcheck: "false",
    placeholder: "A page, an address or a tool", "aria-describedby": "map-count" });
  const count = h("p", { id: "map-count", class: "meta map-count", role: "status" }, `${total} pages and tools`);
  const clear = h("button", { type: "button", class: "ui-btn ui-btn--ghost" }, "Show everything");
  const empty = h("div", { class: "ui-empty map-empty", hidden: true }, h("p", {}, ""), clear);
  const run = () => {
    const q = input.value.trim();
    const shown = applyFilter(areas, q);
    count.textContent = !q ? `${total} pages and tools` : !shown ? "No matches" : shown === 1 ? "1 match" : `${shown} matches`;
    empty.hidden = shown > 0;
    empty.firstChild.textContent = shown ? "" : `Nothing matches “${q}”. Try a page name, an address such as /lab, or a tool.`;
  };
  input.addEventListener("input", run);
  clear.addEventListener("click", () => { input.value = ""; run(); input.focus(); });
  const find = h("form", { class: "map-find", role: "search", onsubmit: (e) => e.preventDefault() },
    h("label", { for: "map-find" }, "Find a page or tool"), input, count);
  state.root.append(mapPlate(groups), find, empty, h("div", { class: "map-areas" }, areas));
}

export async function load() {}
