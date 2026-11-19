// AIFF is not something browsers decode (Chromium says "Unable to decode audio data"), and DJs use it:
// this reads the PCM kinds (8, 16, 24, 32 bit, big-endian; "sowt" is the little-endian AIFF-C) into
// plain channels, which the page puts in an AudioBuffer.

export interface Pcm { rate: number; channels: Float32Array[]; }

/** The 80-bit extended float of AIFF's COMM chunk, as a number (sample rates only: positive, whole). */
function extended80(b: Uint8Array, o: number): number {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  const hi = ((b[o + 2] << 24) | (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5]) >>> 0;
  const lo = ((b[o + 6] << 24) | (b[o + 7] << 16) | (b[o + 8] << 8) | b[o + 9]) >>> 0;
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}

export function isAiff(b: Uint8Array): boolean {
  return b.length >= 12 && b[0] === 0x46 && b[1] === 0x4f && b[2] === 0x52 && b[3] === 0x4d // FORM
    && b[8] === 0x41 && b[9] === 0x49 && b[10] === 0x46 && (b[11] === 0x46 || b[11] === 0x43); // AIFF or AIFC
}

/** Decodes an AIFF / AIFF-C file with PCM samples. Throws on anything else (floating point, compressed). */
export function parseAiff(b: Uint8Array): Pcm {
  if (!isAiff(b)) throw new Error("not an AIFF file");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  let channels = 0, frames = 0, bits = 0, rate = 0, little = false, dataAt = -1, dataLen = 0;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = tag(pos), len = dv.getUint32(pos + 4, false);
    const body = pos + 8;
    if (id === "COMM") {
      channels = dv.getUint16(body, false);
      frames = dv.getUint32(body + 2, false);
      bits = dv.getUint16(body + 6, false);
      rate = extended80(b, body + 8);
      if (len >= 22) { // AIFF-C: the compression type follows
        const type = tag(body + 18);
        if (type === "sowt") little = true;
        else if (type !== "NONE" && type !== "twos") throw new Error(`AIFF-C compression "${type}" is not supported`);
      }
    } else if (id === "SSND") {
      const offset = dv.getUint32(body, false);
      dataAt = body + 8 + offset;
      dataLen = Math.min(len - 8 - offset, b.length - dataAt);
    }
    pos = body + len + (len & 1); // chunks are padded to an even length
  }
  if (channels < 1 || channels > 8 || bits === 0 || dataAt < 0 || rate < 1000) throw new Error("AIFF: no sound data");
  const bytes = Math.ceil(bits / 8);
  if (bytes < 1 || bytes > 4) throw new Error(`AIFF: ${bits}-bit samples are not supported`);
  const n = Math.min(frames, Math.floor(dataLen / (bytes * channels)));
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  const scale = 1 / 2 ** (bytes * 8 - 1);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const o = dataAt + (i * channels + c) * bytes;
      let v: number;
      if (bytes === 1) v = (dv.getInt8(o)) / 128;
      else if (bytes === 2) v = dv.getInt16(o, little) * scale;
      else if (bytes === 3) {
        const x = little ? (b[o + 2] << 16) | (b[o + 1] << 8) | b[o] : (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
        v = (x & 0x800000 ? x - 0x1000000 : x) * scale;
      } else v = dv.getInt32(o, little) * scale;
      out[c][i] = v;
    }
  }
  return { rate, channels: out };
}
