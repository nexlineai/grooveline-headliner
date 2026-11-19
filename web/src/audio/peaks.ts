// The loudness of a record at several zoom levels, for LIVE's zoomable waveform (web only). Made once when the record is loaded.
// `levels[0]` holds the loudest sample of every `PEAK_BASE` frames (both channels); each next level the loudest of four of the one before.

export const PEAK_BASE = 256;

export interface Peaks { levels: Float32Array[]; /** The loudest value of all (the display is scaled by it). */ max: number; }

export function buildPeaks(l: Float32Array, r: Float32Array, frames: number): Peaks {
  const n0 = Math.max(1, Math.ceil(frames / PEAK_BASE));
  const first = new Float32Array(n0);
  let max = 0;
  for (let b = 0; b < n0; b++) {
    let m = 0;
    const s = b * PEAK_BASE, e = Math.min(frames, s + PEAK_BASE);
    for (let i = s; i < e; i++) { const x = Math.abs(l[i]), y = Math.abs(r[i]); if (x > m) m = x; if (y > m) m = y; }
    first[b] = m;
    if (m > max) max = m;
  }
  const levels = [first];
  while (levels[levels.length - 1].length > 64) {
    const p = levels[levels.length - 1], q = new Float32Array(Math.ceil(p.length / 4));
    for (let i = 0; i < p.length; i++) { const k = i >> 2; if (p[i] > q[k]) q[k] = p[i]; }
    levels.push(q);
  }
  return { levels, max: max || 1 };
}

/** The level whose bins are the biggest that are still no bigger than `framesPerPixel`, and the frames in one of its bins. */
export function levelFor(p: Peaks, framesPerPixel: number): { level: number; bin: number } {
  let level = 0;
  while (level + 1 < p.levels.length && PEAK_BASE * 4 ** (level + 1) <= framesPerPixel) level++;
  return { level, bin: PEAK_BASE * 4 ** level };
}

/** The loudest value in frames [from, to) (0...1 against the loudest of the record); beyond the record: 0. */
export function peakBetween(p: Peaks, level: number, from: number, to: number): number {
  const data = p.levels[level], bin = PEAK_BASE * 4 ** level;
  const a = Math.max(0, Math.floor(from / bin)), b = Math.min(data.length - 1, Math.max(a, Math.ceil(to / bin) - 1));
  if (a >= data.length || b < 0) return 0;
  let m = 0;
  for (let i = a; i <= b; i++) if (data[i] > m) m = data[i];
  return m / p.max;
}
