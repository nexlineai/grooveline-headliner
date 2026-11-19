// The page's side of the sound: port of HeadlinerAudio/Deck.swift and DeckEngine.swift. The
// game sets what the motor and the hand are doing; the audio thread (worklet.ts) moves the
// needle and reports back where it is.

import { BeatGrid } from "../core/beatgrid.ts";
import type { TrackInfo } from "../core/beatgrid.ts";
import { eqDecibels } from "../core/mixjudge.ts";
import { RoomAlignment, rampSeconds } from "./align.ts";
import { buildPeaks } from "./peaks.ts";
import type { Peaks } from "./peaks.ts";
import { PHONES_UNITY, ROOM_UNITY, phonesGainFor, trimGainFor } from "./fx.ts";
import { isAiff, parseAiff } from "../library/aiff.ts";
import { firstOnset, overview } from "../core/vinyl.ts";
import { AUDIO_FIELDS, D, DECKS, M, S, SIZE, deckAt, mixerAt, stripAt } from "./layout.ts";
import type { FromWorklet, ToWorklet } from "./layout.ts";

/** How the headphones are fed: OFF (the room in stereo), SPLIT (one stereo output and a splitter
 * cable: the room left, the headphones right), CARD (a sound card with four outputs: the room on
 * 1-2, the headphones on 3-4), SECOND (the room on one sound device, the headphones on another). */
export type PhonesMode = "off" | "split" | "card" | "second";

export interface OutputDevice { id: string; label: string; }

/** The shared values plus a way to tell the audio thread they changed (when not shared). */
export class Shared {
  readonly values: Float64Array;
  readonly isShared: boolean;
  private port: MessagePort | null = null;
  private pending = false;

  constructor() {
    // Shared memory needs a cross-origin isolated page (COOP/COEP headers); otherwise messages.
    this.isShared = typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;
    this.values = new Float64Array(this.isShared ? new SharedArrayBuffer(SIZE * 8) : new ArrayBuffer(SIZE * 8));
  }

  attach(port: MessagePort): void {
    this.port = port;
    if (!this.isShared) {
      port.onmessage = (e: MessageEvent<FromWorklet>) => {
        if (e.data.type !== "state") return;
        for (let d = 0; d < DECKS; d++) {
          for (const f of AUDIO_FIELDS) {
            const i = deckAt(d, f);
            this.values[i] = f === D.peak ? Math.max(this.values[i], e.data.values[i]) : e.data.values[i];
          }
        }
      };
      this.changed();
    }
  }

  set(i: number, v: number): void {
    if (this.values[i] === v) return;
    this.values[i] = v;
    this.changed();
  }

  get(i: number): number { return this.values[i]; }

  post(m: ToWorklet, transfer: Transferable[] = []): void { this.port?.postMessage(m, transfer); }

  private changed(): void {
    if (this.isShared || this.pending || !this.port) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.post({ type: "sync", values: this.values.slice() });
    });
  }
}

/** One turntable with a record on it. */
export class Deck {
  private readonly shared: Shared;
  private readonly index: number;

  info: TrackInfo | null = null;
  grid = new BeatGrid(120);
  duration = 0;
  fileRate = 44_100;
  /** Frames of the record on the platter (known to the page before the audio thread has it). */
  private frames = 0;
  /** How loud the record is along its length, 0...1 per slice (for the strip above the platter). */
  overview: Float32Array = new Float32Array(0);
  /** Where CUE returns to, in seconds. */
  cuePoint = 0;

  private _outputRate = 48_000;
  private _motorOn = false;
  private _pitch = 0;
  private _bend = 0;
  private _held = false;
  private _handRate = 0;
  private _volume = 1;
  /** The gain knob (free play), 0...1, 0.5 = 0 dB. It stays on the deck when a new record is loaded. */
  private _trim = 0.5;
  private _cue = false;
  private _lifted = false;
  private seekSeq = 0;
  /** CUE's own transport: the record starts and stops within a few milliseconds, like the cue of a
   * club deck, instead of the motor's run-up and run-down. PLAY (the motor setter) ends it. */
  private _quick = false;
  /** A CUE return waiting for the record to stop: where the needle will drop, and its timer. */
  private parkSpot: number | null = null;
  private parkTimer: ReturnType<typeof setTimeout> | null = null;
  /** A CUE preview starts with the quick glide only: this ends it a moment later, so pitch, nudges
   * and SYNC move the playing record as smoothly as with PLAY. */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(shared: Shared, index: number) {
    this.shared = shared;
    this.index = index;
    this.shared.set(stripAt(index, S.fader), 1);
    this.pushGain();
    this.apply();
  }

  get isLoaded(): boolean { return this.frames > 0; }

