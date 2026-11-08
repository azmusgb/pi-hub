// Quick Print's 2D layer inspector (A19 P5): one layer at a time, drawn from the sliced file's own toolpath on a canvas.
// No library and no WebGL. What the file doesn't say is said so ("Not read from the file"), never drawn from the model:
// the seam isn't in the G-code, an arc is drawn as its chord, and retractions and wipes are travel. The summary of every
// layer arrives at once (and grows while the Mac's slice is still being read); a layer's geometry is fetched when asked for.
import { api, h } from "./core.js";
import { lampRows } from "./page-parts.js";

export const HUES = [192, 38, 142, 285, 62, 332, 12, 222];
const CACHE = 40;

export const mm = (v) => Number.isFinite(v) ? `${v >= 1000 ? (v / 1000).toFixed(2) + " m" : Math.round(v * 10) / 10 + " mm"}` : "Not reported";
export const speedWords = (s) => Array.isArray(s) && s.length === 2 ? (s[0] === s[1] ? `${s[0]} mm/s` : `${s[0]} to ${s[1]} mm/s`) : "Not read from the file";

// Every feature the layers name, in the order the file first shows them, so a feature keeps its colour on every layer.
export function featureOrder(layers) {
  const seen = [];
  for (const l of layers || []) for (const f of l.features || []) if (!seen.includes(f)) seen.push(f);
  return seen;
}
export const featureColor = (i, dark) => `hsl(${HUES[i % HUES.length]} ${dark ? 62 : 70}% ${dark ? 66 : 33}%)`;

// 0 (slowest of the layer) to 1 (fastest), as a ramp of one hue so it reads in either theme: light to strong.
export function speedColor(t, dark) {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return dark ? `hsl(192 ${40 + 40 * k}% ${35 + 35 * k}%)` : `hsl(192 ${60 + 25 * k}% ${62 - 34 * k}%)`;
}

// The scale and offset that fit the file's drawn bounds into a w × h canvas with a margin; y flips (a print's Y runs up).
export function fit(bounds, w, h2, pad = 12) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !(w > 0) || !(h2 > 0)) return null;
  const [x0, y0, x1, y1] = bounds;
  const bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
  const scale = Math.min((w - 2 * pad) / bw, (h2 - 2 * pad) / bh);
  if (!(scale > 0)) return null;
  const ox = (w - bw * scale) / 2 - x0 * scale, oy = (h2 + bh * scale) / 2 + y0 * scale;
  return { scale, px: (x) => ox + x * scale, py: (y) => oy - y * scale };
}

export function figures(layer, count) {
  if (!layer) return [];
  return [
    { title: "Layer", value: `${layer.i + 1} of ${count}` },
    { title: "Height", detail: "from the file", value: Number.isFinite(layer.z) ? `${layer.z} mm` : "Not reported" },
    { title: "Printed path", detail: "from the file", value: mm(layer.extrusion_mm) },
    { title: "Travel", detail: "from the file; retractions and wipes count as travel", value: mm(layer.travel_mm) },
    { title: "Filament pushed", detail: "from the file", value: mm(layer.filament_mm) },
    { title: "Speed", detail: "the file's own feed rates", value: speedWords(layer.speed) },
    { title: "Features", detail: "named in the file", value: (layer.features || []).join(", ") || "None named" },
    { title: "Seam", detail: "G-code doesn't mark it", value: "Not read from the file" },
  ];
}

