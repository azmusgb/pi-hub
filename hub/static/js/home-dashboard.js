// Home (amendment A8): the Today band, Needs you beside a rack of systems, one layout from phone to TV.
// Plan 2026-11-05-a8-home-dashboard, P2. The wall (/wall) keeps its own board in now.js. A10 D4 (plan
// 2026-11-05-a10-responsive, P4): the band reads its own width and type size. A11: where the band can't give an hour
// 24 px with names beside, the day is a dial and the rack compact rows.
import { clockTime, h } from "./core.js";
import { printerButtons } from "./printer-actions.js";
import { printLabUrl, resolveLink } from "./sections.js";
import { RECORD_LABELS, actionNames, mergeProblems, printerNow, recordPath, recordTone, renderProblems,
  splitNowRecords } from "./control-room.js";

const SVG = "http://www.w3.org/2000/svg";
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

// The band's geometry at a pixel width and type size: pure, so it can be tested without a browser. Hours are placed by
// the day's real length (a DST day is 23 or 25 hours), and an hour label too close to Now gives way to it. Rows, bars and
// the name column are in em of the band's type (A10 D4), and the band always has the whole day with names beside its
// tracks: where that leaves an hour under 24 px, Home draws the dial instead (bandFits, A11 D1).
const NAME_EM = 8.25, PAD_EM = 1, HOUR_MIN = 24;
export function bandFits(width, fs = 16) {
  return width > 0 && (width - (NAME_EM + PAD_EM) * fs) / 24 >= HOUR_MIN;
}

export function bandLayout(day, width, fs = 16) {
  const W = Math.max(240, Math.round(width));
  const LABEL = NAME_EM * fs, PAD = PAD_EM * fs, TOP = 1.5 * fs;
  const ROW = Math.max(44, 2.75 * fs), BAR = fs;  // rows fit a 44 px target
  const end = day.end;
  const span = Math.max(1, end - day.start);
  const track = W - LABEL - PAD;
  const x = (ts) => LABEL + (Math.min(Math.max(ts, day.start), end) - day.start) / span * track;
  const nowX = x(day.now);
  // labels every 1, 2, 3 or 6 hours: the closest spacing that leaves room for each label ("12p", "Midnight")
  const room = 5.25 * fs;
  const step = [1, 2, 3, 6].find((s) => s * 3600 / span * track >= room) || 6;
  const LABEL_W = 3.75 * fs;  // the widest label, so one at either end stays inside the band
  // Now's label, and an hour label's extent, from a generous character width (0.6em of the labels' 0.75em type)
  const textW = (s) => s.length * 0.45 * fs;
  const nowLabelEnd = nowX + 6 + textW("Now") > W;
  const nowBox = nowLabelEnd ? [nowX - 6 - textW("Now"), nowX] : [nowX, nowX + 6 + textW("Now")];
  const hours = [];
  for (let i = 0; i * 3600 <= span; i++) {
    const ts = day.start + i * 3600;
    const major = i % step === 0;
    const hx = x(ts);
    const anchor = i === 0 ? "start" : hx > LABEL + track - LABEL_W / 2 ? "end" : "middle";
    const w = textW(LONG_HOUR(i));
    const box = anchor === "start" ? [hx, hx + w] : anchor === "end" ? [hx - w, hx] : [hx - w / 2, hx + w / 2];
    const clear = box[1] + 0.25 * fs < nowBox[0] || box[0] - 0.25 * fs > nowBox[1];
    const label = major && clear && Math.abs(hx - nowX) > 1.5 * fs ? LONG_HOUR(i) : "";
    hours.push({ x: hx, major, label, anchor });
  }
  const lanes = (day.lanes || []).map((lane, i) => {
    const top = TOP + i * ROW;
    const cy = top + ROW / 2;
    return {
      id: lane.id, label: lane.label, available: lane.available, source: lane.source,
      labelX: 0, labelY: cy + 0.25 * fs, cy,
      marks: lane.marks.map((m) => {
        const a = Number.isFinite(m.at) ? m.at : m.start, b = Number.isFinite(m.at) ? m.at : (m.until || m.end);
        return {
          ...m,
          x: x(Number.isFinite(m.at) ? m.at : m.start),
          w: Number.isFinite(m.at) ? 0 : Math.max(4, x(m.end) - x(m.start)),
          ghost: Number.isFinite(m.until) ? { x: x(m.end), w: Math.max(0, x(m.until) - x(m.end)) } : null,
          // a finger-sized target around every mark, however thin it is drawn (at least 44 × 44)
          hit: { x: Math.min(x(a), x(b)) - 22, w: Math.max(44, x(b) - x(a) + 44), y: cy - 22, h: 44 },
        };
      }),
    };
  });
  return { width: W, height: TOP + lanes.length * ROW + 4, end, top: TOP, bar: BAR, nowX, nowLabelEnd,
    start: LABEL, pad: PAD, hours, lanes };
}

