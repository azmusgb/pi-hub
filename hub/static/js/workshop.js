// Workshop › Printer (workshop flow W.2), top to bottom: Now (the band and the camera), Needs you here, Filament loaded,
// This week, More in the workshop (filament, history, projects, the lab queue) and one "Open in" row. The touchscreen's
// pairing is in Settings and its state, with the assistant's, on Health (W.1).
import { api, askFirst, clockTime, duration, empty, ensure, h, settle, when, whoami } from "./core.js";
import { jobTitle, telemetryAge, telemetryLabel, tempText } from "./now.js";
import { faceplate, faceplateLoading, fillTabs } from "./page-parts.js";
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
  state.root.append(state.sourceNotice, now, state.needs, state.materials, state.week, more, openInRow("printer"));
  // The camera aside lives across redraws of the band, so a live Room view isn't restarted by every new reading.
  // The view part is redrawn; the settings panel (A18) beside it is kept, so an edit and its open state survive.
  state.camView = h("div", { class: "ws-cam-view" });
  makeSettings(state);
  makeBars(state);
  state.snapshotsSection = makeSnapshots(state);
  state.camBox = h("div", { class: "ws-cam-box" }, state.camView, state.set.el, state.snapshotsSection);
  state.camPref = readCamPref();
  state.live = { on: false, note: "" };
  state.left = false;
  // Viewing tools state (A20 D4)
  state.viewTools = {
    grid: false,
    hist: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    histTimer: null,
  };
  // One status line for the live notes, kept across redraws so a screen reader hears each new note.
  state.camNote = h("p", { class: "meta ws-cam-note", role: "status" });
  // While this page is open and visible: a new printer still every second, a Room view still every 2 seconds (A17 R4);
  // a live picture is never swapped.
  state.camTick = 0;
  state.camTimer = setInterval(() => {
    if (document.hidden) return;
    state.camTick += 1;
    liveArrived(state);
    for (const img of state.root.querySelectorAll("img[data-refresh]")) {
      if (!img.classList.contains("room-img")) img.src = `${img.dataset.refresh}?t=${Date.now()}`;
      else if (state.camTick % 2 === 0) refreshRoomStill(state, img);
    }
  }, 1000);
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
  state.fsClose?.();
  clearInterval(state.camTimer);
  stopHistogram(state);
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
      alt: "The X2D's camera, updated every second", width: 384, height: 216 }),
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

function roomCam(room, { live = {}, standIn = false, cam = null, onLive = null, state = null } = {}) {
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

  // Viewing tools integration (A20 D4): drawn once here, then changed in place (applyViewTools), never by redrawing
  // the picture: a redraw reopens the live stream.
  const vt = state?.viewTools;
  const histCanvas = h("canvas", { class: "ws-hist-canvas", width: 160, height: 120 });
  const frame = h("div", { class: "ws-cam-frame" }, img, histCanvas);
  paintViewTools(frame, vt);

  if (state) {
    attachViewingHandlers(state, frame, img, histCanvas);
  }

  const tools = state ? renderViewTools(state) : null;

  return h("figure", { class: `ws-cam ws-cam--room${turn}`, style: `--w: ${Number(w)}; --h: ${Number(hgt)}` },
    frame,
    tools,
    h("figcaption", { class: "meta" }, standIn ? `Room view. The printer's camera is unavailable: ${printerCamWhy(cam)}.`
      : live.on ? "Room view, live from the Pi." : "Room view, from the Pi. A new picture every 2 seconds."),
    h("p", { class: "meta ws-cam-age", hidden: true }),
    h("div", { class: "ws-cam-live" },
      h("button", { type: "button", class: "ghost small", dataset: { key: "room-live" }, onclick: onLive }, live.on ? "Stop live" : "Watch live")));
}

// The faceplate's aside: the printer camera, the Room view, or why there is neither. `opts.room` absent keeps the
// aside as it was before A17.
export function cameraAside(c, { room = null, pref = "printer", live = {}, onPick = null, onLive = null, state = null } = {}) {
  const choice = cameraChoice(c, room, pref);
  const body = choice.view === "printer" ? printerCam(c)
    : choice.view === "room" ? roomCam(room, { live, standIn: choice.standIn, cam: c, onLive, state })
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
  edited: "Not saved.",
  saving: "Saving…",
  saved: "Saved.",
  applying: "Applying…",
  applied: "Applied.",
  restarting: "Restarting…",
  reset: "Every setting is back to its default.",
  busy: "The camera is still applying the last change.",
  signIn: "Sign in as the owner to change the camera.",
  failedSend: "The hub didn't answer. Nothing changed.",
  captureFailed: "The Pi's camera isn't giving pictures right now. Reset to defaults puts every setting back, in case one caused it.",
  notDetected: "The Pi's camera isn't detected. Check its ribbon cable. Settings can be changed once it's back.",
  resetAsk: "Every camera setting goes back to its default, including Turn. The picture restarts.",
  fallbackNotice: "Live adjust isn't available, so changes apply with Apply.",
  liveHint: "Changes apply live. Save keeps them.",
  lookFull: "8 saved looks, the most the hub keeps.",
  lookNotSaved: "The hub didn't answer. Nothing was saved.",
};

function shownValue(c, v) {
  const n = Number(v);
  return `${Number.isFinite(n) ? Number(n.toFixed(2)) : v}${c.unit ? ` ${c.unit}` : ""}`;
}

// One control, as a native input with a visible label and a place for the hub's reason if it refuses the value.
// `heading` is the heading it sits under: a label that only repeats it is kept for screen readers.
function settingField(c, value, onInput, heading = c.group) {
  const id = `set-${c.key}`;
  const err = h("p", { class: "ws-set-err", id: `${id}-err`, hidden: true });
  const common = { id, dataset: { key: id, field: c.key }, "aria-describedby": `${id}-err` };
  if (c.kind === "switch") {
    const box = h("input", { ...common, type: "checkbox", checked: value === true });
    box.addEventListener("change", () => onInput(c.key, box.checked === true));
    return h("div", { class: "ws-set-field ws-set-field--switch", dataset: { field: c.key } },
      box, h("label", { for: id }, c.label), err);
  }
  if (c.kind === "choice") {
    const sel = h("select", common, ...(c.options || []).map((o) =>
      h("option", { value: String(o.value), selected: o.value === value }, o.label)));
    sel.addEventListener("change", () => {
      const o = (c.options || []).find((x) => String(x.value) === String(sel.value));
      if (o) onInput(c.key, o.value);
    });
    // A label that only repeats its heading ("Live quality") is kept for screen readers, not shown twice.
    return h("div", { class: "ws-set-field", dataset: { field: c.key } },
      h("label", { for: id, class: c.label === heading ? "sr" : null }, c.label), sel, err);
  }
  const out = h("output", { for: id, class: "ws-set-value" }, shownValue(c, value));
  const range = h("input", { ...common, type: "range", min: String(c.min), max: String(c.max), step: String(c.step), value: String(value) });
  range.addEventListener("input", () => {
    const n = Number(range.value);
    if (Number.isFinite(n)) onInput(c.key, n);
  });
  return h("div", { class: "ws-set-field", dataset: { field: c.key } },
    h("label", { for: id }, c.label, " ", out), range, err);
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

// Adjust shows one group at a time (A23 D6): the hub's groups, by tab. Live quality's one control sits in Detail. A
// group not in a tab (Framing, until the picture takes it) shows below the tabs, so nothing becomes unreachable.
const ADJUST_TABS = ["Light", "Colour", "Detail"];
const TAB_OF_GROUP = { Light: "Light", Colour: "Colour", Detail: "Detail", "Live quality": "Detail" };
// Light's everyday three; the rest of Light is folded under Manual exposure, closed by default.
const LIGHT_MAIN = new Set(["ev", "brightness", "contrast"]);
const TAB_KEY = "hub-room-adjust-tab";
const AUTO = "Auto";

function readTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return ADJUST_TABS.includes(t) ? t : "Light";
  } catch {
    return "Light";  // no storage (private mode, blocked site data): Light, every time
  }
}

