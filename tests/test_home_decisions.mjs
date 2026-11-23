// A33 P2 (plan 2026-11-21-a33-owner-decisions, decisions 3-6): Home's Needs you draws the owner's open decisions with
// the kit's renderDecisions, under the condition rows. Only the owner's /api/needs has `decisions`; a failed read is
// never an empty list; a tap's row reads "Recorded" only from what the hub answered.
import test from "node:test";
import assert from "node:assert/strict";
import { install, text } from "./helpers/fake_dom.mjs";
import "./helpers/kit.mjs";
import { mountDashboard, renderDashboard, decisionsUnread } from "../hub/static/js/home-dashboard.js";
import { LINK_ORIGINS, answerDecision, decisionsState, decisionsView } from "../hub/static/js/home-decisions.js";

const D1 = { id: "a27-activity", kind: "choice", question: "Where does Activity live?", options: ["System", "Home"],
  recommended: "System", link: "https://github.com/azmusgb/pi-hub/pull/305", answered_at: null, answer: null };
const D2 = { id: "a30-listing", kind: "choice", question: "List A30 in the baseline?", options: ["Yes", "Not yet"],
  recommended: null, link: null, answered_at: null, answer: null };
const COND = { id: "x", title: "E-026: Send it", tone: "warn", source: "Print lab" };
const needs = (decisions, items = []) => ({ count: items.length, unread: [], items, ...(decisions === undefined ? {} : { decisions }) });
const owner = (open = [D1, D2]) => needs({ open, answered: [] });
const settle = () => new Promise((r) => setTimeout(r, 10));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Home mounted on the fake DOM; `answers` is the hub's reply to each POST, in order (a Response, or an Error to throw).
function home(answers = []) {
  const env = install();
  const posts = [];
  globalThis.fetch = async (url, opts = {}) => {
    posts.push({ url: String(url), body: JSON.parse(opts.body || "null"), method: opts.method });
    const r = answers.shift();
    if (r instanceof Error) throw r;
    return r || json(500, { detail: "no reply set" });
  };
  const state = {}, parent = env.root();
  mountDashboard(state, parent);
  let reloads = 0;
  const draw = (n) => renderDashboard(state, { today: null, records: [], needs: n, now: {} }, () => { reloads += 1; });
  const group = () => state.hd.decisions.querySelector(".ui-decisions");
  const rows = () => [...state.hd.decisions.querySelectorAll(".ui-decision")];
  const option = (id, label) => rows().find((r) => r.dataset.decision === id)
    ?.querySelectorAll("button").find((b) => b.textContent.startsWith(label));
  return { env, state, posts, draw, group, rows, option, reloads: () => reloads, done: () => env.uninstall() };
}

test("a caller who isn't the owner gets no decisions key, and Home draws nothing for it", () => {
  const k = home();
  try {
    k.draw(needs(undefined));
    assert.equal(k.group(), null);
    assert.equal(k.state.hd.decisions.hidden, true, "no empty slot either");
    assert.match(text(k.state.hd.needs), /^Nothing needs you right now\.$/);
    k.draw(null);  // a failed read, never having been shown decisions: no hint that any exist
    assert.equal(k.group(), null);
  } finally { k.done(); }
});

test("the owner's open decisions draw under the condition rows, and never enter the count or the badge's list", () => {
  const k = home();
  try {
    k.draw({ ...owner(), count: 1, items: [COND] });
    const section = k.state.hd.root.querySelector(".hd-needs");
    const kids = section.children;
    assert.ok(kids.indexOf(k.state.hd.needs) < kids.indexOf(k.state.hd.decisions), "after the conditions");
    assert.equal(k.state.hd.decisions.hidden, false);
    assert.equal(text(k.group().querySelector(".ui-decisions__title")), "Decisions (2)");
    assert.deepEqual(k.rows().map((r) => r.dataset.decision), ["a27-activity", "a30-listing"], "the hub's order");
    assert.equal(text(k.state.hd.needsCount), "1", "the count is the conditions alone");
    assert.deepEqual(k.state.probs.map((p) => p.id ?? p.key), ["x"], "the badge's list holds no decision");
    assert.match(text(k.state.hd.needs), /E-026: Send it/);
  } finally { k.done(); }
});

test("open decisions and no conditions: Needs you doesn't also say nothing needs you", () => {
  const k = home();
  try {
    k.draw(owner());
    assert.doesNotMatch(text(k.state.hd.needs), /Nothing needs you/);
    k.draw(owner([]));  // none open: nothing drawn, no empty group
    assert.equal(k.group(), null);
    assert.equal(k.state.hd.decisions.hidden, true);
    assert.match(text(k.state.hd.needs), /Nothing needs you right now/);
  } finally { k.done(); }
});

