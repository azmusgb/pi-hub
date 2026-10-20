// The hub's router: one shell, a page module per address, each refreshing itself while it's open.
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

const PAGES = {
  "/": { key: "now", title: "Home", mod: nowPage },
  "/movies": { key: "movies", title: "Movies", mod: moviesPage },
  "/workshop": { key: "workshop", title: "Workshop", mod: workshopPage },
  "/print": { key: "print", title: "Print", mod: printPage },
  "/lists": { key: "lists", title: "Lists", mod: listsPage },
  "/pi": { key: "pi", title: "Raspberry Pi", mod: piPage },
  "/alerts": { key: "alerts", title: "Alerts", mod: alertsPage },
  "/control": { key: "control", title: "Control", mod: controlPage },
  "/settings": { key: "settings", title: "Settings", mod: settingsPage },
  "/more": { key: "more", title: "More", mod: morePage },
  "/rules": { key: "rules", title: "Rules", mod: rulesPage },
  "/drives": { key: "drives", title: "Drives", mod: drivesPage },
  "/weather": { key: "weather", title: "Weather", mod: weatherPage },
};

const view = document.getElementById("view");
const wall = new URLSearchParams(location.search).has("wall");
let current = null;
let timer = null;
let lastOk = 0;

if (wall) document.body.classList.add("wall");

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
export function applyTheme() {
  let theme = pref();
  if (wall) {
    const now = new Date(), t = now.getHours() * 60 + now.getMinutes();
    const [rise, set] = sun || [7 * 60, 19 * 60];
    theme = t >= rise && t < set ? "light" : "dark";
  } else if (theme === "auto") {
    theme = dark.matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#e3e7e8" : "#1b1f22";
  const b = document.getElementById("theme-btn");
  if (b) b.textContent = `Theme: ${LABEL[pref()]}`;
}
dark.addEventListener?.("change", applyTheme);
document.getElementById("theme-btn")?.addEventListener("click", () => {
  const next = THEMES[(THEMES.indexOf(pref()) + 1) % THEMES.length];
  try { localStorage.setItem("hub-theme", next); } catch {}
  applyTheme();
});
if (wall) {
  fetch("/api/outside").then((r) => r.json()).then((o) => {
    const d = o.weather?.days?.[0];
    const rise = minutes(d?.sunrise), set = minutes(d?.sunset);
    if (rise != null && set != null) sun = [rise, set];
    applyTheme();
  }).catch(() => {});
  setInterval(applyTheme, 60000);
}
applyTheme();

function tick() {
  const d = new Date();
  const c = document.getElementById("clock");
  c.textContent = d.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
  c.dateTime = d.toISOString();
  if (lastOk) {
    const s = Math.round((Date.now() - lastOk) / 1000);
    document.getElementById("updated").textContent = s < 30 ? "Up to date" : `Last updated ${Math.max(1, Math.round(s / 60))} min ago`;
  }
}

async function refresh() {
  if (!current?.mod.load) return;
  try {
    await current.mod.load(current.state);
    lastOk = Date.now();
    current.state.root.classList.remove("offline");
  } catch (e) {
    current.state.root.classList.add("offline");
    current.mod.failed?.(current.state, e);
  }
  tick();
}

async function show(path, { focus = false } = {}) {
  const page = PAGES[path] || PAGES["/"];
  clearInterval(timer);
  current?.mod.leave?.(current.state);
  view.replaceChildren();
  const root = document.createElement("div");
  root.className = `page page-${page.key}`;
  view.append(root);
  const state = { root };
  current = { ...page, state };
  document.title = page.key === "now" ? "Home" : `${page.title} · Home`;
  document.getElementById("page-title").textContent = page.title;
  for (const a of document.querySelectorAll("[data-page]")) {
    const here = a.dataset.page === page.key || (a.dataset.page === "more" && ["workshop", "print", "pi", "alerts", "settings", "rules", "drives", "weather", "more"].includes(page.key));
    if (here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  page.mod.mount(state);
  await refresh();
  timer = setInterval(refresh, (page.mod.every || 15) * 1000);
  if (focus) view.focus({ preventScroll: true });
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  if (url.pathname !== location.pathname) history.pushState({}, "", url.pathname + (wall ? "?wall=1" : ""));
  show(url.pathname, { focus: true });
  window.scrollTo({ top: 0 });
});

window.addEventListener("popstate", () => show(location.pathname));
document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); stayAwake(); } });

async function stayAwake() {
  try { if (wall && "wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch {}
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
tick();
setInterval(tick, 15000);
show(location.pathname);
stayAwake();
