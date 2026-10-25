import { api, h } from "./core.js";

// Checking detail, not something to act on: it lives on Help & system only (25 Oct critique). Other pages say
// "<App> isn't answering" in the card that needs it.
const SOURCES = {
  pi: ["pi", "plex", "home", "printer", "world", "weather", "calendar"],
};
export function ageLabel(seconds) {
  const age = Math.max(0, Math.floor(seconds));
  if (age < 60) return `${age} second${age === 1 ? "" : "s"} ago`;
  if (age < 3600) return `${Math.floor(age / 60)} minute${Math.floor(age / 60) === 1 ? "" : "s"} ago`;
  if (age < 86400) return `${Math.floor(age / 3600)} hour${Math.floor(age / 3600) === 1 ? "" : "s"} ago`;
  return `${Math.floor(age / 86400)} day${Math.floor(age / 86400) === 1 ? "" : "s"} ago`;
}
export function readingText(row, now, disconnected = false) {
  if (row.state === "not_configured") return "Not set up";
  if (!row.confirmed_at) return row.state === "not_checked" ? "Not checked yet" : "Couldn’t check · no earlier reading";
  const old = disconnected || row.state !== "current" || now - row.confirmed_at > row.max_age;
  const age = ageLabel(now - row.confirmed_at);
  return `${old ? "Earlier reading" : "Last response"}: ${row.reading} · ${age}${old ? " · current state unconfirmed" : ""}`;
}
export function mountFreshness(key) {
  if (!SOURCES[key]) return null;
  return h("section", { class: "source-freshness", "aria-label": "Source responses" },
    h("h2", {}, "Source responses"), h("p", { class: "meta source-explanation" },
      "Response times describe what the hub could read. Earlier readings don’t confirm a device’s current state."),
    h("dl", {}, h("div", {}, h("dt", {}, "Checking sources…"))));
}
export function renderFreshness(page) {
  if (!page.freshness || !page.sourceData) return;
  const now = page.sourceData.as_of + (Date.now() - page.sourceReceived) / 1000;
  const rows = page.sourceData.readings.filter(row => SOURCES[page.key].includes(row.key));
  page.freshness.querySelector("dl").replaceChildren(...rows.map(row =>
    h("div", { dataset: { stale: String(page.sourceError || row.state !== "current" || now - row.confirmed_at > row.max_age) } },
      h("dt", {}, row.label), h("dd", {}, readingText(row, now, page.sourceError)))));
}
export async function refreshFreshness(page) {
  if (!page.freshness || !page.state.root.isConnected || page.sourceLoading) return;
  page.sourceLoading = true;
  try {
    const data = await api("/api/freshness");
    if (!page.state.root.isConnected) return;
    page.sourceData = data; page.sourceReceived = Date.now(); page.sourceError = false;
  } catch {
    page.sourceError = true;
    if (!page.sourceData) page.freshness.querySelector("dl").textContent = "Couldn’t check source responses. We’ll keep trying.";
  } finally { page.sourceLoading = false; renderFreshness(page); }
}
