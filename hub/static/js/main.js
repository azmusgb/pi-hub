import { mountFreshness, refreshFreshness, renderFreshness } from "./freshness.js";
// The hub's router: one shell, a page module per address, each refreshing itself while it's open.
import { updateNavigation } from "./navigation.js";
import { api, ensure, h, loadOnce, toast } from "./core.js";
import * as nowPage from "./now.js";
import * as moviesPage from "./movies.js";
import * as workshopPage from "./workshop.js";
import * as printPage from "./print.js";
import * as listsPage from "./lists.js";
import * as piPage from "./pi.js";
import * as alertsPage from "./alerts.js";
import * as controlPage from "./control.js";
import * as settingsPage from "./settings.js";
import * as morePage from "./more.js";
import * as rulesPage from "./rules.js";
import * as drivesPage from "./drives.js";
import * as weatherPage from "./weather.js";
import * as documentsPage from "./documents.js";
import * as networkPage from "./network.js";
import * as systemPage from "./system.js";
import { SECTIONS, sectionFor, redirectFor, toolUrl, assistantHref, assistantButton } from "./sections.js";

// The Assistant button goes to Local AI by the address the hub was opened by, with the open page and its key facts
// (set as the person reaches for it, so they are the ones on screen).
for (const a of document.querySelectorAll(".rail-assistant, .top-assistant")) {
  a.href = toolUrl("assistant");
  const fill = () => { if (current && !a.hasAttribute("aria-disabled")) a.href = assistantHref(location.hostname, current.title, current.state.facts); };
  for (const ev of ["pointerdown", "focus", "click"]) a.addEventListener(ev, fill);
  a.addEventListener("click", (e) => { if (a.hasAttribute("aria-disabled")) e.preventDefault(); });
}
// "The PC is off" while the Pi's status service says Local AI is down; checked now, every minute, and when the page
// comes back into view (a phone wakes with an hour-old answer otherwise).
async function checkAssistant() {
  const r = await api("/api/assistant").catch(() => null);
  const { label, disabled } = assistantButton(r?.state);
  for (const a of document.querySelectorAll(".rail-assistant, .top-assistant")) {
    a.querySelector("span").textContent = label;
    a.setAttribute("aria-label", disabled ? label : "Assistant (Local AI)");
    // Without an href a link drops out of the tab order and screen readers stop reading it: keep both while it's off.
    if (disabled) { a.setAttribute("aria-disabled", "true"); a.removeAttribute("href"); a.setAttribute("role", "link"); a.tabIndex = 0; }
    else if (a.hasAttribute("aria-disabled")) { a.removeAttribute("aria-disabled"); a.removeAttribute("role"); a.removeAttribute("tabindex"); a.href = toolUrl("assistant"); }
  }
}
checkAssistant();
setInterval(checkAssistant, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAssistant(); });

const PAGES = {
  "/": { key: "now", title: "Home", mod: nowPage },
  "/wall": { key: "now", title: "Wall", mod: nowPage },
  "/movies": { key: "movies", title: "Movies", mod: moviesPage },
  "/workshop": { key: "workshop", title: "Workshop", mod: workshopPage },
  "/print": { key: "print", title: "Print", mod: printPage },
  "/lists": { key: "lists", title: "Lists", mod: listsPage },
  "/pi": { key: "pi", title: "Help & system", mod: piPage },
  "/alerts": { key: "alerts", title: "Alerts", mod: alertsPage },
  "/control": { key: "control", title: "Devices", mod: controlPage },  // old path: redirects to /network
  "/settings": { key: "settings", title: "Settings", mod: settingsPage },
  "/more": { key: "more", title: "More", mod: morePage },
  "/rules": { key: "rules", title: "Automations", mod: rulesPage },
  "/drives": { key: "drives", title: "Movie storage", mod: drivesPage },
  "/weather": { key: "weather", title: "Weather", mod: weatherPage },
  "/media": { key: "movies", title: "Media", mod: moviesPage },
  "/documents": { key: "documents", title: "Documents", mod: documentsPage },
  "/network": { key: "network", title: "Home & network", mod: networkPage },
  "/system": { key: "system", title: "System", mod: systemPage },
};

// Page-specific subtitles
const subtitles = {
  "/": "Your home at a glance",
  "/wall": "Glanceable ambient display",
  "/movies": "Plex library and playback",
  "/control": "Smart home devices and scenes",
  "/weather": "Current conditions and forecast",
  "/workshop": "The X2D, filament and projects",
  "/print": "Send jobs to the HP DeskJet",
  "/lists": "Shopping, to-dos, and notes",
  "/pi": "Fix common problems and check the hub",
  "/rules": "Set up things the house can do for you",
  "/alerts": "Recent system and device events",
  "/settings": "Configure your Pi Hub",
  "/media": "Movies and what's playing",
  "/documents": "Find, scan and print papers",
  "/network": "Devices, internet and blocking",
  "/system": "Backups, alerts and settings",
};

