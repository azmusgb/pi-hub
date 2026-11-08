// Workshop › Printer (workshop flow W.2), top to bottom: Now (the band and the camera), Needs you here, Filament loaded,
// This week, More in the workshop (filament, history, projects, the lab queue) and one "Open in" row. The touchscreen's
// pairing is in Settings and its state, with the assistant's, on Health (W.1).
import { api, askFirst, clockTime, duration, empty, ensure, h, settle, when, whoami } from "./core.js";
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
  // The camera aside lives across redraws of the band, so a live Room view isn't restarted by every new reading.
  // The view part is redrawn; the settings panel (A18) beside it is kept, so an edit and its open state survive.
  state.camView = h("div", { class: "ws-cam-view" });
  makeSettings(state);
  state.camBox = h("div", { class: "ws-cam-box" }, state.camView, state.set.el);
  state.camPref = readCamPref();
  state.live = { on: false, note: "" };
  state.left = false;
  // One status line for the live notes, kept across redraws so a screen reader hears each new note.
  state.camNote = h("p", { class: "meta ws-cam-note", role: "status" });
  // A new still every 2 seconds while this page is open and visible; a live picture is never swapped.
  state.camTimer = setInterval(() => {
    if (document.hidden) return;
    for (const img of state.root.querySelectorAll("img[data-refresh]")) {
      if (img.classList.contains("room-img")) refreshRoomStill(state, img);
      else img.src = `${img.dataset.refresh}?t=${Date.now()}`;
    }
  }, 2000);
  // Live stops when the page is hidden (A17 R4), and says so.
  state.onHidden = () => { if (document.hidden && state.live.on) stopLive(state, LIVE_HIDDEN); };
  document.addEventListener("visibilitychange", state.onHidden);
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
  state.left = true;
  clearInterval(state.camTimer);
  stopLive(state, "", false);
  document.removeEventListener("visibilitychange", state.onHidden);
  if (state.roomUrl) URL.revokeObjectURL?.(state.roomUrl);
  state.roomUrl = null;
  if (state.es) {
    try { state.es.close(); } catch {}
    state.es = null;
  }
}

function section(key, title, ...body) {
  return h("section", { class: `ws-section ws-${key}`, "aria-labelledby": `ws-${key}-title` },
    h("h2", { class: "section-title", id: `ws-${key}-title` }, title), ...body);
}

// The printer camera's reason in a few words, for the Room view's stand-in line and the "No camera" state.
function printerCamWhy(c) {
  return c?.reason === "liveview_off" ? "LAN Only Liveview is off on the printer"
    : c?.reason === "printer_unreachable" ? "the printer isn't answering on the network" : "no picture from it right now";
}

// The printer camera, or why there is no picture (A7 P1: "aside: camera, if any"), in words.
function printerCam(c) {
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
    h("img", { class: "cam-img", src: `/api/camera.jpg?t=${Date.now()}`, dataset: { refresh: "/api/camera.jpg" },
      alt: "The X2D's camera, updated every 2 seconds", width: 384, height: 216 }),
    h("figcaption", { class: "meta" }, c.source === "MacBook"
      ? "From the MacBook (backup). For a picture without the Mac, turn on LAN Only Liveview on the printer's screen."
      : c.source === "Pi" ? "Through the Pi" : "Live"));
}

// The Room view (amendment A17): the Pi's own camera, a fixed view of the printer from outside. It is always "Room
// view", never "the camera" (R1). The printer camera stays first; the Room view is the second view to switch to (R2)
// and stands in, saying why, when the printer camera is out (R3). A still every 2 seconds, live on request (R4).
export const ROOM_WORDS = {
  not_detected: "The Pi's camera isn't detected. Check its ribbon cable.",
  capture_failed: "The Pi's camera isn't giving pictures right now.",
  busy: "Live is busy: four people are already watching.",
};
export const LIVE_PAUSED = "Live paused after 5 minutes.";
export const LIVE_HIDDEN = "Live paused while this page was in the background.";
export const LIVE_MS = 5 * 60 * 1000;

