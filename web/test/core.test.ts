// Port of Packages/HeadlinerKit/Tests/HeadlinerCoreTests/CoreTests.swift, case by case. When a
// Swift test changes, change its twin here: the two cores must agree.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BeatGrid } from "../src/core/beatgrid.ts";
import { crossfade, eqDecibels, phaseOffset, pitchToPlay, readMix, verdict } from "../src/core/mixjudge.ts";
import type { DeckSnapshot } from "../src/core/mixjudge.ts";
import { firstOnset, newDeckShared, overview, renderVinyl } from "../src/core/vinyl.ts";
import type { DeckShared } from "../src/core/vinyl.ts";
import { applyEcho, Biquad, ChannelStrip, ECHO_CAPACITY, filterHz, MixerShared, renderMix } from "../src/core/mixer.ts";
import type { BiquadShape } from "../src/core/mixer.ts";
import { compatible, clash, detune } from "../src/core/harmony.ts";
import {
  ARRANGEMENT, barFrames, DrumPattern, renderLoop, renderSections, stepFrame, TARGET_RMS, voice,
} from "../src/core/drummachine.ts";

function near(actual: number, expected: number, accuracy: number, what = ""): void {
  assert.ok(Math.abs(actual - expected) <= accuracy, `${what} ${actual} is not within ${accuracy} of ${expected}`);
}

