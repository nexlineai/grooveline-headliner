// How long a file is, from its header alone, with a few small reads (the library shows the time of every record in its list without decoding
// anything): mp3 (the frame count of the Xing / Info / VBRI header, else the size at a constant bitrate), FLAC (STREAMINFO), WAV, AIFF / AIFC and
// MP4 / M4A (the movie header). Ogg is not read (undefined). Nothing throws: a file this cannot tell gives undefined.

import type { Source } from "./tags.ts";

const u32be = (b: Uint8Array, i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b: Uint8Array, i: number): number => ((b[i + 3] << 24) | (b[i + 2] << 16) | (b[i + 1] << 8) | b[i]) >>> 0;
const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const ascii = (b: Uint8Array, from: number, to: number): string => { let s = ""; for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

/** The length in seconds, or undefined when it cannot be told from the header. */
export async function readSeconds(src: Source): Promise<number | undefined> {
  try {
    const head = await src.read(0, 16);
    if (head.length < 12) return undefined;
    let s: number | undefined;
    if (ascii(head, 0, 4) === "fLaC") s = await flacSeconds(src);
    else if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") s = await wavSeconds(src);
    else if (ascii(head, 0, 4) === "FORM") s = await aiffSeconds(src);
    else if (ascii(head, 4, 8) === "ftyp") s = await mp4Seconds(src);
    else if (ascii(head, 0, 4) === "OggS") s = undefined;
    else s = await mp3Seconds(src, head);
    return s !== undefined && Number.isFinite(s) && s > 0 && s < 86_400 ? s : undefined;
  } catch { return undefined; }
}

// MARK: - FLAC

async function flacSeconds(src: Source): Promise<number | undefined> {
  const b = await src.read(0, 42); // "fLaC", the block header, then STREAMINFO
  if (b.length < 26 || (b[4] & 0x7f) !== 0) return undefined;
  const rate = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
  const total = (b[21] & 0x0f) * 4294967296 + b[22] * 16777216 + (b[23] << 16) + (b[24] << 8) + b[25];
  return rate > 0 && total > 0 ? total / rate : undefined;
}

// MARK: - WAV and AIFF

async function wavSeconds(src: Source): Promise<number | undefined> {
  let pos = 12, byteRate = 0, dataSize = -1;
  for (let n = 0; n < 40 && pos + 8 <= src.size; n++) {
    const h = await src.read(pos, 8);
    if (h.length < 8) break;
    const id = ascii(h, 0, 4);
    let size = u32le(h, 4);
    if (id === "fmt ") { const f = await src.read(pos + 8, 16); if (f.length >= 16) byteRate = u32le(f, 8); }
    else if (id === "data") { if (size === 0xffffffff || pos + 8 + size > src.size) size = src.size - pos - 8; dataSize = size; }
    if (byteRate > 0 && dataSize >= 0) return dataSize / byteRate;
    pos += 8 + size + (size & 1);
  }
  return undefined;
}

async function aiffSeconds(src: Source): Promise<number | undefined> {
  let pos = 12;
  for (let n = 0; n < 40 && pos + 8 <= src.size; n++) {
    const h = await src.read(pos, 8);
    if (h.length < 8) break;
    const size = u32be(h, 4);
    if (ascii(h, 0, 4) === "COMM") {
      const c = await src.read(pos + 8, 18);
      if (c.length < 18) return undefined;
      const frames = u32be(c, 2);
      // An 80-bit extended number: 15 bits of exponent, then a 64-bit mantissa.
      const exponent = ((c[8] & 0x7f) << 8) | c[9];
      const mantissa = u32be(c, 10) * 4294967296 + u32be(c, 14);
      const rate = mantissa * Math.pow(2, exponent - 16383 - 63);
      return rate > 0 && frames > 0 ? frames / rate : undefined;
    }
    pos += 8 + size + (size & 1);
  }
  return undefined;
}

// MARK: - MP4 / M4A

async function mp4Seconds(src: Source): Promise<number | undefined> {
  /** The boxes in [start, end): their type and where they begin and end (a few small reads, whatever the sizes). */
  const boxes = async (start: number, end: number): Promise<{ type: string; body: number; end: number }[]> => {
    const out: { type: string; body: number; end: number }[] = [];
    let pos = start;
    while (pos + 8 <= end) {
      const h = await src.read(pos, 16);
      if (h.length < 8) break;
      let size = u32be(h, 0), hdr = 8;
      if (size === 1 && h.length >= 16) { size = u32be(h, 8) * 4294967296 + u32be(h, 12); hdr = 16; }
      else if (size === 0) size = end - pos;
      if (size < hdr) break;
      out.push({ type: ascii(h, 4, 8), body: pos + hdr, end: Math.min(end, pos + size) });
      pos += size;
    }
    return out;
  };
  const moov = (await boxes(0, src.size)).find((b) => b.type === "moov");
  if (!moov) return undefined;
  const mvhd = (await boxes(moov.body, moov.end)).find((b) => b.type === "mvhd");
  if (!mvhd) return undefined;
  const d = await src.read(mvhd.body, 32);
  if (d.length < 20) return undefined;
  if (d[0] === 1) { // version 1: 64-bit times
    if (d.length < 32) return undefined;
    const scale = u32be(d, 20), dur = u32be(d, 24) * 4294967296 + u32be(d, 28);
    return scale > 0 ? dur / scale : undefined;
  }
  const scale = u32be(d, 12), dur = u32be(d, 16);
  return scale > 0 ? dur / scale : undefined;
}

// MARK: - MP3

const BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface Frame { at: number; bitrate: number; rate: number; samples: number; length: number; mpeg1: boolean; mono: boolean; protectedByCrc: boolean }

/** The MPEG frame header at `at` in `b`, or null when it is not one. */
function frameAt(b: Uint8Array, at: number): Frame | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3, layerBits = (b[at + 1] >> 1) & 3;
  if (version === 1 || layerBits === 0) return null;
  const layer = 4 - layerBits, mpeg1 = version === 3;
  const bitrate = BITRATES[`${mpeg1 ? 1 : 2}-${layer}`][b[at + 2] >> 4];
  const rate = RATES[version][(b[at + 2] >> 2) & 3];
  if (!bitrate || !rate) return null;
  const pad = (b[at + 2] >> 1) & 1;
  const samples = layer === 1 ? 384 : layer === 2 || mpeg1 ? 1152 : 576;
  const length = layer === 1 ? (Math.floor(12 * bitrate * 1000 / rate) + pad) * 4 : Math.floor((samples / 8) * bitrate * 1000 / rate) + pad;
  return { at, bitrate, rate, samples, length, mpeg1, mono: ((b[at + 3] >> 6) & 3) === 3, protectedByCrc: (b[at + 1] & 1) === 0 };
}

