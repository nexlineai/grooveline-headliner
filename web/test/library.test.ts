// The library's scan, search and store, on a made-up folder (the fixtures) with no browser.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { carryOver, entriesFromFiles, extensionOf, listFolder, scanEntries, trackKey } from "../src/library/scan.ts";
import { MemoryStore } from "../src/library/store.ts";
import type { LibraryTrack } from "../src/library/store.ts";
import { buildIndex, filterIndex, labelOf, tempoOf, trackId } from "../src/library/search.ts";

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));

// A folder tree that looks like FileSystemDirectoryHandle to the scanner.
type Node = { kind: "file"; file: File } | { kind: "directory"; kids: Map<string, Node> };
function dirHandle(kids: Map<string, Node>): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    async *entries() {
      for (const [name, n] of kids) yield [name, n.kind === "file" ? ({ kind: "file", name, getFile: async () => n.file } as unknown as FileSystemFileHandle) : dirHandle(n.kids)];
    },
  } as unknown as FileSystemDirectoryHandle;
}
const file = (bytes: Uint8Array, name: string, modified = 1000) => new File([bytes as BlobPart], name, { lastModified: modified });

async function tree() {
  const root = new Map<string, Node>();
  const sub = new Map<string, Node>();
  const deep = new Map<string, Node>();
  root.set("a.mp3", { kind: "file", file: file(await fx("v23.mp3"), "a.mp3") });
  root.set("notes.txt", { kind: "file", file: file(new Uint8Array(10), "notes.txt") });
  root.set("cover.jpg", { kind: "file", file: file(new Uint8Array(10), "cover.jpg") });
  root.set("._a.mp3", { kind: "file", file: file(new Uint8Array(10), "._a.mp3") }); // a macOS resource fork
  root.set("Album", { kind: "directory", kids: sub });
  root.set(".hidden", { kind: "directory", kids: new Map([["x.mp3", { kind: "file", file: file(new Uint8Array(10), "x.mp3") } as Node]]) });
  sub.set("01 - Some Artist - Plain Name.wav", { kind: "file", file: file(await fx("plain.wav"), "01 - Some Artist - Plain Name.wav") });
  sub.set("Deeper", { kind: "directory", kids: deep });
  deep.set("t.flac", { kind: "file", file: file(await fx("tagged.flac"), "t.flac") });
  deep.set("m.m4a", { kind: "file", file: file(await fx("itunes.m4a"), "m.m4a") });
  return root;
}

