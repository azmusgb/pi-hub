// /assistant: the Assistant inside Pi Hub's shell (amendment A4, step 7a's Pi Hub half; A7 plan, PR H6). Local AI stays
// on its own origin behind its own gate: this page frames it and nothing more (requirement 1; never a proxy under the
// hub's origin, AGENTS.md). Local AI's half is its framed.js (LocalAI #493).
//  - The frame is made when the page opens and removed when it closes (6). Its src carries the hand-off (?context=, as
//    #ask?context=…, at most 300 characters) or the Assistant page to open (?to=<Local AI hash route>) (4, 7).
//  - Down is Pi Hub's to say (5): `pc_off` or `assistant_down` from /api/assistant, and no frame. "Unknown" isn't off:
//    the frame opens. If Local AI hasn't said where it is within 10 s, the page says `assistant_down` with Try again.
//  - Local AI posts its route on every move ({type: "assistant-route", route}). Only a post from this frame at the
//    Assistant's origin counts; the address follows with replaceState, so a reload or a shared link reopens that page
//    and Back leaves in one step (7).
//  - A hand-off while the frame is open goes by postMessage to the Assistant's origin, never "*" (4).
//  - The frame takes focus once Local AI answers, and is the page's one scroller (8; app.css, [data-assistant]).
import { api, h } from "./core.js";
import { ASSISTANT_URL, assistantButton, phrase as words } from "./sections.js";

export const every = 30;
export const ORIGIN = new URL(ASSISTANT_URL).origin;
export const LOAD_MS = 10_000;
const CONTEXT_MAX = 300;
const ROUTE_MAX = 600;
const CONTROL = /[\u0000-\u001f\u007f]/;

// The Assistant's five areas as Local AI names them (its view-registry.js DOMAINS: label and default page), for the
// Site map: each is a page in the shell (A7 P9). "" is its Home.
export const ASSISTANT_PAGES = [["", "Home"], ["work", "Work"], ["projects", "Projects"], ["backlog", "Improve"], ["status", "System"]];

