
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** A minute of four-on-the-floor at 124 BPM, first kick at 1.5 s, as a 16-bit mono WAV. */
function beatWav(bpm, first, seconds, rate) {
  const n = Math.floor(seconds * rate), x = new Float32Array(n), beat = 60 / bpm;
  let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let k = 0; first + k * beat < seconds; k++) {
    const at = Math.round((first + k * beat) * rate);
    for (let i = 0; i < 0.12 * rate && at + i < n; i++) { const t = i / rate; x[at + i] += 0.8 * Math.sin(2 * Math.PI * (52 + 90 * Math.exp(-t * 40)) * t) * Math.exp(-t * 28); }
    const off = Math.round((first + (k + 0.5) * beat) * rate);
    for (let i = 0; i < 0.03 * rate && off + i < n; i++) x[off + i] += 0.25 * rnd() * Math.exp(-i / rate * 120);
  }
  const out = new Uint8Array(44 + n * 2), dv = new DataView(out.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return out;
}
(async () => {
  const H = window.headliner;
  for (let i = 0; i < 100 && !H.engine.context; i++) await sleep(100);
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music", { create: true });
  const put = async (d, name, bytes) => { const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  await put(dir, "House - Four On The Floor.wav", beatWav(124, 1.5, 60, 22050));
  await put(dir, "notes.txt", new Uint8Array(5));
  const sub = await dir.getDirectoryHandle("Sub Folder", { create: true });
  for (const [n, s] of Object.entries(FILES)) await put(sub, n, b64(s));

  const lib = H.library;
  await lib.init();
  await lib.addHandle(dir);
  ok("scan finished, audio files only", lib.scan === null && lib.tracks.length === 5, "tracks " + lib.tracks.length + ": " + lib.tracks.map((t) => t.name).join(" | "));
  const mp3 = lib.tracks.find((t) => t.name === "v23.mp3");
  ok("tags read in the page", mp3 && mp3.title === "Tëst Tîtle" && mp3.tagBpm === 128 && mp3.camelot === "7A", JSON.stringify(mp3 && { t: mp3.title, b: mp3.tagBpm, k: mp3.camelot }));
  ok("a file with no tags is named by its file name", lib.tracks.some((t) => t.artist === "House" && t.title === "Four On The Floor"));

  // load the beat file: decode, analyse in the worker, grid on the deck
  const beat = lib.tracks.find((t) => t.ext === "wav");
  const t0 = performance.now();
  await H.loadUserTrack(0, beat);
  const g = H.engine.decks[0].grid;
  ok("analysis: 124 BPM, first beat at 1.5 s", Math.abs(g.bpm - 124) < 0.05 && Math.abs(g.firstBeat - 1.5) < 0.012, `bpm ${g.bpm.toFixed(3)} first ${g.firstBeat.toFixed(4)} in ${(performance.now() - t0).toFixed(0)} ms, conf ${beat.analysis && beat.analysis.confidence.toFixed(2)}`);
  ok("on the deck, with the analysis remembered", H.userOnDeck[0] === beat && !!beat.analysis && H.engine.decks[0].cuePoint === g.firstBeat);

  // the other formats load too
  for (const [d, name] of [[1, "tagged.flac"]]) { const t = lib.tracks.find((x) => x.name === name); await H.loadUserTrack(d, t); ok("loads " + name, H.engine.decks[d].isLoaded && H.userOnDeck[d] === t, "bpm " + H.engine.decks[d].grid.bpm.toFixed(2)); }
  const aiff = lib.tracks.find((x) => x.name === "plain.aiff"); await H.loadUserTrack(1, aiff);
  ok("loads an AIFF (our own decoder)", H.engine.decks[1].isLoaded && H.userOnDeck[1] === aiff);

  // the fixes
  H.fixGrid(0, "half"); ok("half", Math.abs(H.engine.decks[0].grid.bpm - 62) < 0.01 && Math.abs(beat.grid.bpm - 62) < 0.01);
  H.fixGrid(0, "double"); H.fixGrid(0, "up"); ok("double, then +0.1", Math.abs(H.engine.decks[0].grid.bpm - 124.1) < 0.01);
  H.engine.decks[0].seek(5); await sleep(300); H.engine.decks[0].cuePoint = 5.123; H.fixGrid(0, "here");
  ok("GRID HERE: the first beat is the cue mark", Math.abs(H.engine.decks[0].grid.firstBeat - 5.123) < 1e-6 && Math.abs(beat.grid.firstBeat - 5.123) < 1e-6);

  // a second Library (a new visit) remembers everything, folder handle included
  const mod = await import("/src/library/library.ts");
  const again = new mod.Library();
  await again.init();
  const rb = again.tracks.find((t) => t.ext === "wav");
  ok("a new visit: tracks, analysis and your correction are remembered", again.tracks.length === 5 && rb && rb.analysis && rb.grid && Math.abs(rb.grid.bpm - 124.1) < 0.01, `tracks ${again.tracks.length}`);
  ok("a new visit: the folder handle works (a file can be opened)", (await again.fileOf(rb)).size > 1000);
  await again.rescan(again.folders[0]);
  ok("rescan keeps your correction and reads nothing new", again.tracks.length === 5 && again.tracks.find((t) => t.ext === "wav").grid.bpm === rb.grid.bpm);

  // the panel
  H.showCrateTab("mine"); document.getElementById("crate").hidden = false; document.getElementById("crate-tabs").hidden = false; document.getElementById("crate-list").hidden = true;
  await sleep(500);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
