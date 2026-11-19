// Reads the tags of an audio file without a library: ID3v2 (2.2, 2.3, 2.4) and ID3v1 for mp3, Vorbis
// comments and pictures for FLAC, iTunes atoms for MP4 / M4A. Random access (`Source.read`), so a file
// is never read whole: an mp4 whose moov atom sits at the end, or a cover of a megabyte, costs a few small
// reads. The cover is not read at all, only where it lies (`cover`), so the library can show sleeves later.

/** Where the bytes come from: a File in the browser, a file handle in node. */
export interface Source {
  size: number;
  /** `length` bytes from `start` (fewer at the end of the file). */
  read(start: number, length: number): Promise<Uint8Array>;
}

export interface Cover { mime: string; start: number; length: number; }

export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  /** From the file's tag; often rounded, sometimes wrong. */
  bpm?: number;
  /** As written ("12m", "Am", "8A"). */
  key?: string;
  /** The key on the Camelot wheel ("8A"), when `key` could be read. */
  camelot?: string;
  cover?: Cover;
}

// MARK: - Keys

const CAMELOT_MAJOR: Record<string, number> = { C: 8, G: 9, D: 10, A: 11, E: 12, B: 1, "F#": 2, "GB": 2, "DB": 3, "C#": 3, "AB": 4, "G#": 4, "EB": 5, "D#": 5, "BB": 6, "A#": 6, F: 7 };
const CAMELOT_MINOR: Record<string, number> = { A: 8, E: 9, B: 10, "F#": 11, "GB": 11, "C#": 12, "DB": 12, "G#": 1, "AB": 1, "D#": 2, "EB": 2, "A#": 3, "BB": 3, F: 4, C: 5, G: 6, D: 7 };

