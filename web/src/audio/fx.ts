// The web's master section: the effect unit (delay, reverb, flanger) and the headphones level. It
// has no Swift twin, so it lives here and not in core/. The audio thread calls `process` right
// after `renderMix` (and before the second device's ring is filled), so every phones mode hears both.
//
// The effect is a wet return on the room bus: dry stays at full level, the wet is added to the
// room, and to the headphones as much as the cue mix lets the room in (a real mixer's headphone
// master side is post-effect). Off and finished ringing, `process` does nothing at all: the sound
// is bit for bit what it was before the unit existed.

/** Knob position at which the headphones are as loud as before the knob existed (unity gain). */
export const PHONES_UNITY = 0.7;

/** The master knob (LIVE) at which the room is as loud as the mixer makes it (unity). The knob rests here, a quarter of the way down from the top,
 * with 6 dB of headroom above it for a quiet system, as a mixer's master has its 0 dB mark. */
export const ROOM_UNITY = 0.75;

/** Master knob 0...1 -> the room's gain: a straight line from silence up to unity at 0.75 (so the knob at 0.375 is -6 dB), then up to +6 dB at the top. */
export function roomGainFor(knob: number): number {
  const x = Math.max(0, Math.min(1, knob));
  if (x === ROOM_UNITY) return 1;
  return x < ROOM_UNITY ? x / ROOM_UNITY : Math.pow(10, 6 * (x - ROOM_UNITY) / (1 - ROOM_UNITY) / 20);
}

/** Headphones level, knob 0...1 -> gain: -60 dB at the bottom (silent from 2 %), unity at 0.7, +6 dB at the top. */
export function phonesGainFor(knob: number): number {
  const x = Math.max(0, Math.min(1, knob));
  if (x <= 0.02) return 0;
  const dB = x <= PHONES_UNITY ? -60 * (PHONES_UNITY - x) / PHONES_UNITY : 6 * (x - PHONES_UNITY) / (1 - PHONES_UNITY);
  return Math.pow(10, dB / 20);
}

/** The channel's gain knob (the trim, free play): knob 0...1 -> dB. 0 dB at the middle (0.5), down to
 * -24 dB at the bottom for records that are mastered too loud, up to +6 dB at the top for quiet ones. */
export const TRIM_MIN_DB = -24;
export const TRIM_MAX_DB = 6;

export function trimDecibels(knob: number): number {
  const x = Math.max(0, Math.min(1, knob));
  return x <= 0.5 ? TRIM_MIN_DB * (0.5 - x) / 0.5 : TRIM_MAX_DB * (x - 0.5) / 0.5;
}

/** The trim as a gain; exactly 1 at the middle, so a knob left alone changes nothing. */
export function trimGainFor(knob: number): number {
  const dB = trimDecibels(knob);
  return dB === 0 ? 1 : Math.pow(10, dB / 20);
}

/** Transparent below 0.9, a soft knee above it, never beyond 1: boosted headphones must not hard-clip at the device. */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.9) return x;
  const y = 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1);
  return x < 0 ? -y : y;
}


// MARK: - The effects

export const FX_TYPES = ["DELAY", "REVERB", "FLANGER", "PHASER", "FILTER", "FLG+FLT", "DLY+FLT"] as const;
export const FX = { delay: 0, reverb: 1, flanger: 2, phaser: 3, filter: 4, flangerFilter: 5, delayFilter: 6 } as const;
/** The note values (1/4 = one beat). A sweep (flanger, phaser, filter) takes eight of them to go round. */
export const FX_DIVISIONS = [
  { label: "1/4", beats: 1 }, { label: "1/8", beats: 0.5 }, { label: "1/16", beats: 0.25 }, { label: "1/32", beats: 0.125 },
] as const;

/** Seconds of one note value at a tempo (120 BPM: a 1/4 is 0.5 s, a 1/8 is 0.25 s). */
export function beatDelaySeconds(bpm: number, division: number): number {
  const d = FX_DIVISIONS[Math.max(0, Math.min(FX_DIVISIONS.length - 1, Math.trunc(division)))];
  return (60 / Math.max(40, bpm)) * d.beats;
}

