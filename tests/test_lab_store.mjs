import assert from "node:assert/strict";
import { attachLabStore, createLabStore, LAB_PHASE } from "../hub/static/js/lab-store.js";

const scheduled = [];
const store = createLabStore({}, (fn) => scheduled.push(fn));
const seen = [];
store.subscribe((snapshot) => seen.push(snapshot));

assert.equal(store.snapshot().phase, LAB_PHASE.BOOTING);
store.markLoading();
store.setRequests([{ id: "rq-1" }]);
store.setData({ index: { project: "hex-tile" } });
assert.equal(scheduled.length, 1, "several synchronous state changes coalesce into one render notification");
scheduled.shift()();
assert.equal(seen.length, 1);
assert.equal(seen[0].phase, LAB_PHASE.READY);
assert.equal(seen[0].requests.length, 1);
assert.equal(seen[0].data.index.project, "hex-tile");

store.markAuthRequired({ status: 401 });
assert.equal(scheduled.length, 1);
scheduled.shift()();
assert.equal(seen.at(-1).phase, LAB_PHASE.AUTH_REQUIRED);
assert.equal(seen.at(-1).error.status, 401);

store.markDegraded(new Error("stale"));
scheduled.shift()();
assert.equal(seen.at(-1).phase, LAB_PHASE.DEGRADED);
store.markOffline(new Error("offline"));
scheduled.shift()();
assert.equal(seen.at(-1).phase, LAB_PHASE.OFFLINE);
store.markError(new Error("boom"));
scheduled.shift()();
assert.equal(seen.at(-1).phase, LAB_PHASE.ERROR);
store.markEmpty();
scheduled.shift()();
assert.equal(seen.at(-1).phase, LAB_PHASE.EMPTY);
assert.throws(() => store.transition("invented"), /Unknown Print Lab phase/);

const stateScheduled = [];
const state = { currentData: null, currentRequests: [] };
const attached = attachLabStore(state, (fn) => stateScheduled.push(fn));
assert.equal(attached.snapshot().phase, LAB_PHASE.LOADING);
state.currentRequests = [{ id: "rq-2" }];
state.currentData = { index: { project: "rift" } };
assert.equal(stateScheduled.length, 1, "legacy assignments are one store transaction to subscribers");
stateScheduled.shift()();
assert.equal(attached.snapshot().phase, LAB_PHASE.READY);
assert.equal(state.currentData.index.project, "rift");
assert.equal(state.currentRequests[0].id, "rq-2");
assert.equal(attachLabStore(state), attached, "attaching twice is idempotent");

console.log("lab-store: ok");
