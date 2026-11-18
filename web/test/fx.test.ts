// The web's master section (audio/fx.ts): headphones level now, the effects below as they come.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FX, FX_DIVISIONS, MasterSection, PHONES_UNITY, beatDelaySeconds, phonesGainFor, softClip } from "../src/audio/fx.ts";

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

// MARK: - The effect unit

const RATE = 48000;
/** Runs `blocks` blocks of 128 frames through the section; `feed(frame)` gives the room input (left = right). Returns the room and its dry input. */
function run(m: MasterSection, blocks: number, feed: (frame: number) => number, extra?: { pl: Float32Array; pr: Float32Array; cue: number; split?: boolean }) {
  const out = new Float32Array(blocks * 128), dry = new Float32Array(blocks * 128), ph = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(128), r = new Float32Array(128);
    for (let i = 0; i < 128; i++) { l[i] = r[i] = feed(b * 128 + i); dry[b * 128 + i] = l[i]; }
    m.process(l, r, null, null, false, 0, 128);
    out.set(l, b * 128);
  }
  return { out, dry, ph };
}
let seed = 7;
const noise = (amp: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return ((seed / 4294967296) * 2 - 1) * amp; };
const energy = (a: Float32Array, from: number, to: number) => { let e = 0; for (let i = from; i < to; i++) e += a[i] * a[i]; return e; };