function svg(tag, attrs, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}

// Draws the band into `host` at its own width. `onMark(lane, mark)` is called on hover, focus or tap.
export function drawBand(host, day, width, onMark, fs = 16) {
  const L = bandLayout(day, width, fs);
  const root = svg("svg", { class: "hd-band__svg", viewBox: `0 0 ${L.width} ${L.height}`, width: L.width, height: L.height,
    role: "group", "aria-label": "Today from midnight, one row per system",
    // A10 D6: the sweep checks these never overlap each other at any width.
    "data-no-overlap": ".hd-band__hour, .hd-band__nowlabel, .hd-band__lane" });
  const defs = svg("defs", {}, root);
  const pat = svg("pattern", { id: "hd-hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hd-band__hatch" }, pat);
  for (const hr of L.hours) {
    svg("line", { x1: hr.x, x2: hr.x, y1: L.top - (hr.major ? 6 : 2), y2: L.height - 4, class: hr.major ? "hd-band__grid" : "hd-band__grid hd-band__grid--minor" }, root);
    if (hr.label) svg("text", { x: hr.x, y: L.top * 0.55, class: "hd-band__hour", "text-anchor": hr.anchor }, root).textContent = hr.label;
  }
  const marks = {};
  for (const lane of L.lanes) {
    svg("text", { x: lane.labelX, y: lane.labelY, class: "hd-band__lane" }, root).textContent = lane.label;
    const trackX = L.start;
    svg("rect", { x: trackX, y: lane.cy - L.bar / 2, width: Math.max(0, L.width - trackX - L.pad), height: L.bar, rx: 3, class: "hd-band__track" }, root);
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
        svg("circle", { cx: m.x, cy: lane.cy, r: 0.75 * L.bar, class: "hd-band__halo" }, g);
        svg("rect", { x: m.x - 3.5, y: lane.cy - L.bar / 2 - 3, width: 7, height: L.bar + 6, rx: 2, class: `hd-band__fill hd-k-${m.kind}` }, g);
      } else {
        if (m.ghost) svg("rect", { x: m.ghost.x, y: lane.cy - L.bar / 2 + 0.75, width: m.ghost.w, height: L.bar - 1.5, rx: 3, class: "hd-band__ghost" }, g);
        svg("rect", { x: m.x, y: lane.cy - L.bar / 2, width: m.w, height: L.bar, rx: 3, class: `hd-band__fill hd-k-${m.kind}` }, g);
      }
      return g;
    });
  }
  svg("rect", { x: L.nowX, y: L.top - 6, width: Math.max(0, L.width - L.pad - L.nowX), height: L.height - L.top + 2, class: "hd-band__future" }, root);
  // Now, as one group so it can sweep from midnight on first load (A8 D1)
  const now = svg("g", { class: "hd-band__nowg" }, root);
  svg("line", { x1: L.nowX, x2: L.nowX, y1: L.top - 8, y2: L.height - 2, class: "hd-band__now" }, now);
  svg("text", { x: L.nowLabelEnd ? L.nowX - 6 : L.nowX + 6, y: L.top * 0.55, class: "hd-band__nowlabel", "text-anchor": L.nowLabelEnd ? "end" : "start" }, now).textContent = "Now";
  host.replaceChildren(root);
  return { marks, layout: L, now, sweep: L.start - L.nowX };
}

// The Now line sweeps once per page load: not on a refresh, not on coming back to Home, never with reduced motion.
let swept = false;
export function resetSweep() { swept = false; }  // tests only
function sweepOnce(g, dx) {
  if (swept) return;
  swept = true;
  if (!globalThis.matchMedia?.("(prefers-reduced-motion: no-preference)")?.matches) return;
  g.classList.add("is-sweeping");
  const run = g.animate?.([{ transform: `translateX(${Math.round(dx)}px)` }, { transform: "none" }],
    { duration: 1100, easing: "cubic-bezier(.2, .7, .2, 1)" });
  if (run) run.onfinish = () => g.classList.remove("is-sweeping");
}

