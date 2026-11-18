// The headphones on a second sound device (PHONES: TWO DEVICES). The mixer's worklet writes the
// headphones' channels into a ring of shared memory; this worklet, in an AudioContext of its own
// on the other device, plays them. The two devices' clocks drift apart a little: the ring is kept
// about `target` frames full by playing one frame more or less now and then (inaudible). Far
// less delay than a media stream, which is what Zé heard with a USB-C adapter (19 Nov 2026).
/// <reference path="./worklet-env.d.ts" />

/** The ring: two Int32 counters (frames written, frames read), then `cap` stereo frames. */
export const RING_HEADER = 8;

class PhonesProcessor extends AudioWorkletProcessor {
  private readonly idx: Int32Array;
  private readonly data: Float32Array;
  private readonly mask: number;
  private target: number;
  private starved = true;
  private quanta = 0;

  constructor(options: { processorOptions?: { buffer?: SharedArrayBuffer | null; cap?: number; target?: number } }) {
    super();
    const o = options.processorOptions ?? {};
    const cap = o.cap ?? 8192; // a power of two
    this.idx = new Int32Array(o.buffer!, 0, 2);
    this.data = new Float32Array(o.buffer!, RING_HEADER, cap * 2);
    this.mask = cap - 1;
    this.target = o.target ?? 1024;
    this.port.onmessage = (e: MessageEvent<{ target?: number }>) => { if (e.data.target) this.target = e.data.target; };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const n = L.length;
    const w = Atomics.load(this.idx, 0);
    let r = Atomics.load(this.idx, 1);
    let avail = (w - r) | 0;
    // Far off (the mixer just started writing, or stopped): start again a target behind the writer.
    if (avail < 0 || avail > this.mask - n) { r = (w - this.target) | 0; avail = this.target; this.starved = true; }
    if (this.starved) {
      // Wait until the ring holds its target, then play.
      if (avail < this.target) { L.fill(0); R.fill(0); Atomics.store(this.idx, 1, r); return true; }
      this.starved = false;
    }
    if (avail < n) {
      // Ran dry: silence, and a little more room from now on (reported, so the room waits too).
      L.fill(0); R.fill(0);
      this.starved = true;
      this.target = Math.min(this.target + 256, (this.mask + 1) >> 1);
      this.port.postMessage({ target: this.target });
      return true;
    }
    // Steer the fill towards the target: one frame more or less in this buffer.
    const consume = avail > this.target + 192 ? n + 1 : avail < this.target - 192 ? n - 1 : n;
    for (let i = 0; i < n; i++) {
      const j = ((r + Math.floor(i * consume / n)) & this.mask) * 2;
      L[i] = this.data[j];
      if (R !== L) R[i] = this.data[j + 1];
    }
    Atomics.store(this.idx, 1, (r + consume) | 0);
    if ((++this.quanta & 255) === 0) this.port.postMessage({ fill: avail });
    return true;
  }
}

registerProcessor("headliner-phones", PhonesProcessor as unknown as new (options: { processorOptions?: { buffer?: SharedArrayBuffer | null } }) => AudioWorkletProcessor);
