// Home (amendment A8): the Today band, Needs you beside a rack of systems, one layout from phone to TV.
// Plan 2026-11-05-a8-home-dashboard, P2. The wall (/wall) keeps its own board in now.js.
import { clockTime, h } from "./core.js";
import { printerButtons } from "./printer-actions.js";
import { printLabUrl, resolveLink } from "./sections.js";
import { RECORD_LABELS, actionNames, mergeProblems, printerNow, recordPath, recordTone, renderProblems,
  splitNowRecords } from "./control-room.js";

const SVG = "http://www.w3.org/2000/svg";
const NARROW = 520;  // below this (a phone; not the TV, whose zoom leaves the band near 600) names go above the tracks
const RACK_IDS = new Set(["printer", "pi", "internet", "adguard", "pc", "local_ai", "backups", "movies_drive", "movie_copy"]);

// The kit's phrase for a source that didn't answer (phrase key source_down), the same words on every surface.
export function sourceDown(name) {
  const phrase = globalThis.ApplianceNeeds?.PHRASES?.source_down || "{name} isn't answering";
  return phrase.replace("{name}", name);
}

// ---- Today ----

const t = (ts) => clockTime(ts);

// When a mark happened, in words: a point is its time; a span its range; one that began before midnight says "until";
// one still going says "since"; the running print adds its finish.
export function markWhen(m, day) {
  if (Number.isFinite(m.at)) return t(m.at);
  if (Number.isFinite(m.until)) return m.start < m.end ? `since ${t(m.start)}, done ${t(m.until)}` : `done ${t(m.until)}`;
  const open = m.end >= day.now;
  if (m.start <= day.start) return open ? "since before midnight" : `until ${t(m.end)}`;
  return open ? `since ${t(m.start)}` : `${t(m.start)} to ${t(m.end)}`;
}

const SHORT_HOUR = (h) => (h % 24 === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);
const LONG_HOUR = (h) => (h % 24 === 0 ? "Midnight" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);

// The band's geometry at a pixel width: pure, so it can be tested without a browser. Hours are placed by the day's
// real length (a DST day is 23 or 25 hours), and an hour label too close to Now gives way to it.
export function bandLayout(day, width) {
  const W = Math.max(240, Math.round(width));
  const narrow = W < NARROW;
  const LABEL = narrow ? 0 : 132, PAD = narrow ? 2 : 16, TOP = 24;
  const NAME = narrow ? 18 : 0, ROW = narrow ? 44 : 36, BAR = narrow ? 14 : 16;
  const span = Math.max(1, day.end - day.start);
  const x = (ts) => LABEL + (Math.min(Math.max(ts, day.start), day.end) - day.start) / span * (W - LABEL - PAD);
  const nowX = x(day.now);
  const step = narrow ? 6 : W > 1100 ? 2 : W > 800 ? 3 : 6;  // labels every 2, 3 or 6 hours, never touching
  const hours = [];
  for (let i = 0; i * 3600 <= span; i++) {
    const ts = day.start + i * 3600;
    const major = i % step === 0;
    const label = major && Math.abs(x(ts) - nowX) > (narrow ? 34 : 44) ? (narrow ? SHORT_HOUR(i) : LONG_HOUR(i)) : "";
    hours.push({ x: x(ts), major, label, anchor: i === 0 ? "start" : (i + 1) * 3600 > span ? "end" : "middle" });
  }
  const lanes = (day.lanes || []).map((lane, i) => {
    const top = TOP + i * ROW;
    const cy = top + NAME + (ROW - NAME) / 2;
    return {
      id: lane.id, label: lane.label, available: lane.available, source: lane.source,
      labelX: 0, labelY: narrow ? top + 13 : cy + 4, cy,
      marks: lane.marks.map((m) => {
        const a = Number.isFinite(m.at) ? m.at : m.start, b = Number.isFinite(m.at) ? m.at : (m.until || m.end);
        return {
          ...m,
          x: x(Number.isFinite(m.at) ? m.at : m.start),
          w: Number.isFinite(m.at) ? 0 : Math.max(4, x(m.end) - x(m.start)),
          ghost: Number.isFinite(m.until) ? { x: x(m.end), w: Math.max(0, x(m.until) - x(m.end)) } : null,
          // a finger-sized target around every mark, however thin it is drawn (at least 24 × 40)
          hit: { x: Math.min(x(a), x(b)) - 12, w: Math.max(24, x(b) - x(a) + 24), y: cy - 20, h: 40 },
        };
      }),
    };
  });
  return { width: W, height: TOP + lanes.length * ROW + 4, narrow, top: TOP, bar: BAR, nowX, nowLabelEnd: nowX + 40 > W, hours, lanes };
}

