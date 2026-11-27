// Amendment A37 step 4 (Home spoken readout: R1, R3, R4, R6, R7):
// - R1 & R3: Home exports says = true and composes Home's sentence from the exact ask rows drawn, with Local AI unread,
//   with the whole list unread, with open decisions (Call 4), and with bad conditions / running print / warn heads-up.
// - R4: Home draws the printer plate only while a print runs or is held (printing or paused); when idle, finished or
//   failed, no plate is drawn on Home. While Home's plate shows the printer, the X2D row in Systems drops its figure.
// - R6: Systems is drawn on .ui-rows.ui-rows--grid (lamp following the name, one detail line, optional right-aligned
//   figure, never a dash or zero) and home-dashboard.css's custom rack rules are gone.
// - R7: Area badges in navigation.js count asks per area (via askArea), and System stops counting unread alerts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { install, text } from "./helpers/fake_dom.mjs";
import "./helpers/kit.mjs";
import { pageHead } from "../hub/static/js/page-parts.js";
import { homePlateShown, homeReading, mountDashboard, rackRows, renderDashboard } from "../hub/static/js/home-dashboard.js";
import * as nowPage from "../hub/static/js/now.js";
import { askArea } from "../hub/static/js/navigation.js";
import { problemsBadge } from "../hub/static/js/control-room.js";

const sayMod = { exports: {} };
new Function("module", readFileSync(new URL("../hub/static/ui/say.js", import.meta.url), "utf8"))(sayMod);
const Say = sayMod.exports;

const AS_OF = Date.UTC(2026, 10, 25, 20, 0, 0) / 1000;
const NOW_MS = AS_OF * 1000 + 20000;
const live = () => ({ status: "live", source: "Bambuddy", observed_at: new Date(NOW_MS - 20000).toISOString() });
const printingCard = (over = {}) => ({
  state: "printing", progress: 45, percent: 45, left: "6 h 16 min", minutes_left: 376, job_name: "Clip.gcode.3mf",
  layer_num: 506, total_layers: 1306, nozzle_temp: 220, nozzle_target: 220, bed_temp: 60, bed_target: 60,
  as_of: AS_OF, actions: ["pause", "stop"], telemetry: live(), ...over,
});

function withHead() {
  const dom = install();
  globalThis.ApplianceSay = Say;
  const header = dom.document.createElement("header");
  const h1 = Object.assign(dom.document.createElement("h1"), { id: "page-title", className: "brand" });
  const sub = Object.assign(dom.document.createElement("p"), { id: "page-subtitle", className: "top-sub" });
  header.append(h1, sub);
  dom.document.body.append(header);
  pageHead(h1, sub, { label: "Home", purpose: "Your home at a glance", says: nowPage.says, key: "now" });
  const state = {};
  const parent = dom.root();
  mountDashboard(state, parent);
  const said = () => h1.querySelectorAll(".ui-say__s").map(text);
  return {
    dom, h1, sub, state, parent, said,
    done() { delete globalThis.ApplianceSay; dom.uninstall(); },
  };
}

