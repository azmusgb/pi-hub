import test from "node:test";
import assert from "node:assert/strict";
import { splitNowRecords, calmSummaryText, mergeProblems } from "../hub/static/js/control-room.js";
import { buildCommandItems } from "../hub/static/js/command-palette.js";

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

test("buildCommandItems surfaces printer actions, Print Lab needs, pages, live records, and query hand-offs", () => {
  const recs = [
    { id: "printer", state: "finished", severity: "attention", headline: "Finished E-022", actions: ["clear"] },
  ];
  const needs = {
    items: [
      { id: "pi:lab:hex-tile:E-022", title: "E-022: Judge the print", detail: "Look at seam face", act: { label: "Judge", href: "/lab?p=hex-tile&e=E-022&do=judge" } },
    ],
  };
  const top = buildCommandItems("", { records: recs, needs, host: "10.0.0.30" });
  assert.ok(top.some((i) => i.id === "act:printer:clear"), "includes Clear the X2D plate action");
  assert.ok(top.some((i) => i.id === "act:pi:lab:hex-tile:E-022"), "includes Print Lab judge action");

  const searched = buildCommandItems("tax 2025", { records: recs, needs, host: "10.0.0.30" });
  assert.ok(searched.some((i) => i.id === "query:docs" && i.href === "/documents?q=tax%202025"));
  assert.ok(searched.some((i) => i.id === "query:assistant" && i.href.includes("context=")));
});