function svg(tag, attrs, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}

// Draws the band into `host` at its own width. `onMark(lane, mark)` is called on hover, focus or tap.
export function drawBand(host, day, width, onMark) {
  const L = bandLayout(day, width);
  const root = svg("svg", { class: "hd-band__svg", viewBox: `0 0 ${L.width} ${L.height}`, width: L.width, height: L.height,
    role: "group", "aria-label": "Today from midnight, one row per system" });
  const defs = svg("defs", {}, root);
  const pat = svg("pattern", { id: "hd-hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hd-band__hatch" }, pat);
  for (const hr of L.hours) {
    svg("line", { x1: hr.x, x2: hr.x, y1: L.top - (hr.major ? 6 : 2), y2: L.height - 4, class: hr.major ? "hd-band__grid" : "hd-band__grid hd-band__grid--minor" }, root);
    if (hr.label) svg("text", { x: hr.x, y: 13, class: "hd-band__hour", "text-anchor": hr.anchor }, root).textContent = hr.label;
  }
  const marks = {};
  for (const lane of L.lanes) {
    svg("text", { x: lane.labelX, y: lane.labelY, class: "hd-band__lane" }, root).textContent = lane.label;
    const trackX = L.narrow ? 0 : 132;
    svg("rect", { x: trackX, y: lane.cy - L.bar / 2, width: Math.max(0, L.width - trackX - (L.narrow ? 2 : 16)), height: L.bar, rx: 3, class: "hd-band__track" }, root);
    if (!lane.available) {
      svg("text", { x: trackX + 8, y: lane.cy + 4, class: "hd-band__down" }, root).textContent = sourceDown(lane.source);
      continue;
    }
    marks[lane.id] = lane.marks.map((m) => {
      const label = `${lane.label}: ${m.title}, ${markWhen(m, day)}`;
      const g = svg("g", { class: "hd-band__mark", tabindex: "0", role: "img", "aria-label": label }, root);
      const say = () => onMark?.(lane, m);
      g.addEventListener("mouseenter", say);
      g.addEventListener("focus", say);
      g.addEventListener("click", say);
      svg("rect", { x: m.hit.x, y: m.hit.y, width: m.hit.w, height: m.hit.h, class: "hd-band__hit" }, g);
      if (m.w === 0) {
        svg("circle", { cx: m.x, cy: lane.cy, r: 12, class: "hd-band__halo" }, g);
        svg("rect", { x: m.x - 3.5, y: lane.cy - L.bar / 2 - 3, width: 7, height: L.bar + 6, rx: 2, class: `hd-band__fill hd-k-${m.kind}` }, g);
      } else {
        if (m.ghost) svg("rect", { x: m.ghost.x, y: lane.cy - L.bar / 2 + 0.75, width: m.ghost.w, height: L.bar - 1.5, rx: 3, class: "hd-band__ghost" }, g);
        svg("rect", { x: m.x, y: lane.cy - L.bar / 2, width: m.w, height: L.bar, rx: 3, class: `hd-band__fill hd-k-${m.kind}` }, g);
      }
      return g;
    });
  }
  svg("rect", { x: L.nowX, y: L.top - 6, width: Math.max(0, L.width - (L.narrow ? 2 : 16) - L.nowX), height: L.height - L.top + 2, class: "hd-band__future" }, root);
  svg("line", { x1: L.nowX, x2: L.nowX, y1: L.top - 8, y2: L.height - 2, class: "hd-band__now" }, root);
  svg("text", { x: L.nowLabelEnd ? L.nowX - 6 : L.nowX + 6, y: 13, class: "hd-band__nowlabel", "text-anchor": L.nowLabelEnd ? "end" : "start" }, root).textContent = "Now";
  host.replaceChildren(root);
  return { marks, layout: L };
}

const COUNTS = [["finished", "prints finished", "ok"], ["failed", "failed", "bad"], ["power", "power dips", "warn"], ["updates", "updates shipped", "run"]];