/** A key as the file writes it, on the Camelot wheel: "8A", Open Key ("12m", "7d"), or a note ("Am", "F# minor", "Bb"). Null when it is none of them. */
export function toCamelot(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{1,2})\s*([AB])$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${Number(m[1])}${m[2]}`;
  m = /^(\d{1,2})\s*([dm])$/.exec(s); // Open Key: 1d = C major = 8B, 1m = A minor = 8A
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${((Number(m[1]) + 6) % 12) + 1}${m[2] === "d" ? "B" : "A"}`;
  m = /^([A-Ga-g])([#♯b♭]?)\s*([A-Za-z]*)$/.exec(s);
  if (!m) return null;
  const suffix = m[3].toLowerCase();
  const minor = ["m", "min", "minor", "moll"].includes(suffix);
  if (!minor && !["", "maj", "major", "dur"].includes(suffix)) return null;
  const accidental = m[2] === "#" || m[2] === "♯" ? "#" : m[2] ? "B" : ""; // the tables write a flat as a capital B: "DB", "AB"
  const n = (minor ? CAMELOT_MINOR : CAMELOT_MAJOR)[m[1].toUpperCase() + accidental];
  return n ? `${n}${minor ? "A" : "B"}` : null;
}

// MARK: - A small buffered reader

class Reader {
  private buf: Uint8Array = new Uint8Array(0);
  private at = 0;
  readonly src: Source;
  constructor(src: Source) { this.src = src; }
  /** The bytes [start, start+length), from a window that is read once and kept. */
  async get(start: number, length: number): Promise<Uint8Array> {
    if (length <= 0 || start >= this.src.size) return new Uint8Array(0);
    const end = Math.min(this.src.size, start + length);
    if (start >= this.at && end <= this.at + this.buf.length) return this.buf.subarray(start - this.at, end - this.at);
    // A window of at least 64 KB, so the many small reads of a tag are one read.
    const want = Math.min(this.src.size - start, Math.max(length, 65536));
    this.buf = await this.src.read(start, want);
    this.at = start;
    return this.buf.subarray(0, Math.min(length, this.buf.length));
  }
}

const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;
const synchsafe = (b: Uint8Array, o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const ascii = (b: Uint8Array, from: number, to: number) => { let s = ""; for (let i = from; i < to; i++) s += String.fromCharCode(b[i]); return s; };

/** A text frame's string(s): `enc` 0 Latin-1, 1 UTF-16 with a byte order mark, 2 UTF-16 big-endian, 3 UTF-8. */
function decodeText(b: Uint8Array, enc: number): string[] {
  let text: string;
  if (enc === 0) text = ascii(b, 0, b.length);
  else if (enc === 3) text = new TextDecoder("utf-8").decode(b);
  else {
    let big = enc === 2, from = 0;
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) { big = false; from = 2; }
    else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { big = true; from = 2; }
    text = new TextDecoder(big ? "utf-16be" : "utf-16le").decode(b.subarray(from));
  }
  return text.split("\0").map((x) => x.trim()).filter(Boolean);
}

/** Undoes ID3's unsynchronisation (0xFF 0x00 stands for 0xFF). */
function unsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

/** BPM written as text: "128", "128.5", "128,5". */
function parseBpm(s: string): number | undefined {
  const v = Number(s.replace(",", ".").trim());
  return Number.isFinite(v) && v >= 30 && v <= 300 ? v : undefined;
}

function setKey(tags: Tags, raw: string): void {
  tags.key = raw;
  const c = toCamelot(raw);
  if (c) tags.camelot = c;
}

// MARK: - ID3

const ID3_NAMES: Record<string, keyof Tags | "pic"> = {
  TIT2: "title", TT2: "title", TPE1: "artist", TP1: "artist", TALB: "album", TAL: "album", TCON: "genre", TCO: "genre",
  TBPM: "bpm", TBP: "bpm", TKEY: "key", TKE: "key", APIC: "pic", PIC: "pic",
};

async function readId3v2(r: Reader, tags: Tags): Promise<boolean> {
  const head = await r.get(0, 10);
  if (head.length < 10 || ascii(head, 0, 3) !== "ID3") return false;
  const major = head[3], flags = head[5];
  if (major < 2 || major > 4) return false;
  const total = synchsafe(head, 6);
  const idLen = major === 2 ? 3 : 4, headLen = major === 2 ? 6 : 10;
  // A tag with whole-tag unsynchronisation (v2.2/2.3) is read whole and undone first.
  let tagUnsync = (flags & 0x80) !== 0 && major < 4;
  let whole: Uint8Array | null = null;
  if (tagUnsync) whole = unsync(await r.src.read(10, Math.min(total, 8 << 20)));
  const at = (pos: number, len: number) => whole ? Promise.resolve(whole.subarray(pos - 10, pos - 10 + len)) : r.get(pos, len);

  let pos = 10;
  if (flags & 0x40) { // an extended header: skip it
    const ext = await at(10, 6);
    pos += major === 4 ? synchsafe(ext, 0) : u32be(ext, 0) + 4;
  }
  const end = 10 + total;
  while (pos + headLen <= end) {
    const h = await at(pos, headLen);
    if (h.length < headLen || h[0] === 0) break; // padding
    const id = ascii(h, 0, idLen);
    let size: number, fflags = 0;
    if (major === 2) size = (h[3] << 16) | (h[4] << 8) | h[5];
    else { size = major === 4 ? synchsafe(h, 4) : u32be(h, 4); fflags = (h[8] << 8) | h[9]; }
    if (size <= 0 || pos + headLen + size > end + 1) break;
    const what = ID3_NAMES[id];
    if (what === "pic") {
      if (!tags.cover) {
        // encoding, mime (a 3-letter format in v2.2), picture type, description, then the picture itself
        const body = await at(pos + headLen, Math.min(size, 512));
        const enc = body[0];
        let i = 1, mime: string;
        if (major === 2) { mime = "image/" + ascii(body, 1, 4).toLowerCase().replace("jpg", "jpeg"); i = 4; }
        else { let j = i; while (j < body.length && body[j] !== 0) j++; mime = ascii(body, i, j); i = j + 1; }
        i += 1; // the picture type
        if (enc === 1 || enc === 2) { while (i + 1 < body.length && !(body[i] === 0 && body[i + 1] === 0)) i += 2; i += 2; }
        else { while (i < body.length && body[i] !== 0) i++; i += 1; }
        if (!mime.includes("/")) mime = "image/" + mime.toLowerCase();
        if (i < size && !whole) tags.cover = { mime: mime || "image/jpeg", start: pos + headLen + i, length: size - i };
      }
    } else if (what) {
      let body = await at(pos + headLen, size);
      if (major === 4) { // v2.4: per-frame flags: 0x0002 unsynchronised, 0x0001 a 4-byte data length first
        if (fflags & 0x0001) body = body.subarray(4);
        if (fflags & 0x0002) body = unsync(body);
      }
      const values = decodeText(body.subarray(1), body[0]);
      if (values.length) {
        if (what === "bpm") { const v = parseBpm(values[0]); if (v) tags.bpm = v; }
        else if (what === "key") setKey(tags, values[0]);
        else if (what === "genre") tags.genre = values[0].replace(/^\(\d+\)/, "").trim() || undefined;
        else if (what === "artist") tags.artist = values.join(", ");
        else if (what === "title" || what === "album") tags[what] = values[0];
      }
    }
    pos += headLen + size;
  }
  return true;
}

async function readId3v1(r: Reader, tags: Tags): Promise<void> {
  if (r.src.size < 128) return;
  const t = await r.src.read(r.src.size - 128, 128);
  if (ascii(t, 0, 3) !== "TAG") return;
  const field = (a: number, b: number) => ascii(t, a, b).replace(/\0.*$/s, "").trim();
  tags.title ??= field(3, 33) || undefined;
  tags.artist ??= field(33, 63) || undefined;
  tags.album ??= field(63, 93) || undefined;
}

// MARK: - FLAC

async function readFlac(r: Reader, tags: Tags): Promise<boolean> {
  const head = await r.get(0, 4);
  if (head.length < 4 || ascii(head, 0, 4) !== "fLaC") return false;
  let pos = 4;
  for (let n = 0; n < 64; n++) {
    const h = await r.get(pos, 4);
    if (h.length < 4) break;
    const last = (h[0] & 0x80) !== 0, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4 && len < (4 << 20)) { // VORBIS_COMMENT: little-endian lengths
      const b = await r.src.read(pos + 4, len);
      let i = 4 + u32le(b, 0); // the vendor string
      const count = u32le(b, i); i += 4;
      for (let c = 0; c < count && i + 4 <= b.length; c++) {
        const l = u32le(b, i); i += 4;
        const text = new TextDecoder("utf-8").decode(b.subarray(i, i + l)); i += l;
        const eq = text.indexOf("=");
        if (eq < 0) continue;
        applyVorbis(tags, text.slice(0, eq).toUpperCase(), text.slice(eq + 1));
      }
    } else if (type === 6 && !tags.cover) { // PICTURE: big-endian
      const b = await r.src.read(pos + 4, Math.min(len, 1024));
      let i = 4;
      const ml = u32be(b, i); i += 4;
      const mime = ascii(b, i, i + ml); i += ml;
      const dl = u32be(b, i); i += 4 + dl + 16; // description, width, height, depth, colours
      const dataLen = u32be(b, i); i += 4;
      tags.cover = { mime: mime || "image/jpeg", start: pos + 4 + i, length: dataLen };
    }
    pos += 4 + len;
    if (last) break;
  }
  return true;
}

