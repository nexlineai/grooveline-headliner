// Sleeves: the cover picture of a track, small, for the crate and for the record's label. It comes from the
// picture inside the file (its tag) or else from the cover picture lying in the same folder; a track with
// neither gets a sleeve made from its name, so the same track always looks the same. Pictures are read when
// a sleeve comes into view (a few at a time), cut to a square of SLEEVE_PX and kept in a small cache.
// The pictures are drawn into canvases: no blob URLs, so the page's CSP needs nothing new.

import type { Library } from "./library.ts";
import { fileSource } from "./scan.ts";
import type { LibraryTrack } from "./store.ts";
import { readCover } from "./tags.ts";

export const SLEEVE_PX = 160;
/** A picture larger than this is not read (a damaged tag can claim anything). */
const MAX_PICTURE_BYTES = 24 * 1024 * 1024;

/** Width and height of a JPEG or PNG, read from its first bytes (null: neither, or damaged). */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { // PNG: IHDR holds the size
    const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
    return w > 0 && h > 0 ? { w, h } : null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) { // JPEG: the first "start of frame" segment holds it
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; } // padding
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
      const length = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 9 > b.length) return null;
        const h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8];
        return w > 0 && h > 0 ? { w, h } : null;
      }
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

/** A picture cut square from the middle and scaled to `size`, or null when it cannot be decoded. The decode itself
 * scales (a 3000 px cover is never held whole): the short side is asked for at `size`. */
export async function makeThumbnail(bytes: Uint8Array, mime: string, size = SLEEVE_PX): Promise<HTMLCanvasElement | null> {
  if (bytes.length === 0 || bytes.length > MAX_PICTURE_BYTES) return null;
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const dim = imageSize(bytes);
  let bmp: ImageBitmap;
  try {
    const big = dim && Math.min(dim.w, dim.h) > size;
    bmp = big
      ? await createImageBitmap(blob, dim.w <= dim.h ? { resizeWidth: size, resizeQuality: "medium" } : { resizeHeight: size, resizeQuality: "medium" })
      : await createImageBitmap(blob);
  } catch { return null; }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const side = Math.min(bmp.width, bmp.height);
    if (side < 8) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    return canvas;
  } finally { bmp.close(); }
}

// MARK: - A sleeve made from the name

export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** What the generated sleeve is made from: the same track always gets the same colours and letters. */
export function sleeveLook(t: { artist: string; title: string }): { hue: number; hue2: number; letters: string } {
  const h = hash32(`${t.artist.toLowerCase()}|${t.title.toLowerCase()}`);
  const hue = h % 360;
  const words = `${t.artist} ${t.title}`.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  return { hue, hue2: (hue + 35 + ((h >>> 9) % 70)) % 360, letters };
}

