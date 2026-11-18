// Port of HeadlinerCore/BeatGrid.swift. Keep the arithmetic identical: the iPhone and the web
// must judge a mix the same way.

/** Where the beats of a record are: a steady tempo and the time of the first beat of the first bar. */
export class BeatGrid {
  bpm: number;
  /** Seconds into the file where beat 0 (a bar start) sits. */
  firstBeat: number;

  constructor(bpm: number, firstBeat = 0) {
    this.bpm = bpm;
    this.firstBeat = firstBeat;
  }

  get beatLength(): number { return 60 / this.bpm; }

  /** Beats since the first beat; fractional, negative before it. */
  beat(seconds: number): number { return (seconds - this.firstBeat) / this.beatLength; }

  secondsAtBeat(beat: number): number { return this.firstBeat + beat * this.beatLength; }

  /** 0 on a beat, rising to just under 1 before the next. */
  phase(seconds: number): number {
    const b = this.beat(seconds);
    return b - Math.floor(b);
  }

  /** 0-based bar number (4 beats to the bar). */
  bar(seconds: number): number { return Math.floor(this.beat(seconds) / 4); }

  /** 0, 1, 2 or 3: which beat of the bar is sounding. */
  beatInBar(seconds: number): number {
    const b = Math.floor(this.beat(seconds));
    return ((b % 4) + 4) % 4;
  }
}

/** One record in the crate, as listed in `tracks.json`. */
export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  label: string;
  genre: string;
  bpm: number;
  key: string;
  camelot: string;
  bars: number;
  seconds: number;
  file: string;
  /** The chapter whose crate the record belongs to (absent: chapter 1). */
  chapter?: number | null;
}
