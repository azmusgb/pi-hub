// Home merged with the Control room (31 Oct 2026): Now / Needs you / Since on `/` (2 Nov), `/next` redirects to `/`.
import test from "node:test";
import assert from "node:assert/strict";
import { splitNowRecords, mergeProblems, problemsBadge, printerNow, actionNames } from "../hub/static/js/control-room.js";
import { homeCards } from "../hub/static/js/home-cards.js";
import { SITE } from "../hub/static/js/site.js";

const redirectFor = SITE.redirectFor;  // the old addresses are the page list's (A22 step 12)

const printing = { id: "printer", state: "printing", severity: "ok", headline: "Printing, 40%" };
const playing = { id: "plex", state: "playing", severity: "ok", headline: "Playing a movie" };

test("Now lists the printer first among active things", () => {
  assert.deepEqual(splitNowRecords([printing, playing]).active.map((r) => r.id), ["printer", "plex"]);
});

test("record actions are {name} objects; the printer buttons and Clear the plate get the names", () => {
  assert.deepEqual(actionNames([{ name: "pause" }, { name: "stop" }, "clear", null, {}]), ["pause", "stop", "clear"]);
  assert.deepEqual(actionNames(undefined), []);
  const [p] = mergeProblems([{ id: "printer", state: "finished", severity: "attention", headline: "Finished",
    actions: [{ name: "clear" }] }], null);
  assert.ok(p.actions.includes("clear"));
});

test("Now's printer reads the record's own keys: percent, time left, layer, lab", () => {
  const at = new Date(2026, 10, 2, 19, 0).getTime();
  const m = printerNow({ id: "printer", state: "printing", headline: "Printing, 47%",
    detail: { job: "v72 bracket", progress: 47.4, minutes_left: 100, layer: 88, total_layers: 210, lab: { experiment: "E-012" } },
    actions: [{ name: "pause" }, { name: "stop" }] }, at);
  assert.equal(m.readout, "47%");
  assert.equal(m.word, "Printing");
  assert.equal(m.facts[0], "v72 bracket");
  // The page says the time in the viewer's own clock style (20:40 on the Pi, 8:40 PM on the Mac).
  const done = new Date(at + 100 * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  assert.equal(m.facts[1], `1 h 40 min left, done ${done}`);
  assert.equal(m.facts[2], "Layer 88 of 210");
  assert.equal(m.lab, "E-012");
  assert.deepEqual(m.actions, ["pause", "stop"]);
});

test("a printer that isn't running shows its headline, not 0%", () => {
  const m = printerNow({ id: "printer", state: "finished", headline: "Finished", detail: { progress: 100 } });
  assert.equal(m.readout, "Finished");
  assert.equal(m.pct, null);
  assert.equal(m.word, "");
  assert.deepEqual(printerNow({ id: "printer", state: "paused", headline: "Paused", detail: { progress: 12 } }).word, "Paused");
  assert.equal(printerNow(null).readout, "");
});

test("a Needs you item and a problem record about the same thing are listed once", () => {
  const needs = { count: 1, items: [{ id: "pi:adguard", title: "Ad blocking is down", tone: "bad", about: "adguard" }] };
  const recs = [{ id: "adguard", severity: "problem", headline: "Not answering" }, { id: "pc", severity: "attention", headline: "Off" }];
  const probs = mergeProblems(recs, needs);
  assert.deepEqual(probs.map((p) => p.about), ["adguard", "pc"]);
});

test("the Home badge counts the Problems list, not only Needs you", () => {
  const needs = { count: 1, items: [{ id: "a", title: "A", about: "x" }], unread: [] };
  const probs = mergeProblems([{ id: "pc", severity: "problem", headline: "Off" }], needs);
  assert.equal(problemsBadge(needs, probs).count, 2);
  assert.equal(problemsBadge(null, []).count, 0);
  assert.equal(problemsBadge(undefined, []), undefined);  // Needs you not asked yet: the badge waits
});

test("Home's cards leave out the Needs you card when Problems is shown", () => {
  const needs = { count: 1, items: [{ id: "a", title: "A", tone: "warn" }], unread: [] };
  assert.ok(homeCards({ now: {}, needs }).some((c) => c.key === "needs"));
  assert.ok(!homeCards({ now: {}, needs, problems: true }).some((c) => c.key === "needs"));
});

test("/next redirects to Home", () => {
  assert.equal(redirectFor("/next"), "/");
});

test("a Needs you item that stands for a hub record is listed once, not again as the record", () => {
  const needs = { count: 1, items: [{ id: "pi:Raspberry Pi", title: "Raspberry Pi", tone: "warn", record: "pi" }], unread: [] };
  const recs = [{ id: "pi", severity: "attention", headline: "Pi 62 °C" }];
  const probs = mergeProblems(recs, needs);
  assert.equal(probs.length, 1);
  assert.equal(problemsBadge(needs, probs).count, needs.count);  // Home's badge matches every other page's
});

test("Health lists each service with its record's health, and no health where no record speaks for it", async () => {
  const { serviceRows } = await import("../hub/static/js/health.js");
  const rows = serviceRows(
    [{ name: "restart:plex", label: "Restart Plex" }, { name: "restart:ntfy", label: "Restart ntfy" }, { name: "restart:pi", label: "Restart the Pi" }],
    [{ id: "plex", severity: "ok", state: "idle", headline: "Nothing playing" }]);
  assert.deepEqual(rows.map((r) => [r.name, r.tone, r.status]), [["Plex", "ok", "Nothing playing"], ["ntfy", "", ""]]);
});

test("a record whose headline already names it isn't titled twice", async () => {
  const { recordTitle } = await import("../hub/static/js/control-room.js");
  assert.equal(recordTitle({ id: "adguard", headline: "Ad blocking is off" }), "Ad blocking is off");
  assert.equal(recordTitle({ id: "pi", headline: "Pi 66 °C" }), "Raspberry Pi: Pi 66 °C");
});

test("a need keeps its link and takes since from the record it stands for", () => {
  const needs = { count: 1, items: [{ id: "pi:Raspberry Pi", title: "Raspberry Pi", tone: "warn", record: "pi", link: "/pi" }] };
  const [p] = mergeProblems([{ id: "pi", severity: "attention", headline: "Pi 66 °C", since: 1_800_000_000 }], needs);
  assert.equal(p.link, "/pi");
  assert.equal(p.since, 1_800_000_000);
});