export function countItems(counts = {}) {
  return COUNTS.map(([key, label, kind]) => ({ key, label, kind, value: Number.isFinite(counts[key]) ? String(counts[key]) : "—" }));
}

// ---- Needs you ----

// Bad first, then the kit's "attention", then the rest; stable within a tone (A8 D2).
export function needsOrder(probs = []) {
  const rank = (p) => (p.tone === "bad" ? 0 : p.kitTone === "attention" || p.kind === "record" ? 1 : 2);
  return probs.map((p, i) => [p, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([p]) => p);
}

const LANE_OF = { pi: "pi", workshop_display: "workshop_display", printer: "printer" };

// Which mark a need lights on the band (plan decision 7): a record's newest mark today in its lane; a print-lab need
// the running print. Anything else lights nothing.
export function needMark(p, day) {
  const lanes = day?.lanes || [];
  const laneId = p.kind === "record" ? LANE_OF[p.recordId] : p.source === "Print lab" ? "printer" : LANE_OF[p.about || p.record];
  const lane = laneId && lanes.find((l) => l.id === laneId && l.available);
  if (!lane || !lane.marks.length) return null;
  if (p.kind !== "record" && p.source === "Print lab") {
    const i = lane.marks.findIndex((m) => m.kind === "run");
    return i < 0 ? null : { lane: lane.id, index: i };
  }
  return { lane: lane.id, index: lane.marks.length - 1 };
}

// ---- Systems ----

const SEVERITY_RANK = { problem: 2, attention: 1 };
const worst = (recs) => recs.reduce((w, r) => (SEVERITY_RANK[r?.severity] || 0) > (SEVERITY_RANK[w] || 0) ? r.severity : w, "ok");
const lampOf = (severity) => ({ bad: "bad", warn: "warn" }[recordTone(severity)] || "ok");
const gb = (n) => (Number.isFinite(n) ? (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10) : null);
const dayOrTime = (ts, now) => {
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts * 1000), n = new Date(now * 1000);
  return d.toDateString() === n.toDateString() ? t(ts) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};
const upFor = (hours) => (!Number.isFinite(hours) ? null : hours >= 48 ? `${Math.floor(hours / 24)} days` : `${Math.max(0, Math.round(hours))} h`);

const PRINTER_WORD = { printing: "Printing", paused: "Paused", finished: "Finished", failed: "Failed", idle: "Ready",
  offline: "Offline", unknown: "No status yet" };
const NET_WORD = {
  internet: { ok: "Fine", slow: "Slow", down: "Down" },
  adguard: { blocking: "On", paused: "Paused", not_answering: "Not answering" },
  pc: { on: "On", off: "Off or asleep" },
  local_ai: { ready: "Ready", busy: "Busy", no_models: "No models loaded", down: "Down" },
};

