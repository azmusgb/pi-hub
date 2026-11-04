import test from "node:test";
import assert from "node:assert/strict";
import { splitNowRecords, calmSummaryText, mergeProblems } from "../hub/static/js/control-room.js";

test("splitNowRecords separates active printing/playing items from calm OK items", () => {
  const recs = [
    { id: "printer", state: "printing", severity: "ok", headline: "Printing E-022, 42%" },
    { id: "plex", state: "idle", severity: "ok", headline: "Nothing playing" },
    { id: "internet", state: "ok", severity: "ok", headline: "Internet OK" },
    { id: "pc", state: "off", severity: "problem", headline: "The PC is off" },
  ];
  const { active, calm } = splitNowRecords(recs);
  assert.deepEqual(active.map((r) => r.id), ["printer"]);
  assert.deepEqual(calm.map((r) => r.id), ["plex", "internet"]);
  assert.equal(calmSummaryText(calm), "All else OK: Movies, Internet");
});

test("mergeProblems combines Needs you and uncovered record problems without duplicating about", () => {
  const recs = [
    { id: "printer", state: "finished", severity: "attention", headline: "Finished — plate not cleared", actions: ["clear"] },
    { id: "movies_drive", state: "not_mounted", severity: "attention", headline: "Movies drive not mounted", cause: "USB reset" },
  ];
  const needs = {
    count: 1,
    items: [
      { id: "record:printer", title: "Bambu X2D: Finished", detail: "Clear the plate", tone: "warn", about: "printer", act: { printer: "clear", label: "Clear the plate" } },
    ],
  };
  const merged = mergeProblems(recs, needs);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "record:printer");
  assert.equal(merged[1].recordId, "movies_drive");
  assert.equal(merged[1].fix.name, "remount:movies");
});

test("the printer's lab print links its experiment in its own project", async () => {
  const { printerNow } = await import("../hub/static/js/control-room.js");
  const { printLabUrl } = await import("../hub/static/js/sections.js");
  const r = { id: "printer", state: "printing", detail: { lab: { experiment: "E-30", project: "vase-mode" } } };
  const m = printerNow(r);
  assert.equal(m.lab, "E-30");
  assert.equal(printLabUrl(m.lab, m.labProject), "/lab?p=vase-mode&e=E-30");
  assert.equal(printLabUrl("E-30", 'x"><img'), "/lab?e=E-30");
  assert.equal(printLabUrl("E-30"), "/lab?e=E-30");
});
