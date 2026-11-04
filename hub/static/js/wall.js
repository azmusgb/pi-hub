// The wall display's words and numbers (wall fits any screen, 26 Oct): data in, plain models out, so the page and the
// tests agree. No DOM here; now.js draws them.

const TONES = ["bad", "attention", "warn"];

// The time as "12:38" and a separate "PM", so the page can keep the time on one line with a small day period.
// 24-hour locales have no day period: `ampm` is "".
export function clockParts(d = new Date(), locale = undefined) {
  const parts = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).formatToParts(d);
  const ampm = parts.filter((p) => p.type === "dayPeriod").map((p) => p.value).join("").trim();
  const hm = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  return { hm, ampm };
}

// The Needs you tile, from the list Home already fetches (/api/needs): the top items in the order the hub gives them.
// `needs` undefined = not answered yet; null = the check failed.
export function wallNeeds(needs, max = 5) {
  if (needs === undefined) return { tone: "none", status: "Checking…", items: [], more: 0, clear: false };
  if (!needs) return { tone: "warn", status: "Couldn't check what needs you", items: [], more: 0, clear: false };
  const items = Array.isArray(needs.items) ? needs.items : [];
  const count = Number(needs.count) || items.length;
  const unread = needs.unread?.length ? `Couldn't check ${needs.unread.join(" or ")}` : "";
  if (!count) {
    return unread
      ? { tone: "warn", status: unread, items: [], more: 0, clear: false }
      : { tone: "ok", status: "All clear", items: [], more: 0, clear: true };
  }
  const tone = TONES.find((t) => items.some((i) => i.tone === t)) || "warn";
  const shown = items.slice(0, max);
  return { tone, status: `${count} ${count === 1 ? "thing" : "things"}`, items: shown, more: Math.max(0, count - shown.length),
    clear: false, note: unread };
}

// The next few hours of the forecast, from this hour on.
export function nextHours(hours, now = new Date(), n = 6) {
  if (!Array.isArray(hours)) return [];
  const start = new Date(now); start.setMinutes(0, 0, 0);
  return hours.filter((x) => {
    const t = new Date(x.time);
    return Number.isNaN(t.getTime()) || t >= start;
  }).slice(0, n);
}

// What is on today and later (the calendar from /api/outside): all-day events and those not yet half an hour past.
export function upcoming(events, now = Date.now(), n = 4) {
  if (!Array.isArray(events)) return [];
  return events.filter((e) => e.all_day || e.start * 1000 > now - 30 * 60000).slice(0, n);
}

// The printer counts as busy (its tile gets the most room) while it prints or is paused mid-print.
export const printing = (p) => p?.state === "printing" || p?.state === "paused";

// The desk layout (an iPad beside a desk, 27 Oct): the camera large, the rest small. `?layout=desk` turns it on and the
// device remembers it; `?layout=wall` turns it off. Nothing else changes a display's layout, so a wall stays a wall.
export function wallLayout(search = "", stored = null) {
  const asked = new URLSearchParams(search).get("layout");
  if (asked === "desk" || asked === "wall") return { layout: asked, remember: asked };
  return { layout: stored === "desk" ? "desk" : "wall", remember: null };
}

// The desk's way to the hub's print lab: the experiment printing when the hub knows it, and "Judge" once it's done.
export function deskLab(p) {
  const id = typeof p?.lab?.experiment === "string" && /^E-\d{1,6}$/.test(p.lab.experiment) ? p.lab.experiment : null;
  const judge = p?.state === "finished";
  const label = judge ? `Judge ${id || "it"} in the print lab` : `Print lab${id ? `: ${id}` : ""}`;
  return { label, href: id ? `/lab?e=${id}${judge ? "&do=judge" : ""}` : "/lab", judge };
}

// The workshop light on the wall and desk: a light in the Workshop room, else none. Never "any light", which would
// quietly put another room's lamp behind the Workshop switch. (The light pinned here by id until 1 Nov was the
// master bedroom's Floor Lamp; the workshop has no light in Homebridge now, so the card stays away.)
export function shopLight(accessories) {
  const lights = (accessories || []).filter((a) => a.kind === "light");
  return lights.find((a) => /^workshop$/i.test(a.room || "")) || null;
}

