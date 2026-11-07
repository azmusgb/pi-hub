// Workshop › Printer (workshop flow W.2), top to bottom: Now (the band and the camera), Needs you here, Filament loaded,
// This week, More in the workshop (filament, history, projects, the lab queue) and one "Open in" row. The touchscreen's
// pairing is in Settings and its state, with the assistant's, on Health (W.1).
import { api, clockTime, duration, empty, ensure, h, settle, when, whoami } from "./core.js";
import { jobTitle, telemetryAge, telemetryLabel, tempText } from "./now.js";
import { faceplate, faceplateLoading } from "./page-parts.js";
import { printLabUrl, resolveLink, sourceDown, toolPath } from "./sections.js";
import { firstFew, openInRow } from "./section-links.js";
import { printErrorCode, printLabText, printSeconds, printWords, weekPill } from "./wording.js";
import { printerActionList, printerBusy, printerButtons, runPrinterAction } from "./printer-actions.js";

export const every = 15;

// The sections under "More in the workshop": native <details>, closed until this viewer opens one.
export const MORE = [
  ["filament", "Filament"],
  ["history", "Print history"],
  ["queue", "Bambuddy's queue"],
  ["projects", "Projects"],
  ["lab", "Print lab & queue"],
];

// Which of them this viewer keeps open, in this browser. Storage can be missing, blocked or hold junk: then all are
// closed and nothing breaks.
const OPEN_KEY = "hub-workshop-more";
function storage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readOpen(store = storage()) {
  try {
    const v = JSON.parse(store?.getItem(OPEN_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function writeOpen(key, open, store = storage()) {
  try {
    store?.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(store), [key]: !!open }));
  } catch { /* not remembered this time */ }
}

export function mount(state) {
  // One line when Bambuddy is down, instead of the same sentence on every section that reads from it.
  state.sourceNotice = h("div", { role: "status" });
  // Loading: the faceplate's shape in skeletons (A7 P8), so nothing jumps when the first answer lands.
  state.bandBox = h("div", { class: "ws-band" }, faceplateLoading("Bambu X2D"));
  const now = h("div", { class: "ws-now" }, state.bandBox);
  state.now = now;
  state.needs = section("needs", "Needs you here");
  state.needs.hidden = true;
  state.materials = section("materials", "Filament loaded", h("div", { class: "skeleton ws-skel-line" }));
  state.week = section("week", "This week", h("div", { class: "skeleton ws-skel-line" }));
  state.more = {};
  const opened = readOpen();
  const more = h("section", { class: "ws-section ws-more", "aria-labelledby": "ws-more-title" },
    h("h2", { class: "section-title", id: "ws-more-title" }, "More in the workshop"),
    ...MORE.map(([key, title]) => {
      const pill = h("span", { class: "pill", hidden: true });
      const body = h("div", { class: "ws-more-body" });
      const el = h("details", { class: "ws-more-item", id: `ws-${key}` },
        h("summary", {}, h("span", { class: "ws-more-title" }, title), pill), body);
      el.open = opened[key] === true;
      el.addEventListener("toggle", () => writeOpen(key, el.open));
      state.more[key] = { el, pill, body };
      return el;
    }));
  state.root.append(state.sourceNotice, now, state.needs, state.materials, state.week, more, openInRow("workshop"));
  // A new frame every 2 seconds while this page is open and visible.
  state.camTimer = setInterval(() => {
    const img = state.root.querySelector(".cam-img");
    if (img && !document.hidden) img.src = `/api/camera.jpg?t=${Date.now()}`;
  }, 2000);
  if (typeof EventSource !== "undefined") {
    try {
      const es = new EventSource("/api/records/stream");
      state.es = es;
      es.addEventListener("change", (ev) => {
        try {
          const ch = JSON.parse(ev.data);
          if (ch?.id === "printer") load(state);
        } catch {}
      });
    } catch {}
  }
}

export function leave(state) {
  clearInterval(state.camTimer);
  if (state.es) {
    try { state.es.close(); } catch {}
    state.es = null;
  }
}

function section(key, title, ...body) {
  return h("section", { class: `ws-section ws-${key}`, "aria-labelledby": `ws-${key}-title` },
    h("h2", { class: "section-title", id: `ws-${key}-title` }, title), ...body);
}

// The camera, as the faceplate's aside (A7 P1: "aside: camera, if any"). With no picture it says why, in words.
export function cameraAside(c) {
  if (!c?.ok) {
    // The camera's own reason says the most: its video switched off (common after the printer restarts) or the
    // printer not answering. Either way it is the camera that's unavailable; the faceplate says what the printer is doing.
    const why = c?.reason === "liveview_off"
      ? ["The X2D isn't sharing its camera on the network. On the printer's screen, turn on ", h("strong", {}, "LAN Only Liveview"),
        " (Settings › Network). The picture comes back here within a minute."]
      : c?.reason === "printer_unreachable" ? ["The camera isn't answering on the network. The printer may be restarting."]
      : null;
    const tips = [];
    if (c?.sources?.Pi && !c.sources.Pi.up) tips.push("the Pi's camera link isn't getting pictures");
    if (c?.sources?.MacBook && !c.sources.MacBook.fresh) tips.push("the MacBook is asleep or Bambu Studio's live view is closed");
    return h("div", { class: "ws-cam ws-cam--none" },
      h("p", { class: "ws-cam-word" }, "Camera unavailable"),
      why ? h("p", {}, ...why) : null,
      h("p", { class: "meta" }, tips.length ? `No picture: ${tips.join(", and ")}.` : "No picture from the camera right now."));
  }
  return h("figure", { class: "ws-cam" },
    h("img", { class: "cam-img", src: `/api/camera.jpg?t=${Date.now()}`, alt: "The X2D's camera, updated every 2 seconds", width: 384, height: 216 }),
    h("figcaption", { class: "meta" }, c.source === "MacBook"
      ? "From the MacBook (backup). For a picture without the Mac, turn on LAN Only Liveview on the printer's screen."
      : c.source === "Pi" ? "From the Pi" : "Live"));
}

const STATE_LAMP = { printing: "ok", paused: "warn", error: "bad", stopped: "ok", idle: "ok", offline: "bad" };
const STATE_WORD = { printing: "Printing", paused: "Paused", error: "Needs a look", stopped: "Stopped", idle: "Idle", offline: "Offline" };

// The printer as the faceplate (A7 P1), pure so it is tested without a page. A printer no source answers for is
// unknown, never idle; a stale source keeps its last readings and says so. A heater with no target shows one number
// (decision 6).
export function printerPlate(p, cam, { lastPrint = null, actions = null } = {}) {
  p ||= {};
  const tel = telemetryLabel(p);
  const busy = p.state === "printing" || p.state === "paused";
  const pct = Number.isFinite(Number(p.progress)) ? Math.max(0, Math.min(100, Number(p.progress))) : null;
  // Stale: the notice above the page says the source isn't answering; the lamp says only what these readings are.
  const lamp = tel.stale || p.stale ? ["unknown", "Last readings"] : tel.state === "none" ? ["unknown", tel.label]
    : STATE_LAMP[p.state] ? [STATE_LAMP[p.state], STATE_WORD[p.state], p.state === "printing"] : ["unknown", "No status"];
  const job = jobTitle(p.job_name);
  const finish = p.state === "printing" && Number.isFinite(p.minutes_left)
    ? new Date(Date.now() + p.minutes_left * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const caption = p.state === "printing" && p.left ? `Done in about ${p.left}${finish ? `, around ${finish}` : ""}.` : p.detail || null;
  const t = p.telemetry || {};
  const layer = busy && p.layer_num != null ? `${p.layer_num}${p.total_layers ? ` / ${p.total_layers}` : ""}` : null;
  return faceplate({
    name: "Bambu X2D", lamp,
    // Idle or stopped, the lamp already says it: no readout repeats it, and the last job is the "Last print" line.
    readout: busy && pct !== null ? String(pct) : null, unit: busy && pct !== null ? "%" : "",
    caption,
    readings: [["Print", busy ? job || null : null], ["Layer", layer], ["Nozzle", tempText(p.nozzle_temp, p.nozzle_target)],
      ["Bed", tempText(p.bed_temp, p.bed_target)], ["AMS", p.ams_humidity != null ? `${p.ams_humidity}% RH` : null],
      ["Material", p.filament_type || null]],
    extra: [
      busy && pct !== null ? h("div", { class: "line", role: "progressbar", "aria-label": "Print progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct },
        h("div", { class: "line-track" }), h("div", { class: "line-bead", style: `width:${pct}%` })) : null,
      h("p", { class: "meta ws-freshness", title: tel.why }, `${t.source || "Pi Hub"} · ${telemetryAge(t.observed_at, t.status === "stale")}`),
      lastPrint ? h("p", { class: "meta ws-last-print" }, lastPrint) : null,
    ],
    actions: actions ? [actions] : [],
    aside: cameraAside(cam),
  });
}

// One row per print: outcome, length, the printer's error code with a help link, and the filament it used.
// A lab print's history link: its experiment in its own project (the print name carries both).
export function printLabHref(p) {
  return p?.lab ? printLabUrl(p.lab.exp, p.lab.project) : null;
}

function printRow(p) {
  const [label, tone] = printWords(p);
  const used = p.grams ? `${Math.round(p.grams)} g of filament` + (p.cost ? `, $${p.cost.toFixed(2)}` : "") : null;
  const photo = p.has_photo ? h("a", {
    href: `/api/prints/${p.id}/photo.jpg`,
    target: "_blank",
    rel: "noopener",
    class: "print-photo-link",
    title: "View completed print photo"
  },
    h("img", {
      src: `/api/prints/${p.id}/photo.jpg`,
      class: "print-photo-thumb",
      alt: "Completed print photo",
      width: 48,
      height: 27,
      loading: "lazy"
    })
  ) : null;
  const row = h("li", { class: "log-row print-row" },
    h("span", { class: "dot", dataset: { tone } }),
    h("span", { class: "log-main" }, h("strong", {}, label),
      h("span", { class: "meta" }, p.name),
      h("span", { class: "meta" }, when(p.started)),
      p.lab ? h("a", { class: "meta", href: printLabHref(p), "data-link": true }, printLabText(p))
        : h("span", { class: "meta" }, printLabText(p)),
      !p.error ? null : printErrorCode(p.error)
        ? h("a", { class: "meta", href: `https://e.bambulab.com/query.php?lang=en&e=${encodeURIComponent(printErrorCode(p.error))}`, target: "_blank", rel: "noopener" }, `What ${p.error} means`)
        : h("span", { class: "meta" }, p.error),
      used ? h("span", { class: "meta" }, used) : null),
    h("span", { class: "log-side" }, photo, p.status === "printing" ? "Printing now" : printSeconds(p) ? duration(printSeconds(p)) : ""));
  return row;
}

// Bambuddy (its registry address) holds the spools and projects and takes each print's filament off by itself;
// the hub only shows them and links there to change anything.
export const bambuddyUrl = (path) => toolPath("bambuddy", path);

// Bambuddy didn't answer the hub: its print log or its spools are missing from /api/workshop.
export const bambuddyDown = (d) => d?.prints_available === false || d?.spools === null;
const WAITING = "Shown again when Bambuddy answers.";

// The one Bambuddy notice, as a small state machine so a live region speaks only on a change: going down is said once,
// coming back is said once ("answering again"), and the render after that clears it without a word. `seen` (seconds) is
// when the printer's record was last read, when the page knows it.
export function nextSourceNotice(prev, down, seen = null) {
  const since = Number.isFinite(seen) ? ` · last seen ${clockTime(seen)}` : "";
  if (down) return { state: "down", text: `${sourceDown("Bambuddy")}${since}. Print history and spools show again when it answers.`, changed: prev !== "down" };
  if (prev === "down") return { state: "recovered", text: "Bambuddy is answering again.", changed: true };
  return { state: "up", text: "", changed: prev === "recovered" };
}

// While Bambuddy is down the notice says so once; its sections carry no pill of their own.
export function cardPills(d) {
  const down = bambuddyDown(d);
  return { history: down ? null : weekPill(d.week), filament: down ? null : undefined };
}

// What the page shows, from /api/workshop, the viewer's role and what this page last saw from Bambuddy (`last`, kept
// while it answers, so its sections can show the last known with its age when it doesn't). Null until the first answer.
export function workshopView(d, { role = "none", last = null } = {}) {
  if (!d || !d.printer) return null;
  const p = d.printer;
  const owner = role === "owner";
  const down = bambuddyDown(d);
  const actions = Array.isArray(p.actions) ? p.actions : [];
  const labNeeds = Array.isArray(d.lab?.needs) ? d.lab.needs : [];
  const needs = [];
  // Clear the plate has one control: here, first, for the owner. The band keeps pause and resume.
  if (actions.includes("clear")) {
    needs.push({ kind: "clear", title: ["stopped", "finished"].includes(p.state) ? "Done: clear the plate" : "Clear the plate",
      detail: "Check the plate is empty: Bambuddy may start the next print in the queue.", action: owner ? "clear" : null });
  }
  for (const n of labNeeds.slice(0, 3)) {
    const judge = n.action === "Judge the print";
    needs.push({ kind: "lab", id: n.id, title: `${n.id}: ${n.action}`,
      detail: n.judge_on ? `Look at: ${n.judge_on}` : n.question_text || "",
      href: owner ? printLabUrl(n.id, n.project, judge ? "judge" : "") : null, label: judge ? `Judge ${n.id}` : n.action,
      verb: LAB_VERBS[n.action] || "" });
  }
  const prints = Array.isArray(d.prints) ? d.prints : [];
  const latest = prints.find((x) => x.status !== "printing");
  const spools = Array.isArray(d.spools) ? d.spools : null;
  const age = down && last ? last.at : null;
  return {
    down,
    owner,
    needs,
    signIn: !owner && (actions.length > 0 || labNeeds.length > 0),
    bandActions: owner ? actions.filter((a) => a !== "clear") : [],
    lastPrint: p.state === "idle" && latest ? `Last print: ${latest.name}, ${printWords(latest)[0]}, ${when(latest.started)}` : null,
    // Trays read from a stale printer record are last known, not current: left out rather than shown as now.
    materials: down ? null : { trays: !p.stale && Array.isArray(d.ams_trays) ? d.ams_trays : [], low: (spools || []).filter((s) => s.low) },
    week: down || !d.week ? null : weekLine(d.week),
    seen: down && p.stale && known(p.as_of) ? p.as_of : null,
    history: { prints: d.prints_available === false ? last?.prints ?? null : prints, asOf: d.prints_available === false ? age : null },
    spools: { list: spools ?? last?.spools ?? null, asOf: spools ? null : age },
  };
}

// A colour from Bambuddy or the AMS goes into an inline style only as hex (#RGB, #RRGGBB or #RRGGBBAA; the AMS sends it
// without the #); anything else is a neutral grey.
export function safeColour(c) {
  const v = typeof c === "string" ? c.trim().replace(/^(?!#)/, "#") : "";
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : "#888";
}

const known = (n) => typeof n === "number" && Number.isFinite(n);

// This week in one line: the pill's count, and the hours when Bambuddy gave them.
function weekLine(week) {
  return `${weekPill(week).pill}${known(week.hours) ? ` · ${week.hours} h printing` : ""}`;
}

// A low spool in a few words, leaving out what Bambuddy didn't say.
function lowSpoolText(s) {
  const name = [s.colour, s.material].filter(Boolean).join(" ") || "A spool";
  return known(s.grams_left) ? `${name}: ${s.grams_left} g left` : `${name} running low`;
}

function lastKnown(asOf) {
  return asOf ? h("p", { class: "note" }, `Last known, from ${when(asOf)}.`) : null;
}

// A lab step's own words are the kit's verb phrases (A7 P2): the action says what it does, never "Open" alone.
const LAB_VERBS = { "Judge the print": "judge_it", "Approve or drop": "approve", "Send it to the printer": "send", "Fix the plan": "fix_plan" };

// The kit's Needs-you list, the same as Home's (A7 P2). Clear the plate is done here, so its row has the button, not a link.
function needsList(state, v) {
  const items = v.needs.map((n) => n.kind === "clear"
    ? { id: "clear", source: "Pi Hub", tone: "attention", title: n.title, detail: n.detail }
    : { id: `lab-${n.id}`, source: "Pi Hub", tone: "attention", title: n.title, detail: n.detail,
      link: n.href || undefined, action: n.href && n.verb ? { key: n.verb, link: n.href } : undefined });
  const list = ApplianceNeeds.renderList(items, { resolve: resolveLink, here: new URL(location.href), self: "Pi Hub" });
  v.needs.forEach((n, i) => {
    const li = list.children[i];
    if (!li) return;
    li.dataset.key = n.kind === "clear" ? "clear-need" : `lab-${n.id}`;
    // The checklist can run to a paragraph: two lines here (the whole of it on hover and in Print lab).
    const detail = li.querySelector(".ui-need__detail");
    if (detail && n.detail) { detail.classList.add("clamp-2"); detail.title = n.detail; }
    if (n.kind === "clear" && n.action) li.firstChild.append(clearButton(state));
  });
  return [list,
    v.signIn ? h("p", { class: "meta" }, "Only the owner can act on these. ",
      h("button", { type: "button", class: "ghost small", dataset: { key: "sign-in" }, onclick: async () => { if (await ensure("owner")) load(state); } }, "Sign in")) : null];
}

function clearButton(state) {
  // Made disabled while an action is running, so a redraw mid-action can't offer a second tap.
  const b = h("button", { type: "button", class: "btn btn--primary lab-need-act", dataset: { key: "clear" }, disabled: printerBusy() }, "Clear the plate");
  b.addEventListener("click", () => runPrinterAction("clear", [b], () => load(state)));
  return b;
}

function openMore(state, key) {
  const m = state.more[key];
  if (!m) return;
  m.el.open = true;
  m.el.querySelector("summary")?.focus();
  m.el.scrollIntoView?.({ block: "start" });
}

function setPill(m, text, tone) {
  m.pill.hidden = !text;
  m.pill.textContent = text || "";
  m.pill.dataset.tone = tone || "";
}

function trayPill(t) {
  return h("span", { class: "pill ws-tray" },
    h("span", { class: "swatch", style: `background:${safeColour(t.color)}`, "aria-hidden": "true" }),
    `AMS ${t.slot}: ${t.type || "Unknown"}${known(t.remain) && t.remain >= 0 ? ` (${t.remain}%)` : ""}`);
}

function shelf(spools, printer = null) {
  if (spools === null) return [h("p", { class: "meta" }, WAITING)];
  const low = spools.filter((s) => s.low);
  const activePrint = printer && ["printing", "paused"].includes(printer.state);
  const shortfallBanner = low.length && activePrint
    ? h("div", { class: "callout callout--warn", style: "margin-bottom: .75rem;" },
      h("span", {}, `Spool shortfall check: ${low.map((s) => (known(s.grams_left) ? `${s.colour || "A spool"} (${s.grams_left} g)` : s.colour || "A spool")).join(", ")} running low while the X2D is active.`))
    : null;
  const rows = spools.map((s) => {
    const pct = known(s.grams_left) && s.grams_total ? Math.round((s.grams_left / s.grams_total) * 100) : 0;
    return h("li", { class: "spool", dataset: { low: String(s.low) } },
      h("span", { class: "swatch", style: `background:${safeColour(s.hex)}`, "aria-hidden": "true" }),
      h("span", { class: "spool-main" }, h("strong", {}, s.colour || "Unnamed spool"), h("span", { class: "meta" }, [s.material, s.brand].filter(Boolean).join(", "))),
      // An unweighed spool's amount is unknown: no bar rather than a full green one.
      h("span", { class: "spool-left" }, s.measured ? h("span", { class: "meter" }, h("i", { style: `width:${pct}%`, dataset: { tone: s.low ? "bad" : pct < 35 ? "warn" : "ok" } })) : null,
        h("span", { class: "grams" }, s.measured && known(s.grams_left) ? `${s.grams_left} g` : "not weighed")));
  });
  return [shortfallBanner,
    rows.length ? h("ul", { class: "spools" }, rows) : empty("No spools in Bambuddy yet."),
    h("p", { class: "meta" }, "From Bambuddy, which takes each print's filament off its spool. You get a phone alert when one runs low."),
    h("a", { class: "action", href: bambuddyUrl("/inventory"), target: "_blank", rel: "noopener" }, "Add or change spools in Bambuddy ↗")];
}

// The lab queue: what is running and the open questions. Anything waiting on you is already in Needs you here.
function labQueue(labData) {
  const open = h("a", { class: "action", href: "/lab", "data-link": true }, "Open Print lab");
  if (!labData) {
    return [h("p", { class: "meta" }, "Settings, and cancelling or reordering the print queue, live in Bambuddy; coupon experiments live in Print lab."), open];
  }
  const needs = Array.isArray(labData.needs) ? labData.needs : [];
  const active = Array.isArray(labData.active) ? labData.active : [];
  const questions = Array.isArray(labData.questions) ? labData.questions : [];
  return [
    needs.length ? h("p", { class: "meta" }, `${needs.length} waiting on you, in Needs you here above.`) : null,
    active.length
      ? h("ul", { class: "log" }, active.slice(0, 2).map((e) => h("li", { class: "log-row" },
        h("span", { class: "dot", dataset: { tone: "ok" }, "aria-hidden": "true" }),
        h("span", { class: "log-main" },
          h("strong", {}, `${e.id} · ${e.status}`),
          e.question_text ? h("span", { class: "meta" }, e.question_text) : null))))
      : questions.length
        ? h("p", { class: "meta" }, `${questions[0].id}: ${questions[0].question} (${questions[0].answered}/${questions[0].total} answered)`)
        : needs.length ? null : h("p", { class: "meta" }, "All Print lab experiments are up to date on the Pi."),
    open];
}

function labPill(labData) {
  const needs = Array.isArray(labData?.needs) ? labData.needs.length : 0;
  const active = Array.isArray(labData?.active) ? labData.active.length : 0;
  return needs ? [`${needs} need${needs === 1 ? "s" : ""} you`, "warn"] : active ? [`${active} active`, "ok"] : [null];
}

// What Bambuddy's print queue still holds. An item waiting with a reason (the printer refused the file) retries by
// itself and starts the print when it works, so it says so; the owner can cancel it in Bambuddy's queue.
export function queueWords(it) {
  if (it.status === "printing") return "Printing";
  return it.waiting ? "Waiting" : "Next up";
}

export function queuePill(items) {
  if (!Array.isArray(items) || !items.length) return [null];
  const waiting = items.filter((i) => i.status === "pending" && i.waiting).length;
  return waiting ? [`${waiting} waiting`, "warn"] : [`${items.length} in the queue`, "ok"];
}

function queueBody(items) {
  const rows = items.map((it) => h("li", { class: "log-row" },
    h("span", { class: "dot", dataset: { tone: it.status === "pending" && it.waiting ? "warn" : "ok" }, "aria-hidden": "true" }),
    h("span", { class: "log-main" },
      h("strong", {}, it.name),
      h("span", { class: "meta" }, [queueWords(it), it.since ? `queued ${when(it.since)}` : null].filter(Boolean).join(" · ")),
      it.waiting ? h("span", { class: "meta" }, `${it.waiting} If it retries and works, the print starts then, so keep the plate clear.`) : null)));
  return [h("ul", { class: "log" }, rows),
    h("a", { class: "action", href: bambuddyUrl("/queue"), target: "_blank", rel: "noopener" }, "Cancel or reorder in Bambuddy ↗")];
}

function projectsBody(projects) {
  // Only reached while the rest of Bambuddy answers (else this section is hidden): projects alone didn't load.
  if (projects === null) return [h("p", { class: "meta" }, "Projects didn't load this time; the next check tries again.")];
  return [projects.length
    ? h("ul", { class: "log" }, projects.map((p) => h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone: "ok" } }),
      h("span", { class: "log-main" },
        h("a", { href: bambuddyUrl(`/projects/${p.id}`), target: "_blank", rel: "noopener" }, h("strong", {}, p.name)),
        p.description ? h("span", { class: "meta" }, p.description) : null),
      h("span", { class: "log-side" }, p.prints ? `${p.prints} print${p.prints === 1 ? "" : "s"}` : "No prints yet"))))
    : empty("No projects in Bambuddy yet."),
  h("a", { class: "action", href: bambuddyUrl("/projects"), target: "_blank", rel: "noopener" }, "Plan projects in Bambuddy ↗")];
}

// Redraw one part of the page only when what it shows has changed (the page reloads every 15 s and on each printer
// event), and put keyboard focus back on the same control, by its data-key, when it has.
function redraw(state, name, el, sig, draw) {
  state.sigs ||= {};
  if (state.sigs[name] === sig) return;
  state.sigs[name] = sig;
  const active = globalThis.document?.activeElement;
  const key = active && el.contains(active) ? active.dataset?.key : null;
  draw();
  if (key && !el.contains(globalThis.document.activeElement)) el.querySelector(`[data-key="${key}"]`)?.focus();
}

// The sources line at the foot of the page (A7 P1, P8): Bambuddy by the printer card's telemetry, in the phrase table's
// words when it isn't answering, and the camera.
export function workshopSources(printer, cam) {
  const status = printer?.telemetry?.status;
  const bambuddy = status === "live" ? { name: "Bambuddy", tone: "ok" }
    : status === "degraded" ? { name: "Bambuddy", tone: "warn", word: "not connected; the Pi's readings" }
      : { name: "Bambuddy", tone: "bad", word: "isn't answering" };
  return [bambuddy, cam?.ok ? { name: "Camera", tone: "ok" } : { name: "Camera", tone: "unknown", word: "unavailable" }];
}

export async function load(state) {
  // Only the workshop status is required; the camera and Bambuddy's projects get 6 s each, and the role falls back to
  // read-only.
  const [d, cam, pr, me] = await Promise.all([api("/api/workshop"), settle(api("/api/camera"), 6000, { ok: false }),
    settle(api("/api/projects"), 6000, { available: false }), settle(whoami(), 6000, { role: "none" })]);
  const v = workshopView(d, { role: me?.role, last: state.last });
  if (!v) throw new Error("The workshop status came back empty.");
  if (!v.down) state.last = { prints: d.prints, spools: d.spools, week: d.week, at: Date.now() / 1000 };
  const busy = printerBusy();

  // Now: the faceplate (with pause or resume for the owner, under the readings they act on) and the camera beside it.
  // While Bambuddy is down the notice above says so, with when it was last seen; the faceplate doesn't say it again.
  const shown = v.down && d.printer.stale ? { ...d.printer, detail: "" } : d.printer;
  // Its readings change while printing; its "checked" age is redrawn at least once a minute.
  const camSig = [cam.ok, cam.source, cam.reason];
  redraw(state, "band", state.bandBox, JSON.stringify([shown, v.bandActions, v.lastPrint, busy, camSig, Math.floor(Date.now() / 60000)]), () => {
    const buttons = printerButtons({ ...d.printer, actions: v.bandActions }, () => load(state));
    const listed = printerActionList({ actions: v.bandActions });
    buttons?.querySelectorAll("button").forEach((b, i) => { b.dataset.key = `printer-${listed[i]?.action}`; });
    state.bandBox.replaceChildren(printerPlate(shown, cam, { lastPrint: v.lastPrint, actions: buttons }));
  });
  state.facts = d.printer.headline;
  const notice = nextSourceNotice(state.notice, v.down, v.seen);
  state.notice = notice.state;
  state.sources = workshopSources(d.printer, cam);
  if (notice.changed) state.sourceNotice.replaceChildren(...(notice.text ? [h("p", {
    class: `callout ${notice.state === "down" ? "callout--warn" : "callout--ok"} source-down` }, notice.text)] : []));

  // Needs you here: only when something waits, never an empty section.
  state.needs.hidden = !v.needs.length;
  redraw(state, "needs", state.needs, JSON.stringify([v.needs, v.signIn, busy]), () =>
    state.needs.replaceChildren(state.needs.firstChild, ...(v.needs.length ? needsList(state, v).filter(Boolean) : [])));

  // Filament loaded and This week: one line each. While Bambuddy is down they have nothing current, and the notice covers it.
  const heading = (el) => el.firstChild;
  state.materials.hidden = !v.materials;
  state.week.hidden = !v.materials;
  if (v.materials) {
    redraw(state, "materials", state.materials, JSON.stringify(v.materials), () =>
      state.materials.replaceChildren(heading(state.materials), h("div", { class: "ws-line" },
        ...v.materials.trays.map(trayPill),
        ...v.materials.low.map((s) => h("span", { class: "pill", dataset: { tone: "bad" } }, lowSpoolText(s))),
        v.materials.trays.length || v.materials.low.length ? null : h("span", { class: "meta" }, "No spool running low."),
        h("button", { type: "button", class: "ghost small", dataset: { key: "all-spools" }, onclick: () => openMore(state, "filament") }, "All spools"))));
    redraw(state, "week", state.week, JSON.stringify(v.week), () =>
      state.week.replaceChildren(heading(state.week), h("div", { class: "ws-line" },
        h("span", {}, v.week || "No prints logged this week."),
        h("button", { type: "button", class: "ghost small", dataset: { key: "history" }, onclick: () => openMore(state, "history") }, "Print history"))));
  }

  // More in the workshop. A section with nothing known while Bambuddy is down is hidden rather than repeating the notice.
  const m = d.filament_month || {};
  const { filament, history, queue, projects, lab } = state.more;
  filament.el.hidden = v.down && v.spools.list === null;
  setPill(filament, v.down ? null : v.materials.low.length ? `${v.materials.low.length} running low` : null, "bad");
  redraw(state, "filament", filament.body, JSON.stringify([v.spools, d.printer.state, filament.el.hidden]), () =>
    filament.body.replaceChildren(...(filament.el.hidden ? [] : [lastKnown(v.spools.asOf), ...shelf(v.spools.list, d.printer)].filter(Boolean))));
  history.el.hidden = v.down && v.history.prints === null;
  const pills = cardPills(d);
  setPill(history, pills.history?.pill, pills.history?.tone);
  redraw(state, "history", history.body, JSON.stringify([v.history, d.week, m, history.el.hidden]), () => {
    if (history.el.hidden) return history.body.replaceChildren();
    const rows = (v.history.prints || []).map((p) => printRow(p));
    history.body.replaceChildren(...[
      lastKnown(v.history.asOf),
      ...(v.history.prints === null ? [h("p", { class: "meta" }, WAITING)]
        : rows.length ? firstFew(rows, { n: 5, noun: "prints" }) : [empty("Prints show up here once Bambuddy has logged one.")]),
      d.week && known(d.week.hours) ? h("p", { class: "meta" }, `${d.week.hours} hours of printing in the last 7 days.` +
        (m.prints_logged && known(m.grams) ? ` Last 30 days: ${(m.grams / 1000).toFixed(2)} kg of filament${known(m.cost) && m.cost ? `, about $${m.cost.toFixed(2)}` : ""}.` : "")) : null,
    ].filter(Boolean));
  });
  // The queue shows only while something is in it; an item waiting for the printer opens it once, because it may
  // start a print on its own.
  const items = Array.isArray(d.queue) ? d.queue : null;
  queue.el.hidden = !items || !items.length;
  setPill(queue, ...queuePill(items));
  if (items?.some((i) => i.status === "pending" && i.waiting) && !state.queueSeen) { state.queueSeen = true; queue.el.open = true; }
  if (!items?.length) state.queueSeen = false;
  redraw(state, "queue", queue.body, JSON.stringify([items, queue.el.hidden]), () =>
    queue.body.replaceChildren(...(queue.el.hidden ? [] : queueBody(items))));
  const list = pr.available ? pr.projects || [] : null;
  projects.el.hidden = v.down && list === null;
  setPill(projects, list?.length ? `${list.length} active` : null, "ok");
  redraw(state, "projects", projects.body, JSON.stringify([list, projects.el.hidden]), () =>
    projects.body.replaceChildren(...(projects.el.hidden ? [] : projectsBody(list))));
  setPill(lab, ...labPill(d.lab));
  redraw(state, "lab", lab.body, JSON.stringify(d.lab ?? null), () => lab.body.replaceChildren(...labQueue(d.lab).filter(Boolean)));
}

// The workshop status didn't answer: the faceplate says so, as unknown, instead of a skeleton that never settles (P8).
export function failed(state) {
  state.sigs = { ...(state.sigs || {}), band: null };
  state.bandBox.replaceChildren(faceplate({ name: "Bambu X2D", lamp: ["unknown", "No answer"], readout: "—",
    caption: "The hub's workshop status didn't answer. This page tries again in 15 seconds." }));
}

