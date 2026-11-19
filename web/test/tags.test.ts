// Tag reading (library/tags.ts): real ffmpeg output in test/fixtures, and hand-built ID3 for the corners.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fromFilename, readCover, readTags, toCamelot } from "../src/library/tags.ts";
import type { Source } from "../src/library/tags.ts";

const dir = new URL("./fixtures/", import.meta.url);
async function fixture(name: string): Promise<Source> {
  const bytes = new Uint8Array(await readFile(new URL(name, dir))); // tiny files: no handle to leak
  return { size: bytes.length, read: async (start, length) => bytes.slice(start, start + length) };
}
const fromBytes = (b: Uint8Array): Source => ({ size: b.length, read: async (s, l) => b.slice(s, s + l) });
const PNG = [0x89, 0x50, 0x4e, 0x47];

describe("tags of real files", () => {
  test("mp3, ID3v2.3: text, BPM, key, and where the cover lies", async () => {
    const src = await fixture("v23.mp3");
    const t = await readTags(src);
    assert.equal(t.title, "Tëst Tîtle");
    assert.equal(t.artist, "Artist One");
    assert.equal(t.album, "Album ✓");
    assert.equal(t.genre, "Deep House");
    assert.equal(t.bpm, 128);
    assert.equal(t.key, "12m");
    assert.equal(t.camelot, "7A"); // Open Key 12m is D minor
    assert.ok(t.cover && t.cover.mime === "image/png" && t.cover.length === 101);
    const cover = await readCover(src, t.cover!);
    assert.deepEqual([...cover.subarray(0, 4)], PNG);
  });

  test("mp3, ID3v2.4: a fractional BPM and a key written as a note", async () => {
    const t = await readTags(await fixture("v24.mp3"));
    assert.equal(t.title, "Tëst Tîtle");
    assert.equal(t.bpm, 127.5);
    assert.equal(t.key, "Am");
    assert.equal(t.camelot, "8A");
    assert.ok(t.cover);
  });

  test("mp3 with only the old ID3v1 tag at the end, and mp3 with no tag at all", async () => {
    const old = await readTags(await fixture("v1.mp3"));
    assert.equal(old.title, "Old Tag");
    assert.equal(old.artist, "Old Artist");
    assert.deepEqual(await readTags(await fixture("none.mp3")), {});
  });

  test("m4a, moov at the end, QuickTime-style items", async () => {
    const t = await readTags(await fixture("end.m4a"));
    assert.equal(t.title, "Tëst Tîtle");
    assert.equal(t.artist, "Artist One");
    assert.equal(t.bpm, 124);
    assert.equal(t.camelot, "8A");
  });

  test("m4a with iTunes atoms: tempo and a cover", async () => {
    const src = await fixture("itunes.m4a");
    const t = await readTags(src);
    assert.equal(t.title, "Tëst Tîtle");
    assert.equal(t.genre, "Deep House");
    assert.equal(t.bpm, 124);
    assert.ok(t.cover && t.cover.mime === "image/png");
    assert.deepEqual([...(await readCover(src, t.cover!)).subarray(0, 4)], PNG);
  });

  test("m4a, faststart (moov first), and ALAC", async () => {
    const fast = await readTags(await fixture("fast.m4a"));
    assert.equal(fast.title, "Fast Start");
    assert.equal(fast.camelot, "3A"); // Bb minor
    assert.equal((await readTags(await fixture("alac.m4a"))).title, "Lossless");
  });

  test("flac: Vorbis comments and the picture block", async () => {
    const src = await fixture("tagged.flac");
    const t = await readTags(src);
    assert.equal(t.title, "Tëst Tîtle");
    assert.equal(t.album, "Album ✓");
    assert.equal(t.bpm, 126);
    assert.equal(t.camelot, "8A");
    assert.ok(t.cover && t.cover.length === 101);
    assert.deepEqual([...(await readCover(src, t.cover!)).subarray(0, 4)], PNG);
  });

  test("files with no tag reader (wav, aiff, ogg, opus) give nothing, and never throw", async () => {
    for (const f of ["plain.wav", "plain.aiff", "tagged.ogg", "tagged.opus"]) assert.deepEqual(await readTags(await fixture(f)), {}, f);
  });

  test("a truncated or damaged file gives what could be read, and no error", async () => {
    const whole = new Uint8Array(await readFile(new URL("v23.mp3", dir)));
    const cut = await readTags(fromBytes(whole.slice(0, 60)));
    assert.ok(typeof cut === "object");
    const damaged = whole.slice();
    for (let i = 10; i < 40; i++) damaged[i] = 0xff;
    assert.ok(typeof (await readTags(fromBytes(damaged))) === "object");
    assert.deepEqual(await readTags(fromBytes(new Uint8Array(0))), {});
  });
});

// MARK: - Hand-built ID3 corners

const enc = (s: string) => new TextEncoder().encode(s);
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const utf16 = (s: string, bom: boolean) => { const out: number[] = bom ? [0xff, 0xfe] : []; for (const ch of s) { const c = ch.charCodeAt(0); out.push(c & 255, c >> 8); } return out; };

function tag(major: 2 | 3 | 4, frames: number[][], opts: { flags?: number; ext?: number[] } = {}): Uint8Array {
  const body = [...(opts.ext ?? []), ...frames.flat(), 0, 0, 0, 0, 0, 0];
  return new Uint8Array([0x49, 0x44, 0x33, major, 0, opts.flags ?? 0, ...syncsafe(body.length), ...body, ...new Array(64).fill(0x55)]);
}
function frame(major: 2 | 3 | 4, id: string, payload: number[], fflags = 0): number[] {
  if (major === 2) return [...enc(id), (payload.length >> 16) & 255, (payload.length >> 8) & 255, payload.length & 255, ...payload];
  const size = major === 4 ? syncsafe(payload.length) : be32(payload.length);
  return [...enc(id), ...size, fflags >> 8, fflags & 255, ...payload];
}
const text = (enc0: number, bytes: number[]) => [enc0, ...bytes];

