// Your playlists (library/playlists.ts) on the in-memory store: made, filled, reordered, kept, saved to a file and read back.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/library/store.ts";
import type { LibraryTrack } from "../src/library/store.ts";
import { Playlists } from "../src/library/playlists.ts";

const track = (folder: number, path: string[], o: Partial<LibraryTrack> = {}): LibraryTrack => ({
  key: `${folder}:${path.join("/")}`, folder, path, name: path[path.length - 1], ext: "mp3", size: 1, mtime: 1, title: path[path.length - 1].replace(/\.\w+$/, ""), artist: "", album: "", genre: "",
  tagBpm: 0, musicKey: "", camelot: "", ...o,
});
const lib = {
  folders: [{ id: 1, name: "Music", handle: null }, { id: 2, name: "Crate B", handle: null }],
  tracks: [track(1, ["House", "a.mp3"], { artist: "Ann", title: "Alpha", seconds: 200 }), track(1, ["House", "b.mp3"], { artist: "Bo", title: "Bravo" }), track(2, ["c.flac"], { title: "Charlie" })],
};

describe("playlists", () => {
  test("made, named, filled (a record only once), reordered, renamed, removed from, deleted; all kept in the store", async () => {
    const store = new MemoryStore();
    const pl = new Playlists(store, lib);
    await pl.load();
    const a = await pl.create(), b = await pl.create("Warm up");
    assert.deepEqual(pl.lists.map((p) => p.name), ["Playlist 1", "Warm up"], "a name is made when none is given");
    assert.ok(a.id > 0 && b.id > 0 && a.id !== b.id, "each has its own id");
    assert.equal(await pl.add(b.id, [lib.tracks[0], lib.tracks[1], lib.tracks[2]]), 3);
    assert.equal(await pl.add(b.id, [lib.tracks[1]]), 0, "a record already in is not added again");
    await pl.move(b.id, 2, 0);
    assert.deepEqual(pl.get(b.id)!.items.map((e) => e.title), ["Charlie", "Alpha", "Bravo"]);
    await pl.removeAt(b.id, 1);
    assert.deepEqual(pl.get(b.id)!.items.map((e) => e.title), ["Charlie", "Bravo"]);
    await pl.rename(b.id, "  Friday set ");
    assert.equal(pl.get(b.id)!.name, "Friday set");
    await pl.rename(b.id, "   ");
    assert.equal(pl.get(b.id)!.name, "Friday set", "an empty name changes nothing");
    // A new visit: the same store, a new object, the same playlists.
    const again = new Playlists(store, lib);
    await again.load();
    assert.deepEqual(again.lists.map((p) => [p.name, p.items.length]), [["Playlist 1", 0], ["Friday set", 2]]);
    await pl.remove(a.id);
    assert.deepEqual(pl.lists.map((p) => p.name), ["Friday set"]);
    assert.equal((await store.playlists()).length, 1);
  });

  test("an entry finds its record by the folder's name and the path in it; a record that is gone is null", async () => {
    const pl = new Playlists(new MemoryStore(), lib);
    const p = await pl.create("x");
    await pl.add(p.id, [lib.tracks[0]]);
    assert.equal(pl.trackOf(pl.get(p.id)!.items[0])?.title, "Alpha");
    assert.equal(pl.trackOf({ folder: "Music", path: ["House", "gone.mp3"], title: "", artist: "", seconds: 0 }), null);
  });

  test("saved to a .m3u8 and read back: the same records in the same order, in a new playlist", async () => {
    const pl = new Playlists(new MemoryStore(), lib);
    const p = await pl.create("Friday set");
    await pl.add(p.id, [lib.tracks[2], lib.tracks[0]]);
    const out = pl.exportOf(p.id)!;
    assert.equal(out.fileName, "Friday set.m3u8");
    const back = await pl.importText(out.text, "from a file");
    assert.equal(back.found, 2); assert.equal(back.total, 2);
    assert.equal(back.playlist.name, "Friday set", "the name in the file wins");
    assert.deepEqual(back.playlist.items.map((e) => e.title), ["Charlie", "Alpha"]);
    assert.equal(pl.lists.length, 2, "it is a new playlist, the old one stays");
  });

  test("a file from somewhere else: what is found goes in, what is not is KEPT (shown as missing, found when the folder comes back)", async () => {
    const pl = new Playlists(new MemoryStore(), lib);
    const text = "#EXTM3U\n#EXTINF:200,Ann - Alpha\nD:\\Backup\\Music\\House\\a.mp3\n#EXTINF:100,Zed - Zulu\nD:\\Backup\\Elsewhere\\zulu.mp3\nhttp://stream.example/x\n";
    const r = await pl.importText(text, "Backup");
    assert.equal(r.total, 2, "a stream address is not a record");
    assert.equal(r.found, 1);
    assert.equal(r.playlist.name, "Backup", "no name in the file: the file's own name");
    assert.equal(r.playlist.items.length, 2);
    assert.equal(r.playlist.items[0].title, "Alpha");
    assert.deepEqual([r.playlist.items[1].title, r.playlist.items[1].artist, r.playlist.items[1].seconds], ["Zulu", "Zed", 100]);
    assert.equal(pl.trackOf(r.playlist.items[1]), null, "not in the library now");
  });

  test("subscribers hear every change", async () => {
    const pl = new Playlists(new MemoryStore(), lib);
    let n = 0; pl.subscribe(() => n++);
    const p = await pl.create("x"); await pl.add(p.id, [lib.tracks[0]]); await pl.rename(p.id, "y"); await pl.remove(p.id);
    assert.equal(n, 4);
  });
});