  /** Output sample rate of the engine; set by `DeckEngine` before it starts. */
  get outputRate(): number { return this._outputRate; }
  set outputRate(v: number) { this._outputRate = v; this.apply(); }
  /** The platter motor (the START/STOP button). */
  get motorOn(): boolean { return this._motorOn; }
  set motorOn(v: boolean) { this.cancelPark(); this.endSettle(); this._quick = false; this._motorOn = v; this.apply(); }
  /** Pitch fader, as a fraction: 0.02 is +2 %. */
  get pitch(): number { return this._pitch; }
  set pitch(v: number) { this._pitch = v; this.apply(); }
  /** A short push or drag on top of the pitch (rim nudge, or sync pulling the beats together). */
  get bend(): number { return this._bend; }
  set bend(v: number) { this._bend = v; this.apply(); }
  /** A hand is on the record: it turns at the hand's speed and ignores the motor. */
  get held(): boolean { return this._held; }
  set held(v: boolean) { this._held = v; this.apply(); }
  /** Speed of the hand, in record speeds (1 = normal play, 0 = holding still, negative = pulling back). */
  get handRate(): number { return this._handRate; }
  set handRate(v: number) { this._handRate = v; this.apply(); }
  /** Channel fader and crossfader combined, 0...1: how much of this deck the room hears. */
  get volume(): number { return this._volume; }
  set volume(v: number) { this._volume = v; this.shared.set(stripAt(this.index, S.fader), Math.max(0, Math.min(1, v))); }
  /** Heard in the headphones (before the fader), when the mixer's headphone output is on. */
  get cue(): boolean { return this._cue; }
  set cue(v: boolean) { this._cue = v; this.shared.set(stripAt(this.index, S.cue), v ? 1 : 0); }
  /** The needle is off the record (being carried to another spot): the platter keeps turning, no sound. */
  get lifted(): boolean { return this._lifted; }
  set lifted(v: boolean) { this._lifted = v; this.pushGain(); }
  /** The gain knob of the channel (web only), 0...1 with 0.5 = 0 dB: turns a record that is mastered too loud down,
   * a quiet one up. It works through the needle's gain, so it comes before the EQ, the filter and the fader, and the
   * channel meter shows the record as the mixer will hear it. */
  get trim(): number { return this._trim; }
  set trim(v: number) {
    const x = Math.max(0, Math.min(1, v));
    if (x === this._trim) return;
    this._trim = x;
    this.pushGain();
  }
  /** What the audio thread's needle gain glides to: silent while the needle is lifted, else the trim. */
  private pushGain(): void { this.shared.set(deckAt(this.index, D.targetGain), this._lifted ? 0 : trimGainFor(this._trim)); }

  // MARK: - Hot cues, loops and the fine waveform (LIVE, web only)

  /** The record's loudness at several zoom levels (audio/peaks.ts), for the zoomable waveform. */
  peaks: Peaks | null = null;
  /** Eight hot cues, in seconds (null: empty), and eight saved loops. They belong to the record; the page keeps them with a library track. */
  hotCues: (number | null)[] = Array.from({ length: 8 }, () => null);
  loopSlots: ({ start: number; end: number } | null)[] = Array.from({ length: 8 }, () => null);
  /** The loop now, in seconds: set by IN and OUT, an auto loop or a saved loop; `loopOn` says whether the needle follows it. */
  loopStart = 0;
  loopEnd = 0;
  private _loopOn = false;
  /** IN was pressed (or a loop was made another way): OUT has a start to close. */
  private loopArmed = false;
  /** Set and jump on the beat while the record turns (standing still, a mark goes exactly where the needle is). */
  quantize = true;
  /** The marks changed (the page saves them). */
  onMarks: () => void = () => {};

  get loopOn(): boolean { return this._loopOn && this.loopEnd > this.loopStart; }
  /** A needle drop while the record turns crossfades (no click). LIVE switches it on; the game's booth never does. */
  set smoothSeek(on: boolean) { this.shared.set(deckAt(this.index, D.smoothSeek), on ? 64 : 0); }

  /** Forgets every mark (a new record on the deck). */
  resetMarks(): void {
    this.hotCues = this.hotCues.map(() => null);
    this.loopSlots = this.loopSlots.map(() => null);
    this.loopStart = this.loopEnd = 0;
    this._loopOn = false;
    this.loopArmed = false;
    this.pushLoop();
  }

  /** The marks as they are kept with a library track, and the other way round. */
  marks(): { cues: (number | null)[]; loops: ({ start: number; end: number } | null)[] } {
    return { cues: this.hotCues.slice(), loops: this.loopSlots.map((l) => (l ? { ...l } : null)) };
  }
  setMarks(m: { cues?: (number | null)[]; loops?: ({ start: number; end: number } | null)[] }): void {
    const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= this.duration;
    this.hotCues = this.hotCues.map((_, i) => (ok(m.cues?.[i]) ? (m.cues![i] as number) : null));
    this.loopSlots = this.loopSlots.map((_, i) => { const l = m.loops?.[i]; return l && ok(l.start) && ok(l.end) && l.end > l.start ? { start: l.start, end: l.end } : null; });
  }

  private pushLoop(): void {
    const on = this.loopOn, rate = this.fileRate;
    this.shared.set(deckAt(this.index, D.loopStart), on ? this.loopStart * rate : 0);
    this.shared.set(deckAt(this.index, D.loopEnd), on ? this.loopEnd * rate : 0);
  }

  /** The nearest beat of the grid. */
  private onBeat(seconds: number): number { return this.grid.secondsAtBeat(Math.round(this.grid.beat(seconds))); }
  /** While the record turns a mark is set on the beat; standing still it goes exactly where the needle is. */
  private snapped(seconds: number): number { return this.quantize && Math.abs(this.rate) > 0.3 && this.grid.beatLength > 0 ? Math.max(0, Math.min(this.duration, this.onBeat(seconds))) : seconds; }

