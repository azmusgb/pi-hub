// Acknowledging a printer alert from Needs you (POST /api/needs/ack). The kit draws the button from 2.28 (an item with
// `ack`, in a list given onAck); the hub decides who is offered it and does the write. Anything but the hub's own
// "ok" is "not acknowledged": the kit then keeps the row.
import test from "node:test";
import assert from "node:assert/strict";
import { ackNeed, mergeProblems, problemItems } from "../hub/static/js/control-room.js";
import { printerAlerts } from "../hub/static/js/workshop.js";

const ID = "pi:source:hms:0x2000b";
const HMS = { id: ID, source: "Pi Hub", tone: "bad", title: "Printer needs attention (0x2000b)", detail: "Alert 0x2000b.",
  link: "/workshop", record: "hms", about: "printer", ack: true };
const DRIVE = { id: "pi:Movies drive", source: "Pi Hub", tone: "warn", title: "Movies drive", detail: "Not mounted",
  link: "/drives", record: "movies_drive" };
const asOwner = { count: 2, unread: [], items: [HMS, DRIVE], decisions: { open: [], answered: [] } };
const asAnyone = { count: 2, unread: [], items: [HMS, DRIVE] };
const tick = () => new Promise((r) => setTimeout(r, 5));
const failure = (status) => Object.assign(new Error(`The hub answered ${status}.`), { status });

test("the hub's ok acknowledges: true, the id is posted once, and the list is read again", async () => {
  const sent = [];
  let reloads = 0;
  const got = await ackNeed(ID, () => { reloads += 1; }, async (path, body) => { sent.push([path, body]); return { ok: true, say: "Acknowledged." }; });
  assert.equal(got, true);
  assert.deepEqual(sent, [["/api/needs/ack", { id: ID }]]);
  assert.equal(reloads, 0, "the reload waits for the kit to take the row out");
  await tick();
  assert.equal(reloads, 1);
});

test("a refusal or an error from the hub is not acknowledged, and nothing is read again", async () => {
  for (const status of [400, 401, 409, 500, 503]) {
    let reloads = 0;
    assert.equal(await ackNeed(ID, () => { reloads += 1; }, async () => { throw failure(status); }), false, String(status));
    await tick();
    assert.equal(reloads, 0, String(status));
  }
});

test("no answer from the hub is not acknowledged", async () => {
  let reloads = 0;
  const down = async () => { throw new Error("The hub could not be reached."); };
  assert.equal(await ackNeed(ID, () => { reloads += 1; }, down), false);
  await tick();
  assert.equal(reloads, 0);
});

test("an answer that doesn't say ok is not acknowledged", async () => {
  for (const body of [null, undefined, "", {}, { ok: false }, { ok: "yes" }]) {
    assert.equal(await ackNeed(ID, null, async () => body), false, JSON.stringify(body));
  }
});

test("acknowledging with no reload to call still resolves", async () => {
  assert.equal(await ackNeed(ID, undefined, async () => ({ ok: true })), true);
  await tick();
});

test("only the owner's list offers Acknowledge, and only on the printer alert", () => {
  const owner = Object.fromEntries(problemItems(mergeProblems([], asOwner)).map((i) => [i.id, i]));
  assert.equal(owner[ID].ack, true);
  assert.equal(owner["pi:Movies drive"].ack, undefined);
  const anyone = problemItems(mergeProblems([], asAnyone));
  assert.deepEqual(anyone.map((i) => i.ack), [undefined, undefined], "nobody else is drawn a button the hub would refuse");
  const odd = problemItems(mergeProblems([], { ...asOwner, items: [{ ...DRIVE, ack: "true" }] }));
  assert.equal(odd[0].ack, undefined, "only the hub's own true");
});

test("the Workshop's alert rows carry it too", () => {
  const [alert] = printerAlerts([], asOwner);
  assert.equal(alert.id, ID);
  assert.equal(alert.item.ack, true);
  assert.equal(printerAlerts([], asAnyone)[0].item.ack, undefined);
});
