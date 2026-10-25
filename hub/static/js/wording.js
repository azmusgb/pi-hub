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

// An appliance's switch shown on its own (a favourite) says which appliance it belongs to.
export function applianceLabel(a) {
  const name = APPLIANCE_NAMES[a.room];
  return name && !a.name.toLowerCase().startsWith(name.toLowerCase()) ? `${name}: ${a.name}` : a.name;
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
    const status = [power ? (power.on ? "On" : "Off") : null, running?.on ? "Running" : null,
      chosen ? `${chosen.name} selected` : null].filter(Boolean).join(" · ");
    appliances.push({ name, room, power, running, programs, status });
    list.forEach((a) => grouped.add(a.id));
  }
  return { appliances, rest: accessories.filter((a) => !grouped.has(a.id)) };
}

// Alert pairs that mean "it dropped out, then came back". Only subjects that have a recovery alert are merged (a
// stopped print or a Plex crash has none, and stays as it is). Many dropouts in a day become one line, and whether
// it is back now is judged from that subject's newest alert, even if that came after midnight.
const DOWN = [/^(.+) went offline$/, /^(.+) dropped out$/, /^(.+) isn't answering$/, /^(.+) is down$/, /^(.+) stopped$/];
const UP = [/^(.+) is back$/, /^(.+) is running again$/];
const subjectOf = (title, patterns) => patterns.map((r) => r.exec(title)).find(Boolean)?.[1] || null;
const dayOf = (ts) => new Date(ts * 1000).toDateString();

export function mergeDropouts(alerts) {
  const recovers = new Set(alerts.map((a) => subjectOf(a.title, UP)).filter(Boolean));
  const subject = (a) => {
    const s = subjectOf(a.title, DOWN) || subjectOf(a.title, UP);
    return s && recovers.has(s) ? s : null;
  };
  const newest = new Map();  // subject → its newest alert (alerts come newest first)
  const groups = new Map();  // day|subject → alerts
  for (const a of alerts) {
    const s = subject(a);
    if (!s) continue;
    if (!newest.has(s)) newest.set(s, a);
    const key = `${dayOf(a.ts)}|${s}`;
    groups.set(key, [...(groups.get(key) || []), a]);
  }
  const out = [];
  const done = new Set();
  for (const a of alerts) {
    const s = subject(a);
    const key = s && `${dayOf(a.ts)}|${s}`;
    const list = key ? groups.get(key) : null;
    const drops = list ? list.filter((x) => subjectOf(x.title, DOWN)).length : 0;
    if (!list || drops < 2) { out.push(a); continue; }
    if (done.has(key)) continue;
    done.add(key);
    const back = Boolean(subjectOf(newest.get(s).title, UP));
    out.push({ ts: list[0].ts, title: `${s} dropped out ${drops} times`, body: back ? "Back now" : "Still out",
      tag: back ? "warning" : "rotating_light", count: 1 });
  }
  return out;
}

export function printOutcome(p) {
  if (!p.ended || !p.started) return null;
  return p.ended - p.started < 60 ? ["Cancelled at start", "warn"] : null;
}

export function plainInternet(net) {
  if (!net || net.status === "unknown") return "Network checks aren't answering";
  if (net.status === "bad") return "Internet down";
  if (net.wan_ms > 150) return "Internet slow";
  const up = Number.isFinite(net.orbi_up_mbps) ? `, ${Math.round(net.orbi_up_mbps * 10) / 10} up` : "";
  const speed = Number.isFinite(net.orbi_down_mbps) ? ` · ${Math.round(net.orbi_down_mbps)} Mbps down${up}` : "";
  return `Internet OK${speed}`;
}
