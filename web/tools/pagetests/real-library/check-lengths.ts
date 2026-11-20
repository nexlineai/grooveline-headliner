import { readFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { readSeconds } from "../../../src/library/length.ts";
const rows = readFileSync((process.argv[2] ?? "mixxx-sample.tsv"), "utf8").trim().split("\n").map((l) => l.split("\t"));
const stats: Record<string, { n: number; ok: number; none: number; worst: number; bad: string[] }> = {};
for (const [path, dur] of rows) {
  const ext = path.split(".").pop()!.toLowerCase();
  const st = (stats[ext] ??= { n: 0, ok: 0, none: 0, worst: 0, bad: [] });
  st.n++;
  let fd: number;
  try { fd = openSync(path, "r"); } catch { st.n--; continue; }
  const size = fstatSync(fd).size;
  const src = { size, read: async (start: number, length: number) => { const b = Buffer.alloc(Math.max(0, Math.min(length, size - start))); readSync(fd, b, 0, b.length, start); return new Uint8Array(b); } };
  const got = await readSeconds(src);
  closeSync(fd);
  if (got === undefined) { st.none++; st.bad.push(`${path.split("/").pop()} (none)`); continue; }
  const diff = Math.abs(got - Number(dur));
  st.worst = Math.max(st.worst, diff);
  if (diff <= 1) st.ok++; else st.bad.push(`${path.split("/").pop()}: mine ${got.toFixed(1)} vs Mixxx ${Number(dur).toFixed(1)}`);
}
for (const [ext, s] of Object.entries(stats)) console.log(ext.padEnd(5), `${s.n} files, within 1 s: ${s.ok}, no answer: ${s.none}, worst difference ${s.worst.toFixed(2)} s`, s.bad.slice(0, 4).join(" | "));
