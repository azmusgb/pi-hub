// The hub's menu, by task (docs/superpowers/specs/2026-10-24-one-home-design.md, D2). The rail in index.html lists
// these in this order; the router, the active tab and old bookmarks all read from here.

import ROUTES from "./routes.js";

export const ASSISTANT_URL = "https://assistant.rahe-home.duckdns.org/";

export const SECTIONS = [
  { key: "home", title: "Home", path: "/", pages: ["/", "/wall", "/weather"] },
  { key: "workshop", title: "Workshop", path: "/workshop", pages: ["/workshop", "/lab"] },
  { key: "documents", title: "Documents", path: "/documents", pages: ["/documents", "/print", "/lists"] },
  { key: "media", title: "Media", path: "/media", pages: ["/media", "/movies", "/drives"] },
  { key: "network", title: "Home & network", path: "/network", pages: ["/network", "/control"] },
  { key: "system", title: "System", path: "/system", pages: ["/system", "/backups", "/versions", "/alerts", "/rules", "/settings"] },
];

// On the phone, Home & network and System sit under More.
const PHONE = ["home", "workshop", "documents", "media", "more"];

// Old paths, kept so bookmarks still land (the list is in routes.js; /next: the control room is on Home since 31 Oct).
const REDIRECTS = ROUTES.redirects;

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

// The phrase table's two unavailable states (section 9): `pc_off` when the `pc` record is off, `assistant_down` when
// Local AI is down but the PC isn't known to be off. Either disables the button. "Unknown" isn't "off": it stays enabled.
export const PHRASES = { pc_off: "The PC is off or asleep", assistant_down: "The Assistant isn't answering" };
export function assistantButton(state, pc) {
  // A live answer from Local AI wins over a stale "off" from the network monitor.
  if (pc === "off" && state !== "Ready" && state !== "Busy") return { label: PHRASES.pc_off, phrase: "pc_off", disabled: true };
  if (state === "Down") return { label: PHRASES.assistant_down, phrase: "assistant_down", disabled: true };
  return { label: "Assistant", phrase: "", disabled: false };
}
