const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const $ = (s) => document.querySelector(s);
  await sleep(1500);
  const vis = (el) => !!el && getComputedStyle(el).display !== "none" && !el.hidden;
  const link = new URLSearchParams(location.search).has("live");
  if (!link) {
    ok("1 the title has PLAY, FREE PLAY and LIVE", vis($("#title-play")) && vis($("#title-free")) && vis($("#title-live")) && $("#title-free").textContent === "FREE PLAY" && $("#title-live").textContent === "LIVE");
    ok("1 THE ENDING is gone", !$("#title-ending") && !document.body.textContent.includes("THE ENDING"));
    $("#title-free").click(); await sleep(6000);
    const H = window.headliner;
    ok("2 FREE PLAY is the game's booth", H.booth.mode === "game" && !H.booth.L.live && !document.body.classList.contains("live"));
    ok("2 with its CRATE button and the records of the game on the decks", !$("#crate-button").hidden && H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded);
    ok("2 no LIVE parts: no stream panel, no SHARE, no master knob, and no record wall (free play is the iPhone game)", $("#stream").hidden && $("#wall").hidden && getComputedStyle($("#share-button")).display === "none" && !H.booth.hits.some((h) => h.kind.t === "master"));
    $("#back").click(); await sleep(1500);
    ok("3 back to the title, then LIVE", vis($("#title-live")));
    $("#title-live").click(); await sleep(5000);
    ok("3 LIVE is the DJ's booth: the gear row, the wall, the stream panel, SHARE; the CRATE button is gone", H.booth.mode === "live" && !!H.booth.L.live && !$("#wall").hidden && !$("#stream").hidden && getComputedStyle($("#share-button")).display !== "none" && $("#crate-button").hidden);
    ok("3 the room picture is not there", getComputedStyle($("#room")).display === "none");
  } else {
    // the website's link (?live, /headliner/live): straight into the DJ's booth, no game title
    await sleep(2500);
    const H = window.headliner;
    ok("1 a link to LIVE: no game title, the page is the DJ's booth at once (stream panel, wall, gear row, no CRATE button)", !vis($("#start")) && H.booth.mode === "live" && !!H.booth.L.live && !$("#stream").hidden && !$("#wall").hidden && $("#crate-button").hidden, `start visible ${vis($("#start"))} mode ${H.booth.mode}`);
    ok("2 the sound is running (this browser allows it), so no prompt is on the booth", !vis($("#sound-gate")) && H.engine.running, `gate ${vis($("#sound-gate"))} running ${H.engine.running}`);
    ok("3 the decks are empty (no game record on them)", !H.engine.decks[0].isLoaded && !H.engine.decks[1].isLoaded);
    $("#back").click(); await sleep(1500);
    ok("4 back, the title is the whole title again", vis($("#title-play")) && vis($("#title-free")) && vis($("#title-live")));
  }
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