test("R1 & R3: Home exports says = true; its sentence count equals the ask rows drawn, including deliberate exclusions", () => {
  assert.equal(nowPage.says, true);
  const h = withHead();
  try {
    assert.equal(h.h1.getAttribute("aria-busy"), "true", "loading skeleton before first read");
    assert.equal(h.sub.textContent, "", "no purpose line on a saying page");

    // 1 ask + 2 heads-up + 1 deliberate paused AdGuard record (excluded): 1 ask row drawn -> "One thing needs you."
    const needs = {
      count: 2,
      heads_up_count: 2,
      unread: [],
      items: [
        { id: "pi:lab:hex:E-028", source: "Print lab", tone: "warn", kind: "ask", title: "E-028: Fix the plan",
          detail: "Missing wall thickness.", link: "/lab?p=hex&e=E-028" },
        { id: "pi:Ad blocking", source: "Pi Hub", tone: "warn", kind: "ask", title: "Ad blocking",
          detail: "Paused", record: "adguard", link: "/network" },
        { id: "pi:Weather", source: "Pi Hub", tone: "warn", kind: "heads_up", title: "Weather",
          detail: "Wind advisory", link: "/weather", record: "weather" },
        { id: "pi:Raspberry Pi", source: "Pi Hub", tone: "warn", kind: "heads_up", title: "Raspberry Pi",
          detail: "Pi 72 °C. Slowed by heat earlier.", link: "/system", record: "pi" },
      ],
    };
    const records = [{ id: "adguard", state: "paused", severity: "attention" }];
    renderDashboard(h.state, { today: null, records, needs, now: { printer: printingCard() } }, () => {});
    const askRows = h.state.hd.needs.firstChild.querySelectorAll(".ui-need");
    assert.equal(askRows.length, 1, "one ask row drawn under Needs you");
    assert.equal(text(h.state.hd.needsCount), "1");
    assert.equal(problemsBadge(needs, h.state.probs).count, 1);
    assert.equal(h.said()[0], "One thing needs you.");
    assert.match(h.said()[1], /^The X2D is 45% through its print/);
    assert.equal(text(h.h1.querySelector(".ui-vh")), "Home:");
  } finally { h.done(); }
});

test("R3: Local AI unread and whole list unread produce their honest sentences, never 'Nothing needs you'", () => {
  const h = withHead();
  try {
    // Whole list unread: neither /api/needs nor /api/records answered
    renderDashboard(h.state, { today: null, records: null, needs: null, now: {} }, () => {});
    assert.deepEqual(h.said(), ["Couldn't read what needs you."]);

    // /api/needs failed and records had no asks: still unreadable
    renderDashboard(h.state, { today: null, records: [], needs: null, now: {} }, () => {});
    assert.deepEqual(h.said(), ["Couldn't read what needs you."]);

    // Part unread (Local AI while PC sleeps), 0 asks read
    renderDashboard(h.state, { today: null, records: [], needs: { count: 0, items: [], unread: ["Local AI"] }, now: { printer: printingCard() } }, () => {});
    assert.deepEqual(h.said(), ["Nothing needs you here.", "Local AI wasn't read."]);

    // Part unread (Local AI), 2 asks read
    const items = [
      { id: "a1", kind: "ask", tone: "warn", title: "First ask", link: "/workshop" },
      { id: "a2", kind: "ask", tone: "warn", title: "Second ask", link: "/network" },
    ];
    renderDashboard(h.state, { today: null, records: [], needs: { count: 2, items, unread: ["Local AI"] }, now: {} }, () => {});
    assert.deepEqual(h.said(), ["Two things need you.", "Local AI wasn't read."]);

    // /api/records failed while /api/needs answered with 0 asks: names Pi Hub's records as unread
    renderDashboard(h.state, { today: null, records: null, needs: { count: 0, items: [], unread: [] }, now: {} }, () => {});
    assert.deepEqual(h.said(), ["Nothing needs you here.", "Pi Hub's records wasn't read."]);
  } finally { h.done(); }
});

test("R3 Call 4: with no asks and open decisions, Home says '{N} decisions are waiting.'", () => {
  const h = withHead();
  try {
    const d1 = { id: "d1", kind: "choice", question: "Keep the backup schedule?", options: ["Yes", "No"] };
    const d2 = { id: "d2", kind: "choice", question: "Archive E-026?", options: ["Yes", "No"] };
    renderDashboard(h.state, { today: null, records: [], needs: { count: 0, items: [], unread: [], decisions: { open: [d1, d2] } }, now: {} }, () => {});
    assert.deepEqual(h.said(), ["Two decisions are waiting."]);

    renderDashboard(h.state, { today: null, records: [], needs: { count: 0, items: [], unread: [], decisions: { open: [d1] } }, now: {} }, () => {});
    assert.deepEqual(h.said(), ["One decision is waiting."]);

    // Unreadable decisions table (decisions: null) with 0 asks says "Nothing needs you here.", never "Nothing needs you."
    renderDashboard(h.state, { today: null, records: [], needs: { count: 0, items: [], unread: [], decisions: null }, now: {} }, () => {});
    assert.deepEqual(h.said(), ["Nothing needs you here."]);
  } finally { h.done(); }
});

