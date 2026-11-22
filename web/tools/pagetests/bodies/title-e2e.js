const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const $ = (s) => document.querySelector(s);
  await sleep(1500);
  const vis = (el) => !!el && getComputedStyle(el).display !== "none" && !el.hidden;
  {
    // the Headliner (the game): PLAY and FREE PLAY; LIVE moved out to Grooveline Booth (grooveline.org/booth, 22 Nov)
    ok("1 the title has PLAY and FREE PLAY, and no LIVE (that is Grooveline Booth now)", vis($("#title-play")) && vis($("#title-free")) && !$("#title-live") && $("#title-free").textContent === "FREE PLAY");
    ok("1 THE ENDING is gone", !$("#title-ending") && !document.body.textContent.includes("THE ENDING"));
    ok("1 the page is the Headliner", document.title === "Grooveline Headliner");
    $("#title-free").click();
    const H = window.headliner;
    // wait for the game's two records (a fixed 6 s was too short on a busy machine), then a moment for the layout
    for (let i = 0; i < 150 && !(H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded); i++) await sleep(100);
    await sleep(1500);
    ok("2 FREE PLAY is the game's booth", !document.body.classList.contains("live") && !!H.booth.L);
    ok("2 with its CRATE button and the records of the game on the decks", !$("#crate-button").hidden && H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded);
    ok("2 no LIVE parts in the page at all (they are Grooveline Booth's): no stream panel, no wall, no SHARE, no SETTINGS", !$("#stream") && !$("#wall") && !$("#share-button") && !$("#settings-button") && !$("#livebar"));
    $("#back").click(); await sleep(1500);
    ok("3 back to the title", vis($("#title-play")) && vis($("#title-free")));
  }
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
