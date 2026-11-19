// The tempo and first-beat finder (library/beats.ts), on made-up music with a known answer.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { analyseTempo, monoForAnalysis } from "../src/library/beats.ts";

const RATE = 11025;
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

interface Opts { bpm: number; first: number; seconds?: number; kick?: number; hats?: boolean; noise?: number; introSilence?: number; swing?: number; drift?: number }

/** A four-on-the-floor loop: a kick on every beat (a decaying sine), hats on the off-beats, a held pad, some noise. */
function music(o: Opts): Float32Array {
  const seconds = o.seconds ?? 60;
  const x = new Float32Array(Math.floor(seconds * RATE));
  const beat = 60 / o.bpm;
  const kickGain = o.kick ?? 0.8;
  for (let k = 0; ; k++) {
    // The tempo may drift (a live player): the n-th beat arrives a little earlier or later.
    const t = o.first + k * beat * (1 + (o.drift ?? 0) * Math.sin(k / 9));
    if (t >= seconds) break;
    if (t < (o.introSilence ?? 0)) continue;
    const at = Math.round(t * RATE);
    for (let i = 0; i < 0.12 * RATE && at + i < x.length; i++) {
      const tt = i / RATE;
      x[at + i] += kickGain * Math.sin(2 * Math.PI * (52 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 28);
    }
    if (o.hats !== false) {
      const off = Math.round((t + beat / 2 + (o.swing ?? 0) * beat) * RATE);
      for (let i = 0; i < 0.03 * RATE && off + i < x.length; i++) x[off + i] += 0.25 * rnd() * Math.exp(-i / RATE * 120);
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += (o.noise ?? 0.02) * rnd() + 0.05 * Math.sin(2 * Math.PI * 220 * i / RATE);
  return x;
}

const check = (name: string, o: Opts, bpmTol = 0.03, phaseTolMs = 8) => test(name, () => {
  const r = analyseTempo(music(o), RATE);
  assert.ok(r, "found something");
  assert.ok(Math.abs(r.bpm - o.bpm) <= bpmTol, `bpm ${r.bpm.toFixed(3)} against ${o.bpm}`);
  const beat = 60 / o.bpm;
  const intro = o.introSilence ?? 0;
  // The first beat that sounds: on the true grid, at or after the intro.
  const k = Math.max(0, Math.ceil((intro - o.first) / beat - 1e-9));
  const want = o.first + k * beat;
  const gap = ((r.firstBeat - want) % beat + beat * 1.5) % beat - beat / 2; // modulo a beat: any beat of the grid is right
  assert.ok(Math.abs(gap) * 1000 <= phaseTolMs, `first beat ${r.firstBeat.toFixed(4)} against ${want.toFixed(4)} (off by ${(gap * 1000).toFixed(1)} ms)`);
  assert.ok(r.confidence > 0.5, `confidence ${r.confidence.toFixed(2)}`);
});

describe("tempo and first beat", () => {
  check("a steady house tempo with a fractional BPM", { bpm: 123.37, first: 1.234 });
  check("a fast one", { bpm: 140, first: 0.5 });
  check("a slow, soft, dub-style kick under the noise", { bpm: 112.5, first: 2.1, kick: 0.25, noise: 0.05 });
  check("a very steady 128", { bpm: 128, first: 0.02, hats: false });
  check("an empty intro: the first real beat is later", { bpm: 126, first: 0.3, introSilence: 12 }, 0.03, 8);
  test("a slow tempo: 88 BPM comes out as 88 or its double, and a tag of 88 settles it", () => {
    const x = music({ bpm: 88, first: 0.9 });
    const free = analyseTempo(x, RATE)!;
    assert.ok(Math.abs(free.bpm - 88) < 0.05 || Math.abs(free.bpm - 176) < 0.1, `bpm ${free.bpm}`);
    const tagged = analyseTempo(x, RATE, 88)!;
    assert.ok(Math.abs(tagged.bpm - 88) < 0.05, `with the tag ${tagged.bpm}`);
  });
  check("swung hats", { bpm: 119, first: 0.7, swing: 0.1 });

  test("a long track: the first beat is looked for from the very start, not from the analysis window", () => {
    // Ten minutes (the analysed window is eight, from a quarter in): the kicks begin at 1.0 s.
    const r = analyseTempo(music({ bpm: 126, first: 1.0, seconds: 600 }), RATE)!;
    assert.ok(r, "found something");
    assert.ok(Math.abs(r.bpm - 126) < 0.01, `bpm ${r.bpm}`);
    assert.ok(Math.abs(r.firstBeat - 1.0) < 0.012, `first beat ${r.firstBeat.toFixed(3)} (the window starts at 150 s)`);
    // Twelve minutes with a bare intro: the first beat is where the kicks start, 20 s in, not 3 minutes in.
    const r2 = analyseTempo(music({ bpm: 124, first: 0.2, seconds: 720, introSilence: 20 }), RATE)!;
    const beat = 60 / 124, want = 0.2 + Math.ceil((20 - 0.2) / beat - 1e-9) * beat;
    assert.ok(r2 && Math.abs(r2.firstBeat - want) < 0.012, `first beat ${r2?.firstBeat.toFixed(3)} against ${want.toFixed(3)}`);
  });

  test("an octave: a 62 BPM pulse comes out as 124, never 31", () => {
    const r = analyseTempo(music({ bpm: 124, first: 0.4 }), RATE)!;
    assert.ok(Math.abs(r.bpm - 124) < 0.05);
  });

  test("a tag that is the double or half of the tempo chooses the octave, one that agrees with neither is ignored", () => {
    const x = music({ bpm: 170, first: 0.4 });
    const free = analyseTempo(x, RATE)!;
    assert.ok(Math.abs(free.bpm - 170) < 0.06 || Math.abs(free.bpm - 85) < 0.06);
    const tagged = analyseTempo(x, RATE, 85)!;
    assert.ok(Math.abs(tagged.bpm - 85) < 0.06, `tag 85: ${tagged.bpm}`);
    const wrong = analyseTempo(x, RATE, 127)!; // like a file tagged 85 that is really 127: ignored
    assert.ok(Math.abs(wrong.bpm - free.bpm) < 0.01);
  });

  test("noise has no tempo, or only a doubtful one", () => {
    const x = new Float32Array(RATE * 40);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * rnd();
    const r = analyseTempo(x, RATE);
    assert.ok(r === null || r.confidence < 0.5, `confidence ${r?.confidence}`);
  });

  test("a wandering tempo is doubtful", () => {
    const r = analyseTempo(music({ bpm: 124, first: 0.4, drift: 0.02 }), RATE);
    assert.ok(r === null || r.confidence < 0.8, `confidence ${r?.confidence}`);
  });

  test("silence and a short clip give nothing", () => {
    assert.equal(analyseTempo(new Float32Array(RATE * 30), RATE), null);
    assert.equal(analyseTempo(music({ bpm: 124, first: 0.2, seconds: 5 }), RATE), null);
  });

  test("mono and decimation: a 48 kHz stereo file is brought down to 16 kHz, left and right averaged", () => {
    const l = new Float32Array(48000).fill(0.5), r = new Float32Array(48000).fill(-0.5);
    const m = monoForAnalysis(l, r, 48000);
    assert.equal(m.rate, 16000); // every third frame: the step is rounded down, so the rate stays above 12.5 kHz
    assert.equal(m.data.length, 16000);
    assert.ok(m.data.every((v) => Math.abs(v) < 1e-6));
    const m2 = monoForAnalysis(l, l, 8000);
    assert.equal(m2.rate, 8000);
    assert.ok(Math.abs(m2.data[0] - 0.5) < 1e-6);
  });
});
