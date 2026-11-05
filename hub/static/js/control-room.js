// The records' shared helpers: labels and pages, the Needs you list merged from /api/needs and the records, and its
// kit rendering. Home's control room (Now, Since you last looked) gave way to the dashboard (amendment A8,
// home-dashboard.js); what it used and still matters lives here.
import { duration, fix, h } from "./core.js";
import { runPrinterAction } from "./printer-actions.js";
import { resolveLink } from "./sections.js";

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
  mac_lab: "Print lab on the Mac",
  // Each deploy's release record (releases.py TARGETS), named as the server names it, never "release:pi-hub".
  "release:pi-hub": "Pi Hub deploy",
  "release:localai": "Local AI deploy",
  "release:firmware": "Display firmware deploy",
  "release:netmon": "netmon deploy",
  "release:mac-watch": "Mac watchdog deploy",
  "release:x2d-bridge-mac": "Mac camera bridge deploy",
  "release:print-lab": "Print lab deploy",
};

export const RECORD_PATHS = {
  printer: "/workshop",
  obico: "/workshop",
  hms: "/workshop",
  camera: "/workshop",
  workshop_display: "/system",
  pc: "/system",
  local_ai: "/system",
  pi: "/system",
  movies_drive: "/drives",
  movie_copy: "/drives",
  internet: "/network",
  adguard: "/network",
  backups: "/backups",
  plex: "/media",
  devices: "/devices",
  paper_printer: "/print",
  weather: "/weather",
  hub: "/system",
  pc_printing: "/workshop",
  mac_lab: "/lab",
};

// Ids made from a prefix (releases.py adds release:<target>) and the page for a record nobody listed: the same as the
// server's now.HREF and issue_from (tests/test_need_links.py checks both sides agree).
export const RECORD_PREFIX_PATHS = {
  "release:": "/versions",
};
export const RECORD_FALLBACK = "/system";

export function recordPath(id) {
  const key = String(id || "");
  if (RECORD_PATHS[key]) return RECORD_PATHS[key];
  const prefix = Object.keys(RECORD_PREFIX_PATHS).find((p) => key.startsWith(p));
  return prefix ? RECORD_PREFIX_PATHS[prefix] : RECORD_FALLBACK;
}

const FIX_MAP = {
  plex: { name: "restart:plex", label: "Restart Plex" },
  devices: { name: "restart:homebridge", label: "Restart Homebridge" },
  movies_drive: { name: "remount:movies", label: "Remount the movies drive" },
  movie_copy: { name: "mirror:movies", label: "Copy new movies from the PC" },
};


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
    // The printer record carries the lab print as {experiment, project} (sources.lab_printing).
    lab: d.lab?.experiment || d.lab_experiment || "",
    labProject: d.lab?.project || "",
  };
}

// "Ad blocking: Ad blocking is off" says the name twice: a headline that already starts with the name stands alone.
export function recordTitle(r) {
  const label = RECORD_LABELS[r.id] || r.id;
  const said = r.headline || r.state || "";
  return said.toLowerCase().startsWith(label.toLowerCase()) ? said : `${label}: ${said}`;
}

// A record left in this state on purpose is not a Need: it shows on its system's row with the way to undo it
// (amendment A8 D2). The Home badge counts the same list, so the two agree (baseline 5.5).
export const DELIBERATE = { adguard: ["paused"] };

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
      kitTone: ["bad", "attention", "warn"].includes(item.tone) ? item.tone : "warn",
      about: item.about || "",
      since: item.since || byId.get(item.record)?.since || null,  // the record it stands for knows since when
      as_of: typeof item.as_of === "string" ? item.as_of : "",
      source: item.source || "",
      action: item.action && typeof item.action.key === "string" ? item.action : null,
      link: typeof item.link === "string" ? item.link : "",
    });
  }
  for (const r of records) {
    if (!r || (r.severity !== "problem" && r.severity !== "attention")) continue;
    if (DELIBERATE[r.id]?.includes(r.state)) continue;
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
      href: recordPath(r.id),
    });
  }
  return out;
}

// A record's page, opened by its verb (the same table as the server's needs.PAGE_VERB). A page with no verb yet gets
// none: its row is the link, with no words, never "Open" or "Inspect" alone (A7 P2).
const PAGE_VERB = { "/workshop": "open_printer", "/network": "open_network" };

// The Problems list as the kit's Needs you items (ApplianceNeeds.renderList): title, detail, "since … · area" and a verb.
export function problemItems(probs = []) {
  return probs.map((p) => {
    const iso = Number(p.since) > 0 ? new Date(p.since * 1000).toISOString() : undefined;
    if (p.kind === "need") {
      return { id: p.id, tone: p.kitTone || p.tone, title: p.title, detail: p.detail, link: p.link || undefined,
        action: p.action || undefined, as_of: p.as_of || iso, area: p.source && p.source !== "Pi Hub" ? p.source : undefined };
    }
    const verb = PAGE_VERB[p.href];
    return { id: p.id, tone: p.tone === "bad" ? "bad" : "attention", title: p.title, detail: p.detail,
      link: p.href || undefined, action: verb ? { key: verb, link: p.href } : undefined, as_of: iso };
  });
}

// What the Home tab's badge counts: the whole Problems list. `undefined` while Needs you hasn't been asked, so the badge
// waits instead of flashing a count that then changes.
export function problemsBadge(needs, probs = []) {
  if (needs === undefined) return undefined;
  return { ...(needs || { items: [], unread: [] }), count: probs.length };
}

export function navigateSpa(href) {
  const a = document.createElement("a");
  a.href = href;
  a.setAttribute("data-link", "true");
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// The buttons a row keeps beside its link: Clear the plate, and the record's own fix (Remount the drive, …).
function problemButtons(p, onReload) {
  const out = [];
  if (p.kind === "record" && p.actions?.includes("clear")) {
    const btn = h("button", { type: "button", class: "btn btn--primary" }, "Clear the plate");
    btn.addEventListener("click", () => runPrinterAction("clear", [btn], onReload));
    out.push(btn);
  }
  if (p.kind === "record" && p.fix) {
    const btn = h("button", { type: "button", class: "btn ghost" }, p.fix.label);
    btn.addEventListener("click", () => fix(p.fix.name, p.fix.label, { trigger: btn, onResult: () => onReload() }));
    out.push(btn);
  }
  return out;
}

// The kit draws the list (one Needs you everywhere, A7 P2); same-origin links go through the SPA router.
export function renderProblems(probs, onReload) {
  const list = ApplianceNeeds.renderList(problemItems(probs), { resolve: resolveLink, here: new URL(location.href), self: "Pi Hub" });
  for (const a of list.querySelectorAll("a")) if (a.origin === location.origin) a.setAttribute("data-link", "");
  probs.forEach((p, i) => {
    const li = list.children[i], btns = problemButtons(p, onReload);
    if (!li) return;
    li.dataset.key = p.id;
    if (btns.length) li.append(h("div", { class: "ui-need__buttons" }, ...btns));
  });
  return list;
}
