// The hub's menu, by task (docs/superpowers/specs/2026-10-24-one-home-design.md, D2). The rail in index.html lists
// these in this order; the router, the active tab and old bookmarks all read from here.

export const ASSISTANT_URL = "https://assistant.rahe-home.duckdns.org/";

export const SECTIONS = [
  { key: "home", title: "Home", path: "/", pages: ["/", "/wall", "/weather"] },
  { key: "workshop", title: "Workshop", path: "/workshop", pages: ["/workshop", "/lab"] },
  { key: "documents", title: "Documents", path: "/documents", pages: ["/documents", "/print", "/lists"] },
  { key: "media", title: "Media", path: "/media", pages: ["/media", "/movies"] },
  { key: "network", title: "Home & network", path: "/network", pages: ["/network", "/control"] },
  { key: "system", title: "System", path: "/system", pages: ["/system", "/pi", "/alerts", "/rules", "/settings", "/drives"] },
];

// On the phone, Home & network and System sit under More.
const PHONE = ["home", "workshop", "documents", "media", "more"];

const REDIRECTS = {
  "/next": "/",  // the control room is on Home since 31 Oct 2026
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

// The house's real name (docs/superpowers/specs/2026-11-01-real-names-design.md).
export const REAL = "rahe-home.duckdns.org";

// Each tool by its gate name, whatever address the page was opened on; `host` stays for resolveLink's callers.
export function toolUrl(name, host = "") {  // eslint-disable-line no-unused-vars
  return `https://${name}.${REAL}/`;
}

// The hub's own Print lab page, opened on one experiment (an internal link: give it data-link).
export function printLabUrl(exp) {
  return `/lab?e=${exp}`;
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
  if (text.length > CONTEXT_MAX) {
    let cut = CONTEXT_MAX - 1;
    if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut -= 1;  // never half an emoji: encodeURIComponent throws on one
    text = text.slice(0, cut) + "…";
  }
  return `${toolUrl("assistant", host)}#ask?context=${encodeURIComponent(text)}`;
}

// When the Pi's status service says Local AI is down, the button says so and can't be pressed. "Unknown" isn't "off".
export function assistantButton(state) {
  return state === "Down" ? { label: "The PC is off", disabled: true } : { label: "Assistant", disabled: false };
}
