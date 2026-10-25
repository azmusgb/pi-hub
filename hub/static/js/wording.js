// Plain words for things the hub reads from other systems (the 25 Oct page critique). Pure, so tests pin the copy.

export function agoText(hours) {
  if (!Number.isFinite(hours)) return "never";
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// Homebridge brings some appliances in as one switch per function (the Bosch dishwasher: power, "active program" and a
// switch per program). Three or more switches from one maker become one appliance card.
const APPLIANCE_NAMES = { Bosch: "Dishwasher" };

export function groupAppliances(accessories) {
  const byRoom = new Map();
  for (const a of accessories) if (a.kind === "switch" && a.room) byRoom.set(a.room, [...(byRoom.get(a.room) || []), a]);
  const appliances = [];
  const grouped = new Set();
  for (const [room, list] of byRoom) {
    if (list.length < 3) continue;
    const name = APPLIANCE_NAMES[room] || room;
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

// Alert pairs that mean "it dropped out, then came back". Many in a day become one line.
const DOWN = [/^(.+) went offline$/, /^(.+) dropped out$/, /^(.+) isn't answering$/, /^(.+) stopped$/];
const UP = [/^(.+) is back$/, /^(.+) is running again$/];
const subjectOf = (title, patterns) => patterns.map((r) => r.exec(title)).find(Boolean)?.[1] || null;
const dayOf = (ts) => new Date(ts * 1000).toDateString();

export function mergeDropouts(alerts) {
  const groups = new Map();  // day|subject → alerts
  for (const a of alerts) {
    const subject = subjectOf(a.title, DOWN) || subjectOf(a.title, UP);
    if (!subject) continue;
    const key = `${dayOf(a.ts)}|${subject}`;
    groups.set(key, [...(groups.get(key) || []), a]);
  }
  const out = [];
  const done = new Set();
  for (const a of alerts) {
    const subject = subjectOf(a.title, DOWN) || subjectOf(a.title, UP);
    const key = subject && `${dayOf(a.ts)}|${subject}`;
    const list = key ? groups.get(key) : null;
    const drops = list ? list.filter((x) => subjectOf(x.title, DOWN)).length : 0;
    if (!list || drops < 2) { out.push(a); continue; }
    if (done.has(key)) continue;
    done.add(key);
    const back = Boolean(subjectOf(list[0].title, UP));  // newest first
    out.push({ ts: list[0].ts, title: `${subject} dropped out ${drops} times`, body: back ? "Back now" : "Still out",
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
  const speed = Number.isFinite(net.orbi_down_mbps)
    ? ` · ${Math.round(net.orbi_down_mbps)} Mbps down, ${Math.round(net.orbi_up_mbps * 10) / 10} up` : "";
  return `Internet OK${speed}`;
}
