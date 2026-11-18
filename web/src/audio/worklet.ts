// The audio thread: all of the sound is made here by `renderMix`, the same arithmetic the unit
// tests check and the iPhone plays (HeadlinerAudio/DeckEngine.swift's source node).
/// <reference path="./worklet-env.d.ts" />

import { renderMix, ChannelStrip, MixerShared, ECHO_CAPACITY } from "../core/mixer.ts";
import { newDeckShared } from "../core/vinyl.ts";
import type { DeckShared } from "../core/vinyl.ts";
import { AUDIO_FIELDS, D, DECKS, M, S, SIZE, deckAt, mixerAt, stripAt } from "./layout.ts";
import type { FromWorklet, ToWorklet } from "./layout.ts";

class HeadlinerProcessor extends AudioWorkletProcessor {
  private values: Float64Array;
  private readonly shared: boolean;
  private readonly decks: DeckShared[] = [];
  private readonly strips: ChannelStrip[] = [];
  private readonly mixer = new MixerShared();
  private readonly seekSeen: number[] = [];
  private readonly scratch = { left: new Float32Array(128), right: new Float32Array(128) };
  private spareR = new Float32Array(128);
  private quanta = 0;

  constructor(options: { processorOptions?: { buffer?: SharedArrayBuffer | null } }) {
    super();
    const buffer = options.processorOptions?.buffer ?? null;
    this.shared = buffer !== null;
    this.values = buffer ? new Float64Array(buffer) : new Float64Array(SIZE);
    for (let d = 0; d < DECKS; d++) {
      this.decks.push(newDeckShared());
      this.strips.push(new ChannelStrip());
      this.seekSeen.push(0);
    }
    this.mixer.sampleRate = sampleRate;
    this.mixer.echoL = new Float32Array(ECHO_CAPACITY);
    this.mixer.echoR = new Float32Array(ECHO_CAPACITY);
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.receive(e.data);
  }

  private receive(m: ToWorklet): void {
    switch (m.type) {
      case "load": {
        const s = this.decks[m.deck];
        const frames = Math.min(m.left.length, m.right.length);
        if (m.keepPlace && s.frames === frames) {
          // Same length (the studio's edited loop): read from the new copy from now on.
          s.left = m.left; s.right = m.right;
          return;
        }
        s.left = m.left; s.right = m.right; s.frames = frames;
        s.rate = 0; s.position = Math.max(1, m.position); s.seekTo = -1;
        // Drops asked for before the record was sent belonged to the old one; any later drop is
        // taken (again, if it already landed on the old record) at the next buffer.
        this.seekSeen[m.deck] = m.seekSeq;
        this.writeBack(m.deck);
        return;
      }
      case "unload": {
        const s = this.decks[m.deck];
        s.left = null; s.right = null; s.frames = 0; s.rate = 0;
        this.writeBack(m.deck);
        return;
      }
      case "sync": {
        // Fallback without shared memory: take the page's fields, keep our own.
        const own = new Set<number>();
        for (let d = 0; d < DECKS; d++) for (const f of AUDIO_FIELDS) own.add(deckAt(d, f));
        for (let i = 0; i < SIZE && i < m.values.length; i++) if (!own.has(i)) this.values[i] = m.values[i];
        return;
      }
    }
  }

  private writeBack(d: number): void {
    const s = this.decks[d], v = this.values;
    v[deckAt(d, D.position)] = s.position;
    v[deckAt(d, D.rate)] = s.rate;
    v[deckAt(d, D.gain)] = s.gain;
    v[deckAt(d, D.frames)] = s.frames;
    if (s.peak > v[deckAt(d, D.peak)]) v[deckAt(d, D.peak)] = s.peak;
    s.peak = 0;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0];
    const count = left.length;
    if (this.scratch.left.length < count) {
      this.scratch.left = new Float32Array(count);
      this.scratch.right = new Float32Array(count);
      this.spareR = new Float32Array(count);
    }
    const right = out.length > 1 ? out[1] : this.spareR;
    const v = this.values;

    // What the page wants.
    for (let d = 0; d < DECKS; d++) {
      const s = this.decks[d], strip = this.strips[d];
      s.targetRate = v[deckAt(d, D.targetRate)];
      s.glide = v[deckAt(d, D.glide)];
      s.step = v[deckAt(d, D.step)] || 1;
      s.targetGain = v[deckAt(d, D.targetGain)];
      const seq = v[deckAt(d, D.seekSeq)];
      if (seq !== this.seekSeen[d]) {
        this.seekSeen[d] = seq;
        s.seekTo = v[deckAt(d, D.seekTo)];
      }
      strip.lowDB = v[stripAt(d, S.lowDB)];
      strip.midDB = v[stripAt(d, S.midDB)];
      strip.highDB = v[stripAt(d, S.highDB)];
      strip.fader = v[stripAt(d, S.fader)];
      strip.cue = v[stripAt(d, S.cue)];
      strip.filter = v[stripAt(d, S.filter)];
    }
    const mixer = this.mixer;
    mixer.split = v[mixerAt(M.split)] !== 0;
    mixer.cueMix = v[mixerAt(M.cueMix)];
    mixer.master = v[mixerAt(M.master)];
    mixer.echoDelay = Math.trunc(v[mixerAt(M.echoDelay)]);
    mixer.echoGain = v[mixerAt(M.echoGain)];

    renderMix(this.decks, this.strips, mixer, this.scratch, left, right, null, null, count);
    if (out.length === 1) for (let i = 0; i < count; i++) left[i] = (left[i] + right[i]) * 0.5;

    // Where the needles are now.
    for (let d = 0; d < DECKS; d++) this.writeBack(d);
    if (!this.shared && (++this.quanta & 1) === 0) {
      const msg: FromWorklet = { type: "state", values: this.values.slice() };
      this.port.postMessage(msg);
      for (let d = 0; d < DECKS; d++) v[deckAt(d, D.peak)] = 0;
    }
    return true;
  }
}

registerProcessor("headliner", HeadlinerProcessor);
