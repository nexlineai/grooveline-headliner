// Pitch stability of a recorded 1 kHz tone: rising zero crossings (interpolated) in half-second windows.
import { readFileSync } from "node:fs";
const sr = 48000, skip = Number(process.argv[3] ?? 0);
const buf = readFileSync(process.argv[2]);
const x = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
const cross = [];
for (let i = Math.floor(skip * sr) + 1; i < x.length; i++) {
  if (x[i - 1] < 0 && x[i] >= 0) cross.push((i - 1 + (0 - x[i - 1]) / (x[i] - x[i - 1])) / sr);
}
const f = [];
const win = 0.5;
for (let t = cross[0]; t + win < cross[cross.length - 1]; t += 0.25) {
  const inWin = cross.filter((c) => c >= t && c < t + win);
  if (inWin.length > 50) f.push((inWin.length - 1) / (inWin[inWin.length - 1] - inWin[0]));
}
const cents = f.map((v) => 1200 * Math.log2(v / 1000));
const mean = cents.reduce((a, b) => a + b, 0) / cents.length;
const sd = Math.sqrt(cents.reduce((a, b) => a + (b - mean) ** 2, 0) / cents.length);
console.log(`windows ${f.length} | mean ${(f.reduce((a, b) => a + b, 0) / f.length).toFixed(3)} Hz | min ${Math.min(...f).toFixed(2)} max ${Math.max(...f).toFixed(2)} Hz | std ${sd.toFixed(2)} cents | peak-to-peak ${(Math.max(...cents) - Math.min(...cents)).toFixed(1)} cents`);
console.log("cents per window:", cents.map((c) => c.toFixed(1)).join(" "));
