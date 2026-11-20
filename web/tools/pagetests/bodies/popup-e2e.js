const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live); i++) await sleep(100);
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-pop", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-pop", { create: true });
  const put = async (name, bytes) => { const f = await dir.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  for (const n of ["embedded.mp3", "bare.mp3", "folder1.mp3", "folder2.mp3"]) await put(n, b64(SL[n]));
  await H.library.init(); await H.library.addHandle(dir); await sleep(3500);
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const pop = () => $(".load-pop");
  const shown = () => pop() && !pop().hidden && getComputedStyle(pop()).display !== "none";
  const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; };
  const near = (a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return Math.abs((x.left + x.width / 2) - (y.left + y.width / 2)) < 140 && (x.bottom <= y.top + 4 || x.top >= y.bottom - 4); };

  // 1. the shelf: a click on a record asks which deck
  const tile = $("#wall .w-pick");
  tile.click(); await sleep(300);
  ok("1 a click on a shelf record opens the question", shown());
  const btns = $$(".load-pop .lp-decks button");
  ok("1 LEFT and RIGHT, big enough to hit", btns.length === 2 && btns.every((b) => b.getBoundingClientRect().width >= 80 && b.getBoundingClientRect().height >= 36), btns.map((b) => `${b.textContent}:${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`).join(" "));
  ok("1 it names the record and sits inside the window next to it", pop().querySelector(".lp-title b").textContent.length > 0 && inside(pop()) && near(pop(), tile));
  ok("1 the colours are the decks' (cyan left, amber right)", getComputedStyle(btns[0]).color === "rgb(38, 198, 240)" && getComputedStyle(btns[1]).color === "rgb(255, 172, 40)");
  const want = pop().querySelector(".lp-title b").textContent;
  btns[1].click(); await sleep(2500);
  ok("1 RIGHT loads it on the right deck and the question closes", !shown() && E.decks[1].isLoaded && E.decks[1].info.title === want, `${E.decks[1].info && E.decks[1].info.title} vs ${want}`);

  // 2. Esc and a click elsewhere close it
  $$("#wall .w-pick")[1].click(); await sleep(200);
  ok("2 opened on another record", shown());
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150);
  ok("2 Esc closes it", !shown());
  $$("#wall .w-pick")[1].click(); await sleep(200);
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); await sleep(150);
  ok("2 a click elsewhere closes it", !shown());

  // 3. a deck that plays says so, and the stop-the-deck message comes
  E.decks[0].motorOn = true; await sleep(600);
  $$("#wall .w-pick")[2].click(); await sleep(250);
  const b0 = $$(".load-pop .lp-decks button")[0];
  ok("3 the playing deck is marked PLAYING, the other one is not", b0.classList.contains("busy") && /PLAYING/.test(b0.textContent) && !$$(".load-pop .lp-decks button")[1].classList.contains("busy"), b0.textContent);
  b0.click(); await sleep(400);
  ok("3 choosing it puts the message over that deck and loads nothing", B.alerts[0] && /STOP THE LEFT DECK/.test(B.alerts[0].text) && !E.decks[0].info?.id?.startsWith?.("lib"), B.alerts[0] && B.alerts[0].text);
  E.decks[0].motorOn = false; await sleep(500);

  // 4. an open crate: the front record asks, the others flip
  const crate = $$("#wall .w-crate").find((c) => !c.classList.contains("w-ask"));
  crate.click(); await sleep(900);
  const dig = $("#wall .w-dig") || $("#wall .dig");
  $("#wall .d-rec.front").click(); await sleep(300);
  ok("4 a click on the front record of an open crate asks which deck (the crate stays open)", shown() && $$("#wall .d-rec").length >= 1 && inside(pop()));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(500);

  // 5. the list: a click on the row asks; the small A and B buttons still load at once
  const click = (txt) => $$("#wall .w-topr button").find((x) => x.textContent === txt).click();
  click("LIST"); await sleep(700);
  const rows = $$("#wall .l-row");
  rows[0].querySelector(".l-title").click(); await sleep(300);
  ok("5 a click on a list row asks which deck", shown() && inside(pop()));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150);
  const title = rows[1].querySelector(".l-title").textContent;
  rows[1].querySelector(".l-load button.left").click(); await sleep(2500);
  ok("5 the A button on the row still loads at once, without a question", !shown() && E.decks[0].isLoaded && E.decks[0].info.title === title, `${E.decks[0].info && E.decks[0].info.title} vs ${title}`);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