// What Auto resets and Save this look keeps (plan decision 3): every control in Light, Colour or Detail, from the hub's
// table, so Turn, Mirror, Flip, Zoom, the centre and the preset are never touched.
function lookKeys(state) {
  return (state.set.model?.controls || [])
    .filter((c) => ["Light", "Colour", "Detail"].includes(c.group) && c.key !== "preset").map((c) => c.key);
}

function autoValues(state) {
  const defaults = state.set.model?.defaults || {};
  const byKey = new Map((state.set.model?.controls || []).map((c) => [c.key, c]));
  return Object.fromEntries(lookKeys(state).map((k) => [k, k in defaults ? defaults[k] : byKey.get(k)?.default]));
}

// The panel's fields: the tab strip, one panel per tab (only the chosen one shown), then any group outside the tabs.
function adjustFields(state, controls, onInput) {
  const set = state.set;
  const byTab = new Map(ADJUST_TABS.map((t) => [t, []]));
  const rest = [];
  for (const c of controls) (TAB_OF_GROUP[c.group] ? byTab.get(TAB_OF_GROUP[c.group]) : rest).push(c);
  const tabs = ADJUST_TABS.filter((t) => byTab.get(t).length);
  if (!tabs.length) return settingsFields(rest, set.draft, onInput);
  set.tab = tabs.includes(set.tab) ? set.tab : tabs.includes(readTab()) ? readTab() : tabs[0];
  const panelId = (t) => `adjust-${t.toLowerCase()}`;
  const field = (t) => (c) => settingField(c, set.draft?.[c.key] ?? c.default, onInput, t);
  const panels = tabs.map((t) => {
    const cs = byTab.get(t);
    const folded = t === "Light" ? cs.filter((c) => !LIGHT_MAIN.has(c.key)) : [];
    const fold = folded.length
      ? h("details", { class: "ws-set-fold", open: set.foldOpen === true }, h("summary", {}, "Manual exposure"), ...folded.map(field(t)))
      : null;
    fold?.addEventListener("toggle", () => { set.foldOpen = fold.open; });
    return h("div", { role: "tabpanel", id: panelId(t), "aria-labelledby": `adjust-tab-${t}`, hidden: t !== set.tab },
      h("fieldset", { class: "ws-set-group" }, h("legend", { class: "sr" }, t),
        ...cs.filter((c) => !folded.includes(c)).map(field(t)), fold));
  });
  const strip = h("div", { class: "ui-tabs ws-set-tabs", role: "tablist", "aria-label": "Adjust" });
  const choose = (t) => {
    set.tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch { /* remembered for this visit only */ }
    draw();
    for (const p of panels) p.hidden = p.id !== panelId(t);
  };
  const draw = () => fillTabs(strip, { items: tabs.map((t) => ({ key: t, label: t })), selected: set.tab,
    idPrefix: "adjust-tab-", panel: panelId, onSelect: choose });
  draw();
  return [strip, ...panels, ...settingsFields(rest, set.draft, onInput)];
}

// A refused field may sit in a tab not shown or under the closed Manual exposure fold: show it (without remembering
// the tab as the owner's choice) so it can take focus beside its reason.
function revealField(state, key) {
  const set = state.set;
  const c = (set.model?.controls || []).find((x) => x.key === key);
  const tab = TAB_OF_GROUP[c?.group];
  if (!tab) return;
  const folded = tab === "Light" && !LIGHT_MAIN.has(key);
  if (set.tab === tab && (!folded || set.foldOpen)) return;
  set.tab = tab;
  if (folded) set.foldOpen = true;
  set.version = (set.version || 0) + 1;  // the fields redraw with this tab chosen
}

function makeSettings(state) {
  const set = {
    model: null,
    draft: null,
    looks: [],
    activeLook: null,
    applying: false,
    failed: false,
    loading: false,
    message: "",
    refused: null,
    ratePending: null,
    inFlight: false,
    pending: new Map(),  // control → newest value not yet sent (A23 plan decision 4)
    confirmed: {},       // control → the value the camera last confirmed
    shown: null,         // the crop the picture shows (A23 P3): the confirmed one, once the stream has caught up
    liveOff: false,      // the hub said live adjust isn't running (409): nothing on the picture moves
  };
  state.set = set;
  set.chipsEl = h("div", { class: "ui-chips ws-looks", role: "group", "aria-label": "Looks" });
  set.looksNote = h("p", { class: "meta ws-looks-note", hidden: true });
  set.lookForm = makeLookForm(state);
  set.looksEl = h("div", { class: "ws-looks-row" }, set.chipsEl, set.looksNote, set.lookForm.el);
  set.hint = h("p", { class: "meta ws-set-hint" }, SETTINGS_WORDS.liveHint);
  set.body = h("div", { class: "ws-set-body" });
  set.note = h("p", { class: "meta ws-set-note", role: "status", tabindex: "-1" });
  set.apply = h("button", { type: "button", class: "primary small", dataset: { key: "cam-apply" } }, "Apply");
  set.apply.addEventListener("click", () => sendSettings(state, "apply"));
  set.save = h("button", { type: "button", class: "primary small", dataset: { key: "cam-save" } }, "Save");
  set.save.addEventListener("click", () => sendSettings(state, "save"));
  set.reset = h("button", { type: "button", class: "ghost small", dataset: { key: "cam-reset" } }, "Reset to defaults");
  set.reset.addEventListener("click", async () => {
    if (set.applying || !set.model) return;
    if (await askFirst(set.reset, SETTINGS_WORDS.resetAsk, { confirm: "Reset" })) sendSettings(state, "reset");
  });
  set.actions = h("div", { class: "ws-set-actions" }, set.save, set.apply, set.reset);
  // Leaving Adjust keeps what is running (A23 D7), so the summary says when the camera shows changes not saved.
  set.unsaved = h("span", { class: "ws-set-unsaved", hidden: true }, "Unsaved changes");
  set.el = h("details", { class: "ws-set", hidden: true },
    h("summary", { dataset: { key: "cam-settings" } }, h("span", {}, "Adjust"), set.unsaved),
    h("div", { class: "ws-set-inner" }, set.looksEl, set.body, set.actions, set.note, set.hint));

  set.el.addEventListener("toggle", () => {
    state.camBox?.classList.toggle("ws-cam-box--pinned", set.el.open);
    if (set.el.open) {
      resetViewZoom(state);  // two zooms never stack: the camera's is the one in use (A23 plan decision 9)
      if (!state.live.on && state.room?.state !== "unavailable") {
        startLive(state);
      }
      loadLooks(state);
      loadSnapshots(state);
    }
    mountBars(state);
  });
}

async function loadLooks(state) {
  const set = state.set;
  const got = await settle(api("/api/camera/room/looks"), 6000, null);
  if (state.left || !got?.looks) return;
  set.looks = got.looks;
  drawLooks(state);
}

// Looks are one row of chips (A23 D5): Auto, the built-in looks, saved looks, then Save this look. The chip for the
// look in force is pressed and any later change un-presses it; Auto is also pressed whenever every look-able setting is
// at its default, since that is what Auto would give.
// A chip by its key, compared as text: a look's name may hold quotes or backslashes, so it never goes into a selector.
function lookChip(set, key) {
  return [...set.chipsEl.querySelectorAll(".ws-look-chip")].find((b) => b.dataset?.key === key) || null;
}