  /** Where a jump to `target` lands: while the record turns, on the same beat phase as now, so the beats keep lining up. */
  private landing(target: number): number {
    if (!this.quantize || Math.abs(this.rate) < 0.3 || !(this.grid.beatLength > 0)) return target;
    const here = this.grid.beat(this.seconds);
    return Math.max(0, Math.min(this.duration, this.grid.secondsAtBeat(Math.round(this.grid.beat(target)) + (here - Math.floor(here)))));
  }

  /** Puts the needle at `seconds`; a loop the needle is no longer in is left. */
  jumpTo(seconds: number): void {
    if (this.loopOn && (seconds < this.loopStart - 1e-6 || seconds >= this.loopEnd)) { this._loopOn = false; this.pushLoop(); }
    this.seek(seconds);
  }

  /** A hot cue pad: an empty one is set where the needle is, a set one jumps there. */
  hotCuePress(i: number): void {
    if (!this.isLoaded) return;
    const cue = this.hotCues[i];
    if (cue === null) { this.hotCues[i] = this.snapped(this.seconds); this.onMarks(); }
    else this.jumpTo(this.landing(cue));
  }
  clearHotCue(i: number): void { if (this.hotCues[i] !== null) { this.hotCues[i] = null; this.onMarks(); } }

  /** LOOP IN: the loop starts here (the loop is off until OUT is pressed). */
  loopIn(): void {
    if (!this.isLoaded) return;
    this.loopStart = this.snapped(this.seconds);
    this.loopArmed = true;
    if (this.loopEnd <= this.loopStart + 0.02) this.loopEnd = 0;
    this._loopOn = this.loopEnd > this.loopStart && this._loopOn;
    this.pushLoop();
  }
  /** LOOP OUT: the loop ends here and begins to turn. */
  loopOut(): void {
    if (!this.isLoaded || !this.loopArmed) return;
    const end = this.snapped(this.seconds);
    if (end <= this.loopStart + 0.02) return;
    this.loopEnd = end;
    this._loopOn = true;
    this.pushLoop();
  }
  /** The loop on or off (off: the needle runs on past it; on again: it goes back into it). */
  toggleLoop(): void {
    if (this.loopOn) { this._loopOn = false; this.pushLoop(); return; }
    if (!(this.loopEnd > this.loopStart)) return;
    this._loopOn = true;
    this.pushLoop();
    const s = this.seconds;
    if (s < this.loopStart || s >= this.loopEnd) this.seek(this.landing(this.loopStart));
  }
  /** A loop of this many beats from the beat the needle is on. */
  autoLoop(beats: number): void {
    if (!this.isLoaded || !(this.grid.beatLength > 0)) return;
    const start = this.onBeat(this.seconds), end = Math.min(this.duration - 0.05, start + beats * this.grid.beatLength);
    if (end <= start + 0.02) return;
    this.loopStart = Math.max(0, start); this.loopEnd = end; this._loopOn = true; this.loopArmed = true;
    this.pushLoop();
  }
  /** Half the loop, or twice it (from its start). */
  loopScale(factor: number): void {
    if (!(this.loopEnd > this.loopStart)) return;
    const end = Math.min(this.duration - 0.05, this.loopStart + (this.loopEnd - this.loopStart) * factor);
    if (end <= this.loopStart + 0.02) return;
    this.loopEnd = end;
    this.pushLoop();
  }
  /** A loop pad: an empty one keeps the loop that is set, a full one makes that the loop and starts it. */
  loopSlotPress(i: number): void {
    const slot = this.loopSlots[i];
    if (slot === null) {
      if (!(this.loopEnd > this.loopStart)) return;
      this.loopSlots[i] = { start: this.loopStart, end: this.loopEnd };
      this.onMarks();
      return;
    }
    this.loopStart = slot.start; this.loopEnd = slot.end; this._loopOn = true; this.loopArmed = true;
    this.pushLoop();
    const s = this.seconds;
    if (s < slot.start || s >= slot.end) this.seek(this.landing(slot.start));
  }
  clearLoopSlot(i: number): void { if (this.loopSlots[i] !== null) { this.loopSlots[i] = null; this.onMarks(); } }

  private apply(): void {
    let target: number, seconds: number; // time for the platter to cover most of the gap
    if (this._held) {
      target = this._handRate; seconds = 0.006;
    } else if (this._motorOn) {
      target = 1 + this._pitch + this._bend; seconds = this._quick ? 0.004 : 0.05;
    } else {
      target = 0; seconds = this._quick ? 0.005 : 0.12;
    }
    const s = this.shared, i = this.index;
    s.set(deckAt(i, D.targetRate), target);
    s.set(deckAt(i, D.glide), 1 - Math.exp(-1 / (seconds * this._outputRate)));
    s.set(deckAt(i, D.step), this.fileRate / this._outputRate);
  }