/** One of the four knobs of an effect: its name, and, for a stepped knob, the names of its steps. The `tempo` knob picks the note value. */
export interface FxKnob { name: string; steps?: readonly string[]; tempo?: boolean }
const NOTE = FX_DIVISIONS.map((d) => d.label);
const TEMPO: FxKnob = { name: "", steps: NOTE, tempo: true };
const tempo = (name: string): FxKnob => ({ ...TEMPO, name });
/** What the four knobs of each effect are (the order of FX_TYPES). */
export const FX_KNOBS: readonly (readonly FxKnob[])[] = [
  [tempo("TIME"), { name: "FEEDBACK" }, { name: "TONE" }, { name: "WIDTH" }],
  [{ name: "SIZE" }, { name: "DAMP" }, { name: "PRE" }, { name: "WIDTH" }],
  [tempo("RATE"), { name: "DEPTH" }, { name: "FEEDBACK" }, { name: "MANUAL" }],
  [tempo("RATE"), { name: "DEPTH" }, { name: "FEEDBACK" }, { name: "STAGES", steps: ["4", "6", "8", "12"] }],
  [{ name: "CUTOFF" }, { name: "RESO" }, { name: "SWEEP" }, tempo("RATE")],
  [tempo("RATE"), { name: "DEPTH" }, { name: "FEEDBACK" }, { name: "CUTOFF" }],
  [tempo("TIME"), { name: "FEEDBACK" }, { name: "CUTOFF" }, { name: "RESO" }],
];
/** Where each effect's knobs rest (0...1; a stepped knob rests on a step). */
export const FX_DEFAULTS: readonly (readonly number[])[] = [
  [1 / 3, 0.55, 0.65, 0],
  [0.84, 0.2, 0, 1],
  [1 / 3, 0.8, 0.65, 0.15],
  [1 / 3, 0.65, 0.5, 1 / 3],
  [0.3, 0.35, 0, 1 / 3],
  [1 / 3, 0.7, 0.6, 0.65],
  [1 / 3, 0.55, 0.35, 0.3],
];
/** The knob that picks the note value (-1: this effect has none). */
export const fxTempoKnob = (type: number): number => (FX_KNOBS[type] ?? []).findIndex((k) => k.tempo);
/** A stepped knob's step for a value 0...1, and the value that sits on a step. */
export const stepIndex = (value: number, count: number): number => Math.max(0, Math.min(count - 1, Math.round(Math.max(0, Math.min(1, value)) * (count - 1))));
export const stepValue = (index: number, count: number): number => (count > 1 ? Math.max(0, Math.min(count - 1, index)) / (count - 1) : 0);

const clamp01 = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);

/** One channel of a second-order filter (RBJ cookbook), for the loops and the sweeps. */
class Bq {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  set(low: boolean, hz: number, q: number, rate: number): void {
    const w = 2 * Math.PI * Math.min(hz, rate * 0.45) / rate, cs = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
    const n0 = low ? (1 - cs) / 2 : (1 + cs) / 2, n1 = low ? 1 - cs : -(1 + cs);
    this.b0 = n0 / a0; this.b1 = n1 / a0; this.b2 = n0 / a0; this.a1 = -2 * cs / a0; this.a2 = (1 - alpha) / a0;
  }
  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = Math.abs(y) < 1e-18 ? 0 : y;
    return y;
  }
  clear(): void { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
}

/** A morphing filter knob, 0...1: left of the middle a low-pass closing from 18 kHz down to 80 Hz, right of it a high-pass opening from 20 Hz up to 7 kHz;
 * the middle is open (null: nothing to do). */
export function morph(position: number): { low: boolean; hz: number } | null {
  const x = clamp01(position);
  if (Math.abs(x - 0.5) < 0.02) return null;
  return x < 0.5 ? { low: true, hz: 80 * Math.pow(18000 / 80, x / 0.5) } : { low: false, hz: 20 * Math.pow(7000 / 20, (x - 0.5) / 0.5) };
}
/** The RESO knob 0...1 -> a filter's Q (0.6 to 10). */
export const resonanceQ = (r: number): number => 0.6 + 9.4 * clamp01(r) * clamp01(r);