function drawLooks(state) {
  const set = state.set;
  if (!set.model) {
    set.chipsEl.replaceChildren();
    return;
  }
  const looks = Array.isArray(set.looks) ? set.looks : [];
  const auto = autoValues(state);
  const atDefaults = Object.keys(auto).length > 0
    && Object.entries(auto).every(([k, v]) => JSON.stringify(set.draft?.[k]) === JSON.stringify(v));
  const chip = (name, pressed, onClick, attrs = {}) => {
    const btn = h("button", { type: "button", class: "ws-look-chip", dataset: { key: `look-${name}` }, ...attrs,
      ...(pressed === null ? {} : { "aria-pressed": String(pressed) }) }, name);
    btn.addEventListener("click", onClick);
    return btn;
  };
  const full = looks.filter((l) => !l.builtin).length >= 8;
  const had = set.chipsEl.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
  set.chipsEl.replaceChildren(
    chip(AUTO, set.activeLook === AUTO || (set.activeLook == null && atDefaults), () => applyLook(state, { name: AUTO, values: autoValues(state) })),
    ...looks.map((look) => chip(look.name, set.activeLook === look.name, () => applyLook(state, look))),
    chip("Save this look", null, () => set.lookForm.toggle(), { class: "ws-look-chip ws-look-save", disabled: full,
      "aria-expanded": String(!set.lookForm.el.hidden), "aria-controls": "look-form" }));
  set.looksNote.hidden = !full;
  set.looksNote.textContent = full ? SETTINGS_WORDS.lookFull : "";
  if (had) lookChip(set, had)?.focus();  // a redraw never drops a keyboard user
}

// Save this look: a name, then the look-able settings in force now (the ones Auto resets), as a new chip. Built once,
// so what the owner types survives the chips being redrawn; a refusal keeps it and says why beside the field.
function makeLookForm(state) {
  const input = h("input", { type: "text", id: "look-name", class: "ui-field", maxlength: 24, autocomplete: "off",
    enterkeyhint: "done", "aria-describedby": "look-name-err" });
  const err = h("p", { class: "ws-set-err", id: "look-name-err", hidden: true });
  const save = h("button", { type: "button", class: "primary small", dataset: { key: "look-save-confirm" } }, "Save look");
  const cancel = h("button", { type: "button", class: "ghost small", dataset: { key: "look-save-cancel" } }, "Cancel");
  const el = h("div", { class: "ws-look-form", id: "look-form", hidden: true },
    h("label", { for: "look-name" }, "Name this look"), input, h("div", { class: "ws-set-actions" }, save, cancel), err);
  const say = (reason) => {
    err.hidden = !reason;
    err.textContent = reason || "";
    if (reason) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  };
  const close = () => {
    el.hidden = true;
    say("");
    drawLooks(state);
  };
  const toggle = () => {
    if (!el.hidden) return close();
    el.hidden = false;
    say("");
    drawLooks(state);
    input.focus();
  };
  const submit = async () => {
    const set = state.set;
    if (save.disabled || !set.model) return;
    const name = String(input.value || "").trim();
    if (!name) {
      say("Give the look a name.");
      input.focus();
      return;
    }
    const values = Object.fromEntries(lookKeys(state).filter((k) => set.draft?.[k] !== undefined).map((k) => [k, set.draft[k]]));
    save.disabled = true;
    let status = 0;
    let data = null;
    try {
      const r = await fetch("/api/camera/room/looks", { method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, values }) });
      status = r.status;
      data = await r.json().catch(() => null);
    } catch { /* status 0: the hub didn't answer */ }
    save.disabled = false;
    if (state.left) return;
    if (status === 200 && Array.isArray(data?.looks)) {
      set.looks = data.looks;
      set.activeLook = data.look?.name || name;
      input.value = "";
      close();
      lookChip(set, `look-${set.activeLook}`)?.focus();
      return;
    }
    say(data?.reason || SETTINGS_WORDS.lookNotSaved);
    input.focus();
  };
  save.addEventListener("click", submit);
  cancel.addEventListener("click", close);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); state.set.chipsEl.querySelector(".ws-look-save")?.focus(); }
  });
  return { el, toggle };
}

async function applyLook(state, look) {
  const set = state.set;
  if (set.applying || !set.model) return;
  set.activeLook = look.name;
  drawLooks(state);
  const values = look.values || {};
  for (const [k, v] of Object.entries(values)) {
    set.draft[k] = v;
  }
  set.message = "";
  syncSettings(state);

  const engine = state.room?.engine || "picamera2";
  if (engine !== "picamera2") {
    // The fallback engine can't adjust live: a look applies with a restart
    set.message = SETTINGS_WORDS.restarting;
    syncSettings(state);
    await sendSettings(state, "apply");
  } else {
    queueLive(state, Object.fromEntries(Object.entries(values).filter(([k]) => isLive(state, k))));
  }
  syncBars(state);
}

// Every control changes on the running camera; the hub's table says so (c.live), so nothing here repeats it.
function isLive(state, key) {
  return state.set?.model?.controls?.find((c) => c.key === key)?.live === true;
}

// One pending value per control, newest wins (A23 plan decision 4): rapid taps on one control send only the last, and
// whatever is pending goes in one request, at most 5 a second. A look, Auto or Fit is one request ({values}).
function queueLive(state, values) {
  const set = state.set;
  for (const [k, v] of Object.entries(values)) set.pending.set(k, v);
  if (!set.pending.size || set.ratePending) return;
  set.ratePending = setTimeout(() => {
    set.ratePending = null;
    sendNextLive(state);
  }, 200);
}

const LIVE_WORDS = {
  409: "Live adjust isn't running. Use Apply.",
  429: "Slow down: the camera takes ten changes a second.",
};

async function sendNextLive(state) {
  const set = state.set;
  if (!set.pending.size || set.inFlight || state.left) return;
  const sent = Object.fromEntries(set.pending);
  set.pending.clear();
  set.inFlight = true;
  const keys = Object.keys(sent);
  let status = 0;
  let data = null;
  try {
    const r = await fetch("/api/camera/room/live-controls", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(keys.length === 1 ? { key: keys[0], value: sent[keys[0]] } : { values: sent }),
    });
    status = r.status;
    data = await r.json().catch(() => null);
  } catch { /* status 0: the hub didn't answer */ }
  set.inFlight = false;
  if (state.left) return;
  if (status === 200) {
    set.liveOff = false;
    const crop = () => ({ zoom: set.confirmed.zoom, centre_x: set.confirmed.centre_x, centre_y: set.confirmed.centre_y });
    if (!set.shown) set.shown = crop();
    Object.assign(set.confirmed, data?.values || (typeof data?.key === "string" ? { [data.key]: data.value } : sent));
    if (keys.some((k) => CROP_KEYS.includes(k))) {
      // The stream shows a new crop about seven frames later (room_camera_helper.py), so the frame keeps showing the
      // picture where the finger put it until then.
      const now = crop();
      setTimeout(() => { if (state.left) return; set.shown = now; syncBars(state); }, CROP_LAG_MS);
    }
    if (data?.state) {
      const was = JSON.stringify([state.room?.rotate, state.room?.size]);
      state.room = { ...state.room, ...data.state };
      if (JSON.stringify([state.room.rotate, state.room.size]) !== was) drawCam(state);
    }
  } else if (status === 409) {
    set.liveOff = true;
    set.message = data?.reason || LIVE_WORDS[409];  // the edit stays for Apply
  } else {
    // Refused, too fast or no answer: each control goes back to what the camera last confirmed, unless a newer value
    // for it is already waiting, and the status line says why.
    for (const k of keys) if (!set.pending.has(k) && k in set.confirmed) set.draft[k] = set.confirmed[k];
    set.activeLook = null;  // part of the look went back, so the picture is no longer that look
    set.message = data?.reason || LIVE_WORDS[status] || SETTINGS_WORDS.failedSend;
    if (status === 422 && data?.field) set.refused = { field: data.field, reason: data.reason || "" };
  }
  syncSettings(state);
  drawLooks(state);
  syncBars(state);
  queueLive(state, {});
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
    // The camera may be running tries not saved (A23 D7): the panel shows what the picture shows.
    set.confirmed = { ...got.settings, ...(state.room?.live_values || {}) };
    set.shown = null;
    set.draft = { ...set.confirmed };
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
  const engine = state.room?.engine || "picamera2";
  redraw(state, "camset", set.body, JSON.stringify([set.model?.settings ? 1 : 0, set.failed, set.model?.controls?.length, engine, set.version || 0]), () =>
    set.body.replaceChildren(...(set.model ? adjustFields(state, set.model.controls.filter((c) => !ON_PICTURE.has(c.key)), (key, v) => {
      set.draft[key] = v;
      set.activeLook = null;
      set.message = "";
      if (set.refused?.field === key) set.refused = null;
      syncSettings(state);
      drawLooks(state);
      if (engine === "picamera2" && isLive(state, key)) queueLive(state, { [key]: v });
      syncBars(state);
    }) : [h("p", { class: "meta" }, set.failed ? SETTINGS_WORDS.noAnswer : SETTINGS_WORDS.loading)])));
  syncSettings(state);
  drawLooks(state);
  drawSnapshots(state);
  mountBars(state);
}

