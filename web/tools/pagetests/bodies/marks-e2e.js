const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live && E.decks[0].isLoaded && E.decks[0].peaks); i++) await sleep(100);
  const g = B.L.live, d0 = E.decks[0], d1 = E.decks[1];
  const at = (x, y) => B.control({ x, y });
  const same = (k, w) => k && k.t === w.t && (w.d === undefined || k.d === w.d) && (w.band === undefined || k.band === w.band);

  // 1. every new control is registered where the geometry puts it
  const checks = [];
  for (const d of [0, 1]) {
    const G = g.deck[d], LU = G.loopUi;
    [...G.modeTabs, ...LU.io, ...LU.scale, LU.toggle, ...LU.auto].forEach((r, i) => checks.push([`LOOP ${d}/${i}`, r.x + r.w / 2, r.y + r.h / 2, { t: "loop", d, band: i }]));
    G.pads.forEach((r, i) => checks.push([`PAD ${d}/${i}`, r.x + r.w / 2, r.y + r.h / 2, { t: "pad", d, band: i }]));
    checks.push([`ZOOM IN ${d}`, G.zoomIn.x + 4, G.zoomIn.y + 4, { t: "zoom", d, band: 1 }], [`ZOOM OUT ${d}`, G.zoomOut.x + 4, G.zoomOut.y + 4, { t: "zoom", d, band: -1 }],
      [`BIG WAVEFORM ${d}`, G.zoom.x + G.zoom.w * 0.3, G.zoom.y + G.zoom.h / 2, { t: "zwave", d }], [`STRIP ${d}`, G.wave.x + G.wave.w * 0.5, G.wave.y + G.wave.h / 2, { t: "wave", d }]);
  }
  const bad = checks.filter(([, x, y, w]) => !same(at(x, y), w)).map(([n, x, y]) => `${n} -> ${JSON.stringify(at(x, y))}`);
  ok(`1 all ${checks.length} new controls answer a touch at their place`, bad.length === 0, bad.join(" | "));
  ok("1 smooth needle drops are on in LIVE", E.shared.get(window.__deckAt ? 0 : 0) !== undefined && d0.shared.get(d0.shared.values.length ? 14 : 14) === 64, String(d0.shared.get(14)));

  // 2. hot cues: standing still a pad is set exactly where the needle is, and jumps there
  d0.motorOn = false; d0.seek(3.37); await sleep(900);
  B.press({ t: "pad", d: 0, band: 1 });
  ok("2 an empty pad is set where the needle stands", Math.abs(d0.hotCues[1] - d0.seconds) < 0.05 && d0.hotCues[1] > 3, String(d0.hotCues[1]));
  d0.seek(40); await sleep(900);
  B.press({ t: "pad", d: 0, band: 1 }); await sleep(900);
  ok("2 a set pad jumps the needle back to it", Math.abs(d0.seconds - d0.hotCues[1]) < 0.1, `${d0.seconds.toFixed(3)} vs ${d0.hotCues[1].toFixed(3)}`);
  B.padDown(0, 1, true);
  ok("2 shift-click (alt, right button) clears it", d0.hotCues[1] === null);

  // 3. loops, really looping in the audio thread
  d0.seek(10); await sleep(900);
  B.press({ t: "loop", d: 0, band: 7 }); // auto loop 4 beats
  ok("3 an auto loop of 4 beats: on, and 4 beats long", d0.loopOn && Math.abs((d0.loopEnd - d0.loopStart) - 4 * d0.grid.beatLength) < 1e-6, `${d0.loopStart.toFixed(3)}..${d0.loopEnd.toFixed(3)}`);
  B.press({ t: "loop", d: 0, band: 10 }); // 32 beats
  ok("3 the 32 button makes a loop of 32 beats", d0.loopOn && Math.abs((d0.loopEnd - d0.loopStart) - 32 * d0.grid.beatLength) < 1e-6, `${(d0.loopEnd - d0.loopStart).toFixed(2)} s`);
  B.press({ t: "loop", d: 0, band: 7 });
  d0.motorOn = true;
  const seen = []; let wraps = 0, last = -1;
  for (let i = 0; i < 70; i++) { await sleep(80); const s = d0.seconds; seen.push(s); if (last >= 0 && s < last - 0.1) wraps++; last = s; }
  ok("3 the needle stays inside the loop and goes round it", seen.every((s) => s >= d0.loopStart - 0.12 && s <= d0.loopEnd + 0.12) && wraps >= 2, `${wraps} laps in 5.6 s; range ${Math.min(...seen).toFixed(2)}..${Math.max(...seen).toFixed(2)}`);
  B.press({ t: "loop", d: 0, band: 6 }); // loop off
  await sleep(2200);
  ok("3 loop off: the record runs on past it", d0.seconds > d0.loopEnd + 0.5, d0.seconds.toFixed(2));
  d0.motorOn = false;
  B.press({ t: "loop", d: 0, band: 2 }); d0.seek(d0.seconds + 2); await sleep(700); B.press({ t: "loop", d: 0, band: 3 });
  ok("3 IN then OUT by hand make a loop", d0.loopOn && d0.loopEnd - d0.loopStart > 1.5, `${d0.loopStart.toFixed(2)}..${d0.loopEnd.toFixed(2)}`);
  B.press({ t: "loop", d: 0, band: 4 });
  const half = d0.loopEnd - d0.loopStart; B.press({ t: "loop", d: 0, band: 5 });
  ok("3 HALF and DOUBLE", Math.abs((d0.loopEnd - d0.loopStart) - half * 2) < 1e-6);
  B.press({ t: "loop", d: 0, band: 1 }); B.press({ t: "pad", d: 0, band: 0 });
  ok("3 pads as loops: an empty pad keeps the loop", !!d0.loopSlots[0] && B.padMode[0] === "loops");
  B.press({ t: "loop", d: 0, band: 0 });
  ok("3 back to cues", B.padMode[0] === "cues");

  // 4. zoom
  const z0 = B.zoomLevel[0];
  B.press({ t: "zoom", d: 0, band: 1 });
  ok("4 the zoom button zooms in (a shorter stretch of the record)", B.zoomLevel[0] === z0 + 1 && B.windowSeconds(0) < 15, `${B.zoomLevel[0]} ${B.windowSeconds(0)} s`);
  const zr = g.deck[0].zoom, cx = zr.x + zr.w * 0.3, cy = B.L.H - (zr.y + zr.h / 2);
  document.getElementById("booth").dispatchEvent(new WheelEvent("wheel", { clientX: cx, clientY: cy, deltaY: 100, bubbles: true, cancelable: true }));
  await sleep(200);
  ok("4 the wheel over the waveform zooms out", B.zoomLevel[0] === z0, String(B.zoomLevel[0]));
  B.press({ t: "zoom", d: 0, band: -1 }); B.press({ t: "zoom", d: 0, band: -1 }); B.press({ t: "zoom", d: 0, band: -1 }); B.press({ t: "zoom", d: 0, band: -1 });
  ok("4 all the way out shows the whole record; it stops there", B.zoomLevel[0] === 0 && B.windowSeconds(0) === d0.duration);
  B.press({ t: "zoom", d: 0, band: 1 }); B.press({ t: "zoom", d: 0, band: 1 }); B.press({ t: "zoom", d: 0, band: 1 });
  ok("4 the zoom is kept between visits", JSON.parse(localStorage.getItem("headliner.zoom"))[0] === B.zoomLevel[0]);

  // 5. the big waveform is drawn (not an empty box) and moves with the record
  const px = (cv, x, y) => cv.getContext("2d").getImageData(Math.round(x * B.dpr), Math.round(y * B.dpr), 1, 1).data;
  const cv = document.getElementById("booth");
  let lit = 0; for (let k = 0; k < 40; k++) { const p = px(cv, zr.x + zr.w * (0.1 + 0.02 * k), B.L.H - (zr.y + zr.h / 2) + 14); if (p[0] + p[1] + p[2] > 120) lit++; }
  ok("5 the big waveform has a picture in it", lit > 10, `${lit} of 40 sample points lit`);

  // 6. marks are kept with a library track and come back
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-marks", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-marks", { create: true });
  const put = async (name, bytes) => { const f = await dir.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  await put("embedded.mp3", b64(SL["embedded.mp3"])); await put("bare.mp3", b64(SL["bare.mp3"]));
  await H.library.init(); await H.library.addHandle(dir); await sleep(2500);
  const track = H.library.tracks.find((t) => t.name === "embedded.mp3"), other = H.library.tracks.find((t) => t.name === "bare.mp3");
  d1.motorOn = false; await sleep(600);
  await H.loadUserTrack(1, track);
  for (let i = 0; i < 80 && d1.info?.title !== "Embedded Song"; i++) await sleep(250);
  d1.seek(0.9); await sleep(800); B.press({ t: "pad", d: 1, band: 2 });
  ok("6 a cue set on a library track is saved with it", Array.isArray(track.cues) && Math.abs(track.cues[2] - 0.9) < 0.15, JSON.stringify(track.cues));
  await H.loadUserTrack(1, other);
  for (let i = 0; i < 80 && d1.info?.title !== "Bare Song"; i++) await sleep(250);
  ok("6 the next record starts clean", d1.hotCues.every((c) => c === null));
  await H.loadUserTrack(1, track);
  for (let i = 0; i < 80 && d1.info?.title !== "Embedded Song"; i++) await sleep(250);
  ok("6 and the first one gets its cue back", d1.hotCues[2] !== null && Math.abs(d1.hotCues[2] - 0.9) < 0.15, JSON.stringify(d1.hotCues));

  // 7. the game's booth: a hard jump as before, no LIVE parts
  B.setMode("game"); await sleep(2500);
  ok("7 game mode: no smooth drops, no pads, no zoom", d0.shared.get(14) === 0 && !B.hits.some((h) => ["pad", "loop", "zoom", "zwave"].includes(h.kind.t)));
  B.setMode("live"); await sleep(2500);
  ok("7 back in LIVE: smooth drops again", d0.shared.get(14) === 64 && !!B.L.live);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
