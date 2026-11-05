// A7 one page, Pi Hub H1: the kit's underlined strip on every area, Settings' groups as chips, the sources line, and
// kit 2.6.0's confirm.js in the shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pageStrip, STRIPS } from "../hub/static/js/system-strip.js";
import { sourceEntries } from "../hub/static/js/sources.js";
import { install } from "./helpers/fake_dom.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("every area strip is the kit's underlined ui-strip, not the old segmented pill", () => {
  const dom = install();
  try {
    for (const { entries } of Object.values(STRIPS)) {
      const nav = pageStrip(entries[0][0]);
      assert.match(nav.className, /\bui-strip\b/);
      assert.doesNotMatch(nav.className, /\btabs\b/);
    }
  } finally { dom.uninstall(); }
  const css = read("hub/static/app.css");
  assert.doesNotMatch(css, /\.tabs\.page-strip/, "the pill's phone grid is gone");
});

test("Settings' six groups are chips", () => {
  const js = read("hub/static/js/settings.js");
  assert.match(js, /h\("nav", \{ class: "ui-chips settings-tabs"/);
});

test("the sources line keeps only named sources, and an unknown tone is unknown, never ok", () => {
  assert.deepEqual(sourceEntries(null), []);
  assert.deepEqual(sourceEntries([{ name: " Printer ", tone: "ok" }, { name: "", tone: "ok" }, { tone: "bad" }, null,
    { name: "Bambuddy", tone: "great", word: " 12 h old " }, { name: "Mac", tone: "warn", word: 3 }]), [
    { name: "Printer", tone: "ok", word: "" },
    { name: "Bambuddy", tone: "unknown", word: "12 h old" },
    { name: "Mac", tone: "warn", word: "" },
  ]);
});

test("kit 2.6.0 is in the shell: confirm.js is loaded and cached, the footer has the sources line", () => {
  assert.equal(JSON.parse(read("hub/static/ui/VERSION")).version, "2.6.0");
  const html = read("hub/static/index.html"), sw = read("hub/static/sw.js");
  assert.match(html, /<script src="\/static\/ui\/confirm\.js"><\/script>/);
  assert.ok(sw.includes('"/static/ui/confirm.js"'));
  assert.match(html, /<p id="page-sources" class="ui-sources" hidden><\/p>/);
});
