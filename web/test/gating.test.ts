// The map of paid media (tools/gating.ts) on the real content: chapters 1-2 must never lose a file,
// the paid chapters' records, rooms, clips and voices must be listed. (The real proof is the page
// test paywall-e2e: a stranger plays chapters 1-2 against the Worker with the gate on and sees no 403.)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gating } from "../tools/gating.ts";

const WEB = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(WEB, "..");
const media = execFileSync("git", ["ls-files", ...["Tracks", "Art", "Story", "Lessons", "Fonts"].map((m) => `App/${m}`)], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter(Boolean).map((p) => p.slice("App/".length));
const career = JSON.parse(readFileSync(path.join(WEB, "content/career.json"), "utf8"));
const scenes = JSON.parse(readFileSync(path.join(ROOT, "App/Story/scenes.json"), "utf8"));
const tracks = JSON.parse(readFileSync(path.join(ROOT, "App/Tracks/tracks.json"), "utf8")) as { id: string; file: string; chapter?: number }[];
const g = gating(career, scenes, tracks, media);
const gated = new Set(g.gated), free = new Set(g.free);

describe("the paid media", () => {
  test("a good share of the game is gated, and something stays free", () => {
    assert.ok(g.gated.length > 300, `gated ${g.gated.length}`);
    assert.ok(free.size > 80, `free ${free.size}`);
    assert.ok(g.gated.every((f) => media.includes(f)), "every gated path is a real file");
  });
  test("nothing chapters 1-2 or the menus load is gated (what a free player reaches)", () => {
    for (const c of [1, 2]) for (const f of g.byChapter[c]) assert.ok(!gated.has(f), `chapter ${c} uses ${f}`);
    for (const f of ["Art/menu-loop.m4a", "Art/title-floor.jpg", "Lessons/jingle.m4a", "Lessons/bag-01.m4a", "Tracks/tracks.json", "Story/scenes.json"]) assert.ok(!gated.has(f), f);
    assert.ok(media.filter((f) => f.startsWith("Fonts/")).every((f) => !gated.has(f)));
  });
  test("the first two records, the garage party's records and requests, the first two rooms: free", () => {
    for (const id of [tracks[0].id, tracks[1].id, "telhado", "neon-pluck", "maos-no-ar", "squelch"]) {
      const t = tracks.find((x) => x.id === id)!;
      assert.ok(!gated.has(`Tracks/${t.file}`), id);
    }
    for (const f of ["Art/room-bedroom.jpg", "Art/room-bedroom-dancing.mp4", "Art/room-garage.jpg", "Art/room-garage-nodding.mp4", "Story/cold-open-01.mp4", "Story/dani-01.mp4", "Lessons/first-mix-01.m4a"]) assert.ok(!gated.has(f), f);
  });
  test("every record of the paid chapters is gated (unless a free chapter names it)", () => {
    const paid = tracks.filter((t) => (t.chapter ?? 1) > 2);
    assert.ok(paid.length >= 50);
    const open = paid.filter((t) => !gated.has(`Tracks/${t.file}`)).map((t) => t.id);
    assert.deepEqual(open, [], `paid records left open: ${open}`);
  });
  test("a room, a story clip and a voice of a paid chapter are gated", () => {
    for (const f of ["Art/room-shop.jpg", "Art/room-berlin-dancing.mp4", "Art/room-meridian.jpg", "Story/white-label-01.mp4", "Story/vera-01.mp4", "Lessons/sync-01.m4a", "Tracks/white-label.m4a"]) assert.ok(gated.has(f), f);
  });
});
