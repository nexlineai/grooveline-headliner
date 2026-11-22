// FREE PLAY is the iPhone game (22 Nov, Zé): the game's booth with the room, the game's records in the CRATE, nothing of the web's extras:
// no record wall, no RECORDS button, no effect bar, no GAIN knobs, no MY MUSIC (your own music is LIVE's). booth.freePlayExtras = true would bring them back.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
(async () => {
  const H = window.headliner, B = H.booth;
  for (let i = 0; i < 100 && !(H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded); i++) await sleep(100);
  await sleep(3000);
  ok("1 free play is the game's booth with the game's records on both decks", B.mode === "game" && !B.lesson && !B.night && H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded);
  ok("1 no record wall in front of the room, and no RECORDS button: the room shows, as on the iPhone", $("#wall").hidden && $("#wall-open").hidden && getComputedStyle($("#room")).display !== "none");
  ok("2 no effect bar under the gear", !B.L.fx && !B.hits.some((h) => ["fxType", "fxDiv", "fxAmount", "fxOn"].includes(h.kind.t)));
  ok("3 no GAIN knob above the faders", B.L.trimY === null && !B.hits.some((h) => h.kind.t === "trim"));
  const before = B.fx.on;
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", key: "g", bubbles: true })); await sleep(400);
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyG", key: "g", bubbles: true }));
  ok("3 the effect key (G) does nothing in free play", B.fx.on === before, `fx.on ${B.fx.on}`);
  $("#crate-button").click(); await sleep(800);
  ok("4 the CRATE is the game's: open, with no MY MUSIC tab", !$("#crate").hidden && $("#crate-tabs").hidden);
  $("#crate-close").click(); await sleep(300);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