async function mp3Seconds(src: Source, head: Uint8Array): Promise<number | undefined> {
  let start = 0;
  if (ascii(head, 0, 3) === "ID3") start = 10 + (((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)) + ((head[5] & 0x10) ? 10 : 0);
  let end = src.size;
  if (src.size > 128 && ascii(await src.read(src.size - 128, 3), 0, 3) === "TAG") end -= 128;
  // The first frame: a header that is followed by another one where its length says, so padding and pictures are not taken for audio. Usually it
  // sits right at the start, so 8 KB is read first and the wider 70 KB only when no frame turns up there.
  let b: Uint8Array = new Uint8Array(0);
  let frame: Frame | null = null;
  for (const want of [8_192, 70_000]) {
    b = await src.read(start, want);
    for (let i = 0; i + 4 < b.length && i < 65_536; i++) {
      const f = frameAt(b, i);
      if (!f) continue;
      const next = frameAt(b, i + f.length);
      if (next || (i + f.length + 4 > b.length && b.length < want)) { frame = f; break; }
    }
    if (frame || b.length < want) break;
  }
  if (!frame) return undefined;
  // A VBR file says how many frames it has (Xing or Info; VBRI from Fraunhofer).
  const side = frame.mpeg1 ? (frame.mono ? 17 : 32) : (frame.mono ? 9 : 17);
  const xing = frame.at + 4 + (frame.protectedByCrc ? 2 : 0) + side;
  const tag = ascii(b, xing, xing + 4);
  if ((tag === "Xing" || tag === "Info") && xing + 12 <= b.length && (u32be(b, xing + 4) & 1)) {
    const frames = u32be(b, xing + 8);
    if (frames > 0) return frames * frame.samples / frame.rate;
  }
  const vbri = frame.at + 4 + 32;
  if (ascii(b, vbri, vbri + 4) === "VBRI" && vbri + 18 <= b.length) {
    const frames = u32be(b, vbri + 14);
    if (frames > 0) return frames * frame.samples / frame.rate;
  }
  // No frame count: the audio's size over its average bitrate. A constant-bitrate file says it in any frame; a variable one (with no Xing header)
  // does not, so the bitrate is measured on frames sampled all along the file (about 2 % of it is read).
  const audio = end - (start + frame.at);
  if (audio <= 0) return undefined;
  const avg = await averageBitrate(src, start + frame.at, end, frame);
  return audio * 8 / (avg * 1000);
}

/** The mean bitrate (kbit/s) of the frames at several places in [from, end): every frame lasts the same, so a plain mean over frames is the time-weighted one. */
async function averageBitrate(src: Source, from: number, end: number, first: Frame): Promise<number> {
  const PLACES = 8, CHUNK = 12_000;
  let sum = first.bitrate, count = 1, differs = false;
  if (end - from < PLACES * CHUNK * 2) return first.bitrate; // a short file: its first frame will do (a short file is rarely variable)
  // Three places first: if every frame there has the first one's bitrate the file is constant (no more reading); else the other five too.
  const order = [3, 5, 7, 1, 0, 2, 4, 6];
  for (let n = 0; n < PLACES; n++) {
    if (n === 3 && !differs) return first.bitrate;
    const k = order[n];
    const at = Math.floor(from + (end - from - CHUNK) * (k + 0.5) / PLACES);
    const b = await src.read(at, CHUNK + 4);
    let i = 0, f: Frame | null = null;
    for (; i + 4 < b.length && i < 4_000; i++) { f = frameAt(b, i); if (f && frameAt(b, i + f.length)) break; f = null; }
    while (f) { sum += f.bitrate; count++; if (f.bitrate !== first.bitrate) differs = true; const next = frameAt(b, f.at + f.length); f = next && next.at + next.length <= b.length ? next : null; if (count > 4000) break; }
  }
  return sum / count;
}
