// Where each value lives in the memory the page and the audio thread share (one Float64Array).
// The page writes the "wanted" values (the motor, the hand, the knobs); the audio thread writes
// where the needle is and how fast the record turns. Single fields only, no locks: the same rule
// as DeckShared on the iPhone.

export const DECKS = 2;

/** Per deck. */
export const D = {
  // Written by the page.
  targetRate: 0,
  glide: 1,
  step: 2,
  targetGain: 3,
  /** A needle drop: the audio thread takes it when `seekSeq` changes. */
  seekTo: 4,
  seekSeq: 5,
  // Written by the audio thread (the page only zeroes `peak` after reading it).
  position: 6,
  rate: 7,
  gain: 8,
  peak: 9,
  frames: 10,
  stride: 12,
} as const;

/** Per mixer channel (all written by the page). */
export const S = { lowDB: 0, midDB: 1, highDB: 2, fader: 3, cue: 4, filter: 5, stride: 6 } as const;

/** The mixer (all written by the page). */
export const M = { split: 0, cueMix: 1, master: 2, echoDelay: 3, echoGain: 4, twoOutputs: 5 } as const;

export const DECK_BASE = 0;
export const STRIP_BASE = DECK_BASE + DECKS * D.stride;
export const MIXER_BASE = STRIP_BASE + DECKS * S.stride;
export const SIZE = MIXER_BASE + 8;

export const deckAt = (d: number, field: number): number => DECK_BASE + d * D.stride + field;
export const stripAt = (d: number, field: number): number => STRIP_BASE + d * S.stride + field;
export const mixerAt = (field: number): number => MIXER_BASE + field;

/** The audio thread's fields of a deck (copied to the page in the no-shared-memory fallback). */
export const AUDIO_FIELDS = [D.position, D.rate, D.gain, D.peak, D.frames];

/** Messages from the page to the audio thread. */
export type ToWorklet =
  /** `seekSeq`: the deck's needle-drop count when the record was sent. A drop asked for after it
   * (a lesson cueing the record it just loaded) lands on the new record, even when the shared
   * count changed before this message arrived. */
  | { type: "load"; deck: number; left: Float32Array; right: Float32Array; position: number; keepPlace: boolean; seekSeq: number }
  | { type: "unload"; deck: number }
  | { type: "sync"; values: Float64Array }
  /** The headphones on a second device: the ring to write their channels into (null: stop). */
  | { type: "ring"; buffer: SharedArrayBuffer | null; cap: number };

/** Messages from the audio thread to the page (fallback only: the audio thread's fields). */
export type FromWorklet = { type: "state"; values: Float64Array };