/** A stereo delay with feedback; the repeats are darkened a little each time (a one-pole low-pass in the loop, or, for DLY+FLT, a resonant
 * low-/high-pass), and WIDTH sends them across to the other side (ping-pong). */
class Delay {
  private readonly bl: Float32Array;
  private readonly br: Float32Array;
  private w = 0;
  private now = 0;
  private lpL = 0;
  private lpR = 0;
  private fresh = true;
  private readonly fl = new Bq();
  private readonly fr = new Bq();
  private lowNow = true;
  private readonly rate: number;
  constructor(rate: number) {
    this.rate = rate;
    const cap = Math.ceil(rate * 2.2);
    this.bl = new Float32Array(cap);
    this.br = new Float32Array(cap);
  }
  clear(): void { this.bl.fill(0); this.br.fill(0); this.lpL = 0; this.lpR = 0; this.fl.clear(); this.fr.clear(); this.fresh = true; }
  /** `tone` (0...1) darkens the repeats; with `filter` set, the loop has that filter instead (null inside: open). */
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, send: number, seconds: number,
      feedback: number, tone: number, width: number, filter: { cutoff: number; q: number } | null): void {
    const cap = this.bl.length;
    const wanted = Math.max(64, Math.min(cap - 4, seconds * this.rate));
    if (this.fresh) { this.now = wanted; this.fresh = false; }
    const fb = 0.05 + 0.85 * clamp01(feedback);
    const damp = 0.04 + 0.96 * Math.pow(clamp01(tone), 1.6);
    const m = filter ? morph(filter.cutoff) : null;
    if (filter && m) {
      if (m.low !== this.lowNow) { this.fl.clear(); this.fr.clear(); this.lowNow = m.low; }
      this.fl.set(m.low, m.hz, filter.q, this.rate); this.fr.set(m.low, m.hz, filter.q, this.rate);
    }
    let w = this.w, now = this.now, lpL = this.lpL, lpR = this.lpR;
    for (let i = 0; i < count; i++) {
      now += (wanted - now) * 0.0004; // a tempo or note change glides (tape-echo style), no zipper
      let r = w - now;
      if (r < 0) r += cap;
      const i0 = Math.trunc(r), f = r - i0, i1 = i0 + 1 === cap ? 0 : i0 + 1;
      const yl = this.bl[i0] + (this.bl[i1] - this.bl[i0]) * f;
      const yr = this.br[i0] + (this.br[i1] - this.br[i0]) * f;
      let tl: number, tr: number;
      if (filter) { tl = m ? this.fl.tick(yl) : yl; tr = m ? this.fr.tick(yr) : yr; }
      else { lpL += damp * (yl - lpL); lpR += damp * (yr - lpR); tl = lpL; tr = lpR; }
      const cl = tl + (tr - tl) * width, cr = tr + (tl - tr) * width; // WIDTH: the repeats cross over to the other side
      this.bl[w] = inL[i] * send + cl * fb;
      this.br[w] = inR[i] * send + cr * fb;
      wetL[i] = yl;
      wetR[i] = yr;
      if (++w === cap) w = 0;
    }
    this.w = w; this.now = now; this.lpL = Math.abs(lpL) < 1e-18 ? 0 : lpL; this.lpR = Math.abs(lpR) < 1e-18 ? 0 : lpR;
  }
}