// A Local AI hash route, from ?to= or a route post: no leading #, no control characters, at most 600 characters.
// Anything else is no route (null); "" is Local AI's Home.
export function cleanRoute(v) {
  if (typeof v !== "string") return null;
  const r = v.trim().replace(/^#\/?/, "");
  return r.length <= ROUTE_MAX && !CONTROL.test(r) ? r : null;
}

// The hand-off text as Local AI takes it: plain text, whitespace folded, at most 300 characters (never half an emoji).
export function cleanContext(v) {
  if (typeof v !== "string") return "";
  const t = v.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > CONTEXT_MAX ? chars.slice(0, CONTEXT_MAX - 1).join("") + "…" : t;
}

// A route as Local AI posts it is its location.hash, already percent-encoded: keep each %XX and encode only what can't
// stand in a fragment (a space, "#", a non-ASCII letter), so a route survives the round trip through ?to= unchanged.
const fragment = (r) => r.replace(/[^\w\-.~!$&'()*+,;=:@/?%]/g, (c) => encodeURIComponent(c));

// The frame's address for this page's query: the hand-off first, else the page asked for, else the Assistant's Home.
export function frameSrc(query) {
  const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || "");
  const ctx = cleanContext(q.get("context"));
  if (ctx) return `${ASSISTANT_URL}#ask?context=${encodeURIComponent(ctx)}`;
  const to = cleanRoute(q.get("to"));
  return to ? `${ASSISTANT_URL}#${fragment(to)}` : ASSISTANT_URL;
}

// Pi Hub's address for an Assistant route: the one the page replaces its own with.
export const addressFor = (route) => (route ? `/assistant?to=${encodeURIComponent(route)}` : "/assistant");

// The route in a message, or null when the message isn't Local AI's route post from this very frame.
export function routeFrom(e, frameWindow) {
  if (!e || !frameWindow || e.source !== frameWindow || e.origin !== ORIGIN) return null;
  const m = e.data;
  if (!m || typeof m !== "object" || m.type !== "assistant-route") return null;
  return cleanRoute(m.route);
}

const WHY = {
  pc_off: "The Assistant runs on the PC. Wake it, then try again.",
  assistant_down: "The Assistant on the PC didn't answer. Check the PC, then try again.",
};

function down(state, phrase, timedOut) {
  clearTimeout(state.timer);
  state.frame?.remove();
  state.frame = null;
  state.answered = false;
  state.timedOut = timedOut;
  state.phrase = phrase;
  const retry = h("button", { class: "ui-btn ui-btn--primary", type: "button", onclick: () => tryAgain(state, retry) }, "Try again");
  state.box.replaceChildren(h("section", { class: "ui-notice ui-notice--warn assistant-down", role: "status" },
    h("h2", {}, words(phrase)), h("p", {}, WHY[phrase]), h("p", {}, retry)));
}

async function tryAgain(state, button) {
  button.disabled = true;
  button.textContent = "Checking…";
  state.timedOut = false;
  await check(state, { force: true });
}

function open(state) {
  clearTimeout(state.timer);
  const frame = h("iframe", {
    class: "assistant-frame", title: "Assistant", src: frameSrc(state.context),
    allow: "clipboard-write", referrerpolicy: "origin",
  });
  state.frame = frame;
  state.answered = false;
  state.phrase = "";
  state.box.replaceChildren(frame);
  state.timer = setTimeout(() => { if (state.frame === frame && !state.answered) down(state, "assistant_down", true); }, LOAD_MS);
}

// Down from the status service shows the phrase and no frame; anything else opens the frame. A frame that timed out stays
// on Try again: the next try is the owner's. While the frame is open Local AI answers for itself, so nothing is checked.
async function check(state, { force = false } = {}) {
  if (state.left || state.frame) return;
  const r = await api("/api/assistant").catch(() => null);
  if (state.left || state.frame) return;
  const { disabled, phrase } = assistantButton(r?.state, r?.pc);
  if (disabled) down(state, phrase, false);
  else if (force || !state.timedOut) open(state);
}

export function mount(state) {
  document.documentElement.dataset.assistant = "1";
  state.box = h("div", { class: "assistant-box" });
  state.root.append(state.box);
  state.onMessage = (e) => {
    const route = routeFrom(e, state.frame?.contentWindow);
    if (route === null) return;
    if (!state.answered) {
      state.answered = true;
      clearTimeout(state.timer);
      // Focus goes into the frame unless the owner has already moved it out of the page (to the rail, say).
      const at = document.activeElement;
      if (!at || at === document.body || document.getElementById("view")?.contains(at)) state.frame.focus();
    }
    const to = addressFor(route);
    if (location.pathname === "/assistant" && location.pathname + location.search !== to) history.replaceState(history.state, "", to);
  };
  window.addEventListener("message", state.onMessage);
}

export async function load(state) {
  await check(state);
}

export function leave(state) {
  state.left = true;
  clearTimeout(state.timer);
  window.removeEventListener("message", state.onMessage);
  state.frame?.remove();
  state.frame = null;
  delete document.documentElement.dataset.assistant;
}

// A link to /assistant while this page is open (the Assistant button, ⌘K's "Ask the Assistant", a Needs-you link). A
// hand-off goes to the open frame by message; the button on its own page just returns focus to the frame. Anything
// else (another Assistant page) returns false and the shell opens it afresh in place.
export function retarget(state, url) {
  const q = new URLSearchParams(url.search);
  const ctx = cleanContext(q.get("context"));
  if (ctx) {
    if (!state.frame || !state.answered) return false;
    state.frame.contentWindow.postMessage({ type: "assistant-context", context: ctx }, ORIGIN);
    state.frame.focus();
    return true;
  }
  if (q.has("to")) return false;
  state.frame?.focus();
  return true;
}