function applyVorbis(tags: Tags, key: string, value: string): void {
  const v = value.trim();
  if (!v) return;
  if (key === "TITLE") tags.title ??= v;
  else if (key === "ARTIST") tags.artist = tags.artist ? `${tags.artist}, ${v}` : v;
  else if (key === "ALBUM") tags.album ??= v;
  else if (key === "GENRE") tags.genre ??= v;
  else if (key === "BPM" || key === "TEMPO") { const b = parseBpm(v); if (b) tags.bpm ??= b; }
  else if (key === "INITIALKEY" || key === "KEY") setKey(tags, v);
}

// MARK: - MP4 / M4A

const IMAGE_TYPES: Record<number, string> = { 13: "image/jpeg", 14: "image/png", 27: "image/bmp" };

async function readMp4(r: Reader, tags: Tags): Promise<boolean> {
  const head = await r.get(0, 12);
  if (head.length < 12 || ascii(head, 4, 8) !== "ftyp") return false;
  /** The children of the box at [start, end): a few small reads each. */
  const children = async (start: number, end: number): Promise<{ type: string; body: number; end: number }[]> => {
    const out: { type: string; body: number; end: number }[] = [];
    let pos = start;
    while (pos + 8 <= end) {
      const h = await r.get(pos, 16);
      if (h.length < 8) break;
      let size = u32be(h, 0), hdr = 8;
      const type = ascii(h, 4, 8).replace(/©/g, "©");
      if (size === 1 && h.length >= 16) { size = u32be(h, 8) * 4294967296 + u32be(h, 12); hdr = 16; }
      else if (size === 0) size = end - pos;
      if (size < hdr) break;
      out.push({ type, body: pos + hdr, end: Math.min(end, pos + size) });
      pos += size;
    }
    return out;
  };
  const top = await children(0, r.src.size);
  const moov = top.find((b) => b.type === "moov");
  if (!moov) return true;
  const udta = (await children(moov.body, moov.end)).find((b) => b.type === "udta");
  if (!udta) return true;
  const meta = (await children(udta.body, udta.end)).find((b) => b.type === "meta");
  if (!meta) return true;
  const metaKids = await children(meta.body + 4, meta.end); // meta is a full box: 4 bytes first
  const ilst = metaKids.find((b) => b.type === "ilst");
  if (!ilst) return true;
  // QuickTime-style metadata (what ffmpeg writes with use_metadata_tags): a `keys` box names the items,
  // and each ilst item is a number into it instead of an iTunes atom name.
  const names: string[] = [];
  const keys = metaKids.find((b) => b.type === "keys");
  if (keys) {
    const kb = await r.get(keys.body, keys.end - keys.body);
    const count = u32be(kb, 4);
    let i = 8;
    for (let n = 0; n < count && i + 8 <= kb.length; n++) {
      const size = u32be(kb, i);
      names.push(new TextDecoder("utf-8").decode(kb.subarray(i + 8, i + size)).replace(/^com\.apple\.quicktime\./, "").toUpperCase());
      i += size;
    }
  }
  for (const item of await children(ilst.body, ilst.end)) {
    const kids = await children(item.body, item.end);
    const data = kids.find((k) => k.type === "data");
    if (!data) continue;
    const d = await r.get(data.body, Math.min(data.end - data.body, 1 << 16));
    const kind = (d[1] << 16) | (d[2] << 8) | d[3]; // the type indicator
    const payloadAt = data.body + 8, payloadLen = data.end - payloadAt;
    const payload = d.subarray(8);
    const text = () => new TextDecoder("utf-8").decode(payload).trim();
    const type = item.type;
    if (type.charCodeAt(0) === 0 && type.charCodeAt(1) === 0 && keys) {
      const name = names[((type.charCodeAt(2) << 8) | type.charCodeAt(3)) - 1];
      if (name === "TITLE") tags.title = text();
      else if (name === "ARTIST") tags.artist ??= text();
      else if (name === "ALBUM") tags.album = text();
      else if (name === "GENRE") tags.genre = text();
      else if (name === "INITIALKEY" || name === "KEY") setKey(tags, text());
      else if (name === "BPM" || name === "TEMPO") { const b = parseBpm(text()); if (b) tags.bpm ??= b; }
      continue;
    }
    if (type === "©nam") tags.title = text();
    else if (type === "©ART" || type === "aART") tags.artist ??= text();
    else if (type === "©alb") tags.album = text();
    else if (type === "©gen") tags.genre = text();
    else if (type === "tmpo" && payload.length >= 2) { const v = (payload[0] << 8) | payload[1]; if (v >= 30 && v <= 300) tags.bpm ??= v; }
    else if (type === "covr" && !tags.cover) tags.cover = { mime: IMAGE_TYPES[kind] ?? "image/jpeg", start: payloadAt, length: payloadLen };
    else if (type === "----") {
      // A free-form item: "mean" (the namespace), "name" (the field), "data".
      const nameBox = kids.find((k) => k.type === "name");
      if (!nameBox) continue;
      const nb = await r.get(nameBox.body + 4, nameBox.end - nameBox.body - 4);
      const name = new TextDecoder("utf-8").decode(nb).toUpperCase();
      if (name === "INITIALKEY" || name === "KEY") setKey(tags, text());
      else if (name === "BPM" || name === "TEMPO") { const b = parseBpm(text()); if (b) tags.bpm ??= b; }
    }
  }
  return true;
}

