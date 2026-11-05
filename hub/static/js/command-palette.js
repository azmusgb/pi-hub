// The ⌘K palette: the kit's one component (appliance-ui palette.js, platform step 7 Decision 7) with Pi Hub's
// providers: Go (pages, tools, the Assistant's door), Do (printer actions and fixes, each asking first, inline
// under the input), Find (records, Needs you, documents), Ask (the hand-off) and Search (the area pages' own searches).
import { api, askFirst, fix, FIX_WHAT } from "./core.js";
import { runPrinterAction, PRINTER_ACTIONS, PRINTER_DEPS } from "./printer-actions.js";
import { assistantButton, assistantHref, resolveLink, TOOLS, toolUrl } from "./sections.js";
import { navigateSpa, RECORD_LABELS, recordPath } from "./control-room.js";

const PAGES = [
  { label: "Home", href: "/", area: "Home", keywords: "home overview now needs you" },
  { label: "Wall display", href: "/wall", area: "Home", keywords: "wall display kiosk ambient" },
  { label: "Printer", href: "/workshop", area: "Workshop", keywords: "workshop printer bambu x2d camera spools ams" },
  { label: "Print lab", href: "/lab", area: "Workshop", keywords: "print lab experiments coupons verdicts judge" },
  { label: "Papers", href: "/documents", area: "Documents", keywords: "documents papers paperless scan pdf tax" },
  { label: "Print", href: "/print", area: "Documents", keywords: "print a document paper hp deskjet cups ink" },
  { label: "Lists", href: "/lists", area: "Documents", keywords: "lists shopping todo notes groceries" },
  { label: "Movies", href: "/media", area: "Media", keywords: "media movies plex watch movie night" },
  { label: "Drives", href: "/drives", area: "Media", keywords: "drives storage usb disk movies copy" },
  { label: "Devices", href: "/devices", area: "Home & network", keywords: "home network devices lights plugs switches fans homebridge" },
  { label: "Network", href: "/network", area: "Home & network", keywords: "home network internet wifi adguard dns" },
  { label: "Weather", href: "/weather", area: "Home & network", keywords: "weather forecast rain sun temperature" },
  { label: "Health", href: "/system", area: "System", keywords: "health system services diagnostics pi help fix" },
  { label: "Backups", href: "/backups", area: "System", keywords: "backups backrest restore" },
  { label: "Versions", href: "/versions", area: "System", keywords: "versions releases deploys live commit" },
  { label: "Alerts", href: "/alerts", area: "System", keywords: "alerts events history log" },
  { label: "Automations", href: "/rules", area: "System", keywords: "automations rules triggers" },
  { label: "Settings", href: "/settings", area: "System", keywords: "settings password devices access" },
  { label: "Site map", href: "/map", area: "System", keywords: "site map every page tool menu where" },
];

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

// Go: Pi Hub's pages, each gated tool on its real name (from the registry), and the Assistant's door.
export function goResults(query) {
  const q = norm(query);
  const pages = PAGES.filter((p) => matches(q, p.label, p.area, p.keywords))
    .map(({ label, href, area }) => ({ kind: "go", label, href, area }));
  const tools = TOOLS.filter((t) => !t.boundary && t.id !== "hub" && matches(q, t.name, t.purpose, t.id))
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

// Find: documents, through the Documents page's own search. They are the owner's: signed out gives none; Paperless
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
    href: `/documents?q=${encodeURIComponent(q)}`, area: "Documents" }));
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
    { kind: "search", label: `Search Documents for “${raw}”`, href: `/documents?q=${encodeURIComponent(raw)}`, area: "Documents" },
    { kind: "search", label: `Search Movies for “${raw}”`, href: `/media?q=${encodeURIComponent(raw)}`, area: "Media" },
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

export function hubProviders({ get = api } = {}) {
  const state = cached(async () => {
    const [r, n] = await Promise.all([get("/api/records").catch(() => null), get("/api/needs").catch(() => null)]);
    return { records: Array.isArray(r?.records) ? r.records : [], needs: n };
  });
  const assistant = cached(() => get("/api/assistant").catch(() => null), 30_000);
  const ask = { name: "Assistant", down: "The Assistant isn't answering", timeout: 3000,
    async find(q) {
      try { return askResult(q, await assistant()); }
      catch (e) { if (e?.phrase) ask.down = e.phrase; throw e; }
    } };
  return [
    { name: "Pages", find: (q) => goResults(q) },
    { name: "Pi Hub", down: "Pi Hub isn't answering", find: async (q) => {
      const { records, needs } = await state();
      return [...doResults(q, records), ...findResults(q, records, needs)];
    } },
    { name: "Documents", down: "Paperless isn't answering", timeout: 5000,
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
    navigate: navigateSpa,
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
