// TWO DEVICES: how long the room waits for the headphones (web only). A delay node that is re-aimed changes the pitch of everything
// passing through it, so this must almost never happen: a sound card's reported latency jumps around by tens of milliseconds from one
// reading to the next (measured: the room's delay was re-aimed ten times in twenty seconds, and a 1 kHz tone moved by up to 31 cents
// each time). So the readings are smoothed with a median, the room's wait is set once, and it is changed again only when the real
// offset has moved a lot, and then very slowly.

/** The room's wait is left alone unless the wanted value moves by more than this (seconds). Simulated with readings that jump by
 * +-14 ms: one change in ten minutes (the first); with +-25 ms, about three. */
export const DEAD_BAND = 0.025;

const median = (values: number[]): number => {
  const a = values.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export class RoomAlignment {
  /** What the room waits now (seconds); null until the first reading has settled. */
  applied: number | null = null;
  /** Smoothed latencies and the unclamped difference they give (negative: the headphones are the faster ones), for the panel. */
  roomS = 0;
  phonesS = 0;
  diff = 0;
  private readonly room: number[] = [];
  private readonly phones: number[] = [];
  private readonly deadBand: number;
  private readonly keep: number;
  private readonly settle: number;

  constructor(deadBand = DEAD_BAND, keep = 25, settle = 8) {
    this.deadBand = deadBand;
    this.keep = keep;
    this.settle = settle;
  }

  reset(): void {
    this.applied = null;
    this.room.length = 0;
    this.phones.length = 0;
    this.roomS = this.phonesS = this.diff = 0;
  }

  /** One reading (seconds). Returns what the room should now wait when that must change, else null (leave it alone).
   * `urgent`: the trim was moved by hand, so even a small change is followed. */
  read(roomS: number, phonesS: number, trimS: number, urgent = false): number | null {
    this.room.push(roomS); this.phones.push(phonesS);
    if (this.room.length > this.keep) { this.room.shift(); this.phones.shift(); }
    this.roomS = median(this.room);
    this.phonesS = median(this.phones);
    this.diff = this.phonesS - this.roomS + trimS;
    if (this.room.length < this.settle && !urgent) return null; // a few readings first: the first ones are the least steady
    const wanted = Math.max(0, Math.min(0.9, this.diff));
    if (this.applied === null || Math.abs(wanted - this.applied) > (urgent ? 0.001 : this.deadBand)) {
      this.applied = wanted;
      return wanted;
    }
    return null;
  }
}

/** How long the room takes to move from one wait to another: slowly enough that nobody hears the pitch change (half a
 * percent at most), except for the trim slider, which the hand is moving and which follows at once. */
export function rampSeconds(from: number, to: number, urgent: boolean): number {
  return urgent ? 0.35 : Math.max(2, Math.abs(to - from) * 200);
}