test("decisions: null is the hub failing to read them: the group says so, beside the hub's own item", () => {
  const k = home();
  try {
    const bad = { id: "pi:decisions:unreadable", source: "Pi Hub", tone: "bad", title: "Decisions can't be read", detail: "…" };
    k.draw(needs(null, [bad]));
    assert.equal(k.rows().length, 0);
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "Decisions couldn't be read");
    assert.equal(k.group().querySelector(".ui-decisions__status").dataset.kind, "error");
    assert.match(text(k.state.hd.needs), /Decisions can't be read/, "the unreadable item is listed as usual");
    k.draw(null);  // and a failed read after it has no rows to keep: still an error, never an empty list
    assert.equal(k.group().querySelector(".ui-decisions__status").dataset.kind, "error");
    assert.equal(k.rows().length, 0);
  } finally { k.done(); }
});

test("a failed /api/needs read keeps the last rows, marked not current; with none ever read it is an error", () => {
  const k = home();
  try {
    k.draw(owner());
    k.draw(null);
    assert.equal(k.rows().length, 2, "the last rows stay");
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "Not current: couldn't refresh the decisions");
    assert.equal(k.rows()[0].querySelector("button").disabled, false, "still answerable");
    k.draw(owner([D2]));  // read again: current, and the one answered elsewhere has gone
    assert.deepEqual(k.rows().map((r) => r.dataset.decision), ["a30-listing"]);
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "");
    k.draw(owner([]));
    k.draw(null);  // none open when last read: the failure is said, not shown as none
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "Decisions couldn't be read");
  } finally { k.done(); }
});

test("Home failing to reach the hub at all marks the decisions shown not current", async () => {
  const k = home();
  try {
    k.draw(owner());
    const { failed } = await import("../hub/static/js/now.js");
    const summary = k.env.document.createElement("p");
    failed({ ...k.state, summary });
    assert.equal(k.rows().length, 2);
    assert.equal(k.group().querySelector(".ui-decisions__status").dataset.kind, "stale");
    decisionsUnread({});  // no Home mounted: nothing to do, nothing thrown
  } finally { k.done(); }
});

test("a tap posts the answer once, and the row reads Recorded with the answer the hub holds", async () => {
  const k = home([json(200, { ok: true, recorded: true, decision: { ...D1, answered_at: 1795000000, answer: "System" } })]);
  try {
    k.draw(owner());
    const b = k.option("a27-activity", "System");
    b.click();
    b.click();  // a double tap: the kit holds the row while the first is pending
    assert.equal(k.rows()[0].dataset.state, "pending");
    await settle();
    assert.equal(k.posts.length, 1);
    assert.equal(k.posts[0].url, "/api/decisions/a27-activity/answer");
    assert.equal(k.posts[0].method, "POST");
    assert.deepEqual(k.posts[0].body, { answer: "System" });
    assert.deepEqual(k.rows().map((r) => r.dataset.decision), ["a30-listing"], "the answered row leaves, the other stays");
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "Recorded: System");
    assert.equal(text(k.group().querySelector(".ui-decisions__title")), "Decisions (1)");
  } finally { k.done(); }
});

test("a 200 that doesn't carry the stored answer is not taken as recorded", async () => {
  const k = home([json(200, { ok: true })]);
  try {
    k.draw(owner());
    k.option("a27-activity", "Home").click();
    await settle();
    assert.equal(k.rows().length, 2, "the row stays");
    assert.equal(k.rows()[0].dataset.state, "failed");
    assert.equal(text(k.rows()[0].querySelector(".ui-decision__note")), "Not recorded. Try again.");
  } finally { k.done(); }
});

test("409 answered elsewhere: the row leaves and the status says what was recorded", async () => {
  const k = home([json(409, { detail: "That decision already has a different answer.",
    decision: { ...D1, answered_at: 1795000000, answer: "Home" } })]);
  try {
    k.draw(owner());
    k.option("a27-activity", "System").click();
    await settle();
    assert.deepEqual(k.rows().map((r) => r.dataset.decision), ["a30-listing"]);
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "Recorded: Home", "the hub's answer, not the tap's");
    assert.equal(k.reloads(), 0);
  } finally { k.done(); }
});

test("409 question changed: nothing is recorded, Home reads the group again and draws the question as it is now", async () => {
  const changed = { ...D1, question: "Where does Activity live now?", options: ["System", "Home", "Workshop"] };
  const k = home([json(409, { detail: "Not recorded: the question changed. Read it again.", decision: changed })]);
  try {
    k.draw(owner());
    k.option("a27-activity", "System").click();
    await settle();
    assert.equal(k.rows().length, 2, "the row stays");
    assert.equal(k.rows()[0].dataset.state, "failed");
    assert.equal(k.reloads(), 1, "read again");
    k.draw(owner([changed, D2]));  // what the reload draws
    assert.equal(text(k.rows()[0].querySelector(".ui-decision__q")), "Where does Activity live now?");
    assert.equal(k.rows()[0].querySelectorAll("button").length, 3);
    assert.equal(k.rows()[0].dataset.state, "open");
  } finally { k.done(); }
});

