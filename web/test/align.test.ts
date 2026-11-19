// TWO DEVICES: the room's wait must not follow the latency readings' jitter (audio/align.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEAD_BAND, RoomAlignment, rampSeconds } from "../src/audio/align.ts";

/** Latency readings like a sound card's: a steady value with jumps of tens of milliseconds (measured here: 44, 51, 32, 29, 16, 27, 29, 30 ms). */
const jittery = (base: number, spread: number, n: number, seed = 3): number[] => {
  let s = seed;
  return Array.from({ length: n }, () => base + (((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1) * spread);
};

describe("the room's wait", () => {
  test("nothing is applied for the first few readings; then it is set once", () => {
    const a = new RoomAlignment();
    for (let i = 0; i < 7; i++) assert.equal(a.read(0.03, 0.05, 0), null);
    const first = a.read(0.03, 0.05, 0);
    assert.ok(first !== null && Math.abs(first - 0.02) < 1e-9, String(first));
    assert.equal(a.applied, first);
  });

  test("jitter in the readings leaves it alone: ten minutes of readings that jump by +-14 ms change it at most twice (the old code: on every reading)", () => {
    const room = jittery(0.035, 0.014, 600), phones = jittery(0.055, 0.014, 600, 9);
    const a = new RoomAlignment();
    let changes = 0;
    for (let i = 0; i < 600; i++) if (a.read(room[i], phones[i], 0) !== null) changes++;
    assert.ok(changes >= 1 && changes <= 2, `${changes} changes`);
    assert.ok(Math.abs((a.applied ?? 0) - 0.02) < 0.012, String(a.applied));
  });

  test("one wild reading (a spike) is ignored", () => {
    const a = new RoomAlignment();
    for (let i = 0; i < 12; i++) a.read(0.03, 0.05, 0);
    assert.equal(a.read(0.2, 0.05, 0), null);
    assert.equal(a.read(0.03, 0.05, 0), null);
  });

  test("a real change (a different card, a bigger buffer) is followed, once, and not for a small one", () => {
    const a = new RoomAlignment();
    for (let i = 0; i < 12; i++) a.read(0.03, 0.05, 0);
    let changes = 0, last: number | null = null;
    for (let i = 0; i < 40; i++) { const c = a.read(0.03, 0.05 + DEAD_BAND * 0.8, 0); if (c !== null) { changes++; last = c; } }
    assert.equal(changes, 0, "a shift inside the dead band is left alone");
    for (let i = 0; i < 60; i++) { const c = a.read(0.03, 0.05 + 0.06, 0); if (c !== null) { changes++; last = c; } }
    assert.equal(changes, 1);
    assert.ok(Math.abs(last! - 0.08) < 0.005, String(last));
  });

  test("the trim moved by hand is followed at once, even a few milliseconds; a negative sum is held at zero", () => {
    const a = new RoomAlignment();
    for (let i = 0; i < 12; i++) a.read(0.03, 0.05, 0);
    const c = a.read(0.03, 0.05, 0.004, true);
    assert.ok(c !== null && Math.abs(c - 0.024) < 1e-9, String(c));
    const b = new RoomAlignment();
    for (let i = 0; i < 12; i++) b.read(0.05, 0.03, 0);
    assert.equal(b.applied, 0);
    assert.ok(b.diff < 0, "the headphones are the faster ones: the panel can say so");
  });

  test("reset forgets everything", () => {
    const a = new RoomAlignment();
    for (let i = 0; i < 12; i++) a.read(0.03, 0.05, 0);
    a.reset();
    assert.equal(a.applied, null);
    assert.equal(a.read(0.03, 0.05, 0), null);
  });
});

describe("how fast the room moves", () => {
  test("slowly enough to be inaudible (half a percent at most), and quickly for the hand", () => {
    for (const delta of [0.015, 0.03, 0.1, 0.4]) {
      const seconds = rampSeconds(0, delta, false);
      assert.ok(delta / seconds <= 0.0051, `${delta} s in ${seconds} s is a ${(100 * delta / seconds).toFixed(2)} % pitch change`);
    }
    assert.ok(rampSeconds(0, 0.015, false) >= 2);
    assert.equal(rampSeconds(0, 0.1, true), 0.35);
  });
});