export function paintGenerated(c: HTMLCanvasElement, t: { artist: string; title: string }): void {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const w = c.width, { hue, hue2, letters } = sleeveLook(t);
  const g = ctx.createLinearGradient(0, 0, w, w);
  g.addColorStop(0, `hsl(${hue} 50% 30%)`);
  g.addColorStop(1, `hsl(${hue2} 55% 13%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  // A record half in the sleeve, and the letters over it.
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = Math.max(1, w / 80);
  for (let r = 0.2; r < 0.9; r += 0.12) { ctx.beginPath(); ctx.arc(w * 0.72, w * 0.7, w * r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `800 ${Math.round(w * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(letters, w * 0.08, w * 0.9);
}

// MARK: - The sleeves of the library

/** A picture (the master canvas), "none" (no picture, or one that cannot be decoded: final), or "later" (not now: the folder waits for RECONNECT, or the read failed). */
export type Sleeve = HTMLCanvasElement | "none" | "later";

interface Job { cacheKey: string; track: LibraryTrack; done: (s: Sleeve) => void; cancelled: boolean; }

export class Sleeves {
  private readonly lib: Pick<Library, "fileQuiet">;
  private readonly limit: number;
  private readonly parallel: number;
  /** The side of the master canvases, in pixels. */
  private readonly size: number;
  /** Master canvases, least recently used first. A track without a usable picture is kept as "none". */
  private readonly cache = new Map<string, HTMLCanvasElement | "none">();
  private readonly queue: Job[] = [];
  private active = 0;

  constructor(lib: Pick<Library, "fileQuiet">, limit = 400, parallel = 4, size = SLEEVE_PX) { this.lib = lib; this.limit = limit; this.parallel = parallel; this.size = size; }

  /** Can this track have a picture at all (its file has one, or its folder does)? */
  static hasPicture(t: LibraryTrack): boolean { return !!t.cover || !!t.art; }

  private keyOf(t: LibraryTrack): string {
    // The folder's picture is shared by the folder's tracks: one read and one decode for the album.
    return t.cover ? `${t.key}|${t.mtime}|${t.cover.start}` : `art:${t.folder}:${(t.art ?? []).join("/")}`;
  }

  /** What is known now, without reading anything (undefined: not loaded yet). */
  peek(t: LibraryTrack): Sleeve | undefined {
    if (!Sleeves.hasPicture(t)) return "none";
    return this.cache.get(this.keyOf(t));
  }

  /** Asks for the sleeve of a track; `done` hears it once (at once if it is known). Returns a way to cancel while it waits. */
  request(t: LibraryTrack, done: (s: Sleeve) => void): () => void {
    const known = this.peek(t);
    if (known !== undefined) {
      const k = this.keyOf(t);
      const v = this.cache.get(k);
      if (v !== undefined) { this.cache.delete(k); this.cache.set(k, v); } // used just now
      done(known);
      return () => {};
    }
    const job: Job = { cacheKey: this.keyOf(t), track: t, done, cancelled: false };
    this.queue.push(job);
    this.pump();
    return () => { job.cancelled = true; const i = this.queue.indexOf(job); if (i >= 0) this.queue.splice(i, 1); };
  }

  private pump(): void {
    // The newest request first: it is the one on screen now.
    while (this.active < this.parallel && this.queue.length) {
      const job = this.queue.pop()!;
      this.active++;
      this.run(job).finally(() => { this.active--; this.pump(); });
    }
  }

  private async run(job: Job): Promise<void> {
    let result: Sleeve;
    try {
      // Another job for the same album may have finished while this one waited.
      const known = this.cache.get(job.cacheKey);
      result = known !== undefined ? known : await this.read(job.track);
    } catch { result = "later"; }
    if (result !== "later") this.remember(job.cacheKey, result);
    if (!job.cancelled) job.done(result);
  }

  private remember(key: string, value: HTMLCanvasElement | "none"): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    while (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value as string);
  }

  private async read(t: LibraryTrack): Promise<Sleeve> {
    if (t.cover) {
      const f = await this.lib.fileQuiet(t);
      if (f === "locked") return "later";
      if (f && t.cover.length <= MAX_PICTURE_BYTES) {
        const made = await makeThumbnail(await readCover(fileSource(f), t.cover), t.cover.mime, this.size);
        if (made) return made;
      } else if (!f && !t.art) return "later"; // the file is not there now (a drive unplugged?): try again later
    }
    if (t.art) {
      const f = await this.lib.fileQuiet(t, t.art);
      if (f === "locked") return "later";
      if (!f) return "later";
      if (f.size > MAX_PICTURE_BYTES) return "none";
      const made = await makeThumbnail(new Uint8Array(await f.arrayBuffer()), /\.png$/i.test(f.name) ? "image/png" : "image/jpeg", this.size);
      if (made) return made;
    }
    return "none";
  }
}

/** Draws a master sleeve into a tile canvas (any size). */
export function paintSleeve(tile: HTMLCanvasElement, master: HTMLCanvasElement): void {
  const ctx = tile.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(master, 0, 0, master.width, master.height, 0, 0, tile.width, tile.height);
}