// Everything that changes while the owner edits, done in place: no rebuild, so a slider or select keeps focus.
function syncSettings(state) {
  const set = state.set;
  const why = state.room?.state === "unavailable" ? state.room.reason : null;
  const dirty = !!set.model && JSON.stringify(set.draft) !== JSON.stringify(set.model.settings);
  const engine = state.room?.engine || "picamera2";
  // Locked while applying too, so nothing is edited that the hub's answer would then overwrite.
  for (const g of set.body.querySelectorAll("fieldset")) g.disabled = !!why || set.applying;
  for (const c of set.model?.controls || []) {
    const field = set.body.querySelector(`[data-field="${c.key}"].ws-set-field`);
    const input = field?.querySelector(`[data-key="set-${c.key}"]`);
    if (!input) continue;
    input.disabled = ["shutter", "gain"].includes(c.key) && set.draft.manual !== true;
    if (input.type === "checkbox") input.checked = set.draft[c.key] === true;
    else if (set.draft[c.key] !== undefined && input.value !== String(set.draft[c.key])) input.value = String(set.draft[c.key]);
    const out = field.querySelector("output");
    if (out) out.textContent = shownValue(c, set.draft[c.key]);
    const err = field.querySelector(".ws-set-err");
    const refused = set.refused?.field === c.key;
    err.hidden = !refused;
    err.textContent = refused ? set.refused.reason : "";
    if (refused) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }

  // Engine distinction:
  // If rpicam fallback: show Apply, hide Save
  // If picamera2: show Save, hide Apply
  set.hint.hidden = engine === "rpicam";  // the fallback's note says Apply instead
  if (engine === "rpicam") {
    set.apply.hidden = false;
    set.save.hidden = true;
  } else {
    set.apply.hidden = true;
    set.save.hidden = false;
  }

  set.apply.disabled = !set.model || !!why;
  set.save.disabled = !set.model || !!why;
  set.reset.disabled = !set.model || why === "not_detected";
  for (const b of [set.apply, set.save, set.reset]) {
    if (set.applying) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
  }

  const defaultNote = engine === "rpicam"
    ? (dirty ? SETTINGS_WORDS.edited : SETTINGS_WORDS.fallbackNotice)
    : (dirty ? SETTINGS_WORDS.edited : "");

  const live = state.room?.live_values || {};
  set.unsaved.hidden = !Object.keys(live).some((k) => JSON.stringify(live[k]) !== JSON.stringify(set.model?.settings?.[k]));

  const note = set.applying ? (set.message || SETTINGS_WORDS.saving)
    : why === "not_detected" ? SETTINGS_WORDS.notDetected : why ? SETTINGS_WORDS.captureFailed
      : set.message || defaultNote;
  if (set.note.textContent !== note) set.note.textContent = note;
}

