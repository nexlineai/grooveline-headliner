// The career pack's manifest (web/tools/media-pack.ts) on made-up content: only the paid chapters' media go in, each file is addressed by
// its hash, the sizes add up, and what stays in the app is exactly the rest.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { contentType, packManifest } from "../tools/media-pack.ts";
import type { Career, Scene, TrackRow } from "../tools/gating.ts";

const career: Career = {
  chapters: [
    { number: 1, steps: [{ id: "intro", kind: "lesson", screens: [{ type: "lesson", id: "intro" }] }] },
    { number: 3, steps: [{ id: "shop", kind: "night", screens: [{ type: "night", id: "shop" }] }] },
  ],
  lessons: [{ id: "intro", steps: [{ voice: "intro-01" }], desk: { chapter: 1, room: "bedroom" } }],
  nights: [{ id: "shop", chapter: 3, room: "shop", lines: { clean: [{ voice: "shop-01" }] }, records: ["slow-one"] }],
  nightLines: {}, handsOff: {}, moods: ["WAITING", "NODDING", "DANCING", "GOING NUTS"],
};
const scenes: Scene[] = [];
const tracks: TrackRow[] = [{ id: "first", file: "first.m4a" }, { id: "slow-one", file: "slow-one.m4a", chapter: 3 }];
const media = ["Tracks/first.m4a", "Tracks/slow-one.m4a", "Tracks/tracks.json", "Lessons/intro-01.m4a", "Lessons/shop-01.m4a", "Art/room-bedroom.jpg", "Art/room-shop.jpg", "Fonts/F.ttf"];
const bytes: Record<string, number> = Object.fromEntries(media.map((p, i) => [p, 1000 * (i + 1)]));
const hash = (p: string) => createHash("sha256").update(p).digest("hex");
const m = packManifest(career, scenes, tracks, media, (p) => bytes[p], hash, "abc123");

describe("the career pack manifest", () => {
  test("only what the paid chapters alone use is in the pack", () => {
    assert.deepEqual(m.files.map((f) => f.path), ["Art/room-shop.jpg", "Lessons/shop-01.m4a", "Tracks/slow-one.m4a"]);
  });
  test("every file is addressed by its hash, keeps its extension and its type", () => {
    for (const f of m.files) {
      assert.equal(f.sha256, hash(f.path));
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
      assert.equal(f.key, `pack/${f.sha256}${f.path.slice(f.path.lastIndexOf("."))}`);
      assert.equal(f.type, contentType(f.path));
    }
    assert.equal(new Set(m.files.map((f) => f.key)).size, m.files.length);
  });
  test("the sizes add up, and the app keeps exactly the rest", () => {
    assert.equal(m.totalBytes, m.files.reduce((n, f) => n + f.bytes, 0));
    const inPack = new Set(m.files.map((f) => f.path));
    const rest = media.filter((p) => !inPack.has(p));
    assert.equal(m.staysInApp.files, rest.length);
    assert.equal(m.staysInApp.bytes, rest.reduce((n, p) => n + bytes[p], 0));
    assert.equal(m.totalBytes + m.staysInApp.bytes, Object.values(bytes).reduce((a, b) => a + b, 0));
  });
  test("each file says the first chapter that needs it", () => {
    assert.deepEqual(m.files.map((f) => [f.path, f.chapter]), [["Art/room-shop.jpg", 3], ["Lessons/shop-01.m4a", 3], ["Tracks/slow-one.m4a", 3]]);
  });
  test("header fields", () => {
    assert.deepEqual([m.schema, m.pack, m.firstPaidChapter, m.generatedFrom], [1, "career", 3, "abc123"]);
  });
  test("content types", () => {
    assert.deepEqual(["a.m4a", "a.mp4", "a.jpg", "a.json", "a.bin"].map(contentType), ["audio/mp4", "video/mp4", "image/jpeg", "application/json", "application/octet-stream"]);
  });
});
