// Is it MUSIC (the booth's record), not silence and not a single tone? Level, and how spread the spectrum is (a tone has one peak; music has many).
import { readFileSync } from "node:fs";
const buf = readFileSync(process.argv[2]), n = buf.length / 8, rate = 48000;
const x = new Float32Array(n - rate); for (let i = 0; i < x.length; i++) x[i] = buf.readFloatLE((i + rate) * 8);
const rms = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const goertzel = (f) => { const w = 2 * Math.PI * f / rate, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (const v of x) { const s = v + c * s1 - s2; s2 = s1; s1 = s; } return (s1 * s1 + s2 * s2 - c * s1 * s2) / x.length; };
// 13 bands from 60 Hz to 8 kHz; music carries energy across most of them (within 40 dB of the strongest: measured 12 of 13 for the game's first record),
// a single tone through Opus has one band and a floor 50 dB or more below it.
const bands = [60, 90, 140, 200, 300, 450, 700, 1000, 1500, 2300, 3500, 5500, 8000].map(goertzel), top = Math.max(...bands), strong = bands.filter((b) => b > top * 1e-4).length;
const seconds = (n / rate).toFixed(1);
const good = n / rate > 3 && rms > 0.02 && strong >= 8;
console.log(`${good ? "PASS" : "FAIL"} the server receives the booth's MUSIC: ${seconds} s read, level ${rms.toFixed(3)}, ${strong} of 13 bands within 40 dB of the strongest (a single tone: 1)`);
