// The record room's crates (library/crates.ts): grouping, order and the wall's picks.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { groupCrates, initialOf, itemOfGame, itemOfTrack, pickRandom, rankShelf } from "../src/library/crates.ts";
import type { WallItem } from "../src/library/crates.ts";
import { trackId } from "../src/library/search.ts";
import type { LibraryTrack } from "../src/library/store.ts";
import type { TrackInfo } from "../src/core/beatgrid.ts";

const item = (artist: string, title: string, over: Partial<WallItem> = {}): WallItem => ({ id: `${artist}|${title}`, title, artist, sub: "", genre: "", bpm: 0, track: null, game: null, fav: false, plays: 0, seconds: 0, type: "", mtime: 0, ...over });
const track = (name: string, over: Partial<LibraryTrack> = {}): LibraryTrack => ({
  key: `1:${name}`, folder: 1, path: [name], name, ext: "mp3", size: 1, mtime: 1, title: name, artist: "", album: "", genre: "", tagBpm: 0, musicKey: "", camelot: "", ...over,
});

describe("items", () => {
  test("a library track becomes an item with the id the deck will have, a tempo and a short line", () => {
    const t = track("t.mp3", { title: "Saturday Job", artist: "Sol Poente", tagBpm: 124, camelot: "8A", genre: "Deep House" });
    const i = itemOfTrack(t);
    assert.equal(i.id, trackId(t));
    assert.equal(i.bpm, 124);
    assert.equal(i.title, "Saturday Job");
    assert.ok(i.sub.includes("124 BPM") && i.sub.includes("8A") && i.sub.includes("Deep House"), i.sub);
    assert.equal(itemOfTrack(track("only-name.mp3")).title, "only-name.mp3");
  });

  test("a record of the game keeps its own tempo and has no cover to look for", () => {
    const info: TrackInfo = { id: "g1", title: "Low Tide", artist: "Marea", label: "", genre: "House", bpm: 122, key: "", camelot: "4A", bars: 8, seconds: 1, file: "" };
    const i = itemOfGame(info);
    assert.deepEqual([i.id, i.bpm, i.track, i.game === info], ["g1", 122, null, true]);
  });
});

describe("A-Z crates", () => {
  const names = "Aphex,Boards of Canada,Bonobo,Burial,Caribou,Daft Punk,Disclosure,Four Tet,Floating Points,Gold Panda,Harold Budd,Jon Hopkins,Kraftwerk,LCD Soundsystem,Moderat,Nils Frahm,Orbital,Prodigy,Quantic,Röyksopp,Sasha,Tycho,Underworld,Vitalic,Wolfgang,Yello,Zero 7".split(",");
  const items = names.map((n) => item(n, "x"));

  test("every record is in exactly one crate, crates are in order and about the same size, labels say where they start and end", () => {
    const crates = groupCrates(items, "az", 4);
    assert.ok(crates.length >= 3 && crates.length <= 4, String(crates.length));
    assert.equal(crates.flatMap((c) => c.items).length, items.length);
    assert.equal(new Set(crates.flatMap((c) => c.items.map((i) => i.id))).size, items.length);
    assert.equal(crates[0].label[0], "A");
    assert.equal(crates[crates.length - 1].label.slice(-1), "Z");
    const sizes = crates.map((c) => c.items.length);
    assert.ok(Math.max(...sizes) <= 2.2 * Math.min(...sizes), sizes.join(","));
    // Never a letter cut in two.
    for (let i = 1; i < crates.length; i++) assert.notEqual(initialOf(crates[i - 1].items.at(-1)!), initialOf(crates[i].items[0]));
  });

  test("inside a crate: by artist then title; names that start with a digit or a symbol come first under '#'; accents sort as their letter", () => {
    const list = [item("Zed", "b"), item("Zed", "a"), item("808 State", "Pacific"), item("Édith", "e"), item("Abba", "w")];
    const crates = groupCrates(list, "az", 1);
    assert.equal(crates.length, 1);
    assert.deepEqual(crates[0].items.map((i) => `${i.artist}/${i.title}`), ["808 State/Pacific", "Abba/w", "Édith/e", "Zed/a", "Zed/b"]);
    assert.equal(initialOf(item("Édith", "e")), "E");
    assert.equal(initialOf(item("808 State", "x")), "#");
    assert.equal(initialOf(item("", "Untitled")), "U");
  });

  test("a few records, one letter: one crate; nothing: no crates", () => {
    assert.equal(groupCrates([item("Abba", "a")], "az", 6).length, 1);
    assert.equal(groupCrates([item("Abba", "a")], "az", 6)[0].label, "A");
    assert.deepEqual(groupCrates([], "az"), []);
  });

  test("a letter that is most of the library stays whole", () => {
    const list = [...Array.from({ length: 50 }, (_, i) => item("Sol", `t${i}`)), item("Abba", "a"), item("Zed", "z")];
    const crates = groupCrates(list, "az", 6);
    assert.equal(crates.flatMap((c) => c.items).length, 52);
    assert.equal(crates.filter((c) => c.items.some((i) => i.artist === "Sol")).length, 1);
  });
});

