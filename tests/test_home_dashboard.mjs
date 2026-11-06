// Home as a dashboard (amendment A8; plan 2026-11-05-a8-home-dashboard, P2): the band's geometry, Needs you's order
// and badge, the rack's rows when a source doesn't answer, and what Home no longer carries.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { install, text } from "./helpers/fake_dom.mjs";
import { clockTime } from "../hub/static/js/core.js";
import { bandFits, bandLayout, countItems, dialHit, dialLayout, dialWords, markWhen, needMark, needsOrder, rackRows, otherFine }
  from "../hub/static/js/home-dashboard.js";
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

// A10 D4 and A11 D1/D6: where it is drawn, the band has the whole day with lane names beside the tracks.
test("the band keeps the whole day with lane names beside the tracks", () => {
  for (const w of [800, 1200]) {
    const L = bandLayout(day({ now: START + 18 * 3600 }), w);
    assert.ok(L.lanes.every((l) => Math.abs(l.labelY - (l.cy + 0.25 * 16)) < 0.01), `${w}px: the name sits on the track's line`);
    assert.equal(L.end, START + 86_400, `${w}px: midnight to midnight`);
    assert.equal(L.width, w);
  }
});

// A10 D4: rows, bars and the name column are in em of the band's type, so the band grows with the fluid root.
test("the band's rows, bars and name column scale with its font size", () => {
  const a = bandLayout(day(), 1200, 16), b = bandLayout(day(), 1200, 20);
  assert.equal(a.lanes[1].cy - a.lanes[0].cy, 44, "today's 44 px row at 16 px");
  assert.equal(b.lanes[1].cy - b.lanes[0].cy, 55);
  assert.equal(b.bar, 20);
  assert.equal(b.start, 8.25 * 20);
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
  for (let w = 300; w <= 2400; w += 10) {
    if (!bandFits(w, 16)) continue;  // narrower, Home draws the dial (A11 D1)
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

// A11 D1: the switch is A10 D4's measure: the band, with names beside, gives an hour at least 24 px, or Home draws the
// dial. 8.25em of names and 1em of padding leave 24 x 24 px of track at 724 px for 16 px type.
test("the band is drawn only where an hour gets 24 px with names beside; elsewhere the dial", () => {
  assert.equal(bandFits(724, 16), true);
  assert.equal(bandFits(723, 16), false);
  assert.equal(bandFits(390, 16), false, "a phone gets the dial");
  assert.equal(bandFits(760, 20), false, "larger type needs a wider band");
  assert.equal(bandFits(761.25, 20), true);
  assert.equal(bandFits(0, 16), false);
});

const H = 3600;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);

// A11 D2: 24 hours clockwise, midnight at the top, one ring per lane inside to outside, up to 22 rem across.
test("the dial: midnight at the top, clockwise, rings in lane order, up to 22 rem across", () => {
  const L = dialLayout(day(), 390, 16);
  assert.equal(L.size, 352, "22rem at 16 px");
  assert.equal(dialLayout(day(), 300, 16).size, 300, "the card's width when narrower");
  assert.deepEqual(L.rings.map((r) => r.id), ["printer", "workshop_display", "pi", "backups", "updates"]);
  for (let i = 1; i < L.rings.length; i++) assert.ok(L.rings[i].r > L.rings[i - 1].r, "inside to outside");
  const r = L.rings[0].r;
  const [mx, my] = L.point(r, START), [sx, sy] = L.point(r, START + 6 * H);
  near(mx, L.c, "midnight x"); near(my, L.c - r, "midnight is at the top");
  near(sx, L.c + r, "6 AM is to the right (clockwise)"); near(sy, L.c, "6 AM y");
  assert.ok(L.rings.at(-1).r + L.ring / 2 < L.size / 2, "the outer ring stays inside the dial");
  assert.deepEqual(L.hours.filter((h) => h.label).map((h) => h.label), ["12a", "6a", "12p", "6p"]);
  assert.equal(L.hours.length, 24, "a tick every hour");
});

test("the dial's arcs: a print across midnight starts at the top; the running print draws to Now, then dashes", () => {
  const d = day({ now: START + 18 * H });
  d.lanes[0].marks = [
    { start: START - 2 * H, end: START + H, kind: "ok", title: "Clip: Finished" },
    { start: START + 17 * H, end: d.now, until: d.now + 3 * H, kind: "run", title: "E-026: Printing" },
  ];
  const [a, b] = dialLayout(d, 390, 16).rings[0].marks;
  near(a.a0, -Math.PI / 2, "clipped to midnight, at the top");
  near(a.a1, -Math.PI / 2 + Math.PI / 12, "to 1 AM");
  near(b.a1, -Math.PI / 2 + 18 / 24 * 2 * Math.PI, "the print draws to Now");
  near(b.ghost.a0, b.a1, "its finish dashes from Now");
  near(b.ghost.a1, -Math.PI / 2 + 21 / 24 * 2 * Math.PI, "to the finish");
  const late = day({ now: START + 23 * H });
  late.lanes[0].marks = [{ start: START + 22 * H, end: late.now, until: late.now + 5 * H, kind: "run", title: "Long" }];
  near(dialLayout(late, 390, 16).rings[0].marks[0].ghost.a1, 1.5 * Math.PI, "the dashed finish stops at midnight");
});

// A11 D3: a hit area at least 44 x 44 around every mark, however short; where two overlap, the nearer mark.
test("every mark on the dial answers a tap within 22 px of it, and a tap takes the nearer mark", () => {
  const d = day();
  d.lanes[0].marks = [{ at: START + 3 * H, kind: "warn", title: "Point" }];
  d.lanes[1].marks = [{ start: START + 3 * H, end: START + 3 * H + 60, kind: "ok", title: "Short" }];
  const L = dialLayout(d, 390, 16);
  const ring0 = L.rings[0], ring1 = L.rings[1];
  const at = (r, ts) => L.point(r, ts);
  const hit = (xy) => dialHit(L, ...xy)?.mark.title;
  assert.equal(hit(at(ring0.r, START + 3 * H)), "Point");
  assert.equal(hit(at(ring1.r, START + 3 * H)), "Short");
  // 21 px off the point, along the ring and across it, still finds a mark: a 44 x 44 target
  const ang = L.angle(START + 3 * H);
  const off = (dr, dt) => [L.c + (ring0.r + dr) * Math.cos(ang) - dt * Math.sin(ang), L.c + (ring0.r + dr) * Math.sin(ang) + dt * Math.cos(ang)];
  assert.ok(hit(off(0, 21)), "21 px along the ring");
  assert.ok(hit(off(0, -21)), "21 px back along the ring");
  assert.equal(hit(off(-21, 0)), "Point", "21 px inside the inner ring: only the point is near");
  assert.equal(hit(off(0, 40)), undefined, "40 px away: nothing");
  // between the two rings, the nearer wins
  assert.equal(hit(off((ring1.r - ring0.r) * 0.3, 0)), "Point");
  assert.equal(hit(off((ring1.r - ring0.r) * 0.7, 0)), "Short");
});

test("a tap either side of midnight finds a mark at midnight or just before it", () => {
  const d = day();
  d.lanes[0].marks = [{ at: START, kind: "warn", title: "At midnight" }];
  d.lanes[1].marks = [{ at: START + 86_400 - 60, kind: "ok", title: "Just before" }];
  const L = dialLayout(d, 390, 16);
  const top = (r, dx) => [L.c + dx, L.c - r];
  assert.equal(dialHit(L, ...top(L.rings[0].r, -15))?.mark.title, "At midnight", "left of the top");
  assert.equal(dialHit(L, ...top(L.rings[0].r, 15))?.mark.title, "At midnight", "right of the top");
  assert.equal(dialHit(L, ...top(L.rings[1].r, 15))?.mark.title, "Just before", "right of the top, the day's last minute");
});

test("the dial on a DST day, and a mark across the whole day", () => {
  const d = day({ end: START + 25 * H, now: START + 24.5 * H });
  d.lanes[2].marks = [{ start: START - H, end: START + 26 * H, kind: "warn", title: "All day" }];
  const L = dialLayout(d, 390, 16);
  assert.equal(L.hours.length, 25, "a tick for each of 25 hours");
  near(L.angle(START + 25 * H), 1.5 * Math.PI, "the day's own end closes the circle");
  const m = L.rings[2].marks[0];
  near(m.a0, -Math.PI / 2, "from midnight"); near(m.a1, 1.5 * Math.PI, "to midnight");
});

test("the dial keeps its hour labels inside its width on a small phone", () => {
  for (const w of [240, 260, 280, 320, 352]) {
    const L = dialLayout(day(), w, 16);
    assert.ok(L.labelR + 0.75 * 16 <= L.size / 2, `${w}px: labels inside (${L.labelR})`);
    assert.ok(L.labelR - 0.5 * 16 >= L.outer + 2, `${w}px: labels clear of the outer ring`);
  }
});

test("each dial mark carries a 44 px target the sweep can measure", async () => {
  const k = kitInstall();
  try {
    const { drawDial } = await import("../hub/static/js/home-dashboard.js");
    const d = day();
    d.lanes[2].marks = [{ at: START + 2 * H, kind: "warn", title: "Low voltage" }];
    const host = document.createElement("div");
    drawDial(host, d, 390, 16);
    const hit = host.querySelector(".hd-dial__mark .hd-dial__hit");
    assert.ok(hit, "a hit circle inside the mark");
    assert.ok(Number(hit.getAttribute("r")) >= 22);
  } finally { k.done(); }
});

// A10 D4: the band keeps the whole day at any hour, and the running print's dashed finish stops at its right edge.
test("the band spans midnight to midnight at 1 AM, 6 PM and 11:30 PM, and clips a finish past midnight", () => {
  for (const h of [1, 18, 23.5]) assert.equal(bandLayout(day({ now: START + h * H }), 1200).end, START + 86_400, `${h}h`);
  const d = day({ now: START + 23 * H });
  d.lanes[0].marks = [{ start: START + 22 * H, end: d.now, until: d.now + 4 * H, kind: "run", title: "Long" }];
  const L = bandLayout(d, 1200), m = L.lanes[0].marks[0];
  assert.ok(m.ghost.x + m.ghost.w <= L.width - L.pad + 0.01, "the dashed finish stops at the band's end");
});

test("the dial's centre says the time and the day's counts in words", () => {
  assert.equal(dialWords({ finished: 3, failed: 2, power: 0, updates: 1 }), "3 done, 2 failed", "the headline counts");
  assert.equal(dialWords({ finished: 0, failed: 0, power: 0, updates: 0 }), "0 done", "a quiet day says so");
  assert.equal(dialWords({ finished: 1, failed: 0, power: 2, updates: 3 }), "1 done", "dips and updates are in the tally");
  assert.equal(dialWords(null), "", "no counts, no words");
});

test("the dial: marks in time order for the keyboard, a down lane dashed and named, a quiet day empty", async () => {
  const k = kitInstall();
  try {
    const { drawDial } = await import("../hub/static/js/home-dashboard.js");
    const d = day();
    d.lanes[2].marks = [{ at: START + 2 * H, kind: "warn", title: "Low voltage" }];
    d.lanes[0].marks = [{ start: START + 5 * H, end: START + 6 * H, kind: "ok", title: "Clip" }];
    d.lanes[4].marks = [{ at: START + H, kind: "deployed", title: "Pi Hub 3ab99e9" }];
    d.lanes[3] = { ...d.lanes[3], available: false, marks: [] };
    const host = document.createElement("div");
    drawDial(host, d, 390, 16);
    const marks = [...host.querySelectorAll(".hd-dial__mark")];
    assert.deepEqual(marks.map((m) => m.getAttribute("aria-label")),
      [`Updates: Pi Hub 3ab99e9, ${clockTime(START + H)}`, `Raspberry Pi: Low voltage, ${clockTime(START + 2 * H)}`,
        `X2D: Clip, ${clockTime(START + 5 * H)} to ${clockTime(START + 6 * H)}`],
      "keyboard order is time order");
    assert.ok(marks.every((m) => m.getAttribute("tabindex") === "0"));
    assert.equal(host.querySelectorAll(".hd-dial__ring--down").length, 1, "the down lane's ring is dashed");
    assert.match(text(host.querySelector(".hd-dial__key")), /Backups: Backrest isn't answering/);
    assert.match(text(host.querySelector(".hd-dial__key")), /^X2D.*Workshop display.*Raspberry Pi.*Backups.*Updates/, "the key, inside to outside");
    const quiet = document.createElement("div");
    drawDial(quiet, day(), 390, 16);
    assert.equal(quiet.querySelectorAll(".hd-dial__mark").length, 0);
    assert.equal(quiet.querySelectorAll(".hd-dial__ring").length, 5, "a quiet day is empty rings");
    assert.match(text(quiet.querySelector(".hd-dial__centre")), /0 done/);
  } finally { k.done(); }
});

// A11 D5: where the dial is drawn, the counts sit under it and the rack is compact rows: lamp, name, state, one
// reading, the link (and a row's actions, which are not readings).
test("Home draws the dial and compact rows where the band doesn't fit, and the band and full rack where it does", async () => {
  const k = kitInstall();
  try {
    const { mountDashboard, renderDashboard } = await import("../hub/static/js/home-dashboard.js");
    const draw = (width) => {
      const state = {}, parent = k.env.root();
      mountDashboard(state, parent);
      state.hd.plot.clientWidth = width;
      renderDashboard(state, { today: day({ counts: { finished: 3, failed: 2, power: 0, updates: 0 } }), records: [],
        needs: { count: 0, items: [], unread: [] }, now: {}, pi: { temp: 52 }, backups: null,
        workshop: { week: { finished: 4, hours: 9 } } }, () => {});
      return parent;
    };
    const phone = draw(390);
    assert.equal(phone.querySelector(".hd").dataset.day, "dial");
    assert.ok(phone.querySelector(".hd-dial"));
    assert.equal(phone.querySelector(".hd-band__svg"), null);
    assert.equal(phone.querySelectorAll(".hd-unit--compact").length, 5);
    assert.equal(phone.querySelectorAll(".hd-unit__readings").length, 0, "one reading, not the full set");
    assert.equal(text(phone.querySelector('[data-row="week"] .hd-unit__brief')), "4 finished");
    const wide = draw(1100);
    assert.equal(wide.querySelector(".hd").dataset.day, "band");
    assert.ok(wide.querySelector(".hd-band__svg"));
    assert.equal(wide.querySelectorAll(".hd-unit--compact").length, 0);
  } finally { k.done(); }
});

test("a resize between band and dial redraws the rack, keeps focus and the lit mark", async () => {
  const k = kitInstall();
  try {
    const { mountDashboard, renderDashboard, redrawBand } = await import("../hub/static/js/home-dashboard.js");
    const state = {}, parent = k.env.root();
    mountDashboard(state, parent);
    state.hd.plot.clientWidth = 1100;
    const d = day();
    d.lanes[2].marks = [{ at: START + 2 * H, kind: "warn", title: "Low voltage" }];
    renderDashboard(state, { today: d, records: [], needs: { count: 0, items: [], unread: [] }, now: {} }, () => {});
    assert.equal(parent.querySelector(".hd").dataset.day, "band");
    state.hd.lit = { lane: "pi", index: 0 };
    const links = () => [...parent.querySelectorAll(".hd-unit__go")];
    links()[2].focus();
    state.hd.plot.clientWidth = 390;  // rotated to a phone
    redrawBand(state);
    assert.equal(parent.querySelector(".hd").dataset.day, "dial");
    assert.equal(parent.querySelectorAll(".hd-unit--compact").length, 5, "the rack follows");
    assert.equal(document.activeElement, links()[2], "focus comes back to the same link");
    assert.ok(parent.querySelector(".hd-dial__mark").classList.contains("is-lit"), "the lit mark stays lit");
  } finally { k.done(); }
});

test("the compact Storage row says nothing rather than null when free space is unknown", () => {
  const rows = rackRows({ now: {}, records: [], pi: { storage: [{ name: "Movies", mounted: true, used_pct: 40 }] }, backups: null, workshop: null, nowTs: START });
  assert.equal(rows.find((r) => r.id === "storage").brief, "");
});

test("each rack row has one reading for the compact rows", () => {
  const rows = rackRows({ now: { printer: { minutes_left: 30 }, pi: { temp: 52.4 } },
    records: [{ id: "printer", state: "printing", severity: "ok", detail: { progress: 42 } }, { id: "pi", state: "ok", severity: "ok" }],
    pi: { storage: [{ name: "Movies", mounted: true, used_pct: 40, free_gb: 812 }] }, backups: null,
    workshop: { week: { finished: 4, hours: 9 } }, nowTs: START + 15 * H });
  const brief = Object.fromEntries(rows.map((r) => [r.id, r.brief]));
  assert.equal(brief.pi, "52°");
  assert.equal(brief.storage, "812 GB free");
  assert.equal(brief.week, "4 finished");
  assert.equal(brief.network, "", "the network's state is its reading");
});

// A9 D2: short count labels on a phone, the full words kept for screen readers
test("each count has a short phone label and keeps its full words", () => {
  const items = countItems({ finished: 3, failed: 2, power: 1, updates: 3 });
  assert.deepEqual(items.map((c) => c.label), ["prints finished", "failed", "power dips", "updates shipped"]);
  assert.deepEqual(items.map((c) => c.short), ["finished", "failed", "power dips", "updates"]);
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

test("the tally hides the extra words visually in a narrow band, not from screen readers", async () => {
  const k = kitInstall();
  try {
    const { mountDashboard, renderDashboard } = await import("../hub/static/js/home-dashboard.js");
    const state = {}, parent = k.env.root();
    mountDashboard(state, parent);
    renderDashboard(state, { today: day({ counts: { finished: 3, failed: 2, power: 1, updates: 3 } }), records: [], needs: { count: 0, items: [], unread: [] } }, () => {});
    const labels = [...parent.querySelectorAll(".hd-tally li > span")];
    assert.deepEqual(labels.map(text), ["prints finished", "failed", "power dips", "updates shipped"]);
    assert.deepEqual([...parent.querySelectorAll(".hd-tally__more")].map(text), ["prints", "shipped"]);
    const css = readFileSync(new URL("../hub/static/home-dashboard.css", import.meta.url), "utf8");
    assert.match(css, /@container band \(max-width: [\d.]+rem\)[\s\S]*\.hd-tally__more \{[^}]*clip-path: inset\(50%\)/);
  } finally { k.done(); }
});

// A8 D1: the Now line sweeps from midnight once on first load, never with reduced motion and never on a refresh
test("the Now line sweeps once per page load, and not with reduced motion", async () => {
  const k = kitInstall();
  try {
    const mod = await import("../hub/static/js/home-dashboard.js");
    const sweeps = () => parent.querySelectorAll(".hd-band__nowg.is-sweeping").length;
    let parent;
    const draw = (reduce) => {
      globalThis.matchMedia = (q) => ({ matches: /no-preference/.test(q) ? !reduce : false });
      const state = {};
      parent = k.env.root();
      mod.mountDashboard(state, parent);
      state.hd.plot.clientWidth = 900;  // the band (the dial has no sweep)
      return state;
    };
    mod.resetSweep();
    let state = draw(true);
    mod.renderDashboard(state, { today: day(), records: [], needs: null }, () => {});
    assert.equal(sweeps(), 0, "reduced motion: no sweep");
    mod.resetSweep();
    state = draw(false);
    mod.renderDashboard(state, { today: day(), records: [], needs: null }, () => {});
    assert.equal(sweeps(), 1, "first draw sweeps");
    mod.renderDashboard(state, { today: day(), records: [], needs: null }, () => {});
    assert.equal(sweeps(), 0, "a refresh doesn't");
    state = draw(false);
    mod.renderDashboard(state, { today: day(), records: [], needs: null }, () => {});
    assert.equal(sweeps(), 0, "coming back to Home in the same page load doesn't");
  } finally { delete globalThis.matchMedia; k.done(); }
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
  // A10 D4: the fluid root scales Home on the TV; no zoom
  assert.doesNotMatch(css, /zoom\s*:/);
});
