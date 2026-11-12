// The ⌘K palette: the kit's one component (appliance-ui palette.js, platform step 7 Decision 7) with Pi Hub's
// providers: Go (pages, tools, the Assistant's door), Do (printer actions and fixes, each asking first, inline
// under the input), Find (records, Needs you, documents), Ask (the hand-off) and Search (the area pages' own searches).
import { api, askFirst, fix, FIX_WHAT } from "./core.js";
import { runPrinterAction, PRINTER_ACTIONS, PRINTER_DEPS } from "./printer-actions.js";
import { assistantButton, assistantHref, resolveLink, TOOLS, toolUrl } from "./sections.js";
import { SITE } from "./site.js";
import { navigateSpa, RECORD_LABELS, recordPath } from "./control-room.js";

// Words that also find a page, by its id in the page list (step 12 plan, decision 8). They are hints, not names, and
// keep the retired words: typing "devices" still finds Lights. A key that isn't a page fails a test.
export const KEYWORDS = {
  home: "overview now needs you",
  wall: "wall kiosk ambient",
  printer: "workshop bambu x2d camera spools ams",
  quick: "stl 3mf slice model upload x2d",
  lab: "experiments coupons verdicts judge",
  "lab-experiments": "coupons verdicts judge",
  movies: "media plex watch movie night",
  papers: "documents paperless pdf tax",
  scan: "scanner scanned",
  print: "a document paper hp deskjet cups ink",
  lists: "shopping todo notes groceries",
  drives: "storage usb disk movies copy",
  lights: "devices home network plugs switches fans homebridge",
  internet: "network home wifi adguard dns",
  weather: "forecast rain sun temperature",
  health: "system services diagnostics pi help fix",
  backups: "backrest restore",
  versions: "releases deploys live commit",
  alerts: "events history log",
  automations: "rules triggers",
  settings: "setup password devices access",
  "settings-general": "appearance theme text size",
  "settings-home": "homebridge guest wifi workshop display",
  "settings-outside": "forecast location events",
  "settings-phone": "morning digest quiet hours notifications",
  "settings-people": "your devices siri shortcuts owner password",
  "settings-pi": "backups activity",
  map: "every page tool menu where more",
  privacy: "google drive backup consent data",
};

const FIXES = [
  { name: "selfcheck:run", label: "Run a hub self-check", keywords: "selfcheck check diagnostic test health" },
  { name: "restart:plex", label: "Restart Plex", keywords: "restart plex movies media" },
  { name: "rescan:plex", label: "Rescan the Plex movie library", keywords: "rescan plex library movies" },
  { name: "remount:movies", label: "Remount the movies drive", keywords: "remount usb drive movies storage" },
  { name: "mirror:movies", label: "Copy new movies from the PC", keywords: "copy mirror sync movies pc" },
  { name: "restart:homebridge", label: "Restart Homebridge", keywords: "restart homebridge lights devices smart home" },
];

const matches = (q, ...texts) => !q || texts.some((t) => String(t || "").toLowerCase().includes(q));
const norm = (query) => String(query || "").trim().toLowerCase();

// The Assistant's row: the rail button's word for it, and that button's phrase as the hint while the PC is off or the
// Assistant is down (A22 step 11). It adds no state of its own.
function assistantRow(q, assistant) {
  if (!matches(q, "assistant", "ask ai chat local ai")) return [];
  const { disabled, label } = assistantButton(assistant?.state, assistant?.pc);
  return [{ kind: "go", label: "Assistant", href: "/assistant", area: "Assistant", ...(disabled ? { hint: label } : {}) }];
}