describe("the effect unit", () => {
  test("note values: 1/4 is one beat, and a 1/32 is an eighth of that", () => {
    assert.equal(FX_DIVISIONS.map((d) => d.label).join(" "), "1/4 1/8 1/16 1/32");
    assert.ok(Math.abs(beatDelaySeconds(120, 0) - 0.5) < 1e-12);
    assert.ok(Math.abs(beatDelaySeconds(120, 1) - 0.25) < 1e-12);
    assert.ok(Math.abs(beatDelaySeconds(120, 2) - 0.125) < 1e-12);
    assert.ok(Math.abs(beatDelaySeconds(120, 3) - 0.0625) < 1e-12);
    assert.ok(Math.abs(beatDelaySeconds(60, 0) - 1) < 1e-12);
    assert.ok(Math.abs(beatDelaySeconds(10, 0) - 1.5) < 1e-12); // a tempo below 40 is held at 40
  });

  test("off: the output is bit for bit the input", () => {
    const m = new MasterSection(RATE);
    m.fxType = FX.reverb; m.fxAmount = 1;
    const x = noise(0.6);
    const { out, dry } = run(m, 200, x);
    assert.ok(out.every((v, i) => v === dry[i]));
  });

  test("delay: the repeat comes one note value later, each one quieter and darker", () => {
    for (const [division, seconds] of [[0, 0.5], [1, 0.25], [2, 0.125], [3, 0.0625]] as const) {
      const m = new MasterSection(RATE);
      m.fxType = FX.delay; m.fxOn = true; m.fxAmount = 1; m.fxDelaySeconds = beatDelaySeconds(120, division);
      const at = 4000; // after the on switch has settled
      const { out } = run(m, Math.ceil((at + RATE * 2) / 128), (i) => (i === at ? 1 : 0));
      const echo = (n: number) => { // the biggest sample near the n-th repeat
        const c = at + Math.round(seconds * RATE * n);
        let best = 0, where = 0;
        for (let i = c - 40; i <= c + 40; i++) if (Math.abs(out[i]) > best) { best = Math.abs(out[i]); where = i; }
        return { best, where: where - at };
      };
      const first = echo(1), second = echo(2);
      assert.ok(Math.abs(first.where - Math.round(seconds * RATE)) <= 2, `1/${[4, 8, 16, 32][division]}: first repeat at ${first.where}`);
      assert.ok(first.best > 0.9 && first.best < 1.05, `first repeat ${first.best}`);
      assert.ok(second.best > 0.05 && second.best < first.best * 0.6, `second repeat ${second.best} against ${first.best}`);
    }
  });

  test("delay: switched off, the repeats ring out, then everything is untouched again", () => {
    const m = new MasterSection(RATE);
    m.fxType = FX.delay; m.fxOn = true; m.fxAmount = 1; m.fxDelaySeconds = 0.05;
    run(m, 100, noise(0.5));
    m.fxOn = false;
    const x = noise(0.4);
    const { out, dry } = run(m, 1500, x); // 4 s
    let early = 0;
    for (let i = 0; i < 4000; i++) early += (out[i] - dry[i]) ** 2;
    assert.ok(early > 0.1, "the tail still adds right after switching off");
    let identical = true;
    for (let i = RATE * 3; i < out.length; i++) if (out[i] !== dry[i]) identical = false;
    assert.ok(identical, "after the tail the unit does nothing");
  });

  test("reverb: a tail that decays, a level in step with the dry, nothing past full scale", () => {
    const m = new MasterSection(RATE);
    m.fxType = FX.reverb; m.fxOn = true; m.fxAmount = 1;
    const at = 4000;
    const { out } = run(m, Math.ceil((at + RATE * 5) / 128), (i) => (i === at ? 0.8 : 0));
    const tail = (a: number, b: number) => energy(out, at + Math.round(a * RATE), at + Math.round(b * RATE));
    assert.ok(tail(0.1, 0.4) > 1e-4, "there is a tail");
    assert.ok(tail(1.0, 1.5) < tail(0.1, 0.6) * 0.5, "it decays");
    assert.ok(tail(4.0, 5.0) < tail(0.1, 0.6) * 0.01, "and dies");
    assert.ok(out.every((v) => Math.abs(v) <= 1 && Number.isFinite(v)));
    const n = run(new MasterSection(RATE), 0, () => 0); // (keeps the helper honest)
    assert.equal(n.out.length, 0);
    const m2 = new MasterSection(RATE);
    m2.fxType = FX.reverb; m2.fxOn = true; m2.fxAmount = 1;
    const x = noise(0.3);
    const r = run(m2, 800, x);
    let wet = 0, dry = 0;
    for (let i = 40000; i < r.out.length; i++) { wet += (r.out[i] - r.dry[i]) ** 2; dry += r.dry[i] ** 2; }
    const ratio = Math.sqrt(wet / dry);
    assert.ok(ratio > 0.6 && ratio < 1.3, `reverb wet/dry ${ratio.toFixed(2)}`);
  });

  test("flanger: a moving comb, bounded, and gone the moment it is switched off", () => {
    const m = new MasterSection(RATE);
    m.fxType = FX.flanger; m.fxOn = true; m.fxAmount = 1; m.fxDelaySeconds = 0.25;
    const x = noise(0.5);
    const a = run(m, 600, x);
    let diff = 0;
    for (let i = 20000; i < a.out.length; i++) diff += (a.out[i] - a.dry[i]) ** 2;
    assert.ok(diff > 1, "it changes the sound");
    assert.ok(a.out.every((v) => Math.abs(v) <= 1 && Number.isFinite(v)));
    m.fxOn = false;
    const y = noise(0.5);
    const b = run(m, 120, y); // 0.3 s later: the switch has glided shut and the unit sleeps
    let same = true;
    for (let i = 128 * 60; i < b.out.length; i++) if (b.out[i] !== b.dry[i]) same = false;
    assert.ok(same);
  });

  test("the headphones get the effect as much as the cue mix lets the room in", () => {
    for (const cue of [0, 0.5, 1]) {
      const m = new MasterSection(RATE);
      m.fxType = FX.delay; m.fxOn = true; m.fxAmount = 1; m.fxDelaySeconds = 0.01;
      let phonesWet = 0, roomWet = 0;
      for (let b = 0; b < 200; b++) {
        const l = new Float32Array(128), r = new Float32Array(128), pl = new Float32Array(128), pr = new Float32Array(128);
        for (let i = 0; i < 128; i++) { const v = b * 128 + i === 2000 ? 0.5 : 0; l[i] = r[i] = v; pl[i] = pr[i] = 0; } // the cue bus carries nothing of its own
        m.process(l, r, pl, pr, false, cue, 128);
        for (let i = 0; i < 128; i++) { roomWet += Math.abs(l[i]); phonesWet += Math.abs(pl[i]); }
      }
      roomWet -= 0.5; // the dry impulse itself
      assert.ok(roomWet > 0.1);
      assert.ok(Math.abs(phonesWet - roomWet * cue) < roomWet * 0.02 + 1e-9, `cue mix ${cue}: phones ${phonesWet} room ${roomWet}`);
    }
  });

  test("split: the effect is on the left (the room) and on the right (the headphones) by the cue mix", () => {
    const m = new MasterSection(RATE);
    m.fxType = FX.delay; m.fxOn = true; m.fxAmount = 1; m.fxDelaySeconds = 0.01;
    let left = 0, right = 0;
    for (let b = 0; b < 200; b++) {
      const l = new Float32Array(128), r = new Float32Array(128); // right: the headphones' own mono mix, silent here
      for (let i = 0; i < 128; i++) l[i] = b * 128 + i === 2000 ? 0.5 : 0;
      m.process(l, r, null, null, true, 0.5, 128);
      for (let i = 0; i < 128; i++) { left += Math.abs(l[i]); right += Math.abs(r[i]); }
    }
    assert.ok(left > 0.1);
    assert.ok(Math.abs(right - (left - 0.5) * 0.5) < left * 0.03, `right ${right} left ${left}`);
  });

  test("switching effect while it plays stays clean, and loud input plus every effect never passes full scale", () => {
    for (const type of [FX.delay, FX.reverb, FX.flanger]) {
      const m = new MasterSection(RATE);
      m.fxOn = true; m.fxAmount = 1; m.fxDelaySeconds = 0.125;
      let peak = 0;
      for (let b = 0; b < 600; b++) {
        if (b % 100 === 0) m.fxType = (type + b / 100) % 3;
        const l = new Float32Array(128), r = new Float32Array(128);
        for (let i = 0; i < 128; i++) { l[i] = r[i] = 0.95 * Math.sin(2 * Math.PI * 110 * (b * 128 + i) / RATE); }
        m.process(l, r, null, null, false, 0, 128);
        for (let i = 0; i < 128; i++) { assert.ok(Number.isFinite(l[i])); peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i])); }
      }
      assert.ok(peak <= 1, `peak ${peak}`);
    }
  });
});