// ---- the dial (A11) ----

// The dial's geometry at a card width and type size: pure. 24 hours clockwise from midnight at the top, by the day's
// real length; one ring per lane, inside to outside in A8's lane order; up to 22 rem across (A11 D2). Proportions are
// the prototype's at 320 px: inner ring 64, rings 17 apart, 9 thick.
const DIAL_EM = 22, MIN_ARC = 6;
export function dialLayout(day, width, fs = 16) {
  const size = Math.max(0, Math.min(width, DIAL_EM * fs));
  const lanes = day.lanes || [];
  const c = size / 2;
  // the prototype's proportions, shrunk where needed so the outer ring leaves room for the hour labels (0.75rem type)
  const units = 64 + Math.max(0, lanes.length - 1) * 17 + 4.5;
  const k = Math.max(0, Math.min(size / 320, (c - 1.5 * fs) / units));
  const ring = 9 * k, step = 17 * k, r0 = 64 * k;
  const span = Math.max(1, day.end - day.start);
  const clamp = (ts) => Math.min(Math.max(ts, day.start), day.end);
  const angle = (ts) => (clamp(ts) - day.start) / span * 2 * Math.PI - Math.PI / 2;
  const point = (r, ts) => [c + r * Math.cos(angle(ts)), c + r * Math.sin(angle(ts))];
  const outer = r0 + Math.max(0, lanes.length - 1) * step;
  const rings = lanes.map((lane, i) => {
    const r = r0 + i * step;
    const half = MIN_ARC * k / 2 / r;  // a point or a short span is still a visible arc
    return {
      id: lane.id, label: lane.label, source: lane.source, available: lane.available, r,
      marks: lane.marks.map((m, index) => {
        const point = Number.isFinite(m.at);
        let a0 = angle(point ? m.at : m.start), a1 = angle(point ? m.at : m.end);
        if (a1 - a0 < 2 * half) { const mid = (a0 + a1) / 2; a0 = mid - half; a1 = mid + half; }
        const ghost = Number.isFinite(m.until) ? { a0: angle(m.end), a1: angle(m.until) } : null;
        return { ...m, index, time: point ? m.at : m.start, a0, a1, ghost };
      }),
    };
  });
  const hours = [];
  for (let i = 0; i * 3600 < span; i++) {
    const ts = day.start + i * 3600;
    hours.push({ ts, a: angle(ts), major: i % 6 === 0, label: i % 6 === 0 ? SHORT_HOUR(i) : "" });
  }
  return { size, c, k, ring, step, inner: r0 - ring / 2, outer: outer + ring / 2, labelR: c - 0.85 * fs, rings, hours,
    nowA: angle(day.now), angle, point };
}

// The mark a tap at (x, y) on the dial means: within 22 px of a mark across its ring and along it (a 44 × 44 target,
// however short the arc), the nearest (A11 D3). Null when nothing is that close.
export function dialHit(L, x, y) {
  const dx = x - L.c, dy = y - L.c, rho = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  const TAU = 2 * Math.PI;
  const mod = (v) => ((v % TAU) + TAU) % TAU;
  // how far, in radians, the tap is outside an arc, the shorter way round (an arc may cross midnight's -π/2)
  const outside = (a0, a1) => {
    if (mod(a - a0) <= a1 - a0) return 0;
    return Math.min(mod(a0 - a), mod(a - a1));
  };
  let best = null;
  for (const ring of L.rings) {
    if (!ring.available) continue;
    const across = Math.abs(rho - ring.r);
    if (across > 22) continue;
    for (const mark of ring.marks) {
      const along = outside(mark.a0, mark.a1) * ring.r;
      if (along > 22) continue;
      const d = Math.hypot(across, along);
      if (!best || d < best.d) best = { d, ring, mark };
    }
  }
  return best && { ring: best.ring, mark: best.mark };
}

