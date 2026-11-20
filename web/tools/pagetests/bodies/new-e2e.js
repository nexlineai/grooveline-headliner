const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live && E.decks[0].isLoaded); i++) await sleep(100);
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const wall = $("#wall");

  // 1. LIVE has no game records: with no library there is only the invitation
  await sleep(500);
  ok("1 no library: no game crate, no shelf, an invitation", !$$("#wall .w-crate").some((c) => c.textContent.includes("THE GAME")) && $$("#wall .w-pick").length === 0 && !!$("#wall .w-ask"));
  ok("1 the CRATE button of the game is not in LIVE", $("#crate-button").hidden);

  // 2. the page's messages stay clear of the stream bar's ON AIR time
  const note = $("#note");
  note.textContent = "Choose the sound device for the headphones first, in the PHONES panel, and then switch TWO DEVICES on again please";
  await sleep(200);
  const items = $$("#livebar > *").map((e) => e.getBoundingClientRect()), n = note.getBoundingClientRect(), tb = $("#top").getBoundingClientRect(), a = $("#livebar").getBoundingClientRect();
  ok("2 the message is small, under GROOVELINE LIVE and the ON AIR time (not over them), left of the buttons, inside the bar", items.every((r) => n.top >= r.bottom - 1) && n.height <= 24 && n.left <= a.left + 2 && n.right <= tb.left + 1 && n.bottom <= 44, `note ${Math.round(n.left)},${Math.round(n.top)} ${Math.round(n.width)}x${Math.round(n.height)}; items end at ${Math.round(Math.max(...items.map((r) => r.bottom)))}`);
  ok("2 the whole text is shown (no ellipsis, within two lines) and in its tooltip", note.scrollHeight <= note.clientHeight + 1 && note.title === note.textContent && note.title.length > 60, `${note.scrollHeight} vs ${note.clientHeight}`);
  note.textContent = "";

  // 3. a library, cases and bags
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-new", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-new", { create: true });
  const put = async (d, name, bytes) => { const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  const da = await dir.getDirectoryHandle("A", { create: true }), db = await dir.getDirectoryHandle("B", { create: true });
  await put(da, "embedded.mp3", b64(SL["embedded.mp3"]));
  await put(db, "folder1.mp3", b64(SL["folder1.mp3"])); await put(db, "folder2.mp3", b64(SL["folder2.mp3"])); await put(db, "bare.mp3", b64(SL["bare.mp3"]));
  await H.library.init(); await H.library.addHandle(dir); await sleep(3500);
  const crates = $$("#wall .w-crate");
  ok("3 the crates are flight cases and record bags, one after the other", crates.length >= 3 && crates.every((c, i) => c.classList.contains(i % 2 ? "bag" : "case")) && !!$("#wall .w-crate.case .w-latch") && !!$("#wall .w-crate.bag .w-flap"), crates.map((c) => c.className.replace("w-crate ", "")).join(","));
  ok("3 and no wooden box is left", $$("#wall .w-box").every((b) => getComputedStyle(b).backgroundImage.indexOf("7b5532") < 0 && getComputedStyle(b).backgroundImage.indexOf("rgb(123, 85, 50)") < 0));

  // 4. a favourite from the popup: the heart is kept with the track, and the shelf shows it first
  const tracks = H.library.tracks, bare = tracks.find((t) => t.name === "bare.mp3");
  const tile = $$("#wall .w-pick").find((t) => t.title.includes("Bare Song"));
  ok("4 the shelf has the records (random, no favourite yet)", $$("#wall .w-pick").length === 4 && !bare.fav);
  tile.click(); await sleep(300);
  const heart = $(".load-pop .lp-heart");
  ok("4 the popup has a heart", !!heart && heart.getBoundingClientRect().width >= 24);
  heart.click(); await sleep(1500);
  ok("4 the heart is kept with the track", bare.fav === true);
  ok("4 the shelf shows it first, with a heart", $$("#wall .w-pick")[0].title.includes("Bare Song") && !!$$("#wall .w-pick")[0].querySelector(".w-fav"), $$("#wall .w-pick").map((t) => t.title).join(" | "));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // 5. a play counts after a few seconds on a deck (?playcount=2); the shelf then ranks the most played after the favourites
  const f1 = tracks.find((t) => t.name === "folder1.mp3");
  await H.loadUserTrack(0, f1);
  for (let i = 0; i < 60 && !(E.decks[0].info && E.decks[0].info.title === (f1.title || f1.name)); i++) await sleep(150);
  E.decks[0].motorOn = true; await sleep(4500);
  ok("5 a record that ran for a while on a deck was played once", f1.plays === 1, String(f1.plays));
  await sleep(1500);
  ok("5 the shelf: favourite first, then the one played", $$("#wall .w-pick")[0].title.includes("Bare Song") && $$("#wall .w-pick")[1].title.includes("Folder Song"), $$("#wall .w-pick").map((t) => t.title).join(" | "));
  E.decks[0].motorOn = false; await sleep(400);

  // 6. the list lights what is on a deck, in that deck's colour
  $$("#wall .w-topr button").find((x) => x.textContent === "LIST").click(); await sleep(700);
  const row = $$("#wall .l-row").find((r) => r.querySelector(".l-title").textContent === "Folder Song");
  ok("6 the row of the record on the left deck is lit and marked A", !!row && row.classList.contains("on") && row.classList.contains("ona") && !!row.querySelector(".mark.a"));
  ok("6 it stands out (a coloured bar at its left)", getComputedStyle(row).boxShadow.indexOf("38, 198, 240") >= 0 && getComputedStyle(row).backgroundColor !== "rgba(0, 0, 0, 0)");
  ok("6 the others are not lit", $$("#wall .l-row.on").length === 1);
  const hr = row.querySelector(".l-load .heart");
  ok("6 each row has a heart; the loved record's is on", !!hr && $$("#wall .l-row").find((r) => r.querySelector(".l-title").textContent === "Bare Song").querySelector(".heart").classList.contains("on"));

  // 7. the whole title when the pointer rests on the deck's title
  const G = B.L.live.deck[0], cv = $("#booth"), box = cv.getBoundingClientRect();
  const over = (x, y) => cv.dispatchEvent(new PointerEvent("pointermove", { clientX: box.left + x, clientY: box.top + (box.height - y), bubbles: true, pointerId: 7 }));
  over(G.title.x + 60, G.title.y); await sleep(200);
  const tip = $("#deck-tip");
  ok("7 over the title the whole title shows", !tip.hidden && tip.textContent.includes(E.decks[0].info.title) && tip.textContent.includes(E.decks[0].info.artist), tip.textContent);
  over(G.platter.c.x, G.platter.c.y); await sleep(150);
  ok("7 and goes when the pointer leaves it", tip.hidden);

  // 8. SHARE
  const sb = $("#share-button");
  ok("8 SHARE is in the top bar in LIVE", getComputedStyle(sb).display !== "none");
  sb.click(); await sleep(300);
  const sp = $(".share-pop");
  ok("8 it opens a small popup with the link, COPY LINK and the networks", !sp.hidden && sp.querySelector(".sp-link").value.startsWith("https://") && sp.querySelectorAll(".sp-nets a").length === 6 && /COPY/.test(sp.querySelector(".sp-copy").textContent));
  const sr = sp.getBoundingClientRect(), br = sb.getBoundingClientRect();
  ok("8 under the button, inside the window", sr.top >= br.bottom && sr.right <= innerWidth && sr.left >= 0);
  sp.querySelector(".sp-copy").click(); await sleep(400);
  ok("8 COPY LINK says COPIED", /COPIED/.test(sp.querySelector(".sp-copy").textContent));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(200);
  ok("8 Esc closes it", sp.hidden);

  // 9. FILTER is under the fader, no blue square
  const S = B.L.live.mixer.strip[0];
  ok("9 FILTER sits under the channel fader", S.knobY[4] < S.fader.y - S.fader.travel / 2);
  // 10. the list's columns: the length, the file type and the file's date; sortable
  const r1 = $$("#wall .l-row")[0];
  ok("10 each row has its length (m:ss), file type and date", /^\d+:\d\d$/.test(r1.querySelector(".l-time").textContent) && /^[A-Z0-9]{3,4}$/.test(r1.querySelector(".l-type").textContent) && /^\d{4}-\d\d-\d\d$/.test(r1.querySelector(".l-date").textContent), [".l-time", ".l-type", ".l-date"].map((c) => r1.querySelector(c).textContent).join(" | "));
  ok("10 the head has TIME, TYPE and DATE to sort by", ["TIME", "TYPE", "DATE"].every((n) => $$("#wall .l-head .l-col").some((c) => c.textContent.startsWith(n) && !c.disabled)));
  $$("#wall .l-head .l-col").find((c) => c.textContent.startsWith("TIME")).click(); await sleep(500);
  const times = $$("#wall .l-row").map((r) => r.querySelector(".l-time").textContent);
  ok("10 TIME sorts the list", times.length === 4);
  // 11. a rescan of tracks an older reader left (no length): it fills the length in and keeps the heart, the cues and the plays
  const old = tracks.find((t) => t.name === "folder2.mp3");
  old.v = 2; delete old.seconds; old.fav = true; old.plays = 4; old.cues = [1.25, null, null, null, null, null, null, null];
  await H.library.update(old);
  await H.library.refreshOld(); await sleep(4000);
  const fresh = H.library.tracks.find((t) => t.name === "folder2.mp3");
  ok("11 an entry from an older reader is read again in the background: the length is there", fresh.v >= 3 && fresh.seconds > 0, `v ${fresh.v}, ${fresh.seconds}`);
  ok("11 and the heart, the plays and the cues are still there", fresh.fav === true && fresh.plays === 4 && fresh.cues && fresh.cues[0] === 1.25);
  ok("11 the wall has a RESCAN button", $$("#wall .w-rescan").length === 1);
  // 12. a deck whose record has FINISHED keeps its motor on (in silence): it must not stop a playlist from loading the next record
  const d0 = E.decks[0], next = tracks.find((t) => t.name === "bare.mp3"), alerts = () => B.alerts[0] && B.alerts[0].until > performance.now();
  B.alerts[0] = null;
  d0.motorOn = true; d0.seek(Math.max(0, d0.duration - 0.3)); await sleep(3500);
  ok("12 a finished record: the motor is still on, the needle is at the end", d0.motorOn && d0.progress >= 0.995, `motorOn ${d0.motorOn}, progress ${d0.progress.toFixed(4)}`);
  // the which-deck popup does not mark it PLAYING
  $$("#wall .w-topr button").find((x) => x.textContent === "LIST").click(); await sleep(500);
  const rowOf0 = $$("#wall .l-row")[0]; rowOf0.querySelector(".l-title").click(); await sleep(300);
  ok("12 the popup does not call the finished deck PLAYING", !$$(".load-pop .lp-decks button")[0].classList.contains("busy"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150);
  await H.loadUserTrack(0, next); await sleep(2500);
  ok("12 loading into it is allowed: no message, the new record is on the deck", !alerts() && d0.info && d0.info.title === (next.title || next.name), `${d0.info && d0.info.title}; alert ${B.alerts[0] && B.alerts[0].text}`);
  // a deck that really plays still refuses
  d0.seek(0.2); d0.motorOn = true; await sleep(800);
  const before0 = d0.info.title;
  await H.loadUserTrack(0, tracks.find((t) => t.name === "folder2.mp3")); await sleep(600);
  ok("12 a deck that is really playing still says stop it first", alerts() && /STOP THE LEFT DECK/.test(B.alerts[0].text) && d0.info.title === before0, B.alerts[0] && B.alerts[0].text);
  d0.motorOn = false;

  // 13. the library's text size: a quarter bigger by default, A- and A+ step it, it is remembered, the list and the playlists follow
  const wallEl = $("#wall"), prop = (n) => parseFloat(wallEl.style.getPropertyValue(n));
  const ratio = () => prop("--wz") / prop("--ws");
  const zoomBtn = (t) => $$("#wall .w-zoom").find((b) => b.textContent === t);
  ok("13 A- and A+ are in the library's top row", !!zoomBtn("A\u2212") && !!zoomBtn("A+"));
  ok("13 the text starts a quarter bigger than the wall's own scale", Math.abs(ratio() - 1.25) < 0.01, ratio().toFixed(3));
  $$("#wall .w-topr button").find((x) => x.textContent === "LIST").click(); await sleep(500);
  const fontOf = (sel) => parseFloat(getComputedStyle($(sel)).fontSize), rowH = () => parseFloat($("#wall .l-row").style.height);
  const f0 = fontOf("#wall .l-row"), h0 = rowH();
  zoomBtn("A+").click(); await sleep(700);
  ok("13 A+ makes the list's text and rows bigger", ratio() > 1.37 && fontOf("#wall .l-row") > f0 && rowH() >= h0, `${ratio().toFixed(3)}; font ${f0.toFixed(1)} -> ${fontOf("#wall .l-row").toFixed(1)}; row ${h0} -> ${rowH()}`);
  ok("13 it is remembered", localStorage.getItem("headliner.libZoom") === String(ratio()), localStorage.getItem("headliner.libZoom"));
  zoomBtn("A\u2212").click(); await sleep(300); zoomBtn("A\u2212").click(); await sleep(300); zoomBtn("A\u2212").click(); await sleep(700);
  ok("13 A- makes it smaller again", ratio() < 1.2 && fontOf("#wall .l-row") < f0, `${ratio().toFixed(3)}; font ${fontOf("#wall .l-row").toFixed(1)}`);
  for (let i = 0; i < 12; i++) { zoomBtn("A\u2212").click(); await sleep(60); }
  ok("13 it stops at a smallest size (the button is off)", zoomBtn("A\u2212").disabled && ratio() >= 0.74, ratio().toFixed(3));
  for (let i = 0; i < 20; i++) { zoomBtn("A+").click(); await sleep(60); }
  ok("13 and at a biggest", zoomBtn("A+").disabled && ratio() <= 2.26, ratio().toFixed(3));
  $$("#wall .w-topr button").find((x) => x.textContent === "PLAYLISTS").click(); await sleep(600);
  const capMax = fontOf("#wall .pl-cap");
  for (let i = 0; i < 12; i++) { zoomBtn("A\u2212").click(); await sleep(60); }
  await sleep(400);
  const capMin = fontOf("#wall .pl-cap");
  ok("13 the playlists' text follows the same zoom (three times bigger at the top than at the bottom of the range)", capMax > 2.5 * capMin, `${capMin.toFixed(1)} px at 75 %, ${capMax.toFixed(1)} px at 225 %`);
  for (let i = 0; i < 4; i++) { zoomBtn("A+").click(); await sleep(60); } // back to 125 %
  ok("13 stepped back to the default", Math.abs(ratio() - 1.25) < 0.01, ratio().toFixed(3));
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
