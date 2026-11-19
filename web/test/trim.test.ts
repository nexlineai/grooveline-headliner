// The channel gain knob (web only, free play): the dB map, and that it reaches the sound through
// the deck's needle gain without a lift, a load or a needle drop ever putting it back to 0 dB.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TRIM_MAX_DB, TRIM_MIN_DB, trimDecibels, trimGainFor } from "../src/audio/fx.ts";
import { Deck, Shared } from "../src/audio/engine.ts";
import { D, deckAt } from "../src/audio/layout.ts";
import { newDeckShared, renderVinyl } from "../src/core/vinyl.ts";
import type { TrackInfo } from "../src/core/beatgrid.ts";

const db = (g: number) => 20 * Math.log10(g);
const track: TrackInfo = { id: "t", title: "T", artist: "A", label: "", genre: "", bpm: 120, key: "", camelot: "8A", bars: 8, seconds: 1, file: "t" };

describe("gain knob map", () => {
  test("0 dB exactly at the middle, -24 dB at the bottom, +6 dB at the top", () => {
    assert.equal(trimGainFor(0.5), 1);
    assert.equal(trimDecibels(0), TRIM_MIN_DB);
    assert.equal(trimDecibels(1), TRIM_MAX_DB);
    assert.ok(Math.abs(db(trimGainFor(0)) + 24) < 1e-9);
    assert.ok(Math.abs(db(trimGainFor(1)) - 6) < 1e-9);
    assert.ok(Math.abs(db(trimGainFor(0.25)) + 12) < 1e-9); // half the cut travel = -12 dB
  });

  test("always rising with the knob, and out-of-range values are held at the ends", () => {
    let last = -Infinity;
    for (let i = 0; i <= 100; i++) { const g = trimGainFor(i / 100); assert.ok(g > last); last = g; }
    assert.equal(trimDecibels(-3), TRIM_MIN_DB);
    assert.equal(trimDecibels(7), TRIM_MAX_DB);
  });
});

describe("gain knob on a deck", () => {
  const target = (shared: Shared) => shared.get(deckAt(0, D.targetGain));

  test("a deck nobody touched plays at exactly the old level", () => {
    const shared = new Shared();
    const deck = new Deck(shared, 0);
    assert.equal(target(shared), 1);
    assert.equal(deck.trim, 0.5);
  });

  test("the knob sets the needle gain; lifting the needle silences it and putting it down brings the trim back", () => {
    const shared = new Shared();
    const deck = new Deck(shared, 0);
    deck.trim = 0.25;
    assert.ok(Math.abs(db(target(shared)) + 12) < 1e-9);
    deck.lifted = true;
    assert.equal(target(shared), 0);
    deck.trim = 0.1; // turned while lifted: still silent
    assert.equal(target(shared), 0);
    deck.lifted = false;
    assert.ok(Math.abs(db(target(shared)) - db(trimGainFor(0.1))) < 1e-9);
  });

  test("a new record (loaded or made) keeps the knob where it is", () => {
    const shared = new Shared();
    const deck = new Deck(shared, 0);
    deck.trim = 0.3;
    const samples = new Float32Array(4800).fill(0.5);
    deck.loadMade(track, samples, samples, 48_000);
    assert.equal(target(shared), trimGainFor(0.3));
    deck.lifted = true;
    deck.loadMade({ ...track, id: "u" }, samples, samples, 44_100); // a different length: a real swap
    assert.equal(target(shared), trimGainFor(0.3)); // loading puts the needle down again, at the trim
  });

  test("the sound follows: the record's peak drops by the knob's dB, before anything else touches it", () => {
    const shared = new Shared();
    const deck = new Deck(shared, 0);
    const peakAt = (knob: number): number => {
      deck.trim = knob;
      const s = newDeckShared();
      const data = new Float32Array(48_000).fill(0.8);
      s.left = data; s.right = data; s.frames = data.length;
      s.position = 100; s.rate = 1; s.targetRate = 1; s.gain = 1; s.targetGain = shared.get(deckAt(0, D.targetGain));
      const l = new Float32Array(20_000), r = new Float32Array(20_000);
      renderVinyl(s, l, r, l.length); // the gain glides (5 ms) to its target; the end is settled
      return Math.max(...l.slice(15_000).map(Math.abs));
    };
    const flat = peakAt(0.5), cut = peakAt(0.3);
    assert.ok(Math.abs(flat - 0.8) < 1e-5);
    assert.ok(Math.abs(db(cut / flat) - trimDecibels(0.3)) < 0.01);
  });
});
