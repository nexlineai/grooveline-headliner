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

export const FX_TYPES = ["DELAY", "REVERB", "FLANGER"] as const;
export const FX = { delay: 0, reverb: 1, flanger: 2 } as const;
/** The delay's note values (1/4 = one beat). The flanger sweeps once per 8 of these. */
export const FX_DIVISIONS = [
  { label: "1/4", beats: 1 }, { label: "1/8", beats: 0.5 }, { label: "1/16", beats: 0.25 }, { label: "1/32", beats: 0.125 },
] as const;

/** Seconds of one note value at a tempo (120 BPM: a 1/4 is 0.5 s, a 1/8 is 0.25 s). */
export function beatDelaySeconds(bpm: number, division: number): number {
  const d = FX_DIVISIONS[Math.max(0, Math.min(FX_DIVISIONS.length - 1, Math.trunc(division)))];
  return (60 / Math.max(40, bpm)) * d.beats;
}

/** A stereo delay with feedback; the repeats are darkened a little each time (a one-pole low-pass in the loop). */
class Delay {
  private readonly bl: Float32Array;
  private readonly br: Float32Array;
  private w = 0;
  private now = 0;
  private lpL = 0;
  private lpR = 0;
  private fresh = true;
  private readonly rate: number;
  constructor(rate: number) {
    this.rate = rate;
    const cap = Math.ceil(rate * 2.2);
    this.bl = new Float32Array(cap);
    this.br = new Float32Array(cap);
  }
  clear(): void { this.bl.fill(0); this.br.fill(0); this.lpL = 0; this.lpR = 0; this.fresh = true; }
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, send: number, seconds: number): void {
    const cap = this.bl.length;
    const wanted = Math.max(64, Math.min(cap - 4, seconds * this.rate));
    if (this.fresh) { this.now = wanted; this.fresh = false; }
    const feedback = 0.5, damp = 0.45;
    let w = this.w, now = this.now, lpL = this.lpL, lpR = this.lpR;
    for (let i = 0; i < count; i++) {
      now += (wanted - now) * 0.0004; // a tempo or note change glides (tape-echo style), no zipper
      let r = w - now;
      if (r < 0) r += cap;
      const i0 = Math.trunc(r), f = r - i0, i1 = i0 + 1 === cap ? 0 : i0 + 1;
      const yl = this.bl[i0] + (this.bl[i1] - this.bl[i0]) * f;
      const yr = this.br[i0] + (this.br[i1] - this.br[i0]) * f;
      lpL += damp * (yl - lpL);
      lpR += damp * (yr - lpR);
      this.bl[w] = inL[i] * send + lpL * feedback;
      this.br[w] = inR[i] * send + lpR * feedback;
      wetL[i] = yl;
      wetR[i] = yr;
      if (++w === cap) w = 0;
    }
    this.w = w; this.now = now; this.lpL = lpL; this.lpR = lpR;
  }
}

/** Freeverb (Jezar's public-domain design): eight damped combs and four allpasses per side. */
class Reverb {
  private static readonly COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  private static readonly ALLPASS = [556, 441, 341, 225];
  private static readonly SPREAD = 23;
  private readonly comb: Float32Array[][] = [[], []];
  private readonly combAt: number[][] = [[], []];
  private readonly combLp: number[][] = [[], []];
  private readonly all: Float32Array[][] = [[], []];
  private readonly allAt: number[][] = [[], []];
  constructor(rate: number) {
    const k = rate / 44100;
    for (let side = 0; side < 2; side++) {
      const spread = side * Reverb.SPREAD;
      for (const t of Reverb.COMBS) { this.comb[side].push(new Float32Array(Math.round((t + spread) * k))); this.combAt[side].push(0); this.combLp[side].push(0); }
      for (const t of Reverb.ALLPASS) { this.all[side].push(new Float32Array(Math.round((t + spread) * k))); this.allAt[side].push(0); }
    }
  }
  clear(): void {
    for (let side = 0; side < 2; side++) {
      this.comb[side].forEach((b) => b.fill(0)); this.all[side].forEach((b) => b.fill(0));
      this.combLp[side].fill(0); this.combAt[side].fill(0); this.allAt[side].fill(0);
    }
  }
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, send: number): void {
    const room = 0.84, feedback = room * 0.28 + 0.7, damp1 = 0.2 * 0.4, damp2 = 1 - damp1;
    for (let i = 0; i < count; i++) {
      const x = (inL[i] + inR[i]) * 0.015 * send;
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
          const out = -sum + bufout;
          b[j] = sum + bufout * 0.5;
          aa[a] = j + 1 === b.length ? 0 : j + 1;
          sum = out;
        }
        (side === 0 ? wetL : wetR)[i] = sum * REVERB_WET;
      }
    }
  }
}
/** Makes the reverb's wet about as loud as the dry at full amount (measured with noise in the tests). */
export const REVERB_WET = 1;

