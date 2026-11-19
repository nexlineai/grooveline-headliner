// Port of HeadlinerCore/Vinyl.swift: one turntable reading a record at a changing speed.

/**
 * What the audio thread and the game share about one deck. The game writes the "wanted" fields
 * (`targetRate`, `glide`, `seekTo`, `targetGain`, `step`); the audio thread writes `position`,
 * `rate`, `gain`, `peak`. In the browser the same fields live in shared memory (see engine).
 */
export interface DeckShared {
  left: Float32Array | null;
  right: Float32Array | null;
  /** Frames in the record; 0 means nothing is loaded and the deck is silent. */
  frames: number;
  /** File frames advanced per output frame at normal speed (file rate / output rate). */
  step: number;
  /** Where the needle is, in file frames. */
  position: number;
  /** How fast the record turns right now: 1 normal, 0 stopped, negative backwards. */
  rate: number;
  targetRate: number;
  /** Share of the gap to `targetRate` closed on every output frame (motor torque, or a hand). */
  glide: number;
  /** A needle drop waiting to happen (file frames), or -1. */
  seekTo: number;
  gain: number;
  targetGain: number;
  /** Loudest sample since the game last read it. */
  peak: number;
  // WEB ONLY (the LIVE booth; the Swift twin does not have these). All zero = exactly the old behaviour, bit for bit (test/vinyl-golden).
  /** A loop in file frames: it is on when `loopEnd > loopStart`. At its end the needle goes back to its start, to the sample. */
  loopStart: number;
  loopEnd: number;
  /** Frames over which a needle drop WHILE THE RECORD TURNS crossfades from where it was (no click); 0 = a hard jump. */
  smoothSeek: number;
  /** The crossfade in progress (frames left, frames in all, the old needle's place). */
  xfade: number;
  xfadeTotal: number;
  oldPos: number;
}

export function newDeckShared(): DeckShared {
  return {
    left: null, right: null, frames: 0, step: 1, position: 1, rate: 0, targetRate: 0, glide: 1,
    seekTo: -1, gain: 0, targetGain: 1, peak: 0, loopStart: 0, loopEnd: 0, smoothSeek: 0, xfade: 0, xfadeTotal: 0, oldPos: 0,
  };
}

/** 4-point Hermite interpolation: the sample `f` of the way from frame `i` to `i + 1`. */
export function hermite(p: Float32Array, i: number, f: number): number {
  const xm1 = p[i - 1], x0 = p[i], x1 = p[i + 1], x2 = p[i + 2];
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const b = w + a;
  return ((a * f - b) * f + c) * f + x0;
}

/**
 * Fills `count` output frames (from index 0) by reading the record at its (changing) speed.
 * One mechanism covers play, stop, pitch, nudging, scratching and spinbacks, as on a turntable.
 */