// The centre's words for the day's headline counts (A11 D2): "3 done, 2 failed". A quiet day says "0 done". Power dips
// and updates are in the tally under the dial.
export function dialWords(counts) {
  if (!counts) return "";
  const n = (k) => (Number.isFinite(counts[k]) ? counts[k] : null);
  const parts = [];
  if (n("finished") !== null) parts.push(`${n("finished")} done`);
  if (n("failed") > 0) parts.push(`${n("failed")} failed`);
  return parts.join(", ");
}

function arcPath(L, r, a0, a1) {
  const end = Math.min(a1, a0 + 2 * Math.PI - 1e-4);
  const p = (a) => `${(L.c + r * Math.cos(a)).toFixed(2)} ${(L.c + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(a0)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${end - a0 > Math.PI ? 1 : 0} 1 ${p(end)}`;
}

// Draws the dial into `host` at its own width: the rings, the hours, Now's hand, the centre and the key under it.
// `onMark(lane, mark)` is called on a tap, a pointer or focus; marks are in the DOM, so the keyboard, in time order.
export function drawDial(host, day, width, fs = 16, onMark) {
  const L = dialLayout(day, width, fs);
  const wrap = h("div", { class: "hd-dial", style: `width:${L.size}px` });
  const root = svg("svg", { class: "hd-dial__svg", viewBox: `0 0 ${L.size} ${L.size}`, width: L.size, height: L.size,
    role: "group", "aria-label": "Today from midnight, clockwise, one ring per system",
    "data-no-overlap": ".hd-dial__hour" }, null);
  const defs = svg("defs", {}, root);
  const pat = svg("pattern", { id: "hd-dial-hatch", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  svg("line", { x1: 0, y1: 0, x2: 0, y2: 5, class: "hd-band__hatch" }, pat);
  for (const hr of L.hours) {
    const r1 = L.inner - (hr.major ? 6 : 2) * L.k, r2 = L.outer + (hr.major ? 6 : 2) * L.k;
    svg("line", { x1: L.c + r1 * Math.cos(hr.a), y1: L.c + r1 * Math.sin(hr.a), x2: L.c + r2 * Math.cos(hr.a), y2: L.c + r2 * Math.sin(hr.a),
      class: hr.major ? "hd-dial__tick" : "hd-dial__tick hd-dial__tick--minor" }, root);
    if (hr.label) {
      const rl = L.labelR;
      svg("text", { x: L.c + rl * Math.cos(hr.a), y: L.c + rl * Math.sin(hr.a), class: "hd-dial__hour", "text-anchor": "middle",
        "dominant-baseline": "middle" }, root).textContent = hr.label;
    }
  }
  for (const ring of L.rings) {
    svg("circle", { cx: L.c, cy: L.c, r: ring.r, "stroke-width": L.ring,
      class: ring.available ? "hd-dial__ring" : "hd-dial__ring hd-dial__ring--down" }, root);
    if (ring.available && L.nowA < 1.5 * Math.PI) {
      svg("path", { d: arcPath(L, ring.r, L.nowA, 1.5 * Math.PI), "stroke-width": L.ring, class: "hd-dial__future" }, root);
    }
  }
  const marks = {};
  const all = L.rings.flatMap((ring) => (ring.available ? ring.marks.map((m) => ({ ring, m })) : []))
    .sort((a, b) => a.m.time - b.m.time);
  for (const { ring, m } of all) {
    const lane = day.lanes.find((l) => l.id === ring.id);
    const g = svg("g", { class: "hd-dial__mark", tabindex: "0", role: "img", "aria-label": `${ring.label}: ${m.title}, ${markWhen(m, day)}` }, root);
    g.addEventListener("focus", () => onMark?.(lane, m));
    // a 44 px target at the mark's middle, so the mark measures as one (taps are matched by dialHit on the whole dial)
    const mid = (m.a0 + m.a1) / 2;
    svg("circle", { cx: L.c + ring.r * Math.cos(mid), cy: L.c + ring.r * Math.sin(mid), r: 22, class: "hd-dial__hit" }, g);
    svg("path", { d: arcPath(L, ring.r, m.a0, m.a1), "stroke-width": L.ring + 6, class: "hd-dial__halo" }, g);
    if (m.ghost && m.ghost.a1 > m.ghost.a0) svg("path", { d: arcPath(L, ring.r, m.ghost.a0, m.ghost.a1), "stroke-width": L.ring * 0.6, class: "hd-dial__ghost" }, g);
    svg("path", { d: arcPath(L, ring.r, m.a0, m.a1), "stroke-width": L.ring, class: `hd-dial__fill hd-k-${m.kind}` }, g);
    (marks[ring.id] ||= [])[m.index] = g;
  }
  // Now: a hand across the rings
  const [hx1, hy1] = [L.c + L.inner * Math.cos(L.nowA), L.c + L.inner * Math.sin(L.nowA)];  // clear of the centre
  const [hx2, hy2] = [L.c + (L.outer + 8 * L.k) * Math.cos(L.nowA), L.c + (L.outer + 8 * L.k) * Math.sin(L.nowA)];
  svg("line", { x1: hx1, y1: hy1, x2: hx2, y2: hy2, class: "hd-dial__hand" }, root);
  // A tap or a pointer anywhere on the dial takes the nearest mark within reach (A11 D3).
  const pick = (e) => {
    const box = root.getBoundingClientRect?.();
    if (!box?.width) return;
    const scale = L.size / box.width;
    const hit = dialHit(L, (e.clientX - box.left) * scale, (e.clientY - box.top) * scale);
    if (hit) onMark?.(day.lanes.find((l) => l.id === hit.ring.id), hit.mark);
  };
  root.addEventListener("click", pick);
  root.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pick(e); });
  const fit = `max-width:${Math.round(2 * (L.inner - 10 * L.k))}px`;  // inside the inner ring
  const centre = h("div", { class: "hd-dial__centre" },
    h("b", { class: "hd-dial__time hd-meter", style: fit }, t(day.now)), h("span", { class: "hd-dial__words", style: fit }, dialWords(day.counts)));
  wrap.append(root, centre);
  const key = h("ol", { class: "hd-dial__key", "aria-label": "The rings, inside to outside" }, ...L.rings.map((ring) =>
    h("li", { dataset: { down: ring.available ? null : "true" } }, h("span", { class: "hd-dial__swatch", "aria-hidden": "true" }),
      ring.available ? ring.label : `${ring.label}: ${sourceDown(ring.source)}`)));
  host.replaceChildren(wrap, key);
  return { marks, layout: L };
}

