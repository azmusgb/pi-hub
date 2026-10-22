import { VERIFIABLE, verifyRecovery } from "./recovery.js";
// Shared helpers for every page: building elements, talking to the hub, and small formatters.

export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid instanceof Node ? kid : String(kid));
  return n;
}

export async function api(path, opts = {}) {
  const timeout = path.startsWith("/api/drives") ? 150000 : 30000;
  const r = await fetch(path, { cache: "no-store", signal: !opts.method || opts.method === "GET" ? AbortSignal.timeout(timeout) : undefined, ...opts });
  let body = null;
  try { body = await r.json(); } catch {}
  if (!r.ok) throw new Error(body?.detail || body?.error || `The hub answered ${r.status}.`);
  return body;
}

export const post = (path, data) => api(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: data === undefined ? undefined : JSON.stringify(data),
});

let toastTimer;
export function toast(message, tone = "ok") {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.dataset.tone = tone;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

export const clockTime = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function when(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const time = clockTime(ts);
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

export function duration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function spark(values, { max, height = 28 } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 100 ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("spark");
  const vals = (values || []).filter((v) => v != null);
  if (vals.length < 2) return svg;
  const top = max ?? Math.max(...vals, 1);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${height - (Math.min(v, top) / top) * (height - 2)}`);
  const area = document.createElementNS(ns, "polygon");
  area.setAttribute("points", `0,${height} ${pts.join(" ")} 100,${height}`);
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", pts.join(" "));
  svg.append(area, line);
  return svg;
}

export function card(title, { pill, tone, id, cls } = {}, ...body) {
  return h("section", { class: `card ${cls || ""}`, id },
    h("div", { class: "card-head" }, h("h2", {}, title), pill ? h("span", { class: "pill", dataset: { tone } }, pill) : null),
    ...body);
}

export const empty = (text) => h("p", { class: "empty" }, text);

// Links to apps on this Pi follow whatever address the hub was opened with.
export const piLink = (port, path = "", scheme = "http") => `${scheme}://${location.hostname}:${port}${path}`;

// ---- Who's signed in, and asking for the PIN only when an action needs it ----
let me = null;
export async function whoami(force = false) {
  if (!me || force) me = await api("/api/me");
  return me;
}

export function forgetMe() { me = null; }

const RANK = { none: 0, kid: 1, household: 2, owner: 3 };

export async function ensure(role = "household") {
  // "kid" is enough for switching lights; everything else that acts needs an adult's PIN.
  const m = await whoami(true);
  if (RANK[m.role] >= RANK[role]) return true;
  if (m.setup_needed) {
    toast("Set up the hub first: choose the household PIN in Settings.", "warn");
    setTimeout(() => location.assign("/settings"), 1200);
    return false;
  }
  if (role === "owner") { location.assign("/settings"); return false; }
  return pinSheet();
}

function pinSheet() {
  return new Promise((resolve) => {
    const input = h("input", { type: "password", inputmode: "numeric", pattern: "[0-9]*", maxlength: 6, autocomplete: "one-time-code",
      id: "pin-input", class: "pin-input", "aria-describedby": "pin-help" });
    const err = h("p", { class: "sheet-error", role: "alert" });
    const prev = document.activeElement;
    const close = (ok) => { dlg.close(); dlg.remove(); prev?.focus?.(); resolve(ok); };
    const form = h("form", { method: "dialog", class: "sheet-body", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      try {
        await post("/api/signin", { pin: input.value });
        me = null;
        await whoami();
        toast("Unlocked on this device for 30 days.");
        close(true);
      } catch (x) { err.textContent = x.message; input.select(); }
    } },
    h("h2", {}, "Enter your PIN"),
    h("p", { id: "pin-help", class: "meta" }, "The household PIN, or your own. Needed once on each device before it can change things."),
    h("label", { for: "pin-input", class: "sr" }, "Household PIN"), input, err,
    h("div", { class: "sheet-actions" },
      h("button", { type: "button", class: "ghost", onclick: () => close(false) }, "Cancel"),
      h("button", { type: "submit", class: "primary" }, "Unlock")));
    const dlg = h("dialog", { class: "sheet", "aria-label": "Household PIN" }, form);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(false); });
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  });
}