/** Freeverb (Jezar's public-domain design): eight damped combs and four allpasses per side, with a PRE-delay in front and a WIDTH on the way out. */
class Reverb {
  private static readonly COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  private static readonly ALLPASS = [556, 441, 341, 225];
  private static readonly SPREAD = 23;
  private readonly comb: Float32Array[][] = [[], []];
  private readonly combAt: number[][] = [[], []];
  private readonly combLp: number[][] = [[], []];
  private readonly all: Float32Array[][] = [[], []];
  private readonly allAt: number[][] = [[], []];
  private readonly pre: Float32Array;
  private preAt = 0;
  private readonly rate: number;
  constructor(rate: number) {
    this.rate = rate;
    const k = rate / 44100;
    for (let side = 0; side < 2; side++) {
      const spread = side * Reverb.SPREAD;
      for (const t of Reverb.COMBS) { this.comb[side].push(new Float32Array(Math.round((t + spread) * k))); this.combAt[side].push(0); this.combLp[side].push(0); }
      for (const t of Reverb.ALLPASS) { this.all[side].push(new Float32Array(Math.round((t + spread) * k))); this.allAt[side].push(0); }
    }
    this.pre = new Float32Array(Math.ceil(rate * 0.11));
  }
  clear(): void {
    for (let side = 0; side < 2; side++) {
      this.comb[side].forEach((b) => b.fill(0)); this.all[side].forEach((b) => b.fill(0));
      this.combLp[side].fill(0); this.combAt[side].fill(0); this.allAt[side].fill(0);
    }
    this.pre.fill(0); this.preAt = 0;
  }
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, send: number,
      size: number, damp: number, pre: number, width: number): void {
    const feedback = clamp01(size) * 0.28 + 0.7, damp1 = clamp01(damp) * 0.4, damp2 = 1 - damp1;
    const preN = this.pre.length, delay = Math.min(preN - 1, Math.round(clamp01(pre) * 0.1 * this.rate));
    let pa = this.preAt;
    const out = [0, 0];
    for (let i = 0; i < count; i++) {
      this.pre[pa] = (inL[i] + inR[i]) * 0.015 * send;
      let rp = pa - delay;
      if (rp < 0) rp += preN;
      const x = this.pre[rp];
      if (++pa === preN) pa = 0;
      for (let side = 0; side < 2; side++) {
        let sum = 0;
        const combs = this.comb[side], at = this.combAt[side], lp = this.combLp[side];
        for (let c = 0; c < combs.length; c++) {
          const b = combs[c], j = at[c];
          const y = b[j];
          lp[c] = y * damp2 + lp[c] * damp1;
          b[j] = x + lp[c] * feedback;
          at[c] = j + 1 === b.length ? 0 : j + 1;
          sum += y;
        }
        const aps = this.all[side], aa = this.allAt[side];
        for (let a = 0; a < aps.length; a++) {
          const b = aps[a], j = aa[a];
          const bufout = b[j];
          const o = -sum + bufout;
          b[j] = sum + bufout * 0.5;
          aa[a] = j + 1 === b.length ? 0 : j + 1;
          sum = o;
        }
        out[side] = sum * REVERB_WET;
      }
      const mid = (out[0] + out[1]) / 2;
      wetL[i] = mid + (out[0] - mid) * width;
      wetR[i] = mid + (out[1] - mid) * width;
    }
    this.preAt = pa;
  }
}
/** Makes the reverb's wet about as loud as the dry at full amount (measured with noise in the tests). */
export const REVERB_WET = 1;

/** A flanger: a short delay swept by a slow sine (the right side a quarter turn behind), with feedback. MANUAL is where the sweep starts (0.3 to 3.3 ms),
 * DEPTH how far it goes (up to 4.5 ms more). */
class Flanger {
  private readonly bl: Float32Array;
  private readonly br: Float32Array;
  private w = 0;
  private phase = 0;
  private readonly rate: number;
  constructor(rate: number) {
    this.rate = rate;
    const cap = Math.ceil(rate * 0.012) + 4;
    this.bl = new Float32Array(cap);
    this.br = new Float32Array(cap);
  }
  clear(): void { this.bl.fill(0); this.br.fill(0); }
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, sweepSeconds: number, depth: number, feedback: number, manual: number): void {
    const cap = this.bl.length, fs = this.rate;
    const inc = 1 / (Math.max(0.5, Math.min(40, sweepSeconds)) * fs);
    const fb = 0.85 * clamp01(feedback), base = 0.0003 + 0.003 * clamp01(manual), range = 0.0045 * clamp01(depth);
    let w = this.w, p = this.phase;
    for (let i = 0; i < count; i++) {
      p += inc;
      if (p >= 1) p -= 1;
      const ml = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
      const mr = 0.5 - 0.5 * Math.cos(2 * Math.PI * (p + 0.25));
      const dl = (base + range * ml) * fs, dr = (base + range * mr) * fs;
      let rl = w - dl, rr = w - dr;
      if (rl < 0) rl += cap;
      if (rr < 0) rr += cap;
      const l0 = Math.trunc(rl), lf = rl - l0, l1 = l0 + 1 === cap ? 0 : l0 + 1;
      const r0 = Math.trunc(rr), rf = rr - r0, r1 = r0 + 1 === cap ? 0 : r0 + 1;
      const yl = this.bl[l0] + (this.bl[l1] - this.bl[l0]) * lf;
      const yr = this.br[r0] + (this.br[r1] - this.br[r0]) * rf;
      this.bl[w] = inL[i] + yl * fb;
      this.br[w] = inR[i] + yr * fb;
      wetL[i] = yl * FLANGER_WET;
      wetR[i] = yr * FLANGER_WET;
      if (++w === cap) w = 0;
    }
    this.w = w; this.phase = p;
  }
}
const FLANGER_WET = 0.7;