// MARK: - Everything

/** The tags of a file, whatever its format (told by its first bytes, not its name). Nothing throws: a broken file gives fewer tags. */
export async function readTags(src: Source): Promise<Tags> {
  const tags: Tags = {};
  const r = new Reader(src);
  try {
    const head = await r.get(0, 12);
    if (ascii(head, 0, 3) === "ID3") { await readId3v2(r, tags); await readId3v1(r, tags); }
    else if (ascii(head, 0, 4) === "fLaC") await readFlac(r, tags);
    else if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") await readMp4(r, tags);
    else await readId3v1(r, tags); // an mp3 with no ID3v2, or something else: the old tag at the end, if any
  } catch { /* a damaged tag: what was read so far stays */ }
  return tags;
}

/** What a filename says when the tags do not: "Artist - Title", with a leading track number dropped. */
export function fromFilename(name: string): { artist?: string; title: string } {
  const base = name.replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/_/g, " ").trim();
  const clean = base.replace(/^\d{1,3}[\s.\-_)]+\s*/, "");
  const dash = clean.indexOf(" - ");
  if (dash > 0) return { artist: clean.slice(0, dash).trim(), title: clean.slice(dash + 3).trim() || clean };
  return { title: clean || base };
}

/** The cover's bytes (when `cover` was found), read only now. */
export async function readCover(src: Source, cover: Cover): Promise<Uint8Array> {
  return src.read(cover.start, cover.length);
}
