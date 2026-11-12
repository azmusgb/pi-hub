// Links to the house's tools, the Assistant and Print lab, and the Assistant button's words. The menu itself (areas,
// pages, old addresses) is the kit's page list, read through site.js (A22 step 12).

import { toolUrl as registryUrl } from "../ui/tools.js";

export const ASSISTANT_URL = registryUrl("assistant");

// The house's tools come from the kit's one registry (appliance-ui tools.json, platform step 7 Decision 6).
export { REAL, TOOLS, toolsFor } from "../ui/tools.js";

// A tool's link by its registry id, whatever address the page was opened on; `host` stays for resolveLink's callers.
// An id that isn't in the registry gives null, so a caller can't build a link to a host nobody serves.
export function toolUrl(name, host = "") {  // eslint-disable-line no-unused-vars
  return registryUrl(name);
}

// A tool's address with a path kept (a deeper page of the tool): null for an id that isn't in the registry.
export const toolPath = (name, path = "") => registryUrl(name, path);

// A movie's page in Plex's own web app (the registry's address, app.plex.tv), or Plex's front door when the hub doesn't know
// the server's id or the movie's key. Never a port on the Pi: the household reaches the library through Plex's own app.
export function plexUrl(machine, key) {
  return machine && key
    ? toolPath("plex", `#!/server/${machine}/details?key=${encodeURIComponent(`/library/metadata/${key}`)}`)
    : toolPath("plex");
}

// The hub's own Print lab page, opened on one experiment in its project (an internal link: give it data-link). A
// project name that isn't a lab project name is left out rather than put in the address; so is an action /lab doesn't
// take (it opens the verdict sheet for do=judge). The experiment id is encoded, so & or # in it can't add a parameter.
const LAB_ACTIONS = new Set(["judge"]);
export function printLabUrl(exp, project = "", act = "") {
  const p = typeof project === "string" && /^[a-z0-9-]{1,40}$/.test(project) ? `p=${project}&` : "";
  return `/lab?${p}e=${encodeURIComponent(String(exp ?? ""))}${LAB_ACTIONS.has(act) ? `&do=${act}` : ""}`;
}

// The server names tools as "tool:<name>[/path]" (it can't know which address the page was opened by). The Assistant
// opens in the shell (A4 requirement 7, A7 decision 8): tool:assistant/#run/<id> is /assistant?to=run/<id>.
export function resolveLink(href, host = globalThis.location?.hostname || "") {
  const m = /^tool:([a-z]+)\/?(.*)$/.exec(href || "");
  if (!m) return href;
  if (m[1] === "assistant") { const to = m[2].replace(/^#\/?/, ""); return to ? `/assistant?to=${encodeURIComponent(to)}` : "/assistant"; }
  const base = toolUrl(m[1], host);
  return base ? base + m[2] : "";
}

// The Assistant button hands Local AI the page and its key facts (one home, step 4): Local AI shows them over its
// composer and sends them with the next question. At most 300 characters, as the design says. It opens /assistant in
// the shell (A4), which puts them in the frame's #ask?context=. `host` stays for the callers.
const CONTEXT_MAX = 300;
export function assistantHref(host, title, facts) {  // eslint-disable-line no-unused-vars
  let text = `Pi Hub › ${title}${facts ? `: ${facts}` : ""}`.replace(/\s+/g, " ").trim();
  if (text.length > CONTEXT_MAX) {
    let cut = CONTEXT_MAX - 1;
    if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut -= 1;  // never half an emoji: encodeURIComponent throws on one
    text = text.slice(0, cut) + "…";
  }
  return `/assistant?context=${encodeURIComponent(text)}`;
}

// The phrase table's two unavailable states (section 9): `pc_off` when the `pc` record is off, `assistant_down` when
// Local AI is down but the PC isn't known to be off. Either disables the button. "Unknown" isn't "off": it stays enabled.
export const PHRASES = { pc_off: "The PC is off or asleep", assistant_down: "The Assistant isn't answering",
  source_down: "{name} isn't answering" };
// The kit's `source_down` phrase (appliance-ui needs.js), for a source a page reads from that didn't answer.
export const sourceDown = (name) => PHRASES.source_down.replace("{name}", name);
export function assistantButton(state, pc) {
  // A live answer from Local AI wins over a stale "off" from the network monitor.
  if (pc === "off" && state !== "Ready" && state !== "Busy") return { label: PHRASES.pc_off, phrase: "pc_off", disabled: true };
  if (state === "Down") return { label: PHRASES.assistant_down, phrase: "assistant_down", disabled: true };
  return { label: "Assistant", phrase: "", disabled: false };
}
