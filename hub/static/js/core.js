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
  const r = await fetch(path, { cache: "no-store", ...opts });
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