  /** Puts a decoded record on the platter, needle on the first beat, motor off. The browser
   * decodes at the output rate; its AAC decoder may trim the encoder's priming differently from
   * the iPhone's, so the grid starts where the first kick is found in the decoded audio. */
  loadDecoded(track: TrackInfo, audio: AudioBuffer, grid?: { bpm: number; firstBeat: number }): void {
    const frames = audio.length;
    if (frames <= 64) throw new Error(`${track.id}: empty file`);
    const left = new Float32Array(frames);
    audio.copyFromChannel(left, 0);
    const right = new Float32Array(frames);
    audio.copyFromChannel(right, audio.numberOfChannels > 1 ? 1 : 0);
    this.fileRate = audio.sampleRate;
    this.duration = frames / this.fileRate;
    // The game's records start on a kick, found here; a record of your own comes with its grid (library/).
    const onset = firstOnset(left, Math.min(frames, Math.trunc(this.fileRate * 2)));
    this.grid = grid ? new BeatGrid(grid.bpm, grid.firstBeat) : new BeatGrid(track.bpm, onset / this.fileRate);
    this.cuePoint = this.grid.firstBeat;
    this.overview = overview(left, frames, 240);
    this.peaks = buildPeaks(left, right, frames);
    this.resetMarks();
    this.info = track;
    this.frames = frames;
    this.cancelPark();
    this.endSettle();
    this._quick = false;
    this._motorOn = false;
    this._lifted = false;
    this._pitch = 0; this._bend = 0;
    this.pushGain();
    this.apply();
    // The audio thread swaps records between two buffers, so it never reads a half-loaded one.
    this.shared.set(deckAt(this.index, D.position), Math.max(1, this.cuePoint * this.fileRate));
    this.shared.set(deckAt(this.index, D.rate), 0);
    this.shared.post({ type: "load", deck: this.index, left, right, position: this.cuePoint * this.fileRate, keepPlace: false,
                       seekSeq: this.seekSeq },
                     [left.buffer, right.buffer]);
  }

  /** Puts a record made in the game (the studio's pattern) on the platter; its grid starts at
   * sample 0. With `keepPlace`, a deck that holds a record of the same length keeps turning
   * where it is: an edit is heard as the needle reaches it. Any sample rate: the deck reads it
   * at file rate / output rate, as on the iPhone. */
  loadMade(track: TrackInfo, left: Float32Array, right: Float32Array, sampleRate: number, keepPlace = false): void {
    const frames = Math.min(left.length, right.length);
    const swapInPlace = keepPlace && this.isLoaded && this.frames === frames && this.fileRate === sampleRate;
    this.overview = overview(left, frames, 240);
    if (!swapInPlace) this.resetMarks();
    this.peaks = buildPeaks(left, right, frames);
    this.info = track;
    if (!swapInPlace) {
      this.cancelPark();
      this.endSettle();
      this._quick = false;
      this._motorOn = false;
      this.fileRate = sampleRate;
      this.duration = frames / sampleRate;
      this.grid = new BeatGrid(track.bpm, 0);
      this.cuePoint = 0;
      this._lifted = false;
      this._pitch = 0; this._bend = 0;
      this.frames = frames;
      this.pushGain();
      this.apply();
    }
    const l = left.slice(0, frames), r = right.slice(0, frames);
    this.shared.post({ type: "load", deck: this.index, left: l, right: r, position: 1, keepPlace: swapInPlace,
                       seekSeq: this.seekSeq }, [l.buffer, r.buffer]);
  }

  /** A new grid for the record on the platter (a corrected tempo, or the first beat moved): the cue mark goes with it when it sat on the old first beat. */
  setGrid(bpm: number, firstBeat: number): void {
    const markOnGrid = Math.abs(this.cuePoint - this.grid.firstBeat) < 0.02;
    this.grid = new BeatGrid(bpm, Math.max(0, firstBeat));
    if (markOnGrid) this.cuePoint = this.grid.firstBeat;
  }

  /** Needle position in seconds. */
  get seconds(): number { return this.shared.get(deckAt(this.index, D.position)) / this.fileRate; }
  /** Needle position in beats on the record's grid. */
  get beat(): number { return this.grid.beat(this.seconds); }
  /** How fast the record is turning right now (1 = normal). */
  get rate(): number { return this.shared.get(deckAt(this.index, D.rate)); }
  /** Tempo after the pitch fader (without bends). */
  get bpm(): number { return this.grid.bpm * (1 + this._pitch); }
  /** 0...1 through the record. */
  get progress(): number { return this.duration > 0 ? Math.min(1, Math.max(0, this.seconds / this.duration)) : 0; }

  /** Lifts the needle and drops it at `seconds`. */
  seek(seconds: number): void {
    this.cancelPark();
    this.shared.set(deckAt(this.index, D.seekTo), Math.max(1, Math.min(this.duration, seconds) * this.fileRate));
    this.shared.set(deckAt(this.index, D.seekSeq), ++this.seekSeq);
  }

  /** CUE held on a stopped record: it plays from where the needle is, at once (no motor run-up). */
  preview(): void {
    this.cancelPark();
    this.endSettle();
    this._quick = true;
    this._motorOn = true;
    this.apply();
    this.settleTimer = setTimeout(() => { this.settleTimer = null; this._quick = false; this.apply(); }, 40);
  }

