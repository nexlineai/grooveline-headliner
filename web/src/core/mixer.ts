// Port of HeadlinerCore/Mixer.swift. The mixer as plain arithmetic the audio thread can run: per
// deck a three-band EQ, a one-knob filter, a fader to the room and a headphone cue switch; then
// either the room in stereo, or the room in the left ear and the headphones in the right
// ("split"), or two stereo outputs (a sound card with four outputs).

import { renderVinyl } from "./vinyl.ts";
import type { DeckShared } from "./vinyl.ts";

export type BiquadShape = "lowShelf" | "peak" | "highShelf" | "lowPass" | "highPass";

/** One second-order filter with its own memory for a left and a right channel. */
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  l1 = 0; l2 = 0; r1 = 0; r2 = 0;

  /** Sets the filter (Robert Bristow-Johnson's formulas). `q` is used by "peak" and the passes;
   * the shelves have the steepest slope that does not overshoot. The passes ignore `gainDB`. */
  set(shape: BiquadShape, frequency: number, gainDB: number, sampleRate: number, q = 0.86): void {
    const a = Math.pow(10, gainDB / 40);
    const w = 2 * Math.PI * Math.min(frequency, sampleRate * 0.45) / sampleRate;
    const cs = Math.cos(w), sn = Math.sin(w);
    let n0 = 1, n1 = 0, n2 = 0, d0 = 1, d1 = 0, d2 = 0;
    switch (shape) {
      case "peak": {
        const alpha = sn / (2 * q);
        n0 = 1 + alpha * a; n1 = -2 * cs; n2 = 1 - alpha * a;
        d0 = 1 + alpha / a; d1 = -2 * cs; d2 = 1 - alpha / a;
        break;
      }
      case "lowShelf": {
        const beta = 2 * Math.sqrt(a) * (sn / 2 * Math.SQRT2);
        n0 = a * ((a + 1) - (a - 1) * cs + beta);
        n1 = 2 * a * ((a - 1) - (a + 1) * cs);
        n2 = a * ((a + 1) - (a - 1) * cs - beta);
        d0 = (a + 1) + (a - 1) * cs + beta;
        d1 = -2 * ((a - 1) + (a + 1) * cs);
        d2 = (a + 1) + (a - 1) * cs - beta;
        break;
      }
      case "highShelf": {
        const beta = 2 * Math.sqrt(a) * (sn / 2 * Math.SQRT2);
        n0 = a * ((a + 1) + (a - 1) * cs + beta);
        n1 = -2 * a * ((a - 1) + (a + 1) * cs);
        n2 = a * ((a + 1) + (a - 1) * cs - beta);
        d0 = (a + 1) - (a - 1) * cs + beta;
        d1 = 2 * ((a - 1) - (a + 1) * cs);
        d2 = (a + 1) - (a - 1) * cs - beta;
        break;
      }
      case "lowPass":
      case "highPass": {
        const alpha = sn / (2 * q);
        const low = shape === "lowPass";
        n0 = low ? (1 - cs) / 2 : (1 + cs) / 2;
        n1 = low ? 1 - cs : -(1 + cs);
        n2 = n0;
        d0 = 1 + alpha; d1 = -2 * cs; d2 = 1 - alpha;
        break;
      }
    }
    this.b0 = n0 / d0; this.b1 = n1 / d0; this.b2 = n2 / d0;
    this.a1 = d1 / d0; this.a2 = d2 / d0;
  }

  /** Forgets what went through it. */
  clear(): void { this.l1 = 0; this.l2 = 0; this.r1 = 0; this.r2 = 0; }

  /** Filters `count` frames of both channels where they lie. */
  run(left: Float32Array, right: Float32Array, count: number): void {
    const b0 = this.b0, b1 = this.b1, b2 = this.b2, a1 = this.a1, a2 = this.a2;
    let z1 = this.l1, z2 = this.l2;
    for (let i = 0; i < count; i++) {
      const x = left[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      left[i] = y;
    }
    // Keep the memory from drifting into denormal numbers once the music stops.
    this.l1 = Math.abs(z1) < 1e-20 ? 0 : z1;
    this.l2 = Math.abs(z2) < 1e-20 ? 0 : z2;
    z1 = this.r1; z2 = this.r2;
    for (let i = 0; i < count; i++) {
      const x = right[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      right[i] = y;
    }
    this.r1 = Math.abs(z1) < 1e-20 ? 0 : z1;
    this.r2 = Math.abs(z2) < 1e-20 ? 0 : z2;
  }
}

/** One channel of the mixer. The game writes the wanted values; the audio thread glides to them. */
export class ChannelStrip {
  /** Wanted EQ, in decibels: low, mid, high. 0 is flat. */
  lowDB = 0;
  midDB = 0;
  highDB = 0;
  /** Channel fader and crossfader together, 0...1: how much of this deck the room hears. */
  fader = 1;
  /** 1 when this deck is switched to the headphones (before the fader), else 0. */
  cue = 0;
  /** The one-knob filter: -1 = low-pass all the way down, 0 = off, 1 = high-pass all the way up. */
  filter = 0;

  // The audio thread's own.
  lowNow = 0; midNow = 0; highNow = 0;
  faderNow = 0; cueNow = 0;
  filterNow = 0;
  low = new Biquad(); mid = new Biquad(); high = new Biquad(); sweep = new Biquad();
}

/** What the whole mixer is set to. */
export class MixerShared {
  /** false: the room in stereo on both channels. true: the room in the left ear, the headphones in the right. */
  split = false;
  /** What the headphones hear: 0 = only the cued decks, 1 = only the room. */
  cueMix = 0;
  /** Everything that comes out, 0...1 (turned down a little while a coach talks). */
  master = 1;
  masterNow = 1;
  sampleRate = 48_000;
  /** The far speakers of a big system: the room also hears the music `echoDelay` frames late (a
   * quieter copy); the headphones do not, like a DJ's monitors. 0 = off. The ring buffers
   * (`ECHO_CAPACITY` frames each) belong to the engine; null = no echo. */
  echoDelay = 0;
  echoGain = 0.5;
  echoL: Float32Array | null = null;
  echoR: Float32Array | null = null;
  echoWrite = 0;
}

export const LOW_HZ = 180, MID_HZ = 1_000, HIGH_HZ = 4_500;

/** Frames in each echo ring buffer (a third of a second at 48 kHz). */
export const ECHO_CAPACITY = 16_384;

/** Around the middle of the filter knob nothing is filtered. */
export const FILTER_DEAD_ZONE = 0.03;

/** One step of an EQ knob's gain towards where it was turned to (once per buffer). */
function glide(now: number, wanted: number): number {
  const next = now + (wanted - now) * 0.25;
  return Math.abs(wanted - next) < 0.02 ? wanted : next;
}

/** The filter's corner for a knob position: the low-pass closes from 20 kHz to 100 Hz, the
 * high-pass opens from 20 Hz to 8 kHz, both evenly in octaves along the knob. */
export function filterHz(position: number): number {
  const x = Math.max(-1, Math.min(1, position));
  return x < 0 ? 20_000 * Math.pow(100 / 20_000, -x) : 20 * Math.pow(8_000 / 20, x);
}

/** Adds the late copy from the far speakers to the room channels (`right` null: the room is one channel). */
export function applyEcho(mixer: MixerShared, left: Float32Array, right: Float32Array | null, count: number): void {
  const delay = Math.min(mixer.echoDelay, ECHO_CAPACITY - 1);
  const bl = mixer.echoL, br = mixer.echoR;
  if (delay <= 0 || !bl || !br) return;
  const gain = mixer.echoGain;
  let w = mixer.echoWrite;
  for (let i = 0; i < count; i++) {
    const r = (w - delay + ECHO_CAPACITY) % ECHO_CAPACITY;
    const l = left[i];
    left[i] = l + bl[r] * gain;
    bl[w] = l;
    if (right) {
      const x = right[i];
      right[i] = x + br[r] * gain;
      br[w] = x;
    }
    w = (w + 1) % ECHO_CAPACITY;
  }
  mixer.echoWrite = w;
}

/** Scratch room for one buffer of one deck (at least `count` frames each). */
export interface Scratch { left: Float32Array; right: Float32Array; }

/**
 * Mixes the decks into one stereo output, or into two when `phonesLeft` and `phonesRight` are
 * given: then `outL`/`outR` carry the room and the other pair carries the headphones, both in
 * stereo (a second sound output), and `split` is ignored. All arrays are written from index 0.
 */
export function renderMix(decks: DeckShared[], strips: ChannelStrip[], mixer: MixerShared, scratch: Scratch,
                          outL: Float32Array, outR: Float32Array,
                          phonesLeft: Float32Array | null, phonesRight: Float32Array | null, count: number): void {
  const split = mixer.split;
  const cueMix = Math.max(0, Math.min(1, mixer.cueMix));
  const rate = mixer.sampleRate;
  const tl = scratch.left, tr = scratch.right;
  for (let i = 0; i < count; i++) { outL[i] = 0; outR[i] = 0; }
  const pl = phonesLeft, pr = phonesRight;
  if (pl && pr) for (let i = 0; i < count; i++) { pl[i] = 0; pr[i] = 0; }

  for (let d = 0; d < decks.length; d++) {
    const strip = strips[d];
    // The record, before the fader.
    renderVinyl(decks[d], tl, tr, count);

    // EQ: follow the knobs, re-tune a band only while it is moving.
    if (strip.lowNow !== strip.lowDB) {
      const g = glide(strip.lowNow, strip.lowDB);
      strip.lowNow = g;
      strip.low.set("lowShelf", LOW_HZ, g, rate);
      if (g === 0) strip.low.clear();
    }
    if (strip.midNow !== strip.midDB) {
      const g = glide(strip.midNow, strip.midDB);
      strip.midNow = g;
      strip.mid.set("peak", MID_HZ, g, rate);
      if (g === 0) strip.mid.clear();
    }
    if (strip.highNow !== strip.highDB) {
      const g = glide(strip.highNow, strip.highDB);
      strip.highNow = g;
      strip.high.set("highShelf", HIGH_HZ, g, rate);
      if (g === 0) strip.high.clear();
    }
    if (strip.lowNow !== 0) strip.low.run(tl, tr, count);
    if (strip.midNow !== 0) strip.mid.run(tl, tr, count);
    if (strip.highNow !== 0) strip.high.run(tl, tr, count);

    // Filter: glides like the EQ, re-tuned only while the knob moves; off in the middle.
    if (strip.filterNow !== strip.filter) {
      const wanted = Math.max(-1, Math.min(1, strip.filter));
      let f = strip.filterNow + (wanted - strip.filterNow) * 0.3;
      if (Math.abs(wanted - f) < 0.002) f = wanted;
      const crossed = (f < 0) !== (strip.filterNow < 0);
      strip.filterNow = f;
      if (Math.abs(f) < FILTER_DEAD_ZONE || crossed) strip.sweep.clear();
      if (Math.abs(f) >= FILTER_DEAD_ZONE) {
        strip.sweep.set(f < 0 ? "lowPass" : "highPass", filterHz(f), 0, rate, 1.0);
      }
    }
    if (Math.abs(strip.filterNow) >= FILTER_DEAD_ZONE) strip.sweep.run(tl, tr, count);

    let fader = strip.faderNow, cue = strip.cueNow;
    const faderWanted = strip.fader, cueWanted = strip.cue;
    if (pl && pr) {
      // Two outputs: the room on one, the headphones on the other, both in stereo.
      for (let i = 0; i < count; i++) {
        fader += (faderWanted - fader) * 0.004;
        cue += (cueWanted - cue) * 0.004;
        const l = tl[i], r = tr[i];
        outL[i] += l * fader;
        outR[i] += r * fader;
        const heard = cue * (1 - cueMix) + fader * cueMix;
        pl[i] += l * heard;
        pr[i] += r * heard;
      }
    } else if (split) {
      // Left: the room, in mono. Right: the headphones, in mono.
      for (let i = 0; i < count; i++) {
        fader += (faderWanted - fader) * 0.004;
        cue += (cueWanted - cue) * 0.004;
        const mono = (tl[i] + tr[i]) * 0.5;
        const room = mono * fader;
        outL[i] += room;
        outR[i] += mono * cue * (1 - cueMix) + room * cueMix;
      }
    } else {
      for (let i = 0; i < count; i++) {
        fader += (faderWanted - fader) * 0.004;
        cue += (cueWanted - cue) * 0.004;
        outL[i] += tl[i] * fader;
        outR[i] += tr[i] * fader;
      }
    }
    strip.faderNow = fader;
    strip.cueNow = cue;
  }

  // Master volume, gliding (about 10 ms) so a change makes no click.
  let master = mixer.masterNow;
  const masterWanted = Math.max(0, Math.min(1, mixer.master));
  if (master !== 1 || masterWanted !== 1) {
    if (pl && pr) {
      for (let i = 0; i < count; i++) {
        master += (masterWanted - master) * 0.002;
        outL[i] *= master; outR[i] *= master;
        pl[i] *= master; pr[i] *= master;
      }
    } else {
      for (let i = 0; i < count; i++) {
        master += (masterWanted - master) * 0.002;
        outL[i] *= master; outR[i] *= master;
      }
    }
    if (Math.abs(master - masterWanted) < 1e-4) master = masterWanted;
    mixer.masterNow = master;
  }

  // The far speakers: only the room is late, never the headphones.
  if (pl) applyEcho(mixer, outL, outR, count);
  else if (split) applyEcho(mixer, outL, null, count);
  else applyEcho(mixer, outL, outR, count);
}
