const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  for (let i = 0; i < 150 && !(B.L && E.decks[0].isLoaded && E.decks[1].isLoaded); i++) await sleep(100);
  await sleep(2500);
  // FREE PLAY is the free play of the deployed site: the game's booth, the wall in front of the room, the effect bar, the GAIN knobs.
  ok("1 the game's booth, not LIVE", B.mode === "game" && !B.L.live && !document.body.classList.contains("live") && $("#stream").hidden);
  ok("1 the wall is up in front of the room, with the game's records as a crate", !$("#wall").hidden && $$("#wall .w-crate").some((c) => c.textContent.includes("THE GAME")) && $$("#wall .w-pick").length > 0);
  ok("1 the CRATE button is there, the RECORDS button is not (the wall is showing)", !$("#crate-button").hidden && $("#wall-open").hidden);
  ok("2 the effect bar is under the gear (DELAY, REVERB, FLANGER, 4 note values, AMOUNT, ON)", !!B.L.fx && ["fxType", "fxDiv", "fxAmount", "fxOn"].every((t) => B.hits.some((h) => h.kind.t === t)) && B.hits.filter((h) => h.kind.t === "fxType").length === 3 && B.hits.filter((h) => h.kind.t === "fxDiv").length === 4);
  B.press({ t: "fxOn" }); await sleep(200);
  ok("2 ON switches the effect on", E.fxOn === true && B.fx.on === true);
  B.press({ t: "fxDiv", d: 2 }); B.press({ t: "fxType", d: 1 }); await sleep(200);
  ok("2 a note value (1/16), then REVERB: the effect changes, the note value is kept", E.fxType === 1 && B.fx.type === 1 && B.fx.div === 2);
  B.press({ t: "fxOn" });
  ok("3 a GAIN knob above each fader", !!B.L.trimY && B.hits.filter((h) => h.kind.t === "trim").length === 2);
  B.setValue({ t: "trim", d: 0 }, 0.2); await sleep(300);
  ok("3 it reaches the deck", Math.abs(E.decks[0].trim - 0.2) < 1e-9);
  ok("3 and the master is the game's: the room at the mixer's own level", Math.abs(E.roomVolume - 0.75) < 1e-9);
  // ROOM: the crowd instead of the wall, and back
  $("#wall .w-room").click(); await sleep(2500);
  ok("4 ROOM shows the crowd: the wall goes, RECORDS comes", $("#wall").hidden && !$("#wall-open").hidden);
  $("#wall-open").click(); await sleep(2500);
  ok("4 RECORDS brings the wall back", !$("#wall").hidden && $("#wall-open").hidden);
  // a playing deck keeps its record (the small note, as before)
  E.decks[0].motorOn = true; await sleep(600);
  $$("#wall .w-pick")[0].click(); await sleep(300);
  ok("5 a click on a record asks which deck, and the playing one is marked", !!$(".load-pop.open, .load-pop:not([hidden])") && $$(".load-pop .lp-decks button")[0].classList.contains("busy"));
  const before = E.decks[0].info.id;
  $$(".load-pop .lp-decks button")[0].click(); await sleep(500);
  ok("5 loading into a playing deck is refused with the old note, in free play", E.decks[0].info.id === before && /Stop the deck/.test($("#note").textContent), $("#note").textContent);
  E.decks[0].motorOn = false;
  // a lesson is the iPhone's desk again: no bar, no knobs, no wall, every channel at 0 dB
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
