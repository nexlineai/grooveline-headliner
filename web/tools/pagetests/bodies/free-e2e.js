// FREE PLAY is the iPhone game (22 Nov, Zé): the game's booth with the room, the game's records in the CRATE. Nothing of the DJ software is in this page
// any more (record wall, effects, GAIN knobs, your own music are Grooveline Booth's, grooveline.org/booth/).
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
(async () => {
  const H = window.headliner, B = H.booth;
  for (let i = 0; i < 100 && !(H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded); i++) await sleep(100);
  await sleep(3000);
  ok("1 free play is the game's booth with the game's records on both decks", !B.lesson && !B.night && !document.body.classList.contains("live") && H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded);
  ok("1 no record wall and no RECORDS button in the page: the room shows, as on the iPhone", !$("#wall") && !$("#wall-open") && getComputedStyle($("#room")).display !== "none");
  ok("2 no effect bar under the gear", !("fx" in B.L) && !B.hits.some((h) => ["fxType", "fxDiv", "fxAmount", "fxOn"].includes(h.kind.t)));
  ok("3 no GAIN knob above the faders", !("trimY" in B.L) && !B.hits.some((h) => h.kind.t === "trim"));
  const engineFx = H.engine.fxOn;
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", key: "g", bubbles: true })); await sleep(400);
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyG", key: "g", bubbles: true }));
  ok("3 the G key (the Booth's effect key) does nothing here", H.engine.fxOn === engineFx && engineFx === false);
  $("#crate-button").click(); await sleep(800);
  ok("4 the CRATE is the game's: open, with no MY MUSIC tab", !$("#crate").hidden && !$("#crate-tabs") && !$("#mymusic"));
  $("#crate-close").click(); await sleep(300);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