const CAM_KEY = "hub-workshop-camera";
export function readCamPref(store = storage()) {
  try { return store?.getItem(CAM_KEY) === "room" ? "room" : "printer"; } catch { return "printer"; }
}
export function writeCamPref(view, store = storage()) {
  try { store?.setItem(CAM_KEY, view === "room" ? "room" : "printer"); } catch { /* not remembered this time */ }
}

// Which view the aside shows. `room` is /api/camera/room's state, or null when there is none to show (not signed in,
// or the hub didn't answer): then the aside is exactly the printer camera, as before A17.
export function cameraChoice(cam, room, pref) {
  if (!room) return { view: "printer", switcher: false, standIn: false };
  if (cam?.ok) return { view: pref === "room" ? "room" : "printer", switcher: true, standIn: false };
  return room.state !== "unavailable" ? { view: "room", switcher: false, standIn: true } : { view: "none", switcher: false, standIn: false };
}

function roomCam(room, { live = {}, standIn = false, cam = null, onLive = null } = {}) {
  if (room.state === "unavailable") {
    return h("div", { class: "ws-cam ws-cam--none" }, h("p", { class: "ws-cam-word" }, "Room view unavailable"),
      h("p", {}, ROOM_WORDS[room.reason] || ROOM_WORDS.capture_failed));
  }
  const turn = room.rotate === 90 || room.rotate === 270 ? ` ws-cam--turn${room.rotate}` : "";
  // The live preset's shape (A18 plan decision 5): 4:3 for Data saver and Clear, 16:9 for Sharp.
  const [w, hgt] = Array.isArray(room.size) && room.size[0] > 0 && room.size[1] > 0 ? room.size : [4, 3];
  const img = live.on
    ? h("img", { class: "cam-img room-img", src: `/api/camera/room/live?t=${Date.now()}`, alt: "Room view of the printer, live", width: 384, height: 288 })
    : h("img", { class: "cam-img room-img", src: `/api/camera/room.jpg?t=${Date.now()}`, dataset: { refresh: "/api/camera/room.jpg" },
      alt: "Room view of the printer, from the Pi, updated every 2 seconds", width: 384, height: 288 });
  return h("figure", { class: `ws-cam ws-cam--room${turn}`, style: `--w: ${Number(w)}; --h: ${Number(hgt)}` },
    h("div", { class: "ws-cam-frame" }, img),
    h("figcaption", { class: "meta" }, standIn ? `Room view. The printer's camera is unavailable: ${printerCamWhy(cam)}.`
      : live.on ? "Room view, live from the Pi." : "Room view, from the Pi. A new picture every 2 seconds."),
    h("p", { class: "meta ws-cam-age", hidden: true }),
    h("div", { class: "ws-cam-live" },
      h("button", { type: "button", class: "ghost small", dataset: { key: "room-live" }, onclick: onLive }, live.on ? "Stop live" : "Watch live")));
}

// The faceplate's aside: the printer camera, the Room view, or why there is neither. `opts.room` absent keeps the
// aside as it was before A17.
export function cameraAside(c, { room = null, pref = "printer", live = {}, onPick = null, onLive = null } = {}) {
  const choice = cameraChoice(c, room, pref);
  const body = choice.view === "printer" ? printerCam(c)
    : choice.view === "room" ? roomCam(room, { live, standIn: choice.standIn, cam: c, onLive })
      : h("div", { class: "ws-cam ws-cam--none" }, h("p", { class: "ws-cam-word" }, "No camera"),
        h("p", {}, `The printer's camera is unavailable: ${printerCamWhy(c)}.`),
        h("p", {}, ROOM_WORDS[room.reason] || ROOM_WORDS.capture_failed));
  if (!choice.switcher) return body;
  const pick = (view, label) => h("button", { type: "button", class: "seg-btn", "aria-pressed": String(choice.view === view),
    dataset: { key: `cam-${view}` }, onclick: () => onPick?.(view) }, label);
  return h("div", { class: "ws-cam-wrap" },
    h("div", { class: "seg ws-cam-switch", role: "group", "aria-label": "Camera view" },
      pick("printer", "Printer camera"), pick("room", "Room view")), body);
}