describe("scanning a folder", () => {
  test("finds audio files at every depth, skips other files, hidden folders and resource forks", async () => {
    const entries = await listFolder(dirHandle(await tree()));
    assert.deepEqual(entries.map((e) => e.path.join("/")).sort(), ["Album/01 - Some Artist - Plain Name.wav", "Album/Deeper/m.m4a", "Album/Deeper/t.flac", "a.mp3"]);
    assert.equal(extensionOf("Track.FLAC"), "flac");
    assert.equal(extensionOf("noext"), "");
  });

  test("reads tags, falls back to the file name, and reports progress and batches", async () => {
    const entries = await listFolder(dirHandle(await tree()));
    const batches: LibraryTrack[][] = [];
    const progress: number[] = [];
    const r = await scanEntries(7, entries, new Map(), { batch: (l) => { batches.push(l); }, progress: (d) => progress.push(d) });
    const all = batches.flat();
    assert.equal(r.added, 4);
    assert.equal(all.length, 4);
    assert.equal(progress[progress.length - 1], 4);
    const mp3 = all.find((t) => t.name === "a.mp3")!;
    assert.equal(mp3.key, "7:a.mp3");
    assert.equal(mp3.title, "Tëst Tîtle");
    assert.equal(mp3.tagBpm, 128);
    assert.equal(mp3.camelot, "7A");
    assert.ok(mp3.cover);
    const wav = all.find((t) => t.ext === "wav")!;
    assert.equal(wav.artist, "Some Artist"); // no tags: the file name says it
    assert.equal(wav.title, "Plain Name");
    assert.equal(wav.tagBpm, 0);
  });

  test("a second scan reads nothing that has not changed, and keeps your corrections", async () => {
    const root = await tree();
    const entries = await listFolder(dirHandle(root));
    const first: LibraryTrack[] = [];
    await scanEntries(1, entries, new Map(), { batch: (l) => { first.push(...l); } });
    first.find((t) => t.name === "a.mp3")!.grid = { bpm: 126.5, firstBeat: 0.25 };
    const existing = new Map(first.map((t) => [t.key, t]));
    const again: LibraryTrack[] = [];
    const r = await scanEntries(1, entries, existing, { batch: (l) => { again.push(...l); } });
    assert.equal(again.length, 0);
    assert.equal(r.seen.size, 4);
    // One file changes (a new date): it is read again, and the correction on it stays.
    (root.get("a.mp3") as { kind: "file"; file: File }).file = file(await fx("v23.mp3"), "a.mp3", 2000);
    const changed: LibraryTrack[] = [];
    const r2 = await scanEntries(1, await listFolder(dirHandle(root)), existing, { batch: (l) => { changed.push(...l); } });
    assert.equal(r2.changed, 1);
    assert.deepEqual(changed[0].grid, { bpm: 126.5, firstBeat: 0.25 });
  });

  test("a rescan (a newer tag reader, or a file that changed) keeps EVERYTHING that is yours: grid, analysis, cues, loops, the heart and the plays; and fills in the length", async () => {
    const root = await tree();
    const entries = await listFolder(dirHandle(root));
    const first: LibraryTrack[] = [];
    await scanEntries(1, entries, new Map(), { batch: (l) => { first.push(...l); } });
    const a = first.find((t) => t.name === "a.mp3")!;
    assert.ok(a.seconds !== undefined && Math.abs(a.seconds - 1.567) < 0.01, `its length is read at the scan: ${a.seconds}`);
    // The entry is as an older reader left it (version 2, no length), with what you did to it.
    const old: LibraryTrack = { ...a, v: 2, grid: { bpm: 126.5, firstBeat: 0.25 }, analysis: { bpm: 120, firstBeat: 0.1, confidence: 1 },
      cues: [1.5, null, 3], loops: [{ start: 2, end: 4 }], fav: true, plays: 7 };
    delete old.seconds;
    const again: LibraryTrack[] = [];
    await scanEntries(1, entries, new Map([[old.key, old]]), { batch: (l) => { again.push(...l); } });
    const t = again.find((x) => x.name === "a.mp3")!;
    assert.ok(t, "an entry from an older reader is read again");
    assert.deepEqual(t.grid, old.grid); assert.deepEqual(t.analysis, old.analysis);
    assert.deepEqual(t.cues, [1.5, null, 3]); assert.deepEqual(t.loops, [{ start: 2, end: 4 }]);
    assert.equal(t.fav, true); assert.equal(t.plays, 7);
    assert.ok(t.seconds !== undefined && t.seconds > 1, "and the length is filled in");
    assert.equal(carryOver.length, 2);
  });

  test("an aborted scan says it is not complete (so nothing is dropped from the index)", async () => {
    const entries = await listFolder(dirHandle(await tree()));
    const ctl = new AbortController();
    ctl.abort();
    const r = await scanEntries(1, entries, new Map(), { batch: () => {}, signal: ctl.signal });
    assert.equal(r.complete, false);
  });

  test("files from an <input webkitdirectory>: the chosen folder's own name is dropped from the path", () => {
    const f = file(new Uint8Array(4), "s.mp3");
    Object.defineProperty(f, "webkitRelativePath", { value: "My Music/House/s.mp3" });
    const e = entriesFromFiles([f, file(new Uint8Array(4), "readme.txt")]);
    assert.equal(e.length, 1);
    assert.deepEqual(e[0].path, ["House", "s.mp3"]);
  });
});