function maxAbs(x: Float32Array | number[], from = 0, to = x.length): number {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

describe("BeatGrid", () => {
  test("beats and bars", () => {
    const g = new BeatGrid(120, 0.25);
    near(g.beatLength, 0.5, 1e-12);
    near(g.beat(0.25), 0, 1e-12);
    near(g.beat(2.25), 4, 1e-12);
    near(g.secondsAtBeat(8), 4.25, 1e-12);
    near(g.phase(0.5), 0.5, 1e-12);
    assert.equal(g.bar(2.3), 1);
    assert.equal(g.beatInBar(1.3), 2);
    assert.equal(g.beatInBar(0.1), 3); // before the first beat: last beat of the bar before
  });
});

describe("Mix", () => {
  test("phase offset wraps to half a beat", () => {
    near(phaseOffset(10.0, 10.0), 0, 1e-12);
    near(phaseOffset(10.25, 3.0), 0.25, 1e-12);   // B is a quarter beat behind
    near(phaseOffset(10.0, 3.25), -0.25, 1e-12);  // B is ahead
    near(phaseOffset(0.9, 0.1), -0.2, 1e-12);     // across the beat line
  });

  test("crossfader is full until the middle", () => {
    assert.equal(crossfade(0).a, 1); assert.equal(crossfade(0).b, 0);
    assert.equal(crossfade(0.5).a, 1); assert.equal(crossfade(0.5).b, 1);
    near(crossfade(0.75).a, 0.5, 1e-12); assert.equal(crossfade(0.75).b, 1);
    assert.equal(crossfade(1).a, 0);
  });

  test("pitch and EQ", () => {
    near(pitchToPlay(122, 124), 2.0 / 122, 1e-12);
    near(eqDecibels(0.5), 0, 1e-12);
    near(eqDecibels(0), -36, 1e-12);
    near(eqDecibels(1), 6, 1e-12);
  });

  const deck = (beat: number, o: { bpm?: number; gain?: number; low?: number; playing?: boolean } = {}): DeckSnapshot => ({
    playing: o.playing ?? true, gain: o.gain ?? 1, bpm: o.bpm ?? 124, beat, low: o.low ?? 0.5,
  });

  test("judge states", () => {
    assert.equal(readMix(deck(0, { playing: false }), deck(0, { gain: 0 })).state, "silence");
    const solo = readMix(deck(3.2), deck(0, { gain: 0 }));
    assert.equal(solo.state, "solo");
    assert.equal(solo.quality, 1);
  });

  test("locked blend with bass swap scores high", () => {
    const r = readMix(deck(16.0, { low: 0.5 }), deck(48.005, { low: 0.0 }));
    assert.equal(r.state, "blend");
    assert.equal(r.bassClash, false);
    assert.ok(r.quality > 0.95);
    assert.equal(verdict(r), "LOCKED");
  });

  test("both basslines cost points", () => {
    const r = readMix(deck(16.0), deck(48.0));
    assert.equal(r.bassClash, true);
    near(r.quality, 0.8, 1e-9);
  });

  test("galloping kicks are a train wreck", () => {
    const r = readMix(deck(16.0, { low: 0 }), deck(48.3, { bpm: 126 }));
    near(r.offsetBeats, -0.3, 1e-9);
    assert.ok(r.quality < 0.3);
    assert.equal(verdict(r), "TRAIN WRECK");
  });
});

describe("Vinyl", () => {
  /** A deck holding a slow ramp, so the sample value tells where the needle is. */
  function withDeck(body: (s: DeckShared) => void, frames = 4000): void {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) data[i] = i / frames;
    const s = newDeckShared();
    s.left = data; s.right = data; s.frames = frames;
    s.gain = 1; s.targetGain = 1;
    body(s);
  }

  function run(s: DeckShared, count: number): Float32Array {
    const l = new Float32Array(count).fill(9), r = new Float32Array(count).fill(9);
    renderVinyl(s, l, r, count);
    return l;
  }

  test("normal speed reads the record frame by frame", () => withDeck((s) => {
    s.rate = 1; s.targetRate = 1; s.position = 100;
    const out = run(s, 50);
    near(out[0], 101 / 4000, 1e-6);
    near(out[49], 150 / 4000, 1e-6);
    near(s.position, 150, 1e-9);
  }));

  test("stopped record is silent and stays put", () => withDeck((s) => {
    s.position = 500;
    const out = run(s, 64);
    assert.ok(out.every((x) => x === 0));
    near(s.position, 500, 1e-9);
  }));

  test("half speed interpolates between frames", () => withDeck((s) => {
    s.rate = 0.5; s.targetRate = 0.5; s.position = 200;
    const out = run(s, 3);
    near(out[0], 200.5 / 4000, 1e-6);
    near(out[2], 201.5 / 4000, 1e-6);
  }));

  test("backwards and the start of the record", () => withDeck((s) => {
    s.rate = -1; s.targetRate = -1; s.position = 10;
    const out = run(s, 30);
    near(out[0], 9 / 4000, 1e-6);
    near(s.position, 1, 1e-9); // stops at the first groove
    assert.equal(out[29], 0);
  }));

  test("motor glides towards its speed", () => withDeck((s) => {
    s.targetRate = 1; s.glide = 0.01; s.position = 10;
    run(s, 100);
    near(s.rate, 1 - Math.pow(0.99, 100), 1e-9);
  }));

  test("needle drop and peak", () => withDeck((s) => {
    s.rate = 1; s.targetRate = 1; s.seekTo = 2000;
    const out = run(s, 10);
    near(out[0], 2001 / 4000, 1e-6);
    assert.equal(s.seekTo, -1);
    near(s.peak, 2010 / 4000, 1e-6);
  }));

  test("nothing loaded is silence", () => {
    const s = newDeckShared();
    assert.ok(run(s, 16).every((x) => x === 0));
  });

  test("overview shows the quiet part", () => {
    // Loud, then a quiet middle, then loud again.
    const samples = new Float32Array(3000).fill(0.8);
    for (let i = 1000; i < 2000; i++) samples[i] = 0.2;
    const bins = overview(samples, 3000, 3, 1);
    assert.equal(bins.length, 3);
    near(bins[0], 1, 1e-4);
    near(bins[1], 0.25, 1e-4);
    near(bins[2], 1, 1e-4);
    assert.equal(overview(samples, 0, 4).length, 0);
  });

  test("first onset", () => {
    const x = new Float32Array(100);
    x[40] = 0.01; x[41] = 0.2;
    assert.equal(firstOnset(x, 100), 41);
  });
});

