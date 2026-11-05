import test from "node:test";
import assert from "node:assert/strict";
import { splitNowRecords, mergeProblems } from "../hub/static/js/control-room.js";

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

test("a record's page: its own, a release record's Versions, and System for one the browser doesn't know", async () => {
  const { recordPath } = await import("../hub/static/js/control-room.js");
  assert.equal(recordPath("backups"), "/backups");
  assert.equal(recordPath("mac_lab"), "/lab");
  assert.equal(recordPath("release:localai"), "/versions");
  assert.equal(recordPath("something_new"), "/system");
  assert.equal(recordPath(undefined), "/system");
});

// A7 P2: Home's Needs you is the kit's list, each action named by its verb.
test("Home's Needs you items carry the kit's verb keys, never a bare Open", async () => {
  const { problemItems } = await import("../hub/static/js/control-room.js");
  const recs = [
    { id: "printer", state: "finished", severity: "attention", headline: "Finished, plate not cleared", actions: ["clear"], since: 1_800_000_000 },
    { id: "internet", state: "down", severity: "problem", headline: "Internet is down", since: 1_800_000_100 },
    { id: "backups", state: "late", severity: "attention", headline: "Backups are late" },
  ];
  const needs = { items: [
    { id: "pi:lab:hex:E-025", title: "E-025: Judge the print", detail: "Look at the face.", tone: "attention", source: "Print lab",
      link: "/lab?p=hex&e=E-025&do=judge", action: { key: "judge_it", link: "/lab?p=hex&e=E-025&do=judge" }, as_of: "2026-11-04T10:00:00Z" },
  ] };
  const items = problemItems(mergeProblems(recs, needs));
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual(by["pi:lab:hex:E-025"].action, { key: "judge_it", link: "/lab?p=hex&e=E-025&do=judge" });
  assert.equal(by["pi:lab:hex:E-025"].tone, "attention");
  assert.equal(by["pi:lab:hex:E-025"].as_of, "2026-11-04T10:00:00Z");
  assert.equal(by["pi:lab:hex:E-025"].area, "Print lab");
  assert.deepEqual(by["rec:printer"].action, { key: "open_printer", link: "/workshop" });
  assert.equal(by["rec:printer"].as_of, new Date(1_800_000_000 * 1000).toISOString());
  assert.deepEqual(by["rec:internet"].action, { key: "open_network", link: "/network" });
  assert.equal(by["rec:backups"].action, undefined);  // no verb for it yet: the row is its link, with no words
  assert.equal(by["rec:backups"].link, "/backups");
  assert.equal(by["rec:backups"].as_of, undefined);
});
