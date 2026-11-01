// Home merged with the Control room (31 Oct 2026): Problems / Now / Since on `/`, `/next` redirects to `/`.
import test from "node:test";
import assert from "node:assert/strict";
import { splitNowRecords, mergeProblems, problemsBadge } from "../hub/static/js/next.js";
import { homeCards } from "../hub/static/js/home-cards.js";
import { redirectFor } from "../hub/static/js/sections.js";

const printing = { id: "printer", state: "printing", severity: "ok", headline: "Printing, 40%" };
const playing = { id: "plex", state: "playing", severity: "ok", headline: "Playing a movie" };

test("on Home, Now leaves the printer to the band above it", () => {
  const { active } = splitNowRecords([printing, playing], { skipPrinter: true });
  assert.deepEqual(active.map((r) => r.id), ["plex"]);
  assert.deepEqual(splitNowRecords([printing, playing]).active.map((r) => r.id), ["printer", "plex"]);  // /next unchanged
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

test("System lists each service with its record's health, and no health where no record speaks for it", async () => {
  const { serviceRows } = await import("../hub/static/js/system.js");
  const rows = serviceRows(
    [{ name: "restart:plex", label: "Restart Plex" }, { name: "restart:ntfy", label: "Restart ntfy" }, { name: "restart:pi", label: "Restart the Pi" }],
    [{ id: "plex", severity: "ok", state: "idle", headline: "Nothing playing" }]);
  assert.deepEqual(rows.map((r) => [r.name, r.tone, r.status]), [["Plex", "ok", "Nothing playing"], ["ntfy", "", ""]]);
});

test("records answering after Home's Needs you hand-over don't wipe it", async () => {
  const { keepNeeds } = await import("../hub/static/js/next.js");
  const handed = { count: 1, items: [{ id: "pi:lab:x:E-025" }] };
  assert.equal(keepNeeds(null, null, handed), handed);      // Home passed "not yet"; its hand-over stands
  assert.equal(keepNeeds(null, null, null), null);          // nothing handed over yet
  const fetched = { count: 0, items: [] };
  assert.equal(keepNeeds(undefined, fetched, handed), fetched);  // the page fetched its own: the fresh answer wins
});

test("a record whose headline already names it isn't titled twice", async () => {
  const { recordTitle } = await import("../hub/static/js/next.js");
  assert.equal(recordTitle({ id: "adguard", headline: "Ad blocking is off" }), "Ad blocking is off");
  assert.equal(recordTitle({ id: "pi", headline: "Pi 66 °C" }), "Raspberry Pi: Pi 66 °C");
});

test("a need keeps its link and takes since from the record it stands for", () => {
  const needs = { count: 1, items: [{ id: "pi:Raspberry Pi", title: "Raspberry Pi", tone: "warn", record: "pi", link: "/pi" }] };
  const [p] = mergeProblems([{ id: "pi", severity: "attention", headline: "Pi 66 °C", since: 1_800_000_000 }], needs);
  assert.equal(p.link, "/pi");
  assert.equal(p.since, 1_800_000_000);
});