  /** PLAY pressed while CUE is held: the record goes on playing when CUE is let go. */
  latch(): void {
    this.endSettle();
    this._quick = false;
    this.apply();
  }

  /** CUE going back to its mark: the record stops almost at once (a few milliseconds, not the
   * motor's slow run-down), then the needle drops on the mark with nothing playing, so neither
   * a tape-stop tail nor a click is heard. */
  park(seconds: number): void {
    this.cancelPark();
    this.endSettle();
    this._quick = true;
    this._motorOn = false;
    this.apply();
    this.parkSpot = seconds;
    this.parkTimer = setTimeout(() => { this.parkTimer = null; this.finishPark(); }, 30);
  }

  /** Drops the needle on a pending CUE return now. Returns whether there was one (the needle
   * position the page reads is still the old one for a moment, so the caller must not trust it). */
  finishPark(): boolean {
    const at = this.parkSpot;
    if (at === null) return false;
    this.cancelPark();
    this.seek(at);
    return true;
  }

  private endSettle(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  private cancelPark(): void {
    if (this.parkTimer !== null) clearTimeout(this.parkTimer);
    this.parkTimer = null;
    this.parkSpot = null;
  }

  /** Loudest sample off the record since the last call, before EQ and fader (for the channel meters). */
  takePeak(): number {
    const i = deckAt(this.index, D.peak);
    const p = this.shared.get(i);
    this.shared.values[i] = 0;
    return p;
  }

  /** EQ knob: band 0 low, 1 mid, 2 high; value 0...1 with 0.5 flat. */
  setEQ(band: number, value: number): void {
    const field = band === 0 ? S.lowDB : band === 1 ? S.midDB : S.highDB;
    this.shared.set(stripAt(this.index, field), eqDecibels(value));
  }

  /** Filter knob, value 0...1: 0.5 off, below it a low-pass closing, above it a high-pass opening. */
  setFilter(value: number): void {
    this.shared.set(stripAt(this.index, S.filter), Math.max(-1, Math.min(1, (value - 0.5) * 2)));
  }
}

/** Two decks and the mixer. All of the sound is made by `renderMix` in one AudioWorklet. */
export class DeckEngine {
  private readonly shared = new Shared();
  readonly decks: Deck[];
  context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  running = false;
  lastError: string | null = null;
  private _phones: PhonesMode = "off";
  private _echoSeconds = 0;
  private _phonesLevel = PHONES_UNITY;
  // The routing: the node always has four channels; the mode only rewires what follows it.
  private splitter: ChannelSplitterNode | null = null;
  private roomPair: ChannelMergerNode | null = null;
  private cardQuad: ChannelMergerNode | null = null;
  private phonesPair: ChannelMergerNode | null = null;
  private phonesStream: MediaStreamAudioDestinationNode | null = null;
  private phonesElement: HTMLAudioElement | null = null;
  // TWO DEVICES the low-delay way: an AudioContext of its own on the headphones' device, fed from
  // the mixer through a ring of shared memory (phones-worklet.ts); the room waits for it.
  private phonesContext: AudioContext | null = null;
  private phonesNode: AudioWorkletNode | null = null;
  private phonesTarget = 1024;
  private roomDelay: DelayNode | null = null;
  private alignTimer: number | null = null;
  /** How long the room waits for the headphones: smoothed, set once, then left alone (see align.ts). */
  private readonly alignment = new RoomAlignment();
  private alignedOnce = false;
  private trimTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPostedTarget = 0;
  /** The headphones' timing set by ear (ms, + = the room waits more), per headphones device. */
  phonesTrimMs = 0;
  /** What the timing is now, for the PHONES panel. */
  timing = { roomMs: 0, phonesMs: 0, roomWaitsMs: 0, ring: false };
  /** The sound device for the room ("" = the system's default), and the one for the headphones. */
  roomDevice = "";
  phonesDevice = "";
  /** Something about the outputs changed by itself (a device unplugged): a sentence for the page. */
  onOutputsChanged: (why: string) => void = () => {};

  constructor() {
    this.decks = [new Deck(this.shared, 0), new Deck(this.shared, 1)];
    this.shared.set(mixerAt(M.master), 1);
    this.shared.set(mixerAt(M.roomMaster), ROOM_UNITY);
    this.shared.set(mixerAt(M.echoGain), 0.5);
    let saved = PHONES_UNITY;
    try { const s = localStorage.getItem("headliner.phonesLevel"); if (s !== null && Number.isFinite(Number(s))) saved = Number(s); } catch { /* private window */ }
    this.phonesLevel = saved;
  }

  get sharedMemory(): boolean { return this.shared.isShared; }

