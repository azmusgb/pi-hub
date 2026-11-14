// /lab photos, ported from Local AI's print-lab-photos.js and the wipe in print-lab-evidence.js: thumbnails on each
// experiment (6, then "+n"), a full-screen viewer in a <dialog> (swipe or arrows, pinch or double-tap zoom), Compare (two
// runs of one question paired by tab, linked zoom, side by side or a curtain slider), the reference wipe and the judging
// checklist (ticks kept on this device only). Tabs, runs and judge_on come from the Mac's records: everything is escaped
// or set as text, and a photo URL is built only from a 64-hex sha256 (lab.js photoUrl / realPhotos). The dialogs sit
// outside the card body, so a re-render of the page body does not close them.
import { esc, photoUrl, realPhotos } from "./lab.js";

const LIGHT = ["Raking light from one side", "Same distance", "Tab in frame"];
let cur = { ix: null };
const exps = (ix = cur.ix) => (ix && Array.isArray(ix.experiments) ? ix.experiments : []);
const url = (p, ix = cur.ix) => photoUrl(ix && ix.project, p);
const label = (p) => `${p.tab || "No tab"} · ${p.run}`;

// A tab's photos together, tabs in order, photos without a tab last; otherwise as the Mac listed them.
export function photosOf(x) {
  return realPhotos(x).map((p, i) => [p, i])
    .sort((a, b) => (a[0].tab || "\uffff").localeCompare(b[0].tab || "\uffff") || a[1] - b[1]).map((a) => a[0]);
}