// ---- Camera settings (amendment A18): the owner sets the Room view's camera ----
// The form is drawn from the hub's own table of controls (GET /api/camera/room/settings), so nothing here repeats
// a range or a choice. One Apply restarts the camera once; nothing restarts while a slider moves.

export const SETTINGS_WORDS = {
  loading: "Loading the camera's settings…",
  noAnswer: "The hub didn't answer, so the camera's settings can't be shown. This page tries again in 15 seconds.",
  edited: "Not applied yet.",
  applying: "Applying…",
  applied: "Applied.",
  reset: "Every setting is back to its default.",
  busy: "The camera is still applying the last change.",
  signIn: "Sign in as the owner to change the camera.",
  failedSend: "The hub didn't answer. Nothing changed.",
  captureFailed: "The Pi's camera isn't giving pictures right now. Reset to defaults puts every setting back, in case one caused it.",
  notDetected: "The Pi's camera isn't detected. Check its ribbon cable. Settings can be changed once it's back.",
  resetAsk: "Every camera setting goes back to its default, including Turn. The picture restarts.",
};

function shownValue(c, v) {
  const n = Number(v);
  return `${Number.isFinite(n) ? Number(n.toFixed(2)) : v}${c.unit ? ` ${c.unit}` : ""}`;
}

// One control, as a native input with a visible label and a place for the hub's reason if it refuses the value.
function settingField(c, value, onInput) {
  const id = `set-${c.key}`;
  const err = h("p", { class: "ws-set-err", id: `${id}-err`, hidden: true });
  const common = { id, dataset: { key: id, field: c.key }, "aria-describedby": `${id}-err` };
  if (c.kind === "switch") {
    const box = h("input", { ...common, type: "checkbox", checked: value === true });
    box.addEventListener("change", () => onInput(c.key, box.checked === true));
    return h("div", { class: "ws-set-field ws-set-field--switch", dataset: { field: c.key } }, box, h("label", { for: id }, c.label), err);
  }
  if (c.kind === "choice") {
    const sel = h("select", common, ...(c.options || []).map((o) =>
      h("option", { value: String(o.value), selected: o.value === value }, o.label)));
    sel.addEventListener("change", () => {
      const o = (c.options || []).find((x) => String(x.value) === String(sel.value));
      if (o) onInput(c.key, o.value);
    });
    // A label that only repeats its group's heading ("Live quality") is kept for screen readers, not shown twice.
    return h("div", { class: "ws-set-field", dataset: { field: c.key } },
      h("label", { for: id, class: c.label === c.group ? "sr" : null }, c.label), sel, err);
  }
  const out = h("output", { for: id, class: "ws-set-value" }, shownValue(c, value));
  const range = h("input", { ...common, type: "range", min: String(c.min), max: String(c.max), step: String(c.step), value: String(value) });
  range.addEventListener("input", () => {
    const n = Number(range.value);
    if (Number.isFinite(n)) onInput(c.key, n);
  });
  return h("div", { class: "ws-set-field", dataset: { field: c.key } }, h("label", { for: id }, c.label, " ", out), range, err);
}

// The groups, in the hub's order (A18 C2): Orientation, Framing, Light, Colour, Detail, Live quality.
export function settingsFields(controls, draft, onInput = () => {}) {
  const groups = new Map();
  for (const c of Array.isArray(controls) ? controls : []) {
    if (!c?.key || !c.group) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(settingField(c, draft?.[c.key] ?? c.default, onInput));
  }
  return [...groups].map(([name, fields]) => h("fieldset", { class: "ws-set-group" }, h("legend", {}, name), ...fields));
}

