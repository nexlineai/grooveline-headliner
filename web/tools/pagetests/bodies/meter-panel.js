// The master meter in the stream panel: it reads what the radio gets (the room, never the headphone cue), moves with the music, falls back to nothing, and obeys the master knob.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(2) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const $ = (s) => document.querySelector(s);
(async () => {
  const [A, B] = engine.decks;
  for (let i = 0; i < 100 && !(A.isLoaded && B.isLoaded); i++) await sleep(100);
  await sleep(2500);
  ok("the meter is in the stream panel, two bars and a readout", !$("#stream").hidden && $("#meter") && $("#meter").querySelectorAll(".m-bar").length === 2 && !!$("#meter .m-db"));
  ok("nothing is playing: empty bars and a dash", meter.view.holdDb === null && meter.view.fill[0] === 0 && $("#meter .m-db").textContent === "—", `${meter.view.holdDb} ${$("#meter .m-db").textContent}`);

  // deck A on air, room master at its rest
  booth.channel[0] = 0.9; booth.channel[1] = 0; booth.cross = 0; booth.applyMix(); engine.roomVolume = 0.75;
  A.motorOn = true; A.seek(12);
  let top = -99, fl = 0, fr = 0, shown = "";
  for (let i = 0; i < 8; i++) { await sleep(1200); const v = meter.view; if (v.holdDb !== null && v.holdDb > top) top = v.holdDb; fl = Math.max(fl, v.fill[0]); fr = Math.max(fr, v.fill[1]); shown = $("#meter .m-db").textContent; }
  ok("music on air: the meter reads a sensible level (between -30 and 0 dB)", top > -30 && top <= 0.5, `top ${top.toFixed(1)} dB`);
  ok("both sides move, and the bars follow (the dark cover is pulled down)", fl > 0.2 && fr > 0.2 && getComputedStyle($("#meter .m-cover")).transform !== "none", `fill L ${fl.toFixed(2)} R ${fr.toFixed(2)}`);
  ok("the readout shows the held peak as a number", /^-?\d+(\.\d)?$/.test(shown), shown);

  // the master knob at 0: the stream is silent, so the meter falls to nothing
  engine.roomVolume = 0;
  await sleep(6000);
  ok("master knob at 0: the meter falls to empty and the readout to a dash", meter.view.holdDb === null && $("#meter .m-db").textContent === "—", `${meter.view.holdDb}`);

  // only the headphones playing (deck B, its channel down): the room, and so the radio and the meter, hear nothing
  engine.roomVolume = 0.75; A.motorOn = false;
  booth.channel[0] = 0; booth.channel[1] = 0; booth.applyMix();
  B.motorOn = true; B.seek(12);
  await sleep(7000);
  ok("a deck that is only in the headphones does not move the meter", meter.view.holdDb === null, `${meter.view.holdDb}`);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