// The runs with photos among the experiments sharing x's question, oldest first (compare pairs their photos by tab).
export function runsOf(x, ix = cur.ix) {
  const out = [];
  for (const e of exps(ix)) {
    if (e.question !== x.question) continue;
    const ph = photosOf(e);
    for (const run of new Set(ph.map((p) => p.run))) {
      out.push({ run, x: e, at: ((e.runs || []).find((r) => r.id === run) || {}).started_at || "", good: Boolean(e.verdict && e.verdict.good_enough === true), photos: ph.filter((p) => p.run === run) });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export function thumbsHtml(x, ix = cur.ix) {
  const ph = photosOf(x);
  if (!ph.length) return "";
  const id = esc(x.id), more = ph.length - 6;
  const thumbs = ph.slice(0, 6).map((p, i) => `<button type="button" class="lab-thumb" data-view="${id}" data-i="${i}" aria-label="Photo ${i + 1} of ${ph.length}: ${esc(label(p))}"><img src="${url(p, ix)}" alt="" loading="lazy"><span class="lab-thumb__tab">${esc(p.tab || p.run)}</span></button>`).join("");
  const compare = runsOf(x, ix).length > 1 ? `<button type="button" class="btn-outline lab-compare-open" data-exp="${id}">Compare</button>` : "";
  return `<div class="lab-thumbs">${thumbs}${more > 0 ? `<button type="button" class="lab-thumb lab-thumb--more" data-view="${id}" data-i="6" aria-label="${more} more photos">+${more}</button>` : ""}</div>${compare}`;
}

// This test's first photo over its reference's (the experiment named before a reference variant's last "-").
export function wipeHtml(x, ix = cur.ix) {
  const mine = photosOf(x)[0];
  if (!mine) return "";
  const byId = Object.fromEntries(exps(ix).map((e) => [e.id, e]));
  const ref = (Array.isArray(x.reference_variants) ? x.reference_variants : []).map((r) => byId[String(r).replace(/-[^-]*$/, "")]).find((r) => r && photosOf(r)[0]);
  if (!ref) return "";
  return `<figure class="lab-wipe" style="--x:50%"><img src="${url(photosOf(ref)[0], ix)}" alt="${esc(ref.id)}, the reference">`
    + `<img class="lab-wipe__after" src="${url(mine, ix)}" alt="${esc(x.id)}">`
    + `<input type="range" min="0" max="100" value="50" aria-label="Drag between ${esc(ref.id)} and ${esc(x.id)}">`
    + `<figcaption><span>${esc(ref.id)}</span><span>${esc(x.id)}</span></figcaption></figure>`;
}

const tickKey = (id) => "printLab:ticks:" + id;
export function ticksOf(id) {
  try { const t = JSON.parse(localStorage.getItem(tickKey(id)) || "[]"); return Array.isArray(t) ? t : []; } catch { return []; }
}
export function saveTick(id, i, on) {
  const set = new Set(ticksOf(id));
  if (on) set.add(Number(i)); else set.delete(Number(i));
  try { localStorage.setItem(tickKey(id), JSON.stringify([...set])); } catch { /* a memory aid only */ }
}
export function checklistHtml(x) {
  const items = [...String(x.judge_on || "").split(";").map((s) => s.trim()).filter(Boolean), ...LIGHT], on = ticksOf(x.id);
  return `<fieldset class="lab-checklist__set"><legend>Before you judge</legend>${items.map((t, i) => `<label class="lab-checkbox-label"><input type="checkbox" data-tick="${esc(x.id)}" data-i="${i}"${on.includes(i) ? " checked" : ""}><span>${esc(t)}</span></label>`).join("")}</fieldset>`;
}

// Zoom and pan on the images under `area`: double-tap or double-click toggles 1:1 pixel inspection crop, two fingers
// pinch, one drags while zoomed. Every image imgs() returns moves together (Compare's linked zoom). onSwipe(+1|-1) for
// a sideways swipe.
function zoomable(area,imgs,onSwipe){
 const z={s:1,x:0,y:0},pts=new Map();let pinch=null,start=null,last=0,kind='';
 const apply=anim=>{if(z.s<=1){z.s=1;z.x=0;z.y=0}for(const i of imgs()){i.style.transition=anim?'transform .18s ease-out':'none';i.style.transform=`translate(${z.x}px,${z.y}px) scale(${z.s})`}};
 const toggle=(target,tx,ty)=>{
  if(z.s>1){z.s=1;z.x=0;z.y=0;apply(true);return}
  const img=target||imgs()[0];
  const nat=img&&img.naturalWidth&&img.clientWidth?(img.naturalWidth/img.clientWidth):2.5;
  const targetS=Math.min(6,Math.max(2,nat));
  z.s=targetS;
  if(tx!=null&&ty!=null&&img){
   const r=img.getBoundingClientRect();
   z.x=(r.left+r.width/2-tx)*(targetS-1);
   z.y=(r.top+r.height/2-ty)*(targetS-1);
  }else{z.x=0;z.y=0}
  apply(true);
 };
 area.addEventListener('pointerdown',e=>{
  if(e.target.tagName!=='IMG')return;kind=e.pointerType;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===2){const [a,b]=[...pts.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,s:z.s};start=null}
  else start={x:e.clientX,y:e.clientY,zx:z.x,zy:z.y};
 });
 area.addEventListener('pointermove',e=>{
  if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&pts.size===2){const [a,b]=[...pts.values()];z.s=Math.min(5,Math.max(1,pinch.s*Math.hypot(a.x-b.x,a.y-b.y)/pinch.d));apply(false)}
  else if(start&&z.s>1){z.x=start.zx+e.clientX-start.x;z.y=start.zy+e.clientY-start.y;apply(false)}
 });
 const end=e=>{
  if(!pts.delete(e.pointerId))return;
  if(pinch){if(!pts.size)pinch=null;return}
  if(!start||e.type==='pointercancel'){start=null;return}
  const dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;
  if(z.s===1&&onSwipe&&Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)){onSwipe(dx<0?1:-1);return}
  if(e.pointerType==='touch'&&Math.hypot(dx,dy)<10){const t=Date.now();if(t-last<300){toggle(e.target,e.clientX,e.clientY);last=0}else last=t}
 };
 area.addEventListener('pointerup',end);area.addEventListener('pointercancel',end);
 area.addEventListener('dblclick',e=>{if(e.target.tagName==='IMG'&&kind!=='touch')toggle(e.target,e.clientX,e.clientY)});
 return {reset(){z.s=1;apply(false)}};
}