function makeSettings(state) {
  const set = { model: null, draft: null, applying: false, failed: false, loading: false, message: "", refused: null };
  state.set = set;
  set.body = h("div", { class: "ws-set-body" });
  set.note = h("p", { class: "meta ws-set-note", role: "status", tabindex: "-1" });
  set.apply = h("button", { type: "button", class: "primary small", dataset: { key: "cam-apply" } }, "Apply");
  set.apply.addEventListener("click", () => sendSettings(state, "apply"));
  set.reset = h("button", { type: "button", class: "ghost small", dataset: { key: "cam-reset" } }, "Reset to defaults");
  set.reset.addEventListener("click", async () => {
    if (set.applying || !set.model) return;
    if (await askFirst(set.reset, SETTINGS_WORDS.resetAsk, { confirm: "Reset" })) sendSettings(state, "reset");
  });
  set.el = h("details", { class: "ws-set", hidden: true }, h("summary", { dataset: { key: "cam-settings" } }, "Camera settings"),
    h("div", { class: "ws-set-inner" }, set.body, h("div", { class: "ws-set-actions" }, set.apply, set.reset), set.note));
}

async function loadSettings(state) {
  const set = state.set;
  if (set.loading) return;
  set.loading = true;
  const got = await settle(api("/api/camera/room/settings"), 6000, null);
  set.loading = false;
  if (state.left) return;
  if (got?.settings && Array.isArray(got.controls)) {
    set.model = got;
    set.draft = { ...got.settings };
    set.failed = false;
  } else {
    set.failed = true;  // the next load() tries again
  }
  drawSettings(state);
}

// Under the Room view while it's the chosen view; also with no view at all when the capture is what failed, so a
// setting that broke it can still be reset (plan decision 7).
function settingsShown(state) {
  if (!state.room) return false;
  const view = cameraChoice(state.cam, state.room, state.camPref).view;
  return view === "room" || (view === "none" && state.room.reason === "capture_failed");
}

function drawSettings(state) {
  const set = state.set;
  const shown = settingsShown(state);
  set.el.hidden = !shown;
  if (!shown) return;
  redraw(state, "camset", set.body, JSON.stringify([set.model?.settings ? 1 : 0, set.failed, set.model?.controls?.length, set.version || 0]), () =>
    set.body.replaceChildren(...(set.model ? settingsFields(set.model.controls, set.draft, (key, v) => {
      set.draft[key] = v;
      set.message = "";
      if (set.refused?.field === key) set.refused = null;
      syncSettings(state);
    }) : [h("p", { class: "meta" }, set.failed ? SETTINGS_WORDS.noAnswer : SETTINGS_WORDS.loading)])));
  syncSettings(state);
}

// Everything that changes while the owner edits, done in place: no rebuild, so a slider or select keeps focus.
function syncSettings(state) {
  const set = state.set;
  const why = state.room?.state === "unavailable" ? state.room.reason : null;
  const dirty = !!set.model && JSON.stringify(set.draft) !== JSON.stringify(set.model.settings);
  // Locked while applying too, so nothing is edited that the hub's answer would then overwrite.
  for (const g of set.body.querySelectorAll("fieldset")) g.disabled = !!why || set.applying;
  for (const c of set.model?.controls || []) {
    const field = set.body.querySelector(`[data-field="${c.key}"].ws-set-field`);
    const input = field?.querySelector(`[data-key="set-${c.key}"]`);
    if (!input) continue;
    input.disabled = (["centre_x", "centre_y"].includes(c.key) && !(set.draft.zoom > 1))
      || (["shutter", "gain"].includes(c.key) && set.draft.manual !== true);
    const out = field.querySelector("output");
    if (out) out.textContent = shownValue(c, set.draft[c.key]);
    const err = field.querySelector(".ws-set-err");
    const refused = set.refused?.field === c.key;
    err.hidden = !refused;
    err.textContent = refused ? set.refused.reason : "";
    if (refused) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }
  // Apply and Reset stay focusable while applying (aria-disabled), so focus isn't lost; the handlers refuse meanwhile.
  set.apply.disabled = !set.model || !!why;
  set.reset.disabled = !set.model || why === "not_detected";
  for (const b of [set.apply, set.reset]) {
    if (set.applying) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
  }
  // Why the camera is out wins over an older message ("Applied."), so the way back (Reset) is always said.
  const note = set.applying ? SETTINGS_WORDS.applying
    : why === "not_detected" ? SETTINGS_WORDS.notDetected : why ? SETTINGS_WORDS.captureFailed
      : set.message || (dirty ? SETTINGS_WORDS.edited : "");
  if (set.note.textContent !== note) set.note.textContent = note;
}