test("404, 401, 403, 5xx and a network error keep the row and say it wasn't recorded", async () => {
  for (const reply of [json(404, { detail: "There is no such decision." }), json(401, { detail: "Sign in" }),
    json(403, { detail: "This answer has to come from the hub's own page." }), json(500, { detail: "boom" }),
    json(503, { detail: "Not recorded: decisions can't be written. Try again." }), new TypeError("Failed to fetch"),
    json(409, { detail: "odd", decision: { ...D2, answered_at: 1, answer: "Yes" } })]) {  // a 409 about another id
    const k = home([reply]);
    try {
      k.draw(owner());
      k.option("a27-activity", "System").click();
      await settle();
      const where = reply instanceof Error ? "network" : String(reply.status);
      assert.equal(k.rows().length, 2, `${where}: the row stays`);
      assert.equal(k.rows()[0].dataset.state, "failed", where);
      assert.equal(text(k.rows()[0].querySelector(".ui-decision__note")), "Not recorded. Try again.", where);
      assert.equal(k.reloads(), 0, where);
    } finally { k.done(); }
  }
});

test("a refresh during an answer keeps the pending row, and a read from before the write doesn't bring it back", async () => {
  let reply;
  const k = home([new Promise((r) => { reply = r; })]);
  try {
    k.draw(owner());
    const node = k.group();
    k.option("a27-activity", "System").click();
    k.draw(owner());  // the 15 s refresh lands while the POST is out
    assert.equal(k.group(), node, "the same group, not a redraw");
    assert.equal(k.rows()[0].dataset.state, "pending");
    reply(json(200, { ok: true, recorded: true, decision: { ...D1, answered_at: 1795000000, answer: "System" } }));
    await settle();
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "Recorded: System");
    k.draw(owner());  // a read that left before the write landed still lists it open
    assert.deepEqual(k.rows().map((r) => r.dataset.decision), ["a30-listing"]);
  } finally { k.done(); }
});

test("a refresh with nothing changed leaves the group alone: a half-written answer and a failed note stay", async () => {
  const T = { id: "a28-print-route", kind: "text", question: "Which print route?", options: [], answered_at: null };
  const k = home([json(500, { detail: "boom" })]);
  try {
    k.draw(owner([D1, T]));
    const node = k.group();
    k.option("a27-activity", "System").click();
    await settle();
    k.state.hd.decisions.querySelector("textarea").value = "The Pi's own";
    k.draw(owner([D1, T]));
    assert.equal(k.group(), node);
    assert.equal(k.state.hd.decisions.querySelector("textarea").value, "The Pi's own");
    assert.equal(k.rows()[0].dataset.state, "failed");
  } finally { k.done(); }
});

// UI review, 23 Nov: after one answer was recorded, the next 15 s read (which no longer lists it) redrew the group and
// wiped the other rows' "Not recorded" note, the "Recorded" line and a half-written answer.
test("a recorded answer alone never redraws the rest: the next read keeps a failed note, the status and typed text", async () => {
  const T = { id: "a28-print-route", kind: "text", question: "Which print route?", options: [], answered_at: null };
  const k = home([json(200, { ok: true, recorded: true, decision: { ...D1, answered_at: 1795000000, answer: "System" } }),
    json(500, { detail: "boom" })]);
  try {
    k.draw(owner([D1, D2, T]));
    const node = k.group();
    k.option("a27-activity", "System").click();
    await settle();
    k.option("a30-listing", "Yes").click();
    await settle();
    k.state.hd.decisions.querySelector("textarea").value = "The Pi's own";
    k.draw(owner([D2, T]));  // the next poll: the hub no longer lists the recorded one
    assert.equal(k.group(), node, "not redrawn");
    assert.equal(text(k.group().querySelector(".ui-decisions__status")), "Recorded: System");
    assert.equal(text(k.rows()[0].querySelector(".ui-decision__note")), "Not recorded. Try again.");
    assert.equal(k.state.hd.decisions.querySelector("textarea").value, "The Pi's own");
    k.draw(owner([D2, T, { ...D1, id: "a31-new", question: "A new one?" }]));  // a new decision still draws
    assert.notEqual(k.group(), node);
    assert.equal(k.rows().length, 3);
  } finally { k.done(); }
});

