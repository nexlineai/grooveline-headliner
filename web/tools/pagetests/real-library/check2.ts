import { readFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readSeconds } from "../../../src/library/length.ts";
const rows = readFileSync((process.argv[2] ?? "mixxx-sample.tsv"), "utf8").trim().split("\n").map((l) => l.split("\t"));
let n = 0, withinFfprobe = 0, worst = 0; const bad: string[] = [];
for (const [path, dur] of rows) {
  if (!/\.mp3$/i.test(path)) continue;
  let fd: number; try { fd = openSync(path, "r"); } catch { continue; }
  const size = fstatSync(fd).size;
  const src = { size, read: async (start: number, length: number) => { const b = Buffer.alloc(Math.max(0, Math.min(length, size - start))); readSync(fd, b, 0, b.length, start); return new Uint8Array(b); } };
  const got = await readSeconds(src); closeSync(fd);
  if (got === undefined) continue;
  if (Math.abs(got - Number(dur)) <= 1) { n++; withinFfprobe++; continue; } // already agrees with Mixxx
  const truth = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString().trim());
  n++; const d = Math.abs(got - truth); worst = Math.max(worst, d);
  if (d <= 1) withinFfprobe++; else bad.push(`${path.split("/").pop()}: mine ${got.toFixed(1)} ffprobe ${truth.toFixed(1)} Mixxx ${Number(dur).toFixed(1)}`);
}
console.log(`mp3: ${n} files; mine agrees (within 1 s) with Mixxx or, where Mixxx differs, with ffprobe: ${withinFfprobe}; worst vs ffprobe ${worst.toFixed(2)} s`, bad.join(" | "));