// The rack as plain data (pure, tested): each row's lamp, name, state in words, readings and link. A source that
// didn't answer leaves its row in place, saying so; a row never shows an earlier answer as current (plan decision 8).
export function rackRows(src) {
  const { now: d, records, pi, backups, workshop, nowTs } = src;
  const rec = (id) => (records || []).find((r) => r.id === id) || null;
  const rows = [];

  // X2D, from the printer record (the same one Workshop reads)
  const pr = rec("printer");
  if (!records) {
    rows.push({ id: "printer", name: "X2D", lamp: "unknown", state: sourceDown("Pi Hub's records"), readings: [], href: "/workshop", link: "Open Workshop" });
  } else {
    const m = pr ? printerNow(pr) : null;
    const dt = pr?.detail || {};
    const p = d?.printer || {};
    const readings = [];
    if (m?.pct !== null && m?.pct !== undefined) {
      readings.push({ kind: "ring", pct: m.pct, value: `${m.pct}%`, note: Number.isFinite(p.minutes_left) && p.minutes_left > 0 ? `done ${t(nowTs + p.minutes_left * 60)}` : "" });
      if (Number.isFinite(dt.layer) && dt.layer > 0) readings.push({ label: "Layer", value: `${dt.layer}`, of: Number.isFinite(dt.total_layers) && dt.total_layers > 0 ? `/${dt.total_layers}` : "", meter: true });
    }
    if (Number.isFinite(p.nozzle_temp)) readings.push({ label: "Nozzle", value: `${Math.round(p.nozzle_temp)}°`, meter: true });
    if (Number.isFinite(p.bed_temp)) readings.push({ label: "Bed", value: `${Math.round(p.bed_temp)}°`, meter: true });
    if (p.filament_type) readings.push({ label: "Filament", value: `${p.filament_type}`, swatch: /^[0-9a-f]{6}/i.test(p.filament_color || "") ? `#${p.filament_color.slice(0, 6)}` : null });
    if (Number.isFinite(p.ams_humidity)) readings.push({ label: "AMS humidity", value: `${Math.round(p.ams_humidity)}%` });
    const stale = pr?.stale;
    rows.push({
      id: "printer", name: "X2D",
      lamp: !pr ? "unknown" : stale ? "warn" : m?.running ? "run" : lampOf(pr.severity),
      state: !pr ? "No status yet" : stale ? `Last seen ${t(pr.as_of)}; ${sourceDown("Bambuddy")}` : (PRINTER_WORD[pr.state] || pr.headline || pr.state),
      readings, href: "/workshop", link: "Open Workshop",
      printer: pr && !stale ? { actions: actionNames(pr.actions), state: pr.state, lab: m?.lab || "", labProject: m?.labProject || "" } : null,
    });
  }

  // Raspberry Pi
  const piRec = rec("pi");
  const pd = d?.pi || {};
  {
    const readings = [];
    if (Number.isFinite(pd.temp)) readings.push({ kind: "temp", value: `${Math.round(pd.temp)}°`, temp: pd.temp });
    if (Number.isFinite(pd.mem_total_gb) && Number.isFinite(pd.mem_free_gb)) readings.push({ label: "Memory", value: `${gb(pd.mem_total_gb - pd.mem_free_gb)} of ${gb(pd.mem_total_gb)} GB` });
    const sc = pi?.selfcheck;
    if (sc && Number.isInteger(sc.total) && Number.isInteger(sc.failed)) readings.push({ label: "Self-check", value: `${sc.total - sc.failed} of ${sc.total}`, warn: sc.failed > 0 });
    if (upFor(pd.uptime_h)) readings.push({ label: "Up", value: upFor(pd.uptime_h) });
    if (Number.isFinite(pd.updates)) readings.push({ label: "Updates", value: pd.updates ? `${pd.updates} waiting` : "Up to date" });
    const power = typeof pd.power === "string" && pd.power !== "Good" ? pd.power : "";
    rows.push({ id: "pi", name: "Raspberry Pi", lamp: piRec ? lampOf(piRec.severity) : "unknown",
      state: !piRec ? "No status yet" : power || (piRec.state === "hot" ? "Running hot" : "Fine"), readings, href: "/system", link: "Open System" });
  }

  // Network
  if (!records) {
    rows.push({ id: "network", name: "Network", lamp: "unknown", state: sourceDown("Pi Hub's records"), readings: [], href: "/network", link: "Open Network" });
  } else {
    const ids = ["internet", "adguard", "pc", "local_ai"];
    const recs = ids.map(rec);
    const label = { internet: "Internet", adguard: "Ad blocking", pc: "Windows PC", local_ai: "Local AI" };
    const ag = rec("adguard");
    const readings = ids.map((id, i) => {
      const r = recs[i];
      if (!r) return null;
      let value = NET_WORD[id][r.state] || r.headline || r.state;
      if (id === "adguard" && r.state === "paused" && Number.isFinite(r.since)) value = `Paused since ${dayOrTime(r.since, nowTs)}`;
      return { label: label[id], value, warn: recordTone(r.severity) !== "ok" };
    }).filter(Boolean);
    const lamp = lampOf(worst(recs.filter(Boolean)));
    const firstWarn = recs.find((r) => r && recordTone(r.severity) !== "ok");
    rows.push({ id: "network", name: "Network", lamp, state: firstWarn ? (firstWarn.id === "adguard" && firstWarn.state === "paused" ? "Ad blocking paused" : `${label[firstWarn.id]}: ${NET_WORD[firstWarn.id][firstWarn.state] || firstWarn.state}`) : "Fine",
      readings, href: "/network", link: "Open Network",
      action: ag && ag.state === "paused" ? { label: "Turn it on in AdGuard", href: resolveLink("tool:adguard") } : null });
  }

  // Storage and backups
  {
    const readings = [];
    for (const s of Array.isArray(pi?.storage) ? pi.storage : []) {
      if (!s?.mounted || !Number.isFinite(s.used_pct)) continue;
      readings.push({ kind: "fill", label: s.name, pct: s.used_pct, value: `${gb(s.free_gb)} GB`, note: "free" });
    }
    for (const b of Array.isArray(backups?.repos) ? backups.repos : []) readings.push({ label: `${b.name} backup`, value: dayOrTime(b.last, nowTs) });
    const recs = ["backups", "movies_drive", "movie_copy"].map(rec).filter(Boolean);
    const down = !pi && !backups;
    const bad = recs.find((r) => recordTone(r.severity) !== "ok");
    rows.push({ id: "storage", name: "Storage", lamp: down ? "unknown" : lampOf(worst(recs)),
      state: down ? sourceDown("The Pi's status") : bad ? (bad.headline || RECORD_LABELS[bad.id]) : backups?.available ? "Backed up" : "Fine",
      readings, href: "/drives", link: "Open Drives" });
  }

  // This week
  {
    const week = workshop?.week;
    const prints = Array.isArray(workshop?.prints) ? workshop.prints.filter((p) => Number.isFinite(p.seconds) && p.status !== "printing").slice(0, 8).reverse() : [];
    const readings = week ? [{ label: "Finished", value: String(week.finished), meter: true }, { label: "Printing time", value: `${Math.round(week.hours)} h`, meter: true }] : [];
    if (prints.length) readings.push({ kind: "bars", label: `Last ${prints.length} prints by length`, bars: prints.map((p) => ({ seconds: p.seconds, failed: p.status === "failed" || p.status === "cancelled", name: p.name, word: p.word })) });
    rows.push({ id: "week", name: "This week", lamp: week ? "ok" : "unknown", state: week ? "At the printer" : sourceDown("Bambuddy"),
      readings, href: "/workshop", link: "Open Workshop" });
  }
  return rows;
}

