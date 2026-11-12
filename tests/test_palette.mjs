// Platform step 7, PR 7.6: Pi Hub runs the kit's one palette with its own providers, and every tool link comes from the
// kit's registry (appliance-ui tools.json).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { TOOLS, toolsFor } from "../hub/static/ui/tools.js";
import { PHRASES } from "./helpers/kit.mjs";
import { resolveLink, toolUrl } from "../hub/static/js/sections.js";
import { askResult, doResults, findResults, goResults, hubProviders, searchResults } from "../hub/static/js/command-palette.js";

const JS = new URL("../hub/static/js/", import.meta.url);
const read = (f) => readFileSync(new URL(f, JS), "utf8");
const jsFiles = readdirSync(JS).filter((f) => f.endsWith(".js"));
const KINDS = new Set(["go", "do", "find", "ask", "search"]);

function assertShape(r) {
  assert.ok(KINDS.has(r.kind), `kind ${r.kind}`);
  assert.equal(typeof r.label, "string");
  assert.ok(r.label.length > 0);
  assert.ok((typeof r.href === "string" && r.href.length > 0) !== (typeof r.run === "function"), `href xor run: ${r.label}`);
  if (r.href) assert.ok(r.href.startsWith("/") || /^https:\/\//.test(r.href), r.href);
}

test("every toolUrl in the hub's pages names a tool in the registry", () => {
  const ids = new Set(TOOLS.map((t) => t.id));
  for (const f of jsFiles) {
    for (const [, id] of read(f).matchAll(/toolUrl\("([a-z]+)"/g)) assert.ok(ids.has(id), `${f}: toolUrl("${id}")`);
  }
});

test("a tool link is the registry's host, and an unknown tool gives no link", () => {
  // A tool with `via` (n8n, ComfyUI: kit 2.17) has no host of its own; it opens at an address on the Assistant's origin.
  for (const t of TOOLS.filter((x) => !x.via)) assert.equal(toolUrl(t.id), t.external ? `https://${t.host}${t.base || "/"}` : `https://${t.host}/`);
  for (const t of TOOLS.filter((x) => x.via)) assert.equal(toolUrl(t.id), `https://assistant.rahe-home.duckdns.org${t.via}`);
  assert.deepEqual(TOOLS.filter((x) => x.via).map((x) => x.id), ["n8n", "comfy"]);
  assert.equal(toolUrl("nope"), null);  // an id that is not in the registry (Plex was the example until A6 N4 added it)
  assert.equal(resolveLink("tool:bambuddy/archive"), "https://bambuddy.rahe-home.duckdns.org/archive");
  assert.equal(resolveLink("tool:nope/x"), "");
  assert.equal(resolveLink("/lab?p=hex-tile"), "/lab?p=hex-tile");
});

// Step 12: a page's row is its `tools` in the page list, named by the page's id (test_pages_tools checks every page).
test("each page ends with its tools in the page list (§5.3)", () => {
  for (const area of ["workshop", "household", "network", "system"]) assert.ok(toolsFor(area).length, area);
  for (const [file, id] of [["workshop.js", "printer"], ["documents.js", "papers"], ["network.js", "internet"],
    ["devices.js", "lights"], ["health.js", "health"]]) assert.ok(read(file).includes(`openInRow("${id}")`), file);
  assert.ok(!toolsFor("workshop").some((t) => t.boundary), "the display's D4 hosts are not for people");
});

test("one palette: the kit's, opened only through command-palette.js", () => {
  const html = readFileSync(new URL("../hub/static/index.html", import.meta.url), "utf8");
  assert.ok(!/id="palette"/.test(html) && !/palette-input/.test(html), "the old #palette markup is gone");
  assert.ok(html.indexOf('src="/static/ui/palette.js"') > 0 && html.indexOf('src="/static/ui/palette.js"') < html.indexOf('src="/static/js/main.js"'));
  assert.ok(html.includes('href="/static/ui/palette.css"'));
  for (const f of jsFiles) {
    const src = read(f);
    assert.ok(!/getElementById\("palette|#palette/.test(src), `${f} still reaches for the old #palette`);
    if (f !== "command-palette.js") assert.ok(!/AppliancePalette\.create/.test(src), `${f} makes a second palette`);
  }
});

test("providers return the kit's result shape", () => {
  const records = [{ id: "printer", state: "finished", severity: "attention", headline: "Finished E-022", actions: ["clear", "pause"] },
    { id: "movies_drive", state: "missing", headline: "The movies drive isn't mounted" }];
  const needs = { items: [{ id: "pi:lab:hex-tile:E-022", title: "E-022: Judge the print", detail: "Look at seam face",
    act: { href: "/lab?p=hex-tile&e=E-022&do=judge" } }, { id: "x", title: "AdGuard paused", link: "tool:adguard" }] };
  const all = [...goResults(""), ...goResults("bambu"), ...doResults("", records), ...findResults("judge", records, needs),
    ...findResults("adguard", records, needs), ...searchResults("tax 2025"),
    ...askResult("why is it slow", { state: "Ready", pc: "on" }, "hub.rahe-home.duckdns.org")];
  assert.ok(all.length > 10);
  all.forEach(assertShape);
  assert.ok(doResults("clear", records).some((r) => r.label === "Clear the plate on the X2D"));
  assert.ok(findResults("judge", records, needs).some((r) => r.href === "/lab?p=hex-tile&e=E-022&do=judge"));
  assert.ok(findResults("adguard", records, needs).some((r) => r.href === "https://adguard.rahe-home.duckdns.org/"));
  assert.deepEqual(findResults("", records, needs), [], "an empty palette shows pages and recents, not every record");
  assert.ok(goResults("bambuddy").some((r) => r.href === "https://bambuddy.rahe-home.duckdns.org/"));
  assert.ok(!goResults("").some((r) => /home\.arpa/.test(r.href)), "no D4 host in Go");
  assert.ok(searchResults("tax 2025").some((r) => r.href === "/documents?q=tax%202025"));
});

test("with the pc record off, Ask reads pc_off; Local AI down reads assistant_down; unknown stays enabled", () => {
  assert.throws(() => askResult("hello", { state: "Down", pc: "off" }), (e) => e.phrase === PHRASES.pc_off);
  assert.throws(() => askResult("hello", { state: "Down", pc: "on" }), (e) => e.phrase === PHRASES.assistant_down);
  assert.equal(askResult("hello", { state: "Unknown", pc: "unknown" })[0].kind, "ask");
  assert.equal(askResult("hello", { state: "Ready", pc: "off" })[0].kind, "ask", "a live answer wins over a stale off");
});

test("the Ask provider's one line is the phrase, so the palette shows it", async () => {
  const get = async (path) => (path === "/api/assistant" ? { state: "Unknown", pc: "off" }
    : path === "/api/records" ? { records: [] } : path === "/api/needs" ? { items: [] } : null);
  const ask = hubProviders({ get }).find((p) => p.name === "Assistant");
  await assert.rejects(() => ask.find("hello"));
  assert.equal(ask.down, PHRASES.pc_off);
});

test("Papers is down, not empty, when Paperless doesn't answer", async () => {
  const get = async () => ({ available: false, results: [] });
  const docs = hubProviders({ get }).find((p) => p.name === "Papers");  // the page is Papers (A22 3.3)
  await assert.rejects(() => docs.find("tax"));
  assert.deepEqual(await docs.find("t"), []);
  const ok = hubProviders({ get: async () => ({ available: true, results: [{ title: "2025 tax return", created: "Mar 2026" }] }) });
  const found = await ok.find((p) => p.name === "Papers").find("tax");
  found.forEach(assertShape);
  assert.equal(found[0].label, "2025 tax return");
  const signedOut = hubProviders({ get: async () => { throw Object.assign(new Error("Sign in"), { status: 401 }); } });
  assert.deepEqual(await signedOut.find((p) => p.name === "Papers").find("tax"), [], "signed out isn't Paperless down");
});

// A22 step 11, H3: no page is reachable only by knowing its address, and the Assistant is in ⌘K.
test("Privacy, a page the server writes, is in ⌘K and the Site map, as a full page load", async () => {
  // Step 12: it is a row of the page list (role standalone, in no area), named Privacy note.
  const { SITE } = await import("../hub/static/js/site.js");
  assert.deepEqual(SITE.rows.filter((p) => SITE.served(p)).map((p) => [p.path, p.label, p.area ?? null]), [["/privacy", "Privacy note", null]]);
  const hit = goResults("privacy").filter((r) => r.href === "/privacy");
  assert.equal(hit.length, 1);
  assert.deepEqual([hit[0].label, hit[0].area], ["Privacy note", "Other"]);
  const { paletteNavigate } = await import("../hub/static/js/command-palette.js");
  const went = [];
  paletteNavigate("/privacy", { spa: (h) => went.push(["spa", h]), load: (h) => went.push(["load", h]) });
  paletteNavigate("/backups", { spa: (h) => went.push(["spa", h]), load: (h) => went.push(["load", h]) });
  assert.deepEqual(went, [["load", "/privacy"], ["spa", "/backups"]], "the shell has no /privacy page to draw");
  // The kit's palette hands navigate the absolute address, not the one the result was given.
  went.length = 0;
  paletteNavigate("https://hub.rahe-home.duckdns.org/privacy", { spa: (h) => went.push(["spa", h]), load: (h) => went.push(["load", h]) });
  paletteNavigate("https://hub.rahe-home.duckdns.org/backups?from=home", { spa: (h) => went.push(["spa", h]), load: (h) => went.push(["load", h]) });
  assert.deepEqual(went.map(([how]) => how), ["load", "spa"]);
  const { siteMap } = await import("../hub/static/js/map.js");
  const other = siteMap().find((g) => g.key === "other");
  assert.deepEqual(other.pages, [{ href: "/privacy", label: "Privacy note", plain: true }]);
  assert.equal(siteMap().flatMap((g) => g.pages).filter((p) => p.href === "/privacy").length, 1, "listed once");
});

test("⌘K has one Assistant row that opens /assistant and says what the rail's button says", () => {
  const row = (a) => goResults("assistant", a).filter((r) => r.href === "/assistant");
  assert.deepEqual(row(null), [{ kind: "go", label: "Assistant", href: "/assistant", area: "Assistant" }]);
  assert.deepEqual(row({ state: "Ready", pc: "on" }), [{ kind: "go", label: "Assistant", href: "/assistant", area: "Assistant" }]);
  assert.equal(row({ state: "Down", pc: "on" })[0].hint, "The Assistant isn't answering");
  assert.equal(row({ state: "Down", pc: "off" })[0].hint, "The PC is asleep");
  assert.equal(goResults("").filter((r) => r.href === "/assistant").length, 1);
});

test("the Pages provider knows the Assistant's state on the first search, without waiting on the PC", async () => {
  const calls = [];
  const get = async (path) => { calls.push(path); return path === "/api/assistant" ? { state: "Down", pc: "on" } : null; };
  const pages = hubProviders({ get }).find((p) => p.name === "Pages");
  assert.deepEqual(calls, ["/api/assistant"], "asked once, when the providers are made");
  await new Promise((r) => setTimeout(r, 0));
  const row = (await pages.find("assistant")).find((r) => r.href === "/assistant");
  assert.equal(row.hint, "The Assistant isn't answering");
  assert.equal(calls.filter((c) => c === "/api/assistant").length, 1, "the answer is reused for 30 s");
});
