// Platform step 7, PR 7.4: next.js is gone (split into control-room.js and command-palette.js), the retired paths are
// redirects only, and /drives sits under Media.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import ROUTES from "../hub/static/js/routes.js";
import { redirectFor, sectionFor } from "../hub/static/js/sections.js";

const JS = new URL("../hub/static/js/", import.meta.url);

test("next.js is deleted and no module or test imports it", () => {
  assert.equal(existsSync(new URL("next.js", JS)), false);
  const files = [
    ...readdirSync(JS).filter((f) => f.endsWith(".js")).map((f) => new URL(f, JS)),
    ...readdirSync(new URL("./", import.meta.url)).filter((f) => f.endsWith(".mjs")).map((f) => new URL(f, import.meta.url)),
    new URL("../hub/static/sw.js", import.meta.url),
  ];
  for (const f of files) {
    if (f.pathname.endsWith("test_retirements.mjs")) continue;
    assert.doesNotMatch(readFileSync(f, "utf8"), /["'/]next\.js["']/, f.pathname);
  }
});

test("every redirect resolves to a page the shell draws", () => {
  for (const [from, to] of Object.entries(ROUTES.redirects)) {
    assert.equal(redirectFor(from), to, from);
    assert.ok(ROUTES.pages.includes(to), `${from} → ${to}`);
  }
});

test("the retired paths are redirects, not pages", () => {
  for (const path of ["/control", "/movies", "/next"]) {
    assert.ok(path in ROUTES.redirects, path);
    assert.ok(!ROUTES.pages.includes(path), path);
  }
});

test("Storage (/drives) is under Media", () => {
  assert.equal(sectionFor("/drives"), "media");
});

test("one palette: only command-palette.js upgrades #palette's input", () => {
  const owners = readdirSync(JS).filter((f) => f.endsWith(".js"))
    .filter((f) => /openHubCommandPalette\s*=/.test(readFileSync(new URL(f, JS), "utf8")));
  assert.deepEqual(owners, ["command-palette.js"]);
});
