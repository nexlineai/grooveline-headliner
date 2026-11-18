// Port of HeadlinerCore/DrumMachine.swift. The studio's drum machine: voices made from arithmetic
// (no samples, so no codec delay), a 16-step pattern per voice, rendered offline into a record
// that an ordinary deck plays. The noise is the same xorshift as on the iPhone, so the same
// pattern sounds the same on both.

export const STEPS = 16;
export const VOICES = ["KICK", "CLAP", "HAT", "BASS", "CHORD"];
export const SAMPLE_RATE = 44_100;

/** What the player programmed: per voice (kick, clap, hat, bass, chord), sixteen steps of one
 * bar. The bass and the chord are in A minor (the studio's key). */
export class DrumPattern {
  rows: boolean[][];

  /** Missing rows (or steps) are filled in empty, so an older or shorter pattern still works. */
  constructor(rows?: boolean[][] | null) {
    const all = rows ? rows.slice() : [];
    while (all.length < VOICES.length) all.push([]);
    this.rows = all.map((row) => {
      const r = row.slice(0, STEPS);
      while (r.length < STEPS) r.push(false);
      return r;
    });
  }

  /** The steps that are on in a row (0-based). */
  on(row: number): number[] {
    const r = this.rows[row];
    if (!r) return [];
    const out: number[] = [];
    r.forEach((v, i) => { if (v) out.push(i); });
    return out;
  }

  /** The classic house groove: kick on every beat, clap on two and four, hats in between. */
  static readonly house = new DrumPattern([
    steps((s) => s % 4 === 0),
    steps((s) => s === 4 || s === 12),
    steps((s) => s % 4 === 2),
  ]);

  /** The house groove with the bass between the kicks and chord stabs before the clap. */
  static readonly track = new DrumPattern([
    ...DrumPattern.house.rows.slice(0, 3),
    steps((s) => s % 4 === 2),
    steps((s) => s === 3 || s === 11),
  ]);
}

function steps(on: (s: number) => boolean): boolean[] {
  return Array.from({ length: STEPS }, (_, s) => on(s));
}

/** A part of a record cut from the pattern: how many bars, and which rows play in it. */
export interface StudioSection { name: string; bars: number; rows: Set<number>; }

export interface Stereo { left: Float32Array; right: Float32Array; }

/** Frames in one bar at `bpm` (whole frames, so the bars tile exactly). */
export function barFrames(bpm: number): number {
  return Math.round(4 * 60 / bpm * SAMPLE_RATE);
}

/** Where step `s` of a bar starts, in frames. */
export function stepFrame(s: number, bpm: number): number {
  return Math.round(s * barFrames(bpm) / STEPS);
}

/** White noise that is the same every time (so the same pattern always sounds the same). */
export class Noise {
  state: number;
  constructor(seed: number) { this.state = (Math.imul(seed, 2_654_435_761) | 1) >>> 0; }
  next(): number {
    let s = this.state;
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    this.state = s;
    // Float arithmetic as on the iPhone (Float(state) / Float(UInt32.max) * 2 - 1).
    return Math.fround(Math.fround(Math.fround(s) / Math.fround(4_294_967_295)) * 2 - 1);
  }
}

/** One hit of a voice, mono: 0 kick, 1 clap, 2 hat, 3 bass (A, 110 Hz), 4 chord (A minor 7). */
export function voice(v: number): Float32Array {
  const sr = SAMPLE_RATE;
  const noise = new Noise(17 + v);
  switch (v) {
    case 0: {
      // Kick: a sine diving from 150 Hz to 50 Hz, starting at full swing (the click).
      const n = Math.trunc(0.4 * sr);
      const out = new Float32Array(n);
      let phase = Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        phase += 2 * Math.PI * (50 + 100 * Math.exp(-t * 28)) / sr;
        out[i] = Math.sin(phase) * Math.exp(-t * 7.5);
      }
      return out;
    }
    case 1: {
      // Clap: three quick bursts of noise, then a short tail, through a bright band.
      const n = Math.trunc(0.25 * sr);
      const out = new Float32Array(n);
      let fast = 0, slow = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const burst = t < 0.03 ? (t % 0.01 < 0.004 ? 1.0 : 0.25) : Math.exp(-(t - 0.03) * 22);
        const x = noise.next();
        fast = Math.fround(fast + 0.45 * (x - fast));  // low-pass, about 6 kHz
        slow = Math.fround(slow + 0.06 * (fast - slow)); // low-pass, about 450 Hz
        out[i] = (fast - slow) * burst * 1.2; // what lies between: the clap's band
      }
      return out;
    }
    case 3:
      // Bass: a saw on A (110 Hz) whose low-pass closes fast: a short, round pluck.
      return saws([110], 0.22, 2_400, 180, 18, 0.9, noise);
    case 4:
      // Chord: A minor 7 (A, C, E, G) on detuned saws, a bright stab that closes quickly.
      return saws([220, 261.63, 329.63, 392], 0.3, 3_200, 400, 12, 0.55, noise);
    default: {
      // Hat: bright noise with the low end taken out, gone in a few hundredths of a second.
      const n = Math.trunc(0.08 * sr);
      const out = new Float32Array(n);
      let prev = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const x = noise.next();
        const hp = Math.fround(0.85 * (last + x - prev)); // one-pole high-pass
        prev = x; last = hp;
        out[i] = hp * Math.exp(-t * 60) * 0.8;
      }
      return out;
    }
  }
}

/** Saws at `freqs` (two slightly detuned per note) through a low-pass that falls from `startHz`
 * to `endHz`, fading over `length` seconds. */
