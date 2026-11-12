// System › Site map: every area, page and tool on one page. Every page row is generated from the kit's page list
// (site.js) and every tool row from the tool registry, so a page or tool added there appears here with no edit (A6
// decision sitemap; A22 3.5: no row here is written by hand).
import { h } from "./core.js";
import { faceplate } from "./page-parts.js";
import { toolUrl } from "./sections.js";
import { SITE, areaTools, retiredTools } from "./site.js";
import { TOOLS } from "../ui/tools.js";
import { ASSISTANT_PAGES, addressFor } from "./assistant.js";

export const every = 600;

// The map as data: one group per area (the rail's five, in its order), the Assistant, pages in no area (the Privacy
// note), the tools no longer used, and the machine-facing ones. Pure, so it is tested without a page. The Assistant's
// sections are pages in the shell (/assistant, A4) and stay as step 11 named them until step 14 frames each one; its
// registry entry stays as the tool, Local AI opened on its own.
export function siteMap(site = SITE, tools = TOOLS) {
  const entries = site.entries("map");
  // `plain` marks a page the server writes whole: a full page load, not a shell page.
  const stop = ({ href, label, plain }) => ({ href, label, plain });
  const groups = site.areas.map((a) => ({ key: a.id, title: a.label, path: site.page(a.landing).path,
    pages: entries.filter((e) => e.area === a.id).map(stop), tools: areaTools(a.id, tools) }));
  const loose = entries.filter((e) => !site.area(e.area)).map(stop);
  const assistant = areaTools("assistant", tools);
  const machine = tools.filter((t) => t.boundary);
  const retired = retiredTools(tools).filter((t) => !t.boundary);
  const used = new Set([...groups.flatMap((g) => g.tools), ...assistant, ...machine, ...retired].map((t) => t.id));
  const rest = tools.filter((t) => !used.has(t.id));
  return [
    ...groups,
    { key: "assistant", title: "Assistant", path: "/assistant",
      pages: ASSISTANT_PAGES.map(([to, label]) => ({ href: addressFor(to), label })), tools: assistant },
    ...(loose.length || rest.length ? [{ key: "other", title: "Other", path: "", pages: loose, tools: rest, quiet: true }] : []),
    ...(retired.length ? [{ key: "retired", title: "No longer used", path: "", pages: [], tools: retired, quiet: true }] : []),
    { key: "machine", title: "Machine-facing, not for browsing", path: "", pages: [], tools: machine, machine: true, quiet: true },
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
    caption: "Every page and tool, drawn from the page list and the tool list, so it is always current.",
    readings: [["Areas", String(SITE.areas.length)], ["Tools", String(tools)]] });
}

// What a filter matches against: a page's name and address, a tool's name, purpose and host. Lower case, one string.
const findText = (...parts) => parts.filter(Boolean).join(" ").toLowerCase();

// Show only what matches every word of the query; an area whose own name matches keeps all of it. Returns the count shown.
// The lists stay in place even when empty, so each band keeps its line between Pi Hub and the tools beyond it.
export function applyFilter(areas, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s) => words.every((w) => s.includes(w));
  let shown = 0;
  for (const area of areas) {
    const whole = words.length > 0 && hit(area.dataset.find);
    let inArea = 0;
    for (const li of area.querySelectorAll("li")) {
      if (li.dataset.find === undefined) { li.hidden = words.length > 0; continue; }  // "No tools", only when unfiltered
      li.hidden = !(whole || hit(li.dataset.find));
      if (!li.hidden) inArea++;
    }
    area.hidden = inArea === 0;
    shown += inArea;
  }
  return shown;
}

const plural = (n, word) => (n ? `${n} ${word}${n > 1 ? "s" : ""}` : "");

// One band per area: its name, its pages in the order its strip shows them, and past the line, its tools.
function areaSection(g) {
  const id = `map-${g.key}`;
  const here = globalThis.location?.pathname;
  const name = h("div", { class: "map-name" },
    h("h2", { id }, g.path ? h("a", { href: g.path, "data-link": true }, g.title) : g.title),
    h("p", { class: "meta" }, g.machine ? "Used by the workshop display" : [plural(g.pages.length, "page"), plural(g.tools.length, "tool")].filter(Boolean).join(", ")));
  const run = h("ol", { class: "map-run", "aria-labelledby": id }, g.pages.map((p) =>
    h("li", { dataset: { find: findText(p.label, p.href) } },
      h("a", { class: "map-stop", href: p.href, "data-link": p.plain ? null : true, "aria-current": p.href === here ? "page" : null },
        h("strong", {}, p.label), " ", h("span", { class: "meta" }, p.href)))));
  const out = h("ul", { class: "map-out", "aria-label": `${g.title}: tools that open in a new tab` },
    g.tools.length ? g.tools.map((t) => {
      const li = toolItem(t, g.machine);
      li.dataset.find = findText(t.name, t.purpose, t.host);
      return li;
    }) : h("li", { class: "map-none meta" }, "No tools"));
  return h("section", { class: `more-group map-band${g.quiet ? " map-band--quiet" : ""}`,
    dataset: { area: g.key, find: findText(g.title) } }, name, run, out);
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
  const zones = h("div", { class: "map-zones", "aria-hidden": "true" }, h("span", {}), h("span", {}, "In Pi Hub"),
    h("span", {}, "Opens in a new tab"));
  state.root.append(mapPlate(groups), h("div", { class: "map-body" }, find, empty, h("div", { class: "map-areas" }, zones, areas)));
}

export async function load() {}
