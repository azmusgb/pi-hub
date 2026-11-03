// Control room (Problems / Now / Since you last looked, shown on Home since 31 Oct 2026; /next redirects to /) and
// the Command Bar (⌘K), backed by /api/records + /api/records/stream (live SSE) and /api/needs.
import { api, card, duration, empty, fix, h, settle, when } from "./core.js";
import { printerButtons, runPrinterAction } from "./printer-actions.js";
import { assistantHref, printLabUrl, resolveLink, toolUrl } from "./sections.js";

export const every = 15;

export const RECORD_LABELS = {
  printer: "Bambu X2D",
  obico: "Failure detection",
  hms: "Printer alerts",
  camera: "Printer camera",
  workshop_display: "Workshop display",
  pc: "Windows PC",
  local_ai: "Local AI",
  pi: "Raspberry Pi",
  movies_drive: "Movies drive",
  movie_copy: "Movie copy from the PC",
  internet: "Internet",
  adguard: "Ad blocking",
  backups: "Backups",
  plex: "Movies",
  devices: "Smart-home controls",
  paper_printer: "Document printer",
  weather: "Weather",
  hub: "The hub's sources",
  pc_printing: "PC during a print",
};

export const RECORD_PATHS = {
  printer: "/workshop",
  obico: "/workshop",
  hms: "/workshop",
  camera: "/workshop",
  workshop_display: "/workshop",
  pc: "/system",
  local_ai: "/workshop",
  pi: "/pi",
  movies_drive: "/drives",
  movie_copy: "/drives",
  internet: "/network",
  adguard: "/network",
  backups: "/system",
  plex: "/media",
  devices: "/network",
  paper_printer: "/print",
  weather: "/weather",
  hub: "/system",
  pc_printing: "/workshop",
};

const FIX_MAP = {
  plex: { name: "restart:plex", label: "Restart Plex" },
  devices: { name: "restart:homebridge", label: "Restart Homebridge" },
  movies_drive: { name: "remount:movies", label: "Remount the movies drive" },
  movie_copy: { name: "mirror:movies", label: "Copy new movies from the PC" },
};

const SEEN_KEY = "pi-control-last-seen";

export function recordTone(severity) {
  if (severity === "problem" || severity === "bad") return "bad";
  if (severity === "attention" || severity === "warn") return "warn";
  return "ok";
}

// Which records belong in NOW (active or unusual) vs the collapsed "All else OK" line.
// On Home ({ skipPrinter }) the printer band above already shows the printer, so Now leaves it out.
export function splitNowRecords(records = [], { skipPrinter = false } = {}) {
  const active = [];
  const calm = [];
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    if (skipPrinter && r.id === "printer") continue;
    const isPrinting = r.id === "printer" && ["printing", "paused", "finished", "failed"].includes(r.state);
    const isPlaying = r.id === "plex" && r.state === "playing";
    const isPaperBusy = r.id === "paper_printer" && r.state === "busy";
    const isAiBusy = r.id === "local_ai" && r.state === "busy";
    if (isPrinting || isPlaying || isPaperBusy || isAiBusy) {
      active.push(r);
    } else if (r.severity === "ok" && !r.stale) {
      calm.push(r);
    }
  }
  return { active, calm };
}

// A record's actions are `{name, ...}` objects (records.make); the printer buttons and the fix map want the names.
export function actionNames(actions = []) {
  return (Array.isArray(actions) ? actions : []).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean);
}

