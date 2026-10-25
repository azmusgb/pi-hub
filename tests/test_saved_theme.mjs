// Pages outside the hub's shell (the signed-out Scan page) follow the theme saved in the hub.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../hub/static/js/saved-theme.js", import.meta.url), "utf8");
function run(getItem) {
  const root = { dataset: {}, style: {} };
  vm.runInNewContext(src, { localStorage: { getItem }, document: { documentElement: root } });
  return root;
}

test("Light and Dark from the hub are applied", () => {
  assert.equal(run(() => "light").dataset.theme, "light");
  assert.equal(run(() => "dark").dataset.theme, "dark");
  assert.equal(run(() => "dark").style.colorScheme, "dark");
});

test("Auto, nothing saved or junk leave the device to decide", () => {
  for (const v of ["auto", null, "purple"]) assert.equal(run(() => v).dataset.theme, undefined);
});

test("blocked storage is harmless", () => {
  assert.doesNotThrow(() => run(() => { throw new Error("blocked"); }));
});
