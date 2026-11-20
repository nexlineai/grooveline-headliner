import { readFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { readTags } from "../../../src/library/tags.ts";
import { readSeconds } from "../../../src/library/length.ts";
const files = readFileSync((process.argv[2] ?? "time-sample.tsv"), "utf8").trim().split("\n").filter(Boolean);
const mk = (path: string) => { const fd = openSync(path, "r"); const size = fstatSync(fd).size; let bytes = 0, reads = 0;
  return { fd, src: { size, read: async (start: number, length: number) => { const b = Buffer.alloc(Math.max(0, Math.min(length, size - start))); readSync(fd, b, 0, b.length, start); bytes += b.length; reads++; return new Uint8Array(b); } }, stats: () => ({ bytes, reads }) }; };
const half = Math.floor(files.length / 2);
async function run(list: string[], withSeconds: boolean) {
  const t0 = performance.now(); let bytes = 0, reads = 0, n = 0;
  for (const p of list) { let h; try { h = mk(p); } catch { continue; } await readTags(h.src); if (withSeconds) await readSeconds(h.src); const s = h.stats(); bytes += s.bytes; reads += s.reads; n++; closeSync(h.fd); }
  const ms = performance.now() - t0;
  return { n, ms, perFile: ms / n, mb: bytes / 1e6 / n, reads: reads / n };
}
const old = await run(files.slice(0, half), false);
const now = await run(files.slice(half), true);
const f = (r: { n: number; perFile: number; mb: number; reads: number }) => `${r.n} files, ${r.perFile.toFixed(1)} ms/file, ${r.mb.toFixed(2)} MB/file, ${r.reads.toFixed(1)} reads/file`;
console.log("old reader (tags only):  ", f(old), `-> 10,282 files: ${(old.perFile * 10282 / 1000 / 60).toFixed(1)} min`);
console.log("new reader (+ length):   ", f(now), `-> 10,282 files: ${(now.perFile * 10282 / 1000 / 60).toFixed(1)} min`);
