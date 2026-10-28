// /lab: the 15 s refresh that doesn't lose your place. main.js calls load() every 15 s; the page re-renders only when the
// Mac's sync fingerprint changed and no dialog is open. snapshot()/restore() keep the scroll position, the open <details>
// and focus across a render (a port of Local AI's print-lab-refresh.js). The decisions are pure and exported for node.

// "render" the notebook, "quiet" (statuses and the sync age only) or "defer" (changed, but a dialog is open: leave it be and
// look again next time). `rendered` is the fingerprint last drawn; with no fingerprint on either side it always renders.
export function refreshPlan(meta, rendered, dialogOpen) {
  const fp = meta && typeof meta.fingerprint === "string" && meta.fingerprint ? meta.fingerprint : null;
  const changed = rendered === undefined || rendered === null || !fp || fp !== rendered;
  if (!changed) return "quiet";
  return dialogOpen ? "defer" : "render";
}
export const dialogOpen = (doc = globalThis.document) => Boolean(doc && doc.querySelector && doc.querySelector("dialog[open]"));

// Cards whose HTML differs from last time; nothing flashes on the first render.
export function changedIds(prev, next) {
  if (!prev) return [];
  return Object.keys(next).filter((id) => !(id in prev) || prev[id] !== next[id]);
}

// CSS.escape where the browser has it; the same algorithm otherwise (node), so a newline or a leading digit in an id or
// a data-* value can't make an invalid selector.
export function cssEscape(v) {
  const s = String(v);
  if (globalThis.CSS && typeof globalThis.CSS.escape === "function") return globalThis.CSS.escape(s);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i), ch = s[i];
    if (c === 0) out += "\ufffd";
    else if ((c >= 1 && c <= 31) || c === 127 || (c >= 48 && c <= 57 && (i === 0 || (i === 1 && s[0] === "-")))) out += "\\" + c.toString(16) + " ";
    else if (i === 0 && s.length === 1 && ch === "-") out += "\\-";
    else if (c >= 128 || ch === "-" || ch === "_" || /[0-9A-Za-z]/.test(ch)) out += ch;
    else out += "\\" + ch;
  }
  return out;
}
const sel = (id) => "#" + cssEscape(id);
const q = (v) => cssEscape(v);
// A control without an id is found again by its tag, classes and data-* attributes inside its nearest ancestor with an id
// (a card, a <details>), and its position among the matches there.
function focusKey(container, a) {
  if (!a || !a.closest || !container.contains || !container.contains(a) || a === container) return null;
  if (a.id) return { id: a.id };
  const within = a.parentElement && a.parentElement.closest("[id]");
  const scope = within && container.contains(within) ? within : container;
  const css = a.tagName.toLowerCase() + [...a.classList].map((c) => "." + cssEscape(c)).join("") +
    [...a.attributes].filter((x) => x.name.startsWith("data-")).map((x) => `[${x.name}="${q(x.value)}"]`).join("");
  return { within: scope === container ? null : scope.id, css, i: [...scope.querySelectorAll(css)].indexOf(a) };
}

// A selector the DOM rejects, or anything else odd, costs the reader their place at worst, never the render.
export function snapshot(container) {
  try { return takeSnapshot(container); } catch { return { scrollY: 0, open: [], focusId: null, focus: null, anchor: null, failed: true }; }
}
export function restore(container, snap) {
  try { if (snap && !snap.failed) putBack(container, snap); } catch { /* the page is drawn; only the place is lost */ }
}

function takeSnapshot(container) {
  const doc = container.ownerDocument, a = doc.activeElement, key = focusKey(container, a);
  // The card being read: the first one still on screen, and where its top is, so a change above it doesn't move it.
  const card = [...container.querySelectorAll(".lab-exp")].find((c) => c.getBoundingClientRect().bottom > 0);
  return {
    scrollY: doc.defaultView.scrollY,
    open: [...container.querySelectorAll("details[open]")].map((d) => d.id).filter(Boolean),
    focusId: (key && key.id) || null,
    focus: key && !key.id ? key : null,
    anchor: card && card.id ? { id: card.id, top: card.getBoundingClientRect().top } : null,
  };
}

function putBack(container, snap) {
  const win = container.ownerDocument.defaultView;
  for (const id of snap.open) { const d = container.querySelector(sel(id)); if (d) d.open = true; }
  let f = snap.focusId && container.querySelector(sel(snap.focusId));
  if (!f && snap.focus) {
    const scope = snap.focus.within ? container.querySelector(sel(snap.focus.within)) : container;
    f = scope && scope.querySelectorAll(snap.focus.css)[snap.focus.i];
  }
  if (f && f.focus) f.focus({ preventScroll: true });
  const card = snap.anchor && container.querySelector(sel(snap.anchor.id));
  if (card) win.scrollBy(0, card.getBoundingClientRect().top - snap.anchor.top);
  else win.scrollTo(0, snap.scrollY);
}
