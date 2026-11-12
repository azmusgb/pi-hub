// A7 one page, Pi Hub H1: the kit's underlined strip on every area, Settings' groups as chips, the sources line, and
// kit 2.6.0's confirm.js in the shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pageStrip } from "../hub/static/js/system-strip.js";
import { SITE } from "../hub/static/js/site.js";
import { sourceEntries } from "../hub/static/js/sources.js";
import { install } from "./helpers/fake_dom.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("every area strip is the kit's underlined ui-strip, not the old segmented pill", () => {
  const dom = install();
  try {
    const landings = SITE.areas.filter((a) => a.id !== "home").map((a) => SITE.page(a.landing).path);
    assert.equal(landings.length, 4);
    for (const path of landings) {
      const nav = pageStrip(path);
      assert.match(nav.className, /\bui-strip\b/);
      assert.doesNotMatch(nav.className, /\btabs\b/);
    }
  } finally { dom.uninstall(); }
  const css = read("hub/static/app.css");
  assert.doesNotMatch(css, /\.tabs\.page-strip/, "the pill's phone grid is gone");
});

// A22 2.1 (step 12, H5): the six groups are the kit's six tabs, a tablist, not a nav of chips.
test("Settings' six groups are the kit's six tabs", () => {
  const js = read("hub/static/js/settings.js");
  assert.match(js, /h\("div", \{ class: "ui-tabs ui-tabs--rows settings-tabs", role: "tablist", "aria-label": "Settings"/);
  assert.doesNotMatch(js, /ui-chips/);
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

test("kit 2.9.0 (A10) is in the shell: confirm.js is loaded and cached, the footer has the sources line", () => {
  const [major, minor] = JSON.parse(read("hub/static/ui/VERSION")).version.split(".").map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 9), "the shell's kit copy is older than 2.9.0");
  const html = read("hub/static/index.html"), sw = read("hub/static/sw.js");
  assert.match(html, /<script src="\/static\/ui\/confirm\.js"><\/script>/);
  assert.ok(sw.includes('"/static/ui/confirm.js"'));
  assert.match(html, /<p id="page-sources" class="ui-sources" hidden><\/p>/);
});