describe("genre crates", () => {
  test("your most common genre tags (any case together), the rest, and no genre", () => {
    const list = [
      ...Array.from({ length: 5 }, (_, i) => item("A", `h${i}`, { genre: i % 2 ? "House" : "house" })),
      ...Array.from({ length: 3 }, (_, i) => item("B", `t${i}`, { genre: "Techno" })),
      item("C", "e1", { genre: "Electro" }), item("C", "e2", { genre: "Disco" }), item("C", "n1"), item("C", "n2"),
    ];
    const crates = groupCrates(list, "genre", 4);
    assert.deepEqual(crates.map((c) => [c.label, c.items.length]), [["HOUSE", 5], ["TECHNO", 3], ["OTHER GENRES", 2], ["NO GENRE", 2]]);
  });
});

describe("tempo crates", () => {
  test("bands from slow to fast, each dug slow to fast, unknown last, empty bands left out", () => {
    const list = [item("a", "1", { bpm: 98 }), item("b", "2", { bpm: 124.2 }), item("c", "3", { bpm: 119.9 }), item("d", "4", { bpm: 140 }), item("e", "5"), item("f", "6", { bpm: 124 }), item("g", "7", { bpm: 110 })];
    const crates = groupCrates(list, "tempo");
    assert.deepEqual(crates.map((c) => c.label), ["<110 BPM", "110–120 BPM", "120–126 BPM", "134+ BPM", "NO TEMPO YET"]);
    assert.deepEqual(crates[1].items.map((i) => i.bpm), [110, 119.9]);
    assert.deepEqual(crates[2].items.map((i) => i.bpm), [124, 124.2]);
    assert.equal(crates.flatMap((c) => c.items).length, list.length);
  });
});

describe("the wall's picks", () => {
  const withCover = (n: string) => item(n, n, { track: track(n, { cover: { mime: "image/jpeg", start: 1, length: 1 } }) });
  const plain = (n: string) => item(n, n, { track: track(n) });
  const seeded = () => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  test("records with a cover come first, no record twice, the number asked for", () => {
    const covers = Array.from({ length: 5 }, (_, i) => withCover(`c${i}`)), others = Array.from({ length: 20 }, (_, i) => plain(`p${i}`));
    const picks = pickRandom([...others, ...covers], 8, seeded());
    assert.equal(picks.length, 8);
    assert.equal(new Set(picks.map((p) => p.id)).size, 8);
    assert.deepEqual(picks.slice(0, 5).every((p) => p.id.startsWith("c")), true);
    const enough = pickRandom([...others, ...covers, ...Array.from({ length: 10 }, (_, i) => withCover(`d${i}`))], 8, seeded());
    assert.ok(enough.every((p) => p.track?.cover));
  });

  test("a different draw each time; fewer records than asked: all of them", () => {
    const list = Array.from({ length: 40 }, (_, i) => withCover(`c${i}`));
    const r = seeded();
    assert.notDeepEqual(pickRandom(list, 8, r).map((p) => p.id), pickRandom(list, 8, r).map((p) => p.id));
    assert.equal(pickRandom([plain("a"), plain("b")], 8).length, 2);
    assert.deepEqual(pickRandom([], 8), []);
  });
});

describe("the shelf: favourites, then the most played", () => {
  test("favourites first (the most played of them first), then the most played of the rest; nothing for a record never played or loved", () => {
    const list = [item("a", "never"), item("b", "loved", { fav: true, plays: 2 }), item("c", "often", { plays: 9 }), item("d", "lovedmore", { fav: true, plays: 5 }), item("e", "once", { plays: 1 })];
    assert.deepEqual(rankShelf(list, 10).map((i) => i.title), ["lovedmore", "loved", "often", "once"]);
    assert.deepEqual(rankShelf(list, 2).map((i) => i.title), ["lovedmore", "loved"]);
  });
  test("with no favourite and no plays there is nothing to rank (the wall falls back to random picks)", () => {
    assert.deepEqual(rankShelf([item("a", "x"), item("b", "y")], 5), []);
  });
  test("the item carries the heart and the count of its track", () => {
    const it = itemOfTrack(track("t.mp3", { fav: true, plays: 3 }));
    assert.equal(it.fav, true); assert.equal(it.plays, 3);
    assert.equal(itemOfTrack(track("u.mp3")).fav, false);
  });
});