// Preset view configurations and modular pane definitions
export const WALL_VIEWS = [
  { id: "workshop", label: "🛠️ Workshop Focus", hero: "printer", side: ["needs", "extra", "controls", "network"], desc: "3D printer camera, telemetry, and workshop switch" },
  { id: "ambient", label: "🏠 Ambient Home", hero: "printer", side: ["needs", "extra", "home_cards"], desc: "Glanceable overview cards for the house" },
  { id: "media", label: "🎬 Media & Entertainment", hero: "media", side: ["needs", "extra", "controls"], desc: "Plex now playing, library, and room controls" },
  { id: "agenda", label: "📅 Family & Agenda", hero: "calendar", side: ["needs", "extra", "controls", "network"], desc: "Today's calendar events, agenda, and weather" },
  { id: "ops", label: "🖥️ System & Ops", hero: "ops", side: ["needs", "controls", "printer_mini"], desc: "Network latency waterfall, Pi health, and drives" },
  { id: "custom", label: "⚙️ Custom Layout", hero: "custom", side: ["custom"], desc: "Personalized pane and widget selection" },
];

export const DEFAULT_CUSTOM_CONFIG = {
  hero: "printer",
  side: ["needs", "extra", "controls", "network"],
};

export const HERO_OPTIONS = [
  { id: "printer", label: "🖨️ Bambu 3D Printer & Camera", desc: "Live camera stream, telemetry HUD, and print progress" },
  { id: "media", label: "🎬 Media & Plex", desc: "Now playing, movie library stats, and theater controls" },
  { id: "calendar", label: "📅 Family & Agenda", desc: "Daily schedule, upcoming appointments, and weather summary" },
  { id: "ops", label: "🖥️ System & Network Ops", desc: "Network latency breakdown, Pi thermals, and drive health" },
  { id: "weather", label: "⛅ Weather & Forecast", desc: "Current conditions, temperature trends, and forecast" },
];

export const SIDE_OPTIONS = [
  { id: "needs", label: "Needs you", desc: "Action items and active house alerts", defaultChecked: true },
  { id: "extra", label: "Next hours", desc: "Hourly weather forecast pills", defaultChecked: true },
  { id: "controls", label: "Smart controls", desc: "Workshop light and quick device switches", defaultChecked: true },
  { id: "network", label: "Network status", desc: "Internet health and latency breakdown", defaultChecked: true },
  { id: "calendar", label: "Upcoming events", desc: "Next appointments and calendar reminders", defaultChecked: false },
  { id: "media", label: "Media card", desc: "Now playing or latest movie", defaultChecked: false },
  { id: "system", label: "System & backups", desc: "Disk capacity and backup status", defaultChecked: false },
  { id: "printer_mini", label: "3D printer mini", desc: "Compact print progress and temperatures", defaultChecked: false },
  { id: "home_cards", label: "Home cards", desc: "Ambient overview cards for the house", defaultChecked: false },
];

export function getWallView(stored = null) {
  const v = stored || "workshop";
  return WALL_VIEWS.some((w) => w.id === v) ? v : "workshop";
}

export function getWallCustomConfig(stored = null) {
  if (!stored) return { ...DEFAULT_CUSTOM_CONFIG };
  try {
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    const hero = HERO_OPTIONS.some((h) => h.id === parsed?.hero) ? parsed.hero : DEFAULT_CUSTOM_CONFIG.hero;
    const validSideIds = new Set(SIDE_OPTIONS.map((s) => s.id));
    const side = Array.isArray(parsed?.side) && parsed.side.length
      ? parsed.side.filter((s) => validSideIds.has(s))
      : DEFAULT_CUSTOM_CONFIG.side;
    return { hero, side };
  } catch {
    return { ...DEFAULT_CUSTOM_CONFIG };
  }
}

export function resolveWallPanes(viewId, customConfig = null) {
  const id = getWallView(viewId);
  const preset = WALL_VIEWS.find((w) => w.id === id) || WALL_VIEWS[0];
  if (id === "custom") {
    const cfg = getWallCustomConfig(customConfig);
    return {
      id: "custom",
      label: "⚙️ Custom Layout",
      hero: cfg.hero,
      side: cfg.side,
    };
  }
  return {
    id: preset.id,
    label: preset.label,
    hero: preset.hero,
    side: [...preset.side],
  };
}

