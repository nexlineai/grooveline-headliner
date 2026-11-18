// The web's master section (audio/fx.ts): headphones level now, the effects below as they come.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MasterSection, PHONES_UNITY, phonesGainFor, softClip } from "../src/audio/fx.ts";

const buf = (n: number, v: number) => new Float32Array(n).fill(v);
const db = (g: number) => 20 * Math.log10(g);

describe("headphones level", () => {
  test("unity at the default knob position, a little boost at the top, silence at the bottom", () => {
    assert.ok(Math.abs(phonesGainFor(PHONES_UNITY) - 1) < 1e-9);
    assert.ok(Math.abs(db(phonesGainFor(1)) - 6) < 1e-9);
    assert.equal(phonesGainFor(0), 0);
    assert.equal(phonesGainFor(0.02), 0);
    assert.ok(phonesGainFor(0.05) > 0 && phonesGainFor(0.05) < 0.01);
    assert.ok(phonesGainFor(0.35) < phonesGainFor(0.5) && phonesGainFor(0.5) < phonesGainFor(0.69));
    assert.ok(Math.abs(db(phonesGainFor(0.35)) + 30) < 1e-9); // halfway down = -30 dB
  });

  test("the soft knee leaves ordinary levels alone and never goes past 1", () => {
    assert.equal(softClip(0.5), 0.5);
    assert.equal(softClip(-0.9), -0.9);
    assert.ok(softClip(1.5) <= 1 && softClip(1.5) > 0.9);
    assert.ok(softClip(-3) >= -1);
    assert.ok(softClip(1.2) > softClip(1.0));
  });

  test("at the default level nothing is touched", () => {
    const m = new MasterSection();
    const l = buf(128, 0.5), r = buf(128, 0.25), pl = buf(128, 0.3), pr = buf(128, 0.2);
    m.process(l, r, pl, pr, false, 0, 128);
    assert.ok(l.every((x) => x === 0.5) && r.every((x) => x === 0.25) && pl.every((x) => Math.abs(x - 0.3) < 1e-7) && pr.every((x) => Math.abs(x - 0.2) < 1e-7));
  });

  test("two outputs: only the headphones' pair is scaled, gliding to the new level", () => {
    const m = new MasterSection();
    m.phonesGain = 0.5;
    let last = 1;
    for (let block = 0; block < 40; block++) {
      const l = buf(128, 0.5), r = buf(128, 0.5), pl = buf(128, 0.4), pr = buf(128, 0.4);
      m.process(l, r, pl, pr, false, 0, 128);
      assert.ok(l.every((x) => x === 0.5) && r.every((x) => x === 0.5)); // the room is never touched (0.5 is exact)
      assert.ok(pl[127] <= last + 1e-9); // glides down, no jump
      assert.ok(pl.every((x, i) => i === 0 || x <= pl[i - 1] + 1e-9));
      last = pl[127];
    }
    assert.ok(Math.abs(last - 0.2) < 1e-3);
  });

  test("split: the right channel is the headphones, the left (the room) stays", () => {
    const m = new MasterSection();
    m.phonesGain = 0;
    for (let block = 0; block < 60; block++) {
      const l = buf(128, 0.6), r = buf(128, 0.6);
      m.process(l, r, null, null, true, 0, 128);
      if (block === 59) { assert.ok(l.every((x) => x === Math.fround(0.6))); assert.ok(r.every((x) => Math.abs(x) < 1e-3)); }
    }
  });

  test("no headphones output (OFF): the level changes nothing", () => {
    const m = new MasterSection();
    m.phonesGain = 0;
    const l = buf(128, 0.7), r = buf(128, 0.7);
    m.process(l, r, null, null, false, 0, 128);
    assert.ok(l.every((x) => x === Math.fround(0.7)) && r.every((x) => x === Math.fround(0.7)));
  });

  test("a boost soft-clips instead of going past full scale", () => {
    const m = new MasterSection();
    m.phonesGain = phonesGainFor(1);
    let peak = 0;
    for (let block = 0; block < 80; block++) {
      const l = buf(128, 0), r = buf(128, 0), pl = buf(128, 0.95), pr = buf(128, -0.95);
      m.process(l, r, pl, pr, false, 0, 128);
      for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(pl[i]), Math.abs(pr[i]));
    }
    assert.ok(peak <= 1 && peak > 0.95);
  });
});