const updateSubtitle = () => {
  const el = document.getElementById("page-subtitle");
  if (el) {
    const path = location.pathname;
    el.textContent = subtitles[path] || "";
  }
};
document.addEventListener("DOMContentLoaded", updateSubtitle);
// Hook into pushState/popstate for SPA navigation
window.addEventListener("popstate", updateSubtitle);

const view = document.getElementById("view");
function isWall(path = location.pathname, search = location.search) {
  return path === "/wall" || new URLSearchParams(search).has("wall");
}
let current = null;
let timer = null;

if (isWall()) {
  document.documentElement.dataset.wall = "1";
  document.body.classList.add("wall");
}

// Theme: each device picks Auto (follow the device), Light or Dark. The wall display goes light by day, dark by night.
const THEMES = ["auto", "light", "dark"];
const LABEL = { auto: "Auto", light: "Light", dark: "Dark" };
const dark = window.matchMedia("(prefers-color-scheme: dark)");
let sun = null;  // [sunrise, sunset] in minutes after midnight, from the weather
function pref() { try { return localStorage.getItem("hub-theme") || "auto"; } catch { return "auto"; } }
function minutes(label) {
  const m = /^(\d+)(?::(\d+))?\s*(AM|PM)$/i.exec(label || "");
  if (!m) return null;
  return ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2] || 0);
}
function fetchSun() {
  fetch("/api/outside").then((r) => r.json()).then((o) => {
    const d = o.weather?.days?.[0];
    const rise = minutes(d?.sunrise), set = minutes(d?.sunset);
    if (rise != null && set != null) sun = [rise, set];
    applyTheme();
  }).catch(() => {});
}
export function applyTheme() {
  let theme = pref();
  if (isWall()) {
    const now = new Date(), t = now.getHours() * 60 + now.getMinutes();
    const [rise, set] = sun || [7 * 60, 19 * 60];
    theme = t >= rise && t < set ? "light" : "dark";
  } else if (theme === "auto") {
    theme = dark.matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#f5f7fa" : "#0b1118";
  const b = document.getElementById("theme-btn");
  if (b) b.textContent = `Theme: ${LABEL[pref()]}`;
}
dark.addEventListener?.("change", applyTheme);
document.getElementById("theme-btn")?.addEventListener("click", () => {
  const next = THEMES[(THEMES.indexOf(pref()) + 1) % THEMES.length];
  try { localStorage.setItem("hub-theme", next); } catch {}
  applyTheme();
});
if (isWall()) {
  fetchSun();
}
setInterval(applyTheme, 60000);
applyTheme();

function tick() {
  if (current) renderFreshness(current);
  const d = new Date();
  const c = document.getElementById("clock");
  c.textContent = d.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
  c.dateTime = d.toISOString();
  const updated = document.getElementById("updated");
  if (current?.error) updated.textContent = current.lastOk ? "Couldn’t refresh · showing earlier information" : "Page unavailable · retrying automatically";
  else if (current?.lastOk) {
    const s = Math.round((Date.now() - current.lastOk) / 1000);
    updated.textContent = s < 30 ? "Page checked just now" : `Page checked ${Math.max(1, Math.round(s / 60))} min ago`;
  } else updated.textContent = "Checking this page…";
}

// Short enough that a hung request can't leave a page on "Loading…" for good (refresh() won't start again while a
// load is still running). A page with a known slow source sets its own `loadDeadline` (Movie storage).
const LOAD_DEADLINE_MS = 45_000;

async function refresh() {
  const page = current;
  if (!page?.mod.load || page.loading) return;
  page.loading = true;
  page.state.root.setAttribute("aria-busy", "true");
  const retry = page.notice.querySelector("button");
  if (retry) { retry.disabled = true; retry.textContent = "Checking…"; }
  try {
    const { skipped } = await loadOnce(page, () => page.mod.load(page.state), page.mod.loadDeadline || LOAD_DEADLINE_MS);
    if (page !== current || skipped) return;
    page.lastOk = Date.now();
    page.error = false;
    page.notice.hidden = true;
    page.state.root.classList.remove("offline");
  } catch (e) {
    if (page !== current) return;
    console.error("Unable to refresh page", e);
    page.error = true;
    page.state.facts = "";  // never hand the Assistant facts the page couldn't confirm
    page.state.root.classList.add("offline");
    page.mod.failed?.(page.state, e);
    page.notice.hidden = false;
    page.notice.replaceChildren(
      h("h2", {}, page.lastOk ? "This page couldn’t refresh" : `Couldn’t load ${page.title.toLowerCase()}`),
      h("p", {}, page.lastOk ? "Earlier information is still shown. We’ll keep trying." : "The hub or one of its services didn’t answer. Check your home network or Tailscale connection, then retry."),
      h("button", { class: "ghost", type: "button", onclick: () => refresh() }, "Retry now"));
  } finally {
    page.loading = false;
    page.state.root.setAttribute("aria-busy", "false");
    if (page === current) { tick(); refreshFreshness(page); }
  }
}

async function show(path, { focus = false } = {}) {
  const moved = redirectFor(path);
  if (moved) { history.replaceState({}, "", moved + location.search); path = moved; }
  const page = PAGES[path] || PAGES["/"];
  const section = sectionFor(path);
  const wallMode = path === "/wall" || new URLSearchParams(location.search).has("wall");
  if (wallMode) {
    document.documentElement.dataset.wall = "1";
    document.body.classList.add("wall");
    if (!sun) fetchSun();
  } else {
    delete document.documentElement.dataset.wall;
    document.body.classList.remove("wall");
  }
  applyTheme();
  shownPath = location.pathname + location.search;
  clearInterval(timer);
  current?.mod.leave?.(current.state);
  view.replaceChildren();
  const root = document.createElement("div");
  root.className = `page page-${page.key}`;
  const notice = h("section", { class: "page-notice", role: "status" }, h("p", {}, `Loading ${page.title.toLowerCase()}…`));
  view.append(notice, root);
  const context = new URLSearchParams(location.search);
  const state = { root, context };
  const home = SECTIONS.find((x) => x.key === section);
  const parents = page.key === "drives" ? [["/media", "Media"]]
    : home && home.path !== path && home.key !== "home" ? [[home.path, home.title]]
    : context.get("from") === "home" && page.key !== "now" ? [["/", "Home"]] : [];
  if (parents.length) view.prepend(h("nav", { class: "page-trail", "aria-label": "Breadcrumb" },
    ...parents.map(([href, label]) => h("a", { href, "data-link": true }, label)),
    h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, page.title)));
  current = { ...page, state, notice, lastOk: 0 };
  const shown = current;
  tick();
  document.title = page.key === "now" ? (wallMode ? "Wall · Home" : "Home") : `${page.title} · Home`;
  document.getElementById("page-title").textContent = page.title;
  if (typeof updateSubtitle === "function") updateSubtitle();
  for (const a of document.querySelectorAll("[data-page]")) {
    const here = a.dataset.page === section || (a.dataset.page === "more" && ["network", "system", "more"].includes(section));
    if (here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  page.mod.mount(state);
  current.freshness = mountFreshness(page.key);
  if (current.freshness) view.append(current.freshness);
  await refresh();
  if (shown !== current) return;
  timer = setInterval(refresh, (page.mod.every || 15) * 1000);
  if (focus) view.focus({ preventScroll: true });
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    history.pushState({}, "", url.pathname + url.search + url.hash);
    document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
    return;
  }
  const query = new URLSearchParams(url.search);
  const destination = url.pathname + (query.size ? `?${query}` : "") + url.hash;
  if (destination !== location.pathname + location.search + location.hash) history.pushState({}, "", destination);
  show(url.pathname, { focus: true });
  window.scrollTo({ top: 0 });
});

