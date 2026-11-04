// Workshop › Printer (workshop flow W.2), top to bottom: Now (the band and the camera), Needs you here, Materials,
// This week, More in the workshop (filament, history, projects, the lab queue) and one "Open in" row. The touchscreen's
// pairing is in Settings and its state, with the assistant's, on Health (W.1).
import { api, card, clockTime, duration, empty, ensure, h, settle, when, whoami } from "./core.js";
import { band } from "./now.js";
import { printLabUrl, sourceDown, toolPath } from "./sections.js";
import { firstFew, openInRow } from "./section-links.js";
import { printErrorCode, printLabText, printSeconds, printWords, weekPill } from "./wording.js";
import { printerActionList, printerBusy, printerButtons, runPrinterAction } from "./printer-actions.js";

export const every = 15;

// The sections under "More in the workshop": native <details>, closed until this viewer opens one.
export const MORE = [
  ["filament", "Filament"],
  ["history", "Print history"],
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
  state.sources = h("div", { role: "status" });
  // Loading: a band and a camera of their final size, so nothing jumps when the first answer lands.
  state.bandBox = h("div", { class: "ws-band" },
    h("div", { class: "band ws-skeleton", "aria-busy": "true" },
      h("span", { class: "sr" }, "Loading the printer…"),
      h("div", { class: "skeleton ws-skel-line", style: "width: 30%" }),
      h("div", { class: "skeleton ws-skel-head" }),
      h("div", { class: "skeleton ws-skel-line" })));
  state.cam = h("div", { class: "ws-cam" }, h("section", { class: "card wide", "aria-hidden": "true" },
    h("div", { class: "skeleton ws-skel-head", style: "width: 30%" }), h("div", { class: "skeleton ws-skel-line", style: "width: 25%" }),
    h("div", { class: "ws-cam-placeholder" })));
  const now = h("div", { class: "ws-now" }, state.bandBox, state.cam);
  state.now = now;
  state.needs = section("needs", "Needs you here");
  state.needs.hidden = true;
  state.materials = section("materials", "Materials", h("div", { class: "skeleton ws-skel-line" }));
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
  state.root.append(state.sources, now, state.needs, state.materials, state.week, more, openInRow("workshop"));
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

function camera(c) {
  const src = c.source === "Pi" ? "From the Pi" : c.source === "MacBook" ? "From the MacBook (backup)" : null;
  if (!c.ok) {
    // The camera's own reason says the most: its video switched off (common after the printer restarts) or the
    // printer not answering. Either way it is the camera that's unavailable; the band says what the printer is doing.
    const why = c.reason === "liveview_off"
      ? ["The X2D isn't sharing its camera on the network. On the printer's screen, turn on ", h("strong", {}, "LAN Only Liveview"),
        " (Settings › Network). The picture comes back here within a minute."]
      : c.reason === "printer_unreachable" ? ["The camera isn't answering on the network. The printer may be restarting."]
      : null;
    const tips = [];
    if (c.sources?.Pi && !c.sources.Pi.up) tips.push("the Pi's camera link isn't getting pictures");
    if (c.sources?.MacBook && !c.sources.MacBook.fresh) tips.push("the MacBook is asleep or Bambu Studio's live view is closed");
    return card("Camera", { cls: "wide", pill: "Camera unavailable", tone: "warn" },
      why ? h("p", {}, ...why) : null,
      h("p", { class: "meta" }, tips.length ? `No picture: ${tips.join(", and ")}.` : "No picture from the camera right now."));
  }
  const hint = c.source === "MacBook"
    ? h("p", { class: "meta", style: "margin-top: .5rem;" }, "Streaming via MacBook bridge. For direct streaming without the Mac, enable LAN Only Liveview on the printer screen.")
    : null;
  return card("Camera", { cls: "wide", pill: src, tone: c.source === "Pi" ? "ok" : "warn" },
    h("img", { class: "cam-img", src: `/api/camera.jpg?t=${Date.now()}`, alt: "The X2D's camera, updated every 2 seconds", width: 384, height: 216 }),
    hint);
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
      href: owner ? printLabUrl(n.id, n.project, judge ? "judge" : "") : null, label: judge ? `Judge ${n.id}` : "Open" });
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
    camFirst: ["printing", "paused"].includes(p.state),
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