// Go: every Pi Hub page, tab and standalone page in the list, each with its area ("Other" for a page in none, as on
// the Site map); the Assistant; and each tool that is still in use, on its real name (from the registry). `assistant` is the last /api/assistant answer, when there is one.
export function goResults(query, assistant = null, site = SITE) {
  const q = norm(query);
  const pages = [
    ...site.entries("palette").filter((p) => matches(q, p.label, p.areaLabel, KEYWORDS[p.id]))
      .map(({ label, href, areaLabel }) => ({ kind: "go", label, href, area: areaLabel || "Other" })),
    ...assistantRow(q, assistant),
  ];
  const tools = TOOLS.filter((t) => !t.boundary && !t.retired && t.id !== "hub" && matches(q, t.name, t.purpose, t.id))
    .map((t) => ({ kind: "go", label: `Open ${t.name}`, hint: t.purpose, href: toolUrl(t.id), area: "Tools" }));
  return [...pages, ...tools];
}

// Do: the printer's current actions and the hub's fixes. The palette asks first, inline under its input (A7 P7), in
// the words the rest of the hub uses; the action then runs without asking again.
export function doResults(query, records = [], { onDone = () => {} } = {}) {
  const q = norm(query);
  const printer = records.find((r) => r?.id === "printer");
  const actions = (printer?.actions || []).filter((a) => PRINTER_ACTIONS[a])
    .map((a) => ({ kind: "do", label: `${PRINTER_ACTIONS[a].label} on the X2D`, area: "Workshop",
      keywords: `${a} printer x2d bambu plate print`, ...(PRINTER_ACTIONS[a].ask ? { confirm: PRINTER_ACTIONS[a].ask } : {}),
      run: () => runPrinterAction(a, [], onDone, { ...PRINTER_DEPS, confirm: () => true }) }));
  const fixes = FIXES.map((f) => ({ kind: "do", label: f.label, area: "Health", keywords: f.keywords, confirm: FIX_WHAT[f.name] || `${f.label}?`,
    run: () => fix(f.name, f.label, { onResult: onDone, asked: true }) }));
  return [...actions, ...fixes].filter((r) => matches(q, r.label, r.keywords)).map(({ keywords, ...r }) => r);  // eslint-disable-line no-unused-vars
}

// Find: live records and the Needs you list (only with a query: an empty palette shows pages and recents).
export function findResults(query, records = [], needs = null) {
  const q = norm(query);
  if (!q) return [];
  const recs = records.filter((r) => r?.id).map((r) => {
    const name = RECORD_LABELS[r.id] || r.id;
    return { kind: "find", label: `${name}: ${r.headline || r.state}`, hint: r.cause || "", href: recordPath(r.id),
      area: "Now", at: r.as_of || r.at || undefined, text: `${name} ${r.id} ${r.state} ${r.headline || ""} ${r.cause || ""}` };
  });
  const items = (needs?.items || []).filter((n) => n?.title).map((n) => ({
    kind: "find", label: n.title, hint: n.detail || "", href: resolveLink(n.act?.href || n.link) || "/", area: "Needs you",
    at: n.as_of || undefined, text: `${n.title} ${n.detail || ""} ${n.source || ""}`,
  }));
  return [...items, ...recs].filter((r) => matches(q, r.text)).map(({ text, ...r }) => r);  // eslint-disable-line no-unused-vars
}

// Find: papers, through the Papers page's own search. They are the owner's: signed out gives none; Paperless
// off is "down".
export async function documentResults(query, { signal, get = api } = {}) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  let r;
  try {
    r = await get(`/api/documents?q=${encodeURIComponent(q)}`, { signal });
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) return [];  // documents are the owner's: not signed in isn't "down"
    throw e;
  }
  if (!r?.available) throw new Error("Paperless isn't answering");
  return (r.results || []).slice(0, 5).map((d) => ({ kind: "find", label: d.title, hint: d.created || "",
    href: `/documents?q=${encodeURIComponent(q)}`, area: SITE.page("papers").label }));
}