// UI re-review, 23 Nov: dropping the group on the next read sent focus to the heading, above the screen.
test("answering the last decision by keyboard: the next read keeps the group while focus is in it, then drops it", async () => {
  const k = home([json(200, { ok: true, recorded: true, decision: { ...D2, answered_at: 1795000000, answer: "Yes" } })]);
  try {
    k.draw(owner([D2]));
    const b = k.option("a30-listing", "Yes");
    b.focus();
    b.click();
    await settle();
    const node = k.group();
    assert.ok(node.contains(document.activeElement), "the kit puts focus on the group's status line");
    k.draw(owner([]));  // Home's next read: nothing open
    assert.equal(k.group(), node, "kept while focus is in it");
    assert.ok(node.contains(document.activeElement), "focus stays where the kit put it");
    assert.equal(text(node.querySelector(".ui-decisions__status")), "Recorded: Yes");
    k.state.hd.root.querySelector(".hd-unit__go").focus();  // the owner moves on
    k.draw(owner([]));
    assert.equal(k.group(), null, "the first read after focus left drops it");
    assert.equal(k.state.hd.decisions.hidden, true);
    assert.equal(document.activeElement, k.state.hd.root.querySelector(".hd-unit__go"), "focus is left alone");
  } finally { k.done(); }
});

test("any other removal with focus inside moves focus to the Needs you heading and brings it into view", () => {
  const k = home();
  try {
    k.draw(owner([D2]));
    k.option("a30-listing", "Yes").focus();
    const heading = k.state.hd.root.querySelector("#hd-needs-h");
    const scrolls = [];
    heading.scrollIntoView = (o) => scrolls.push(o);
    k.draw(needs(undefined));  // signed out since: the group goes from under the focused button
    assert.equal(k.group(), null);
    assert.equal(document.activeElement, heading);
    assert.equal(heading.getAttribute("tabindex"), "-1");
    assert.deepEqual(scrolls, [{ block: "nearest", behavior: "instant" }], "into view, never a smooth scroll");
  } finally { k.done(); }
});

test("focus on a decision button survives a redraw by its place, not the heading", () => {
  const k = home();
  try {
    k.draw(owner([D1, D2]));
    k.option("a30-listing", "Yes").focus();
    k.draw(owner([D1, { ...D2, question: "List A30 in the baseline now?" }]));  // asked again: redrawn
    assert.equal(document.activeElement, k.option("a30-listing", "Yes"));
  } finally { k.done(); }
});

test("a spec link may go to the hub's hosts or github.com, and nowhere else", () => {
  const k = home();
  try {
    const elsewhere = { ...D2, link: "https://example.com/plan" };
    k.draw(owner([D1, elsewhere]));
    const a = k.rows()[0].querySelector("a");
    assert.equal(a.getAttribute("href"), "https://github.com/azmusgb/pi-hub/pull/305");
    assert.equal(a.target, "_blank");
    assert.equal(a.rel, "noopener noreferrer");
    assert.equal(k.rows()[1].querySelector("a"), null, "an unlisted host draws no link");
    assert.deepEqual(LINK_ORIGINS, ["https://hub.rahe-home.duckdns.org", "https://assistant.rahe-home.duckdns.org", "https://github.com"]);
  } finally { k.done(); }
});

test("decisionsView: absent is nothing, null is error, a failure is stale or error, never an empty list", () => {
  const ds = decisionsState();
  assert.equal(decisionsView(ds, null), null, "never the owner: nothing");
  assert.equal(decisionsView(ds, needs(undefined)), null);
  assert.deepEqual(decisionsView(ds, needs(null)), { list: [], state: "error" });
  assert.deepEqual(decisionsView(ds, null), { list: [], state: "stale" }, "the kit reads stale with no rows as error");
  assert.deepEqual(decisionsView(ds, owner([D1])), { list: [D1], state: "" });
  assert.deepEqual(decisionsView(ds, null), { list: [D1], state: "stale" });
  assert.deepEqual(decisionsView(ds, needs({ open: "x" })), { list: [], state: "error" }, "an unreadable shape is an error");
  assert.equal(decisionsView(ds, needs(undefined)), null, "signed out since: nothing kept");
  assert.equal(decisionsView(ds, null), null);
});

test("answerDecision rejects what it can't read as recorded", async () => {
  const ds = decisionsState();
  const fail = (status, body) => async () => { const e = new Error("x"); e.status = status; e.body = body; throw e; };
  await assert.rejects(answerDecision(ds, "a27-activity", "System", null, fail(500, { detail: "boom" })));
  await assert.rejects(answerDecision(ds, "a27-activity", "System", null, fail(409, { detail: "no decision" })));
  assert.equal(await answerDecision(ds, "a27-activity", "System", null, async () => ({ ok: true, decision: { ...D1 } })), false,
    "a 200 with an unanswered row");
  assert.equal(ds.busy, 0);
  assert.equal(ds.recorded.size, 0);
});
