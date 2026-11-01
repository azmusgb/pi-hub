import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../hub/static/js/core.js";
import { pairState, minutesText, pairError } from "../hub/static/js/display-pair.js";

test("not paired", () => {
  assert.deepEqual(pairState({ paired: false, code_open: false }, null, 1000), { kind: "idle", label: "Not paired" });
});

test("code showing with minutes left, rounded up", () => {
  const s = pairState({ paired: false, code_open: true }, { code: "123456", expires: 1000 + 541 }, 1000);
  assert.equal(s.kind, "code");
  assert.equal(s.code, "123456");
  assert.equal(s.minutesLeft, 10);
  assert.equal(s.label, "Type this on the display · 10 min left");
});

test("code that ran out falls back", () => {
  assert.equal(pairState({ paired: false, code_open: true }, { code: "123456", expires: 999 }, 1000).kind, "idle");
  assert.equal(pairState({ paired: false, code_open: false }, { code: "123456", expires: 5000 }, 1000).kind, "idle");
});

test("paired shows the date; a fresh code wins over paired", () => {
  const p = pairState({ paired: true, paired_at: 1761868800, code_open: false }, null, 1761900000);
  assert.equal(p.kind, "paired");
  assert.match(p.label, /^Paired /);
  assert.equal(pairState({ paired: true, paired_at: 1, code_open: true }, { code: "654321", expires: 2000 }, 1000).kind, "code");
});

test("minutesText and error copy", () => {
  assert.equal(minutesText(1), "1 min left");
  assert.equal(minutesText(0), "Under a minute left");
  assert.match(pairError({ status: 403 }), /owner/i);
  assert.match(pairError(new Error("x")), /Couldn't/);
});

test("pairError shows the owner-only copy for an error thrown by the real api()", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Owner only" }), { status: 403, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(api("/api/display/pair/start", { method: "POST" }), (e) => {
      assert.equal(e.status, 403);
      assert.match(pairError(e), /Only the owner/);
      return true;
    });
  } finally { globalThis.fetch = realFetch; }
});
