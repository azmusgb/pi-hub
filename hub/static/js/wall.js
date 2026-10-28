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

// The workshop light on the wall and desk: the one with its id, else a light in the Workshop room. Never "any light",
// which would quietly put another room's lamp (the bedroom Govee) behind the Workshop switch.
const SHOP_LIGHT = "27e5e4f8f7746b97a91a0a24384bd30696d4f76a751d582e35a0a4bb767547f6";
export function shopLight(accessories) {
  const lights = (accessories || []).filter((a) => a.kind === "light");
  return lights.find((a) => a.id === SHOP_LIGHT) || lights.find((a) => /^workshop$/i.test(a.room || "")) || null;
}