// Each count's words: [before, the short label a phone shows (A9 D2), after]. The words around it stay for screen readers.
const COUNTS = [["finished", ["prints ", "finished", ""], "ok"], ["failed", ["", "failed", ""], "bad"],
  ["power", ["", "power dips", ""], "warn"], ["updates", ["", "updates", " shipped"], "run"]];

export function countItems(counts = {}) {
  return COUNTS.map(([key, words, kind]) => ({ key, words, label: words.join(""), short: words[1], kind,
    value: Number.isFinite(counts[key]) ? String(counts[key]) : "—" }));
}

function tallyLabel(c) {
  const more = (w) => (w ? h("span", { class: "hd-tally__more" }, w) : null);
  return h("span", {}, more(c.words[0]), c.words[1], more(c.words[2]));
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
    rows.push({ id: "printer", name: "X2D", lamp: "unknown", state: sourceDown("Pi Hub's records"), readings: [], brief: "", href: "/workshop", link: "Open Workshop" });
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
      readings, brief: !stale && Number.isFinite(m?.pct) ? `${m.pct}%` : "", href: "/workshop", link: "Open Workshop",
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
    else if (!pi) readings.push({ label: "Self-check", value: "Not answering", warn: true });
    if (upFor(pd.uptime_h)) readings.push({ label: "Up", value: upFor(pd.uptime_h) });
    if (Number.isFinite(pd.updates)) readings.push({ label: "Updates", value: pd.updates ? `${pd.updates} waiting` : "Up to date" });
    const power = typeof pd.power === "string" && pd.power !== "Good" ? pd.power : "";
    rows.push({ id: "pi", name: "Raspberry Pi", lamp: piRec ? lampOf(piRec.severity) : "unknown",
      state: !records ? sourceDown("Pi Hub's records") : !piRec ? "No status yet" : power || (piRec.state === "hot" ? "Running hot" : "Fine"),
      readings, brief: Number.isFinite(pd.temp) ? `${Math.round(pd.temp)}°` : "", href: "/system", link: "Open System" });
  }

  // Network
  if (!records) {
    rows.push({ id: "network", name: "Network", lamp: "unknown", state: sourceDown("Pi Hub's records"), readings: [], brief: "", href: "/network", link: "Open Network" });
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
      readings, brief: "", href: "/network", link: "Open Network",
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
    // Each part says when it didn't answer: the drives (the Pi's status), the backup times (Backrest, through the
    // helper; it answers 200 with available false when the helper fails) and the records.
    const down = [pi ? "" : sourceDown("The Pi's status"), backups?.available ? "" : sourceDown("Backrest"),
      records ? "" : sourceDown("Pi Hub's records")].filter(Boolean);
    const bad = recs.find((r) => recordTone(r.severity) !== "ok");
    rows.push({ id: "storage", name: "Storage", lamp: bad ? lampOf(worst(recs)) : down.length ? "unknown" : lampOf(worst(recs)),
      state: bad ? (bad.headline || RECORD_LABELS[bad.id]) : down.length ? down.join(". ") : "Backed up",
      readings, brief: (() => { const s = (Array.isArray(pi?.storage) ? pi.storage : []).find((x) => x?.mounted && Number.isFinite(x.free_gb));
        return s ? `${gb(s.free_gb)} GB free` : ""; })(),
      href: "/drives", link: "Open Drives" });
  }

  // This week
  {
    const week = workshop?.week;
    const prints = Array.isArray(workshop?.prints) ? workshop.prints.filter((p) => Number.isFinite(p.seconds) && p.status !== "printing").slice(0, 8).reverse() : [];
    const readings = week ? [{ label: "Finished", value: String(week.finished), meter: true }, { label: "Printing time", value: `${Math.round(week.hours)} h`, meter: true }] : [];
    if (prints.length) readings.push({ kind: "bars", label: `Last ${prints.length} prints by length`, bars: prints.map((p) => ({ seconds: p.seconds, failed: p.status === "failed" || p.status === "cancelled", name: p.name, word: p.word })) });
    rows.push({ id: "week", name: "This week", lamp: week ? "ok" : "unknown", state: week ? "At the printer" : sourceDown("Bambuddy"),
      readings, brief: week ? `${week.finished} finished` : "", href: "/workshop", link: "Open Workshop" });
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
    // dt and dd straight inside the row's group, as a description list needs (axe dlitem)
    return h("div", { class: "hd-rd" }, h("dt", { class: "hd-sr" }, "Progress"),
      h("dd", { class: "hd-rd--hero" }, ring(r.pct),
        h("span", {}, h("span", { class: "hd-meter hd-meter--big" }, r.value), r.note ? h("span", { class: "hd-rd__note" }, r.note) : null)));
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
      h("dd", {}, h("span", { class: "hd-gauge__bar", role: "img", "aria-label": `${r.label} ${Math.round(r.pct)}% full` },
        h("span", { class: "hd-gauge__fill", style: `width:${Math.max(0, Math.min(100, r.pct))}%` }))));
  }
  if (r.kind === "bars") {
    const max = Math.max(...r.bars.map((b) => b.seconds), 1);
    const fails = r.bars.filter((b) => b.failed).length;
    return h("div", { class: "hd-rd" }, h("dt", {}, r.label),
      h("dd", {}, h("span", { class: "hd-bars", role: "img", "aria-label": `${r.bars.length - fails} finished, ${fails} failed or cancelled` },
        ...r.bars.map((b) => h("span", { class: b.failed ? "hd-bars__bad" : "", style: `height:${Math.round(b.seconds / max * 100)}%`, title: `${b.name}: ${b.word}` })))));
  }
  return h("div", { class: "hd-rd" }, h("dt", {}, r.label),
    h("dd", { class: [r.meter ? "hd-meter" : "", r.warn ? "hd-warn" : ""].filter(Boolean).join(" ") || null },
      r.swatch ? h("span", { class: "hd-swatch", style: `background:${r.swatch}` }) : null, r.value, r.of ? h("span", { class: "hd-of" }, r.of) : null));
}

