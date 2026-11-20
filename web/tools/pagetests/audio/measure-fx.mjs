import { MasterSection, FX } from "/home/zdb/PROJECTS/grooveline-headliner/web/src/audio/fx.ts";
const rate = 48000;
let seed = 1; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
for (const [name, type] of [["delay", FX.delay], ["reverb", FX.reverb], ["flanger", FX.flanger]]) {
  const m = new MasterSection(rate);
  m.fxType = type; m.fxOn = true; m.fxAmount = 1; m.fxDelaySeconds = 0.25;
  let dry = 0, wet = 0, n = 0, peak = 0;
  for (let b = 0; b < 1500; b++) {
    const l = new Float32Array(128), r = new Float32Array(128);
    for (let i = 0; i < 128; i++) { l[i] = rnd() * 0.3; r[i] = rnd() * 0.3; }
    const l0 = l.slice();
    m.process(l, r, null, null, false, 0, 128);
    if (b > 300) for (let i = 0; i < 128; i++) { dry += l0[i] * l0[i]; wet += (l[i] - l0[i]) ** 2; n++; peak = Math.max(peak, Math.abs(l[i])); }
  }
  console.log(name, "dry rms", Math.sqrt(dry / n).toFixed(3), "wet rms", Math.sqrt(wet / n).toFixed(3), "ratio", (Math.sqrt(wet / dry)).toFixed(2), "peak", peak.toFixed(3));
}
