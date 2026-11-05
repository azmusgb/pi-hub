// Home as a dashboard (amendment A8; plan 2026-11-05-a8-home-dashboard, P2): the band's geometry, Needs you's order
// and badge, the rack's rows when a source doesn't answer, and what Home no longer carries.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { install, text } from "./helpers/fake_dom.mjs";
import { bandLayout, countItems, markWhen, needMark, needsOrder, rackRows, otherFine } from "../hub/static/js/home-dashboard.js";
import * as controlRoom from "../hub/static/js/control-room.js";

const { mergeProblems, problemsBadge } = controlRoom;
const START = 1_793_854_800;  // a local midnight; the day's own bounds are what the band uses
const day = (over = {}) => ({
  day: "2026-11-05", start: START, end: START + 86_400, now: START + 15.5 * 3600,
  lanes: [
    { id: "printer", label: "X2D", source: "Bambuddy", available: true, marks: [] },
    { id: "workshop_display", label: "Workshop display", source: "The hub's history", available: true, marks: [] },
    { id: "pi", label: "Raspberry Pi", source: "The hub's history", available: true, marks: [] },
    { id: "backups", label: "Backups", source: "Backrest", available: true, marks: [] },
    { id: "updates", label: "Updates", source: "Pi Hub", available: true, marks: [] },
  ],
  counts: { finished: 0, failed: 0, power: 0, updates: 0 },
  ...over,
});

test("the band puts lane names beside the tracks when wide and above them on a phone", () => {
  const wide = bandLayout(day(), 1200), narrow = bandLayout(day(), 390);
  assert.equal(wide.narrow, false);
  assert.equal(narrow.narrow, true);
  assert.ok(wide.lanes.every((l) => Math.abs(l.labelY - (l.cy + 4)) < 0.01), "wide: the name sits on the track's line");
  assert.ok(narrow.lanes.every((l) => l.labelY < l.cy - 7), "narrow: the name sits above the track");
  assert.ok(narrow.hours.filter((h) => h.label).every((h) => h.label.length <= 3), "narrow: short hours (12a, 6a, 12p)");
  assert.equal(narrow.width, 390);
});

test("every mark is at least a 44 x 44 target, however thin it is drawn, and targets don't cross lanes", () => {
  const d = day();
  d.lanes[2].marks = [{ at: START + 3600, kind: "warn", title: "Low voltage seen" }];
  d.lanes[0].marks = [{ start: START + 7200, end: START + 7210, kind: "ok", title: "Clip: Finished" }];
  for (const w of [320, 390, 820, 1440]) {
    for (const lane of bandLayout(d, w).lanes) for (const m of lane.marks) {
      assert.ok(m.hit.w >= 44 && m.hit.h >= 44, `${w}px ${m.title}: ${m.hit.w}x${m.hit.h}`);
    }
    const ls = bandLayout(d, w).lanes;
    for (let i = 1; i < ls.length; i++) assert.ok(ls[i].cy - 22 >= ls[i - 1].cy + 22, `${w}px: lanes ${i - 1} and ${i} overlap`);
  }
});

test("hour labels never touch each other, from a phone to a wide desktop", () => {
  const CH = 7;  // a generous width per character at 11 px Archivo
  for (let w = 300; w <= 1600; w += 10) {
    const labels = bandLayout(day({ now: START + 1800 }), w).hours.filter((h) => h.label).map((h) => {
      const len = h.label.length * CH;
      const left = h.anchor === "start" ? h.x : h.anchor === "end" ? h.x - len : h.x - len / 2;
      return { left, right: left + len, label: h.label };
    });
    for (let i = 1; i < labels.length; i++) {
      assert.ok(labels[i].left - labels[i - 1].right >= 4, `${w}px: ${labels[i - 1].label} / ${labels[i].label}`);
    }
  }
});

test("an hour label next to Now gives way to it", () => {
  const L = bandLayout(day({ now: START + 12 * 3600 + 60 }), 1200);
  const noon = L.hours[12];
  assert.equal(noon.label, "", "Noon is hidden under Now");
  assert.ok(L.hours[0].label === "Midnight");
});