async function sendSettings(state, kind) {
  const set = state.set;
  if (set.applying || !set.model) return;
  set.applying = true;
  set.refused = null;
  set.message = kind === "reset" ? SETTINGS_WORDS.applying : kind === "save" ? SETTINGS_WORDS.saving : SETTINGS_WORDS.applying;
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
    set.confirmed = { ...data.settings };
    set.shown = null;
    set.version = (set.version || 0) + 1;  // redraw the fields with what the hub stored
    if (kind === "reset") set.activeLook = null;
    set.message = kind === "reset" ? SETTINGS_WORDS.reset : kind === "save" ? SETTINGS_WORDS.saved : SETTINGS_WORDS.applied;
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
  if (set.refused) revealField(state, set.refused.field);
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

// ---- Snapshots Gallery (amendment A20 D3, plan P2 & P4) ----

function makeSnapshots(state) {
  const headTitle = h("h3", { class: "ws-snapshots-title" }, "Snapshots");
  const countEl = h("span", { class: "ws-snapshots-count" }, "0 of 200");
  const head = h("div", { class: "ws-snapshots-head" }, headTitle, countEl);
  const listEl = h("div", { class: "ws-snapshots-list", role: "region", "aria-label": "Snapshots list" });
  const sectionEl = h("section", { class: "ws-snapshots-section", hidden: true }, head, listEl);

  state.snaps = {
    el: sectionEl,
    countEl,
    listEl,
    items: [],
    loading: false,
    saving: false,
    message: "",
  };
  return sectionEl;
}

export async function loadSnapshots(state) {
  const snaps = state.snaps;
  if (!snaps || snaps.loading || state.left) return;
  snaps.loading = true;
  try {
    const got = await settle(api("/api/camera/room/snapshots"), 6000, null);
    if (state.left) return;
    if (Array.isArray(got?.snapshots)) {
      snaps.items = got.snapshots;
      drawSnapshots(state);
    }
  } finally {
    snaps.loading = false;
  }
}

export function drawSnapshots(state) {
  const snaps = state.snaps;
  if (!snaps) return;
  const shown = settingsShown(state);
  snaps.el.hidden = !shown;
  if (!shown) return;

  const count = snaps.items.length;
  snaps.countEl.textContent = `${count} of 200`;

  if (!count) {
    snaps.listEl.replaceChildren(h("p", { class: "meta" }, "No snapshots yet."));
    return;
  }

  const cards = snaps.items.map((it) => {
    const timeStr = it.created_at ? new Date(it.created_at * 1000).toLocaleString([], {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }) : it.id;
    const thumb = h("img", {
      class: "ws-snap-thumb",
      src: `/api/camera/room/snapshots/${it.id}.jpg`,
      alt: `Snapshot from ${timeStr}`,
      loading: "lazy",
      dataset: { key: `snap-thumb-${it.id}` },
    });
    const link = h("a", {
      href: `/api/camera/room/snapshots/${it.id}.jpg`,
      target: "_blank",
      rel: "noopener",
      title: "Open full image in new tab",
    }, thumb);

    const timeEl = h("span", { class: "ws-snap-time" }, timeStr);
    const delBtn = h("button", {
      type: "button",
      class: "ghost small ws-snap-del",
      dataset: { key: `snap-del-${it.id}` },
    }, "Delete");
    delBtn.addEventListener("click", async () => {
      if (await askFirst(delBtn, `Delete snapshot from ${timeStr}?`, { confirm: "Delete" })) {
        await deleteSnapshot(state, it.id);
      }
    });

    const meta = h("div", { class: "ws-snap-meta" }, timeEl, delBtn);
    return h("div", { class: "ws-snap-card", dataset: { key: `snap-card-${it.id}` } }, link, meta);
  });

  snaps.listEl.replaceChildren(...cards);
}

export async function takeSnapshot(state) {
  const set = state.set;
  const snaps = state.snaps;
  if (!set || set.snapshotSaving || state.left) return;
  set.snapshotSaving = true;
  const origText = set.snapshot.textContent;
  set.snapshot.textContent = "Saving…";
  set.snapshot.disabled = true;

  try {
    const r = await fetch("/api/camera/room/snapshots", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      if (data?.snapshot && snaps) {
        snaps.items = [data.snapshot, ...snaps.items.filter((s) => s.id !== data.snapshot.id)].slice(0, 200);
        drawSnapshots(state);
      }
      set.message = "Saved snapshot.";
    } else {
      set.message = "Failed to save snapshot.";
    }
  } catch {
    set.message = "The hub didn't answer. Snapshot not saved.";
  } finally {
    set.snapshotSaving = false;
    set.snapshot.disabled = false;
    set.snapshot.textContent = origText;
    syncSettings(state);
    syncBars(state);
  }
}

async function deleteSnapshot(state, id) {
  try {
    const r = await fetch(`/api/camera/room/snapshots/${id}`, {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (r.ok && state.snaps) {
      state.snaps.items = state.snaps.items.filter((s) => s.id !== id);
      drawSnapshots(state);
    }
  } catch {
    // network error
  }
}

// ---- Viewing tools (amendment A20 D4, plan P4) ----

// The frame's look for the viewing tools, as classes and CSS variables the stylesheet reads (it composes the zoom with
// a turned picture's own transform). Called on a new frame and, in place, on every tool change.
function paintViewTools(frame, vt) {
  if (!frame || !vt) return;
  frame.classList.toggle("has-grid", vt.grid === true);
  frame.style.setProperty("--vz", String(vt.zoom));
  frame.style.setProperty("--vx", `${vt.panX}px`);
  frame.style.setProperty("--vy", `${vt.panY}px`);
  const canvas = frame.querySelector(".ws-hist-canvas");
  if (canvas) canvas.hidden = !vt.hist;
}

// A tool change touches the frame and the toolbar where they stand: redrawing the camera would reopen the stream.
function applyViewTools(state) {
  const vt = state.viewTools;
  paintViewTools(camFrame(state), vt);
  const zoomed = vt.zoom !== 1 || vt.panX !== 0 || vt.panY !== 0;
  const set = (key, pressed, label) => {
    const b = state.camBox?.querySelector(`[data-key="${key}"]`);
    if (!b) return;
    b.setAttribute("aria-pressed", String(pressed));
    if (label) b.textContent = label;
  };
  set("cam-view-zoom", zoomed, zoomed ? `View zoom: ${vt.zoom.toFixed(1)}×` : "View zoom: 1×");
  set("cam-grid", vt.grid);
  set("cam-hist", vt.hist);
  syncBars(state);
}

function renderViewTools(state) {
  const vt = state.viewTools;
  const isZoomed = vt.zoom !== 1 || vt.panX !== 0 || vt.panY !== 0;

  const fsBtn = h("button", {
    type: "button",
    class: "ws-tool-btn",
    dataset: { key: "cam-fullscreen" },
  }, "Fullscreen");
  fsBtn.addEventListener("click", () => toggleFullscreen(state));

  const zoomBtn = h("button", {
    type: "button",
    class: "ws-tool-btn",
    dataset: { key: "cam-view-zoom" },
    "aria-pressed": String(isZoomed),
  }, isZoomed ? `View zoom: ${vt.zoom.toFixed(1)}×` : "View zoom: 1×");
  zoomBtn.addEventListener("click", () => {
    // Tapping view zoom button toggles between 1x and 2x or resets pan
    if (vt.zoom > 1 || vt.panX !== 0 || vt.panY !== 0) {
      resetViewZoom(state);
    } else {
      setViewZoom(state, 2, 0, 0);
    }
  });

  const gridBtn = h("button", {
    type: "button",
    class: "ws-tool-btn",
    dataset: { key: "cam-grid" },
    "aria-pressed": String(vt.grid),
  }, "Grid");
  gridBtn.addEventListener("click", () => toggleGrid(state));

  const histBtn = h("button", {
    type: "button",
    class: "ws-tool-btn",
    dataset: { key: "cam-hist" },
    "aria-pressed": String(vt.hist),
  }, "Histogram");
  histBtn.addEventListener("click", () => toggleHist(state));

  return h("div", { class: "ws-view-tools", role: "toolbar", "aria-label": "Viewing tools" },
    fsBtn, zoomBtn, gridBtn, histBtn);
}

function toggleGrid(state) {
  state.viewTools.grid = !state.viewTools.grid;
  applyViewTools(state);
}

function toggleHist(state) {
  const vt = state.viewTools;
  vt.hist = !vt.hist;
  if (vt.hist) startHistogram(state); else stopHistogram(state);
  applyViewTools(state);
}

// ---- Adjust: the camera's controls on the picture (amendment A23 D1, D2, D9) ----
// Three bars, built once and moved into whichever frame shows the picture (the page's, the browser's full screen, or the
// iPhone overlay), never rebuilt: a quarter turn redraws the figure, and the bars keep their focus and state across it.
// They show only while adjusting. Each bar is a small dark-themed area on the kit's surface, so it reads over any picture.

// What moved from the panel onto the picture: the centre is set by dragging the picture and by the arrow keys (A23 D3).
export const ON_PICTURE = new Set(["turn", "mirror", "flip", "zoom", "centre_x", "centre_y"]);
const BAR_WHY = {
  not_detected: "No picture: camera not detected",
  capture_failed: "No picture: camera not giving pictures",
  busy: "No picture: four already watching",
};

function makeBars(state) {
  const set = state.set;
  const button = (key, label, attrs = {}) =>
    h("button", { type: "button", class: "ui-btn ws-bar-btn", dataset: { key }, ...attrs }, label);
  const b = {};
  b.badge = h("span", { class: "ui-chip ui-chip--unknown ws-bar-badge" }, "Starting…");
  b.turn = button("bar-turn", "Turn 0°");
  b.flip = button("bar-flip", "Flip", { "aria-pressed": "false" });
  b.mirror = button("bar-mirror", "Mirror", { "aria-pressed": "false" });
  b.zoomIn = button("bar-zoom-in", "+", { class: "ui-btn ui-btn--icon ws-bar-btn", "aria-label": "Zoom in" });
  b.zoomOut = button("bar-zoom-out", "−", { class: "ui-btn ui-btn--icon ws-bar-btn", "aria-label": "Zoom out" });
  b.fit = button("bar-fit", "Fit");
  b.line = h("span", { class: "ws-bar-line" }, "Camera zoom 1×");
  b.grid = button("bar-grid", "Grid", { "aria-pressed": "false" });
  b.hist = button("bar-hist", "Histogram", { "aria-pressed": "false" });
  set.snapshot = button("cam-snapshot", "Snapshot");  // takeSnapshot shows its progress here
  b.fs = button("bar-fullscreen", "Full screen");
  b.camera = [b.turn, b.flip, b.mirror, b.zoomIn, b.zoomOut, b.fit, set.snapshot];

  b.turn.addEventListener("click", () => setOnPicture(state, { turn: ((Number(set.draft?.turn) || 0) + 90) % 360 }));
  b.flip.addEventListener("click", () => setOnPicture(state, { flip: set.draft?.flip !== true }));
  b.mirror.addEventListener("click", () => setOnPicture(state, { mirror: set.draft?.mirror !== true }));
  b.zoomIn.addEventListener("click", () => zoomBy(state, 1));
  b.zoomOut.addEventListener("click", () => zoomBy(state, -1));
  b.fit.addEventListener("click", () => fit(state));
  b.grid.addEventListener("click", () => toggleGrid(state));
  b.hist.addEventListener("click", () => toggleHist(state));
  set.snapshot.addEventListener("click", () => takeSnapshot(state));
  b.fs.addEventListener("click", () => toggleFullscreen(state));

  b.el = h("div", { class: "ws-bars", dataset: { theme: "dark", key: "cam-bars" } },
    h("div", { class: "ws-bar ws-bar--top", role: "group", "aria-label": "Turn and flip" }, b.badge,
      h("span", { class: "ws-bar-set" }, b.turn, b.flip, b.mirror)),
    h("div", { class: "ws-bar ws-bar--side", role: "group", "aria-label": "Camera zoom" }, b.zoomIn, b.zoomOut, b.fit),
    h("div", { class: "ws-bar ws-bar--bottom", role: "group", "aria-label": "Picture tools" }, b.line,
      h("span", { class: "ws-bar-set" }, b.grid, b.hist, set.snapshot, b.fs)));
  state.bars = b;
}

function control(state, key) {
  return state.set?.model?.controls?.find((c) => c.key === key) || null;
}

// One step of the camera's zoom (the hub's step, 0.5×), from the side bar or the + and − keys.
function zoomBy(state, dir) {
  const c = control(state, "zoom");
  const z = Number(state.set.draft?.zoom ?? 1);
  const next = c ? Math.min(c.max, Math.max(c.min, Number((z + dir * c.step).toFixed(2)))) : z;
  if (next !== z) setOnPicture(state, { zoom: next });
}

function fit(state) {
  setOnPicture(state, { zoom: 1, centre_x: 50, centre_y: 50 });
}

// A change made on the picture: shown at once, sent live (or kept for Apply on the fallback engine). The picture's own
// shape follows only what the hub confirms (state.room), so nothing claims a turn the camera hasn't taken.
function setOnPicture(state, values) {
  const set = state.set;
  if (barsWhy(state)) return;
  Object.assign(set.draft, values);
  set.activeLook = null;
  set.message = "";
  if ((state.room?.engine || "picamera2") === "picamera2") queueLive(state, values);
  else set.message = SETTINGS_WORDS.fallbackNotice;
  syncSettings(state);
  drawLooks(state);
  syncBars(state);
}

// Why the camera's buttons are off, in the badge's words, or null when the camera can take a change.
function barsWhy(state) {
  if (state.room?.state === "unavailable") return BAR_WHY[state.room.reason] || BAR_WHY.capture_failed;
  if (!state.live.on) return "Paused";
  if (!state.liveFrame || !state.set?.model) return "Starting…";
  return null;
}

// The live preset's frame rate, from the hub's own words for it ("Data saver (384×288, 10 fps, …)").
function liveFps(state) {
  const c = control(state, "preset");
  const o = c?.options?.find((x) => x.value === state.set.confirmed?.preset);
  const m = /(\d+) fps/.exec(o?.label || "");
  return m ? Number(m[1]) : null;
}

function syncBars(state) {
  const b = state.bars;
  const set = state.set;
  if (!b?.el.isConnected) return;
  const d = set.draft || {};
  const why = barsWhy(state);
  const fps = liveFps(state);
  b.badge.textContent = why || (fps ? `Live · ${fps} fps` : "Live");
  b.badge.className = `ui-chip ws-bar-badge ${why ? "ui-chip--unknown" : "ui-chip--ok ui-chip--live"}`;
  for (const el of b.camera) {
    if (el !== set.snapshot || !set.snapshotSaving) el.disabled = !!why;
  }
  b.turn.textContent = `Turn ${Number(d.turn) || 0}°`;
  b.flip.setAttribute("aria-pressed", String(d.flip === true));
  b.mirror.setAttribute("aria-pressed", String(d.mirror === true));
  const c = control(state, "zoom");
  const z = Number(d.zoom ?? 1);
  if (c) {
    b.zoomIn.disabled = b.zoomIn.disabled || z >= c.max;
    b.zoomOut.disabled = b.zoomOut.disabled || z <= c.min;
  }
  const live = (state.room?.engine || "picamera2") === "picamera2";
  b.line.textContent = `Camera zoom ${Number(z.toFixed(2))}×${z > 1 ? (live ? " · drag to frame" : " · drag needs live adjust") : ""}`;
  b.el.parentNode?.classList.toggle("ws-cam-frame--framing", canFrame(state));
  paintFrameShift(state);
  b.grid.setAttribute("aria-pressed", String(state.viewTools.grid === true));
  b.hist.setAttribute("aria-pressed", String(state.viewTools.hist === true));
}

// The bars go on the picture while adjusting and the Room view shows, and the watching toolbar steps aside so no tool
// shows twice (A23 D2). Otherwise the picture carries no camera controls (A23 D1).
function mountBars(state) {
  const b = state.bars;
  if (!b) return;
  const frame = state.fsFrame || state.camBox?.querySelector(".ws-cam--room .ws-cam-frame");
  const adjusting = !!frame && state.set.el.open && !state.set.el.hidden;
  if (adjusting) {
    if (b.el.parentNode !== frame) {
      b.el.parentNode?.classList.remove("ws-cam-frame--framing");
      frame.append(b.el);
      state.drag = null;  // a redrawn or moved frame: the old drag's pointer and sizes are gone
    }
  } else {
    b.el.parentNode?.classList.remove("ws-cam-frame--framing");
    b.el.remove();
    state.drag = null;
    paintViewTools(camFrame(state), state.viewTools);  // the frame's shift goes back to the view's own pan
  }
  const tools = state.camBox?.querySelector(".ws-view-tools");
  if (tools) tools.hidden = adjusting;
  syncBars(state);
}

// The live picture's first frame: the camera's buttons wait for it (A23 D2, "Starting…").
function liveArrived(state) {
  const img = liveImg(state);
  if (!state.live.on || state.liveFrame || !img || !(img.naturalWidth > 0)) return;
  state.liveFrame = true;  // kept off state.live, which is part of the picture's redraw signature
  syncBars(state);
}

// ---- Drag and keys to frame the camera (amendment A23 D3, D4; plan decisions 8 and 9) ----
// The centre is a point on the sensor; the finger moves on the screen. The page undoes, in order, its own quarter turn
// and then the camera's half turn, mirror and flip, so the picture follows the finger at every orientation.

// Whether the camera's crop is placed on the sensor before its flips (libcamera's ScalerCrop is in sensor
// coordinates). The plan has this measured on the Pi at all eight orientations before the page ships (decision 8).
const CROP_BEFORE_FLIP = true;
// The camera's crop keys, and how long a new crop takes to reach the stream (0.74 s at 10 fps, measured on the Pi,
// room_camera_helper.py), with a little to spare.
const CROP_KEYS = ["zoom", "centre_x", "centre_y"];
const CROP_LAG_MS = 900;
// The sensor's shape (ov5647, 2592 × 1944). The camera keeps the output's shape when it crops (scaler_crop), so a wide
// preset crops less of the sensor down than across.
const SENSOR = [4, 3];

// The share of the sensor across and down that the crop covers at this zoom, for an output of `out` (w, h), as
// scaler_crop computes it.
export function cropShare(zoom, out = SENSOR, sensor = SENSOR) {
  const z = Math.max(1, Number(zoom) || 1);
  const ratio = (sensor[0] / sensor[1]) / (out[0] / out[1]);
  let fx = 1 / z;
  let fy = fx * ratio;
  if (fy > 1) {
    fy = 1 / z;
    fx = fy / ratio;
  }
  return [fx, fy];
}

// The centre's move, in percent of the sensor, for a drag of (dx, dy) screen pixels over a picture shown `width` ×
// `height` pixels in its own axes, which is the `share` of the sensor the crop covers. The picture follows the finger,
// so the centre moves the other way.
export function dragToCentre(dx, dy, { turn = 0, mirror = false, flip = false, zoom = 1, share, width, height }) {
  const [fx, fy] = share || [1 / zoom, 1 / zoom];
  const [px, py] = turn === 90 ? [dy, -dx] : turn === 270 ? [-dy, dx] : [dx, dy];
  let cx = (-px / width) * fx * 100;
  let cy = (-py / height) * fy * 100;
  if (CROP_BEFORE_FLIP) {
    const half = turn === 180;
    if (!!mirror !== half) cx = -cx;
    if (!!flip !== half) cy = -cy;
  }
  return [cx + 0, cy + 0];  // + 0: never -0
}

// The inverse: the screen shift, in pixels, that a centre move of (cx, cy) percent shows as.
export function centreToShift(cx, cy, { turn = 0, mirror = false, flip = false, zoom = 1, share, width, height }) {
  const [fx, fy] = share || [1 / zoom, 1 / zoom];
  if (CROP_BEFORE_FLIP) {
    const half = turn === 180;
    if (!!mirror !== half) cx = -cx;
    if (!!flip !== half) cy = -cy;
  }
  const px = (-cx * width) / (fx * 100);
  const py = (-cy * height) / (fy * 100);
  const [sx, sy] = turn === 90 ? [-py, px] : turn === 270 ? [py, -px] : [px, py];
  return [sx + 0, sy + 0];
}

// Where the centre can still move the crop along one axis, the crop covering `share` of it; past it a value changes
// nothing.
export function centreRange(zoom, share = 1 / Math.max(1, Number(zoom) || 1)) {
  const room = 50 * (1 - share);
  return [50 - room, 50 + room];
}

// The live picture's shape: the preset's size from the hub, else the stream's own.
function outSize(state) {
  const s = state.room?.size;
  if (Array.isArray(s) && s[0] > 0 && s[1] > 0) return s;
  const img = camFrame(state)?.querySelector("img.room-img");
  return img?.naturalWidth > 0 && img?.naturalHeight > 0 ? [img.naturalWidth, img.naturalHeight] : SENSOR;
}

// The centre held inside the crop's range at this zoom, on both axes.
function clampTo(state, zoom, x, y) {
  const [fx, fy] = cropShare(zoom, outSize(state));
  const [lx, hx] = centreRange(zoom, fx);
  const [ly, hy] = centreRange(zoom, fy);
  return [Math.min(hx, Math.max(lx, Number(x ?? 50))), Math.min(hy, Math.max(ly, Number(y ?? 50)))];
}

// Drag frames only on the live engine (the fallback restarts the capture on every change) and past 1×.
// Not while a new zoom is on its way: the drag's scale is the zoom the camera has.
function canFrame(state) {
  const z = Number(state.set.draft?.zoom);
  return state.bars?.el.isConnected === true && !barsWhy(state) && z > 1 && z === Number(state.set.confirmed?.zoom)
    && (state.room?.engine || "picamera2") === "picamera2";
}

// The picture as the camera runs it now (what the screen shows), and its size on the page in its own axes. The img's
// layout box is in the picture's axes (a quarter turn is a transform); contain letterboxes, a turned picture covers.
// The quarter turn is read from the figure the frame sits in: the phone's full-screen overlay doesn't turn it.
function frameGeometry(state) {
  const c = state.set.confirmed || {};
  const frame = camFrame(state);
  const img = frame?.querySelector("img.room-img");
  const nw = img?.naturalWidth || 4;
  const nh = img?.naturalHeight || 3;
  const bw = img?.clientWidth || 0;
  const bh = img?.clientHeight || 0;
  const quarter = frame?.closest?.(".ws-cam--turn90") ? 90 : frame?.closest?.(".ws-cam--turn270") ? 270 : 0;
  const turn = quarter || (Number(c.turn) === 180 ? 180 : 0);
  const scale = quarter ? Math.max(bw / nw, bh / nh) : Math.min(bw / nw, bh / nh);
  const zoom = Number(c.zoom) || 1;
  return { turn, mirror: c.mirror === true, flip: c.flip === true, zoom, share: cropShare(zoom, outSize(state)),
    width: nw * scale, height: nh * scale };
}

function clampCentre(state, x, y) {
  return clampTo(state, state.set.draft?.zoom, x, y);
}

// Sends the centre when its whole-percent value changes (the hub's step), rounded inside the range so the camera shows
// exactly what was sent; the live channel keeps the newest and sends at most five a second, so the release position is
// always the last one sent.
function setCentre(state, x, y) {
  const d = state.set.draft;
  const [fx, fy] = cropShare(d.zoom, outSize(state));
  const step = (v, share) => {
    const [lo, hi] = centreRange(d.zoom, share);
    return Math.min(Math.floor(hi), Math.max(Math.ceil(lo), Math.round(v)));
  };
  const next = { centre_x: step(x, fx), centre_y: step(y, fy) };
  if (next.centre_x !== Number(d.centre_x ?? 50) || next.centre_y !== Number(d.centre_y ?? 50)) setOnPicture(state, next);
}

function frameDragStart(state, e) {
  if (state.drag) {  // a second finger: the drag ends where it is, and pinch does nothing while adjusting
    frameDragEnd(state, state.drag.id);
    return;
  }
  const geo = frameGeometry(state);
  if (!canFrame(state) || !(geo.width > 0 && geo.height > 0)) return;
  const d = state.set.draft;
  const [cx, cy] = clampCentre(state, Number(d.centre_x ?? 50), Number(d.centre_y ?? 50));
  state.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx, cy, at: [cx, cy], geo };
}

function frameDragMove(state, e) {
  const g = state.drag;
  if (!g || e.pointerId !== g.id) return;
  const [dx, dy] = dragToCentre(e.clientX - g.x, e.clientY - g.y, g.geo);
  g.at = clampCentre(state, g.cx + dx, g.cy + dy);
  setCentre(state, ...g.at);
  paintFrameShift(state);
}

function frameDragEnd(state, id) {
  const g = state.drag;
  if (!g || id !== g.id) return;
  state.drag = null;
  setCentre(state, ...g.at);
  paintFrameShift(state);
}

// While the camera catches up, the frame shows the picture where the finger put it: the distance between the centre
// asked for and the one the stream shows, on the screen, both held inside the crop's range (a centre past it changes
// nothing on the camera). Nothing moves while the zooms differ or live adjust is off.
function paintFrameShift(state) {
  const frame = state.bars?.el.parentNode;
  if (!frame?.style) return;
  const set = state.set;
  const d = set.draft || {};
  const s = set.shown || set.confirmed || {};
  const geo = state.drag?.geo || frameGeometry(state);
  const live = (state.room?.engine || "picamera2") === "picamera2" && !set.liveOff;
  const same = live && Number(d.zoom) > 1 && Number(d.zoom) === Number(s.zoom) && geo.width > 0;
  let [sx, sy] = [0, 0];
  if (same) {
    const [ax, ay] = state.drag ? state.drag.at : clampTo(state, d.zoom, d.centre_x, d.centre_y);
    const [bx, by] = clampTo(state, s.zoom, s.centre_x, s.centre_y);
    [sx, sy] = centreToShift(ax - bx, ay - by, geo);
  }
  frame.style.setProperty("--vx", `${Math.round(sx)}px`);
  frame.style.setProperty("--vy", `${Math.round(sy)}px`);
}

// Keys on the picture while adjusting: arrows move what is shown by 1% of the sensor, + and − are the camera's zoom,
// 0 is Fit. True when the key was one of these.
function frameKey(state, key) {
  const arrows = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  if (key in arrows) {
    if (Number(state.set.draft?.zoom) > 1) {
      // Seeing more to the right is the picture moving left: a drag the other way, one percent long.
      const [cx, cy] = dragToCentre(-arrows[key][0], -arrows[key][1], { ...frameGeometry(state), share: [1, 1], width: 100, height: 100 });
      const d = state.set.draft;
      setCentre(state, ...clampCentre(state, Number(d.centre_x ?? 50) + cx, Number(d.centre_y ?? 50) + cy));
    }
    return true;
  }
  if (key === "+" || key === "=") zoomBy(state, 1);
  else if (key === "-" || key === "_") zoomBy(state, -1);
  else if (key === "0") fit(state);
  else return false;
  return true;
}

function resetViewZoom(state) {
  setViewZoom(state, 1, 0, 0);
}

function setViewZoom(state, zoom, panX, panY) {
  const vt = state.viewTools;
  vt.zoom = Math.max(1, Math.min(5, Number(zoom.toFixed(2))));
  if (vt.zoom === 1) {
    vt.panX = 0;
    vt.panY = 0;
  } else {
    // Pan is in screen pixels and stops where the picture's edge meets the frame's.
    const frame = camFrame(state);
    const room = (size) => (size > 0 ? ((vt.zoom - 1) * size) / 2 : Infinity);  // not measured (not shown): no limit
    const mx = room(frame?.clientWidth);
    const my = room(frame?.clientHeight);
    vt.panX = Math.round(Math.max(-mx, Math.min(mx, panX)));
    vt.panY = Math.round(Math.max(-my, Math.min(my, panY)));
  }
  applyViewTools(state);
}

function toggleFullscreen(state) {
  if (state.fsClose) {
    state.fsClose();
    return;
  }
  const frame = state.camBox?.querySelector(".ws-cam-frame");
  if (!frame) return;

  if (typeof frame.requestFullscreen === "function") {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      frame.requestFullscreen().catch(() => {});
    }
    return;
  }

  // iOS Safari has no element full screen: the frame itself moves into a fixed overlay and back on Close, so the picture
  // keeps its one stream and the bars come with it (A23 plan decision 5).
  const home = { parent: frame.parentNode, next: frame.nextSibling };
  const opener = document.activeElement;
  const overlay = h("div", { class: "ws-cam-fullscreen-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Room view, full screen" });
  const closeBtn = h("button", { type: "button", class: "ws-cam-fs-close", dataset: { key: "cam-fs-close" } }, "Close ✕");
  const onKey = (e) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // Focus stays in the overlay while it is open (DESIGN.md: dialogs trap focus).
    const all = [...overlay.querySelectorAll("button:not([disabled]), [tabindex='0']")];
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    state.fsFrame = null;
    state.fsClose = null;
    if (home.parent?.isConnected) home.parent.insertBefore(frame, home.next?.parentNode === home.parent ? home.next : null);
    mountBars(state);
    if (opener?.isConnected) opener.focus?.();
  };
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  overlay.append(closeBtn, frame);
  document.body.append(overlay);
  state.fsFrame = frame;
  state.fsClose = close;
  mountBars(state);
  closeBtn.focus?.();
}

