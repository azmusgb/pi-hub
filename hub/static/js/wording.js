// Plain words for things the hub reads from other systems (the 25 Oct page critique). Pure, so tests pin the copy.

export function agoText(hours) {
  if (!Number.isFinite(hours)) return "never";
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// Homebridge brings some appliances in as one switch per function (the Bosch dishwasher: power, "active program" and a
// switch per program). Only appliances named here are grouped: three switches from one maker are not an appliance.
const APPLIANCE_NAMES = { Bosch: "Dishwasher" };

// Devices Homebridge names by a raw hardware id (the Govee plugin uses the device id while its Govee login fails),
// keyed by that name. Matched to the Govee app by model (1 Nov): H805A, the two H3751s (10.0.0.29, 10.0.0.36).
const DEVICE_NAMES = {
  "0EEAC47545E6515C": "Permanent Lights",
  "0EFBEA1B882AED13": "Wall Light Pro 1",
  "0F8CE1F8C532B55B": "Wall Light Pro 2",
};

// An appliance's switch shown on its own (a favourite) says which appliance it belongs to.
// A light, plug, switch or fan's state line. An on/off Homebridge didn't report is "No answer" and not known, so the
// tile can't be toggled from an assumed state (unknown is never Off).
export function tileState(a) {
  if (a?.on !== true && a?.on !== false) return { text: "No answer", known: false, on: null };
  if (!a.on) return { text: "Off", known: true, on: false };
  return { text: a.brightness != null ? `On, ${a.brightness}%` : "On", known: true, on: true };
}

export function applianceLabel(a) {
  if (DEVICE_NAMES[a.name]) return DEVICE_NAMES[a.name];
  const name = APPLIANCE_NAMES[a.room];
  return name && !a.name.toLowerCase().startsWith(name.toLowerCase()) ? `${name}: ${a.name}` : a.name;
}

// The only switch an appliance card offers is its power. Its programs and "running" switch stay in its status line:
// with remote start allowed, one stray tap on a program switch starts a wash (1 Nov). A switch already in Favourites
// isn't repeated here.
export function applianceControls(ap, favs = new Set()) {
  return ap.power && !favs.has(ap.power.id) ? [ap.power] : [];
}

export function groupAppliances(accessories) {
  const byRoom = new Map();
  for (const a of accessories) {
    if (a.kind === "switch" && APPLIANCE_NAMES[a.room]) byRoom.set(a.room, [...(byRoom.get(a.room) || []), a]);
  }
  const appliances = [];
  const grouped = new Set();
  for (const [room, list] of byRoom) {
    const name = APPLIANCE_NAMES[room];
    const power = list.find((a) => /\bpower\b/i.test(a.name)) || null;
    const running = list.find((a) => /\bactive\b/i.test(a.name)) || null;
    const programs = list.filter((a) => a !== power && a !== running);
    const chosen = programs.find((p) => p.on);
    const status = [power ? (power.on === true ? "On" : power.on === false ? "Off" : "No answer") : null, running?.on ? "Running" : null,
      chosen ? `${chosen.name} selected` : null].filter(Boolean).join(" · ");
    appliances.push({ name, room, power, running, programs, status });
    list.forEach((a) => grouped.add(a.id));
  }
  return { appliances, rest: accessories.filter((a) => !grouped.has(a.id)) };
}

// One line per machine on the Laundry card (hub/laundry.py reduces LG, GE and Bosch states to these). The hub only reads them.
function minutesText(m) {
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
export function laundryLine(m, clock = (s) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })) {
  const left = m.minutes_left ? ` · ${minutesText(m.minutes_left)} left` : "";
  const said = {
    idle: "idle",
    running: `running${left}`,
    paused: `paused${left}`,
    scheduled: "delayed start",
    done: m.ended_at ? `done at ${clock(m.ended_at)}` : "done",
    fault: "needs attention",
    offline: "not connected",
  }[m.state] || "state unknown";
  return `${m.name}: ${said}`;
}

// A print-log row: Bambuddy's own word for how it ended, in a tone (finished and printing ok, failed bad, the rest warn).
const PRINT_TONES = { completed: "ok", printing: "ok", failed: "bad" };
export function printWords(p) {
  return [p.word || "Unknown", PRINT_TONES[p.status] || "warn"];
}

// Bambuddy's failure_reason is free text; only something that looks like a printer code gets a help link.
export function printErrorCode(error) {
  return typeof error === "string" && /^(HMS_)?[0-9A-F_]{8,}$/i.test(error) ? error.replace(/^HMS_/i, "") : null;
}

// How long a print ran: Bambuddy's own seconds, else start to end; null while it is still going or unknown.
export function printSeconds(p) {
  if (p.status === "printing") return null;
  if (Number.isFinite(p.seconds)) return p.seconds;
  return p.ended && p.started ? p.ended - p.started : null;
}

// The Print history card's pill: the week's finished count, or "No answer" when Bambuddy's log isn't there.
export function weekPill(week) {
  return week ? { pill: `${week.finished} finished this week`, tone: "ok" } : { pill: "No answer", tone: "warn" };
}

export function printLabText(p) {
  return p.lab ? `${p.lab.exp} · ${p.lab.build}` : "Outside the lab";
}

const SLOW_MS = 100;  // as the internet record (things/network.py): wan or dns latency over this is slow

export function plainInternet(net) {
  if (!net || net.status === "unknown") return "Network checks aren't answering";
  if (net.status === "bad") return "Internet down";
  if (net.wan_ms > SLOW_MS || net.dns_ms > SLOW_MS) return "Internet slow";
  // The Orbi's figures are the traffic right now, not the line's speed: "3 Mbps down" read as a slow line (1 Nov).
  const up = Number.isFinite(net.orbi_up_mbps) ? `, ${Math.round(net.orbi_up_mbps * 10) / 10} up` : "";
  const speed = Number.isFinite(net.orbi_down_mbps) ? ` · using ${Math.round(net.orbi_down_mbps)} Mbps down${up}` : "";
  return `Internet OK${speed}`;
}

// The workshop screen's state in the HUD: "on" / "off"; any other word is shown as it came.
export function workshopDisplayLabel(v) {
  const t = String(v ?? "").trim();
  if (/^online$/i.test(t)) return "on";
  if (/^offline$/i.test(t)) return "off";
  return t;
}
