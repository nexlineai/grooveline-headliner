// Sleeves: finding the cover picture of a folder, reading a picture's size, and the cache and queue that serve
// the crate (the decode itself needs a browser and is tried there).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { entriesFromFiles, listFolder, pickArtName, scanEntries } from "../src/library/scan.ts";
import { Sleeves, hash32, imageSize, sleeveLook } from "../src/library/sleeves.ts";
import type { LibraryTrack } from "../src/library/store.ts";

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const file = (bytes: Uint8Array, name: string, modified = 1000, rel?: string) => {
  const f = new File([bytes as BlobPart], name, { lastModified: modified });
  if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel });
  return f;
};

type Node = { kind: "file"; file: File } | { kind: "directory"; kids: Map<string, Node> };
function dirHandle(kids: Map<string, Node>): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    async *entries() {
      for (const [name, n] of kids) yield [name, n.kind === "file" ? ({ kind: "file", name, getFile: async () => n.file } as unknown as FileSystemFileHandle) : dirHandle(n.kids)];
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("which picture is the cover", () => {
  test("cover, folder, front and the like win in that order; any case; jpg, jpeg or png", () => {
    assert.equal(pickArtName(["a.mp3", "Folder.JPG", "cover.png"]), "cover.png");
    assert.equal(pickArtName(["front.jpg", "folder.jpeg"]), "folder.jpeg");
    assert.equal(pickArtName(["Front.PNG"]), "Front.PNG");
    assert.equal(pickArtName(["AlbumArt.jpg", "art.jpg"]), "AlbumArt.jpg");
  });

  test("names that only start like a cover come after the exact ones; thumbnails, artist photos and resource forks do not count", () => {
    assert.equal(pickArtName(["AlbumArt_{ABC}_Large.jpg", "folder.jpg"]), "folder.jpg");
    assert.equal(pickArtName(["AlbumArt_{ABC}_Large.jpg"]), "AlbumArt_{ABC}_Large.jpg");
    assert.equal(pickArtName(["AlbumArtSmall.jpg"]), null);
    assert.equal(pickArtName(["artist.jpg", "photo.png", "back.jpg", "cover.gif", "cover.jpg.txt"]), null);
    assert.equal(pickArtName(["._cover.jpg"]), null);
    assert.equal(pickArtName([]), null);
  });
});

describe("the cover picture of a folder, found while scanning", () => {
  async function tree() {
    const root = new Map<string, Node>();
    const album = new Map<string, Node>(), bare = new Map<string, Node>(), nested = new Map<string, Node>();
    root.set("Album", { kind: "directory", kids: album });
    root.set("Bare", { kind: "directory", kids: bare });
    album.set("01.mp3", { kind: "file", file: file(await fx("v23.mp3"), "01.mp3") });
    album.set("folder.jpg", { kind: "file", file: file(await fx("cover.jpg"), "folder.jpg") }); // listed after the track
    album.set("Disc 2", { kind: "directory", kids: nested });
    nested.set("02.mp3", { kind: "file", file: file(await fx("v24.mp3"), "02.mp3") }); // another folder: not Album's picture
    bare.set("cover.png", { kind: "file", file: file(await fx("cover.png"), "cover.png") }); // a picture with no audio beside it
    return root;
  }

  test("the picture belongs to the audio files beside it, not to the folders below or above", async () => {
    const entries = await listFolder(dirHandle(await tree()));
    const art = Object.fromEntries(entries.map((e) => [e.path.join("/"), e.art?.path.join("/") ?? null]));
    assert.deepEqual(art, { "Album/01.mp3": "Album/folder.jpg", "Album/Disc 2/02.mp3": null });
    const picture = await entries.find((e) => e.art)!.art!.file();
    assert.equal(picture.name, "folder.jpg");
  });

  test("a folder chosen as files (no folder handles) finds it the same way", async () => {
    const list = [
      file(await fx("v23.mp3"), "01.mp3", 1, "Music/Album/01.mp3"), file(await fx("cover.jpg"), "Cover.jpg", 1, "Music/Album/Cover.jpg"),
      file(await fx("v24.mp3"), "02.mp3", 1, "Music/Other/02.mp3"),
    ];
    const entries = entriesFromFiles(list);
    assert.deepEqual(entries.map((e) => [e.path.join("/"), e.art?.path.join("/") ?? null]), [["Album/01.mp3", "Album/Cover.jpg"], ["Other/02.mp3", null]]);
  });

  test("a track gets the picture's path; an unchanged one is updated without reading its tags again, and loses it when the picture goes", async () => {
    const entries = await listFolder(dirHandle(await tree()));
    const first: LibraryTrack[] = [];
    await scanEntries(3, entries, new Map(), { batch: (l) => { first.push(...l); } });
    const track = first.find((t) => t.name === "01.mp3")!;
    assert.deepEqual(track.art, ["Album", "folder.jpg"]);
    assert.equal(first.find((t) => t.name === "02.mp3")!.art, undefined);

    // Same files again: nothing to do.
    const again: LibraryTrack[] = [];
    await scanEntries(3, entries, new Map(first.map((t) => [t.key, t])), { batch: (l) => { again.push(...l); } });
    assert.equal(again.length, 0);

    // The library was scanned before covers were looked for (no `art`): the same files get it, tags not read again.
    const old = first.map((t) => { const c = { ...t }; delete c.art; c.title = "kept"; return c; });
    const updated: LibraryTrack[] = [];
    const r = await scanEntries(3, entries, new Map(old.map((t) => [t.key, t])), { batch: (l) => { updated.push(...l); } });
    assert.equal(r.changed, 0);
    assert.equal(updated.length, 1);
    assert.deepEqual(updated[0].art, ["Album", "folder.jpg"]);
    assert.equal(updated[0].title, "kept"); // the stored track, not a re-read

    // The picture was removed from the folder.
    const gone = await listFolder(dirHandle(new Map([["Album", { kind: "directory", kids: new Map([["01.mp3", { kind: "file", file: file(await fx("v23.mp3"), "01.mp3") } as Node]]) } as Node]])));
    const lost: LibraryTrack[] = [];
    await scanEntries(3, gone, new Map(first.map((t) => [t.key, t])), { batch: (l) => { lost.push(...l); } });
    assert.equal(lost.length, 1);
    assert.equal(lost[0].art, undefined);
  });
});

describe("a picture's size from its first bytes", () => {
  test("PNG and JPEG", async () => {
    assert.deepEqual(imageSize(await fx("cover.png")), { w: 16, h: 16 });
    assert.deepEqual(imageSize(await fx("cover.jpg")), { w: 200, h: 120 });
  });

  test("a JPEG with markers before the frame header (comments, padding), and things that are not pictures", async () => {
    const jpg = await fx("cover.jpg");
    const comment = new Uint8Array([0xff, 0xfe, 0x00, 0x06, 1, 2, 3, 4]); // COM segment, then the rest
    const padded = new Uint8Array([0xff, 0xd8, ...comment, 0xff, 0xff, ...jpg.slice(2)]);
    assert.deepEqual(imageSize(padded), { w: 200, h: 120 });
    assert.equal(imageSize(new Uint8Array(0)), null);
    assert.equal(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
    assert.equal(imageSize(jpg.slice(0, 12)), null); // cut off before the frame header
  });

  test("a PNG's size is the picture's own", async () => {
    const png = await fx("cover.png");
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assert.deepEqual(imageSize(png), { w: view.getUint32(16), h: view.getUint32(20) });
  });
});

describe("a sleeve made from the name", () => {
  test("the same track always looks the same, other tracks differ, and the letters come from the words", () => {
    const a = sleeveLook({ artist: "Sol Poente", title: "Saturday Job" });
    assert.deepEqual(a, sleeveLook({ artist: "sol poente", title: "SATURDAY JOB" }));
    assert.equal(a.letters, "SP");
    assert.notEqual(a.hue, sleeveLook({ artist: "Marea", title: "Low Tide" }).hue);
    assert.equal(sleeveLook({ artist: "", title: "Untitled" }).letters, "UN");
    assert.equal(sleeveLook({ artist: "", title: "" }).letters, "?");
    assert.equal(hash32("x"), hash32("x"));
  });
});

describe("the sleeve cache and queue", () => {
  const track = (name: string, over: Partial<LibraryTrack> = {}): LibraryTrack => ({
    key: `1:${name}`, folder: 1, path: [name], name, ext: "mp3", size: 1, mtime: 1, title: name, artist: "", album: "", genre: "", tagBpm: 0, musicKey: "", camelot: "",
    cover: { mime: "image/jpeg", start: 10, length: 4 }, ...over,
  });
  const quiet = (state: { locked: boolean; calls: string[] }) => ({
    async fileQuiet(t: LibraryTrack, path: string[] = t.path): Promise<File | "locked" | null> {
      state.calls.push(path.join("/"));
      return state.locked ? "locked" : file(new Uint8Array(100), path[path.length - 1]);
    },
  });
  const wait = () => new Promise((r) => setTimeout(r, 5));

  test("a track with no picture is answered at once; the answer for one with a picture comes later and is kept", async () => {
    const state = { locked: false, calls: [] as string[] };
    const got: unknown[] = [];
    const s = new Sleeves(quiet(state));
    assert.equal(s.peek(track("none", { cover: undefined })), "none");
    s.request(track("none", { cover: undefined }), (x) => got.push(x));
    assert.deepEqual([...got], ["none"]);
    assert.equal(s.peek(track("a")), undefined);
    s.request(track("a"), (x) => got.push(x));
    await wait();
    // No browser here: the picture cannot be decoded, which is the final "none", and it is kept.
    assert.equal(got[1], "none");
    assert.equal(s.peek(track("a")), "none");
    s.request(track("a"), (x) => got.push(x));
    assert.equal(got.length, 3);
    assert.equal(state.calls.length, 1); // read once
  });

  test("a folder that waits for RECONNECT answers 'later' and is not remembered; the next ask reads it", async () => {
    const state = { locked: true, calls: [] as string[] };
    const got: unknown[] = [];
    const s = new Sleeves(quiet(state));
    s.request(track("a"), (x) => got.push(x));
    await wait();
    assert.deepEqual([...got], ["later"]);
    assert.equal(s.peek(track("a")), undefined);
    state.locked = false;
    s.request(track("a"), (x) => got.push(x));
    await wait();
    assert.equal(got[1], "none");
  });

  test("the tracks of a folder with one cover picture share one read; the newest request goes first; a cancelled one is never read", async () => {
    const state = { locked: false, calls: [] as string[] };
    const order: string[] = [];
    const s = new Sleeves(quiet(state), 400, 1); // one at a time, to see the order
    const withArt = (n: string) => track(n, { cover: undefined, art: ["Album", "folder.jpg"] });
    for (const n of ["a", "b", "c"]) s.request(withArt(n), () => order.push(n));
    await wait(); await wait();
    assert.equal(state.calls.length, 1, "three tracks, one picture");
    assert.deepEqual(order.sort(), ["a", "b", "c"]);

    const state2 = { locked: false, calls: [] as string[] };
    const s2 = new Sleeves(quiet(state2), 400, 1);
    const order2: string[] = [];
    s2.request(track("first"), () => order2.push("first")); // starts at once (the only slot)
    s2.request(track("old"), () => order2.push("old"));
    s2.request(track("new"), () => order2.push("new"));
    const cancel = s2.request(track("scrolled-away"), () => order2.push("scrolled-away"));
    cancel();
    await wait(); await wait(); await wait(); await wait();
    assert.deepEqual(order2, ["first", "new", "old"]);
    assert.ok(!state2.calls.includes("scrolled-away"));
  });

  test("the cache is small: the least recently used goes first", async () => {
    const state = { locked: false, calls: [] as string[] };
    const s = new Sleeves(quiet(state), 2, 4);
    for (const n of ["a", "b"]) s.request(track(n), () => {});
    await wait();
    s.request(track("a"), () => {}); // a used again: b is now the oldest
    s.request(track("c"), () => {});
    await wait();
    assert.equal(s.peek(track("a")), "none");
    assert.equal(s.peek(track("c")), "none");
    assert.equal(s.peek(track("b")), undefined);
  });
});
