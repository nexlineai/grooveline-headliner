// The page's side of the sound: port of HeadlinerAudio/Deck.swift and DeckEngine.swift. The
// game sets what the motor and the hand are doing; the audio thread (worklet.ts) moves the
// needle and reports back where it is.

import { BeatGrid } from "../core/beatgrid.ts";
import type { TrackInfo } from "../core/beatgrid.ts";
import { eqDecibels } from "../core/mixjudge.ts";
import { firstOnset, overview } from "../core/vinyl.ts";
import { AUDIO_FIELDS, D, DECKS, M, S, SIZE, deckAt, mixerAt, stripAt } from "./layout.ts";
import type { FromWorklet, ToWorklet } from "./layout.ts";

/** How the headphones are fed: the room in stereo, or the room left and the headphones right. */
export type PhonesMode = "off" | "split";

/** The shared values plus a way to tell the audio thread they changed (when not shared). */
class Shared {
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
  private _cue = false;
  private _lifted = false;
  private seekSeq = 0;

  constructor(shared: Shared, index: number) {
    this.shared = shared;
    this.index = index;
    this.shared.set(stripAt(index, S.fader), 1);
    this.shared.set(deckAt(index, D.targetGain), 1);
    this.apply();
  }

  get isLoaded(): boolean { return this.frames > 0; }

  /** Output sample rate of the engine; set by `DeckEngine` before it starts. */
  get outputRate(): number { return this._outputRate; }
  set outputRate(v: number) { this._outputRate = v; this.apply(); }
  /** The platter motor (the START/STOP button). */
  get motorOn(): boolean { return this._motorOn; }
  set motorOn(v: boolean) { this._motorOn = v; this.apply(); }
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
  set lifted(v: boolean) { this._lifted = v; this.shared.set(deckAt(this.index, D.targetGain), v ? 0 : 1); }

  private apply(): void {
    let target: number, seconds: number; // time for the platter to cover most of the gap
    if (this._held) {
      target = this._handRate; seconds = 0.006;
    } else if (this._motorOn) {
      target = 1 + this._pitch + this._bend; seconds = 0.05;
    } else {
      target = 0; seconds = 0.12;
    }
    const s = this.shared, i = this.index;
    s.set(deckAt(i, D.targetRate), target);
    s.set(deckAt(i, D.glide), 1 - Math.exp(-1 / (seconds * this._outputRate)));
    s.set(deckAt(i, D.step), this.fileRate / this._outputRate);
  }

  /** Puts a decoded record on the platter, needle on the first beat, motor off. The browser
   * decodes at the output rate; its AAC decoder may trim the encoder's priming differently from
   * the iPhone's, so the grid starts where the first kick is found in the decoded audio. */
  loadDecoded(track: TrackInfo, audio: AudioBuffer): void {
    const frames = audio.length;
    if (frames <= 64) throw new Error(`${track.id}: empty file`);
    const left = new Float32Array(frames);
    audio.copyFromChannel(left, 0);
    const right = new Float32Array(frames);
    audio.copyFromChannel(right, audio.numberOfChannels > 1 ? 1 : 0);
    this.fileRate = audio.sampleRate;
    this.duration = frames / this.fileRate;
    const onset = firstOnset(left, Math.min(frames, Math.trunc(this.fileRate * 2)));
    this.grid = new BeatGrid(track.bpm, onset / this.fileRate);
    this.cuePoint = this.grid.firstBeat;
    this.overview = overview(left, frames, 240);
    this.info = track;
    this.frames = frames;
    this._motorOn = false;
    this._lifted = false;
    this._pitch = 0; this._bend = 0;
    this.shared.set(deckAt(this.index, D.targetGain), 1);
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
    this.info = track;
    if (!swapInPlace) {
      this._motorOn = false;
      this.fileRate = sampleRate;
      this.duration = frames / sampleRate;
      this.grid = new BeatGrid(track.bpm, 0);
      this.cuePoint = 0;
      this._lifted = false;
      this._pitch = 0; this._bend = 0;
      this.frames = frames;
      this.shared.set(deckAt(this.index, D.targetGain), 1);
      this.apply();
    }
    const l = left.slice(0, frames), r = right.slice(0, frames);
    this.shared.post({ type: "load", deck: this.index, left: l, right: r, position: 1, keepPlace: swapInPlace,
                       seekSeq: this.seekSeq }, [l.buffer, r.buffer]);
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
    this.shared.set(deckAt(this.index, D.seekTo), Math.max(1, Math.min(this.duration, seconds) * this.fileRate));
    this.shared.set(deckAt(this.index, D.seekSeq), ++this.seekSeq);
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

  constructor() {
    this.decks = [new Deck(this.shared, 0), new Deck(this.shared, 1)];
    this.shared.set(mixerAt(M.master), 1);
    this.shared.set(mixerAt(M.echoGain), 0.5);
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
        outputChannelCount: [2],
        processorOptions: { buffer: this.shared.isShared ? this.shared.values.buffer : null },
      });
      node.connect(context.destination);
      this.shared.attach(node.port);
      this.context = context;
      this.node = node;
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

  /** The far speakers of a festival stage: the room hears the music this late as well (0 = off). */
  get echoSeconds(): number { return this._echoSeconds; }
  set echoSeconds(v: number) {
    this._echoSeconds = v;
    const rate = this.context?.sampleRate ?? 48_000;
    this.shared.set(mixerAt(M.echoDelay), Math.trunc(Math.max(0, v) * rate));
  }

  /** Everything the mixer puts out, 0...1. Turned down a little while a coach talks over the music. */
  get masterVolume(): number { return this.shared.get(mixerAt(M.master)); }
  set masterVolume(v: number) { this.shared.set(mixerAt(M.master), Math.max(0, Math.min(1, v))); }

  /** How the headphones are fed. */
  get phones(): PhonesMode { return this._phones; }
  set phones(v: PhonesMode) { this._phones = v; this.shared.set(mixerAt(M.split), v === "split" ? 1 : 0); }

  /** What the headphones hear: 0 = only the cued decks, 1 = only the room. */
  get cueMix(): number { return this.shared.get(mixerAt(M.cueMix)); }
  set cueMix(v: number) { this.shared.set(mixerAt(M.cueMix), Math.max(0, Math.min(1, v))); }

  /** Seconds from a touch to the sound (what the browser reports), for the diagnostic line. */
  get latency(): number {
    const c = this.context;
    return c ? c.baseLatency + (c.outputLatency || 0) : 0;
  }
}