let host = null;
// A dialog is wired once per element: main.js empties the page on navigation, so the next visit builds new dialogs
// and they need their own handlers and zoom state.
const wiredDialogs = new WeakSet();
export function wireOnce(d, setup) {
  if (wiredDialogs.has(d)) return false;
  wiredDialogs.add(d);
  setup(d);
  return true;
}
function dialog(id, html) {
  let d = document.getElementById(id);
  if (!d) { host.insertAdjacentHTML("beforeend", html); d = document.getElementById(id); }
  return d;
}
// ---- the viewer ----
let view = null, viewZoom = null;
function viewerEl() {
  const d = dialog("labViewer", `<dialog id="labViewer" class="lab-viewer" aria-label="Photo"><div class="lab-viewer__stage"><img class="lab-viewer__img" alt=""></div><p class="lab-viewer__cap" aria-live="polite"></p><div class="lab-viewer__nav"><button type="button" class="btn-outline" data-step="-1" aria-label="Previous photo">‹</button><button type="button" class="btn-outline" data-step="1" aria-label="Next photo">›</button><button type="button" class="btn-outline" id="labViewerClose">Close</button></div></dialog>`);
  wireOnce(d, () => {
    viewZoom = zoomable(d.querySelector(".lab-viewer__stage"), () => [d.querySelector(".lab-viewer__img")].filter(Boolean), step);
    d.addEventListener("click", (e) => { const b = e.target.closest("[data-step]"); if (b) step(Number(b.dataset.step)); else if (e.target.closest("#labViewerClose")) d.close(); });
    d.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1); } });
  });
  return d;
}
function show() {
  const d = viewerEl(), p = view.list[view.i], img = d.querySelector(".lab-viewer__img");
  img.src = url(p, view.ix); img.alt = `${view.x.id}, ${label(p)}`;
  d.querySelector(".lab-viewer__cap").textContent = `${label(p)} · ${view.i + 1} of ${view.list.length}`;
  viewZoom.reset();
}
function step(n) { if (!view) return; view.i = (view.i + n + view.list.length) % view.list.length; show(); }
export function openViewer(x, i) {
  const list = photosOf(x);
  if (!list.length) return;
  // The dialog first: making it wires it, and only then is the open photo set (wiring must never undo it).
  const d = viewerEl();
  view = { x, ix: cur.ix, list, i: Math.min(i, list.length - 1) };
  show(); if (!d.open) d.showModal();
}

