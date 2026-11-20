const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
(async () => {
  const D = engine.decks[0];
  for (let i = 0; i < 100 && !D.isLoaded; i++) await sleep(100);
  await sleep(600);
  // listen to the real worklet output
  const ctx = engine.context, an = ctx.createAnalyser(); an.fftSize = 2048; engine.node.connect(an);
  const buf = new Float32Array(an.fftSize);
  const measure = async (ms) => { let peak = 0, e = 0, n = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (const v of buf) { peak = Math.max(peak, Math.abs(v)); e += v * v; n++; } await sleep(15); } return { peak, rms: Math.sqrt(e / n) }; };
  booth.channel[0] = 0.9; booth.applyMix();
  D.motorOn = true;
  // the same stretch of the record every time (position 8 s), so the levels compare
  const take = async () => { D.seek(8); await sleep(1300); return measure(1200); };
  const off = await take();
  T("FX off", "peak", off.peak, "rms", off.rms);
  ok("the effects controller is there in LIVE", !!booth.L.live && booth.mode === "live");

  // buttons with the real keyboard path
  const key = (code) => { window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true })); window.dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true })); };
  for (const [type, name] of [[0, "delay"], [1, "reverb"], [2, "flanger"], [3, "phaser"], [4, "filter"], [5, "flg+flt"], [6, "dly+flt"]]) {
    booth.setFxType(type); booth.setFxAmount(1); booth.setFxDiv(1);
    if (type === 4) booth.setValue({ t: "fxParam", d: 0 }, 0.05); // a low-pass closed far enough to change the level of bass-heavy music
    booth.setFxOn(true);
    const on = await take();
    ok(`${name} on: sound changes, nothing past full scale`, on.peak <= 1 && Math.abs(on.rms - off.rms) / off.rms > 0.02, `peak ${on.peak.toFixed(3)} rms ${on.rms.toFixed(3)} vs ${off.rms.toFixed(3)} (engine.fxType ${engine.fxType}, on ${engine.fxOn})`);
    booth.setFxOn(false); await sleep(1500);
  }
  await sleep(4000);
  const back = await take();
  ok("off again: back to the dry level", Math.abs(back.rms - off.rms) / off.rms < 0.15, `rms ${back.rms.toFixed(3)} vs ${off.rms.toFixed(3)}`);

  // keys
  const before = { ...booth.fx };
  key("KeyG"); ok("G switches the effect on, for both channels (LIVE)", booth.fx.send[0] === true && booth.fx.send[1] === true && engine.fxSend(0) && engine.fxSend(1) && engine.fxOn === false);
  key("KeyG"); ok("G again switches it off", !booth.fx.send[0] && !booth.fx.send[1] && !engine.fxSend(0) && !engine.fxSend(1));
  key("KeyT"); ok("T = next effect", booth.fx.type === (before.type + 1) % 7);
  const d0 = booth.fx.div, hasTempo = booth.fx.type !== 1;
  key("KeyY"); ok("Y = next note value (the tempo knob steps)", hasTempo ? booth.fx.div === (d0 + 1) % 4 && engine.fxKnob(0) > -1 : booth.fx.div === d0);
  booth.setValue({ t: "fxParam", d: 1 }, 0.77);
  ok("a knob reaches the sound and the page", Math.abs(engine.fxKnob(1) - 0.77) < 1e-6 && Math.abs(booth.fx.params[1] - 0.77) < 1e-6);
  for (let i = 0; i < 7; i++) key("KeyT");
  ok("round the seven effects the knob is where it was left", Math.abs(booth.fx.params[1] - 0.77) < 1e-6 && Math.abs(engine.fxKnob(1) - 0.77) < 1e-6, String(booth.fx.params[1]));
  const a0 = booth.fx.amount; key("KeyV"); ok("V = amount down", booth.fx.amount < a0 - 0.04); key("KeyB"); ok("B = amount up", booth.fx.amount > a0 - 0.04);
  // delay time follows the tempo: 1/8 at 122 BPM
  booth.setFxDiv(1); await sleep(300);
  const want = 60 / D.bpm * 0.5, got = engine.shared.values[54];
  ok("delay time = a 1/8 at the playing tempo", Math.abs(got - want) < 0.001, `sent ${got.toFixed(4)} s, 1/8 of ${D.bpm.toFixed(1)} BPM = ${want.toFixed(4)} s`);
  // The effect per channel (LIVE's FX buttons): it works on the channels switched on, and only on them.
  booth.setFxOn(false); booth.setFxType(4); booth.setFxAmount(1); booth.setValue({ t: "fxParam", d: 0 }, 0.02); // a low-pass closed far down: it changes bass-heavy music a lot
  booth.channel[0] = 0.9; booth.channel[1] = 0.9; booth.cross = 0.5; booth.applyMix();
  engine.decks[1].motorOn = false; // deck B is silent; deck A plays
  await sleep(400);
  const dry = await take();
  booth.press({ t: "fxSend", d: 1 }); await sleep(600);
  ok("per channel: the FX button of B lights and reaches the engine", booth.fx.send[1] === true && engine.fxSend(1) === true && engine.fxSend(0) === false);
  const onSilent = await take();
  ok("per channel: the effect on a SILENT channel changes nothing in the room", Math.abs(onSilent.rms - dry.rms) / dry.rms < 0.06, `rms ${onSilent.rms.toFixed(3)} vs ${dry.rms.toFixed(3)}`);
  booth.press({ t: "fxSend", d: 0 }); await sleep(600);
  const onA = await take();
  ok("per channel: the effect on the PLAYING channel changes the sound", Math.abs(onA.rms - dry.rms) / dry.rms > 0.08 && onA.peak <= 1, `rms ${onA.rms.toFixed(3)} vs ${dry.rms.toFixed(3)}`);
  key("KeyG"); await sleep(300);
  ok("G switches the effect off on both channels", !booth.fx.send[0] && !booth.fx.send[1] && !engine.fxSend(0) && !engine.fxSend(1));
  key("KeyG"); await sleep(300);
  ok("and G again brings the same channels back", booth.fx.send[0] && booth.fx.send[1]);
  booth.setFxOn(false); await sleep(1500);
  const back2 = await take();
  ok("all off: the dry level again", Math.abs(back2.rms - dry.rms) / dry.rms < 0.12, `rms ${back2.rms.toFixed(3)} vs ${dry.rms.toFixed(3)}`);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
