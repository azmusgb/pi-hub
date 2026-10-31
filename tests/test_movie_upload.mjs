// Add a movie (movie-upload.js): the form's guess matches the hub's, and a dropped piece resumes from the hub's offset.
import test from "node:test";
import assert from "node:assert/strict";
import { guessTitle, formatBytes, sendFile } from "../hub/static/js/movie-upload.js";

test("title and year are guessed like the hub does", () => {
  assert.deepEqual(guessTitle("PAW Patrol The Dino Movie 2026 1080p WEB-DL HEVC x265 5.1 BONE.mkv"), { title: "PAW Patrol The Dino Movie", year: 2026 });
  assert.deepEqual(guessTitle("Bad.Boys.for.Life.2020.mkv"), { title: "Bad Boys for Life", year: 2020 });
  assert.deepEqual(guessTitle("home video.mp4"), { title: "home video", year: null });
  assert.equal(formatBytes(1713434407), "1.6 GB");
});

test("a dropped piece is retried and an out-of-step answer resumes from the hub's offset", async () => {
  const file = new Blob([new Uint8Array(25)]);
  const calls = [];
  let hubHas = 0, failOnce = true;
  globalThis.fetch = async (url, opts) => {
    const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
    calls.push(offset);
    if (failOnce && offset === 10) { failOnce = false; throw new TypeError("network dropped"); }
    if (offset !== hubHas) return new Response(JSON.stringify({ offset: hubHas }), { status: 409 });
    hubHas += (await opts.body.arrayBuffer()).byteLength;
    return new Response(JSON.stringify({ offset: hubHas, done: hubHas === 25, final: "X (2020).mkv" }), { status: 200 });
  };
  const seen = [];
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);  // no real back-off pauses in the test
  try {
    const done = await sendFile({ id: "0123456789abcdef", offset: 0, chunk: 10 }, file, { onProgress: (s) => seen.push(s) });
    assert.equal(done.done, true);
    assert.deepEqual(calls, [0, 10, 10, 20]);
    assert.deepEqual(seen, [10, 20, 25]);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

test("a refusal (4xx) stops at once instead of retrying", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "already in the library" }), { status: 409 });
  await assert.rejects(sendFile({ id: "a".repeat(16), offset: 0, chunk: 10 }, new Blob([new Uint8Array(5)])), /already in the library/);
});
