// The site, read from the kit's one page list (appliance-ui pages.json; amendment A22 section 3, step 12). A page's
// name, purpose and address are written there and nowhere here: the strips, the titles, ⌘K, the Site map and the old
// addresses are all answered from this module. Pi Hub draws its own rows (system "hub") that are built; the
// Assistant's rows are in the list for step 14 and are not drawn from it yet (step 12 plan, decision 3).
import { AREAS as LIST_AREAS, PAGES as LIST_PAGES } from "../ui/pages.js";
import { TOOLS, tool } from "../ui/tools.js";

// A site over any copy of the list, so a test can change one label and see every place follow (criterion 4).
export function makeSite(areas = LIST_AREAS, pages = LIST_PAGES) {
  const rows = pages.filter((p) => p.system === "hub" && p.built !== false);
  const byId = new Map(rows.map((p) => [p.id, p]));
  const plain = (path) => path.split("#")[0];
  // One address, one page: a page and its first tab share one, and the page is listed first.
  const byPath = new Map();
  for (const p of rows) if (!p.path.includes("#") && !byPath.has(p.path)) byPath.set(p.path, p);
  const aliases = Object.fromEntries(rows.flatMap((p) => (p.aliases || []).map((a) => [a, plain(p.path)])));
  const area = (id) => areas.find((a) => a.id === id) || null;
  const has = (p, way) => p.reach.includes(way);
  const strip = (areaId) => rows.filter((p) => p.area === areaId && p.role === "page" && has(p, "strip"));
  // A view's name where it stands alone (⌘K, the Site map): "Settings › Home". In its own tab row it is just its label.
  const fullLabel = (p) => (p.parent && byId.get(p.parent) ? `${byId.get(p.parent).label} › ${p.label}` : p.label);
  // A page the server writes whole (the Privacy note): a link to it is a full page load, not a shell page.
  const served = (p) => p.role === "standalone";

  return {
    areas,
    rows,
    page: (id) => byId.get(id) || null,
    pageAt: (path) => byPath.get(path) || null,
    // Every address the shell answers: the pages it draws, and the old addresses it moves.
    shellPaths: () => [...byPath.values()].filter((p) => !served(p)).map((p) => p.path),
    aliases: () => ({ ...aliases }),
    redirectFor: (path) => aliases[path] || null,
    area,
    areaOf: (path) => byPath.get(path)?.area || null,
    fullLabel,
    served,
    // The area's pages as a strip, on each page that is in it; null for a page that isn't (Home, the Wall display).
    stripFor(path) {
      const p = byPath.get(path);
      if (!p || p.role !== "page" || !has(p, "strip")) return null;
      const a = area(p.area);
      return { key: a.id, label: `${a.label} pages`, items: strip(a.id).map((q) => ({ href: q.path, label: q.label, current: q === p })) };
    },
    // What a page is headed by and what the browser tab reads: "Page · Area", or the page alone when they are one word.
    headingFor(path) {
      const p = byPath.get(path);
      if (!p) return null;
      const a = area(p.area);
      return { heading: p.label, title: a && a.label !== p.label ? `${p.label} · ${a.label}` : p.label, purpose: p.purpose || "" };
    },
    // A page's "Open in" row: its tools in the list, in its order.
    toolsOf: (id) => (byId.get(id)?.tools || []).map((t) => tool(t)).filter(Boolean),
    // Every row with a way in through ⌘K or the Site map, as one entry: its full name, address and area.
    entries(way) {
      return rows.filter((p) => has(p, way)).map((p) => ({ id: p.id, label: fullLabel(p), href: p.path, area: p.area || "",
        areaLabel: area(p.area)?.label || "", plain: served(p), view: !!p.parent }));
    },
  };
}

export const SITE = makeSite();

// The areas' tools for the Site map: each area's own, the retired ones, and the machine-facing ones.
export const areaTools = (areaId, tools = TOOLS) => tools.filter((t) => t.area === areaId && !t.boundary && !t.retired);
export const retiredTools = (tools = TOOLS) => tools.filter((t) => t.retired);

// The rail entry a path lights: its area, or "assistant" (level 0, A4: no rail area, the button marks it). A path the
// list doesn't have lights Home.
export function sectionFor(path) {
  if (path === "/assistant") return "assistant";
  return SITE.areaOf(path) || "home";
}