describe("Mixer", () => {
  interface MixOptions {
    hz0?: number; hz1?: number; frames?: number; split?: boolean; cueMix?: number; master?: number; twoOutputs?: boolean;
  }

  /** Two decks, each playing a steady tone (deck 0 at `hz0`, deck 1 at `hz1`), through the mixer. */
  function mix(o: MixOptions, set: (a: ChannelStrip, b: ChannelStrip) => void) {
    const rate = 44_100;
    const frames = o.frames ?? 44_100;
    const tones = [o.hz0 ?? 440, o.hz1 ?? 880].map((hz) => {
      const p = new Float32Array(frames * 2);
      for (let i = 0; i < frames * 2; i++) p[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / rate);
      return p;
    });
    const decks = tones.map((t) => {
      const s = newDeckShared();
      s.left = t; s.right = t; s.frames = frames * 2;
      s.gain = 1; s.targetGain = 1; s.rate = 1; s.targetRate = 1; s.position = 1;
      return s;
    });
    const strips = [new ChannelStrip(), new ChannelStrip()];
    const mixer = new MixerShared();
    mixer.sampleRate = rate; mixer.split = o.split ?? false; mixer.cueMix = o.cueMix ?? 0;
    mixer.master = o.master ?? 1;
    set(strips[0], strips[1]);
    const left = new Float32Array(frames).fill(9), right = new Float32Array(frames).fill(9);
    const phonesL = new Float32Array(frames).fill(9), phonesR = new Float32Array(frames).fill(9);
    const scratch = { left: new Float32Array(512), right: new Float32Array(512) };
    let done = 0;
    while (done < frames) { // in buffers of 512, like the phone
      const n = Math.min(512, frames - done);
      const at = (x: Float32Array) => x.subarray(done, done + n);
      if (o.twoOutputs) {
        renderMix(decks, strips, mixer, scratch, at(left), at(right), at(phonesL), at(phonesR), n);
      } else {
        renderMix(decks, strips, mixer, scratch, at(left), at(right), null, null, n);
      }
      done += n;
    }
    return { left, right, phones: phonesL };
  }

  /** How strongly `hz` is present in the second half of `x` (amplitude of that tone). Half a
   * second holds a whole number of cycles of every tone used here, so tones do not leak. */
  function level(x: Float32Array, hz: number): number {
    let re = 0, im = 0;
    const from = Math.trunc(x.length / 2);
    for (let i = from; i < x.length; i++) {
      const a = 2 * Math.PI * hz * i / 44_100;
      re += x[i] * Math.cos(a); im += x[i] * Math.sin(a);
    }
    return 2 * Math.sqrt(re * re + im * im) / (x.length - from);
  }

  test("flat mixer passes both decks", () => {
    const out = mix({}, () => {});
    near(level(out.left, 440), 0.5, 0.01);
    near(level(out.left, 880), 0.5, 0.01);
    near(level(out.right, 440), 0.5, 0.01);
  });

  test("fader down is silent", () => {
    const out = mix({}, (a) => { a.fader = 0; });
    assert.ok(level(out.left, 440) < 0.001);
    near(level(out.left, 880), 0.5, 0.01);
  });

  test("split puts the room left and the cue right", () => {
    // Deck 0 plays to the room. Deck 1 has its fader down and its headphone cue on.
    const out = mix({ split: true }, (_, b) => { b.fader = 0; b.cue = 1; });
    near(level(out.left, 440), 0.5, 0.01);
    assert.ok(level(out.left, 880) < 0.001);
    near(level(out.right, 880), 0.5, 0.01);
    assert.ok(level(out.right, 440) < 0.001);
  });

  test("cue mix brings the room into the headphones", () => {
    const out = mix({ split: true, cueMix: 0.5 }, (_, b) => { b.fader = 0; b.cue = 1; });
    near(level(out.right, 880), 0.25, 0.01);
    near(level(out.right, 440), 0.25, 0.01);
    near(level(out.left, 440), 0.5, 0.01);
  });

  test("low kill takes the bass and leaves the rest", () => {
    // 60 Hz and 3 kHz through deck 0 with the low knob all the way down; deck 1 silent.
    const bass = mix({ hz0: 60 }, (a, b) => { a.lowDB = -36; b.fader = 0; });
    assert.ok(level(bass.left, 60) < 0.5 * 0.03); // at least 30 dB down
    const top = mix({ hz0: 3_000 }, (a, b) => { a.lowDB = -36; b.fader = 0; });
    near(level(top.left, 3_000), 0.5, 0.03);
  });

  test("high kill and mid boost", () => {
    const top = mix({ hz0: 12_000 }, (a, b) => { a.highDB = -36; b.fader = 0; });
    assert.ok(level(top.left, 12_000) < 0.5 * 0.03);
    const mid = mix({ hz0: 1_000 }, (a, b) => { a.midDB = 6; b.fader = 0; });
    near(level(mid.left, 1_000), 0.5 * 1.995, 0.03);
    const low = mix({ hz0: 60 }, (a, b) => { a.highDB = -36; b.fader = 0; });
    near(level(low.left, 60), 0.5, 0.02);
  });

  test("two outputs carry the room and the headphones", () => {
    // Deck 0 plays to the room. Deck 1 has its fader down and its headphone cue on.
    const out = mix({ twoOutputs: true }, (_, b) => { b.fader = 0; b.cue = 1; });
    near(level(out.left, 440), 0.5, 0.01);
    assert.ok(level(out.left, 880) < 0.001);
    near(level(out.phones, 880), 0.5, 0.01);
    assert.ok(level(out.phones, 440) < 0.001);
    // With the cue mix all the way to ROOM the headphones hear what the room hears.
    const room = mix({ cueMix: 1, twoOutputs: true }, (_, b) => { b.fader = 0; b.cue = 1; });
    near(level(room.phones, 440), 0.5, 0.01);
    assert.ok(level(room.phones, 880) < 0.001);
  });

  test("master volume turns everything down", () => {
    const out = mix({ master: 0.5 }, () => {});
    near(level(out.left, 440), 0.25, 0.01);
    near(level(out.right, 880), 0.25, 0.01);
  });
});