// Runs a Fix-it action after a confirm, and says what happened.
export async function fix(name, label, { confirmText, onResult, isCurrent = () => true } = {}) {
  if (!(await ensure("household")) || !isCurrent()) return false;
  if (!confirm(confirmText || `${label}?`)) return false;
  toast(`${label}…`, "warn");
  try {
    const r = await post(`/api/actions/${encodeURIComponent(name)}`);
    if (!isCurrent()) return true;
    if (VERIFIABLE.has(name)) {
      await verifyFix(name, { onResult, isCurrent });
    } else {
      toast(r.message);
      onResult?.({ ok: true, message: r.message, verification: { state: "not_supported",
        next_step: "Check the action’s progress and try the original task again." } });
    }
    return true;
  } catch (e) {
    if (isCurrent()) {
      toast(e.message, "bad");
      onResult?.({ ok: false, message: e.message });
    }
    return false;
  }
}

export async function verifyFix(name, { onResult, isCurrent = () => true } = {}) {
  onResult?.({ ok: true, message: "Checking the affected service…", verification: { state: "checking" } });
  const verification = await verifyRecovery(name, {
    active: isCurrent,
    check: key => api(`/api/actions/${encodeURIComponent(key)}/verification`, { signal: AbortSignal.timeout(15000) }),
  });
  if (!isCurrent() || verification.state === "cancelled") return;
  toast(verification.message, verification.state === "recovered" ? "ok" : "warn");
  onResult?.({ ok: true, message: verification.message, verification });
}

// ---- Weather icons: a small drawn set, coloured by the stylesheet ----
const SUN = '<circle cx="12" cy="12" r="4.2" class="wx-sun"/><path class="wx-ray" d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>';
const MOON = '<path class="wx-moon" d="M16.5 15.8A7 7 0 0 1 9.2 5.2a7 7 0 1 0 7.3 10.6z"/>';
const CLOUD = '<path class="wx-cloud" d="M7 18.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2-1A4.3 4.3 0 0 0 7 18.5z"/>';
const SMALL_SUN = '<g transform="translate(-3.5 -3.5) scale(.75)">' + SUN + '</g>';
const SMALL_MOON = '<g transform="translate(-2.5 -3) scale(.75)">' + MOON + '</g>';
const WX = {
  "clear-day": SUN,
  "clear-night": MOON,
  "partly-day": SMALL_SUN + '<g transform="translate(3 3) scale(.82)">' + CLOUD + '</g>',
  "partly-night": SMALL_MOON + '<g transform="translate(3 3) scale(.82)">' + CLOUD + '</g>',
  cloudy: CLOUD,
  fog: '<path class="wx-line" d="M4 9h16M3 13h18M5 17h14"/>',
  rain: '<g transform="translate(0 -3)">' + CLOUD + '</g><path class="wx-drop" d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>',
  sleet: '<g transform="translate(0 -3)">' + CLOUD + '</g><path class="wx-drop" d="M8.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/><circle cx="12" cy="20" r="1" class="wx-flake"/>',
  snow: '<g transform="translate(0 -3)">' + CLOUD + '</g><circle cx="8" cy="19.5" r="1" class="wx-flake"/><circle cx="12" cy="21" r="1" class="wx-flake"/><circle cx="16" cy="19.5" r="1" class="wx-flake"/>',
  storm: '<g transform="translate(0 -3)">' + CLOUD + '</g><path class="wx-bolt" d="M12.5 15.5l-2.5 4h3l-1.5 3.5"/>',
};
export function weatherIcon(name, label = "") {
  const span = document.createElement("span");
  span.className = `wx wx-${name}`;
  span.setAttribute("role", label ? "img" : "presentation");
  if (label) span.setAttribute("aria-label", label);
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${WX[name] || CLOUD}</svg>`;  // fixed markup from this file only
  return span;
}