describe("ID3 corners", () => {
  test("v2.2: three-letter frames and a three-letter picture format", async () => {
    const t = await readTags(fromBytes(tag(2, [
      frame(2, "TT2", text(0, [...enc("Old Title")])), frame(2, "TP1", text(0, [...enc("Old Artist")])),
      frame(2, "TBP", text(0, [...enc("120")])), frame(2, "TKE", text(0, [...enc("5A")])),
      frame(2, "PIC", [0, ...enc("PNG"), 3, 0, 0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    ])));
    assert.equal(t.title, "Old Title");
    assert.equal(t.bpm, 120);
    assert.equal(t.camelot, "5A");
    assert.ok(t.cover && t.cover.mime === "image/png" && t.cover.length === 7);
  });

  test("v2.3: UTF-16 with a byte order mark, and an extended header to skip", async () => {
    const t = await readTags(fromBytes(tag(3, [
      frame(3, "TIT2", text(1, [...utf16("Ünïcode Títle", true), 0, 0])),
      frame(3, "TPE1", text(2, [...utf16("Bé", false).reverse().length ? [0, 0x42, 0, 0xe9] : []])),
    ], { flags: 0x40, ext: [...be32(6), 0, 0, 0, 0, 0, 0] })));
    assert.equal(t.title, "Ünïcode Títle");
    assert.equal(t.artist, "Bé");
  });

  test("v2.3 with whole-tag unsynchronisation: 0xFF 0x00 stands for 0xFF", async () => {
    // "ÿ" (0xFF in Latin-1) in the title: written unsynchronised as FF 00.
    const title = [0x41, 0xff, 0x00, 0x42]; // A, 0xFF (+ the inserted 0x00), B: the frame's size counts the unsynchronised bytes
    const t = await readTags(fromBytes(tag(3, [frame(3, "TIT2", text(0, title))], { flags: 0x80 })));
    assert.equal(t.title, "AÿB");
  });

  test("v2.4: syncsafe sizes, several artists (null-separated), a per-frame unsynchronisation flag", async () => {
    const artists = [...enc("One"), 0, ...enc("Two")];
    const t = await readTags(fromBytes(tag(4, [
      frame(4, "TPE1", text(3, artists)),
      frame(4, "TIT2", text(0, [0x41, 0xff, 0x00, 0x42]), 0x0002),
      frame(4, "TBPM", text(3, [...enc("128")])),
    ])));
    assert.equal(t.artist, "One, Two");
    assert.equal(t.title, "AÿB");
    assert.equal(t.bpm, 128);
  });

  test("BPM that is not a tempo is ignored, a genre like (17) is dropped, a long size cannot run past the tag", async () => {
    const t = await readTags(fromBytes(tag(3, [
      frame(3, "TBPM", text(0, [...enc("0")])), frame(3, "TCON", text(0, [...enc("(17)")])),
      [...enc("TIT2"), ...be32(0x7fffffff), 0, 0, 0, ...enc("x")],
    ])));
    assert.equal(t.bpm, undefined);
    assert.equal(t.genre, undefined);
    assert.equal(t.title, undefined);
  });
});

describe("keys on the Camelot wheel", () => {
  test("Camelot, Open Key and note names all land on the same wheel", () => {
    const cases: [string, string | null][] = [
      ["8A", "8A"], ["12B", "12B"], ["8a", null], ["13A", null], ["0A", null],
      ["1d", "8B"], ["1m", "8A"], ["7m", "2A"], ["12m", "7A"], ["12d", "7B"], ["6d", "1B"],
      ["Am", "8A"], ["C", "8B"], ["G", "9B"], ["Em", "9A"], ["Bm", "10A"], ["F#m", "11A"], ["Dbm", "12A"], ["C#m", "12A"],
      ["Abm", "1A"], ["G#m", "1A"], ["Ebm", "2A"], ["Bbm", "3A"], ["Fm", "4A"], ["Cm", "5A"], ["Gm", "6A"], ["Dm", "7A"],
      ["Ab", "4B"], ["Bb", "6B"], ["F#", "2B"], ["Db", "3B"], ["Eb", "5B"], ["F", "7B"], ["B", "1B"], ["D", "10B"], ["A", "11B"], ["E", "12B"],
      ["A minor", "8A"], ["C# minor", "12A"], ["Bb major", "6B"], ["C♯m", "12A"], ["B♭", "6B"],
      ["", null], ["H", null], ["Am7", null], ["X", null],
    ];
    for (const [raw, want] of cases) assert.equal(toCamelot(raw), want, raw);
  });
});

describe("names", () => {
  test("artist and title from a file name, with the track number and underscores dealt with", () => {
    assert.deepEqual(fromFilename("01 - Artist - Title.mp3"), { artist: "Artist", title: "Title" });
    assert.deepEqual(fromFilename("3-Rayko_-_Spaceship_Crash-320kb_s_MP3.mp3"), { artist: "Rayko", title: "Spaceship Crash-320kb s MP3" });
    assert.deepEqual(fromFilename("Just A Title.flac"), { title: "Just A Title" });
    assert.deepEqual(fromFilename("07. Name.wav"), { title: "Name" });
  });
});