function attachViewingHandlers(state, frame, img, histCanvas) {
  const vt = state.viewTools;

  // Keyboard navigation for zoom & pan (when frame or img focused)
  frame.tabIndex = 0;
  frame.addEventListener("keydown", (e) => {
    if (e.target !== frame) return;  // a key on a bar's button is that button's
    if (state.bars?.el.parentNode === frame) {
      if (frameKey(state, e.key)) e.preventDefault();
      return;
    }
    let handled = false;
    if (e.key === "+" || e.key === "=") {
      setViewZoom(state, vt.zoom + 0.5, vt.panX, vt.panY);
      handled = true;
    } else if (e.key === "-" || e.key === "_") {
      setViewZoom(state, vt.zoom - 0.5, vt.panX, vt.panY);
      handled = true;
    } else if (e.key === "0") {
      resetViewZoom(state);
      handled = true;
    } else if (e.key === "ArrowLeft") {
      setViewZoom(state, vt.zoom, vt.panX + 20, vt.panY);
      handled = true;
    } else if (e.key === "ArrowRight") {
      setViewZoom(state, vt.zoom, vt.panX - 20, vt.panY);
      handled = true;
    } else if (e.key === "ArrowUp") {
      setViewZoom(state, vt.zoom, vt.panX, vt.panY + 20);
      handled = true;
    } else if (e.key === "ArrowDown") {
      setViewZoom(state, vt.zoom, vt.panX, vt.panY - 20);
      handled = true;
    }
    if (handled) {
      e.preventDefault();
    }
  });

  // Pointer events for pinch & pan
  let activePointers = new Map();
  let initialDist = 0;
  let initialZoom = 1;
  let startX = 0, startY = 0;
  let initialPanX = 0, initialPanY = 0;

  frame.addEventListener("pointerdown", (e) => {
    if (e.target?.closest?.(".ws-bars")) return;  // a tap on a bar is a click, never captured as a pan
    if (state.bars?.el.parentNode === frame) {  // adjusting: one finger frames the camera; pinch does nothing
      frameDragStart(state, e);
      frame.setPointerCapture?.(e.pointerId);
      return;
    }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
      startX = e.clientX;
      startY = e.clientY;
      initialPanX = vt.panX;
      initialPanY = vt.panY;
    } else if (activePointers.size === 2) {
      const [p1, p2] = [...activePointers.values()];
      initialDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      initialZoom = vt.zoom;
    }
    frame.setPointerCapture?.(e.pointerId);
  });

  frame.addEventListener("pointermove", (e) => {
    if (state.drag) frameDragMove(state, e);
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      const [p1, p2] = [...activePointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (initialDist > 0) {
        const factor = dist / initialDist;
        setViewZoom(state, initialZoom * factor, vt.panX, vt.panY);
      }
    } else if (activePointers.size === 1 && vt.zoom > 1) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setViewZoom(state, vt.zoom, initialPanX + dx, initialPanY + dy);
    }
  });

  const onPointerEnd = (e) => {
    frameDragEnd(state, e.pointerId);
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) initialDist = 0;
  };
  frame.addEventListener("pointerup", onPointerEnd);
  frame.addEventListener("pointercancel", onPointerEnd);

  // If histogram is active, run sampling
  if (vt.hist) {
    sampleHistogram(img, histCanvas);
  }
}