/** A phaser: 4, 6, 8 or 12 first-order allpass stages swept by a slow sine (the right side a quarter turn behind), with feedback (RESO). DEPTH is how many
 * octaves the sweep covers (from 300 Hz, one to five octaves up). */
class Phaser {
  private readonly zl = new Float64Array(12);
  private readonly zr = new Float64Array(12);
  private fl = 0;
  private fr = 0;
  private phase = 0;
  private readonly rate: number;
  constructor(rate: number) { this.rate = rate; }
  clear(): void { this.zl.fill(0); this.zr.fill(0); this.fl = 0; this.fr = 0; }
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, sweepSeconds: number, depth: number, feedback: number, stages: number): void {
    const fs = this.rate, inc = 1 / (Math.max(0.5, Math.min(40, sweepSeconds)) * fs);
    const fb = 0.88 * clamp01(feedback), lo = 300, ratio = Math.pow(2, 1 + 4 * clamp01(depth)), top = fs * 0.4;
    let p = this.phase, fl = this.fl, fr = this.fr;
    for (let i = 0; i < count; i++) {
      p += inc;
      if (p >= 1) p -= 1;
      const ml = 0.5 - 0.5 * Math.cos(2 * Math.PI * p), mr = 0.5 - 0.5 * Math.cos(2 * Math.PI * (p + 0.25));
      const tl = Math.tan(Math.PI * Math.min(top, lo * Math.pow(ratio, ml)) / fs), tr = Math.tan(Math.PI * Math.min(top, lo * Math.pow(ratio, mr)) / fs);
      const al = (tl - 1) / (tl + 1), ar = (tr - 1) / (tr + 1);
      let xl = inL[i] + fl * fb, xr = inR[i] + fr * fb;
      for (let s = 0; s < stages; s++) {
        const yl = al * xl + this.zl[s]; this.zl[s] = xl - al * yl; xl = yl;
        const yr = ar * xr + this.zr[s]; this.zr[s] = xr - ar * yr; xr = yr;
      }
      fl = Math.abs(xl) < 1e-18 ? 0 : xl; fr = Math.abs(xr) < 1e-18 ? 0 : xr;
      wetL[i] = xl * PHASER_WET;
      wetR[i] = xr * PHASER_WET;
    }
    this.phase = p; this.fl = fl; this.fr = fr;
  }
}
const PHASER_WET = 0.7;

/** The FILTER effect: a resonant low-/high-pass (the CUTOFF knob morphs between them, open in the middle), which SWEEP moves by a slow sine at the chosen
 * note value. It is an insert: the unit's LEVEL fades between the dry sound and the filtered one. */