describe("Harmony", () => {
  test("neighbours on the wheel", () => {
    assert.ok(compatible("2A", "2A"));
    assert.ok(compatible("2A", "3A"));
    assert.ok(compatible("2A", "1A"));
    assert.ok(compatible("12A", "1A")); // the wheel wraps
    assert.ok(compatible("1B", "12B"));
    assert.ok(compatible("2A", "2B"));   // relative major
    assert.ok(!compatible("2A", "4A"));
    assert.ok(!compatible("2A", "8A"));
    assert.ok(!compatible("2A", "3B"));
    assert.ok(!compatible("3A", "10A"));
    assert.ok(compatible("2A", "?"));    // unknown keys never clash
  });

  test("pitch moves the key", () => {
    near(detune(0, 0), 0, 1e-12);
    near(detune(2.0 / 128, 0), 0.268, 0.002); // 128 -> 130
    assert.ok(!clash("9A", 0.0156, "10A", 0));  // Sinal at 130 with Portão
    assert.ok(clash("2A", 0.03125, "3A", 0));   // 128 pushed to 132: half a semitone out
    assert.ok(clash("2A", 0, "8A", 0));
  });
});

describe("Filter", () => {
  /** RMS of a sine after it went through one filter (second half, once the filter has settled). */
  function rms(shape: BiquadShape, hz: number, tone: number): number {
    const f = new Biquad();
    f.set(shape, hz, 0, 48_000, 1.0);
    const n = 9_600;
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = Math.sin(2 * Math.PI * tone * i / 48_000);
    const r = l.slice();
    f.run(l, r, n);
    let sum = 0;
    for (let i = n / 2; i < n; i++) sum += l[i] * l[i];
    return Math.sqrt(sum / (n / 2));
  }

  test("low-pass keeps the bass and takes the top", () => {
    assert.ok(rms("lowPass", 300, 60) > 0.6);
    assert.ok(rms("lowPass", 300, 5_000) < 0.01);
  });

  test("high-pass takes the bass", () => {
    assert.ok(rms("highPass", 2_000, 8_000) > 0.6);
    assert.ok(rms("highPass", 2_000, 60) < 0.01);
  });

  test("knob positions", () => {
    near(filterHz(-1), 100, 0.01);
    near(filterHz(1), 8_000, 0.01);
    near(filterHz(-0.5), 20_000 * Math.sqrt(100 / 20_000), 0.01);
  });
});

describe("DrumMachine", () => {
  test("whole bars and silence for an empty pattern", () => {
    const audio = renderLoop(new DrumPattern(), 120, 2);
    assert.equal(barFrames(120), 88_200);
    assert.equal(audio.left.length, 176_400);
    assert.equal(audio.right.length, 176_400);
    assert.equal(maxAbs(audio.left), 0);
  });

  test("kick on step one starts at sample zero", () => {
    const p = new DrumPattern();
    p.rows[0][0] = true;
    const audio = renderLoop(p, 124, 1);
    assert.ok(Math.abs(audio.left[0]) > 0.5);
  });

  test("a hit lands on its step", () => {
    const p = new DrumPattern();
    p.rows[1][4] = true;
    const audio = renderLoop(p, 120, 1);
    const at = stepFrame(4, 120);
    assert.equal(at, 22_050);
    assert.equal(maxAbs(audio.left, 0, at), 0);
    assert.ok(maxAbs(audio.left, at, at + 2_205) > 0.05);
  });

  test("the house groove", () => {
    assert.deepEqual(DrumPattern.house.on(0), [0, 4, 8, 12]);
    assert.deepEqual(DrumPattern.house.on(1), [4, 12]);
    assert.deepEqual(DrumPattern.house.on(2), [2, 6, 10, 14]);
  });
});

