import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CLIP_DB, FALL_DB_PER_S, FLOOR_DB, HOLD_MS, Meter, fill, toDb } from "../src/audio/meter.ts";

describe("the master meter", () => {
  test("dB: full scale 0, half 'minus 6', silence is the floor", () => {
    assert.equal(toDb(1), 0);
    assert.ok(Math.abs(toDb(0.5) + 6.0206) < 1e-3);
    assert.equal(toDb(0), FLOOR_DB);
    assert.equal(toDb(1e-9), FLOOR_DB);
    assert.equal(toDb(NaN), FLOOR_DB);
  });
  test("fill: 0 at the floor, 1 at full scale, rising, and the top 18 dB get more than a third of the height", () => {
    assert.equal(fill(FLOOR_DB), 0);
    assert.equal(fill(0), 1);
    assert.ok(fill(-30) > fill(-40) && fill(-6) > fill(-12));
    assert.ok(1 - fill(-18) > 0.33, String(1 - fill(-18)));
    assert.equal(fill(10), 1);
    assert.equal(fill(-100), 0);
  });
  test("attack is instant and the fall is steady, not instant", () => {
    const m = new Meter();
    m.update(0.5, 0.25, 16);
    assert.ok(Math.abs(m.view.fill[0] - fill(toDb(0.5))) < 1e-9);
    m.update(0, 0, 500); // half a second of silence: it has fallen 12 dB, not to the floor
    const left = m.view.fill[0];
    assert.ok(left < fill(toDb(0.5)) && left > fill(toDb(0.5) - FALL_DB_PER_S * 0.5 - 0.01) - 1e-9 && left > 0.2, String(left));
  });
  test("the highest peak is held, then follows the level down after the hold time", () => {
    const m = new Meter();
    m.update(0.8, 0.8, 16);
    const held = m.view.holdDb as number;
    assert.ok(Math.abs(held - toDb(0.8)) < 1e-6);
    for (let t = 0; t < HOLD_MS - 100; t += 100) m.update(0.01, 0.01, 100);
    assert.ok(Math.abs((m.view.holdDb as number) - held) < 1e-6, "still held");
    for (let t = 0; t < 600; t += 100) m.update(0.01, 0.01, 100);
    assert.ok((m.view.holdDb as number) < held - 6, "released");
  });
  test("nothing heard: no number; a peak at the clip level lights CLIP for a while", () => {
    const m = new Meter();
    assert.equal(m.view.holdDb, null);
    assert.equal(m.view.clipping, false);
    m.update(10 ** (CLIP_DB / 20), 0.1, 16);
    assert.equal(m.view.clipping, true);
    for (let t = 0; t < 2000; t += 100) m.update(0.1, 0.1, 100);
    assert.equal(m.view.clipping, true, "held 2.5 s");
    for (let t = 0; t < 1000; t += 100) m.update(0.1, 0.1, 100);
    assert.equal(m.view.clipping, false);
  });
  test("a long gap between frames (a hidden tab) is limited, and reset empties it", () => {
    const m = new Meter();
    m.update(1, 1, 16);
    m.update(0, 0, 60_000);
    assert.ok(m.view.fill[0] > 0, "the gap counts for at most half a second of fall");
    m.reset();
    assert.equal(m.view.holdDb, null);
    assert.equal(m.view.fill[0], 0);
  });
});
