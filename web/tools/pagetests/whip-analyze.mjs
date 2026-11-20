// Reads raw f32le stereo 48 kHz (what ffmpeg took from MediaMTX) and says whether a tone of the wanted frequency is in it: the Goertzel power at that
// frequency against others, the level (RMS) and the length.
import { readFileSync } from "node:fs";
const [file, hz] = [process.argv[2], Number(process.argv[3] || 440)];
const buf = readFileSync(file), n = buf.length / 8, rate = 48000;
const L = new Float32Array(n);
for (let i = 0; i < n; i++) L[i] = buf.readFloatLE(i * 8);
const skip = Math.min(n >> 2, rate); // the first second may still be ramping
const x = L.subarray(skip);
const goertzel = (f) => { const w = 2 * Math.PI * f / rate, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (const v of x) { const s = v + c * s1 - s2; s2 = s1; s1 = s; } return (s1 * s1 + s2 * s2 - c * s1 * s2) / x.length; };
const rms = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const at = goertzel(hz), others = [220, 330, 550, 660, 880, 1000, 1500].map(goertzel);
const ratio = at / Math.max(...others, 1e-12);
console.log(`ANALYSIS seconds=${(n / rate).toFixed(2)} rms=${rms.toFixed(4)} tone${hz}/strongest-other=${ratio.toFixed(0)}x`);
console.log(`${n / rate > 3 && rms > 0.02 && ratio > 100 ? "PASS" : "FAIL"} the radio side hears the tone: ${hz} Hz is ${ratio.toFixed(0)}x stronger than the rest, level ${rms.toFixed(3)}, ${(n / rate).toFixed(1)} s read`);
