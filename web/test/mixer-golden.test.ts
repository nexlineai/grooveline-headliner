// The mixer core (core/mixer.ts, a twin of the Swift one) with every web-only extra OFF must be exactly what it was: the game's booth and its
// Swift tests depend on it. A busy scenario is rendered in the three output layouts (plain, split on one cable, a second pair for the headphones)
// and fingerprinted (sha256 of every output sample). The per-channel effect send is one of the extras: with it off, nothing changes.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { newDeckShared } from "../src/core/vinyl.ts";
import { ChannelStrip, MixerShared, renderMix } from "../src/core/mixer.ts";

/** Two decks playing noisy tones; EQ, filter, faders, cue and cue mix move while it runs; odd block sizes. */
export function mixerScenario(layout: "plain" | "split" | "two", withSends = false): string {
  const rate = 48000, frames = 40000;
  const make = (seed0: number, hz: number) => {
    let seed = seed0;
    const l = new Float32Array(frames), r = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      l[i] = 0.45 * Math.sin(2 * Math.PI * hz * i / rate) + ((seed / 4294967296) - 0.5) * 0.08;
      r[i] = 0.35 * Math.sin(2 * Math.PI * hz * 1.5 * i / rate + 1) + ((seed / 4294967296) - 0.5) * 0.08;
    }
    const s = newDeckShared();
    s.left = l; s.right = r; s.frames = frames; s.gain = 1; s.targetGain = 1; s.rate = 1; s.targetRate = 1; s.position = 50; s.step = 1;
    return s;
  };
  const decks = [make(3, 220), make(9, 660)];
  const strips = [new ChannelStrip(), new ChannelStrip()];
  const mixer = new MixerShared();
  mixer.sampleRate = rate; mixer.split = layout === "split"; mixer.cueMix = 0.3;
  if (withSends) { mixer.fxSend[0] = 1; mixer.fxSend[1] = 0.5; }
  const bus = { l: new Float32Array(1024), r: new Float32Array(1024) };
  const h = createHash("sha256");
  const scratch = { left: new Float32Array(1024), right: new Float32Array(1024) };
  const moves: [() => void, number][] = [
    [() => { strips[0].lowDB = -9; strips[1].highDB = 5; strips[0].cue = 1; }, 5000],
    [() => { strips[0].filter = -0.6; strips[1].fader = 0.5; mixer.cueMix = 0.7; }, 7001],
    [() => { strips[1].filter = 0.5; strips[0].midDB = 4; strips[1].cue = 1; strips[0].fader = 0.8; }, 6143],
    [() => { mixer.master = 0.6; strips[0].filter = 0; }, 9000],
    [() => { mixer.master = 1; strips[1].midDB = -6; strips[0].cue = 0; }, 8000],
  ];
  for (const [act, n] of moves) {
    act();
    let left = n;
    while (left > 0) {
      const k = Math.min(left, 128 + (left % 5) * 61);
      const a = new Float32Array(k), b = new Float32Array(k);
      if (layout === "two") {
        const pl = new Float32Array(k), pr = new Float32Array(k);
        renderMix(decks, strips, mixer, scratch, a, b, pl, pr, k, ...(withSends ? [bus.l, bus.r] as const : [null, null] as const));
        h.update(Buffer.from(pl.buffer)); h.update(Buffer.from(pr.buffer));
      } else renderMix(decks, strips, mixer, scratch, a, b, null, null, k, ...(withSends ? [bus.l, bus.r] as const : [null, null] as const));
      h.update(Buffer.from(a.buffer)); h.update(Buffer.from(b.buffer));
      left -= k;
    }
  }
  return h.digest("hex");
}

describe("the mixer core with the web-only extras off", () => {
  test("is bit for bit what it was (plain, split, two pairs)", () => {
    assert.equal(mixerScenario("plain"), "d9b915d26158eaf0ff19c52114d4149bedc4b2a56cd20309c300c87242d3efc0");
    assert.equal(mixerScenario("split"), "23080b79eafaf2e13b224f353fa728447a8b431ee6c1d79733c3bad41c9d6f8d");
    assert.equal(mixerScenario("two"), "19a3f050f85f121a5ba91ceb9c8b50ef684413c0f8ef41acfd0a1bd6f1284b54");
  });
});