class SweepFilter {
  private readonly fl = new Bq();
  private readonly fr = new Bq();
  private phase = 0;
  private lowNow = true;
  private readonly rate: number;
  constructor(rate: number) { this.rate = rate; }
  clear(): void { this.fl.clear(); this.fr.clear(); }
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, cutoff: number, reso: number, sweep: number, sweepSeconds: number): void {
    const fs = this.rate, inc = 1 / (Math.max(0.5, Math.min(40, sweepSeconds)) * fs), q = resonanceQ(reso);
    let p = this.phase;
    for (let i = 0; i < count; ) {
      const n = Math.min(16, count - i);
      const m = morph(cutoff + Math.sin(2 * Math.PI * p) * clamp01(sweep) * 0.5);
      if (!m) {
        for (let j = 0; j < n; j++) { wetL[i + j] = 0; wetR[i + j] = 0; }
        this.fl.clear(); this.fr.clear();
      } else {
        if (m.low !== this.lowNow) { this.fl.clear(); this.fr.clear(); this.lowNow = m.low; }
        this.fl.set(m.low, m.hz, q, fs); this.fr.set(m.low, m.hz, q, fs);
        for (let j = 0; j < n; j++) {
          wetL[i + j] = this.fl.tick(inL[i + j]) - inL[i + j];
          wetR[i + j] = this.fr.tick(inR[i + j]) - inR[i + j];
        }
      }
      p += inc * n;
      if (p >= 1) p -= 1;
      i += n;
    }
    this.phase = p;
  }
}

/** FLG+FLT: the flanger, then a resonant low-/high-pass (the CUTOFF knob, open in the middle); an insert like FILTER. */
class FlangerFilter {
  private readonly fl = new Bq();
  private readonly fr = new Bq();
  private lowNow = true;
  private readonly rate: number;
  private tmpL = new Float32Array(128);
  private tmpR = new Float32Array(128);
  constructor(rate: number) { this.rate = rate; }
  clear(): void { this.fl.clear(); this.fr.clear(); }
  run(flanger: Flanger, inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, sweepSeconds: number, depth: number, feedback: number, cutoff: number): void {
    if (this.tmpL.length < count) { this.tmpL = new Float32Array(count); this.tmpR = new Float32Array(count); }
    flanger.run(inL, inR, this.tmpL, this.tmpR, count, sweepSeconds, depth, feedback, 0.15);
    const m = morph(cutoff);
    if (!m) { for (let i = 0; i < count; i++) { wetL[i] = this.tmpL[i]; wetR[i] = this.tmpR[i]; } this.fl.clear(); this.fr.clear(); return; }
    if (m.low !== this.lowNow) { this.fl.clear(); this.fr.clear(); this.lowNow = m.low; }
    this.fl.set(m.low, m.hz, 1.4, this.rate); this.fr.set(m.low, m.hz, 1.4, this.rate);
    for (let i = 0; i < count; i++) {
      wetL[i] = this.fl.tick(inL[i] + this.tmpL[i]) - inL[i];
      wetR[i] = this.fr.tick(inR[i] + this.tmpR[i]) - inR[i];
    }
  }
}

const STAGES = [4, 6, 8, 12];
/** The effects with a tail (they ring on after the unit is switched off) take the sound at their input; the rest at their output. */
const hasTail = (type: number): boolean => type === FX.delay || type === FX.reverb || type === FX.delayFilter;

export class MasterSection {
  /** Wanted headphones gain (linear), written by the page. */
  phonesGain = 1;
  private phonesNow = 1;
  /** LIVE's master knob, 0...1 (`roomGainFor`): it scales the ROOM and nothing else. */
  roomKnob = ROOM_UNITY;
  private roomNow = 1;
  // The effect unit, written by the page: which effect, on or off, how much (0...1), the four knobs of the effect (0...1), and the note value
  // in seconds (the page works it out from the tempo and the effect's tempo knob).
  fxType: number = FX.delay;
  fxOn = false;
  fxAmount = 0.5;
  fxDelaySeconds = 0.5;
  /** The four knobs of the effect, from the page (null: the effect's own defaults, as in the tests). */
  fxParams: number[] | null = null;
  private pNow: number[] = FX_DEFAULTS[0].slice();
  private sendNow = 0;
  private amountNow = 0;
  private idle = true;
  private quiet = 0;
  private typeNow = -1;
  private readonly delay: Delay;
  private readonly reverb: Reverb;
  private readonly flanger: Flanger;
  private readonly phaser: Phaser;
  private readonly sweep: SweepFilter;
  private readonly flangerFilter: FlangerFilter;
  private wetL = new Float32Array(128);
  private wetR = new Float32Array(128);
  private gate = new Float32Array(128);
  private gL = new Float32Array(128);
  private gR = new Float32Array(128);