// The records the rack doesn't show and that are fine, for the closing "N other things are fine" list.
export function otherFine(records = []) {
  return splitNowRecords(records).calm.filter((r) => !RACK_IDS.has(r.id) && !String(r.id).startsWith("release:"));
}

// ---- drawing ----

function ring(pct) {
  const C = 2 * Math.PI * 23;
  const root = svg("svg", { class: "hd-ring", width: 56, height: 56, viewBox: "0 0 56 56", "aria-hidden": "true" });
  svg("circle", { class: "hd-ring__track", cx: 28, cy: 28, r: 23, fill: "none", "stroke-width": 7 }, root);
  svg("circle", { class: "hd-ring__fill", cx: 28, cy: 28, r: 23, fill: "none", "stroke-width": 7, "stroke-linecap": "round",
    transform: "rotate(-90 28 28)", "stroke-dasharray": `${C * Math.max(0, Math.min(100, pct)) / 100} ${C}` }, root);
  return root;
}

function reading(r) {
  if (r.kind === "ring") {
    return h("div", { class: "hd-rd hd-rd--hero" }, ring(r.pct),
      h("div", {}, h("dt", { class: "hd-sr" }, "Progress"), h("dd", { class: "hd-meter hd-meter--big" }, r.value), r.note ? h("p", { class: "hd-rd__note" }, r.note) : null));
  }
  if (r.kind === "temp") {
    // 30 to 85 °C; the Pi slows itself down at 80
    const pct = Math.max(0, Math.min(100, (r.temp - 30) / 55 * 100));
    return h("div", { class: "hd-rd hd-rd--hero" },
      h("dt", { class: "hd-sr" }, "Temperature"), h("dd", { class: "hd-meter hd-meter--big" }, r.value),
      h("dd", { class: "hd-gauge", "aria-label": `${r.value} C. It slows itself down at 80 °C.` },
        h("span", { class: "hd-gauge__lbl" }, h("span", {}, "30°"), h("span", {}, "slows at 80°")),
        h("span", { class: "hd-gauge__bar" }, h("span", { class: "hd-gauge__hot" }), h("span", { class: "hd-gauge__fill", style: `width:${pct}%` }))));
  }
  if (r.kind === "fill") {
    return h("div", { class: "hd-rd hd-gauge" },
      h("dt", { class: "hd-gauge__lbl" }, h("span", {}, r.label), h("span", {}, h("b", {}, r.value), ` ${r.note}`)),
      h("dd", { class: "hd-gauge__bar", role: "img", "aria-label": `${r.label} ${Math.round(r.pct)}% full` }, h("span", { class: "hd-gauge__fill", style: `width:${Math.max(0, Math.min(100, r.pct))}%` })));
  }
  if (r.kind === "bars") {
    const max = Math.max(...r.bars.map((b) => b.seconds), 1);
    const fails = r.bars.filter((b) => b.failed).length;
    return h("div", { class: "hd-rd" }, h("dt", {}, r.label),
      h("dd", { class: "hd-bars", role: "img", "aria-label": `${r.bars.length - fails} finished, ${fails} failed or cancelled` },
        ...r.bars.map((b) => h("span", { class: b.failed ? "hd-bars__bad" : "", style: `height:${Math.round(b.seconds / max * 100)}%`, title: `${b.name}: ${b.word}` }))));
  }
  return h("div", { class: "hd-rd" }, h("dt", {}, r.label),
    h("dd", { class: [r.meter ? "hd-meter" : "", r.warn ? "hd-warn" : ""].filter(Boolean).join(" ") || null },
      r.swatch ? h("span", { class: "hd-swatch", style: `background:${r.swatch}` }) : null, r.value, r.of ? h("span", { class: "hd-of" }, r.of) : null));
}