// Jumping to a section (#group-…) is also a history step; only a new page address re-renders.
let shownPath = location.pathname + location.search;
window.addEventListener("popstate", () => { if (location.pathname + location.search !== shownPath) show(location.pathname); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); stayAwake(); } });

async function stayAwake() {
  try { if (isWall() && "wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch {}
}

// The front gate (hub/gate.py) sends a signed-out visit to any *.home.arpa tool here with ?signin=owner&next=…:
// sign in, then go back to that tool. Only https home.arpa addresses are followed, as on the server.
export function safeNext(url) {
  try {
    const u = new URL(url);
    const ours = u.hostname === "home.arpa" || u.hostname.endsWith(".home.arpa");
    return u.protocol === "https:" && ours && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

async function gateSignIn() {
  const q = new URLSearchParams(location.search);
  if (q.get("signin") !== "owner") return;
  const next = safeNext(q.get("next") || "");
  const hash = location.hash;  // the gate's redirect carried the tool's #fragment; replaceState would drop it
  history.replaceState({}, "", location.pathname);
  if (!(await ensure("owner")) || !next) return;
  // Already signed in here, but the tool sent us back: the tool's gate cookie is missing or stale. Ask for a fresh hand-off once; if the
  // tool still sends us back within a minute, say so instead of bouncing.
  let tries = [];
  try { tries = JSON.parse(sessionStorage.getItem("gateTries") || "[]").filter((t) => Date.now() - t < 60000); } catch { /* private mode */ }
  if (tries.length >= 2) { toast("This browser isn't keeping the sign-in for the other tools. Check that it allows cookies for home.arpa.", "bad"); return; }
  try { sessionStorage.setItem("gateTries", JSON.stringify([...tries, Date.now()])); } catch { /* private mode */ }
  const r = await fetch("/api/gate/renew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ next }) }).catch(() => null);
  const to = r && r.ok ? safeNext((await r.json().catch(() => ({}))).next) : null;
  if (to) location.replace(new URL(to).hash ? to : to + hash);
  else toast("Couldn't sign in to the other tools. Open https://home.home.arpa and try again.", "bad");
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
tick();
setInterval(tick, 15000);
show(location.pathname);
updateNavigation();
setInterval(updateNavigation, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateNavigation(); });
stayAwake();
gateSignIn();


