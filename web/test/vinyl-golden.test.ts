// The record reader (core/vinyl.ts) with loops and smooth seeks OFF must be exactly what it was before they existed: the game's
// booth and the Swift twin read records this way. A busy scenario is rendered and fingerprinted (sha256 of every output sample).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { newDeckShared, renderVinyl } from "../src/core/vinyl.ts";

/** Speed changes, stops, a needle drop, a spin back, a pitch step, blocks of odd sizes. */
export function scenario(): string {
  const frames = 60000, l = new Float32Array(frames), r = new Float32Array(frames);
  let seed = 5;
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    l[i] = 0.5 * Math.sin(i * 0.031) + 0.2 * Math.sin(i * 0.173) + ((seed / 4294967296) - 0.5) * 0.05;
    r[i] = 0.4 * Math.sin(i * 0.029 + 1) + ((seed / 4294967296) - 0.5) * 0.05;
  }
  const s = newDeckShared();
  s.left = l; s.right = r; s.frames = frames; s.gain = 1; s.targetGain = 1; s.position = 100; s.step = 44100 / 48000;
  const h = createHash("sha256");
  const out = (n: number) => { const a = new Float32Array(n), b = new Float32Array(n); renderVinyl(s, a, b, n); h.update(Buffer.from(a.buffer)); h.update(Buffer.from(b.buffer)); };
  const steps: [() => void, number][] = [
    [() => { s.targetRate = 1; s.glide = 0.002; }, 5000], [() => {}, 3333], [() => { s.targetRate = 1.04; }, 4001],
    [() => { s.seekTo = 20000; }, 2500], [() => { s.targetRate = 0; s.glide = 0.01; }, 3000], [() => { s.targetRate = -1.5; s.glide = 0.05; }, 4000],
    [() => { s.targetRate = 1; s.glide = 0.002; }, 6000], [() => { s.targetGain = 0; }, 800], [() => { s.targetGain = 1; s.seekTo = 55000; }, 9000],
  ];
  for (const [act, n] of steps) { act(); let left = n; while (left > 0) { const k = Math.min(left, 128 + (left % 7)); out(k); left -= k; } }
  return h.digest("hex");
}

describe("the record reader with loops off", () => {
  test("its output is bit for bit what it was before loops and smooth seeks existed", () => {
    assert.equal(scenario(), "5d8505a10a082a65aa29b93708bd2c2b3a582ffcd4620bb9b6a9bd1576b80589");
  });
});
