// The effect unit's seven effects and their four knobs each (audio/fx.ts): every knob does something, the extremes stay finite and inside full scale,
// and an effect that is switched off leaves the sound exactly as it was.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FX_DEFAULTS, FX_DIVISIONS, FX_KNOBS, FX_TYPES, MasterSection, beatDelaySeconds, fxTempoKnob, morph, resonanceQ, stepIndex, stepValue } from "../src/audio/fx.ts";

const BLOCK = 128;
/** Reproducible noise, a different stream for each seed (left and right differ, so a WIDTH knob has something to cross over). */
function noise(seed: number, n: number, amp: number): Float32Array {
  let x = seed >>> 0 || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; out[i] = ((x / 0x100000000) * 2 - 1) * amp; }
  return out;
}
interface Run { l: Float32Array; r: Float32Array; dryL: Float32Array; dryR: Float32Array }
/** `seconds` of stereo noise through a unit set up by `setup`; the whole output (room pair). */
function run(setup: (m: MasterSection) => void, seconds = 2, amp = 0.3, after?: (m: MasterSection, block: number) => void): Run {
  const m = new MasterSection(48000);
  setup(m);
  const n = Math.round(seconds * 48000 / BLOCK) * BLOCK;
  const inL = noise(7, n, amp), inR = noise(99, n, amp);
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let b = 0; b < n; b += BLOCK) {
    const bl = inL.slice(b, b + BLOCK), br = inR.slice(b, b + BLOCK);
    m.process(bl, br, null, null, false, 0, BLOCK);
    l.set(bl, b); r.set(br, b);
    after?.(m, b / BLOCK);
  }
  return { l, r, dryL: inL, dryR: inR };
}
const peak = (x: Float32Array): number => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const rms = (x: Float32Array, from = 0): number => { let s = 0; for (let i = from; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length - from)); };
const diffRms = (a: Float32Array, b: Float32Array, from: number): number => { let s = 0; for (let i = from; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / (a.length - from)); };
const on = (type: number, params: number[], seconds = 0.25) => (m: MasterSection): void => { m.fxType = type; m.fxOn = true; m.fxAmount = 1; m.fxParams = params; m.fxDelaySeconds = seconds; };

describe("the tables", () => {
  test("seven effects, four knobs each, defaults on the knobs' own steps", () => {
    assert.equal(FX_TYPES.length, 7);
    assert.equal(FX_KNOBS.length, 7); assert.equal(FX_DEFAULTS.length, 7);
    FX_KNOBS.forEach((knobs, t) => {
      assert.equal(knobs.length, 4); assert.equal(FX_DEFAULTS[t].length, 4);
      knobs.forEach((k, i) => {
        assert.ok(k.name.length > 0 && k.name.length <= 8, `${FX_TYPES[t]} knob ${i} name`);
        const v = FX_DEFAULTS[t][i];
        assert.ok(v >= 0 && v <= 1);
        if (k.steps) assert.ok(Math.abs(stepValue(stepIndex(v, k.steps.length), k.steps.length) - v) < 1e-9, `${FX_TYPES[t]} ${k.name} rests on a step`);
      });
    });
  });
  test("the tempo knob: a stepped knob of the four note values on every effect except the reverb", () => {
    FX_KNOBS.forEach((knobs, t) => {
      const i = fxTempoKnob(t);
      if (FX_TYPES[t] === "REVERB") { assert.equal(i, -1); return; }
      assert.ok(i >= 0 && knobs[i].steps?.length === FX_DIVISIONS.length, FX_TYPES[t]);
      assert.equal(knobs.filter((k) => k.tempo).length, 1);
    });
  });
  test("a stepped knob: values to steps and back", () => {
    assert.deepEqual([0, 0.3, 0.34, 0.5, 0.7, 1].map((v) => stepIndex(v, 4)), [0, 1, 1, 2, 2, 3]);
    assert.deepEqual([0, 1, 2, 3].map((i) => stepValue(i, 4)), [0, 1 / 3, 2 / 3, 1]);
    assert.equal(stepIndex(-1, 4), 0); assert.equal(stepIndex(9, 4), 3);
  });
  test("the morphing filter knob: low-pass to the left, open in the middle, high-pass to the right", () => {
    assert.equal(morph(0.5), null); assert.equal(morph(0.51), null);
    const lo = morph(0)!, mid = morph(0.25)!, hi = morph(1)!, hp = morph(0.75)!;
    assert.ok(lo.low && lo.hz > 70 && lo.hz < 90);
    assert.ok(mid.low && mid.hz > lo.hz && mid.hz < 18000);
    assert.ok(!hp.low && hi.hz > hp.hz && hi.hz > 6500);
    assert.ok(resonanceQ(0) < 1 && resonanceQ(1) >= 9.9);
  });
  test("the note values at a tempo are as they were", () => {
    assert.ok(Math.abs(beatDelaySeconds(120, 1) - 0.25) < 1e-9);
  });
});

