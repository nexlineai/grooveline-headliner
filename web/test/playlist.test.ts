// Playlists as data (library/playlist.ts): the .m3u8 file, finding a line's record in the library, editing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { entryOf, fileNameFor, normalPath, parseM3u, toM3u, trackFinder, withEntry, withMoved } from "../src/library/playlist.ts";
import type { LibraryTrack, Playlist } from "../src/library/store.ts";

const track = (folder: number, path: string[], o: Partial<LibraryTrack> = {}): LibraryTrack => ({
  key: `${folder}:${path.join("/")}`, folder, path, name: path[path.length - 1], ext: "mp3", size: 1, mtime: 1, title: path[path.length - 1].replace(/\.\w+$/, ""), artist: "", album: "", genre: "",
  tagBpm: 0, musicKey: "", camelot: "", ...o,
});
const folders: Record<number, string> = { 1: "Music", 2: "Crate B" };
const name = (id: number) => folders[id] ?? "?";

describe("the .m3u8 file", () => {
  const list: Playlist = { id: 1, name: "Friday set", created: 1, updated: 2, items: [
    entryOf(track(1, ["House", "a.mp3"], { artist: "Ann", title: "Alpha", seconds: 225.4 }), "Music"),
    entryOf(track(2, ["b.flac"], { title: "Bravo" }), "Crate B"),
  ] };

  test("an extended M3U: the name, then for each record its length and label and its path from the folder that holds your music folders", () => {
    assert.equal(toM3u(list), "#EXTM3U\n#PLAYLIST:Friday set\n#EXTINF:225,Ann - Alpha\nMusic/House/a.mp3\n#EXTINF:-1,Bravo\nCrate B/b.flac\n");
  });

  test("what is written reads back: the name, the paths, the labels and the lengths", () => {
    const back = parseM3u(toM3u(list));
    assert.equal(back.name, "Friday set");
    assert.deepEqual(back.lines, [
      { path: "Music/House/a.mp3", seconds: 225, artist: "Ann", title: "Alpha" },
      { path: "Crate B/b.flac", title: "Bravo" },
    ]);
  });

  test("files from other programs: a byte order mark, Windows line endings and paths, file:// addresses, comments, streams, no #EXTINF at all", () => {
    const text = "\uFEFF#EXTM3U\r\n# a comment\r\n#EXTINF:301,Some Artist - A Title\r\nC:\\DJ\\Music\\House\\a.mp3\r\nhttp://radio.example/stream\r\nfile:///home/dj/Music/My%20Folder/b.mp3\r\n/plain/c.mp3\r\n";
    const p = parseM3u(text);
    assert.deepEqual(p.lines.map((l) => l.path), ["C:\\DJ\\Music\\House\\a.mp3", "file:///home/dj/Music/My%20Folder/b.mp3", "/plain/c.mp3"]);
    assert.deepEqual(p.lines[0], { path: "C:\\DJ\\Music\\House\\a.mp3", seconds: 301, artist: "Some Artist", title: "A Title" });
    assert.equal(p.name, undefined);
    assert.deepEqual(parseM3u("").lines, []);
  });

  test("a path is compared without drive letters, slashes of either kind, file://, %20, case or dots", () => {
    assert.deepEqual(normalPath("C:\\DJ\\Music\\House\\A.mp3"), ["dj", "music", "house", "a.mp3"]);
    assert.deepEqual(normalPath("file:///home/dj/My%20Folder/b.mp3"), ["home", "dj", "my folder", "b.mp3"]);
    assert.deepEqual(normalPath("../Music/./x.mp3"), ["music", "x.mp3"]);
  });

  test("a name becomes a file name no system objects to", () => {
    assert.equal(fileNameFor("Friday set"), "Friday set.m3u8");
    assert.equal(fileNameFor('a/b:c*"d"?'), "a b c d.m3u8");
    assert.equal(fileNameFor("   "), "playlist.m3u8");
  });
});

describe("finding the record of a line", () => {
  const library = [
    track(1, ["House", "a.mp3"], { artist: "Ann", title: "Alpha" }),
    track(1, ["Techno", "a.mp3"], { artist: "Tom", title: "Alpha Two" }),
    track(1, ["House", "deep", "c.mp3"], { artist: "Cy", title: "Charlie" }),
    track(2, ["b.flac"], { artist: "Bo", title: "Bravo" }),
    track(1, ["01.mp3"], { artist: "X", title: "One" }),
    track(2, ["01.mp3"], { artist: "Y", title: "Uno" }),
    track(1, ["Renamed", "z.mp3"], { artist: "Zed", title: "Zulu" }),
  ];
  const finder = trackFinder(library, name);

  test("the exact path we wrote ourselves", () => {
    assert.equal(finder.find({ path: "Music/House/a.mp3" })?.title, "Alpha");
    assert.equal(finder.find({ path: "Crate B/b.flac" })?.title, "Bravo");
  });

  test("the same file name in two folders: the folders in the path tell them apart", () => {
    assert.equal(finder.find({ path: "Music/Techno/a.mp3" })?.artist, "Tom");
    assert.equal(finder.find({ path: "/Users/dj/Music/House/a.mp3" })?.artist, "Ann");
  });

  test("a playlist from another computer: the drive and the folders above yours are ignored", () => {
    assert.equal(finder.find({ path: "D:\\Backup\\Music\\House\\deep\\c.mp3" })?.title, "Charlie");
  });

  test("a bare file name found in several places is NOT guessed, unless the artist and title say which", () => {
    assert.equal(finder.find({ path: "01.mp3" }), null);
    assert.equal(finder.find({ path: "01.mp3", artist: "Y", title: "Uno" })?.artist, "Y");
  });

  test("a file that was moved or renamed is found by its artist and title, when only one record has them", () => {
    assert.equal(finder.find({ path: "Old/zulu-renamed.mp3", artist: "Zed", title: "Zulu" })?.title, "Zulu");
    assert.equal(finder.find({ path: "Old/nothing.mp3", artist: "Nobody", title: "Nothing" }), null);
  });
});

describe("editing", () => {
  const e = (n: string) => ({ folder: "Music", path: [`${n}.mp3`], title: n, artist: "", seconds: 0 });
  test("a record is added once: a second time changes nothing", () => {
    const one = withEntry([], e("a"));
    assert.equal(one.length, 1);
    assert.equal(withEntry(one, e("a")), one);
    assert.equal(withEntry(one, { ...e("A"), path: ["A.MP3"] }), one, "the same path in another case is the same record");
    assert.equal(withEntry(one, e("b")).length, 2);
  });
  test("moving a record up or down; at the ends nothing moves", () => {
    const list = [e("a"), e("b"), e("c")];
    assert.deepEqual(withMoved(list, 2, 0).map((x) => x.title), ["c", "a", "b"]);
    assert.deepEqual(withMoved(list, 0, 1).map((x) => x.title), ["b", "a", "c"]);
    assert.equal(withMoved(list, 0, -1), list);
    assert.equal(withMoved(list, 2, 3), list);
    assert.equal(withMoved(list, 5, 0), list);
  });
});
