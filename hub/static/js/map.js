// System › Site map: every area, page and tool on one page. It is drawn from routes.js (the pages the server knows), the
// area strips and the tool registry, so a page or tool added there appears here with no edit (A6 decision sitemap).
import { h } from "./core.js";
import ROUTES from "./routes.js";
import { SECTIONS, toolUrl } from "./sections.js";
import { STRIPS } from "./system-strip.js";
import { TOOLS } from "../ui/tools.js";

export const every = 600;

// Pages that aren't on a strip have no strip name: these are theirs. A page with neither gets its address as its name,
// which the Site map test refuses, so a new page can't ship unnamed.
const OTHER_NAMES = { "/": "Home", "/wall": "Wall display", "/more": "More (the phone's menu)" };

const pageNames = () => new Map([
  ...Object.entries(OTHER_NAMES),
  ...Object.values(STRIPS).flatMap(({ entries }) => entries),
]);

// The map as data: one group per area (the rail's six, in its order), the Assistant, pages in no area, and the tools that
// are machine-facing. Pure, so it is tested without a page.
export function siteMap(routes = ROUTES, tools = TOOLS) {
  const names = pageNames();
  const named = (href) => ({ href, label: names.get(href) || href });
  const placed = new Set();
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
    { key: "assistant", title: "Assistant", path: "", pages: [], tools: assistant },
    ...(loose.length || rest.length ? [{ key: "other", title: "Other", path: "", pages: loose.map(named), tools: rest }] : []),
    { key: "machine", title: "Machine-facing, not for browsing", path: "", pages: [], tools: machine, machine: true },
  ];
}

function toolItem(t, machine) {
  return h("li", {}, machine
    ? [h("strong", {}, t.name), h("span", { class: "meta" }, `${t.host} · ${t.purpose}`)]
    : h("a", { href: toolUrl(t.id), target: "_blank", rel: "noopener" }, h("strong", {}, `${t.name} ↗`), h("span", { class: "meta" }, t.purpose)));
}

export function mount(state) {
  state.root.append(h("p", { class: "page-intro" }, "Every page and tool, drawn from the menu and the tool list, so it is always current."),
    ...siteMap().map((g) => h("section", { class: "more-group", dataset: { area: g.key } },
      h("h2", {}, g.path ? h("a", { href: g.path, "data-link": true }, g.title) : g.title),
      g.pages.length ? h("ul", { class: "more" }, g.pages.map((p) =>
        h("li", {}, h("a", { href: p.href, "data-link": true }, h("strong", {}, p.label), h("span", { class: "meta" }, p.href))))) : null,
      g.tools.length ? h("ul", { class: "more" }, g.tools.map((t) => toolItem(t, g.machine))) : null)));
}

export async function load() {}
