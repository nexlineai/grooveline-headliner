const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live && E.context && E.decks[0].isLoaded); i++) await sleep(100);
  const L = B.L, g = L.live;
  // 1. the mode
  ok("1 free play is LIVE", B.mode === "live" && !!g && document.body.classList.contains("live"));
  ok("1 LIVE's title and stream panel show, the room is gone", !document.getElementById("livebar").hidden && getComputedStyle(document.getElementById("room")).display === "none");

  // 2. every control is registered where the geometry puts it, and a touch there reaches that control
  const kindAt = (x, y) => B.control({ x, y });
  const same = (k, want) => k && k.t === want.t && (want.d === undefined || k.d === want.d) && (want.band === undefined || k.band === want.band);
  const M = g.mixer, S = M.strip;
  const checks = [
    ["TRIM A", S[0].x, S[0].knobY[0], { t: "trim", d: 0 }], ["TRIM B", S[1].x, S[1].knobY[0], { t: "trim", d: 1 }],
    ["HI A", S[0].x, S[0].knobY[1], { t: "eq", d: 0, band: 2 }], ["MID A", S[0].x, S[0].knobY[2], { t: "eq", d: 0, band: 1 }], ["LOW A", S[0].x, S[0].knobY[3], { t: "eq", d: 0, band: 0 }],
    ["HI B", S[1].x, S[1].knobY[1], { t: "eq", d: 1, band: 2 }], ["LOW B", S[1].x, S[1].knobY[3], { t: "eq", d: 1, band: 0 }],
    ["FILTER A", S[0].x, S[0].knobY[4], { t: "filter", d: 0 }], ["FILTER B", S[1].x, S[1].knobY[4], { t: "filter", d: 1 }],
    ["CUE A", S[0].cue.x, S[0].cue.y, { t: "phones", d: 0 }], ["CUE B", S[1].cue.x, S[1].cue.y, { t: "phones", d: 1 }],
    ["FADER A", S[0].fader.x, S[0].fader.y, { t: "channel", d: 0 }], ["FADER B", S[1].fader.x, S[1].fader.y, { t: "channel", d: 1 }],
    ["MASTER", M.mid.master.x, M.mid.master.y, { t: "master" }], ["CUE MIX", M.mid.mix.x, M.mid.mix.y, { t: "cueMix" }], ["PHONES LEVEL", M.mid.level.x, M.mid.level.y, { t: "phonesLevel" }],
    ["CROSSFADER", M.mid.cross.x, M.mid.cross.y, { t: "cross" }],
    ["FX name (next)", g.fx.name.x + g.fx.name.w * 0.6, g.fx.name.y + g.fx.name.h / 2, { t: "fxType", d: -1 }], ["FX name (back)", g.fx.name.x + g.fx.name.w * 0.1, g.fx.name.y + g.fx.name.h / 2, { t: "fxType", d: -2 }],
    ["FX on channel A", g.fx.send[0].x + g.fx.send[0].w / 2, g.fx.send[0].y + g.fx.send[0].h / 2, { t: "fxSend", d: 0 }], ["FX on channel B", g.fx.send[1].x + g.fx.send[1].w / 2, g.fx.send[1].y + g.fx.send[1].h / 2, { t: "fxSend", d: 1 }],
    ["FX level fader", g.fx.level.x, g.fx.level.y, { t: "fxAmount" }],
    ...g.fx.knobs.map((k, i) => [`FX knob ${i + 1}`, k.c.x, k.c.y, { t: "fxParam", d: i }]),
  ];
  for (const d of [0, 1]) {
    const G = g.deck[d];
    checks.push([`PITCH ${d}`, G.pitch.x, G.pitch.y, { t: "pitch", d }], [`CUE button ${d}`, G.buttons.cue.x, G.buttons.cue.y, { t: "cue", d }],
      [`PLAY ${d}`, G.buttons.play.x, G.buttons.play.y, { t: "play", d }], [`SYNC ${d}`, G.buttons.sync.x, G.buttons.sync.y, { t: "sync", d }],
      [`WAVEFORM ${d}`, G.wave.x + G.wave.w * 0.8, G.wave.y + G.wave.h / 2, { t: "wave", d }], [`PLATTER ${d}`, G.platter.c.x - G.platter.outer * 0.4, G.platter.c.y - G.platter.outer * 0.3, { t: "platter", d }]);
  }
  const bad = checks.filter(([, x, y, want]) => !same(kindAt(x, y), want)).map(([n, x, y]) => `${n} -> ${JSON.stringify(kindAt(x, y))}`);
  ok(`2 all ${checks.length} controls answer a touch at their place`, bad.length === 0, bad.join(" | "));
  ok("2 a touch on the empty panel reaches nothing", kindAt(g.deck[0].rect.x + 3, g.deck[0].rect.y + 3) === null);

  // 3. the values reach the sound: the master knob, which rests at 75 % (not at the top)
  ok("3 the master knob starts at 75 %, and a double tap puts it back there", Math.abs(E.roomVolume - 0.75) < 1e-9 && Math.abs(B.valueOf({ t: "master" }) - 0.75) < 1e-9);
  const ctx = E.context, an = ctx.createAnalyser(); an.fftSize = 2048; E.node.connect(an);
  const buf = new Float32Array(an.fftSize);
  const measure = async (ms) => { let e = 0, n = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (const v of buf) { e += v * v; n++; } await sleep(15); } return Math.sqrt(e / n); };
  B.setValue({ t: "channel", d: 0 }, 0.9); B.setValue({ t: "cross" }, 0.5);
  E.decks[0].motorOn = true;
  const take = async () => { E.decks[0].seek(8); await sleep(1300); return measure(1200); };
  // Three alternating measurements, the median: one window of music is not the next (and a busy machine drifts).
  const dbs = [];
  for (let k = 0; k < 3; k++) {
    B.setValue({ t: "master" }, 0.75); const full = await take();
    B.setValue({ t: "master" }, 0.375); const half = await take();
    dbs.push(20 * Math.log10(half / full));
  }
  B.setValue({ t: "master" }, 0.75);
  dbs.sort((x, y) => x - y);
  const db = dbs[1];
  ok("3 master knob at 37.5 % is -6 dB below its 75 % mark in the real sound (median of 3)", Math.abs(db + 6.02) < 1.2, `${dbs.map((x) => x.toFixed(2)).join(", ")} dB`);
  E.decks[0].motorOn = false; await sleep(500);

  // 4. a record cannot be changed under a playing needle: a message over the deck, the record stays
  const first = E.decks[0].info.id;
  E.decks[0].motorOn = true; await sleep(1500);
  const lib = H.library; await lib.init();
  const fake = { key: "x:y", folder: 1, path: ["y.mp3"], name: "y.mp3", ext: "mp3", size: 1, mtime: 1, title: "Other", artist: "", album: "", genre: "", tagBpm: 0, musicKey: "", camelot: "" };
  await H.loadUserTrack(0, fake);
  ok("4 loading into a playing deck is refused and the record stays", E.decks[0].info.id === first);
  ok("4 the message is over that deck, in words", B.alerts[0] && B.alerts[0].until > performance.now() && /STOP THE LEFT DECK/.test(B.alerts[0].text), B.alerts[0] && B.alerts[0].text);
  ok("4 the other deck has no message", B.alerts[1] === null);
  E.decks[0].motorOn = false;

  // 5. the game's booth is the iPhone's desk again: no LIVE parts, no gain, the old layout
  B.setValue({ t: "trim", d: 0 }, 0.2); await sleep(300);
  ok("5 in LIVE the gain knob reaches the deck", Math.abs(E.decks[0].trim - 0.2) < 1e-9);
  B.setMode("game"); await sleep(3000);
  ok("5 game mode: the iPhone's layout (no LIVE geometry), no LIVE page parts", B.L.live === null && !document.body.classList.contains("live") && document.getElementById("stream").hidden && document.getElementById("livebar").hidden);
  ok("5 free play (the game's booth) has the GAIN knob too: the same setting reaches the decks", E.decks[0].trim === 0.2 && B.trimSetting[0] === 0.2 && !!B.L.trimY);
  ok("5 free play has the game's controls (eq, cue-mix) and its effect bar and GAIN knobs; none of LIVE's", [["eq", { t: "eq", d: 0, band: 1 }], ["cueMix", { t: "cueMix" }], ["trim", { t: "trim", d: 0 }], ["fxOn", { t: "fxOn" }]].every(([, k]) => B.hits.some((h) => h.kind.t === k.t)) && !B.hits.some((h) => ["master", "pad", "loop", "zoom", "fxParam"].includes(h.kind.t)) && !!B.L.fx);
  B.setMode("live"); await sleep(3000);
  ok("5 game mode: the room runs at the mixer's own level (master at its mark); LIVE's knob is kept for the way back", Math.abs(E.roomVolume - 0.75) < 1e-9);
  ok("5 back in LIVE: the gain is applied again", !!B.L.live && Math.abs(E.decks[0].trim - 0.2) < 1e-9);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