test("a lane whose source didn't answer is drawn as down, never as an empty quiet row", async () => {
  const d = day();
  d.lanes[0] = { ...d.lanes[0], available: false, marks: [] };
  const env = install();
  try {
    const { drawBand } = await import("../hub/static/js/home-dashboard.js");
    const host = document.createElement("div");
    drawBand(host, d, 900);
    assert.match(text(host), /Bambuddy isn't answering/);
    assert.equal(host.querySelectorAll(".hd-band__mark").length, 0);
  } finally { env.uninstall(); }
});

test("the tally says — for a count whose source didn't answer, and 0 for a quiet day", () => {
  assert.deepEqual(countItems({ finished: 0, failed: null, power: 0, updates: 2 }).map((c) => c.value), ["0", "—", "0", "2"]);
  assert.deepEqual(countItems().map((c) => c.value), ["—", "—", "—", "—"]);
});

test("a mark's time in words: a point, a range, one from before midnight and one still going", () => {
  const d = day();
  assert.match(markWhen({ start: START - 600, end: START + 3600 }, d), /^until /);
  assert.equal(markWhen({ start: START - 600, end: d.now }, d), "since before midnight");
  assert.match(markWhen({ start: START + 3600, end: d.now }, d), /^since /);
  assert.match(markWhen({ start: START + 3600, end: START + 7200 }, d), / to /);
  assert.match(markWhen({ start: START + 3600, end: d.now, until: d.now + 1800 }, d), /done /);
});

test("Needs you lists bad first, then attention, then the rest, keeping order within each", () => {
  const order = needsOrder([
    { id: "a", tone: "warn" }, { id: "b", tone: "bad" }, { id: "c", kind: "record", tone: "warn" }, { id: "d", tone: "bad" },
  ]).map((p) => p.id);
  assert.deepEqual(order, ["b", "d", "c", "a"]);
});

test("Ad blocking paused is deliberate: it is not a Need, and the badge counts the list it shows", () => {
  const records = [
    { id: "adguard", state: "paused", severity: "attention", headline: "Ad blocking paused" },
    { id: "pc", state: "off", severity: "problem", headline: "The PC is off" },
  ];
  const needs = { count: 0, items: [], unread: [] };
  const probs = needsOrder(mergeProblems(records, needs));
  assert.deepEqual(probs.map((p) => p.recordId || p.id).filter((id) => /adguard/.test(id)), []);
  assert.equal(problemsBadge(needs, probs).count, probs.length);
  assert.ok(probs.length >= 1, "the PC still needs you");
});

test("the hub's own Ad blocking need is left out while the record says paused, and kept when records didn't answer", () => {
  const needs = { count: 2, unread: [], items: [
    { id: "pi:Ad blocking", source: "Pi Hub", tone: "warn", title: "Ad blocking", record: "adguard", link: "/network" },
    { id: "pi:Raspberry Pi", source: "Pi Hub", tone: "warn", title: "Raspberry Pi", record: "pi", link: "/system" }] };
  const paused = mergeProblems([{ id: "adguard", state: "paused", severity: "attention" }, { id: "pi", state: "power", severity: "attention" }], needs);
  assert.deepEqual(paused.map((p) => p.id), ["pi:Raspberry Pi"]);
  assert.equal(problemsBadge(needs, paused).count, 1, "the badge counts the list, not the hub's raw count");
  const off = mergeProblems([{ id: "adguard", state: "not_answering", severity: "problem" }], needs);
  assert.ok(off.some((p) => p.id === "pi:Ad blocking"), "ad blocking that failed still needs you");
  assert.equal(mergeProblems(null, needs).length, 2, "no records: nothing is hidden on a guess");
});

test("a hub need that stands for a record lights that record's lane", () => {
  const d = day();
  d.lanes[2].marks = [{ at: START + 100, kind: "warn", title: "Low voltage seen" }];
  assert.deepEqual(needMark({ kind: "need", record: "pi", about: "" }, d), { lane: "pi", index: 0 });
});

test("a need lights its lane's newest mark today; a Print lab need lights the running print", () => {
  const d = day();
  d.lanes[2].marks = [{ at: START + 100, kind: "warn", title: "Low voltage seen" }, { at: START + 900, kind: "warn", title: "Low voltage seen" }];
  d.lanes[0].marks = [{ start: START, end: START + 50, kind: "ok", title: "A" }, { start: START + 60, end: d.now, kind: "run", title: "B" }];
  assert.deepEqual(needMark({ kind: "record", recordId: "pi" }, d), { lane: "pi", index: 1 });
  assert.deepEqual(needMark({ kind: "need", source: "Print lab" }, d), { lane: "printer", index: 1 });
  assert.equal(needMark({ kind: "record", recordId: "pc" }, d), null);
  d.lanes[2] = { ...d.lanes[2], available: false };
  assert.equal(needMark({ kind: "record", recordId: "pi" }, d), null, "a lane that didn't answer lights nothing");
});

test("every rack row stays when its source doesn't answer, and says which source", () => {
  const rows = rackRows({ now: null, records: null, pi: null, backups: null, workshop: null, nowTs: START + 3600 });
  assert.deepEqual(rows.map((r) => r.id), ["printer", "pi", "network", "storage", "week"]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.match(by.printer.state, /isn't answering/);
  assert.match(by.network.state, /isn't answering/);
  assert.match(by.storage.state, /isn't answering/);
  assert.match(by.week.state, /Bambuddy isn't answering/);
  assert.ok(rows.every((r) => r.lamp === "unknown"), "no row shows fine without an answer");
  assert.match(by.pi.state, /isn't answering/);
});

test("Storage says which part didn't answer instead of Fine", () => {
  const rows = (src) => rackRows({ now: {}, nowTs: START + 3600, records: [], ...src }).find((r) => r.id === "storage");
  const helperDown = rows({ pi: { storage: [] }, backups: { available: false, repos: [] } });
  assert.equal(helperDown.state, "Backrest isn't answering");
  assert.equal(helperDown.lamp, "unknown");
  assert.equal(rows({ pi: null, backups: { available: true, repos: [] } }).state, "The Pi's status isn't answering");
  assert.equal(rows({ pi: { storage: [] }, backups: { available: true, repos: [] } }).state, "Backed up");
});

test("the Pi row says when its record or its self-check didn't answer", () => {
  const pi = (src) => rackRows({ now: {}, nowTs: START + 3600, ...src }).find((r) => r.id === "pi");
  assert.equal(pi({ records: null, pi: {} }).state, "Pi Hub's records isn't answering");
  const r = pi({ records: [{ id: "pi", state: "ok", severity: "ok" }], pi: null });
  assert.deepEqual(r.readings.find((x) => x.label === "Self-check"), { label: "Self-check", value: "Not answering", warn: true });
});

test("a stale printer record says when it was last seen and offers no buttons", () => {
  const rows = rackRows({ now: { printer: {} }, nowTs: START + 3600,
    records: [{ id: "printer", state: "printing", severity: "ok", stale: true, as_of: START + 60, actions: [{ name: "pause" }] }] });
  const pr = rows.find((r) => r.id === "printer");
  assert.equal(pr.lamp, "warn");
  assert.match(pr.state, /^Last seen .*Bambuddy isn't answering/);
  assert.equal(pr.printer, null);
});

test("the printer row keeps its buttons and the Print lab link (no regression from the control room)", () => {
  const rows = rackRows({ now: { printer: { nozzle_temp: 220, bed_temp: 65, minutes_left: 30 } }, nowTs: START + 3600,
    records: [{ id: "printer", state: "printing", severity: "ok", headline: "Printing",
      detail: { progress: 42, lab: "E-026", lab_project: "hex-tile" }, actions: [{ name: "pause" }, { name: "stop" }] }] });
  const pr = rows.find((r) => r.id === "printer");
  assert.equal(pr.lamp, "run");
  assert.ok(pr.printer.actions.includes("pause"));
  assert.ok(pr.readings.some((r) => r.kind === "ring"));
});

test("Ad blocking paused shows in the Network row with the way to turn it back on", () => {
  const rows = rackRows({ now: {}, nowTs: START + 3600, records: [
    { id: "internet", state: "ok", severity: "ok" }, { id: "adguard", state: "paused", severity: "attention", since: START + 60 }] });
  const net = rows.find((r) => r.id === "network");
  assert.equal(net.state, "Ad blocking paused");
  assert.equal(net.action.label, "Turn it on in AdGuard");
});

test("the closing list holds only fine records the rack doesn't show", () => {
  const fine = otherFine([
    { id: "plex", state: "idle", severity: "ok", headline: "Nothing playing" },
    { id: "internet", state: "ok", severity: "ok" },
    { id: "release:pi-hub", state: "ok", severity: "ok" },
    { id: "ntfy", state: "down", severity: "problem" },
  ]);
  assert.deepEqual(fine.map((r) => r.id), ["plex"]);
});

test("Home renders the band, Needs you and the rack, with no camera", async () => {
  const env = install();
  const kit = { exports: {} };
  new Function("module", readFileSync(new URL("../hub/static/ui/needs.js", import.meta.url), "utf8"))(kit);
  globalThis.ApplianceNeeds = kit.exports;
  try {
    const { mountDashboard, renderDashboard, leaveDashboard } = await import("../hub/static/js/home-dashboard.js");
    const state = {};
    const parent = env.root();
    mountDashboard(state, parent);
    const d = day();
    d.lanes[0].marks = [{ start: START + 3600, end: START + 7200, kind: "ok", title: "Clip: Finished" }];
    renderDashboard(state, { today: d, records: [{ id: "pc", state: "off", severity: "problem", headline: "The PC is off" }],
      needs: { count: 0, items: [], unread: [] }, now: {}, pi: null, backups: null, workshop: null }, () => {});
    assert.ok(parent.querySelector(".hd-band"));
    assert.ok(parent.querySelector(".hd-needs"));
    assert.equal(parent.querySelectorAll(".hd-unit").length, 5);
    assert.equal(parent.querySelectorAll("img").length, 0, "no camera on Home (A8)");
    assert.equal(state.probs.length, 1);
    leaveDashboard(state);
    assert.equal(state.hd, null);
    renderDashboard(state, { today: d }, () => {});  // a read that lands after leaving draws nothing
  } finally { env.uninstall(); delete globalThis.ApplianceNeeds; }
});

const kitInstall = () => {
  const env = install();
  const kit = { exports: {} };
  new Function("module", readFileSync(new URL("../hub/static/ui/needs.js", import.meta.url), "utf8"))(kit);
  globalThis.ApplianceNeeds = kit.exports;
  return { env, done() { env.uninstall(); delete globalThis.ApplianceNeeds; } };
};

test("Needs you never says all clear when its sources didn't answer, and leaves the badge alone with no list", async () => {
  const k = kitInstall();
  try {
    const { mountDashboard, renderDashboard } = await import("../hub/static/js/home-dashboard.js");
    const state = {}, parent = k.env.root();
    mountDashboard(state, parent);
    renderDashboard(state, { today: null, records: null, needs: null }, () => {});
    assert.equal(state.probs, null);
    assert.doesNotMatch(text(state.hd.needs), /Nothing needs you/);
    assert.match(text(state.hd.needs), /Needs you isn't answering/);
    renderDashboard(state, { today: null, records: [], needs: null }, () => {});
    assert.deepEqual(state.probs, []);
    assert.doesNotMatch(text(state.hd.needs), /Nothing needs you/);
    assert.match(text(state.hd.needs), /Needs you isn't answering/);
    renderDashboard(state, { today: null, records: null, needs: { count: 1, unread: [], items: [{ id: "x", title: "E-026: Send it", tone: "warn", source: "Print lab" }] } }, () => {});
    assert.match(text(state.hd.needs), /E-026: Send it/);
    assert.match(text(state.hd.needs), /Pi Hub's records isn't answering/);
    renderDashboard(state, { today: null, records: [], needs: { count: 0, unread: [], items: [] } }, () => {});
    assert.match(text(state.hd.needs), /Nothing needs you right now/);
  } finally { k.done(); }
});

test("a refresh puts keyboard focus back where it was", async () => {
  const k = kitInstall();
  try {
    const { mountDashboard, renderDashboard } = await import("../hub/static/js/home-dashboard.js");
    const state = {}, parent = k.env.root();
    mountDashboard(state, parent);
    const src = { today: null, records: [], needs: { count: 0, unread: [], items: [] }, now: {} };
    renderDashboard(state, src, () => {});
    const links = () => [...parent.querySelectorAll(".hd-unit__go")];
    links()[2].focus();
    renderDashboard(state, src, () => {});
    assert.equal(document.activeElement, links()[2], "the Network row's link has focus again");
  } finally { k.done(); }
});

test("the control room's page code is gone: nothing mounts it, and Home's camera timer doesn't look for it", () => {
  for (const name of ["mountControlRoom", "loadControlRoom", "leaveControlRoom", "setControlNeeds", "renderControlRoom", "calmSummaryText"]) {
    assert.equal(controlRoom[name], undefined, name);
  }
  const now = readFileSync(new URL("../hub/static/js/now.js", import.meta.url), "utf8");
  assert.doesNotMatch(now, /cr-hero|ControlRoom|openCamera\b|cameraOk/);
  assert.match(now, /mountDashboard\(state, state\.dash\)/);
});

test("Home's stylesheet is linked and cached, and uses no tokens of its own", () => {
  const index = readFileSync(new URL("../hub/static/index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../hub/static/sw.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../hub/static/home-dashboard.css", import.meta.url), "utf8");
  assert.match(index, /href="\/static\/home-dashboard\.css"/);
  assert.match(sw, /"\/static\/home-dashboard\.css"/);
  assert.match(sw, /"\/static\/js\/home-dashboard\.js"/);
  assert.doesNotMatch(css, /^\s*--[a-z]/m, "no new custom properties (plan decision 9)");
  assert.doesNotMatch(css, /var\(--(?!ui-)/, "only the kit's --ui-* tokens");
  // the shell caps #view at 1440 px: a zoom above 1.2 would leave the band too narrow to read (2.4 gave 267 px)
  for (const [, z] of css.matchAll(/zoom:\s*([\d.]+)/g)) assert.ok(Number(z) <= 1.2, `zoom ${z}`);
});
