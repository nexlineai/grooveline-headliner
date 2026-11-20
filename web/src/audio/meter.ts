// The master level meter: what the radio gets (the room, never the headphones), read as the peak of each side. Pure arithmetic, so it can be tested without a browser.
// Display: dBFS from FLOOR_DB (empty) to 0 (full). Attack is instant, the fall is steady (FALL_DB_PER_S), and the highest peak is held for HOLD_MS (the thin line and the number),
// so a short loud hit is still there when the eye gets to it. CLIP_DB and above is a clip: the CLIP light stays for CLIP_MS.
export const FLOOR_DB = -60;
export const CLIP_DB = -0.5;
export const FALL_DB_PER_S = 24;
export const HOLD_MS = 1500;
export const CLIP_MS = 2500;

/** A linear peak (0...1+) in dBFS, floored. */
export function toDb(peak: number): number {
  if (!(peak > 0)) return FLOOR_DB;
  return Math.max(FLOOR_DB, 20 * Math.log10(peak));
}

/** A dB value on the meter's 0...1 scale (0 = FLOOR_DB, 1 = 0 dBFS). Slightly bent so the top 18 dB (where the mix lives) get more than a third of the height. */
export function fill(db: number): number {
  const x = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
  return x ** 1.35;
}

export interface MeterSide { db: number; holdDb: number; holdAge: number }
export interface MeterView {
  /** 0...1 fill per side. */
  fill: [number, number];
  /** The held peak per side, 0...1 on the same scale. */
  hold: [number, number];
  /** The highest held peak of the two sides, in dB ("-6.2"), or null while nothing has been heard. */
  holdDb: number | null;
  clipping: boolean;
}

export class Meter {
  private readonly sides: [MeterSide, MeterSide] = [{ db: FLOOR_DB, holdDb: FLOOR_DB, holdAge: 0 }, { db: FLOOR_DB, holdDb: FLOOR_DB, holdAge: 0 }];
  private clipAge = Infinity;

  /** One reading: the peaks (linear) of the left and right side since the last one, and the time since the last one. */
  update(peakL: number, peakR: number, dtMs: number): void {
    const dt = Math.max(0, Math.min(500, dtMs));
    let clipped = false;
    [peakL, peakR].forEach((p, i) => {
      const s = this.sides[i], now = toDb(p);
      s.db = now >= s.db ? now : Math.max(now, s.db - FALL_DB_PER_S * dt / 1000);
      s.holdAge += dt;
      if (now >= s.holdDb || s.holdAge > HOLD_MS) { s.holdDb = now >= s.holdDb ? now : Math.max(now, s.db); s.holdAge = 0; }
      if (now >= CLIP_DB) clipped = true;
    });
    this.clipAge = clipped ? 0 : this.clipAge + dt;
  }

  reset(): void { for (const s of this.sides) { s.db = FLOOR_DB; s.holdDb = FLOOR_DB; s.holdAge = 0; } this.clipAge = Infinity; }

  get view(): MeterView {
    const [a, b] = this.sides, top = Math.max(a.holdDb, b.holdDb);
    return { fill: [fill(a.db), fill(b.db)], hold: [fill(a.holdDb), fill(b.holdDb)], holdDb: top > FLOOR_DB ? top : null, clipping: this.clipAge < CLIP_MS };
  }
}