  private readonly rate: number;

  constructor(rate = 48000) {
    this.rate = rate;
    this.delay = new Delay(rate);
    this.reverb = new Reverb(rate);
    this.flanger = new Flanger(rate);
    this.phaser = new Phaser(rate);
    this.sweep = new SweepFilter(rate);
    this.flangerFilter = new FlangerFilter(rate);
  }

  private clearAll(): void {
    this.delay.clear(); this.reverb.clear(); this.flanger.clear(); this.phaser.clear(); this.sweep.clear(); this.flangerFilter.clear();
  }

  /**
   * `outL`/`outR`: the room (the stereo pair; in `split` mode the left is the room in mono and the
   * right is the headphones in mono). `pl`/`pr`: the headphones' own pair (a sound card or a second
   * device), or null. `cueMix`: how much of the room the headphones hear (0 = only the cued decks).
   */
  process(outL: Float32Array, outR: Float32Array, pl: Float32Array | null, pr: Float32Array | null, split: boolean, cueMix: number, count: number): void {
    this.runEffect(outL, outR, pl, pr, split, Math.max(0, Math.min(1, cueMix)), count);
    this.runRoom(outL, outR, pl, pr, split, count);
    this.runPhones(outL, outR, pl, pr, split, count);
  }

  private grow(count: number): void {
    if (this.wetL.length >= count) return;
    this.wetL = new Float32Array(count); this.wetR = new Float32Array(count); this.gate = new Float32Array(count);
    this.gL = new Float32Array(count); this.gR = new Float32Array(count);
  }

  private runEffect(outL: Float32Array, outR: Float32Array, pl: Float32Array | null, pr: Float32Array | null, split: boolean, cueMix: number, count: number): void {
    const wantOn = this.fxOn ? 1 : 0;
    if (this.idle && wantOn === 0 && this.sendNow < 1e-4) return; // off and finished ringing: untouched
    this.grow(count);
    const type = Math.max(0, Math.min(FX_TYPES.length - 1, Math.trunc(this.fxType) || 0));
    if (this.typeNow !== type) {
      this.clearAll();
      this.typeNow = type;
      for (let k = 0; k < 4; k++) this.pNow[k] = clamp01((this.fxParams ?? FX_DEFAULTS[type])[k]); // another effect: its knobs are where they are, no glide from the last one
    }
    this.idle = false;
    const twoOut = !!(pl && pr);
    const mono = split && !twoOut; // the room is the left channel alone
    const inL = outL, inR = mono ? outL : outR;
    const { wetL, wetR, gate, gL, gR } = this;
    // The on switch glides (about 10 ms): the effects with a tail take it at their input, so what is already ringing rings out;
    // the others take it at their output.
    let s = this.sendNow;
    for (let i = 0; i < count; i++) { s += (wantOn - s) * 0.002; gate[i] = s; }
    this.sendNow = Math.abs(s - wantOn) < 1e-4 ? wantOn : s;
    // The knobs glide (about 30 ms), so turning one makes no zipper.
    const glide = 1 - Math.exp(-count / (0.03 * this.rate)), want = this.fxParams ?? FX_DEFAULTS[type];
    for (let k = 0; k < 4; k++) this.pNow[k] += (clamp01(want[k]) - this.pNow[k]) * glide;
    const P = this.pNow, seconds = this.fxDelaySeconds, sweepSeconds = 8 * seconds;
    const tail = hasTail(type);
    const src = tail ? gL : inL, srcR = tail ? gR : inR;
    if (tail) for (let i = 0; i < count; i++) { gL[i] = inL[i] * gate[i]; gR[i] = inR[i] * gate[i]; }
    switch (type) {
      case FX.delay: this.delay.run(src, srcR, wetL, wetR, count, 1, seconds, P[1], P[2], P[3], null); break;
      case FX.reverb: this.reverb.run(src, srcR, wetL, wetR, count, 1, P[0], P[1], P[2], P[3]); break;
      case FX.flanger: this.flanger.run(src, srcR, wetL, wetR, count, sweepSeconds, P[1], P[2], P[3]); break;
      case FX.phaser: this.phaser.run(src, srcR, wetL, wetR, count, sweepSeconds, P[1], P[2], STAGES[stepIndex(want[3], STAGES.length)]); break;
      case FX.filter: this.sweep.run(src, srcR, wetL, wetR, count, P[0], P[1], P[2], sweepSeconds); break;
      case FX.flangerFilter: this.flangerFilter.run(this.flanger, src, srcR, wetL, wetR, count, sweepSeconds, P[1], P[2], P[3]); break;
      default: this.delay.run(src, srcR, wetL, wetR, count, 1, seconds, P[1], 0, 0, { cutoff: P[2], q: resonanceQ(P[3]) }); break;
    }
    let a = this.amountNow, loud = 0, bad = false;
    const amountWanted = Math.max(0, Math.min(1, this.fxAmount));
    const gated = !tail;
    for (let i = 0; i < count; i++) {
      a += (amountWanted - a) * 0.002;
      const k = gated ? a * gate[i] : a;
      let wl = wetL[i] * k, wr = wetR[i] * k;
      if (!(wl > -16 && wl < 16) || !(wr > -16 && wr < 16)) { bad = true; wl = 0; wr = 0; } // NaN or runaway: drop it, and start the effect clean
      loud = Math.max(loud, Math.abs(wl), Math.abs(wr));
      outL[i] = softClip(outL[i] + wl);
      if (!mono) outR[i] = softClip(outR[i] + wr);
      if (twoOut) { pl![i] = softClip(pl![i] + wl * cueMix); pr![i] = softClip(pr![i] + wr * cueMix); }
      else if (split) outR[i] = softClip(outR[i] + wl * cueMix);
    }
    this.amountNow = a;
    if (bad) { this.clearAll(); this.quiet = 0; return; }
    if (wantOn === 0 && this.sendNow < 1e-4) {
      // Switched off: an effect without a tail stops at once, one with a tail when it is gone (under -100 dB for half a second).
      this.quiet = !tail || loud < 1e-5 ? this.quiet + count : 0;
      if (!tail || this.quiet > this.rate * 0.5) {
        this.clearAll();
        this.idle = true; this.quiet = 0;
      }
    } else {
      this.quiet = 0;
    }
  }

