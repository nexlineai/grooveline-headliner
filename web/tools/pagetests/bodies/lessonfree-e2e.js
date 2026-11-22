const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  const $ = (s) => document.querySelector(s);
  for (let i = 0; i < 150 && !(B.L && B.lesson && E.decks[0].isLoaded); i++) await sleep(100);
  await sleep(3000);
  ok("1 a lesson is the iPhone's desk: no effect bar, no GAIN knobs, no wall, no RECORDS button", !!B.lesson && !("fx" in B.L) && !("trimY" in B.L) && !$("#wall") && !$("#wall-open") && !B.hits.some((h) => h.kind.t === "trim" || h.kind.t === "fxOn"));
  ok("1 every channel at exactly 0 dB", E.decks[0].trim === 0.5 && E.decks[1].trim === 0.5);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