  /** Must run from a click or a touch: browsers only start sound after one. */
  async start(): Promise<void> {
    if (this.running) return;
    try {
      const context = new AudioContext({ latencyHint: "interactive" });
      await context.audioWorklet.addModule(new URL("./worklet.ts", import.meta.url));
      const node = new AudioWorkletNode(context, "headliner", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [4],
        channelInterpretation: "discrete",
        processorOptions: { buffer: this.shared.isShared ? this.shared.values.buffer : null },
      });
      // Channels 1-2 are the room, 3-4 the headphones (silent unless there are two outputs).
      const splitter = context.createChannelSplitter(4);
      node.connect(splitter);
      const roomPair = context.createChannelMerger(2);
      splitter.connect(roomPair, 0, 0);
      splitter.connect(roomPair, 1, 1);
      // The room can wait for headphones on a slower second device (0 otherwise).
      const roomDelay = context.createDelay(1);
      roomDelay.delayTime.value = 0;
      roomPair.connect(roomDelay);
      roomDelay.connect(context.destination);
      this.roomDelay = roomDelay;
      this.splitter = splitter;
      this.roomPair = roomPair;
      this.shared.attach(node.port);
      this.context = context;
      this.node = node;
      navigator.mediaDevices?.addEventListener?.("devicechange", () => { this.checkOutputs().catch(() => {}); });
      for (const deck of this.decks) deck.outputRate = context.sampleRate;
      this.echoSeconds = this._echoSeconds;
      if (context.state !== "running") await context.resume();
      this.running = true;
      this.lastError = null;
    } catch (e) {
      this.running = false;
      this.lastError = String(e);
      throw e;
    }
  }

  /** Fetches and decodes a record (at the output rate) and puts it on a deck. */
  async load(d: number, track: TrackInfo, url: string): Promise<void> {
    const context = this.context;
    if (!context) throw new Error("audio not started");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    this.decks[d].loadDecoded(track, audio);
  }