  /** The master knob: the room, with the effect return in it. The headphones never feel it: their main-mix share (the cue mix) is taken before the master, as on a mixer. */
  private runRoom(outL: Float32Array, outR: Float32Array, pl: Float32Array | null, pr: Float32Array | null, split: boolean, count: number): void {
    const wanted = roomGainFor(this.roomKnob);
    if (this.roomNow === 1 && wanted === 1) return; // at its mark: untouched, bit for bit
    const scaleRight = !(split && !(pl && pr)); // split on one cable: the left is the room, the right is the headphones
    let g = this.roomNow;
    const boost = wanted > 1 || g > 1;
    for (let i = 0; i < count; i++) {
      g += (wanted - g) * 0.002;
      outL[i] = boost ? softClip(outL[i] * g) : outL[i] * g;
      if (scaleRight) outR[i] = boost ? softClip(outR[i] * g) : outR[i] * g;
    }
    this.roomNow = Math.abs(g - wanted) < 1e-4 ? wanted : g;
  }

  private runPhones(outL: Float32Array, outR: Float32Array, pl: Float32Array | null, pr: Float32Array | null, split: boolean, count: number): void {
    // Headphones bus: the pair when there is one, the right channel in split mode, none otherwise.
    const a = pl && pr ? pl : split ? outR : null;
    const b = pl && pr ? pr : null;
    if (!a) { this.phonesNow = this.phonesGain; return; }
    const wanted = this.phonesGain;
    if (this.phonesNow === 1 && wanted === 1) return; // as before the knob: untouched
    let g = this.phonesNow;
    const boost = wanted > 1 || g > 1;
    for (let i = 0; i < count; i++) {
      g += (wanted - g) * 0.004;
      a[i] = boost ? softClip(a[i] * g) : a[i] * g;
      if (b) b[i] = boost ? softClip(b[i] * g) : b[i] * g;
    }
    this.phonesNow = Math.abs(g - wanted) < 1e-4 ? wanted : g;
  }
}
