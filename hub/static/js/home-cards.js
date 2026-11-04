// Home's cards (one home, "Home cards"): data in, card models out, so the page and the tests agree on the words.
import { toolUrl } from "./sections.js";
import { agoText } from "./wording.js";

const TONES = ["bad", "attention", "warn"];
const SLOW_MS = 100;  // as the internet record (things/network.py)
const STALE_HOURS = 36;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function homeBadge(needs) {
  const n = Number(needs?.count) || 0;
  return n <= 0 ? "" : n > 99 ? "99+" : String(n);
}

function needsCard(needs) {
  if (needs === undefined) return null;  // not asked yet
  if (!needs) {
    return { key: "needs", title: "Needs you", tone: "warn", count: 0, status: "Couldn't check what needs you",
      items: [], note: "", action: null, link: null };
  }
  if (!needs.count && needs.unread?.length) {
    return { key: "needs", title: "Needs you", tone: "warn", count: 0, status: `Couldn't check ${needs.unread.join(" or ")}`,
      items: [], note: "", action: null, link: null };
  }
  if (!needs.count) return null;
  const tone = TONES.find((t) => needs.items.some((i) => i.tone === t)) || "warn";
  return {
    key: "needs", title: "Needs you", tone, count: needs.count, status: plural(needs.count, "thing"),
    items: needs.items, note: needs.unread?.length ? `Couldn't check ${needs.unread.join(" or ")}.` : "",
    action: null, link: null,  // each item is its own action
  };
}

// Home's summary line. Needs you's count is said once on the card and once on the nav badge, so the line never repeats it
// (IMG_1047, 28 Oct: "2" three times). With something listed it has nothing to add: "" and the page hides the line. With
// nothing listed, or no answer, `fallback` (the hub's own line, "Everything's running") stands.
export function needsSummary(needs, fallback) {
  const n = Number.isInteger(needs?.count) ? needs.count : (needs?.items || []).length;
  return needs && n ? "" : fallback;
}

// The hub's /lab page for the experiment printing now (the hub reads it from Local AI's lab list), or null.
export function labLink(p) {
  const id = p?.lab?.experiment;
  if (typeof id !== "string" || !/^E-\d{1,6}$/.test(id)) return null;
  return { label: `Print lab: ${id}`, href: `/lab?e=${id}` };
}

// The printer card's tone with Needs you: red for a bad item about the printer, amber (warn) for any other, so the
// card never stays green while Needs you says the printer has a problem (IMG_1047, 28 Oct). Never softens a card.
function withNeeds(tone, needs) {
  const mine = (needs?.items || []).filter((i) => i?.about === "printer");
  if (mine.some((i) => i.tone === "bad")) return "bad";
  return mine.length && tone === "ok" ? "warn" : tone;
}

function workshopCard(p, at, host, needs) {
  const lab = labLink(p);
  const done = Number.isFinite(p?.minutes_left)
    ? new Date(at.getTime() + p.minutes_left * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const status = p?.state === "printing" ? `Printing, ${p.progress}%${done ? ` · done ${done}` : ""}`
    : p?.state === "paused" ? `Paused at ${p.progress}%`
    : p?.state === "error" ? "Needs attention"
    : p?.state === "idle" || p?.state === "stopped" ? "Idle"
    : "Bambuddy isn't answering";
  const tone = p?.state === "error" ? "bad" : ["printing", "idle", "stopped"].includes(p?.state) ? "ok" : "warn";
  if (p?.actions?.includes("clear")) {  // finished or failed: the plate comes first
    return { key: "workshop", title: "Bambu X2D", status: p.headline, tone: withNeeds(p.state === "error" ? "bad" : "warn", needs),
      action: { label: "Clear the plate", do: "clear" }, link: { label: "Workshop", href: "/workshop" }, lab };
  }
  return { key: "workshop", title: "Bambu X2D", status, tone: withNeeds(tone, needs),
    action: { label: "Open Bambuddy ↗", href: toolUrl("bambuddy", host) }, link: { label: "Workshop", href: "/workshop" }, lab };
}

function mediaCard(movies, latest) {
  const playing = movies?.playing;
  const now = playing == null ? "Plex isn't answering" : playing.length ? `Now playing: ${playing[0].title}` : "Nothing playing";
  return { key: "media", title: "Media", status: latest?.title ? `${now} · Latest: ${latest.title}` : now,
    tone: playing == null ? "warn" : "ok", action: { label: "Watch a movie", href: "/media" }, link: null };
}

function networkCard(net, home) {
  const on = (home?.accessories || []).filter((a) => a.on).length;
  const internet = !net || net.status === "unknown" ? null
    : net.status === "bad" ? ["Internet down", "bad"]
    : net.wan_ms > SLOW_MS || net.dns_ms > SLOW_MS ? ["Internet slow", "warn"] : ["Internet OK", "ok"];
  const devices = home?.connected ? ` · ${plural(on, "device")} on` : "";
  return { key: "network", title: "Home & network",
    status: internet ? internet[0] + devices : "Network checks aren't answering", tone: internet ? internet[1] : "warn",
    action: { label: "Control devices", href: "/network" }, link: null };
}

function systemCard(backups, pi) {
  const hours = (backups?.repos || []).map((r) => r.hours).filter(Number.isFinite);
  const worst = backups?.available && hours.length === backups.repos.length ? Math.max(...hours) : null;
  const temp = Number.isFinite(pi?.temp) ? ` · Pi ${Math.round(pi.temp)} °C` : "";
  return { key: "system", title: "System",
    status: (backups === undefined ? "Checking backups…" : worst === null ? "Backups unknown" : `Backed up ${agoText(worst)}`) + temp,
    tone: backups === undefined ? "none" : worst === null || worst > STALE_HOURS ? "warn" : "ok",
    action: { label: "Restore a file", href: "/system" }, link: null };
}

export function assistantCard(ai, host, needs) {
  const state = ai?.state || "Unknown";
  const down = state === "Down";
  const busy = state === "Busy";
  const ready = state === "Ready";
  const status = down ? "Local AI is down · PC may be off"
    : busy ? "Local AI is busy with a task"
    : ready ? "Local AI is ready"
    : "Checking Local AI status…";
  const tone = down ? "warn" : ready || busy ? "ok" : "warn";
  return {
    key: "assistant",
    title: "Local AI",
    status,
    tone: withNeeds(tone, needs),
    action: { label: down ? "Open Assistant" : "Ask Assistant", href: "/assistant" },
    link: { label: "Health", href: "/system" },
  };
}

// `undefined` for needs, backups or latest means "not answered yet": Home shows its cards at once and fills these in.
// Every card but Needs you has one main action; Needs you's items are its actions.
// `problems`: Home shows the control room's Problems list, which already holds every Needs you item, so no Needs you card.
export function homeCards({ now, needs, backups, home, latest, at = new Date(), host = globalThis.location?.hostname || "", problems = false }) {
  return [
    problems ? null : needsCard(needs),
    workshopCard(now?.printer, at, host, needs),
    assistantCard(now?.workshop?.ai || now?.ai, host, needs),
    { key: "documents", title: "Documents", status: "Search Paperless or scan a page", tone: "ok",
      action: { label: "Find a document", href: "/documents" }, link: { label: "Scan ↗", href: toolUrl("scan", host) } },
    mediaCard(now?.movies, latest),
    networkCard(now?.network, home),
    systemCard(backups, now?.pi),
  ].filter(Boolean);
}