describe("Studio synth", () => {
  test("five rows even from a shorter pattern", () => {
    assert.equal(new DrumPattern().rows.length, 5);
    assert.equal(DrumPattern.house.rows.length, 5);
    assert.ok(DrumPattern.house.rows[3].every((x) => !x));
    assert.equal(new DrumPattern([[true]]).rows[0].length, 16);
  });

  test("bass and chord sound", () => {
    assert.ok(maxAbs(voice(3)) > 0.1);
    assert.ok(maxAbs(voice(4)) > 0.1);
    const p = new DrumPattern();
    p.rows[3][2] = true;
    const audio = renderLoop(p, 124, 1);
    const at = stepFrame(2, 124);
    assert.equal(maxAbs(audio.left, 0, at), 0);
    assert.ok(maxAbs(audio.left, at, at + 4_410) > 0.05);
  });
});

describe("Dubplate", () => {
  test("the arrangement is eighty bars", () => {
    assert.equal(ARRANGEMENT.reduce((n, s) => n + s.bars, 0), 80);
    const audio = renderSections(DrumPattern.track, 124, ARRANGEMENT);
    assert.equal(audio.left.length, 80 * barFrames(124));
  });

  test("the intro has no clap", () => {
    const p = new DrumPattern();
    p.rows[1][4] = true; // clap only
    const audio = renderSections(p, 124, ARRANGEMENT);
    const bar = barFrames(124);
    assert.equal(maxAbs(audio.left, 0, 16 * bar), 0);                 // intro: kick and hat only
    assert.ok(maxAbs(audio.left, 16 * bar, 17 * bar) > 0.05);         // groove: the clap is in
  });

  test("the loop still works", () => {
    assert.equal(renderLoop(DrumPattern.house, 120, 2).left.length, 2 * 88_200);
    assert.deepEqual(DrumPattern.track.on(3), [2, 6, 10, 14]);
    assert.deepEqual(DrumPattern.track.on(4), [3, 11]);
  });
});

describe("Studio level", () => {
  /** RMS in dB of one stretch of the left channel. */
  function db(x: Float32Array, from: number, to: number): number {
    let sum = 0;
    for (let i = from; i < to; i++) sum += x[i] * x[i];
    return 20 * Math.log10(Math.sqrt(sum / (to - from)));
  }

  test("the dubplate sits level with the records", () => {
    const bar = barFrames(124);
    const audio = renderSections(DrumPattern.track, 124, ARRANGEMENT);
    near(db(audio.left, 32 * bar, 33 * bar), 20 * Math.log10(TARGET_RMS), 1);
  });

  test("a bad mixdown is as loud but heavier in the lows", () => {
    const bar = barFrames(124);
    const heavy = renderSections(DrumPattern.track, 124, ARRANGEMENT, true);
    near(db(heavy.left, 32 * bar, 33 * bar), 20 * Math.log10(TARGET_RMS), 1);
  });
});

describe("Echo", () => {
  test("the far speakers arrive late and quieter", () => {
    const mixer = new MixerShared();
    mixer.echoL = new Float32Array(ECHO_CAPACITY);
    mixer.echoR = new Float32Array(ECHO_CAPACITY);
    mixer.echoDelay = 100;
    mixer.echoGain = 0.5;
    const l = new Float32Array(300), r = new Float32Array(300);
    l[0] = 1;
    r[0] = 1;
    applyEcho(mixer, l, r, 300);
    assert.equal(l[0], 1);
    assert.equal(l[50], 0);
    near(l[100], 0.5, 1e-6);
    near(r[100], 0.5, 1e-6);
  });

  test("no echo when off", () => {
    const mixer = new MixerShared();
    const l = new Float32Array(10);
    l[0] = 1;
    applyEcho(mixer, l, null, 10);
    assert.deepEqual(Array.from(l), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
