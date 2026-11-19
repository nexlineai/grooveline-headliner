// How well library/beats.ts agrees with real music: random tracks from the Mixxx library on this
// machine, decoded with ffmpeg and analysed, against the tempo and first beat Mixxx stored.
//   node tools/check-beats.ts [N=40] [--seed S] [--db PATH] [--min 120] [--max 900] [--hint]
// Read-only: the database is opened with sqlite3 -readonly and the files are only read. Mixxx's
// own numbers are not the truth (a BPM that is a whole number usually came from the file's tag):
// the table says which are analysed (fractional) and which are not. `--hint` gives the analysis
// the tag BPM, as the page does.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { analyseTempo, gridScore } from "../src/library/beats.ts";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 40);
const db = opt("--db", `${os.homedir()}/.mixxx/mixxxdb.sqlite`);
const seed = Number(opt("--seed", "1"));
const minDur = Number(opt("--min", "120")), maxDur = Number(opt("--max", "900"));
const useHint = args.includes("--hint");

const sql = `select t.location, l.bpm, l.samplerate, hex(l.beats), l.duration from library l join track_locations t on l.location=t.id
 where l.mixxx_deleted=0 and l.bpm>0 and length(l.beats)>0 and l.duration between ${minDur} and ${maxDur}`;
const rows = spawnSync("sqlite3", ["-readonly", "-separator", "\t", `file:${db}?mode=ro&immutable=1`, sql], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout
  .split("\n").filter(Boolean).map((l) => l.split("\t"));
// A seeded shuffle, so a run can be repeated.
let s = seed;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }

/** The first beat of Mixxx's BeatGrid-2.0 protobuf: field 2 holds a varint frame position. */
function mixxxFirstFrame(hex: string): number | null {
  const b = Buffer.from(hex, "hex");
  let i = 0;
  const varint = (): number => { let v = 0, shift = 0; for (;;) { const c = b[i++]; v += (c & 0x7f) * 2 ** shift; if (!(c & 0x80)) return v; shift += 7; } };
  while (i < b.length) {
    const tag = varint(), field = tag >> 3, wire = tag & 7;
    if (wire === 2) {
      const len = varint(), end = i + len;
      if (field === 2) { // FramePos { varint value = 1 }
        let j = i; const t = b[j++]; if ((t >> 3) !== 1) return null;
        let v = 0, shift = 0; for (;;) { const c = b[j++]; v += (c & 0x7f) * 2 ** shift; if (!(c & 0x80)) break; shift += 7; }
        return v;
      }
      i = end;
    } else if (wire === 0) varint(); else if (wire === 1) i += 8; else if (wire === 5) i += 4; else return null;
  }
  return null;
}

function tagBpm(path: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format_tags=TBPM,BPM,bpm", "-of", "default=nw=1:nk=1", path], { encoding: "utf8" });
  const v = Number(r.stdout.split("\n").find((x) => /^\d/.test(x)));
  return Number.isFinite(v) ? v : 0;
}

const RATE = 12000;
let done = 0, within005 = 0, analysed = 0, within05 = 0, octave = 0, other = 0, ph10 = 0, ph20 = 0, ph40 = 0, none = 0, unsure = 0;
const phaseErrors: number[] = [];
console.log("mixxx bpm   mine      diff    conf  [inside spread sharp]  phase(ms)  file");
for (const [path, bpmS, srS, hex] of rows) {
  if (done >= N) break;
  if (!existsSync(path)) continue;
  const theirBpm = Number(bpmS), sr = Number(srS) || 44100;
  const frame = mixxxFirstFrame(hex);
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (pcm.status !== 0 || pcm.stdout.length < RATE * 40) continue;
  done++;
  const x = new Float32Array(pcm.stdout.buffer, pcm.stdout.byteOffset, Math.floor(pcm.stdout.length / 4));
  const t0 = performance.now();
  const r = analyseTempo(x, RATE, useHint ? tagBpm(path) : 0);
  const ms = performance.now() - t0;
  const name = path.split("/").pop()!.slice(0, 48);
  if (!r) { none++; console.log(`${theirBpm.toFixed(3).padStart(9)}   (none)                              ${name}`); continue; }
  const isAnalysed = Math.abs(theirBpm - Math.round(theirBpm)) > 0.001;
  const diff = r.bpm - theirBpm;
  const ratio = r.bpm / theirBpm;
  const oct = [0.5, 2, 1.5, 2 / 3].some((m) => Math.abs(ratio / m - 1) < 0.02);
  if (oct) octave++; else if (Math.abs(diff) <= 0.5) within05++; else other++;
  if (isAnalysed) { analysed++; if (Math.abs(diff) <= 0.05) within005++; }
  if (r.confidence < 0.5) unsure++;
  let phase = NaN, diag = "";
  if (frame !== null && !oct) {
    const beat = 60 / theirBpm, their = frame / sr;
    phase = (((r.firstBeat - their) % beat) + beat * 1.5) % beat - beat / 2;
    phase *= 1000;
    phaseErrors.push(phase);
    // When the two grids disagree: which one really lies on the onsets?
    if (Math.abs(phase) > 40) {
      const mine = gridScore(x, RATE, r.bpm, r.firstBeat), theirs = gridScore(x, RATE, theirBpm, frame / sr);
      diag = `  grid strength mine ${mine.toFixed(2)} / Mixxx ${theirs.toFixed(2)}`;
    }
    if (Math.abs(phase) <= 10) ph10++;
    if (Math.abs(phase) <= 20) ph20++;
    if (Math.abs(phase) <= 40) ph40++;
  }
  console.log(`${theirBpm.toFixed(3).padStart(9)}${isAnalysed ? "*" : " "}  ${r.bpm.toFixed(3).padStart(8)}  ${diff.toFixed(3).padStart(7)}  ${r.confidence.toFixed(2)}  [${r.detail!.inside.toFixed(2)} ${r.detail!.spreadMs.toFixed(1).padStart(4)} ${r.detail!.sharpness.toFixed(1).padStart(4)}]  ${Number.isNaN(phase) ? "   -   " : phase.toFixed(1).padStart(7)}${oct ? "  OCTAVE" : ""}   ${name}  (${ms.toFixed(0)} ms)${diag}`);
}
const measured = done - none;
const sorted = phaseErrors.map(Math.abs).sort((a, b) => a - b);
console.log(`\n${done} tracks: no result ${none}, unsure (conf < 0.5) ${unsure}`);
console.log(`tempo: within 0.5 BPM of Mixxx ${within05}, octave or 3:2 apart ${octave}, other ${other} (of ${measured})`);
console.log(`       of the ${analysed} that Mixxx analysed (fractional, marked *): within 0.05 BPM ${within005}`);
console.log(`phase: within 10 ms ${ph10}, 20 ms ${ph20}, 40 ms ${ph40} (of ${sorted.length}); median |error| ${sorted.length ? sorted[Math.floor(sorted.length / 2)].toFixed(1) : "-"} ms`);