function startHistogram(state) {
  stopHistogram(state);
  state.viewTools.histTimer = setInterval(() => {
    if (document.hidden) return;
    const img = camFrame(state)?.querySelector("img.room-img");
    const canvas = camFrame(state)?.querySelector(".ws-hist-canvas");
    if (img && canvas && !canvas.hidden) {
      sampleHistogram(img, canvas);
    }
  }, 500); // 2 samples per second (500ms)
}

function stopHistogram(state) {
  if (state.viewTools?.histTimer) {
    clearInterval(state.viewTools.histTimer);
    state.viewTools.histTimer = null;
  }
}

function sampleHistogram(img, canvas) {
  if (!img || !canvas || typeof canvas.getContext !== "function") return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width || 160;
  const h = canvas.height || 120;

  try {
    // Draw scaled down copy
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 256 luminance bins
    const bins = new Uint32Array(256);
    let maxBin = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Rec. 601 luminance
      const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      bins[y]++;
      if (bins[y] > maxBin) maxBin = bins[y];
    }

    // Clear and draw histogram curve / bars
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, w, h);

    if (maxBin > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      for (let x = 0; x < w; x++) {
        const binIdx = Math.floor((x / w) * 256);
        const val = bins[binIdx];
        const barH = Math.round((val / maxBin) * (h - 4));
        ctx.fillRect(x, h - barH, 1, barH);
      }
    }
  } catch {
    // CORS or security error if canvas tainted
  }
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
  // A redraw takes the bars off the picture and mountBars puts them back after it, so a bar's focus is restored here.
  const active = document.activeElement;
  const barKey = state.bars?.el.contains(active) ? active.dataset?.key : null;
  redraw(state, "cam", state.camView, sig, () => { state.fsClose?.(); state.camView.replaceChildren(cameraAside(state.cam, {
    room: state.room, pref: state.camPref, live: state.live, state,
    onPick: (view) => {
      state.camPref = view;
      writeCamPref(view);
      if (view !== "room") stopLive(state, "", false);
      drawCam(state);
    },
    onLive: () => (state.live.on ? stopLive(state, "") : startLive(state)),
  })); });
  const live = liveImg(state);
  if (live) {
    live.onerror = () => liveFailed(state);
    live.onload = () => liveArrived(state);
  }
  // The note sits under the live button when there is one, and is otherwise kept out of the page (and so silent).
  const spot = state.camBox.querySelector(".ws-cam-live");
  if (spot && state.camNote.parentNode !== spot) spot.append(state.camNote);
  else if (!spot) state.camNote.remove();
  if (state.camNote.textContent !== (state.live.note || "")) state.camNote.textContent = state.live.note || "";
  drawSettings(state);
  if (barKey && !state.bars.el.contains(document.activeElement)) state.bars.el.querySelector(`[data-key="${barKey}"]`)?.focus();
}

// The picture's frame wherever it is shown: the page's aside, or the iPhone full-screen overlay.
function camFrame(state) {
  return state.fsFrame || state.camBox?.querySelector(".ws-cam-frame") || null;
}

function liveImg(state) {
  const img = camFrame(state)?.querySelector("img.room-img");
  return img && !img.dataset.refresh ? img : null;
}

function startLive(state) {
  clearTimeout(state.liveTimer);
  state.live = { on: true, note: "" };
  state.liveFrame = false;
  state.liveTimer = setTimeout(() => stopLive(state, LIVE_PAUSED), LIVE_MS);
  drawCam(state);
}

// Closing the stream: the img lets go of its connection when its src goes, so the Pi's camera can stop.
function stopLive(state, note, draw = true) {
  clearTimeout(state.liveTimer);
  const img = liveImg(state);
  if (img) { img.onerror = null; img.onload = null; img.removeAttribute("src"); }
  state.live = { on: false, note };
  state.liveFrame = false;
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