function rackRow(row, onReload) {
  const extra = [];
  if (row.printer) {
    const btns = row.printer.actions.length ? printerButtons({ actions: row.printer.actions, state: row.printer.state }, onReload) : null;
    if (btns) extra.push(btns);
    if (row.printer.lab) extra.push(h("a", { class: "action", href: printLabUrl(row.printer.lab, row.printer.labProject), "data-link": true }, `Open ${row.printer.lab} in Print lab`));
  }
  if (row.action?.href) extra.push(h("a", { class: "action", href: row.action.href, target: "_blank", rel: "noopener" }, row.action.label));
  return h("li", { class: "hd-unit", dataset: { lamp: row.lamp, row: row.id } },
    h("p", { class: "hd-unit__name" }, h("span", { class: "hd-lamp", dataset: { lamp: row.lamp }, "aria-hidden": "true" }),
      h("span", {}, row.name, h("small", {}, row.state))),
    h("dl", { class: "hd-unit__readings" }, ...row.readings.map(reading)),
    h("a", { class: "hd-unit__go", href: row.href, "data-link": true }, row.link),
    extra.length ? h("div", { class: "hd-unit__actions" }, ...extra) : null);
}

function skeletonRows(n) {
  return Array.from({ length: n }, () => h("li", { class: "hd-unit" }, h("span", { class: "ui-skeleton", style: "width:40%" }), h("span", { class: "ui-skeleton", style: "width:70%" })));
}

// ---- the page ----

export function mountDashboard(state, parent) {
  state.hd = {};
  const hd = state.hd;
  hd.counts = h("ol", { class: "hd-tally" }, ...countItems().map((c) => h("li", {}, h("b", { class: `hd-meter hd-k-${c.kind}` }, h("span", { class: "ui-skeleton", style: "width:1ch" })), h("span", {}, c.label))));
  hd.plot = h("div", { class: "hd-band__plot" }, h("span", { class: "ui-skeleton", style: "height:180px" }));
  hd.detail = h("p", { class: "hd-band__detail", "aria-live": "polite" }, "Tap, point at or tab to anything on the band to see what it was.");
  hd.needs = h("div", { class: "hd-needs__list" }, h("span", { class: "ui-skeleton", style: "height:4em" }));
  hd.needsCount = h("b", { class: "hd-meter hd-needs__count" });
  hd.rack = h("ul", { class: "hd-rack__units" }, ...skeletonRows(5));
  hd.others = h("div", { class: "hd-others" });
  hd.root = h("div", { class: "hd" },
    h("section", { class: "hd-band", "aria-labelledby": "hd-today-h" },
      h("div", { class: "hd-band__head" }, h("h2", { id: "hd-today-h" }, "Today so far"), hd.counts),
      hd.plot, hd.detail),
    h("section", { class: "hd-needs", "aria-labelledby": "hd-needs-h" },
      h("div", { class: "hd-head" }, h("h2", { id: "hd-needs-h" }, "Needs you"), hd.needsCount), hd.needs),
    h("section", { class: "hd-rack", "aria-labelledby": "hd-rack-h" },
      h("div", { class: "hd-head" }, h("h2", { id: "hd-rack-h" }, "Systems")), hd.rack, hd.others));
  parent.append(hd.root);
  hd.lit = null;
  hd.marks = {};
  // Drawn at the band's own width, and again when that width changes (rotation, a resized window, the TV's zoom).
  if (typeof ResizeObserver === "function") {
    hd.observer = new ResizeObserver(() => { if (hd.day) redrawBand(state); });
    hd.observer.observe(hd.plot);
  }
}

