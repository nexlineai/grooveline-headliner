// The stream for the radio (engine.broadcastStream) carries the ROOM and never the DJ's headphone cue, in every headphone mode we can make here.
// Deck A is on air; deck B is playing but only in the headphones (its channel fader down, its PHONES button on, the cue mix at 0 = the headphones hear ONLY the cued deck).
// With the headphones on one cable (SPLIT) the worklet puts the room in mono on the LEFT and the cue on the RIGHT: the stream must be the left on both sides.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
(async () => {
  const [A, B] = engine.decks;
  for (let i = 0; i < 100 && !(A.isLoaded && B.isLoaded); i++) await sleep(100);
  await sleep(1500);
  const ctx = engine.context;
  // two analysers on a stereo source: left and right apart
  const probe = (node) => {
    const sp = ctx.createChannelSplitter(2), l = ctx.createAnalyser(), r = ctx.createAnalyser();
    l.fftSize = r.fftSize = 2048;
    node.connect(sp); sp.connect(l, 0); sp.connect(r, 1);
    const bl = new Float32Array(2048), br = new Float32Array(2048);
    return async (ms = 1500) => {
      let el = 0, er = 0, dot = 0, n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        l.getFloatTimeDomainData(bl); r.getFloatTimeDomainData(br);
        for (let i = 0; i < 2048; i++) { el += bl[i] * bl[i]; er += br[i] * br[i]; dot += bl[i] * br[i]; n++; }
        await sleep(30);
      }
      return { l: Math.sqrt(el / n), r: Math.sqrt(er / n), corr: dot / Math.sqrt((el * er) || 1) };
    };
  };
  const stream = engine.broadcastStream();
  ok("the engine gives a stream once it runs", !!stream && stream.getAudioTracks().length === 1);
  const tapped = probe(ctx.createMediaStreamSource(stream));
  const rawRoom = probe(engine.roomPair); // what an unguarded tap would carry

  // deck A on air, deck B only in the headphones
  booth.channel[0] = 0.9; booth.channel[1] = 0; booth.cross = 0; booth.applyMix();
  if (!booth.phones[1]) booth.press({ t: "phones", d: 1 });
  engine.cueMix = 0; // 0 = only the cued decks in the headphones, 1 = only the room
  A.motorOn = true; B.motorOn = true; A.seek(10); B.seek(30);
  await sleep(1500);

  const off = await tapped();
  ok("OFF: the stream has the room's sound on both sides", off.l > 0.01 && off.r > 0.01, `L ${off.l.toFixed(3)} R ${off.r.toFixed(3)}`);

  await engine.setPhones("split"); await sleep(1500);
  const raw = await rawRoom(), split = await tapped();
  ok("SPLIT (control): the raw room pair has the cue on the right, so it differs from the left (an unguarded tap would send the cue to listeners)", raw.r > 0.01 && raw.corr < 0.9, `L ${raw.l.toFixed(3)} R ${raw.r.toFixed(3)} corr ${raw.corr.toFixed(3)}`);
  ok("SPLIT: the stream is the left channel on both sides: no cue, the same sound left and right", split.l > 0.01 && Math.abs(split.l - split.r) / split.l < 0.03 && split.corr > 0.99, `L ${split.l.toFixed(3)} R ${split.r.toFixed(3)} corr ${split.corr.toFixed(3)}`);

  await engine.setPhones("off"); await sleep(1500);
  const back = await tapped(), rawBack = await rawRoom();
  ok("back to OFF: the stream is the room's own pair again (re-wired by the mode change): the same level on each side as the raw room", back.l > 0.01 && Math.abs(back.l - rawBack.l) / rawBack.l < 0.08 && Math.abs(back.r - rawBack.r) / rawBack.r < 0.08, `stream L ${back.l.toFixed(3)} R ${back.r.toFixed(3)} | room L ${rawBack.l.toFixed(3)} R ${rawBack.r.toFixed(3)}`);

  // the room master knob sets the stream's level too
  const m = engine.roomVolume; engine.roomVolume = 0; await sleep(1200);
  const quiet = await tapped(); engine.roomVolume = m; await sleep(800);
  ok("the room master knob at 0 silences the stream too (as documented)", quiet.l < 0.002 && quiet.r < 0.002, `L ${quiet.l.toFixed(4)} R ${quiet.r.toFixed(4)}`);

  // the cue itself is NOT in the stream when it is on its own: stop deck A, cue B only
  booth.channel[0] = 0; booth.applyMix(); await sleep(1200);
  const cueOnly = await tapped();
  ok("with only the headphones playing (deck B cued, nothing on air) the stream is silent", cueOnly.l < 0.002 && cueOnly.r < 0.002, `L ${cueOnly.l.toFixed(4)} R ${cueOnly.r.toFixed(4)}`);
  await engine.setPhones("split"); await sleep(1500);
  const cueSplit = await tapped();
  ok("the same in SPLIT (the cue is on the right of the cable, not in the stream)", cueSplit.l < 0.002 && cueSplit.r < 0.002, `L ${cueSplit.l.toFixed(4)} R ${cueSplit.r.toFixed(4)}`);
  await engine.setPhones("off");
  A.motorOn = false; B.motorOn = false;
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
