// The ⌘K command palette (upgrades #palette in index.html): records, needs, fixes and pages. Moved out of next.js in
// platform step 7, PR 7.4; the kit palette replaces it in PR 7.6.
import { api, fix, h } from "./core.js";
import { runPrinterAction } from "./printer-actions.js";
import { assistantHref, toolUrl } from "./sections.js";
import { navigateSpa, RECORD_LABELS, RECORD_PATHS, recordTone } from "./control-room.js";

export function buildCommandItems(query = "", { records = [], needs = null, host = globalThis.location?.hostname || "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const all = [];

  // 1. Live actions from current printer / needs state
  const printer = records.find((r) => r.id === "printer");
  if (printer?.actions?.includes("clear")) {
    all.push({ id: "act:printer:clear", label: "Clear the X2D plate", badge: "Action", kind: "printer", action: "clear", keywords: "clear plate printer x2d bambu finished" });
  }
  if (printer?.actions?.includes("pause")) {
    all.push({ id: "act:printer:pause", label: "Pause the X2D print", badge: "Action", kind: "printer", action: "pause", keywords: "pause print printer x2d bambu" });
  }
  if (printer?.actions?.includes("resume")) {
    all.push({ id: "act:printer:resume", label: "Resume the X2D print", badge: "Action", kind: "printer", action: "resume", keywords: "resume print printer x2d bambu" });
  }
  for (const item of needs?.items || []) {
    if (item?.act?.href && item.id?.startsWith("pi:lab:")) {
      all.push({
        id: `act:${item.id}`,
        label: item.title,
        sub: item.detail || "Print Lab",
        badge: "Print Lab",
        kind: "nav",
        href: item.act.href,
        keywords: `judge print lab verdict ${item.title} ${item.detail || ""}`.toLowerCase(),
      });
    }
  }

  // 2. Fix-it actions
  const fixes = [
    { name: "selfcheck:run", label: "Run a hub self-check", keywords: "selfcheck check diagnostic test health" },
    { name: "restart:plex", label: "Restart Plex", keywords: "restart plex movies media" },
    { name: "rescan:plex", label: "Rescan the Plex movie library", keywords: "rescan plex library movies" },
    { name: "remount:movies", label: "Remount the movies drive", keywords: "remount usb drive movies storage" },
    { name: "mirror:movies", label: "Copy new movies from the PC", keywords: "copy mirror sync movies pc" },
    { name: "restart:homebridge", label: "Restart Homebridge (smart-home controls)", keywords: "restart homebridge lights devices" },
  ];
  for (const f of fixes) {
    all.push({ id: `fix:${f.name}`, label: f.label, badge: "Fix it", kind: "fix", fixName: f.name, keywords: f.keywords });
  }

  // 3. Pages & Views
  const pages = [
    { label: "Home", href: "/", badge: "Page", keywords: "home overview dashboard" },
    { label: "Workshop (Bambu X2D & Filament)", href: "/workshop", badge: "Page", keywords: "workshop printer bambu x2d camera spools ams" },
    { label: "Print lab (Experiments & Verdicts)", href: "/lab", badge: "Page", keywords: "print lab experiments coupons verdicts judge" },
    { label: "Documents (Paperless & Scanner)", href: "/documents", badge: "Page", keywords: "documents paperless scan pdf tax" },
    { label: "Media (Movies & Movie night)", href: "/media", badge: "Page", keywords: "media movies plex watch movie night" },
    { label: "Home & network (Lights, Wi-Fi, AdGuard)", href: "/network", badge: "Page", keywords: "network home lights devices wifi adguard dns" },
    { label: "System (Backups, Alerts, Settings)", href: "/system", badge: "Page", keywords: "system backups backrest alerts rules settings" },
    { label: "Wall display (Kiosk & Hybrid presets)", href: "/wall", badge: "View", keywords: "wall display kiosk ambient preset" },
    { label: "Weather & Forecast", href: "/weather", badge: "Page", keywords: "weather forecast rain sun temperature" },
    { label: "Lists (Shopping, To-do, Notes)", href: "/lists", badge: "Page", keywords: "lists shopping todo notes groceries" },
    { label: "Document printer (HP DeskJet)", href: "/print", badge: "Page", keywords: "print paper hp deskjet cups ink" },
    { label: "Automations & Rules", href: "/rules", badge: "Page", keywords: "automations rules triggers alerts" },
    { label: "Alerts & Event log", href: "/alerts", badge: "Page", keywords: "alerts events history log" },
    { label: "Help & Diagnostics", href: "/pi", badge: "Page", keywords: "help diagnostics pi temperature cpu memory" },
    { label: "Storage & Drives", href: "/drives", badge: "Page", keywords: "drives storage usb disk movies" },
    { label: "Versions", href: "/versions", badge: "Page", keywords: "versions releases deploys live commit rollback" },
    { label: "Settings", href: "/settings", badge: "Page", keywords: "settings password devices wifi homebridge" },
  ];
  for (const p of pages) {
    all.push({ id: `page:${p.href}`, label: p.label, badge: p.badge, kind: "nav", href: p.href, keywords: p.keywords });
  }

  // 4. Live Records (searchable by thing name, state, or headline)
  for (const r of records) {
    if (!r || !r.id) continue;
    const name = RECORD_LABELS[r.id] || r.id;
    const href = RECORD_PATHS[r.id] || "/";
    all.push({
      id: `rec:${r.id}`,
      label: `${name}: ${r.headline || r.state}`,
      sub: r.cause || "",
      badge: r.severity === "problem" ? "Problem" : r.severity === "attention" ? "Check" : "Live",
      tone: recordTone(r.severity),
      kind: "nav",
      href,
      keywords: `${name} ${r.id} ${r.state} ${r.headline || ""} ${r.cause || ""}`.toLowerCase(),
    });
  }

  // 5. External tools
  const tools = [
    { name: "bambuddy", label: "Open Bambuddy ↗", keywords: "bambuddy spools queue printer archive" },
    { name: "paperless", label: "Open Paperless ↗", keywords: "paperless documents archive" },
    { name: "backups", label: "Open Backrest (Backups) ↗", keywords: "backrest restic backups restore" },
    { name: "adguard", label: "Open AdGuard Home ↗", keywords: "adguard dns blocking ads" },
    { name: "network", label: "Open Grafana ↗", keywords: "grafana metrics charts network" },
    { name: "status", label: "Open Uptime Kuma ↗", keywords: "uptime kuma status monitors" },
  ];
  for (const t of tools) {
    all.push({
      id: `tool:${t.name}`,
      label: t.label,
      badge: "Tool",
      kind: "external",
      href: toolUrl(t.name, host),
      keywords: t.keywords,
    });
  }

  const matched = q
    ? all.filter((it) => it.label.toLowerCase().includes(q) || (it.sub && it.sub.toLowerCase().includes(q)) || (it.keywords && it.keywords.includes(q)))
    : all.slice(0, 14);

  // 6. Direct query hand-offs when the user types a search term or question
  if (q.length >= 2) {
    const raw = String(query).trim();
    matched.push(
      {
        id: "query:docs",
        label: `Search Documents for “${raw}”`,
        badge: "Search",
        kind: "nav",
        href: `/documents?q=${encodeURIComponent(raw)}`,
      },
      {
        id: "query:media",
        label: `Search Movies for “${raw}”`,
        badge: "Search",
        kind: "nav",
        href: `/media?q=${encodeURIComponent(raw)}`,
      },
      {
        id: "query:assistant",
        label: `Ask Assistant: “${raw}” ↗`,
        badge: "Assistant",
        kind: "external",
        href: assistantHref(host, "Command bar", raw),
      }
    );
  }

  return matched.slice(0, 18);
}

// Global ⌘K Command Palette controller (upgrades #palette in index.html)
export function initCommandPalette() {
  if (typeof document === "undefined") return;
  const palette = document.getElementById("palette");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  if (!palette || !input || !results || palette.dataset.upgraded === "1") return;
  palette.dataset.upgraded = "1";
  input.placeholder = "Search records, jump to a page, run a fix, or ask Assistant…";

  let cachedRecords = [];
  let cachedNeeds = null;
  let activeIdx = 0;
  let filtered = [];

  async function refreshPaletteContext() {
    const [r, n] = await Promise.all([
      api("/api/records").catch(() => null),
      api("/api/needs").catch(() => null),
    ]);
    if (Array.isArray(r?.records)) cachedRecords = r.records;
    if (n) cachedNeeds = n;
    if (!palette.hidden) updateList();
  }

  function closePalette() {
    palette.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function runItem(it) {
    if (!it) return;
    closePalette();
    if (it.kind === "nav" && it.href) {
      navigateSpa(it.href);
    } else if (it.kind === "external" && it.href) {
      window.open(it.href, "_blank", "noopener");
    } else if (it.kind === "printer" && it.action) {
      runPrinterAction(it.action, [], () => refreshPaletteContext());
    } else if (it.kind === "fix" && it.fixName) {
      fix(it.fixName, it.label, { onResult: () => refreshPaletteContext() });
    }
  }

  function renderList() {
    results.replaceChildren();
    if (!filtered.length) {
      results.append(h("li", { class: "palette-empty" }, "Nothing matches"));
      return;
    }
    filtered.forEach((it, i) => {
      const li = h("li", {
        class: "palette-item" + (i === activeIdx ? " is-active" : ""),
        role: "option",
        id: `palette-opt-${i}`,
        onmouseenter: () => { activeIdx = i; renderList(); },
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); runItem(it); },
      },
        it.tone ? h("span", { class: "dot", dataset: { tone: it.tone }, "aria-hidden": "true" }) : null,
        h("span", { class: "palette-label" },
          it.label,
          it.sub ? h("span", { class: "meta", style: "display:block; font-size:.75rem;" }, it.sub) : null),
        h("span", { class: "palette-page" }, it.badge || ""));
      results.append(li);
    });
  }

  function updateList() {
    filtered = buildCommandItems(input.value, { records: cachedRecords, needs: cachedNeeds });
    activeIdx = Math.min(activeIdx, Math.max(filtered.length - 1, 0));
    renderList();
  }

  function openPalette() {
    palette.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.value = "";
    activeIdx = 0;
    updateList();
    refreshPaletteContext();
    requestAnimationFrame(() => input.focus());
  }

  window.openHubCommandPalette = openPalette;

  // Capture-phase listeners on input so our upgraded handler takes precedence over enhance.js's static list
  input.addEventListener("input", (e) => {
    e.stopImmediatePropagation();
    activeIdx = 0;
    updateList();
  }, true);

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIdx = Math.min(activeIdx + 1, Math.max(filtered.length - 1, 0));
      renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIdx = Math.max(activeIdx - 1, 0);
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      runItem(filtered[activeIdx]);
    } else if (e.key === "Escape") {
      e.stopImmediatePropagation();
      closePalette();
    }
  }, true);

  document.getElementById("top-cmd-btn")?.addEventListener("click", openPalette);
}
