// The LIVE library's list: what a search matches and how the columns sort (library/browse.ts, no browser).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { camelotRank, filterItems, sortItems } from "../src/library/browse.ts";
import type { WallItem } from "../src/library/crates.ts";
import type { LibraryTrack } from "../src/library/store.ts";

const track = (over: Partial<LibraryTrack> = {}): LibraryTrack => ({
  key: "1:x", folder: 1, path: ["x"], name: "x.mp3", ext: "mp3", size: 1, mtime: 1, title: "x", artist: "", album: "", genre: "", tagBpm: 0, musicKey: "", camelot: "", ...over,
});
const item = (artist: string, title: string, o: { bpm?: number; key?: string; genre?: string; album?: string; name?: string } = {}): WallItem => ({
  id: `${artist}|${title}`, title, artist, sub: [o.bpm ? `${o.bpm} BPM` : "", o.key ?? "", o.genre ?? ""].filter(Boolean).join(" · "), genre: o.genre ?? "", bpm: o.bpm ?? 0,
  track: track({ camelot: o.key ?? "", album: o.album ?? "", name: o.name ?? `${title}.mp3` }), game: null,
});

const LIB = [
  item("Burial", "Archangel", { bpm: 130, key: "8A", genre: "Dubstep", album: "Untrue" }),
  item("Burial", "Near Dark", { bpm: 134, key: "12B", genre: "Dubstep" }),
  item("Floating Points", "Silhouettes", { bpm: 122, key: "8A", genre: "Electronic" }),
  item("Aphex Twin", "Xtal", { key: "3B" }),
  item("Moderat", "Bad Kingdom", { bpm: 119.5, genre: "Electronic", name: "03 Bad Kingdom.flac" }),
];

describe("searching the list", () => {
  test("an empty search is everything; a word finds it in the artist, the title, the genre, the album or the file name", () => {
    assert.equal(filterItems(LIB, "").length, 5);
    assert.equal(filterItems(LIB, "   ").length, 5);
    assert.deepEqual(filterItems(LIB, "burial").map((i) => i.title), ["Archangel", "Near Dark"]);
    assert.deepEqual(filterItems(LIB, "silhouettes").map((i) => i.artist), ["Floating Points"]);
    assert.equal(filterItems(LIB, "electronic").length, 2);
    assert.deepEqual(filterItems(LIB, "untrue").map((i) => i.title), ["Archangel"]);
    assert.deepEqual(filterItems(LIB, "03 bad").map((i) => i.artist), ["Moderat"]);
  });

  test("every word must match, in any order, in any case; a tempo or a key works as a word", () => {
    assert.deepEqual(filterItems(LIB, "BURIAL 8a").map((i) => i.title), ["Archangel"]);
    assert.deepEqual(filterItems(LIB, "8a 122").map((i) => i.artist), ["Floating Points"]);
    assert.deepEqual(filterItems(LIB, "dubstep 12b").map((i) => i.title), ["Near Dark"]);
    assert.deepEqual(filterItems(LIB, "kingdom moderat").length, 1);
    assert.equal(filterItems(LIB, "burial zzz").length, 0);
  });

  test("the search never changes the list it is given", () => {
    const copy = LIB.slice();
    filterItems(LIB, "burial");
    assert.deepEqual(LIB, copy);
  });
});

describe("sorting the columns", () => {
  test("by artist (the default way) and by title, and the other way round", () => {
    assert.deepEqual(sortItems(LIB, "artist").map((i) => i.artist + "/" + i.title), ["Aphex Twin/Xtal", "Burial/Archangel", "Burial/Near Dark", "Floating Points/Silhouettes", "Moderat/Bad Kingdom"]);
    assert.deepEqual(sortItems(LIB, "title").map((i) => i.title), ["Archangel", "Bad Kingdom", "Near Dark", "Silhouettes", "Xtal"]);
    assert.deepEqual(sortItems(LIB, "title", true).map((i) => i.title), ["Xtal", "Silhouettes", "Near Dark", "Bad Kingdom", "Archangel"]);
  });

  test("by tempo: slow to fast, or fast to slow, and records with no tempo come last either way", () => {
    assert.deepEqual(sortItems(LIB, "bpm").map((i) => i.bpm), [119.5, 122, 130, 134, 0]);
    assert.deepEqual(sortItems(LIB, "bpm", true).map((i) => i.bpm), [134, 130, 122, 119.5, 0]);
  });

  test("by key on the Camelot wheel (1A, 1B, 2A... 12B), no key last; equal keys keep their name order", () => {
    assert.deepEqual(sortItems(LIB, "key").map((i) => i.track!.camelot), ["3B", "8A", "8A", "12B", ""]);
    assert.deepEqual(sortItems(LIB, "key").slice(1, 3).map((i) => i.artist), ["Burial", "Floating Points"]);
    assert.deepEqual(sortItems(LIB, "key", true).map((i) => i.track!.camelot), ["12B", "8A", "8A", "3B", ""]);
    assert.equal(camelotRank("8A"), 16);
    assert.equal(camelotRank("8b"), 17);
    assert.equal(camelotRank("12B"), 25);
    assert.equal(camelotRank(""), Infinity);
    assert.equal(camelotRank("Am"), Infinity);
  });

  test("sorting returns a new list and leaves the first alone", () => {
    const copy = LIB.slice();
    const out = sortItems(LIB, "bpm");
    assert.notEqual(out, LIB);
    assert.deepEqual(LIB, copy);
  });
});