describe("every effect works at its defaults", () => {
  FX_TYPES.forEach((name, type) => {
    test(`${name}: on, the sound changes; finite; never past full scale; off again, the sound is untouched`, () => {
      const second = run(on(type, FX_DEFAULTS[type].slice()), 3);
      const dry = new Float32Array(second.dryL);
      assert.ok(second.l.every(Number.isFinite) && second.r.every(Number.isFinite));
      assert.ok(peak(second.l) <= 1 && peak(second.r) <= 1);
      const heard = diffRms(second.l, dry, 24000) / rms(dry, 24000);
      assert.ok(heard > 0.04, `${name} changes the sound by ${(heard * 100).toFixed(1)} %`);
      // switched off for the last second or two: the room is the input again, bit for bit
      const tail = run((m) => { on(type, FX_DEFAULTS[type].slice(), 0.03)(m); }, 12, 0.3, (m, b) => { if (b === Math.round(3 * 48000 / BLOCK)) m.fxOn = false; });
      const from = tail.l.length - 48000;
      let same = true;
      for (let i = from; i < tail.l.length; i++) if (tail.l[i] !== tail.dryL[i] || tail.r[i] !== tail.dryR[i]) { same = false; break; }
      assert.ok(same, `${name} leaves the sound untouched after it is off`);
    });
  });
});

describe("every knob does something", () => {
  FX_TYPES.forEach((name, type) => {
    FX_KNOBS[type].forEach((knob, i) => {
      test(`${name} ${knob.name}: turning it changes the sound`, () => {
        const low = FX_DEFAULTS[type].slice(), high = FX_DEFAULTS[type].slice();
        low[i] = 0.1; high[i] = 0.9;
        if (name === "FILTER" && knob.name === "RATE") { low[2] = 0.6; high[2] = 0.6; } // the rate of the sweep matters once there is a sweep
        // The tempo knob works through the note value in seconds (the page does that sum).
        const secLow = knob.tempo ? beatDelaySeconds(120, 0) : 0.25, secHigh = knob.tempo ? beatDelaySeconds(120, 3) : 0.25;
        const a = run(on(type, low, secLow), 2), b = run(on(type, high, secHigh), 2);
        const d = Math.max(diffRms(a.l, b.l, 24000), diffRms(a.r, b.r, 24000)) / rms(a.dryL, 24000);
        assert.ok(d > 0.02, `${name} ${knob.name} moved the sound by ${(d * 100).toFixed(2)} %`);
      });
    });
  });
});

describe("the extremes are safe", () => {
  FX_TYPES.forEach((name, type) => {
    test(`${name}: every knob at 0, at 1, and mixed, with loud noise: finite and inside full scale`, () => {
      for (const params of [[0, 0, 0, 0], [1, 1, 1, 1], [1, 0, 1, 0], [0, 1, 0, 1], [0.5, 0.99, 0.01, 0.5]]) {
        for (const seconds of [0.03, 0.5, 2]) {
          const r = run(on(type, params, seconds), 1.5, 0.95);
          assert.ok(r.l.every(Number.isFinite) && r.r.every(Number.isFinite), `${name} ${params} ${seconds}`);
          assert.ok(peak(r.l) <= 1 && peak(r.r) <= 1, `${name} ${params} ${seconds} full scale`);
        }
      }
    });
  });
  test("a knob turned all the way and back again while it plays, and the effect changed every block: still finite", () => {
    const r = run((m) => { on(0, [1 / 3, 0.5, 0.5, 0.5])(m); }, 4, 0.5, (m, b) => {
      m.fxType = b % 7; m.fxParams = [Math.abs(Math.sin(b)), Math.abs(Math.cos(b * 1.3)), (b % 5) / 4, (b % 3) / 2];
      m.fxDelaySeconds = 0.03 + 0.4 * Math.abs(Math.sin(b * 0.1));
      m.fxAmount = Math.abs(Math.sin(b * 0.37));
    });
    assert.ok(r.l.every(Number.isFinite) && r.r.every(Number.isFinite));
    assert.ok(peak(r.l) <= 1);
  });
  test("a stereo input with a hard NaN in it does not poison the effect for good", () => {
    const m = new MasterSection(48000);
    on(3, FX_DEFAULTS[3].slice())(m);
    const l = noise(1, BLOCK, 0.3), r = noise(2, BLOCK, 0.3);
    l[10] = NaN;
    m.process(l, r, null, null, false, 0, BLOCK);
    let finite = true;
    for (let b = 0; b < 400; b++) {
      const bl = noise(10 + b, BLOCK, 0.3), br = noise(500 + b, BLOCK, 0.3);
      m.process(bl, br, null, null, false, 0, BLOCK);
      if (b > 20 && !(bl.every(Number.isFinite) && br.every(Number.isFinite))) finite = false;
    }
    assert.ok(finite, "the effect recovers");
  });
});