export function leaveDashboard(state) {
  state.hd?.observer?.disconnect();
  state.hd = null;  // a read still in flight renders nothing
}

function light(hd, target) {
  for (const list of Object.values(hd.marks)) for (const g of list) g.classList.remove("is-lit");
  hd.lit = target;
  if (target) hd.marks[target.lane]?.[target.index]?.classList.add("is-lit");
}

function redrawBand(state) {
  const hd = state.hd;
  const width = hd.plot.clientWidth || 0;
  if (!width || width === hd.drawnWidth) return;
  hd.drawnWidth = width;
  const { marks } = drawBand(hd.plot, hd.day, width, (lane, m) => {
    hd.detail.replaceChildren(h("b", {}, m.title), `, ${markWhen(m, hd.day)}`);
  });
  hd.marks = marks;
  if (hd.lit) light(hd, hd.lit);
}

// One render of everything Home read. `src` holds each route's answer, null for one that didn't answer.
export function renderDashboard(state, src, onReload) {
  const hd = state.hd;
  if (!hd) return;
  const nowTs = Math.floor(Date.now() / 1000);

  // Today
  if (src.today) {
    hd.day = src.today;
    hd.drawnWidth = 0;
    redrawBand(state);
    hd.counts.replaceChildren(...countItems(src.today.counts).map((c) =>
      h("li", {}, h("b", { class: `hd-meter hd-k-${c.kind}` }, c.value), h("span", {}, c.label))));
  } else {
    hd.day = null;
    hd.plot.replaceChildren(h("p", { class: "hd-band__down" }, sourceDown("Pi Hub")));
    hd.counts.replaceChildren(...countItems().map((c) => h("li", {}, h("b", { class: `hd-meter hd-k-${c.kind}` }, c.value), h("span", {}, c.label))));
  }

  // Needs you: the same merged list as before, ordered by tone; the badge counts it (baseline 5.5)
  if (src.records || src.needs !== undefined) {
    const probs = needsOrder(mergeProblems(src.records || [], src.needs));
    state.probs = probs;
    hd.needsCount.textContent = probs.length ? String(probs.length) : "";
    hd.needs.replaceChildren(probs.length ? renderProblems(probs, onReload) : h("p", { class: "ui-needs__empty" }, "Nothing needs you right now."));
    probs.forEach((p, i) => {
      const li = hd.needs.querySelector(".ui-needs")?.children?.[i];
      const target = hd.day ? needMark(p, hd.day) : null;
      if (!li || !target) return;
      const on = () => light(hd, target), off = () => light(hd, null);
      li.addEventListener("mouseenter", on);
      li.addEventListener("mouseleave", off);
      li.addEventListener("focusin", on);
      li.addEventListener("focusout", off);
      li.addEventListener("click", (e) => { if (!e.target?.closest?.("a,button")) light(hd, hd.lit === target ? null : target); });
    });
  }

  // Systems
  const rows = rackRows({ ...src, nowTs });
  hd.rack.replaceChildren(...rows.map((r) => rackRow(r, onReload)));
  const fine = src.records ? otherFine(src.records) : [];
  const open = !!hd.others.querySelector("details")?.open;  // a refresh keeps the list as the owner left it
  hd.others.replaceChildren(...(fine.length ? [h("details", { class: "hd-others__box", open: open || null },
    h("summary", { class: "hd-others__summary" }, `${fine.length} other thing${fine.length === 1 ? " is" : "s are"} fine`),
    h("ul", { class: "hd-others__list" }, ...fine.map((r) => h("li", {},
      h("a", { href: recordPath(r.id), "data-link": true }, RECORD_LABELS[r.id] || r.id), h("span", {}, r.headline || r.state)))))] : []));
  return rows;
}