test("R4: Home draws the printer plate only while a print runs or is held, and drops X2D's figure in Systems while the plate is shown", () => {
  const h = withHead();
  try {
    const prRecord = (state = "printing") => ({ id: "printer", state, severity: "ok", detail: { progress: 45, layer: 506, total_layers: 1306 }, actions: [{ name: "pause" }] });

    // Printing: plate is drawn at the top of .hd, with no camera aside, and X2D row in Systems has no figure
    renderDashboard(h.state, { today: null, records: [prRecord("printing")], needs: { count: 0, items: [], unread: [] },
      now: { printer: printingCard() } }, () => {});
    const plate = h.parent.querySelector(".hd-plate.ui-faceplate--plate");
    assert.ok(plate, "plate is drawn while printing");
    assert.equal(plate.classList.contains("ui-faceplate--aside"), false, "no camera aside on Home");
    assert.equal(h.state.hd.root.firstChild, plate, "plate leads .hd");
    assert.equal(plate.querySelector(".ui-meter")?.getAttribute("aria-valuenow"), "45");
    assert.equal(h.parent.querySelector('[data-row="printer"] .ui-row__figure'), null, "X2D row drops its figure while plate is shown");

    // Paused: plate stays drawn
    renderDashboard(h.state, { today: null, records: [prRecord("paused")], needs: { count: 0, items: [], unread: [] },
      now: { printer: printingCard({ state: "paused", actions: ["resume"] }) } }, () => {});
    assert.ok(h.parent.querySelector(".hd-plate.ui-faceplate--plate"), "plate is drawn while paused");
    assert.equal(h.parent.querySelector('[data-row="printer"] .ui-row__figure'), null);

    // Idle, finished, failed, stale: plate is omitted on Home
    for (const over of [
      { state: "idle", percent: null, progress: 0, actions: [] },
      { state: "stopped", percent: null, progress: 100, actions: ["clear"] },
      { state: "error", percent: 62, progress: 62, actions: [] },
      { state: "printing", stale: true, telemetry: { status: "stale", source: "Bambuddy" } },
    ]) {
      assert.equal(homePlateShown(printingCard(over)), false, over.state);
      renderDashboard(h.state, { today: null, records: [{ id: "printer", state: over.state, severity: "ok", stale: over.stale }],
        needs: { count: 0, items: [], unread: [] }, now: { printer: printingCard(over) } }, () => {});
      assert.equal(h.parent.querySelector(".hd-plate"), null, `no plate on Home when printer is ${over.state}${over.stale ? " (stale)" : ""}`);
    }

    // When plateShown is false, rackRows includes the figure for a running print
    const withFig = rackRows({ now: { printer: { minutes_left: 30 } }, records: [prRecord("printing")], nowTs: AS_OF, plateShown: false });
    assert.equal(withFig.find((r) => r.id === "printer").figure?.value, "45%");
  } finally { h.done(); }
});

