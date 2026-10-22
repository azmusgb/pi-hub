// Small device-local indicators. Nothing is uploaded or tracked across devices.
import { api, h } from "./core.js";
import { unreadCount } from "./experience.js";
let seen = Math.floor(Date.now() / 1000);
try {
  const saved = localStorage.getItem("hub-alerts-seen");
  if (saved && Number.isFinite(Number(saved))) seen = Number(saved);
  else localStorage.setItem("hub-alerts-seen", String(seen));
} catch {}
let alerts = [], print = "", pending = false;

function render() {
  const count = unreadCount(alerts, seen);
  for (const a of document.querySelectorAll('.rail a[data-page]')) {
    const base = a.dataset.navLabel || a.getAttribute("aria-label");
    a.dataset.navLabel = base;
    const key = a.dataset.page;
    const detail = key === "alerts" && count ? `${count} new alerts`
      : key === "workshop" && print ? print
      : key === "more" ? [count ? `${count} new alerts` : "", print].filter(Boolean).join("; ") : "";
    a.querySelector(".nav-badge")?.remove();
    if (detail) a.append(h("span", { class: "nav-badge", "aria-hidden": "true" }, count && ["alerts", "more"].includes(key) ? (count > 99 ? "99+" : String(count)) : "Print"));
    a.setAttribute("aria-label", detail ? `${base}, ${detail}` : base);
    a.title = detail ? `${base}: ${detail}` : base;
  }
}
export function markAlertsSeen(items) {
  alerts = items;
  seen = Math.max(seen, ...items.map(a => a.ts).filter(Number.isFinite));
  try { localStorage.setItem("hub-alerts-seen", String(seen)); } catch {}
  render();
}
export async function updateNavigation() {
  if (pending || document.hidden) return;
  pending = true;
  try {
    const [a, n] = await Promise.allSettled([api("/api/alerts"), api("/api/now")]);
    alerts = a.status === "fulfilled" ? a.value.alerts : [];
    const printer = n.status === "fulfilled" ? n.value.printer : null;
    print = printer?.state === "printing" ? `3D print running, ${printer.progress || 0}%` : printer?.state === "paused" ? "3D print paused" : "";
    render();
  } finally { pending = false; }
}
