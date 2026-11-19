// Hot cues, loops and the fine waveform peaks (audio/engine.ts Deck, audio/peaks.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Deck, Shared } from "../src/audio/engine.ts";
import { D, deckAt } from "../src/audio/layout.ts";
import { PEAK_BASE, buildPeaks, levelFor, peakBetween } from "../src/audio/peaks.ts";
import type { TrackInfo } from "../src/core/beatgrid.ts";

const info: TrackInfo = { id: "t", title: "T", artist: "A", label: "", genre: "", bpm: 120, key: "", camelot: "8A", bars: 8, seconds: 60, file: "t" };
/** A 60 second record at 48 kHz with a 120 BPM grid from 0 (a beat every half second), the deck standing at `at` seconds. */
function deckAt120(at = 0, rate = 0): { deck: Deck; shared: Shared } {
  const shared = new Shared(), deck = new Deck(shared, 0);
  const n = 48000 * 60, l = new Float32Array(n).fill(0.1);
  deck.loadMade(info, l, l.slice(), 48000);
  shared.values[deckAt(0, D.position)] = at * 48000;
  shared.values[deckAt(0, D.rate)] = rate;
  return { deck, shared };
}
const loopFrames = (s: Shared) => [s.get(deckAt(0, D.loopStart)), s.get(deckAt(0, D.loopEnd))];

describe("hot cues", () => {
  test("an empty pad is set where the needle is (exactly, when standing still); a set pad jumps there; a pad can be cleared", () => {
    const { deck, shared } = deckAt120(12.34);
    let saved = 0; deck.onMarks = () => saved++;
    deck.hotCuePress(2);
    assert.equal(deck.hotCues[2], 12.34);
    assert.equal(saved, 1);
    shared.values[deckAt(0, D.position)] = 40 * 48000;
    deck.hotCuePress(2);
    assert.equal(shared.get(deckAt(0, D.seekTo)), Math.round(12.34 * 48000) + 0 || 12.34 * 48000);
    deck.clearHotCue(2);
    assert.equal(deck.hotCues[2], null);
    assert.equal(saved, 2);
    deck.clearHotCue(2);
    assert.equal(saved, 2, "clearing an empty pad changes nothing");
  });

  test("while the record turns a new cue goes on the beat, and a jump keeps the beat phase", () => {
    const { deck, shared } = deckAt120(12.34, 1); // 12.34 s: 24.68 beats in: the nearest beat is 12.5 s
    deck.hotCuePress(0);
    assert.ok(Math.abs(deck.hotCues[0]! - 12.5) < 1e-9, String(deck.hotCues[0]));
    // Jump from 30.1 s (0.2 of the way through a beat) to the cue: lands 0.2 of a beat after the cue's beat.
    shared.values[deckAt(0, D.position)] = 30.1 * 48000;
    deck.hotCuePress(0);
    const landed = shared.get(deckAt(0, D.seekTo)) / 48000;
    const beatsIn = landed / 0.5;
    assert.ok(Math.abs(beatsIn - Math.round(beatsIn) - (60.2 - Math.floor(60.2))) < 0.02 || Math.abs((beatsIn % 1) - (60.2 % 1)) < 0.02, `landed ${landed}`);
    deck.quantize = false;
    deck.hotCuePress(0);
    assert.ok(Math.abs(shared.get(deckAt(0, D.seekTo)) / 48000 - 12.5) < 1e-9, "without quantize, exactly the cue");
  });

  test("marks come and go with a library track; rubbish is dropped; a new record starts clean", () => {
    const { deck } = deckAt120();
    deck.setMarks({ cues: [1, null, 5.5, NaN, -3, 999, 10, 20, 30], loops: [{ start: 2, end: 4 }, { start: 5, end: 5 }, null, { start: -1, end: 4 }, { start: 3, end: 2 }] });
    assert.deepEqual(deck.hotCues, [1, null, 5.5, null, null, null, 10, 20]);
    assert.deepEqual(deck.loopSlots.map((l) => !!l), [true, false, false, false, false, false, false, false]);
    const m = deck.marks();
    assert.deepEqual(m.cues, deck.hotCues);
    m.cues[0] = 99; assert.equal(deck.hotCues[0], 1, "what is handed out is a copy");
    deck.loadMade({ ...info, id: "u" }, new Float32Array(48000 * 30), new Float32Array(48000 * 30), 48000);
    assert.ok(deck.hotCues.every((c) => c === null) && deck.loopSlots.every((l) => l === null));
  });
});

