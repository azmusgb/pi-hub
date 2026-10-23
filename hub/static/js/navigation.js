// Small device-local indicators. Nothing is uploaded or tracked across devices.
import { api, h } from "./core.js";
import { unreadCount } from "./experience.js";

const ALERTS_SEEN_KEY = "hub-alerts-seen";
const MAX_BADGE_COUNT = 99;

let seen = readSeenTimestamp();
let alerts = [];
let print = "";
let pending = false;

function readSeenTimestamp() {
  const now = Math.floor(Date.now() / 1000);

  try {
    const saved = Number(localStorage.getItem(ALERTS_SEEN_KEY));

    if (Number.isFinite(saved) && saved >= 0) {
      return saved;
    }

    localStorage.setItem(ALERTS_SEEN_KEY, String(now));
  } catch {
    // localStorage can be unavailable in private/restricted contexts.
  }

  return now;
}

function saveSeenTimestamp(value) {
  try {
    localStorage.setItem(ALERTS_SEEN_KEY, String(value));
  } catch {
    // Navigation indicators are non-critical. Ignore storage failures.
  }
}

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function printerStatus(printer) {
  if (!printer || typeof printer !== "object") {
    return "";
  }

  if (printer.state === "printing") {
    return `3D print running, ${clampPercent(printer.progress)}%`;
  }

  if (printer.state === "paused") {
    return "3D print paused";
  }

  return "";
}

function badgeText(key, count) {
  if (count > 0 && (key === "alerts" || key === "more")) {
    return count > MAX_BADGE_COUNT
      ? `${MAX_BADGE_COUNT}+`
      : String(count);
  }

  if (key === "workshop" && print) {
    return "Print";
  }

  return "";
}

function detailForPage(key, count) {
  if (key === "alerts") {
    return count > 0
      ? `${count} new alert${count === 1 ? "" : "s"}`
      : "";
  }

  if (key === "workshop") {
    return print;
  }

  if (key === "more") {
    return [
      count > 0
        ? `${count} new alert${count === 1 ? "" : "s"}`
        : "",
      print,
    ]
      .filter(Boolean)
      .join("; ");
  }

  return "";
}

function getBaseLabel(anchor) {
  const saved = anchor.dataset.navLabel;

  if (saved) {
    return saved;
  }

  const ariaLabel = anchor.getAttribute("aria-label")?.trim();

  if (ariaLabel) {
    anchor.dataset.navLabel = ariaLabel;
    return ariaLabel;
  }

  // Last-resort fallback for a malformed navigation link.
  const text = anchor.textContent?.trim() || "Navigation";

  anchor.dataset.navLabel = text;
  return text;
}

function render() {
  const count = unreadCount(alerts, seen);

  for (const anchor of document.querySelectorAll(".rail a[data-page]")) {
    const base = getBaseLabel(anchor);
    const key = anchor.dataset.page || "";
    const detail = detailForPage(key, count);
    const badge = badgeText(key, count);

    anchor.querySelector(".nav-badge")?.remove();

    if (badge) {
      anchor.append(
        h(
          "span",
          {
            class: "nav-badge",
            "aria-hidden": "true",
          },
          badge,
        ),
      );
    }

    anchor.setAttribute(
      "aria-label",
      detail
        ? `${base}, ${detail}`
        : base,
    );

    anchor.title = detail
      ? `${base}: ${detail}`
      : base;
  }
}

export function markAlertsSeen(items) {
  if (Array.isArray(items)) {
    alerts = items;

    const timestamps = items
      .map((alert) => toTimestamp(alert?.ts))
      .filter((timestamp) => timestamp !== null);

    if (timestamps.length) {
      seen = Math.max(seen, ...timestamps);
      saveSeenTimestamp(seen);
    }
  }

  render();
}

export async function updateNavigation() {
  if (pending || document.hidden) {
    return;
  }

  pending = true;

  try {
    const [alertsResult, nowResult] = await Promise.allSettled([
      api("/api/alerts"),
      api("/api/now"),
    ]);

    /*
     * Preserve the previous state when a request fails.
     *
     * A transient API/network error should not make an existing alert badge or
     * active-print indicator disappear until the next successful refresh.
     */
    if (alertsResult.status === "fulfilled") {
      alerts = Array.isArray(alertsResult.value?.alerts)
        ? alertsResult.value.alerts
        : [];
    }

    if (nowResult.status === "fulfilled") {
      print = printerStatus(nowResult.value?.printer);
    }

    render();
  } finally {
    pending = false;
  }
}