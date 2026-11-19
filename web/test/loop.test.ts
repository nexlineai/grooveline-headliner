// Loops and smooth seeks in the record reader (core/vinyl.ts, web only).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { newDeckShared, renderVinyl } from "../src/core/vinyl.ts";
import type { DeckShared } from "../src/core/vinyl.ts";

/** A deck holding `data` on both channels, turning at normal speed, no run-up. */
function deck(data: Float32Array): DeckShared {
  const s = newDeckShared();
  s.left = data; s.right = data; s.frames = data.length; s.gain = 1; s.targetGain = 1; s.rate = 1; s.targetRate = 1; s.glide = 1; s.step = 1;
  return s;
}
const render = (s: DeckShared, n: number, block = 128): Float32Array => {
  const out = new Float32Array(n);
  for (let at = 0; at < n; at += block) { const k = Math.min(block, n - at), a = new Float32Array(k), b = new Float32Array(k); renderVinyl(s, a, b, k); out.set(a, at); }
  return out;
};
const sine = (n: number, period: number, amp = 0.8) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * i / period));
const maxStep = (x: Float32Array, from = 1, to = x.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };

describe("a loop", () => {
  test("the needle goes back to the loop's start to the frame, not at block edges", () => {
    const s = deck(Float32Array.from({ length: 40000 }, (_, i) => i / 40000));
    s.position = 900; s.loopStart = 1000; s.loopEnd = 2000;
    for (const [frames, block] of [[1500, 128], [3333, 97], [12345, 512], [777, 1]] as const) {
      s.position = 900; s.rate = 1;
      render(s, frames, block);
      const expected = 1000 + ((900 + frames - 1000) % 1000);
      assert.ok(Math.abs(s.position - expected) < 1e-6, `after ${frames} frames (blocks of ${block}): ${s.position} vs ${expected}`);
    }
  });

  test("away from the seam the sound is the record's own; inside the loop it repeats exactly", () => {
    const data = Float32Array.from({ length: 30000 }, (_, i) => Math.sin(i * 0.05) * 0.5 + i / 100000);
    const s = deck(data);
    s.position = 1999 - 1500; s.loopStart = 1000; s.loopEnd = 3000; // starts 500 before the loop
    const out = render(s, 6000);
    // Frames 2..400 are before the loop start: the record itself (the reader runs one frame ahead of `position`).
    for (let n = 2; n < 400; n++) assert.ok(Math.abs(out[n] - data[499 + 1 + n]) < 1e-4, `frame ${n}`);
    // One loop later (2000 frames), away from the seam, the same sample comes out again.
    for (const n of [1200, 1500, 1900]) assert.ok(Math.abs(out[n] - out[n + 2000]) < 1e-4, `loop repeat at ${n}`);
  });

  test("the seam does not click: a sine whose period does not divide the loop passes the wrap with steps no bigger than its own", () => {
    const period = 211.3, s = deck(sine(60000, period));
    s.position = 3000; s.loopStart = 5000; s.loopEnd = 5000 + 4096;
    const out = render(s, 40000);
    const natural = 0.8 * 2 * Math.PI / period;
    assert.ok(maxStep(out) < 2.5 * natural, `largest step ${maxStep(out).toFixed(4)}, a sine's own ${natural.toFixed(4)}`);
  });

  test("backwards: the needle stays in the loop, wrapping from the start to the end", () => {
    const s = deck(sine(40000, 100));
    s.position = 3000; s.rate = -1; s.targetRate = -1; s.loopStart = 1000; s.loopEnd = 2000;
    for (let k = 0; k < 40; k++) { render(s, 333); assert.ok(s.position >= 1000 - 1e-6 && s.position <= 2000 + 1e-6 || k < 8, `block ${k}: ${s.position}`); }
    assert.ok(s.position >= 1000 && s.position <= 2000);
  });

  test("off means off: zeros, or an end before the start, change nothing (also when it is set but the end is past the record)", () => {
    const data = sine(20000, 77);
    const a = deck(data), b = deck(data), c = deck(data);
    b.loopStart = 5000; b.loopEnd = 4000; // inverted: not a loop
    c.loopStart = 1000; c.loopEnd = 5; // tiny: not a loop
    for (const s of [a, b, c]) s.position = 800;
    const x = render(a, 9000), y = render(b, 9000), z = render(c, 9000);
    assert.deepEqual([...y], [...x]);
    assert.deepEqual([...z], [...x]);
    const d = deck(data); d.position = 100; d.loopStart = 10000; d.loopEnd = 90000; // past the end of the record: held at its last frame
    assert.doesNotThrow(() => render(d, 30000));
    assert.ok(d.position <= 20000);
  });
});

describe("a needle drop while the record turns (smooth seek)", () => {
  test("without it the output jumps; with it the step across the drop is no bigger than the sine's own", () => {
    const period = 150, natural = 0.8 * 2 * Math.PI / period;
    const jump = (smooth: number): number => {
      const s = deck(sine(80000, period));
      s.position = 1000; s.smoothSeek = smooth;
      const before = render(s, 500);
      s.seekTo = 30000 + 37; // a place at another phase of the sine
      const after = render(s, 600);
      const both = new Float32Array(1 + after.length);
      both[0] = before[before.length - 1]; both.set(after, 1); // the step INTO the drop counts too
      return maxStep(both, 1);
    };
    assert.ok(jump(0) > 4 * natural, `a hard jump: ${jump(0).toFixed(3)}`);
    assert.ok(jump(64) < 3 * natural, `smoothed: ${jump(64).toFixed(3)} against ${natural.toFixed(3)}`);
  });

  test("it arrives where it was told (the crossfade ends on the new place) and a stopped record just jumps", () => {
    const s = deck(Float32Array.from({ length: 50000 }, (_, i) => i / 50000));
    s.position = 1000; s.smoothSeek = 64;
    render(s, 300);
    s.seekTo = 25000;
    const out = render(s, 400);
    assert.ok(Math.abs(out[399] - (25000 + 400) / 50000) < 0.01);
    const t = deck(Float32Array.from({ length: 50000 }, (_, i) => i / 50000));
    t.position = 1000; t.rate = 0; t.targetRate = 0; t.smoothSeek = 64; t.seekTo = 25000;
    renderVinyl(t, new Float32Array(10), new Float32Array(10), 10);
    assert.ok(Math.abs(t.position - 25000) < 1e-6);
    assert.equal(t.xfade, 0, "no crossfade for a record that is not turning");
  });
});
