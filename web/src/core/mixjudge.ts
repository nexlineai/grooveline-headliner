// Port of HeadlinerCore/MixJudge.swift (MixMath, DeckSnapshot, MixReading, MixJudge).

/** How far deck B's beat is from deck A's nearest beat, in beats: -0.5 ..< 0.5.
 * Positive means B's beats land late (B is behind), negative means B is ahead. */
export function phaseOffset(beatA: number, beatB: number): number {
  let d = (beatA - beatB) % 1;
  if (d >= 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

/** Pitch (as a fraction, 0.02 = +2 %) that makes a record of `bpm` play at `target`. */
export function pitchToPlay(bpm: number, target: number): number { return target / bpm - 1; }

/** Crossfader gains. Each side stays at full volume until the fader passes the middle. */
export function crossfade(x: number): { a: number; b: number } {
  const c = Math.min(1, Math.max(0, x));
  return { a: Math.min(1, 2 * (1 - c)), b: Math.min(1, 2 * c) };
}

/** Channel fader position (0...1) to gain, with an audio taper. */
export function faderGain(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c;
}

/** EQ knob (0...1, 0.5 is flat) to decibels: a full kill at the bottom, a small boost at the top. */
export function eqDecibels(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? -36 * (1 - 2 * c) : 6 * (2 * c - 1);
}

/** What one deck is doing at this instant, as far as the room can hear. */
export interface DeckSnapshot {
  playing: boolean;
  /** Channel fader and crossfader combined, 0...1. */
  gain: number;
  /** Tempo after the pitch fader. */
  bpm: number;
  /** Beat position on the record's grid. */
  beat: number;
  /** Low EQ knob, 0...1 (0.5 flat). */
  low: number;
}

export function audible(d: DeckSnapshot): boolean { return d.playing && d.gain > 0.03; }

export type MixState = "silence" | "solo" | "blend";

export interface MixReading {
  state: MixState;
  /** B against A in beats (see `phaseOffset`); 0 outside a blend. */
  offsetBeats: number;
  /** The same gap in milliseconds at A's tempo. */
  offsetMs: number;
  /** B's tempo minus A's, in BPM. */
  tempoGap: number;
  /** Both basslines up at once. */
  bassClash: boolean;
  /** 0 (train wreck) ... 1 (locked). 1 when only one record is heard. */
  quality: number;
}

export function verdict(r: MixReading): string {
  switch (r.state) {
    case "silence": return "SILENCE";
    case "solo": return "ONE DECK";
    case "blend":
      if (r.quality > 0.85) return "LOCKED";
      if (r.quality > 0.6) return "CLOSE";
      if (r.quality > 0.3) return "DRIFTING";
      return "TRAIN WRECK";
  }
}

export function readMix(a: DeckSnapshot, b: DeckSnapshot): MixReading {
  if (!audible(a) && !audible(b)) {
    return { state: "silence", offsetBeats: 0, offsetMs: 0, tempoGap: 0, bassClash: false, quality: 0 };
  }
  if (!(audible(a) && audible(b))) {
    return { state: "solo", offsetBeats: 0, offsetMs: 0, tempoGap: 0, bassClash: false, quality: 1 };
  }
  const offset = phaseOffset(a.beat, b.beat);
  const ms = offset * 60_000 / Math.max(a.bpm, 1);
  const gap = b.bpm - a.bpm;
  // Ears forgive about 12 ms; by 70 ms two kicks are clearly a gallop.
  const phaseScore = 1 - Math.min(1, Math.max(0, (Math.abs(ms) - 12) / 58));
  const tempoScore = 1 - Math.min(1, Math.max(0, (Math.abs(gap) - 0.05) / 0.95));
  const bassClash = a.low > 0.4 && b.low > 0.4 && a.gain > 0.5 && b.gain > 0.5;
  const quality = Math.max(0, phaseScore * 0.7 + tempoScore * 0.3 - (bassClash ? 0.2 : 0));
  return { state: "blend", offsetBeats: offset, offsetMs: ms, tempoGap: gap, bassClash, quality };
}