describe("the store", () => {
  test("folders and tracks: add, list, replace, delete, and a folder takes its tracks with it", async () => {
    const s = new MemoryStore();
    const a = await s.addFolder("Music", null), b = await s.addFolder("Other", null);
    const t = (folder: number, name: string): LibraryTrack => ({ key: trackKey(folder, [name]), folder, path: [name], name, ext: "mp3", size: 1, mtime: 1, title: name, artist: "", album: "", genre: "", tagBpm: 0, musicKey: "", camelot: "" });
    await s.putTracks([t(a.id, "x.mp3"), t(a.id, "y.mp3"), t(b.id, "z.mp3")]);
    assert.equal((await s.tracks()).length, 3);
    await s.putTracks([{ ...t(a.id, "x.mp3"), title: "New" }]);
    assert.equal((await s.tracks()).find((x) => x.name === "x.mp3")!.title, "New");
    await s.deleteTracks([trackKey(a.id, ["y.mp3"])]);
    assert.equal((await s.tracks()).length, 2);
    await s.removeFolder(a.id);
    assert.deepEqual((await s.tracks()).map((x) => x.name), ["z.mp3"]);
    assert.equal((await s.folders()).length, 1);
  });
});

describe("searching", () => {
  const make = (artist: string, title: string, extra: Partial<LibraryTrack> = {}): LibraryTrack => ({
    key: `1:${artist}-${title}`, folder: 1, path: [`${artist}-${title}.mp3`], name: `${artist}-${title}.mp3`, ext: "mp3", size: 10, mtime: 1,
    title, artist, album: "", genre: "", tagBpm: 0, musicKey: "", camelot: "", ...extra,
  });
  const tracks = [make("Zed", "Last", { tagBpm: 124, camelot: "8A" }), make("Alpha", "Track 10"), make("Alpha", "Track 2", { album: "Dub Selection", analysis: { bpm: 126.4, firstBeat: 0.1, confidence: 0.6 } }), make("Beta", "Middle")];

  test("sorted by artist then title, numbers by value", () => {
    assert.deepEqual(buildIndex(tracks).map((i) => i.track.title), ["Track 2", "Track 10", "Middle", "Last"]);
  });

  test("every word must match, any order, any case, in artist, title, album, key or tempo", () => {
    const idx = buildIndex(tracks);
    assert.deepEqual(filterIndex(idx, "alpha dub", 10).shown.map((t) => t.title), ["Track 2"]);
    assert.deepEqual(filterIndex(idx, "8a", 10).shown.map((t) => t.title), ["Last"]);
    assert.deepEqual(filterIndex(idx, "124", 10).shown.map((t) => t.title), ["Last"]);
    assert.equal(filterIndex(idx, "", 10).total, 4);
    assert.equal(filterIndex(idx, "nothing here", 10).total, 0);
    const limited = filterIndex(idx, "", 2);
    assert.equal(limited.shown.length, 2);
    assert.equal(limited.total, 4); // the count is of all matches, the list is cut
  });

  test("tempo: your correction, then the analysis, then the tag; labels say so", () => {
    const t = make("A", "B", { tagBpm: 120, analysis: { bpm: 123.37, firstBeat: 0, confidence: 1 } });
    assert.equal(tempoOf(t), 123.37);
    assert.equal(tempoOf({ ...t, grid: { bpm: 123.5, firstBeat: 0.2 } }), 123.5);
    assert.equal(tempoOf(make("A", "B")), 0);
    assert.equal(labelOf(t).sub, "123.4 BPM · MP3");
    assert.equal(labelOf(make("", "Only Title")).main, "Only Title");
  });

  test("an id is the same for the same file and different for another", () => {
    const a = make("A", "B"), b = make("A", "C");
    assert.equal(trackId(a), trackId({ ...a }));
    assert.notEqual(trackId(a), trackId(b));
    assert.ok(trackId(a).startsWith("my:"));
  });
});