test("R6: Systems rows use .ui-rows.ui-rows--grid, lamp follows the name, no row shows a dash or zero figure, and custom rack CSS is deleted", () => {
  const h = withHead();
  try {
    renderDashboard(h.state, {
      today: null,
      records: [{ id: "printer", state: "idle", severity: "ok" }, { id: "pi", state: "hot", severity: "attention" },
        { id: "internet", state: "ok", severity: "ok" }, { id: "adguard", state: "blocking", severity: "ok" }],
      needs: { count: 0, items: [], unread: [] },
      now: { pi: { temp: 71.2, mem_total_gb: 3.7, mem_free_gb: 1.7, uptime_h: 264, updates: 0 } },
      pi: { storage: [{ name: "Movies", mounted: true, used_pct: 40, free_gb: 812 }] },
      backups: { available: true, repos: [] },
      workshop: { week: { finished: 0, hours: 0 } },
    }, () => {});
    const list = h.parent.querySelector(".hd-rack > ul.ui-rows.ui-rows--grid");
    assert.ok(list);
    const rows = [...list.querySelectorAll("li > a.ui-row")];
    assert.equal(rows.length, 5);
    for (const row of rows) {
      const name = row.querySelector(".ui-row__name");
      assert.ok(name.children[0].classList.contains("ui-row__title"), "title first inside .ui-row__name");
      assert.ok(name.children.at(-1).classList.contains("ui-chip"), "lamp chip follows the name");
    }
    assert.equal(text(h.parent.querySelector('[data-row="pi"] .ui-row__figure')), "71°slows at 80°");
    assert.equal(text(h.parent.querySelector('[data-row="storage"] .ui-row__figure')), "812GB free");
    assert.equal(h.parent.querySelector('[data-row="network"] .ui-row__figure'), null, "Network has no figure");
    assert.equal(h.parent.querySelector('[data-row="week"] .ui-row__figure'), null, "0 finished prints draws no figure, never a 0");
  } finally { h.done(); }

  const css = readFileSync(new URL("../hub/static/home-dashboard.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.hd-unit\b|\.hd-lamp\b|\.hd-rd\b|\.hd-ring\b|\.hd-gauge\b|\.hd-bars\b/,
    "custom rack CSS rules are deleted from home-dashboard.css (A37 R6)");
});

test("R7: askArea maps asks to their rail area by area, source, path or tool, and ignores heads-up items", () => {
  assert.equal(askArea({ kind: "ask", source: "Print lab", link: "/lab?p=hex&e=E-028" }), "workshop");
  assert.equal(askArea({ kind: "ask", link: "/workshop" }), "workshop");
  assert.equal(askArea({ kind: "ask", link: "/network" }), "network");
  assert.equal(askArea({ kind: "ask", link: "tool:adguard" }), "network");
  assert.equal(askArea({ kind: "ask", link: "/media" }), "household");
  assert.equal(askArea({ kind: "ask", link: "/backups" }), "system");
  assert.equal(askArea({ kind: "ask", link: "/drives" }), "household");
  assert.equal(askArea({ kind: "ask", area: "System" }), "system");
  assert.equal(askArea({ kind: "ask", title: "No area" }), null);
  assert.equal(askArea({ kind: "heads_up", source: "Print lab", link: "/workshop" }), null);
});

test("A36 D2/D3 + A37 R3: attention records without an action or fix merge as heads_up (not asks) and carry no PAGE_VERB button", () => {
  const h = withHead();
  try {
    const records = [
      { id: "pi", state: "hot", severity: "attention", headline: "Running hot" },
      { id: "internet", state: "slow", severity: "attention", headline: "Internet is slow" },
    ];
    renderDashboard(h.state, { today: null, records, needs: { count: 0, items: [], unread: [] }, now: {} }, () => {});
    assert.equal(text(h.state.hd.needsCount), "", "passive attention records are not counted as asks");
    assert.equal(problemsBadge({ count: 0, items: [], unread: [] }, h.state.probs).count, 0);
    assert.equal(h.said()[0], "Nothing needs you.");
    assert.equal(h.said()[1], "Raspberry Pi: Running hot.");
    const box = h.state.hd.needs.querySelector("details.hd-heads-up");
    assert.ok(box, "drawn inside collapsed Heads up");
    assert.equal(box.querySelectorAll('.ui-need[data-kind="heads_up"]').length, 2);
    assert.equal(box.querySelector(".ui-need__action"), null, "no PAGE_VERB button on heads_up record rows (A36 D3)");
  } finally { h.done(); }
});