// Ask: the hand-off to the Assistant. With the PC off (or Local AI down) the provider says so, in the phrase table's
// words, as its one line: `askProvider.down` is set before it throws.
export function askResult(query, assistant, host = globalThis.location?.hostname || "") {
  const raw = String(query || "").trim();
  const { disabled, label } = assistantButton(assistant?.state, assistant?.pc);
  if (disabled) {
    const e = new Error(label);
    e.phrase = label;
    throw e;
  }
  if (raw.length < 2) return [];
  return [{ kind: "ask", label: `Ask the Assistant: “${raw}”`, href: assistantHref(host, "Search", raw), area: "Assistant" }];
}

// Search: the area pages' own searches, prefilled.
export function searchResults(query) {
  const raw = String(query || "").trim();
  if (raw.length < 2) return [];
  return [
    ...["papers", "movies"].map((id) => SITE.page(id)).map((p) => ({ kind: "search", label: `Search ${p.label} for “${raw}”`,
      href: `${p.path}?q=${encodeURIComponent(raw)}`, area: SITE.area(p.area).label })),
  ];
}

// What the providers read, fetched at most every 15 s (a palette search runs on every keystroke).
function cached(load, ttl = 15_000) {
  let at = 0, value = null, pending = null;
  return async () => {
    if (value && Date.now() - at < ttl) return value;
    if (!pending) pending = load().then((v) => { value = v; at = Date.now(); return v; }).finally(() => { pending = null; });
    return pending;
  };
}

// A result's address: the shell draws its own pages; a page the server writes is loaded whole. The kit's palette hands
// over the resolved, absolute address, so the path is what's compared.
export function paletteNavigate(href, { spa = navigateSpa, load = (h) => globalThis.location.assign(h) } = {}) {
  let path = href;
  try { path = new URL(href, "https://hub.invalid").pathname; } catch { /* not an address: let the shell answer it */ }
  if (SITE.pageAt(path) && SITE.served(SITE.pageAt(path))) load(href); else spa(href);
}

export function hubProviders({ get = api } = {}) {
  const state = cached(async () => {
    const [r, n] = await Promise.all([get("/api/records").catch(() => null), get("/api/needs").catch(() => null)]);
    return { records: Array.isArray(r?.records) ? r.records : [], needs: n };
  });
  // The Assistant's last answer, kept for the Pages provider: it never waits on the PC to list a page.
  let lastAssistant = null;
  const assistant = cached(() => get("/api/assistant").catch(() => null).then((a) => (lastAssistant = a)), 30_000);
  assistant().catch(() => {});  // asked once up front, so the first search already knows
  const ask = { name: "Assistant", down: "The Assistant isn't answering", timeout: 3000,
    async find(q) {
      try { return askResult(q, await assistant()); }
      catch (e) { if (e?.phrase) ask.down = e.phrase; throw e; }
    } };
  return [
    { name: "Pages", find: (q) => { assistant().catch(() => {}); return goResults(q, lastAssistant); } },
    { name: "Pi Hub", down: "Pi Hub isn't answering", find: async (q) => {
      const { records, needs } = await state();
      return [...doResults(q, records), ...findResults(q, records, needs)];
    } },
    { name: "Papers", down: "Paperless isn't answering", timeout: 5000,
      find: (q, { signal } = {}) => documentResults(q, { signal, get }) },
    ask,
    { name: "Search", find: (q) => searchResults(q) },
  ];
}

// The one palette (index.html loads the kit's palette.js as a classic script before this module).
export function initCommandPalette() {
  if (typeof document === "undefined" || window.hubPalette) return;
  const Palette = window.AppliancePalette;
  if (!Palette?.create) return;
  const palette = Palette.create({
    providers: hubProviders(),
    navigate: paletteNavigate,
    recentKey: "pihub.palette.recent",
    label: "Search and go",
    placeholder: "Search, go to a page, run a fix, or ask the Assistant…",
    // A risky "do" asks inline, under the palette's input, never with the browser's confirm().
    confirm: (question) => askFirst(palette.dialog?.querySelector(".ui-palette__input"), question),
  });
  window.hubPalette = palette;
  window.openHubCommandPalette = (query) => palette.open(query);
  document.getElementById("top-cmd-btn")?.addEventListener("click", () => palette.open());
}