export function renderVinyl(s: DeckShared, outL: Float32Array, outR: Float32Array, count: number): void {
  const frames = s.frames;
  const l = s.left, r = s.right;
  if (frames <= 8 || !l || !r) {
    for (let n = 0; n < count; n++) { outL[n] = 0; outR[n] = 0; }
    return;
  }
  let pos = s.position;
  const seek = s.seekTo;
  if (seek >= 0) {
    // A drop while the record turns fades from the old place (so a hot cue does not click); standing still it is a plain jump.
    if (s.smoothSeek > 0 && Math.abs(s.rate) > 0.05) { s.xfade = s.xfadeTotal = s.smoothSeek; s.oldPos = pos; }
    pos = seek;
    s.seekTo = -1;
  }
  let rate = s.rate;
  let gain = s.gain;
  const target = s.targetRate;
  const glide = s.glide;
  const targetGain = s.targetGain;
  const step = s.step;
  const first = 1, last = frames - 3;
  let peak = 0;
  // The loop (off: loopEnd 0), and how long its seam is crossfaded (a few milliseconds, so it does not click).
  const loopStart = s.loopStart, loopEnd = Math.min(s.loopEnd, last);
  const looping = loopEnd > loopStart + 16 && loopStart >= 1;
  const loopLen = loopEnd - loopStart;
  const seam = looping ? Math.max(0, Math.min(96, Math.floor(loopLen / 4), Math.floor(loopStart) - 3)) : 0;
  let xfade = s.xfade, oldPos = s.oldPos;

  for (let n = 0; n < count; n++) {
    rate += (target - rate) * glide;
    gain += (targetGain - gain) * 0.004;
    pos += rate * step;
    if (looping) {
      // Past the end the needle goes back by the loop's length (past the start, backwards, forward by it): to the sample.
      if (pos >= loopEnd && rate > 0) pos = loopStart + ((pos - loopStart) % loopLen);
      else if (pos < loopStart && rate < 0 && pos > loopStart - loopLen * 4) pos = loopEnd - ((loopEnd - pos) % loopLen);
    }
    let edge = false;
    if (pos < first) { pos = first; edge = true; } else if (pos > last) { pos = last; edge = true; }
    // A record that is not moving makes no sound; fade over the last few percent of speed.
    const moving = Math.min(1, Math.abs(rate) * 40);
    const a = edge ? 0 : gain * moving;
    const i = Math.trunc(pos);
    const f = pos - i;
    let yl = hermite(l, i, f) * a;
    let yr = hermite(r, i, f) * a;
    if (seam > 0 && rate > 0 && pos > loopEnd - seam && pos < loopEnd) {
      // The last few milliseconds before the loop's end blend into what comes before its start: at the end the two are the same sample.
      const w = (pos - (loopEnd - seam)) / seam, p2 = pos - loopLen, i2 = Math.trunc(p2), f2 = p2 - i2;
      yl = yl * (1 - w) + hermite(l, i2, f2) * a * w;
      yr = yr * (1 - w) + hermite(r, i2, f2) * a * w;
    }
    if (xfade > 0) {
      const w = xfade / s.xfadeTotal;
      oldPos += rate * step;
      if (oldPos < first) oldPos = first; else if (oldPos > last) oldPos = last;
      const io = Math.trunc(oldPos), fo = oldPos - io;
      yl = yl * (1 - w) + hermite(l, io, fo) * a * w;
      yr = yr * (1 - w) + hermite(r, io, fo) * a * w;
      xfade--;
    }
    outL[n] = yl;
    outR[n] = yr;
    const m = Math.max(Math.abs(yl), Math.abs(yr));
    if (m > peak) peak = m;
  }
  s.position = pos;
  s.rate = rate;
  s.gain = gain;
  s.xfade = xfade;
  s.oldPos = oldPos;
  if (peak > s.peak) s.peak = peak;
}

/**
 * The whole record at a glance: how loud each of `bins` equal slices is, 0...1 against the
 * loudest slice. Quiet stretches (intros, breakdowns) show as dips.
 */
export function overview(p: Float32Array, count: number, bins: number, stride = 8): Float32Array {
  if (count <= 0 || bins <= 0) return new Float32Array(0);
  const out = new Float32Array(bins);
  let loudest = 0;
  for (let b = 0; b < bins; b++) {
    const from = Math.trunc(count * b / bins);
    const to = Math.max(from + 1, Math.trunc(count * (b + 1) / bins));
    let sum = 0, n = 0;
    for (let i = from; i < to && i < count; i += stride) {
      sum += p[i] * p[i];
      n += 1;
    }
    const level = n > 0 ? Math.sqrt(sum / n) : 0;
    out[b] = level;
    if (level > loudest) loudest = level;
  }
  if (loudest > 0) for (let b = 0; b < bins; b++) out[b] /= loudest;
  return out;
}

/** Frame of the first sample louder than `threshold`: where the first kick starts. */
export function firstOnset(p: Float32Array, count: number, threshold = 0.05): number {
  for (let i = 0; i < count; i++) if (Math.abs(p[i]) > threshold) return i;
  return 0;
}