  /** A file's bytes into audio: whatever the browser decodes, and AIFF (which it does not). */
  async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const context = this.context;
    if (!context) throw new Error("audio not started");
    const view = new Uint8Array(bytes);
    if (isAiff(view)) {
      const pcm = parseAiff(view);
      const buffer = context.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.rate);
      pcm.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      return buffer;
    }
    return context.decodeAudioData(bytes);
  }

  /** The far speakers of a festival stage: the room hears the music this late as well (0 = off). */
  get echoSeconds(): number { return this._echoSeconds; }
  set echoSeconds(v: number) {
    this._echoSeconds = v;
    const rate = this.context?.sampleRate ?? 48_000;
    this.shared.set(mixerAt(M.echoDelay), Math.trunc(Math.max(0, v) * rate));
  }

  /** Everything the mixer puts out, 0...1. Turned down a little while a coach talks over the music. */
  /** LIVE's master knob (0...1; ROOM_UNITY = the mixer's own level): the room only, the headphones are left alone (audio/fx.ts). */
  get roomVolume(): number { return this.shared.get(mixerAt(M.roomMaster)); }
  set roomVolume(v: number) { this.shared.set(mixerAt(M.roomMaster), Math.max(0, Math.min(1, v))); }
  get masterVolume(): number { return this.shared.get(mixerAt(M.master)); }
  set masterVolume(v: number) { this.shared.set(mixerAt(M.master), Math.max(0, Math.min(1, v))); }

  /** How the headphones are fed. */
  get phones(): PhonesMode { return this._phones; }

  /** A sound card with four or more outputs is the system's (or the chosen room device's) output. */
  get cardAvailable(): boolean { return (this.context?.destination.maxChannelCount ?? 0) >= 4; }
  /** This browser can send the room to a chosen device (Chrome and Edge on desktop). */
  static get canChooseRoom(): boolean { return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype; }
  /** This browser can send the headphones to a second device. */
  static get canChoosePhones(): boolean { return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype; }

  /** Switches the headphone feed. Only rewires: the records and the decks are not touched. */
  async setPhones(mode: PhonesMode): Promise<void> {
    const context = this.context, splitter = this.splitter, roomPair = this.roomPair;
    if (!context || !splitter || !roomPair) { this._phones = mode; return; }
    if (mode === "card" && !this.cardAvailable) throw new Error("No sound card with four outputs is connected.");
    if (mode === "second" && !this.phonesDevice) throw new Error("Choose the sound device for the headphones first.");
    // The same device for both would put the cue in the room.
    if (mode === "second" && this.phonesDevice === this.roomDevice) throw new Error("The headphones need a different sound device from the room.");
    // Undo what the last mode built (silence first, so the cue never reaches the room).
    this.shared.set(mixerAt(M.twoOutputs), 0);
    this.shared.set(mixerAt(M.split), 0);
    if (this.cardQuad) { splitter.disconnect(this.cardQuad); this.cardQuad.disconnect(); this.cardQuad = null; }
    if (this.phonesPair) { splitter.disconnect(this.phonesPair); this.phonesPair.disconnect(); this.phonesPair = null; }
    if (this.phonesElement) { this.phonesElement.pause(); this.phonesElement.srcObject = null; this.phonesElement = null; }
    this.phonesStream = null;
    if (this.phonesContext) {
      this.node?.port.postMessage({ type: "ring", buffer: null, cap: 0 });
      this.phonesNode?.disconnect();
      this.phonesContext.close().catch(() => {});
      this.phonesContext = null;
      this.phonesNode = null;
    }
    if (this.alignTimer !== null) { clearInterval(this.alignTimer); this.alignTimer = null; }
    this.roomDelay?.delayTime.cancelScheduledValues(context.currentTime);
    this.roomDelay?.delayTime.setTargetAtTime(0, context.currentTime, 0.02);
    this.alignment.reset();
    this.alignedOnce = false;
    this.lastPostedTarget = 0;
    this.timing = { roomMs: 0, phonesMs: 0, roomWaitsMs: 0, ring: false };
    const roomOut = this.roomDelay ?? roomPair;
    try { roomOut.disconnect(); } catch { /* not connected */ }
    const dest = context.destination;
    if (mode === "card") {
      // Four channels straight to the card, in order: room 1-2, headphones 3-4.
      dest.channelCount = 4;
      dest.channelCountMode = "explicit";
      dest.channelInterpretation = "discrete";
      const quad = context.createChannelMerger(4);
      for (let c = 0; c < 4; c++) splitter.connect(quad, c, c);
      quad.connect(dest);
      this.cardQuad = quad;
      this.shared.set(mixerAt(M.twoOutputs), 1);
    } else {
      dest.channelCount = 2;
      dest.channelCountMode = "explicit";
      dest.channelInterpretation = "speakers";
      roomOut.connect(dest);
      if (mode === "second") {
        this.phonesTrimMs = this.savedTrim(this.phonesDevice);
        if (this.shared.isShared && DeckEngine.canChooseRoom) await this.openPhonesContext(context);
        else await this.openPhonesStream(context, splitter);
        this.shared.set(mixerAt(M.twoOutputs), 1);
        this.align();
        // A reading every second feeds the smoothing; the room's wait itself almost never changes.
        this.alignTimer = window.setInterval(() => this.align(), 1000);
      }
      if (mode === "split") this.shared.set(mixerAt(M.split), 1);
    }
    this._phones = mode;
  }

  /** The low-delay way: the headphones' own AudioContext on their device, fed by a ring. */
  private async openPhonesContext(context: AudioContext): Promise<void> {
    const cap = 8192;
    const ring = new SharedArrayBuffer(8 + cap * 2 * 4);
    const phones = new AudioContext({ latencyHint: "interactive", sampleRate: context.sampleRate }) as AudioContext & { setSinkId(id: string): Promise<void> };
    try {
      await phones.setSinkId(this.phonesDevice);
      await phones.audioWorklet.addModule(new URL("./phones-worklet.ts", import.meta.url));
      const node = new AudioWorkletNode(phones, "headliner-phones", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { buffer: ring, cap, target: this.phonesTarget },
      });
      // The phones' worklet asks for more room after running dry: the room waits a little more.
      node.port.onmessage = (e: MessageEvent<{ target?: number }>) => { if (e.data.target) { this.phonesTarget = e.data.target; this.align(); } };
      node.connect(phones.destination);
      if (phones.state !== "running") await phones.resume();
      this.phonesContext = phones;
      this.phonesNode = node;
      this.node?.port.postMessage({ type: "ring", buffer: ring, cap });
    } catch (e) {
      phones.close().catch(() => {});
      throw e;
    }
  }

  /** Without shared memory (a page that is not cross-origin isolated): a media stream played on
   * the other device. It works, with more delay; the room waits by the trim set by ear. */
  private async openPhonesStream(context: AudioContext, splitter: ChannelSplitterNode): Promise<void> {
    const pair = context.createChannelMerger(2);
    splitter.connect(pair, 2, 0);
    splitter.connect(pair, 3, 1);
    const stream = context.createMediaStreamDestination();
    pair.connect(stream);
    const element = new Audio();
    element.srcObject = stream.stream;
    await (element as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(this.phonesDevice);
    await element.play();
    this.phonesPair = pair;
    this.phonesStream = stream;
    this.phonesElement = element;
  }

  /** The room waits as long as the headphones' way is longer, plus the trim set by ear; when the headphones are the faster
   * ones, their ring holds a little more instead. The latencies the browser reports jump around, so this takes a reading,
   * smooths it (align.ts) and only moves the room's delay when the real offset has changed, and then slowly: a delay node
   * that is re-aimed bends the pitch of the main output. */
  private align(urgent = false): void {
    const room = this.context, delay = this.roomDelay;
    if (!room || !delay) return;
    const roomS = room.baseLatency + (room.outputLatency || 0);
    const phones = this.phonesContext;
    const ring = phones !== null;
    const phonesS = phones ? phones.baseLatency + (phones.outputLatency || 0) + this.phonesTarget / room.sampleRate : roomS;
    const change = this.alignment.read(roomS, phonesS, this.phonesTrimMs / 1000, urgent);
    if (change !== null) {
      const now = room.currentTime, param = delay.delayTime, from = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      if (this.alignedOnce) param.linearRampToValueAtTime(change, now + rampSeconds(from, change, urgent));
      else param.setValueAtTime(change, now); // the first time, before anything is playing: at once
      this.alignedOnce = true;
    }
    const A = this.alignment;
    if (ring && A.diff < 0) {
      // The headphones are ahead: keep more in their ring (at most half of it).
      const target = Math.max(this.phonesTarget, 1024 + Math.min(4096, Math.round(-A.diff * room.sampleRate)));
      if (target !== this.lastPostedTarget) { this.lastPostedTarget = target; this.phonesNode?.port.postMessage({ target }); }
    }
    this.timing = { roomMs: Math.round(A.roomS * 1000), phonesMs: Math.round(A.phonesS * 1000), roomWaitsMs: Math.round((A.applied ?? 0) * 1000), ring };
  }

  /** The trim set by ear for a headphones device (kept in this browser). */
  private savedTrim(device: string): number {
    try { return Number(localStorage.getItem(`headliner.phonesTrim.${device}`) ?? 0) || 0; } catch { return 0; }
  }

  /** The headphones' timing by ear: + ms = the room waits more (the headphones sound late). */
  setPhonesTrim(ms: number): void {
    this.phonesTrimMs = Math.max(-150, Math.min(400, Math.round(ms)));
    try { localStorage.setItem(`headliner.phonesTrim.${this.phonesDevice}`, String(this.phonesTrimMs)); } catch { /* private window */ }
    // The slider sends many values a second: the room follows once the hand stops.
    if (this.trimTimer) clearTimeout(this.trimTimer);
    this.trimTimer = setTimeout(() => { this.trimTimer = null; this.align(true); }, 200);
  }

  /** Sends the room to a device ("" = the system's default). */
  async setRoomDevice(id: string): Promise<void> {
    const context = this.context as (AudioContext & { setSinkId?(id: string): Promise<void> }) | null;
    if (!context?.setSinkId) throw new Error("This browser cannot choose the output (use Chrome or Edge).");
    await context.setSinkId(id);
    this.roomDevice = id;
    // A different device may have a different number of outputs.
    if (this._phones === "card" && !this.cardAvailable) {
      await this.setPhones("off");
      this.onOutputsChanged("The room's device has no four outputs: headphones OFF.");
    }
  }

  async setPhonesDevice(id: string): Promise<void> {
    this.phonesDevice = id;
    if (this._phones === "second") await this.setPhones("second");
  }

  /** The sound outputs the browser knows. Chrome names them only after the microphone was allowed
   * once (`allowDeviceNames`). */
  async listOutputs(): Promise<OutputDevice[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audiooutput" && d.deviceId)
      .map((d, i) => ({ id: d.deviceId === "default" ? "" : d.deviceId, label: d.label || `Output ${i + 1}` }));
  }

  /** Asks for the microphone once, only so the browser shows the sound devices' names; the
   * microphone is switched off at once and nothing is recorded. */
  async allowDeviceNames(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  }

  /** A device went away: never let the cue fall back to the room's speakers. */
  private async checkOutputs(): Promise<void> {
    if (this._phones === "second" && this.phonesDevice) {
      const outputs = await this.listOutputs();
      if (!outputs.some((o) => o.id === this.phonesDevice)) {
        await this.setPhones("off");
        this.phonesDevice = "";
        this.onOutputsChanged("The headphones' sound device was unplugged: headphones OFF.");
      }
    }
    if (this._phones === "card" && !this.cardAvailable) {
      await this.setPhones("off");
      this.onOutputsChanged("The four-output sound card is gone: headphones OFF.");
    }
  }

  /** The headphones' level, knob 0...1 (PHONES_UNITY = as loud as before the knob). Kept in this browser. */
  get phonesLevel(): number { return this._phonesLevel; }
  set phonesLevel(v: number) {
    this._phonesLevel = Math.max(0, Math.min(1, v));
    this.shared.set(mixerAt(M.phonesGain), phonesGainFor(this._phonesLevel));
    try { localStorage.setItem("headliner.phonesLevel", String(this._phonesLevel)); } catch { /* private window */ }
  }

  // The effect unit (audio/fx.ts): one, on the master.
  get fxType(): number { return this.shared.get(mixerAt(M.fxType)); }
  set fxType(v: number) { this.shared.set(mixerAt(M.fxType), v); }
  get fxOn(): boolean { return this.shared.get(mixerAt(M.fxOn)) !== 0; }
  set fxOn(v: boolean) { this.shared.set(mixerAt(M.fxOn), v ? 1 : 0); }
  get fxAmount(): number { return this.shared.get(mixerAt(M.fxAmount)); }
  set fxAmount(v: number) { this.shared.set(mixerAt(M.fxAmount), Math.max(0, Math.min(1, v))); }
  /** The four knobs of the effect, 0...1 (what each one is: FX_KNOBS in fx.ts). */
  fxKnob(i: number): number { return this.shared.get(mixerAt(M.fxKnob + i)); }
  setFxKnob(i: number, v: number): void { this.shared.set(mixerAt(M.fxKnob + i), Math.max(0, Math.min(1, v))); }
  /** The delay time in seconds (a note value at the playing tempo; the flanger sweeps once per eight of them). */
  set fxDelaySeconds(v: number) { this.shared.set(mixerAt(M.fxDelay), v); }

  /** What the headphones hear: 0 = only the cued decks, 1 = only the room. */
  get cueMix(): number { return this.shared.get(mixerAt(M.cueMix)); }
  set cueMix(v: number) { this.shared.set(mixerAt(M.cueMix), Math.max(0, Math.min(1, v))); }

  /** Seconds from a touch to the sound (what the browser reports), for the diagnostic line. */
  get latency(): number {
    const c = this.context;
    return c ? c.baseLatency + (c.outputLatency || 0) : 0;
  }
}