function saws(freqs: number[], length: number, startHz: number, endHz: number, decay: number, gain: number,
              noise: Noise): Float32Array {
  const sr = SAMPLE_RATE, n = Math.trunc(length * sr);
  const out = new Float32Array(n);
  const phases: number[] = [];
  for (let k = 0; k < freqs.length; k++) { phases.push(noise.next(), noise.next()); }
  for (let k = 0; k < phases.length; k++) phases[k] = Math.abs(phases[k]);
  const speeds: number[] = [];
  for (const f of freqs) speeds.push(f * 0.996 / sr, f * 1.004 / sr);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let x = 0;
    for (let k = 0; k < phases.length; k++) {
      phases[k] += speeds[k];
      if (phases[k] >= 1) phases[k] -= 1;
      x += 2 * phases[k] - 1;
    }
    x /= phases.length;
    const cutoff = endHz + (startHz - endHz) * Math.exp(-t * decay);
    y += (1 - Math.exp(-2 * Math.PI * cutoff / sr)) * (x - y); // one-pole low-pass
    const fade = Math.min(1, t * 400) * (t < length - 0.02 ? 1 : Math.max(0, (length - t) / 0.02));
    out[i] = y * fade * gain * 2;
  }
  return out;
}

/** How loud the full mix is cut: the RMS of our records' full sections (about -15 dBFS), so a
 * record from the studio sits level with the crate and the meters. */
export const TARGET_RMS = 0.178;

/** The dubplate: a whole record from one pattern, each section playing only some rows. */
export const ARRANGEMENT: StudioSection[] = [
  { name: "intro", bars: 16, rows: new Set([0, 2]) },
  { name: "groove", bars: 16, rows: new Set([0, 1, 2, 3]) },
  { name: "full", bars: 16, rows: new Set([0, 1, 2, 3, 4]) },
  { name: "break", bars: 8, rows: new Set([2, 4]) },
  { name: "full", bars: 16, rows: new Set([0, 1, 2, 3, 4]) },
  { name: "outro", bars: 8, rows: new Set([0, 2]) },
];

const ALL_ROWS = new Set(VOICES.map((_, i) => i));

/** The pattern played for `bars` bars at `bpm`, stereo. One bar is rendered (a hit that runs
 * past the end of the bar continues at its start) and repeated, so the record loops without a seam. */
export function renderLoop(pattern: DrumPattern, bpm: number, bars: number): Stereo {
  return renderSections(pattern, bpm, [{ name: "loop", bars, rows: ALL_ROWS }]);
}

/** The pattern played section by section (each section is one bar rendered with only its rows,
 * repeated), at the crate's level. `heavyLows`: kick and bass 6 dB up, a bad mixdown that booms
 * on a big system. */
export function renderSections(pattern: DrumPattern, bpm: number, sections: StudioSection[], heavyLows = false): Stereo {
  const gain = levelGain(pattern, bpm, heavyLows);
  const frames = barFrames(bpm);
  const total = sections.reduce((n, s) => n + Math.max(0, s.bars), 0) * frames;
  const left = new Float32Array(total), right = new Float32Array(total);
  let at = 0;
  for (const section of sections) {
    if (section.bars <= 0) continue;
    const bar = renderBar(pattern, bpm, section.rows, gain, heavyLows);
    for (let b = 0; b < section.bars; b++) {
      left.set(bar.left, at);
      right.set(bar.right, at);
      at += frames;
    }
  }
  return { left, right };
}

/** The gain that brings the full mix (every row) to `TARGET_RMS`: measured, then corrected twice
 * more for the soft clipping. 1 for a silent pattern; never more than 8. */
export function levelGain(pattern: DrumPattern, bpm: number, heavyLows: boolean): number {
  let gain = 1;
  for (let k = 0; k < 3; k++) {
    const bar = renderBar(pattern, bpm, ALL_ROWS, gain, heavyLows);
    let sum = 0;
    for (let i = 0; i < bar.left.length; i++) sum += bar.left[i] * bar.left[i] + bar.right[i] * bar.right[i];
    const rms = Math.sqrt(sum / (2 * Math.max(1, bar.left.length)));
    if (rms <= 1e-4) return 1;
    gain = Math.min(8, gain * (TARGET_RMS / rms));
  }
  return gain;
}

const LEVELS = [
  { gain: 0.9, left: 1, right: 1 }, { gain: 0.5, left: 1, right: 0.92 }, { gain: 0.3, left: 0.85, right: 1 },
  { gain: 0.7, left: 1, right: 1 }, { gain: 0.35, left: 0.9, right: 1 },
];

/** One bar of the rows asked for. */
export function renderBar(pattern: DrumPattern, bpm: number, rows: Set<number>, gain = 1, heavyLows = false): Stereo {
  const frames = barFrames(bpm);
  const barL = new Float32Array(frames), barR = new Float32Array(frames);
  for (let v = 0; v < Math.min(pattern.rows.length, LEVELS.length); v++) {
    if (!rows.has(v)) continue;
    const hit = voice(v), level = LEVELS[v];
    const boost = heavyLows && (v === 0 || v === 3) ? 2 : 1;
    for (let s = 0; s < STEPS; s++) {
      if (s >= pattern.rows[v].length || !pattern.rows[v][s]) continue;
      const start = stepFrame(s, bpm);
      for (let i = 0; i < hit.length; i++) {
        const j = (start + i) % frames;
        const x = hit[i] * level.gain * boost * gain;
        barL[j] += x * level.left;
        barR[j] += x * level.right;
      }
    }
  }
  for (let i = 0; i < frames; i++) {
    barL[i] = Math.tanh(barL[i]);
    barR[i] = Math.tanh(barR[i]);
  }
  return { left: barL, right: barR };
}