// A11 D5: where the dial is drawn, a row is lamp, name, state, one reading and its link; the row's actions stay.
function rackRow(row, onReload, compact = false) {
  const extra = [];
  if (row.printer) {
    const btns = row.printer.actions.length ? printerButtons({ actions: row.printer.actions, state: row.printer.state }, onReload) : null;
    if (btns) extra.push(btns);
    if (row.printer.lab) extra.push(h("a", { class: "action", href: printLabUrl(row.printer.lab, row.printer.labProject), "data-link": true }, `Open ${row.printer.lab} in Print lab`));
  }
  if (row.action?.href) extra.push(h("a", { class: "action", href: row.action.href, target: "_blank", rel: "noopener" }, row.action.label));
  if (compact) {
    return h("li", { class: "hd-unit hd-unit--compact", dataset: { lamp: row.lamp, row: row.id, noOverlap: ":scope > *" } },
      h("p", { class: "hd-unit__name" }, h("span", { class: "hd-lamp", dataset: { lamp: row.lamp }, "aria-hidden": "true" }),
        h("span", {}, row.name, h("small", {}, row.state))),
      row.brief ? h("span", { class: "hd-unit__brief hd-meter" }, row.brief) : null,
      h("a", { class: "hd-unit__go", href: row.href, "data-link": true }, row.link),
      extra.length ? h("div", { class: "hd-unit__actions" }, ...extra) : null);
  }
  return h("li", { class: "hd-unit", dataset: { lamp: row.lamp, row: row.id, noOverlap: ":scope > *" } },
    h("p", { class: "hd-unit__name" }, h("span", { class: "hd-lamp", dataset: { lamp: row.lamp }, "aria-hidden": "true" }),
      h("span", {}, row.name, h("small", {}, row.state))),
    h("dl", { class: "hd-unit__readings", dataset: { noOverlap: ":scope > *" } }, ...row.readings.map(reading)),
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
  hd.counts = h("ol", { class: "hd-tally", dataset: { noOverlap: ":scope > li" } }, ...countItems().map((c) => h("li", {}, h("b", { class: `hd-meter hd-k-${c.kind}` }, h("span", { class: "ui-skeleton", style: "width:1ch" })), tallyLabel(c))));
  hd.plot = h("div", { class: "hd-band__plot" }, h("span", { class: "ui-skeleton", style: "height:11rem" }));
  hd.detail = h("p", { class: "hd-band__detail", "aria-live": "polite" });
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
  // Drawn at the band's own width and type size, and again when either changes (rotation, a resized window).
  if (typeof ResizeObserver === "function") {
    hd.observer = new ResizeObserver(() => redrawBand(state));
    hd.observer.observe(hd.plot);
  }
}

export function leaveDashboard(state) {
  state.hd?.observer?.disconnect();
  state.hd = null;  // a read still in flight renders nothing
}

function light(hd, target) {
  for (const list of Object.values(hd.marks)) for (const g of list) g?.classList.remove("is-lit");
  hd.lit = target;
  if (target) hd.marks[target.lane]?.[target.index]?.classList?.add("is-lit");
}

// What has focus inside Home, as its position among Home's focusable things, so a refresh that redraws the page can
// put it back (a keyboard user is not dropped to the top every 15 s).
const FOCUSABLE = "a[href], button, summary, [tabindex='0']";
function focusSpot(hd) {
  const el = document.activeElement;
  if (!el || !hd.root.contains(el)) return -1;
  return [...hd.root.querySelectorAll(FOCUSABLE)].indexOf(el);
}
function refocus(hd, spot) {
  if (spot < 0 || hd.root.contains(document.activeElement)) return;
  const all = [...hd.root.querySelectorAll(FOCUSABLE)];
  all[Math.min(spot, all.length - 1)]?.focus?.({ preventScroll: true });
}

// Band or dial (A11 D1), from Home's own width and type size, not the window's (A10 D2). Null before layout.
function dayMode(hd) {
  const width = hd.plot.clientWidth || 0;
  const fs = parseFloat(globalThis.getComputedStyle?.(hd.plot)?.fontSize) || 16;
  return width ? { width, fs, mode: bandFits(width, fs) ? "band" : "dial" } : null;
}

const PROMPT = { band: "Tap, point at or tab to anything on the band to see what it was.",
  dial: "Tap, point at or tab to anything on the dial to see what it was." };

export function redrawBand(state) {
  const hd = state.hd;
  if (!hd) return;
  const at = dayMode(hd);
  if (!at || (at.width === hd.drawnWidth && at.fs === hd.drawnFs)) return;
  const spot = focusSpot(hd);  // a resize redraws: keyboard focus comes back where it was
  drawDay(hd, at);
  refocus(hd, spot);
}

function drawDay(hd, at) {
  const changed = at.mode !== hd.root.dataset.day;
  hd.root.dataset.day = at.mode;
  if (changed) {
    if (!hd.detail.textContent || Object.values(PROMPT).includes(hd.detail.textContent)) hd.detail.textContent = PROMPT[at.mode];
    if (hd.rackArgs) renderRack(hd, ...hd.rackArgs);
  }
  if (!hd.day) {
    // loading: a skeleton in the shape that is coming (A11 D4)
    if (!hd.plot.querySelector(".hd-band__down")) {
      hd.plot.replaceChildren(h("span", { class: at.mode === "dial" ? "ui-skeleton hd-dial__skeleton" : "ui-skeleton", style: at.mode === "dial" ? null : "height:11rem" }));
    }
    return;
  }
  hd.drawnWidth = at.width;
  hd.drawnFs = at.fs;
  const say = (lane, m) => hd.detail.replaceChildren(h("b", {}, `${lane?.label ? `${lane.label}: ` : ""}${m.title}`), `, ${markWhen(m, hd.day)}`);
  if (at.mode === "band") {
    const { marks, now, sweep } = drawBand(hd.plot, hd.day, at.width, say, at.fs);
    hd.marks = marks;
    sweepOnce(now, sweep);
  } else {
    hd.marks = drawDial(hd.plot, hd.day, at.width, at.fs, say).marks;
  }
  if (hd.lit) light(hd, hd.lit);
}

function renderRack(hd, rows, onReload) {
  const compact = hd.root.dataset.day === "dial";
  hd.rack.replaceChildren(...rows.map((r) => rackRow(r, onReload, compact)));
}

// One render of everything Home read. `src` holds each route's answer, null for one that didn't answer.
export function renderDashboard(state, src, onReload) {
  const hd = state.hd;
  if (!hd) return;
  const nowTs = Math.floor(Date.now() / 1000);
  const spot = focusSpot(hd);

  // Today
  if (src.today) {
    hd.day = src.today;
    hd.drawnWidth = 0;
    redrawBand(state);
    hd.counts.replaceChildren(...countItems(src.today.counts).map((c) =>
      h("li", {}, h("b", { class: `hd-meter hd-k-${c.kind}` }, c.value), tallyLabel(c))));
  } else {
    hd.day = null;
    hd.drawnWidth = 0;
    hd.plot.replaceChildren(h("p", { class: "hd-band__down" }, sourceDown("Pi Hub")));
    hd.counts.replaceChildren(...countItems().map((c) => h("li", {}, h("b", { class: `hd-meter hd-k-${c.kind}` }, c.value), tallyLabel(c))));
  }

  // Needs you: the same merged list as before, ordered by tone; the badge counts it (baseline 5.5). With neither of
  // its sources answering there is no list (state.probs null: the badge is left alone); with one, the list says which
  // part is missing, and never "Nothing needs you".
  {
    const down = [src.needs ? "" : sourceDown("Needs you"), src.records ? "" : sourceDown("Pi Hub's records")].filter(Boolean);
    const probs = !src.needs && !src.records ? null : needsOrder(mergeProblems(src.records || [], src.needs));
    state.probs = probs;
    hd.needsCount.textContent = probs?.length ? String(probs.length) : "";
    const note = down.length ? h("p", { class: "hd-needs__down" }, `${down.join(". ")}. It will keep trying.`) : null;
    hd.needs.replaceChildren(...[
      probs?.length ? renderProblems(probs, onReload) : null,
      note || (probs?.length ? null : h("p", { class: "ui-needs__empty" }, "Nothing needs you right now.")),
    ].filter(Boolean));
    (probs || []).forEach((p, i) => {
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
  hd.rackArgs = [rows, onReload];
  renderRack(hd, rows, onReload);
  const fine = src.records ? otherFine(src.records) : [];
  const open = !!hd.others.querySelector("details")?.open;  // a refresh keeps the list as the owner left it
  hd.others.replaceChildren(...(fine.length ? [h("details", { class: "hd-others__box", open: open || null },
    h("summary", { class: "hd-others__summary" }, `${fine.length} other thing${fine.length === 1 ? " is" : "s are"} fine`),
    h("ul", { class: "hd-others__list" }, ...fine.map((r) => h("li", {},
      h("a", { href: recordPath(r.id), "data-link": true }, RECORD_LABELS[r.id] || r.id), h("span", {}, r.headline || r.state)))))] : []));
  refocus(hd, spot);
  return rows;
}
