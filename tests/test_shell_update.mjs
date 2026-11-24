// A deploy must reach a page that is already open (23 Nov: after SHELL v227 -> v230 the iPhone home-screen app kept the
// old modules until it was fully closed). The page checks for a new worker when it comes back, and once a new worker has
// taken over it loads the new version at the next safe moment: the next in-app navigation, or the next return to the page
// while no field holds typed text. Driven with the fake DOM; main.js's wiring is read from its source (importing it
// would start the app).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { install } from "./helpers/fake_dom.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const load = () => import("../hub/static/js/shell-update.js");

// A service worker container: the controller at load, and controllerchange fired by hand.
function fakeContainer({ controller = null } = {}) {
  const listeners = {};
  return {
    controller,
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    takeOver() { this.controller = {}; for (const fn of listeners.controllerchange || []) fn({ type: "controllerchange" }); },
  };
}

// The fake DOM's document ignores listeners; give it real ones and a way to hide and show the page.
function page() {
  const dom = install();
  const doc = dom.document;
  const listeners = {};
  doc.addEventListener = (t, fn) => { (listeners[t] ||= []).push(fn); };
  const set = (hidden) => { doc.hidden = hidden; for (const fn of listeners.visibilitychange || []) fn({ type: "visibilitychange" }); };
  return { dom, doc, hide: () => set(true), show: () => set(false) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("coming back to the page asks the registration for an update; a failed check does nothing", async () => {
  const { watchShell } = await load();
  const p = page();
  try {
    let updates = 0, reloads = 0;
    const registering = Promise.resolve({ update: async () => { updates++; throw new Error("offline"); } });
    const shell = watchShell(fakeContainer({ controller: {} }), registering, { doc: p.doc, reload: () => reloads++ });
    p.hide(); p.show();
    await settle();
    assert.equal(updates, 1, "visible again -> registration.update()");
    assert.equal(reloads, 0, "a failed check doesn't reload");
    assert.equal(shell.stale(), false, "a failed check doesn't mark the page out of date");
    // Registration itself failed (main.js passes null): still no throw, no reload.
    const none = watchShell(fakeContainer({ controller: {} }), Promise.resolve(null), { doc: p.doc, reload: () => reloads++ });
    p.hide(); p.show();
    await settle();
    assert.equal(reloads, 0);
    assert.equal(none.stale(), false);
  } finally { p.dom.uninstall(); }
});

test("a new worker taking over a page that had one marks it out of date; the next return reloads it", async () => {
  const { watchShell } = await load();
  const p = page();
  try {
    let reloads = 0;
    const sw = fakeContainer({ controller: {} });
    const shell = watchShell(sw, Promise.resolve({ update: async () => {} }), { doc: p.doc, reload: () => reloads++ });
    assert.equal(shell.stale(), false);
    sw.takeOver();
    assert.equal(shell.stale(), true, "controllerchange after an existing controller -> out of date");
    assert.equal(reloads, 0, "never reloads while the person is on the page");
    p.hide(); p.show();
    assert.equal(reloads, 1, "the next return loads the new version");
  } finally { p.dom.uninstall(); }
});

test("the first install (no controller at load) is not an update", async () => {
  const { watchShell } = await load();
  const p = page();
  try {
    let reloads = 0;
    const sw = fakeContainer({ controller: null });
    const shell = watchShell(sw, Promise.resolve({ update: async () => {} }), { doc: p.doc, reload: () => reloads++ });
    sw.takeOver();
    assert.equal(shell.stale(), false, "null -> controller is the first install");
    p.hide(); p.show();
    assert.equal(reloads, 0);
    // A later deploy while the same page stays open is an update.
    sw.takeOver();
    assert.equal(shell.stale(), true, "a second takeover is a new version");
  } finally { p.dom.uninstall(); }
});

test("an out-of-date page doesn't reload on return while a field holds typed text", async () => {
  const { watchShell } = await load();
  const p = page();
  try {
    let reloads = 0;
    const root = p.dom.root();
    const draft = p.doc.createElement("textarea");
    draft.defaultValue = "";
    draft.value = "Keep the old filament";
    const box = p.doc.createElement("input");
    box.type = "checkbox";
    box.defaultValue = "on"; box.value = "off";  // not text: never counts as typing
    root.append(draft, box);
    const sw = fakeContainer({ controller: {} });
    watchShell(sw, Promise.resolve({ update: async () => {} }), { doc: p.doc, reload: () => reloads++ });
    sw.takeOver();
    p.hide(); p.show();
    assert.equal(reloads, 0, "a typed answer is never wiped by an update");
    draft.value = draft.defaultValue;  // sent or cleared
    p.hide(); p.show();
    assert.equal(reloads, 1, "once nothing is typed, the next return reloads");
  } finally { p.dom.uninstall(); }
});

// /assistant draws Local AI's composer in a frame on its own origin: its fields can't be read, so an open frame counts
// as typing (review of this fix: a return to the app would otherwise wipe a half-written message).
test("an out-of-date page doesn't reload on return while it holds a frame whose fields can't be read", async () => {
  const { watchShell } = await load();
  const p = page();
  try {
    let reloads = 0;
    const frame = p.doc.createElement("iframe");
    p.dom.root().append(frame);
    const sw = fakeContainer({ controller: {} });
    watchShell(sw, Promise.resolve({ update: async () => {} }), { doc: p.doc, reload: () => reloads++ });
    sw.takeOver();
    p.hide(); p.show();
    assert.equal(reloads, 0, "a message being written in the Assistant frame is never wiped by an update");
    frame.remove();
    p.hide(); p.show();
    assert.equal(reloads, 1, "once the frame is gone, the next return reloads");
  } finally { p.dom.uninstall(); }
});

test("main.js wires it: registers through watchShell, and an out-of-date page's next navigation is a full load", () => {
  const main = read("hub/static/js/main.js");
  assert.match(main, /import \{ watchShell \} from "\.\/shell-update\.js";/, "main.js imports watchShell");
  assert.match(main, /watchShell\(navigator\.serviceWorker, navigator\.serviceWorker\.register\("\/sw\.js"\)/, "registration goes through watchShell");
  const click = main.slice(main.indexOf('document.addEventListener("click"'), main.indexOf("window.scrollTo({ top: 0 });"));
  const full = click.indexOf("if (shell.stale()) { location.assign(destination); return; }");
  assert.ok(full > 0, "an in-app link on an out-of-date page loads the destination in full");
  assert.ok(full < click.indexOf("history.replaceState({}, \"\", destination)") && full < click.indexOf("history.pushState({}, \"\", destination)"),
    "the full load comes before any pushState or replaceState of the destination");
  const handOff = click.indexOf("current?.mod.retarget?.(current.state, url)");
  assert.ok(handOff > 0 && handOff < full,
    "a link to /assistant on /assistant goes to the open frame by message first, keeping what is typed in it");
  assert.match(main, /addEventListener\("popstate", \(\) => \{\n[^\n]*\n  if \(shell\.stale\(\)\) location\.reload\(\); else show\(location\.pathname\);/, "Back on an out-of-date page reloads too");
  assert.ok(read("hub/static/sw.js").includes('"/static/js/shell-update.js"'), "the shell caches the module");
});