describe("the behaviours that make each effect what it is", () => {
  test("the filter closes the highs when the knob is to the left (a low-pass) and the lows when it is to the right", () => {
    const energy = (x: Float32Array): [number, number] => { // crude: first difference ~ highs, running mean ~ lows
      let hi = 0, lo = 0, m = 0;
      for (let i = 1; i < x.length; i++) { hi += (x[i] - x[i - 1]) ** 2; m = m * 0.99 + x[i] * 0.01; lo += m * m; }
      return [hi, lo];
    };
    const open = run(on(4, [0.5, 0.35, 0, 1 / 3]), 1.5), lp = run(on(4, [0.1, 0.35, 0, 1 / 3]), 1.5), hp = run(on(4, [0.9, 0.35, 0, 1 / 3]), 1.5);
    const [hiO, loO] = energy(open.l), [hiL, loL] = energy(lp.l), [hiH, loH] = energy(hp.l);
    assert.ok(hiL < hiO * 0.1 && loL > loO * 0.3, "low-pass: highs gone, lows stay");
    assert.ok(loH < loO * 0.2 && hiH > hiO * 0.3, "high-pass: lows gone, highs stay");
  });
  test("with the effect's LEVEL at 0 the filter does nothing, and at 1 it is fully filtered", () => {
    const run0 = run((m) => { on(4, [0.1, 0.35, 0, 1 / 3])(m); m.fxAmount = 0; }, 1);
    for (let i = 24000; i < run0.l.length; i++) assert.ok(Math.abs(run0.l[i] - run0.dryL[i]) < 1e-3, `sample ${i}`);
  });
  test("the delay's WIDTH sends the repeats to the other side", () => {
    // An impulse on the left only: with width 0 the left repeats; with width 1 the first repeat comes out on the right.
    const probe = (width: number): [number, number] => {
      const m = new MasterSection(48000);
      on(0, [1 / 3, 0.6, 0.9, width], 0.1)(m);
      let l = 0, r = 0;
      for (let b = 0; b < 160; b++) {
        const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK);
        if (b === 0) bl[0] = 0.5;
        m.process(bl, br, null, null, false, 0, BLOCK);
        if (b >= 40) for (let i = 0; i < BLOCK; i++) { l += bl[i] * bl[i]; r += br[i] * br[i]; }
      }
      return [l, r];
    };
    const [l0, r0] = probe(0), [l1, r1] = probe(1);
    assert.ok(l0 > 0 && r0 === 0, "width 0: the repeats stay on the left");
    assert.ok(r1 > 0, `width 1: they cross over (${r1})`);
  });
  test("the reverb's PRE holds the tail back", () => {
    const first = (pre: number): number => {
      const m = new MasterSection(48000);
      on(1, [0.84, 0.2, pre, 1])(m);
      let early = 0;
      for (let b = 0; b < 60; b++) {
        const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK);
        if (b === 0) { bl[0] = 0.5; br[0] = 0.5; }
        const before = bl.slice();
        m.process(bl, br, null, null, false, 0, BLOCK);
        if (b < 30) for (let i = 0; i < BLOCK; i++) early += (bl[i] - before[i]) ** 2;
      }
      return early;
    };
    assert.ok(first(0) > 0 && first(1) < first(0) * 0.05, "100 ms of pre-delay: nothing in the first 80 ms");
  });
  test("the phaser's STAGES: more stages, more notches (the sound differs between 4 and 12)", () => {
    const a = run(on(3, [1 / 3, 0.65, 0.5, 0]), 2), b = run(on(3, [1 / 3, 0.65, 0.5, 1]), 2);
    assert.ok(diffRms(a.l, b.l, 24000) / rms(a.dryL, 24000) > 0.05);
  });
});
