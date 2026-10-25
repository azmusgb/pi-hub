// The hub's menu, by task (docs/superpowers/specs/2026-10-24-one-home-design.md, D2). The rail in index.html lists
// these in this order; the router, the active tab and old bookmarks all read from here.

export const ASSISTANT_URL = "https://assistant.home.arpa/";

export const SECTIONS = [
  { key: "home", title: "Home", path: "/", pages: ["/", "/wall", "/weather"] },
  { key: "workshop", title: "Workshop", path: "/workshop", pages: ["/workshop"] },
  { key: "documents", title: "Documents", path: "/documents", pages: ["/documents", "/print", "/lists"] },
  { key: "media", title: "Media", path: "/media", pages: ["/media", "/movies"] },
  { key: "network", title: "Home & network", path: "/network", pages: ["/network", "/control"] },
  { key: "system", title: "System", path: "/system", pages: ["/system", "/pi", "/alerts", "/rules", "/settings", "/drives"] },
];

// On the phone, Home & network and System sit under More.
const PHONE = ["home", "workshop", "documents", "media", "more"];

const REDIRECTS = {
  "/movies": "/media",
  "/control": "/network",
  "/apps": "/",
  "/apps/bambuddy": "/workshop",
  "/bambuddy": "/workshop",
  "/apps/grafana": "/network",
  "/grafana": "/network",
  "/apps/status": "/network",
  "/status": "/network",
  "/apps/scan": "/documents",
};

export function sectionFor(path) {
  if (path === "/more") return "more";
  return SECTIONS.find((s) => s.pages.includes(path))?.key || "home";
}

export function redirectFor(path) {
  return REDIRECTS[path] || null;
}

export const railItems = () => SECTIONS.map((s) => s.key);
export const phoneTabs = () => [...PHONE];

// Each tool by its gate name when the hub itself was opened on one; otherwise its old address, which keeps working
// until the names resolve on every device (step 6 retires them).
const OLD = {
  assistant: "https://10.0.0.21/",
  paperless: "http://10.0.0.21:8010/",
  bambuddy: ":8000",
  homebox: ":7745",
  backups: ":9898",
  network: ":3000",
  status: ":3001",
  adguard: ":3002",
  devices: ":8581",
  pi: "https://{host}:9090/",
  scan: "/scan/",
};

export function toolUrl(name, host = globalThis.location?.hostname || "") {
  if (host === "home.arpa" || host.endsWith(".home.arpa")) return `https://${name}.home.arpa/`;
  const old = OLD[name] || "/";
  if (old.startsWith(":")) return `http://${host}${old}/`;
  return old.replace("{host}", host);
}

// The server names tools as "tool:<name>[/path]" (it can't know which address the page was opened by).
export function resolveLink(href, host = globalThis.location?.hostname || "") {
  const m = /^tool:([a-z]+)\/?(.*)$/.exec(href || "");
  return m ? toolUrl(m[1], host) + m[2] : href;
}

// The Assistant button hands Local AI the page and its key facts (one home, step 4): Local AI shows them over its
// composer and sends them with the next question. At most 300 characters, as the design says.
const CONTEXT_MAX = 300;
export function assistantHref(host, title, facts) {
  let text = `Pi Hub › ${title}${facts ? `: ${facts}` : ""}`.replace(/\s+/g, " ").trim();
  if (text.length > CONTEXT_MAX) text = text.slice(0, CONTEXT_MAX - 1) + "…";
  return `${toolUrl("assistant", host)}#ask?context=${encodeURIComponent(text)}`;
}
