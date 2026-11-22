const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const $ = (s) => document.querySelector(s);
  await sleep(1500);
  const vis = (el) => !!el && getComputedStyle(el).display !== "none" && !el.hidden;
  const boothLink = new URLSearchParams(location.search).has("booth");
  if (!boothLink) {
    // the Headliner (the game): PLAY and FREE PLAY; LIVE moved out to Grooveline Booth (grooveline.org/booth, 22 Nov)
    ok("1 the title has PLAY and FREE PLAY, and no LIVE (that is Grooveline Booth now)", vis($("#title-play")) && vis($("#title-free")) && !$("#title-live") && $("#title-free").textContent === "FREE PLAY");
    ok("1 THE ENDING is gone", !$("#title-ending") && !document.body.textContent.includes("THE ENDING"));
    ok("1 the page is the Headliner", document.title === "Grooveline Headliner");
    $("#title-free").click();
    const H = window.headliner;
    // wait for the game's two records (a fixed 6 s was too short on a busy machine), then a moment for the layout
    for (let i = 0; i < 150 && !(H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded); i++) await sleep(100);
    await sleep(1500);
    ok("2 FREE PLAY is the game's booth", H.booth.mode === "game" && !H.booth.L.live && !document.body.classList.contains("live"));
    ok("2 with its CRATE button and the records of the game on the decks", !$("#crate-button").hidden && H.engine.decks[0].isLoaded && H.engine.decks[1].isLoaded);
    ok("2 no LIVE parts: no stream panel, no SHARE, no master knob, and no record wall (free play is the iPhone game)", $("#stream").hidden && $("#wall").hidden && getComputedStyle($("#share-button")).display === "none" && !H.booth.hits.some((h) => h.kind.t === "master"));
    $("#back").click(); await sleep(1500);
    ok("3 back to the title", vis($("#title-play")) && vis($("#title-free")));
  } else {
    // Grooveline Booth (grooveline.org/booth/; ?booth on the dev server): the DJ software, straight in the booth, never the game
    await sleep(2500);
    const H = window.headliner;
    ok("1 Grooveline Booth: no game title, the DJ's booth at once (stream panel, wall, gear row, no CRATE button)", !vis($("#start")) && H.booth.mode === "live" && !!H.booth.L.live && !$("#stream").hidden && !$("#wall").hidden && $("#crate-button").hidden);
    ok("1 its own name: the page title and the top bar say BOOTH", document.title === "Grooveline Booth" && /GROOVELINE\s*BOOTH/.test(document.querySelector("#livebar .brand").textContent), `${document.title} | ${document.querySelector("#livebar .brand").textContent}`);
    ok("2 the sound is running (this browser allows it), so no prompt is on the booth", !vis($("#sound-gate")) && H.engine.running, `gate ${vis($("#sound-gate"))} running ${H.engine.running}`);
    ok("3 the decks are empty (no game record on them)", !H.engine.decks[0].isLoaded && !H.engine.decks[1].isLoaded);
    ok("4 no back arrow, and nothing leads to the game", !vis($("#back")));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); await sleep(1500);
    ok("4 Escape does not open the game's title either", !vis($("#start")) && H.booth.mode === "live");
  }
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