function needsList(state, v) {
  const rows = v.needs.map((n) => h("li", { class: "log-row lab-need" },
    h("span", { class: "dot", dataset: { tone: "warn" }, "aria-hidden": "true" }),
    h("span", { class: "log-main" },
      h("strong", {}, n.title),
      // The checklist can run to a paragraph: two lines here (the whole of it on hover and in Print lab).
      n.detail ? h("span", { class: "meta clamp-2", title: n.detail }, n.detail) : null,
      n.kind === "clear" && n.action ? clearButton(state)
        : n.href ? h("a", { class: "btn btn--primary lab-need-act", href: n.href, "data-link": true, dataset: { key: `lab-${n.id}` } }, n.label) : null)));
  return [h("ul", { class: "log" }, rows),
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
    return [h("p", { class: "meta" }, "Spools, projects and the print queue live in Bambuddy; coupon experiments live in Print lab."), open];
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

export async function load(state) {
  // Only the workshop status is required; the camera and Bambuddy's projects get 6 s each, and the role falls back to
  // read-only.
  const [d, cam, pr, me] = await Promise.all([api("/api/workshop"), settle(api("/api/camera"), 6000, { ok: false }),
    settle(api("/api/projects"), 6000, { available: false }), settle(whoami(), 6000, { role: "none" })]);
  const v = workshopView(d, { role: me?.role, last: state.last });
  if (!v) throw new Error("The workshop status came back empty.");
  if (!v.down) state.last = { prints: d.prints, spools: d.spools, week: d.week, at: Date.now() / 1000 };
  const busy = printerBusy();

  // Now: the band (with pause or resume for the owner, under the readings they act on) and the camera. While Bambuddy
  // is down the notice above says so, with when it was last seen; the band doesn't say it again.
  const shown = v.down && d.printer.stale ? { ...d.printer, detail: "" } : d.printer;
  // Its readings change while printing; its "checked" age is redrawn at least once a minute.
  redraw(state, "band", state.bandBox, JSON.stringify([shown, v.bandActions, v.lastPrint, busy, Math.floor(Date.now() / 60000)]), () => {
    const printerBand = band(shown);
    const buttons = printerButtons({ ...d.printer, actions: v.bandActions }, () => load(state));
    const listed = printerActionList({ actions: v.bandActions });
    buttons?.querySelectorAll("button").forEach((b, i) => { b.dataset.key = `printer-${listed[i]?.action}`; });
    const info = printerBand.querySelector(".band-info") || printerBand;
    if (v.lastPrint) info.append(h("p", { class: "meta ws-last-print" }, v.lastPrint));
    if (buttons) info.append(buttons);
    state.bandBox.replaceChildren(printerBand);
  });
  state.facts = d.printer.headline;
  state.now.dataset.camFirst = String(v.camFirst);
  if (state.camOk !== cam.ok || state.camSource !== cam.source || state.camReason !== cam.reason) {
    state.cam.replaceChildren(camera(cam));
    state.camOk = cam.ok; state.camSource = cam.source; state.camReason = cam.reason;
  }
  const notice = nextSourceNotice(state.notice, v.down, v.seen);
  state.notice = notice.state;
  if (notice.changed) state.sources.replaceChildren(...(notice.text ? [h("p", {
    class: `callout ${notice.state === "down" ? "callout--warn" : "callout--ok"} source-down` }, notice.text)] : []));

  // Needs you here: only when something waits, never an empty section.
  state.needs.hidden = !v.needs.length;
  redraw(state, "needs", state.needs, JSON.stringify([v.needs, v.signIn, busy]), () =>
    state.needs.replaceChildren(state.needs.firstChild, ...(v.needs.length ? needsList(state, v).filter(Boolean) : [])));

  // Materials and This week: one line each. While Bambuddy is down they have nothing current, and the notice covers it.
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
  const { filament, history, projects, lab } = state.more;
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
  const list = pr.available ? pr.projects || [] : null;
  projects.el.hidden = v.down && list === null;
  setPill(projects, list?.length ? `${list.length} active` : null, "ok");
  redraw(state, "projects", projects.body, JSON.stringify([list, projects.el.hidden]), () =>
    projects.body.replaceChildren(...(projects.el.hidden ? [] : projectsBody(list))));
  setPill(lab, ...labPill(d.lab));
  redraw(state, "lab", lab.body, JSON.stringify(d.lab ?? null), () => lab.body.replaceChildren(...labQueue(d.lab).filter(Boolean)));
}
