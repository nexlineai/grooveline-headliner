// The web's master section: the headphones level now, the effect unit next. It has no Swift twin,
// so it lives here and not in core/. The audio thread calls `process` right after `renderMix`
// (and before the second device's ring is filled), so every phones mode hears the level.

/** Knob position at which the headphones are as loud as before the knob existed (unity gain). */
export const PHONES_UNITY = 0.7;

/** Headphones level, knob 0...1 -> gain: -60 dB at the bottom (silent from 2 %), unity at 0.7, +6 dB at the top. */
export function phonesGainFor(knob: number): number {
  const x = Math.max(0, Math.min(1, knob));
  if (x <= 0.02) return 0;
  const dB = x <= PHONES_UNITY ? -60 * (PHONES_UNITY - x) / PHONES_UNITY : 6 * (x - PHONES_UNITY) / (1 - PHONES_UNITY);
  return Math.pow(10, dB / 20);
}

/** Transparent below 0.9, a soft knee above it, never beyond 1: boosted headphones must not hard-clip at the device. */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.9) return x;
  const y = 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1);
  return x < 0 ? -y : y;
}

export class MasterSection {
  /** Wanted headphones gain (linear), written by the page. */
  phonesGain = 1;
  private phonesNow = 1;

  /**
   * `outL`/`outR`: the room (the stereo pair; in `split` mode the left is the room in mono and the
   * right is the headphones in mono). `pl`/`pr`: the headphones' own pair (a sound card or a second
   * device), or null.
   */
  process(outL: Float32Array, outR: Float32Array, pl: Float32Array | null, pr: Float32Array | null, split: boolean, _cueMix: number, count: number): void {
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