async function sendSettings(state, kind) {
  const set = state.set;
  if (set.applying || !set.model) return;
  set.applying = true;
  set.refused = null;
  set.message = SETTINGS_WORDS.applying;
  syncSettings(state);
  const path = kind === "reset" ? "/api/camera/room/settings/reset" : "/api/camera/room/settings";
  let status = 0;
  let data = {};
  try {
    const r = await fetch(path, { method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: kind === "reset" ? undefined : JSON.stringify(set.draft) });
    status = r.status;
    data = await r.json().catch(() => ({}));
  } catch { /* status 0: the hub didn't answer */ }
  set.applying = false;
  if (state.left) return;
  syncSettings(state);  // unlock the fields before redrawing them
  if (status === 200 && data?.settings) {
    set.model = { ...set.model, ...data };
    set.draft = { ...data.settings };
    set.version = (set.version || 0) + 1;  // redraw the fields with what the hub stored
    set.message = kind === "reset" ? SETTINGS_WORDS.reset : SETTINGS_WORDS.applied;
    set.appliedAt = Date.now();  // reads that started before this are older than what the hub just said
    if (data.state) state.room = data.state;
    drawCam(state);
    const img = state.camView.querySelector("img.room-img[data-refresh]");
    if (img) refreshRoomStill(state, img);  // the new picture now, not at the next tick
    else recheckRoom(state);
    return;
  }
  set.message = status === 422 ? `Not applied: ${data?.reason || "the hub refused a setting."}`
    : status === 409 ? data?.reason || SETTINGS_WORDS.busy
      : status === 401 ? SETTINGS_WORDS.signIn : SETTINGS_WORDS.failedSend;
  if (status === 422 && data?.field) set.refused = { field: data.field, reason: data.reason || "" };
  drawSettings(state);
  if (set.refused || status === 422) {
    const field = set.refused && set.body.querySelector(`[data-key="set-${set.refused.field}"]`);
    // A field that can't take focus (locked, or one the form doesn't have) leaves the reason in the status line.
    (field && !field.disabled && !field.closest("fieldset")?.disabled ? field : set.note).focus();
  }
}