// What Home's Now shows for the printer record: one big readout and the facts under it, from the record's own detail
// keys (job, progress, minutes_left, layer, total_layers, attempt, lab).
export function printerNow(r, nowMs = Date.now()) {
  const d = r?.detail || {};
  const running = r?.state === "printing" || r?.state === "paused";
  const pct = running && Number.isFinite(d.progress) ? Math.max(0, Math.min(100, Math.round(d.progress))) : null;
  const facts = [];
  if (typeof d.job === "string" && d.job.trim()) facts.push(d.job.trim());
  if (r?.state === "printing" && Number.isFinite(d.minutes_left) && d.minutes_left > 0) {
    const done = new Date(nowMs + d.minutes_left * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    facts.push(`${duration(d.minutes_left * 60)} left, done ${done}`);
  }
  if (Number.isFinite(d.layer) && d.layer > 0) facts.push(`Layer ${d.layer} of ${Number.isFinite(d.total_layers) && d.total_layers > 0 ? d.total_layers : "?"}`);
  if (Number.isFinite(d.attempt) && d.attempt >= 2) facts.push(`Attempt ${d.attempt}`);
  const said = r?.headline || r?.state || "";
  return {
    running,
    readout: pct === null ? said : `${pct}%`,
    word: pct === null ? "" : (r.state === "paused" ? "Paused" : "Printing"),
    pct,
    facts,
    cause: r?.cause || "",
    actions: actionNames(r?.actions),
    lab: d.lab?.exp || d.lab_experiment || "",
  };
}

// A time as the page says it: today's times need no "Today,"; other days keep their day ("yesterday, 9:37 PM").
export function shortWhen(ts) {
  if (!(Number(ts) > 0)) return "—";  // when() reads null as 1970
  return when(ts).replace(/^Today, /, "").replace(/^Yesterday,/, "yesterday,");
}

// Only rows that are new among older ones are marked; when every row is new, the count above already says so.
export function markNew(events = [], lastSeen = 0) {
  const fresh = events.map((e) => lastSeen > 0 && (e?.ts || 0) > lastSeen);
  return fresh.every(Boolean) ? fresh.map(() => false) : fresh;
}

export function calmSummaryText(calm = []) {
  if (!calm.length) return "";
  const names = calm.map((r) => RECORD_LABELS[r.id] || r.id);
  const shown = names.slice(0, 6).join(", ");
  const extra = names.length > 6 ? ` + ${names.length - 6} more` : "";
  return `All else OK: ${shown}${extra}`;
}

// "Ad blocking: Ad blocking is off" says the name twice: a headline that already starts with the name stands alone.
export function recordTitle(r) {
  const label = RECORD_LABELS[r.id] || r.id;
  const said = r.headline || r.state || "";
  return said.toLowerCase().startsWith(label.toLowerCase()) ? said : `${label}: ${said}`;
}

// Merge Needs you items with any problem/attention records so nothing falls through the cracks.
export function mergeProblems(records = [], needs = null) {
  const out = [];
  const coveredAbout = new Set();
  const byId = new Map((records || []).map((r) => [r?.id, r]));
  for (const item of needs?.items || []) {
    if (item?.about) coveredAbout.add(item.about);
    if (item?.record) coveredAbout.add(item.record);  // the hub's own record, said once (iPad, 1 Nov: Pi listed twice)
    out.push({
      kind: "need",
      id: item.id || item.title,
      title: item.title || "Needs attention",
      detail: item.detail || "",
      tone: item.tone === "bad" ? "bad" : "warn",
      about: item.about || "",
      since: item.since || byId.get(item.record)?.since || null,  // the record it stands for knows since when
      act: item.act || null,
      link: typeof item.link === "string" ? item.link : "",
    });
  }
  for (const r of records) {
    if (!r || (r.severity !== "problem" && r.severity !== "attention")) continue;
    if (coveredAbout.has(r.id)) continue;
    out.push({
      kind: "record",
      id: `rec:${r.id}`,
      recordId: r.id,
      title: recordTitle(r),
      detail: r.cause || "",
      tone: recordTone(r.severity),
      about: r.id,
      since: r.since || null,
      actions: actionNames(r.actions),
      fix: FIX_MAP[r.id] || null,
      href: RECORD_PATHS[r.id] || "/system",
    });
  }
  return out;
}

// What the Home tab's badge counts: the whole Problems list. `undefined` while Needs you hasn't been asked, so the badge
// waits instead of flashing a count that then changes.
export function problemsBadge(needs, probs = []) {
  if (needs === undefined) return undefined;
  return { ...(needs || { items: [], unread: [] }), count: probs.length };
}

// Build the unified ⌘K command bar items for a query, given current records and needs.
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
    { label: "Control room (Now / Problems / Recent)", href: "/next", badge: "Page", keywords: "control room next now problems timeline stream" },
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
    { label: "Movie storage & Drives", href: "/drives", badge: "Page", keywords: "drives storage usb disk movies" },
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

function readLastSeen() {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function writeLastSeen(ts) {
  try {
    localStorage.setItem(SEEN_KEY, String(Math.floor(ts)));
  } catch {}
}

function navigateSpa(href) {
  const a = document.createElement("a");
  a.href = href;
  a.setAttribute("data-link", "true");
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Home's printer: the one big thing on the page. The readout, the camera beside it, and the printer's own buttons.
function renderPrinterHero(r, state, onReload) {
  const m = printerNow(r);
  const tone = recordTone(r.severity);
  const actionsWrap = h("div", { class: "cr-item-actions" });
  const btns = m.actions.length ? printerButtons({ actions: m.actions, state: r.state }, onReload) : null;
  if (btns) actionsWrap.append(btns);
  if (m.lab) actionsWrap.append(h("a", { class: "action", href: printLabUrl(m.lab), "data-link": true }, `Print lab: ${m.lab}`));
  actionsWrap.append(h("a", { class: "action ghost", href: RECORD_PATHS.printer || "/workshop", "data-link": true }, "Open Workshop"));

  const cam = state.cameraOk && m.running
    ? h("button", { type: "button", class: "cr-hero-cam", "aria-label": "Enlarge the printer camera", onclick: () => state.openCamera?.() },
      h("img", { class: "cr-hero-cam-img", src: `/api/camera.jpg?t=${Date.now()}`, alt: "", loading: "eager" }))
    : null;

  return h("li", { class: "cr-hero", dataset: { thing: r.id, tone, cam: cam ? "true" : "false" } },
    h("div", { class: "cr-hero-main" },
      h("p", { class: "cr-hero-name" },
        h("span", { class: "dot", dataset: { tone }, "aria-hidden": "true" }),
        h("strong", {}, RECORD_LABELS.printer),
        m.word ? h("span", { class: "meta" }, m.word) : null),
      h("p", { class: "cr-hero-readout", dataset: { long: m.pct === null ? "true" : "false" } }, m.readout),
      m.pct !== null
        ? h("div", { class: "cr-hero-bar", role: "progressbar", "aria-label": "Print progress", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(m.pct) },
          h("span", { style: `width:${m.pct}%` }))
        : null,
      m.facts.length ? h("ul", { class: "cr-hero-facts" }, m.facts.map((f) => h("li", {}, f))) : null,
      m.cause ? h("p", { class: "meta" }, m.cause) : null,
      actionsWrap),
    cam);
}

function renderActiveItem(r, state, onReload) {
  if (r.id === "printer" && state.homeMode) return renderPrinterHero(r, state, onReload);
  const name = RECORD_LABELS[r.id] || r.id;
  const href = RECORD_PATHS[r.id] || "/";
  const metaParts = [];
  if (r.id === "printer") metaParts.push(...printerNow(r).facts);
  if (r.cause) metaParts.push(r.cause);

  const actionsWrap = h("div", { class: "cr-item-actions" });
  const names = actionNames(r.actions);
  if (r.id === "printer" && names.length) {
    const btns = printerButtons({ actions: names, state: r.state }, onReload);
    if (btns) actionsWrap.append(btns);
  }
  const lab = r.id === "printer" ? printerNow(r).lab : "";
  if (lab) actionsWrap.append(h("a", { class: "action", href: printLabUrl(lab), "data-link": true }, `Print lab: ${lab}`));
  actionsWrap.append(h("a", { class: "action ghost", href, "data-link": true }, `Open ${name}`));

  return h("li", { class: "log-row cr-now-row", dataset: { thing: r.id } },
    h("span", { class: "dot", dataset: { tone: recordTone(r.severity) }, "aria-hidden": "true" }),
    h("div", { class: "log-main" },
      h("div", { class: "cr-row-head" },
        h("strong", {}, name),
        h("span", { class: "pill", dataset: { tone: recordTone(r.severity) } }, r.headline || r.state)),
      r.id === "printer" && Number.isFinite(d.progress)
        ? h("div", { class: "meter meter--ok", style: "margin: .35rem 0;" },
          h("div", { class: "meter-bar", style: `--pct:${Math.max(0, Math.min(100, d.progress))}` }))
        : null,
      metaParts.length ? h("span", { class: "meta" }, metaParts.join(" · ")) : null,
      actionsWrap));
}

function renderProblemRow(p, state, onReload) {
  const actButtons = [];
  if (p.kind === "need" && !p.act && p.link) {
    // Without its own action a need still opens where it is dealt with (the lab's judging page, Settings, Help).
    const resolved = resolveLink(p.link);
    const external = /^https?:\/\//i.test(resolved) && !resolved.startsWith(location.origin);
    actButtons.push(h("a", {
      class: "action ghost",
      href: resolved,
      ...(external ? { target: "_blank", rel: "noopener" } : { "data-link": true }),
    }, /[?&]do=judge\b/.test(p.link) ? "Judge" : "Open"));
  } else if (p.kind === "need" && p.act) {
    if (p.act.href) {
      const resolved = resolveLink(p.act.href);
      const external = /^https?:\/\//i.test(resolved) && !resolved.startsWith(location.origin);
      actButtons.push(h("a", {
        class: "btn btn--primary",
        href: resolved,
        ...(external ? { target: "_blank", rel: "noopener" } : { "data-link": true }),
      }, p.act.label || "Open"));
    } else if (p.act.printer) {
      const btn = h("button", { type: "button", class: "btn btn--primary" }, p.act.label || "Run");
      btn.addEventListener("click", () => runPrinterAction(p.act.printer, [btn], onReload));
      actButtons.push(btn);
    } else if (p.act.fix) {
      const btn = h("button", { type: "button", class: "btn btn--primary" }, p.act.label || "Fix it");
      btn.addEventListener("click", () => fix(p.act.fix, p.act.label || "Fix it", { onResult: () => onReload() }));
      actButtons.push(btn);
    }
  } else if (p.kind === "record") {
    if (p.actions?.includes("clear")) {
      const btn = h("button", { type: "button", class: "btn btn--primary" }, "Clear the plate");
      btn.addEventListener("click", () => runPrinterAction("clear", [btn], onReload));
      actButtons.push(btn);
    }
    if (p.fix) {
      const btn = h("button", { type: "button", class: "btn ghost" }, p.fix.label);
      btn.addEventListener("click", () => fix(p.fix.name, p.fix.label, { onResult: () => onReload() }));
      actButtons.push(btn);
    }
    if (p.href) {
      actButtons.push(h("a", { class: "action ghost", href: p.href, "data-link": true }, "Inspect"));
    }
  }

  return h("li", { class: "log-row cr-problem-row", dataset: { tone: p.tone } },
    h("span", { class: "dot", dataset: { tone: p.tone }, "aria-hidden": "true" }),
    h("div", { class: "log-main" },
      h("strong", {}, p.title),
      p.detail ? h("span", { class: "meta" }, p.detail) : null,
      p.since ? h("span", { class: "meta" }, `Since ${shortWhen(p.since)}`) : null),
    actButtons.length ? h("div", { class: "cr-row-side" }, ...actButtons) : null);
}

function renderControlRoom(state) {
  const records = state.records || [];
  const needs = state.needs;
  const events = state.events || [];
  const reload = () => loadControlRoom(state, state.needs);

  // 1. NOW. On Home the printer leads it (renderPrinterHero), so active things come first and the calm rest folds away.
  const home = !!state.homeMode;
  const { active, calm } = splitNowRecords(records);
  const calmLine = calmSummaryText(calm);
  const ordered = [...active.filter((r) => r.id === "printer"), ...active.filter((r) => r.id !== "printer")];
  state.nowSec.replaceChildren(
    card("Now", { cls: "wide cr-now" },
      !state.recordsAnswered
        ? h("p", { class: "cr-quiet-lead", "aria-live": "polite" }, "Checking the house…")
        : ordered.length
          ? h("ul", { class: "log cr-list" }, ordered.map((r) => renderActiveItem(r, state, reload)))
          : h("p", { class: "cr-quiet-lead" }, state.recordsFailed && !records.length
            ? "The hub's live status didn't answer. It will keep trying."
            : "Nothing is printing or playing right now."),
      calm.length
        ? h("details", { class: "cr-calm-details" },
          h("summary", { class: "cr-calm-summary" },
            h("span", { class: "dot", dataset: { tone: "ok" }, "aria-hidden": "true" }),
            h("span", {}, calmLine)),
          h("ul", { class: "status-list cr-calm-grid" },
            calm.map((r) => h("li", {},
              h("span", { class: "dot", dataset: { tone: "ok" }, "aria-hidden": "true" }),
              h("a", { href: RECORD_PATHS[r.id] || "/", "data-link": true }, h("strong", {}, RECORD_LABELS[r.id] || r.id)),
              h("span", { class: "status-side meta" }, r.headline || r.state)))))
        : null)
  );

  // 2. NEEDS YOU: one list, one name (platform K6). Home hides it when it's empty (platform 5.5).
  const probs = mergeProblems(records, needs);
  state.probSec.hidden = home && state.recordsAnswered && !probs.length;
  state.probSec.replaceChildren(
    card("Needs you", {
      cls: "wide",
      pill: probs.length ? `${probs.length} need${probs.length === 1 ? "s" : ""} you` : "All clear",
      tone: probs.some((p) => p.tone === "bad") ? "bad" : probs.length ? "warn" : "ok",
    },
      probs.length
        ? h("ul", { class: "log cr-list" }, probs.map((p) => renderProblemRow(p, state, reload)))
        : empty("No problems or waiting tasks across the house."))
  );

  // 3. SINCE YOU LAST LOOKED
  const unseen = state.lastSeen > 0 ? events.filter((e) => (e.ts || 0) > state.lastSeen) : events;
  const shownEvents = state.showAllEvents ? events : (unseen.length ? unseen : events.slice(0, 8));
  const pillText = unseen.length
    ? `${unseen.length} new since ${shortWhen(state.lastSeen)}`
    : events.length ? "Up to date" : "Quiet";

  const listed = shownEvents.slice(0, 20);
  const fresh = markNew(listed, state.lastSeen);
  const sinceBody = [
      listed.length
        ? h("ul", { class: "log cr-list" },
          listed.map((ev, i) => {
            const isNew = fresh[i];
            const tone = recordTone(ev.severity);
            const href = RECORD_PATHS[ev.thing] || "/";
            // A timeline: the time first, then what changed, the dot marking anything that went wrong.
            return h("li", { class: "log-row cr-since-row", dataset: { new: isNew ? "true" : "false", tone } },
              h("span", { class: "cr-since-when" }, shortWhen(ev.ts)),
              h("span", { class: "log-main" },
                h("a", { href, "data-link": true }, h("strong", {}, ev.label || RECORD_LABELS[ev.thing] || ev.thing)),
                h("span", { class: "meta" }, ev.headline || `${ev.old ? `${ev.old} → ` : ""}${ev.new}`),
                ev.cause ? h("span", { class: "meta" }, ev.cause) : null),
              tone === "ok" ? null : h("span", { class: "dot", dataset: { tone }, "aria-label": tone === "bad" ? "Problem" : "Needs a look" }));
          }))
        : empty("No state changes logged yet."),
      h("div", { class: "cr-foot-actions", style: "display: flex; gap: .5rem; margin-top: .75rem; flex-wrap: wrap;" },
        unseen.length
          ? h("button", {
            type: "button",
            class: "btn ghost",
            onclick: () => {
              const nowSec = Math.floor(Date.now() / 1000);
              state.lastSeen = nowSec;
              writeLastSeen(nowSec);
              renderControlRoom(state);
            },
          }, "Mark all seen")
          : null,
        events.length > 8
          ? h("button", {
            type: "button",
            class: "btn ghost",
            onclick: () => {
              state.showAllEvents = !state.showAllEvents;
              renderControlRoom(state);
            },
          }, state.showAllEvents ? "Show fewer" : `Show all (${Math.min(events.length, 20)})`)
          : null,
        h("a", { class: "action ghost", href: "/alerts", "data-link": true }, "Full alert history"))];
  // On Home it starts collapsed to one line with its count, and the line is its only heading; it keeps whatever the
  // owner last chose until they leave.
  if (home) {
    const box = h("details", { class: "cr-since-details" },
      h("summary", { class: "cr-since-summary" }, h("strong", {}, "Since you last looked"), h("span", { class: "meta" }, pillText)),
      h("section", { class: "card wide cr-since-card", "aria-label": "Since you last looked" }, ...sinceBody));
    box.open = !!state.sinceOpen;
    box.addEventListener("toggle", () => { state.sinceOpen = box.open; });
    state.sinceSec.replaceChildren(box);
  } else {
    state.sinceSec.replaceChildren(card("Since you last looked", { cls: "wide", pill: pillText, tone: "ok" }, ...sinceBody));
  }
  if (typeof state.onProblems === "function") state.onProblems(probs);

  state.facts = probs.length
    ? `${probs.length} problem${probs.length === 1 ? "" : "s"}: ${probs.map((p) => p.title).slice(0, 3).join("; ")}`
    : active.length
      ? active.map((r) => `${RECORD_LABELS[r.id] || r.id}: ${r.headline}`).join("; ")
      : "All systems OK";
}

// The control room's sections inside `parent`, with a live record stream. Home and the /next page both use it.
export function mountControlRoom(state, parent, { search = true } = {}) {
  state.records = [];
  state.needs = null;
  state.events = [];
  state.streamLive = false;
  state.lastSeen = readLastSeen();
  if (!state.lastSeen) {
    state.lastSeen = Math.floor(Date.now() / 1000) - 6 * 3600;
  }

  const searchTrigger = h("button", {
    type: "button",
    class: "cr-command-bar",
    onclick: () => window.openHubCommandPalette?.(),
    "aria-label": "Search or run a command (Command K)",
  },
    h("span", { class: "cr-command-placeholder" }, "Search records, jump to a page, run a fix, or ask Assistant…"),
    h("kbd", {}, "⌘K"));

  state.nowSec = h("div");
  state.probSec = h("div");
  state.sinceSec = h("div");

  state.recordsAnswered = false;
  // Now → Needs you → Since you last looked (control-room C5, platform 5.5).
  parent.append(...(search ? [searchTrigger] : []), state.nowSec, state.probSec, state.sinceSec);

  // Open SSE stream to /api/records/stream for real-time updates without waiting for poll
  if (typeof EventSource !== "undefined") {
    try {
      const es = new EventSource("/api/records/stream");
      state.es = es;
      es.addEventListener("snapshot", (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (Array.isArray(data.records)) {
            state.records = data.records;
            state.recordsAnswered = true;
            state.streamLive = true;
            renderControlRoom(state);
          }
        } catch {}
      });
      es.addEventListener("change", (ev) => {
        try {
          const ch = JSON.parse(ev.data);
          if (ch?.record) {
            const idx = state.records.findIndex((r) => r.id === ch.record.id);
            if (idx >= 0) state.records[idx] = ch.record;
            else state.records.push(ch.record);
            state.events = [{
              ts: ch.ts || Math.floor(Date.now() / 1000),
              thing: ch.id,
              label: RECORD_LABELS[ch.id] || ch.id,
              old: ch.old,
              new: ch.new,
              severity: ch.severity,
              headline: ch.headline || "",
              cause: ch.cause || "",
            }, ...(state.events || [])].slice(0, 40);
            state.streamLive = true;
            renderControlRoom(state);
          }
        } catch {}
      });
      es.onerror = () => {
        state.streamLive = false;
      };
    } catch {}
  }
}

export function mount(state) {
  mountControlRoom(state, state.root);
}

export function leaveControlRoom(state) {
  if (state.es) {
    try { state.es.close(); } catch {}
    state.es = null;
  }
  writeLastSeen(Math.floor(Date.now() / 1000));
}

export function leave(state) {
  leaveControlRoom(state);
}

// `needs` given (Home already asked for it): only the records are fetched here.
export async function loadControlRoom(state, needs) {
  let recData, needsData;
  try {
    [recData, needsData] = await Promise.all([
      api("/api/records"),
      needs === undefined ? settle(api("/api/needs"), 6000, null) : Promise.resolve(needs),
    ]);
  } catch (err) {
    // Now says so instead of "Checking the house…" for ever; the last records (if any) stay on screen.
    state.recordsAnswered = true;
    state.recordsFailed = true;
    renderControlRoom(state);
    throw err;
  }
  if (Array.isArray(recData?.records)) state.records = recData.records;
  if (Array.isArray(recData?.events)) state.events = recData.events;
  state.recordsAnswered = true;
  state.recordsFailed = false;
  state.needs = keepNeeds(needs, needsData, state.needs);
  renderControlRoom(state);
}

// Needs you after the records answer. Home passes null ("not known yet") and hands Needs you over by itself; when the
// records answer after that hand-over, the null must not wipe it (1 Nov: Problems fell back to records only and lost
// the print lab's ask whenever /api/records was the slower request).
export function keepNeeds(passed, fetched, current) {
  return passed === null && current ? current : fetched;
}

// Home hands over Needs you when it answers, without fetching the records again.
export function setControlNeeds(state, needs) {
  state.needs = needs;
  if (state.probSec) renderControlRoom(state);
}

export async function load(state) {
  await loadControlRoom(state);
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
