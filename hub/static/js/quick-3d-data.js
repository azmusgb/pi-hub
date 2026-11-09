// Quick Print's 3D view, the data half (A19 P7): pure functions, no Three.js, no DOM. The STL reader, the caps, and the
// toolpath-to-segments step. Everything drawn comes from the stored model and the sliced file's own layers; a cap is always
// reported back so the page can say what it left out. Nothing here takes part in authorising a print.

export const LIMITS = {
  full: { layers: 200, segments: 600000, triangles: 400000 },
  reduced: { layers: 60, segments: 150000, triangles: 80000 },
};

// A phone-class device gets the reduced mode: a coarse pointer, a narrow screen, or little memory.
export function isReduced(win = globalThis) {
  try {
    if (win.matchMedia?.("(pointer: coarse)")?.matches) return true;
    if ((win.innerWidth || 1024) < 700) return true;
    const mem = win.navigator?.deviceMemory;
    return typeof mem === "number" && mem <= 4;
  } catch { return false; }
}

export const limits = (reduced) => (reduced ? LIMITS.reduced : LIMITS.full);

// n layer indices out of `count`, evenly spaced, always the first and the last; `step` says how many were skipped between.
export function pickLayers(count, cap) {
  const n = Math.max(0, Math.floor(count) || 0), c = Math.max(2, Math.floor(cap) || 2);
  if (n <= c) return { indices: Array.from({ length: n }, (_, i) => i), step: 1 };
  const out = new Set();
  for (let k = 0; k < c; k++) out.add(Math.round((k * (n - 1)) / (c - 1)));
  return { indices: [...out].sort((a, b) => a - b), step: Math.ceil(n / c) };
}

// An STL (binary, or ASCII) to flat positions (x y z per vertex, three vertices a triangle). Over `maxTriangles` it keeps
// every k-th triangle and says so in `shown`/`triangles`. Throws an Error whose message is for the owner to read.
export function parseStl(buf, maxTriangles = LIMITS.full.triangles) {
  const bytes = buf instanceof ArrayBuffer ? buf : buf?.buffer;
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 15) throw new Error("The STL is empty or truncated.");
  const view = new DataView(bytes);
  let triangles = 0, binary = false;
  if (bytes.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (n > 0 && 84 + 50 * n === bytes.byteLength) { triangles = n; binary = true; }
  }
  const keep = (n) => Math.max(1, Math.ceil(n / Math.max(1, maxTriangles)));
  let pos, shown = 0;
  if (binary) {
    const k = keep(triangles);
    pos = new Float32Array(3 * 3 * Math.ceil(triangles / k));
    let o = 0;
    for (let t = 0; t < triangles; t += k) {
      const base = 84 + 50 * t + 12;
      for (let v = 0; v < 9; v++) pos[o++] = view.getFloat32(base + 4 * v, true);
      shown++;
    }
    pos = pos.subarray(0, o);
  } else {
    const text = new TextDecoder("ascii").decode(bytes);
    if (!/^\s*solid/i.test(text) || !/facet/i.test(text)) throw new Error("That isn't a readable STL.");
    const nums = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
    let m;
    while ((m = re.exec(text))) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
    triangles = Math.floor(nums.length / 9);
    if (!triangles) throw new Error("That isn't a readable STL.");
    const k = keep(triangles);
    pos = new Float32Array(Math.ceil(triangles / k) * 9);
    let o = 0;
    for (let t = 0; t < triangles; t += k) { for (let v = 0; v < 9; v++) pos[o++] = nums[9 * t + v]; shown++; }
    pos = pos.subarray(0, o);
  }
  if (!pos.length || pos.some((v) => !Number.isFinite(v))) throw new Error("The STL has coordinates that aren't numbers.");
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[i + a]); hi[a] = Math.max(hi[a], pos[i + a]); }
  return { positions: pos, triangles, shown, bounds: { lo, hi } };
}

// One layer's geometry (`{z, extrusion: [{f, p}], travel: [p]}`, p = x y x y …) into line segments at the layer's height:
// `lines` maps a feature to flat x y z x y z pairs, `travel` is the same for travel moves. `budget` (a segment count) caps
// the layer; it returns how many it used and how many it dropped.
export function layerSegments(geo, { travel = false, budget = Infinity } = {}) {
  const z = Number.isFinite(geo?.z) ? geo.z : 0;
  const lines = new Map(), tr = [];
  let used = 0, dropped = 0;
  const run = (p, into) => {
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (used >= budget) { dropped++; continue; }
      into.push(p[i], p[i + 1], z, p[i + 2], p[i + 3], z);
      used++;
    }
  };
  for (const r of geo?.extrusion || []) {
    if (!Array.isArray(r?.p)) continue;
    const f = r.f || "Other";
    if (!lines.has(f)) lines.set(f, []);
    run(r.p, lines.get(f));
  }
  if (travel) for (const p of geo?.travel || []) if (Array.isArray(p)) run(p, tr);
  return { lines, travel: tr, used, dropped };
}

// The six standard views plus an isometric one, as a direction from the target to the camera and the up vector. The print
// bed's Z points up, so Top looks down Z; Front looks along +Y (the front of the bed is low Y).
export const VIEWS = {
  iso: { label: "Isometric", dir: [1, -1.2, 0.9], up: [0, 0, 1] },
  top: { label: "Top", dir: [0, 0, 1], up: [0, 1, 0] },
  bottom: { label: "Bottom", dir: [0, 0, -1], up: [0, 1, 0] },
  front: { label: "Front", dir: [0, -1, 0], up: [0, 0, 1] },
  back: { label: "Back", dir: [0, 1, 0], up: [0, 0, 1] },
  left: { label: "Left", dir: [-1, 0, 0], up: [0, 0, 1] },
  right: { label: "Right", dir: [1, 0, 0], up: [0, 0, 1] },
};

// What the caps left out, in words for the screen: "" when nothing was.
export function reductionNote({ reduced, layers, step, dropped, modelShown, modelTotal }) {
  const parts = [];
  if (step > 1) parts.push(`every ${step === 2 ? "second" : `${step}th`} layer is drawn (${layers} of the file's layers)`);
  if (dropped > 0) parts.push(`${dropped.toLocaleString("en-US")} short path segments were left out`);
  if (modelTotal > modelShown) parts.push(`the model is thinned to ${modelShown.toLocaleString("en-US")} of ${modelTotal.toLocaleString("en-US")} triangles`);
  if (!parts.length && !reduced) return "";
  return `${reduced ? "Reduced mode for this device: " : "To keep this smooth, "}${parts.join("; ") || "nothing was left out"}.`;
}
