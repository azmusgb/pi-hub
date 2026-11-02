import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { versionRows, historyRows } from "../hub/static/js/versions.js";

const A = "a".repeat(40), B = "b".repeat(40);
const rec = (target, state, detail = {}, extra = {}) => ({
  id: `release:${target}`, state, severity: "ok", headline: "", cause: "",
  detail: { target, label: target.toUpperCase(), ...detail }, ...extra,
});
const live = (target = "pi-hub") => rec(target, "live",
  { commit: A, deployed_at: 1000, mechanism: "pi-hub-release", last: { commit: A, result: "deployed", at: 1000 } },
  { headline: "aaaaaaa is live" });

test("rows follow the records' order, and only release records count", () => {
  const rows = versionRows([{ id: "printer", state: "idle" }, live("pi-hub"), rec("localai", "unknown"), rec("firmware", "unknown")]);
  assert.deepEqual(rows.map((r) => r.target), ["pi-hub", "localai", "firmware"]);
});

test("unknown reads Not publishing yet, with no commit", () => {
  const [r] = versionRows([rec("netmon", "unknown")]);
  assert.equal(r.unknown, true);
  assert.equal(r.line, "Not publishing yet");
  assert.equal(r.chip, "", "the line says it; the side stays empty");
  assert.equal(r.commit, undefined);
});

test("a clean live row: short commit linked to its repo, who deployed it, no note", () => {
  const [r] = versionRows([live()]);
  assert.equal(r.commit, "aaaaaaa");
  assert.equal(r.href, `https://github.com/azmusgb/pi-hub/commit/${A}`);
  assert.match(r.line, /^deployed .+ by Pi Hub's release runner$/);
  assert.equal(r.note, "");
  assert.deepEqual([r.chip, r.tone], ["Live", "ok"]);
});

test("a failed last deploy shows a second line and a warn tone", () => {
  const [r] = versionRows([rec("pi-hub", "behind",
    { commit: A, head: B, mechanism: "pi-hub-release", last: { commit: B, result: "failed", at: 2000 } },
    { headline: "Pi Hub deploy failed: aaaaaaa is still running", cause: "Tests failed; nothing changed." })]);
  assert.equal(r.tone, "warn");
  assert.equal(r.note, "Pi Hub deploy failed: aaaaaaa is still running. Tests failed; nothing changed.");
});

test("drift is a warning in the record's words", () => {
  const [r] = versionRows([rec("pi-hub", "drifted",
    { commit: A, mechanism: "pi-hub-release", last: { commit: A, result: "deployed", at: 1 } },
    { headline: "Pi Hub is running bbbbbbb, not the recorded aaaaaaa" })]);
  assert.deepEqual([r.chip, r.tone, r.note], ["Drifted", "warn", "Pi Hub is running bbbbbbb, not the recorded aaaaaaa"]);
});

test("no records or a bad answer gives no rows, never a throw", () => {
  assert.deepEqual(versionRows(undefined), []);
  assert.deepEqual(versionRows(null), []);
});

test("only Pi Hub's retained, earlier live versions can be gone back to", () => {
  const rows = historyRows({ current: "c", on_pi: ["a", "b", "c"], log: [
    { sha: "c", status: "live" }, { sha: "b", status: "failed" }, { sha: "a", status: "live" }, { sha: "z", status: "live" }] });
  assert.deepEqual(rows.map((r) => [r.sha, r.canGoBack, r.running]), [["c", false, true], ["b", false, false], ["a", true, false], ["z", false, false]]);
  assert.deepEqual(historyRows(null), []);
});

test("Settings' Versions card only links to System › Versions", () => {
  const src = readFileSync(new URL("../hub/static/js/settings.js", import.meta.url), "utf8");
  assert.match(src, /href: "\/versions"/);
  assert.doesNotMatch(src, /"Go back to this"\)/);
});