// After an apply, whether the camera gives a picture with the new settings: a failed capture otherwise stays
// "unavailable" until something asks for a picture, and the unavailable view has no picture to ask with.
async function recheckRoom(state) {
  try {
    const r = await fetch(`/api/camera/room.jpg?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    if (state.left || !state.room) return;
    if (r.ok && state.room.state === "unavailable") {
      state.room = { ...state.room, state: "ready", reason: null };
      drawCam(state);
    }
  } catch { /* the next load says */ }
}

const STATE_LAMP = { printing: "ok", paused: "warn", error: "bad", stopped: "ok", idle: "ok", offline: "bad" };
const STATE_WORD = { printing: "Printing", paused: "Paused", error: "Needs a look", stopped: "Stopped", idle: "Idle", offline: "Offline" };

// The printer as the faceplate (A7 P1), pure so it is tested without a page. A printer no source answers for is
// unknown, never idle; a stale source keeps its last readings and says so. A heater with no target shows one number
// (decision 6).
export function printerPlate(p, cam, { lastPrint = null, actions = null, aside = null } = {}) {
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
    aside: aside ?? cameraAside(cam),
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

// The camera aside, redrawn only when what it shows changes (and then focus returns to the same button).
function drawCam(state) {
  // A live picture that is no longer shown (the Room view unavailable or not chosen) is closed, not left streaming.
  if (state.live.on && (state.room?.state === "unavailable" || cameraChoice(state.cam, state.room, state.camPref).view !== "room")) {
    stopLive(state, "", false);
  }
  const room = state.room ? [state.room.state, state.room.reason, state.room.rotate, state.room.size] : null;
  const sig = JSON.stringify([state.cam?.ok, state.cam?.source, state.cam?.reason, room, state.camPref, state.live]);
  redraw(state, "cam", state.camView, sig, () => state.camView.replaceChildren(cameraAside(state.cam, {
    room: state.room, pref: state.camPref, live: state.live,
    onPick: (view) => {
      state.camPref = view;
      writeCamPref(view);
      if (view !== "room") stopLive(state, "", false);
      drawCam(state);
    },
    onLive: () => (state.live.on ? stopLive(state, "") : startLive(state)),
  })));
  const live = liveImg(state);
  if (live) live.onerror = () => liveFailed(state);
  // The note sits under the live button when there is one, and is otherwise kept out of the page (and so silent).
  const spot = state.camBox.querySelector(".ws-cam-live");
  if (spot && state.camNote.parentNode !== spot) spot.append(state.camNote);
  else if (!spot) state.camNote.remove();
  if (state.camNote.textContent !== (state.live.note || "")) state.camNote.textContent = state.live.note || "";
  drawSettings(state);
}

function liveImg(state) {
  const img = state.camBox?.querySelector("img.room-img");
  return img && !img.dataset.refresh ? img : null;
}

function startLive(state) {
  clearTimeout(state.liveTimer);
  state.live = { on: true, note: "" };
  state.liveTimer = setTimeout(() => stopLive(state, LIVE_PAUSED), LIVE_MS);
  drawCam(state);
}

// Closing the stream: the img lets go of its connection when its src goes, so the Pi's camera can stop.
function stopLive(state, note, draw = true) {
  clearTimeout(state.liveTimer);
  const img = liveImg(state);
  if (img) { img.onerror = null; img.removeAttribute("src"); }
  state.live = { on: false, note };
  if (draw && state.camBox) drawCam(state);
}

// The live picture failed to load or ended early: busy (four already watching), or the camera itself, in words.
async function liveFailed(state) {
  const session = state.live;
  if (!session.on) return;
  const room = await settle(api("/api/camera/room"), 6000, null);
  // Stopped, restarted or left meanwhile: this failure belongs to a session that is already over.
  if (state.live !== session || state.left) return;
  if (room) state.room = room;
  stopLive(state, room?.state === "unavailable" ? "" : room?.viewers >= 4 ? ROOM_WORDS.busy : "Live stopped. Watch live to try again.");
}

// A new Room view still, read with its time so a picture that is getting old says so (A17 R7). A failure redraws the
// aside with the camera's reason instead of leaving an old picture up as if it were current.
export async function refreshRoomStill(state, img) {
  if (state.roomBusy || typeof URL.createObjectURL !== "function") {
    if (!state.roomBusy) img.src = `${img.dataset.refresh}?t=${Date.now()}`;
    return;
  }
  state.roomBusy = true;
  const started = Date.now();
  try {
    const r = await fetch(`${img.dataset.refresh}?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    // The page was left, or this still was replaced (by live or a redraw) while it loaded: nothing to show it in.
    const gone = () => state.left || !img.isConnected;
    if (gone()) return;
    if (!r.ok) {
      const why = await r.json().catch(() => ({}));
      // Gone, or asked before the last apply answered (a capture restarting then isn't the camera failing).
      if (gone() || state.set?.appliedAt > started) return;
      state.room = { ...(state.room || {}), state: "unavailable", reason: why.reason === "not_detected" ? "not_detected" : "capture_failed" };
      drawCam(state);
      return;
    }
    const at = Number(r.headers.get("X-Frame-At"));
    const blob = await r.blob();
    if (gone()) return;
    const url = URL.createObjectURL(blob);
    if (state.roomUrl) URL.revokeObjectURL(state.roomUrl);
    state.roomUrl = url;
    img.src = url;
    const age = Number.isFinite(at) && at > 0 ? Math.round(Date.now() / 1000 - at) : 0;
    const note = img.closest(".ws-cam")?.querySelector(".ws-cam-age");
    if (note) {
      note.hidden = age < 10;
      note.textContent = age >= 10 ? `Picture from ${age} seconds ago.` : "";
    }
  } catch { /* the next tick tries again */ } finally {
    state.roomBusy = false;
  }
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
  const started = Date.now();
  // Only the workshop status is required; the camera and Bambuddy's projects get 6 s each, and the role falls back to
  // read-only.
  const [d, cam, pr, me] = await Promise.all([api("/api/workshop"), settle(api("/api/camera"), 6000, { ok: false, unanswered: true }),
    settle(api("/api/projects"), 6000, { available: false }), settle(whoami(), 6000, { role: "none" })]);
  // The Room view only for the owner (its routes refuse anyone else); a failed read leaves the aside as before A17.
  const room = me?.role === "owner" ? await settle(api("/api/camera/room"), 6000, null) : null;
  const v = workshopView(d, { role: me?.role, last: state.last });
  if (!v) throw new Error("The workshop status came back empty.");
  if (!v.down) state.last = { prints: d.prints, spools: d.spools, week: d.week, at: Date.now() / 1000 };
  const busy = printerBusy();

  // Now: the faceplate (with pause or resume for the owner, under the readings they act on) and the camera beside it.
  // While Bambuddy is down the notice above says so, with when it was last seen; the faceplate doesn't say it again.
  const shown = v.down && d.printer.stale ? { ...d.printer, detail: "" } : d.printer;
  // Its readings change while printing; its "checked" age is redrawn at least once a minute.
  // The printer camera coming back puts the view back on it (A17 R3); a live Room view stops if it's no longer shown.
  // Only after the Room view really stood in for it: a printer camera read that merely timed out keeps the choice.
  if (cam.ok && state.cam && !state.cam.unanswered && cameraChoice(state.cam, state.room, state.camPref).standIn) {
    state.camPref = "printer";
    writeCamPref("printer");
  }
  state.cam = cam;
  // A room read that began before the last apply answered is older than what that apply said; keep the newer.
  if (!(room && state.set.appliedAt > started)) state.room = room;
  if (room && !state.set.model) loadSettings(state);
  drawCam(state);
  redraw(state, "band", state.bandBox, JSON.stringify([shown, v.bandActions, v.lastPrint, busy, Math.floor(Date.now() / 60000)]), () => {
    const buttons = printerButtons({ ...d.printer, actions: v.bandActions }, () => load(state));
    const listed = printerActionList({ actions: v.bandActions });
    buttons?.querySelectorAll("button").forEach((b, i) => { b.dataset.key = `printer-${listed[i]?.action}`; });
    state.bandBox.replaceChildren(printerPlate(shown, cam, { lastPrint: v.lastPrint, actions: buttons, aside: state.camBox }));
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
  stopLive(state, "", false);
  state.sigs = { ...(state.sigs || {}), band: null };
  state.bandBox.replaceChildren(faceplate({ name: "Bambu X2D", lamp: ["unknown", "No answer"], readout: "—",
    caption: "The hub's workshop status didn't answer. This page tries again in 15 seconds." }));
}

