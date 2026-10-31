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