describe("loops", () => {
  test("IN then OUT make a loop that starts to turn; the audio thread gets it in frames; the loop is off until OUT", () => {
    const { deck, shared } = deckAt120(10);
    deck.loopIn();
    assert.equal(deck.loopOn, false);
    assert.deepEqual(loopFrames(shared), [0, 0]);
    shared.values[deckAt(0, D.position)] = 14 * 48000;
    deck.loopOut();
    assert.equal(deck.loopOn, true);
    assert.deepEqual(loopFrames(shared), [10 * 48000, 14 * 48000]);
    deck.toggleLoop();
    assert.equal(deck.loopOn, false);
    assert.deepEqual(loopFrames(shared), [0, 0], "off means the audio thread is told zeros");
    shared.values[deckAt(0, D.position)] = 20 * 48000;
    deck.toggleLoop();
    assert.equal(deck.loopOn, true);
    assert.equal(shared.get(deckAt(0, D.seekTo)), 10 * 48000, "turning it on again from outside goes back into it");
  });

  test("OUT before IN, or a loop shorter than 20 ms, is refused", () => {
    const { deck, shared } = deckAt120(10);
    deck.loopOut();
    assert.equal(deck.loopOn, false);
    deck.loopIn();
    shared.values[deckAt(0, D.position)] = 10.01 * 48000;
    deck.loopOut();
    assert.equal(deck.loopOn, false);
  });

  test("an auto loop starts on the beat the needle is on and is the number of beats asked for; halve and double", () => {
    const { deck, shared } = deckAt120(3.2); // 6.4 beats in: nearest beat 6 = 3.0 s
    deck.autoLoop(4);
    assert.ok(deck.loopOn);
    assert.ok(Math.abs(deck.loopStart - 3) < 1e-9 && Math.abs(deck.loopEnd - 5) < 1e-9, `${deck.loopStart}..${deck.loopEnd}`);
    deck.loopScale(0.5);
    assert.ok(Math.abs(deck.loopEnd - 4) < 1e-9);
    deck.loopScale(2); deck.loopScale(2);
    assert.ok(Math.abs(deck.loopEnd - 7) < 1e-9);
    assert.deepEqual(loopFrames(shared), [3 * 48000, 7 * 48000]);
  });

  test("a saved loop: an empty pad keeps the loop, a full one brings it back and starts it; a jump out of the loop leaves it, a jump inside keeps it", () => {
    const { deck, shared } = deckAt120(3.2);
    deck.loopSlotPress(1);
    assert.equal(deck.loopSlots[1], null, "no loop yet: nothing to keep");
    deck.autoLoop(2);
    deck.loopSlotPress(1);
    assert.deepEqual(deck.loopSlots[1], { start: deck.loopStart, end: deck.loopEnd });
    deck.toggleLoop();
    deck.loopSlotPress(1);
    assert.ok(deck.loopOn);
    deck.jumpTo(3.5);
    assert.ok(deck.loopOn, "a jump inside the loop keeps it");
    deck.jumpTo(30);
    assert.equal(deck.loopOn, false, "a jump away leaves it");
    assert.deepEqual(loopFrames(shared), [0, 0]);
    deck.clearLoopSlot(1);
    assert.equal(deck.loopSlots[1], null);
  });
});

describe("the fine peaks", () => {
  test("every level is the loudest of the one before; the display is scaled by the loudest sample", () => {
    const n = PEAK_BASE * 1000, l = new Float32Array(n), r = new Float32Array(n);
    l[PEAK_BASE * 10 + 5] = 0.5; r[PEAK_BASE * 700 + 1] = -0.8;
    const p = buildPeaks(l, r, n);
    assert.equal(p.max, Math.fround(0.8));
    assert.equal(p.levels[0].length, 1000);
    assert.equal(p.levels[0][10], 0.5); assert.equal(p.levels[0][700], Math.fround(0.8));
    assert.ok(p.levels.length >= 3 && p.levels[p.levels.length - 1].length <= 64);
    for (let k = 1; k < p.levels.length; k++) for (let i = 0; i < p.levels[k].length; i++) {
      let m = 0; for (let j = 4 * i; j < Math.min(p.levels[k - 1].length, 4 * i + 4); j++) m = Math.max(m, p.levels[k - 1][j]);
      assert.equal(p.levels[k][i], m, `level ${k} bin ${i}`);
    }
  });

  test("a level is chosen so that one bin is no bigger than a pixel, and a range answers with its loudest part", () => {
    const n = PEAK_BASE * 4096, l = new Float32Array(n), r = new Float32Array(n);
    l[PEAK_BASE * 1234 + 7] = 1;
    const p = buildPeaks(l, r, n);
    assert.deepEqual(levelFor(p, 100), { level: 0, bin: PEAK_BASE });
    assert.deepEqual(levelFor(p, PEAK_BASE * 4), { level: 1, bin: PEAK_BASE * 4 });
    assert.equal(levelFor(p, PEAK_BASE * 10).level, 1);
    assert.equal(levelFor(p, PEAK_BASE * 20).level, 2);
    assert.equal(levelFor(p, PEAK_BASE * 70).level, 3);
    for (const level of [0, 1, 2]) {
      assert.equal(peakBetween(p, level, PEAK_BASE * 1234, PEAK_BASE * 1235), 1);
      assert.equal(peakBetween(p, level, 0, PEAK_BASE * 100), 0);
    }
    assert.equal(peakBetween(p, 0, n * 2, n * 3), 0, "beyond the record");
    assert.equal(peakBetween(p, 0, -5000, 10), 0);
  });
});