describe("the effect send (web only)", () => {
  test("a send bus changes nothing in the room or the headphones: the main outputs are the same bits with the bus on", () => {
    assert.equal(mixerScenario("plain", true), mixerScenario("plain"));
    assert.equal(mixerScenario("split", true), mixerScenario("split"));
    assert.equal(mixerScenario("two", true), mixerScenario("two"));
  });

  /** One deck playing a tone at its fader, the other silent; returns the main left output and the bus after the send has glided in. */
  function oneDeck(send: [number, number], faders: [number, number]) {
    const frames = 6000, rate = 48000;
    const mk = (hz: number) => {
      const t = new Float32Array(frames * 2);
      for (let i = 0; i < t.length; i++) t[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / rate);
      const s = newDeckShared();
      s.left = t; s.right = t; s.frames = t.length; s.gain = 1; s.targetGain = 1; s.rate = 1; s.targetRate = 1; s.position = 1; s.step = 1;
      return s;
    };
    const decks = [mk(440), mk(1000)];
    const strips = [new ChannelStrip(), new ChannelStrip()];
    strips[0].fader = strips[0].faderNow = faders[0]; strips[1].fader = strips[1].faderNow = faders[1];
    const mixer = new MixerShared();
    mixer.sampleRate = rate; mixer.fxSend[0] = send[0]; mixer.fxSend[1] = send[1];
    const out = new Float32Array(frames), outR = new Float32Array(frames), busL = new Float32Array(frames), busR = new Float32Array(frames);
    const scratch = { left: new Float32Array(512), right: new Float32Array(512) };
    for (let d = 0; d < frames; d += 500) {
      const n = Math.min(500, frames - d);
      renderMix(decks, strips, mixer, scratch, out.subarray(d, d + n), outR.subarray(d, d + n), null, null, n, busL.subarray(d, d + n), busR.subarray(d, d + n));
    }
    return { out, bus: busL, busR };
  }

  test("the bus carries the channels that are switched on, after their faders, and nothing of the others", () => {
    const a = oneDeck([1, 0], [0.8, 0.8]);
    // After the send has glided in (a few ms), the bus is deck A alone: the main output is A + B, the bus only A.
    const only = oneDeck([0, 0], [0.8, 0]); // A alone at 0.8, for the level to compare with
    for (let i = 3000; i < 3100; i++) assert.ok(Math.abs(a.bus[i] - only.out[i]) < 3e-4, `sample ${i}`); // the send has glided in to within 0.01 %
    assert.ok(Math.abs(a.out[3050]) > 0 && a.out[3050] !== a.bus[3050], "the room still has both decks");
    const none = oneDeck([0, 0], [0.8, 0.8]);
    assert.ok(none.bus.every((x) => x === 0), "no channel switched on: an empty bus");
  });

  test("the send is taken after the fader: a channel at 0.25 sends a quarter as much, and a closed fader sends nothing", () => {
    const loud = oneDeck([1, 0], [1, 0]), quiet = oneDeck([1, 0], [0.25, 0]), closed = oneDeck([1, 0], [0, 0]);
    let a = 0, b = 0, c = 0;
    for (let i = 3000; i < 3200; i++) { a = Math.max(a, Math.abs(loud.bus[i])); b = Math.max(b, Math.abs(quiet.bus[i])); c = Math.max(c, Math.abs(closed.bus[i])); }
    assert.ok(Math.abs(b / a - 0.25) < 0.02, `ratio ${b / a}`);
    assert.ok(c < 1e-6);
  });

  test("switching a channel on does not click: the send glides in over a few milliseconds", () => {
    const r = oneDeck([1, 0], [1, 0]);
    let step = 0;
    for (let i = 1; i < 400; i++) step = Math.max(step, Math.abs(r.bus[i] - r.bus[i - 1]));
    assert.ok(step < 0.1, `largest step ${step}`); // a 440 Hz tone at 0.5 steps at most 0.03
  });
});