// ---- Compare ----
// Two runs' photos paired by tab, in tab order, the nth photo of a tab against the nth of the other run.
export function pairsOf(a, b) {
  const out = [];
  for (const t of new Set([...a, ...b].map((p) => p.tab || ""))) {
    const l = a.filter((p) => (p.tab || "") === t), r = b.filter((p) => (p.tab || "") === t);
    for (let i = 0; i < Math.max(l.length, r.length); i++) out.push({ tab: t, l: l[i], r: r[i] });
  }
  return out;
}
let cmp = null, cmpZoom = null, cmpMode = "split";
function compareEl() {
  const d = dialog("labCompare", `<dialog id="labCompare" class="lab-compare" aria-labelledby="labCompareTitle"><div class="lab-compare__head"><h2 id="labCompareTitle" class="lab-sheet__title">Compare</h2><div class="lab-compare__modes" role="radiogroup" aria-label="Compare mode"><button type="button" class="btn-subtle" data-cmp-mode="split" aria-pressed="true">Side by side</button><button type="button" class="btn-subtle" data-cmp-mode="wipe" aria-pressed="false">Curtain slider</button></div><button type="button" class="btn-outline" id="labCompareClose">Close</button></div><div class="lab-compare__pick"><label class="lab-sheet__field">Left<select data-side="0"></select></label><label class="lab-sheet__field">Right<select data-side="1"></select></label></div><div class="lab-compare__body"></div><p class="meta lab-sheet__hint">Pinch or double-tap to zoom; drag the slider in curtain mode.</p></dialog>`);
  wireOnce(d, () => {
    cmpZoom = zoomable(d.querySelector(".lab-compare__body"), () => d.querySelectorAll(".lab-compare__body img"));
    d.addEventListener("click", (e) => {
      if (e.target.closest("#labCompareClose")) d.close();
      const m = e.target.closest("[data-cmp-mode]");
      if (m && cmp) { cmpMode = m.dataset.cmpMode; drawCompare(); }
    });
    d.addEventListener("input", (e) => { const r = e.target.closest('.lab-wipe input[type="range"]'); if (r) r.parentNode.style.setProperty("--x", `${r.value}%`); });
    d.addEventListener("change", (e) => { const s = e.target.closest("select[data-side]"); if (s && cmp) { cmp.sides[Number(s.dataset.side)] = s.value; drawCompare(); } });
  });
  return d;
}
function drawCompare() {
  const d = compareEl(), by = Object.fromEntries(cmp.runs.map((r) => [r.run, r])), u = (p) => url(p, cmp.ix);
  d.querySelectorAll("select[data-side]").forEach((sel) => {
    sel.replaceChildren(...cmp.runs.map((r) => { const o = document.createElement("option"); o.value = r.run; o.textContent = `${r.run} · ${r.x.id}${r.good ? " · good enough" : ""}`; return o; }));
    sel.value = cmp.sides[Number(sel.dataset.side)];
  });
  d.querySelectorAll("[data-cmp-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cmpMode === cmpMode)));
  const [a, b] = cmp.sides.map((r) => (by[r] || { photos: [] }).photos);
  const cell = (p) => `<div class="lab-compare__cell">${p ? `<img src="${u(p)}" alt="${esc(label(p))}">` : '<span class="meta">No photo</span>'}</div>`;
  const rows = [];
  for (const { tab: t, l, r } of pairsOf(a, b)) {
    const head = `<p class="lab-compare__tab">${esc(t || "No tab")}</p>`;
    if (cmpMode === "wipe" && l && r) {
      rows.push(`<div class="lab-compare__pair">${head}<figure class="lab-wipe" style="--x:50%"><img src="${u(l)}" alt="${esc(label(l))}"><img class="lab-wipe__after" src="${u(r)}" alt="${esc(label(r))}"><input type="range" min="0" max="100" value="50" aria-label="Slide between ${esc(label(l))} and ${esc(label(r))}"><figcaption><span>${esc(l.run)}</span><span>${esc(r.run)}</span></figcaption></figure></div>`);
    } else {
      rows.push(`<div class="lab-compare__pair">${head}<div class="lab-compare__cols">${cell(l)}${cell(r)}</div></div>`);
    }
  }
  d.querySelector(".lab-compare__body").innerHTML = rows.join("");
  cmpZoom.reset();
}
export function openCompare(x) {
  const runs = runsOf(x, cur.ix), mine = runs.filter((r) => r.x === x);
  if (!mine.length || runs.length < 2) return;
  const left = mine[mine.length - 1], others = runs.filter((r) => r !== left);
  const right = [...others].reverse().find((r) => r.good) || [...others].reverse().find((r) => r.at < left.at) || others[others.length - 1];
  const d = compareEl();
  cmp = { ix: cur.ix, runs, sides: [left.run, right.run] };
  drawCompare(); if (!d.open) d.showModal();
}

// Fill the placeholders lab.js leaves on each card ([data-lab-photos], [data-lab-wipe], [data-lab-checklist]). Called
// after every render of the page body; the click handlers are attached once per root and read the latest index.
const wired = new WeakSet();
export function mountPhotos(root, ix) {
  // A tree already taken off the page (a load that finished after leaving) must not become the one the dialogs use.
  if (!root || !ix || root.isConnected === false) return;
  cur = { ix };
  host = root.parentNode || document.body;
  const byId = Object.fromEntries(exps(ix).map((x) => [x.id, x]));
  for (const el of root.querySelectorAll("[data-lab-photos]")) { const x = byId[el.dataset.labPhotos]; if (x && photosOf(x).length) el.innerHTML = thumbsHtml(x, ix); }
  for (const el of root.querySelectorAll("[data-lab-wipe]")) { const x = byId[el.dataset.labWipe]; if (x) el.innerHTML = wipeHtml(x, ix); }
  for (const el of root.querySelectorAll("[data-lab-checklist]")) { const x = byId[el.dataset.labChecklist]; if (x) el.innerHTML = checklistHtml(x); }
  if (wired.has(root)) return;
  wired.add(root);
  const find = (id) => exps(cur.ix).find((x) => x.id === id);
  root.addEventListener("click", (e) => {
    const t = e.target.closest(".lab-thumb[data-view]");
    if (t) { const x = find(t.dataset.view); if (x) openViewer(x, Number(t.dataset.i) || 0); return; }
    const c = e.target.closest(".lab-compare-open");
    if (c) { const x = find(c.dataset.exp); if (x) openCompare(x); }
  });
  root.addEventListener("input", (e) => { const r = e.target.closest('.lab-wipe input[type="range"]'); if (r) r.parentNode.style.setProperty("--x", `${r.value}%`); });
  root.addEventListener("change", (e) => { const b = e.target.closest("input[data-tick]"); if (b) saveTick(b.dataset.tick, b.dataset.i, b.checked); });
}
