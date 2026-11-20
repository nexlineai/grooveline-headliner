const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live && E.decks[0].isLoaded && E.decks[1].isLoaded); i++) await sleep(100);
  const d = E.decks[0], e = E.decks[1];
  d.hotCues[0] = 2; d.hotCues[1] = 9.5; d.hotCues[3] = 20.25; d.loopSlots[0] = { start: 4, end: 8 }; d.autoLoop(8); e.hotCues[0] = 1; e.hotCues[2] = 15;
  B.setValue({ t: "trim", d: 0 }, 0.35); B.setValue({ t: "eq", d: 0, band: 0 }, 0.8); B.setValue({ t: "eq", d: 0, band: 1 }, 0.3); B.setValue({ t: "eq", d: 0, band: 2 }, 0.65); B.setValue({ t: "filter", d: 0 }, 0.3);
  B.setValue({ t: "trim", d: 1 }, 0.6); B.setValue({ t: "eq", d: 1, band: 0 }, 0.35); B.setValue({ t: "eq", d: 1, band: 2 }, 0.7); B.setValue({ t: "filter", d: 1 }, 0.75);
  d.seek(6); e.seek(11);
  const type = Number(new URLSearchParams(location.search).get("fx") || 0);
  for (let i = 0; i < type; i++) B.press({ t: "fxType", d: -1 });
  B.setValue({ t: "fxParam", d: 1 }, 0.7); B.setValue({ t: "fxParam", d: 2 }, 0.4); B.setValue({ t: "fxAmount" }, 0.65);
  B.press({ t: "fxSend", d: 0 });
  document.getElementById("note").textContent = "Error: Choose the sound device for the headphones first. Open PHONES, pick the headphones device, then switch TWO DEVICES on again.";
  await sleep(900);
  console.log("LOOK2", JSON.stringify({ win: [innerWidth, innerHeight], u: +B.L.live.u.toFixed(3), type: B.fx.type, params: B.fx.params }));
})();
