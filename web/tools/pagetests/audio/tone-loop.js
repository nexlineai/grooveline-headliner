// A 1 kHz tone on deck A, room on the Headliner-Radio null sink (recorded outside). Phase 1: plain play. Phase 2: a loop whose length is NOT a whole number of
// cycles (so every lap has a phase jump the seam crossfade must hide). Phase 3: needle drops while it turns (smooth seeks). Marks are printed as wall-clock ms.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const H = window.headliner, E = H.engine, B = H.booth;
  for (let i = 0; i < 100 && !(E.context && E.decks[0].isLoaded); i++) await sleep(100);
  await E.allowDeviceNames();
  const outs = await E.listOutputs();
  const radio = outs.find((o) => /Headliner-Radio/i.test(o.label));
  await E.setRoomDevice(radio.id); await E.setPhones("off");
  const sr = 48000, n = sr * 60, l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
  const d = E.decks[0];
  d.loadMade({ id: "tone", title: "tone", artist: "", label: "", genre: "", bpm: 120, key: "", camelot: "8A", bars: 8, seconds: 60, file: "" }, l, l.slice(), sr);
  await sleep(1500);
  B.setValue({ t: "channel", d: 0 }, 1); B.setValue({ t: "cross" }, 0);
  d.quantize = false; d.smoothSeek = true;
  d.motorOn = true;
  await sleep(4000);
  console.log("MARK plain", Date.now());
  await sleep(4000);
  console.log("MARK loop-on", Date.now());
  // IN at 12.0 s of the tone, OUT 1.3017 s later: not a whole number of 1 kHz cycles.
  d.seek(12.0); await sleep(300);
  d.loopIn(); await sleep(1301.7); d.loopOut();
  await sleep(9000);
  console.log("MARK loop-off", Date.now(), "loopOn", d.loopOn, "len", +(d.loopEnd - d.loopStart).toFixed(4));
  d.toggleLoop();
  await sleep(3000);
  console.log("MARK seeks", Date.now());
  for (let i = 0; i < 12; i++) { d.seek(20 + i * 1.37); await sleep(600); }
  console.log("MARK end", Date.now());
})().catch((e) => console.log("TONE ERROR", e && e.message || e));
