// Largest sample-to-sample step of a recorded 1 kHz tone (0.5 peak: a clean tone steps at most 2*pi*1000/48000*0.5 = 0.065), per segment.
// usage: node analyse-clicks.mjs file.s16 skipSeconds segStart1 segEnd1 [segStart2 segEnd2 ...] (seconds from the file's start, after skip)
import { readFileSync } from "node:fs";
const sr = 48000, buf = readFileSync(process.argv[2]), x = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
const segs = process.argv.slice(3);
for (let k = 0; k + 1 < segs.length; k += 2) {
  const a = Math.floor(Number(segs[k]) * sr), b = Math.min(x.length, Math.floor(Number(segs[k + 1]) * sr));
  let worst = 0, at = 0, peak = 0;
  for (let i = a + 1; i < b; i++) { const s = Math.abs(x[i] - x[i - 1]) / 32768; if (s > worst) { worst = s; at = i; } peak = Math.max(peak, Math.abs(x[i]) / 32768); }
  console.log(`segment ${segs[k]}..${segs[k + 1]} s: largest step ${worst.toFixed(4)} at ${(at / sr).toFixed(3)} s (clean tone: 0.065), peak ${peak.toFixed(3)}`);
}