// `view`: {fit, dark, colours: [feature -> colour], by: "feature" | "speed", hide: Set of names, travel: bool, ink, muted, speed: [lo, hi]}
export function drawLayer(ctx, geo, view, w, h2) {
  ctx.clearRect(0, 0, w, h2);
  if (!geo || !view.fit) return 0;
  const { px, py } = view.fit;
  let drawn = 0;
  if (view.travel) {
    ctx.strokeStyle = view.muted; ctx.globalAlpha = 0.45; ctx.lineWidth = 0.75; ctx.beginPath();
    for (const p of geo.travel || []) {
      for (let i = 0; i + 1 < p.length; i += 2) i ? ctx.lineTo(px(p[i]), py(p[i + 1])) : ctx.moveTo(px(p[i]), py(p[i + 1]));
      drawn++;
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const [lo, hi] = view.speed || [0, 0];
  for (const r of geo.extrusion || []) {
    if (view.hide.has(r.f)) continue;
    ctx.strokeStyle = view.by === "speed" ? (r.s == null ? view.muted : speedColor(hi > lo ? (r.s - lo) / (hi - lo) : 1, view.dark)) : (view.colours.get(r.f) || view.ink);
    ctx.beginPath();
    for (let i = 0; i + 1 < r.p.length; i += 2) i ? ctx.lineTo(px(r.p[i]), py(r.p[i + 1])) : ctx.moveTo(px(r.p[i]), py(r.p[i + 1]));
    ctx.stroke(); drawn++;
  }
  return drawn;
}

const isDark = () => { try { return getComputedStyle(document.documentElement).colorScheme.includes("dark"); } catch { return false; } };
const token = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch { return d; } };

// Mounts into `into` (a node) and returns { destroy }. `jobId` names the job; `sha` ties the view to one slice.
export function layerInspector(into, jobId, { poll = 1500, get = api } = {}) {
  let dead = false, timer = null, summary = null, index = 0, token_ = 0, geo = null, loading = false, failed = null;
  const cache = new Map();
  const hide = new Set();
  let by = "feature", showTravel = false;

  const status = h("div", { class: "quick-layers__status", role: "status" });
  const slider = h("input", { type: "range", id: `ql-slider-${jobId}`, class: "quick-layers__slider", min: 0, max: 0, step: 1, value: 0, disabled: true });
  const number = h("input", { type: "number", id: `ql-number-${jobId}`, class: "ui-field quick-layers__number", min: 1, max: 1, step: 1, value: 1, inputmode: "numeric", disabled: true });
  const prev = h("button", { type: "button", class: "ui-btn", disabled: true }, "Previous layer");
  const next = h("button", { type: "button", class: "ui-btn", disabled: true }, "Next layer");
  const canvas = h("canvas", { class: "quick-layers__canvas", role: "img", "aria-label": "Layer drawing, not loaded yet" });
  const stage = h("div", { class: "quick-layers__stage" }, canvas);
  const colourBy = h("select", { id: `ql-by-${jobId}`, class: "ui-field" }, h("option", { value: "feature" }, "Feature"), h("option", { value: "speed" }, "Speed"));
  const cats = h("fieldset", { class: "quick-layers__cats" }, h("legend", {}, "Show"));
  const facts = h("div", { class: "quick-layers__facts" });
  const root = h("div", { class: "quick-layers", "aria-label": "Layer inspector" },
    h("h3", {}, "Layers"), status,
    h("div", { class: "quick-layers__controls" }, prev,
      h("label", { for: slider.id, class: "quick-layers__lab" }, "Layer", slider), next,
      h("label", { for: number.id, class: "quick-layers__lab" }, "Go to", number)),
    stage,
    h("div", { class: "quick-layers__opts" }, h("label", { for: colourBy.id, class: "quick-layers__lab" }, "Colour by", colourBy), cats),
    facts);
  into.replaceChildren(root);

  const cur = () => summary?.layers?.[index] || null;
  const dark = () => isDark();

  function setStatus(...kids) { status.replaceChildren(...kids.filter(Boolean)); }

  function redraw() {
    const w = Math.max(1, Math.floor(stage.clientWidth || 320));
    const bounds = summary?.bounds;
    const ratio = bounds ? Math.min(Math.max((bounds[3] - bounds[1]) / Math.max(bounds[2] - bounds[0], 1), 0.4), 1.4) : 0.75;
    const hh = Math.max(120, Math.min(Math.round(w * ratio), Math.round((globalThis.innerHeight || 800) * 0.7)));  // never taller than the screen
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    canvas.style.height = `${hh}px`;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const order = featureOrder(summary?.layers);
    const colours = new Map(order.map((f, i) => [f, featureColor(i, dark())]));
    const l = cur();
    drawLayer(ctx, geo, { fit: fit(bounds, w, hh), dark: dark(), colours, by, hide, travel: showTravel,
      ink: token("--ui-text", "#000"), muted: token("--ui-muted", "#666"), speed: l?.speed || [0, 0] }, w, hh);
    canvas.setAttribute("aria-label", l
      ? `Layer ${l.i + 1} of ${summary.layers.length} at ${l.z} mm: ${(l.features || []).join(", ") || "no features named"}; ${mm(l.extrusion_mm)} printed, ${mm(l.travel_mm)} of travel`
      : "Layer drawing, not loaded yet");
  }

  function drawCats() {
    const order = featureOrder(summary?.layers);
    const dk = dark();
    const box = (id, label, on, onchange, swatch) => h("label", { class: "quick-layers__cat", for: id },
      h("input", { type: "checkbox", id, checked: on, onchange }), swatch ? h("i", { class: "quick-layers__sw", style: `background:${swatch}`, "aria-hidden": "true" }) : null, label);
    cats.replaceChildren(h("legend", {}, "Show"),
      ...order.map((f, i) => box(`ql-f-${jobId}-${i}`, f, !hide.has(f), (e) => { e.target.checked ? hide.delete(f) : hide.add(f); redraw(); }, by === "feature" ? featureColor(i, dk) : null)),
      box(`ql-travel-${jobId}`, "Travel", showTravel, (e) => { showTravel = e.target.checked; redraw(); }, null));
  }

  function drawFacts() {
    const l = cur();
    facts.replaceChildren(l ? lampRows(figures(l, summary.layers.length)) : null);
  }

  function sync() {
    const n = summary?.layers?.length || 0;
    for (const el of [slider, number, prev, next]) el.disabled = !n;
    slider.max = String(Math.max(n - 1, 0)); number.max = String(Math.max(n, 1));
    index = Math.min(index, Math.max(n - 1, 0));
    slider.value = String(index); number.value = String(index + 1);
    prev.disabled = !n || index <= 0; next.disabled = !n || index >= n - 1;
    const l = cur();
    slider.setAttribute("aria-valuetext", l ? `Layer ${index + 1} of ${n}, ${l.z} millimetres` : "No layers");
    drawFacts();
  }

  async function show(i) {
    const n = summary?.layers?.length || 0;
    if (!n) return;
    index = Math.min(Math.max(Math.round(Number(i) || 0), 0), n - 1);
    sync();
    const mine = ++token_;
    failed = null;
    if (cache.has(index)) { geo = cache.get(index); redraw(); return; }
    loading = true;
    setStatus(h("span", {}, "Drawing the layer…"));
    try {
      const g = await get(`/api/quick/jobs/${jobId}/layers/${index}`);
      if (dead || mine !== token_) return;
      cache.set(index, g);
      if (cache.size > CACHE) cache.delete(cache.keys().next().value);
      geo = g;
    } catch (e) {
      if (dead || mine !== token_) return;
      geo = null; failed = e;
    } finally {
      if (!dead && mine === token_) loading = false;
    }
    if (dead || mine !== token_) return;
    renderStatus(); redraw();
  }

  function renderStatus() {
    const s = summary;
    if (!s) return setStatus(h("span", {}, "Reading the layers…"));
    const kids = [];
    if (s.state === "building") {
      const pct = Number.isFinite(s.progress) ? Math.round(100 * s.progress) : null;
      kids.push(h("span", {}, `Reading the layers from the sliced file${pct === null ? "" : `: ${pct}%`}. ${s.built} read so far.`));
      if (pct !== null) kids.push(h("span", { class: "ui-meter", role: "meter", "aria-label": "Layers read", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }, h("i", { style: `width:${pct}%` })));
    } else if (s.state === "unavailable" || s.state === "failed" || s.state === "none") {
      kids.push(h("p", { class: "ui-notice ui-notice--warn" }, `Layers unavailable. ${s.reason || ""}`.trim()));
    }
    if (s.truncated) kids.push(h("p", { class: "ui-notice ui-notice--warn" }, s.truncated));
    if (failed) kids.push(h("p", { class: "ui-notice ui-notice--bad" }, `That layer didn't load: ${failed.message || "the hub didn't answer"}.`));
    setStatus(...kids);
  }

  async function pull() {
    try {
      const s = await get(`/api/quick/jobs/${jobId}/layers`);
      if (dead) return;
      const first = !summary?.layers?.length;
      summary = s;
      renderStatus(); drawCats(); sync();
      if (first && s.layers?.length) show(0);
      else if (cache.has(index) === false && s.layers?.length && !loading) show(index);
    } catch (e) {
      if (dead) return;
      summary = summary || { state: "failed", reason: e.message || "The hub didn't answer.", layers: [] };
      renderStatus();
    }
    if (!dead && summary?.state === "building") timer = setTimeout(pull, poll);
  }

  slider.addEventListener("input", () => show(slider.value));
  number.addEventListener("change", () => show(Number(number.value) - 1));
  prev.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));
  colourBy.addEventListener("change", () => { by = colourBy.value; drawCats(); redraw(); });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => redraw()) : null;
  ro?.observe(stage);

  renderStatus();
  pull();
  return { destroy() { dead = true; clearTimeout(timer); ro?.disconnect(); } };
}