/** A flanger: a short delay swept by a slow sine (0.4 to 4 ms, the right side a quarter turn behind), with feedback. */
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
  run(inL: Float32Array, inR: Float32Array, wetL: Float32Array, wetR: Float32Array, count: number, sweepSeconds: number): void {
    const cap = this.bl.length, fs = this.rate;
    const inc = 1 / (Math.max(0.5, Math.min(40, sweepSeconds)) * fs);
    const feedback = 0.55;
    let w = this.w, p = this.phase;
    for (let i = 0; i < count; i++) {
      p += inc;
      if (p >= 1) p -= 1;
      const ml = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
      const mr = 0.5 - 0.5 * Math.cos(2 * Math.PI * (p + 0.25));
      const dl = (0.0004 + 0.0036 * ml) * fs, dr = (0.0004 + 0.0036 * mr) * fs;
      let rl = w - dl, rr = w - dr;
      if (rl < 0) rl += cap;
      if (rr < 0) rr += cap;
      const l0 = Math.trunc(rl), lf = rl - l0, l1 = l0 + 1 === cap ? 0 : l0 + 1;
      const r0 = Math.trunc(rr), rf = rr - r0, r1 = r0 + 1 === cap ? 0 : r0 + 1;
      const yl = this.bl[l0] + (this.bl[l1] - this.bl[l0]) * lf;
      const yr = this.br[r0] + (this.br[r1] - this.br[r0]) * rf;
      this.bl[w] = inL[i] + yl * feedback;
      this.br[w] = inR[i] + yr * feedback;
      wetL[i] = yl * FLANGER_WET;
      wetR[i] = yr * FLANGER_WET;
      if (++w === cap) w = 0;
    }
    this.w = w; this.phase = p;
  }
}
const FLANGER_WET = 0.7;

export class MasterSection {
  /** Wanted headphones gain (linear), written by the page. */
  phonesGain = 1;
  private phonesNow = 1;
  /** LIVE's master knob, 0...1 (`roomGainFor`): it scales the ROOM and nothing else. */
  roomKnob = ROOM_UNITY;
  private roomNow = 1;
  // The effect unit, written by the page: which effect, on or off, how much (0...1), and the delay
  // time in seconds (the page works it out from the tempo and the note value).
  fxType: number = FX.delay;
  fxOn = false;
  fxAmount = 0.5;
  fxDelaySeconds = 0.5;
  private sendNow = 0;
  private amountNow = 0;
  private idle = true;
  private quiet = 0;
  private typeNow = -1;
  private readonly delay: Delay;
  private readonly reverb: Reverb;
  private readonly flanger: Flanger;
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
    if (this.typeNow !== this.fxType) {
      this.delay.clear(); this.reverb.clear(); this.flanger.clear();
      this.typeNow = this.fxType;
    }
    this.idle = false;
    const twoOut = !!(pl && pr);
    const mono = split && !twoOut; // the room is the left channel alone
    const inL = outL, inR = mono ? outL : outR;
    const { wetL, wetR, gate, gL, gR } = this;
    // The on switch glides (about 10 ms): delay and reverb take it at their input, so what is already
    // ringing rings out; the flanger has no tail and takes it at its output.
    let s = this.sendNow;
    for (let i = 0; i < count; i++) { s += (wantOn - s) * 0.002; gate[i] = s; }
    this.sendNow = Math.abs(s - wantOn) < 1e-4 ? wantOn : s;
    const type = this.fxType;
    if (type === FX.flanger) {
      this.flanger.run(inL, inR, wetL, wetR, count, 8 * this.fxDelaySeconds);
    } else {
      for (let i = 0; i < count; i++) { gL[i] = inL[i] * gate[i]; gR[i] = inR[i] * gate[i]; }
      if (type === FX.reverb) this.reverb.run(gL, gR, wetL, wetR, count, 1);
      else this.delay.run(gL, gR, wetL, wetR, count, 1, this.fxDelaySeconds);
    }
    let a = this.amountNow, loud = 0;
    const amountWanted = Math.max(0, Math.min(1, this.fxAmount));
    const gated = type === FX.flanger;
    for (let i = 0; i < count; i++) {
      a += (amountWanted - a) * 0.002;
      const k = gated ? a * gate[i] : a;
      const wl = wetL[i] * k, wr = wetR[i] * k;
      loud = Math.max(loud, Math.abs(wl), Math.abs(wr));
      outL[i] = softClip(outL[i] + wl);
      if (!mono) outR[i] = softClip(outR[i] + wr);
      if (twoOut) { pl![i] = softClip(pl![i] + wl * cueMix); pr![i] = softClip(pr![i] + wr * cueMix); }
      else if (split) outR[i] = softClip(outR[i] + wl * cueMix);
    }
    this.amountNow = a;
    if (wantOn === 0 && this.sendNow < 1e-4) {
      // Switched off: the flanger stops at once, a delay or reverb when its tail is gone (under -100 dB for half a second).
      this.quiet = type === FX.flanger || loud < 1e-5 ? this.quiet + count : 0;
      if (type === FX.flanger || this.quiet > this.rate * 0.5) {
        this.delay.clear(); this.reverb.clear(); this.flanger.clear();
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
