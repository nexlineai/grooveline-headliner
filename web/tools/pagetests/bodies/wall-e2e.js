const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(2) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true, cancelable: true }));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 100 && !(B.L && E.context); i++) await sleep(100);
  const wall = document.getElementById("wall");
  // 1. free play: the wall is up, the right height, the room's clips rest
  for (let i = 0; i < 40 && wall.hidden; i++) await sleep(250);
  ok("1 free play: the wall is shown", !wall.hidden);
  const lib = B.L.live.library, wr = wall.getBoundingClientRect();
  ok("1 the wall sits exactly where LIVE's geometry puts the library", Math.abs(wr.left - lib.x) <= 1.5 && Math.abs(wr.width - lib.w) <= 1.5 && Math.abs(wr.height - lib.h) <= 1.5 && Math.abs(wr.top - (B.L.H - lib.y - lib.h)) <= 1.5, JSON.stringify([wr.left, wr.top, wr.width, wr.height]) + " vs " + JSON.stringify(lib));
  const sp = document.getElementById("stream").getBoundingClientRect(), gs = B.L.live.streamPanel;
  ok("1 the stream panel sits where the geometry puts it", !document.getElementById("stream").hidden && Math.abs(sp.left - gs.x) <= 1.5 && Math.abs(sp.height - gs.h) <= 1.5);
  ok("1 the wall is under the gear row", wr.top >= B.L.H - B.L.live.gear.y - 1);

  // 2. no library yet: no game records in LIVE, just an invitation
  const crates = () => [...document.querySelectorAll("#wall .w-crate")];
  ok("2 LIVE has no game records: no THE GAME crate", !crates().some((c) => c.textContent.includes("THE GAME")), crates().map((c) => c.textContent).join(" | "));
  ok("2 no library: an invitation to open a folder", !!document.querySelector("#wall .w-ask"));
  ok("2 and nothing on the shelf", document.querySelectorAll("#wall .w-pick").length === 0);

  // 3. a library (real folder handles, as before)
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-wall", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-wall", { create: true });
  const put = async (d, name, bytes) => { const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  const a = await dir.getDirectoryHandle("A", { create: true }), b = await dir.getDirectoryHandle("B", { create: true });
  await put(a, "embedded.mp3", b64(SL["embedded.mp3"]));
  await put(b, "folder1.mp3", b64(SL["folder1.mp3"]));
  await put(b, "folder2.mp3", b64(SL["folder2.mp3"]));
  await put(b, "bare.mp3", b64(SL["bare.mp3"]));
  await H.library.init();
  await H.library.addHandle(dir);
  await sleep(3500);
  const real = crates().filter((c) => !c.classList.contains("w-ask"));
  const askAfter = document.querySelector("#wall .w-ask");
  ok("3 the library shows in the crates (A-Z)", real.length >= 2, real.map((c) => c.querySelector("b").textContent + " " + c.querySelector("i").textContent).join(" | "));
  // The dashed crate does not go away with the first folder any more: it becomes the way to ADD another one (Zé, 21 Nov).
  ok("3 the dashed crate stays, now offering to ADD another folder", !!askAfter && /ADD A FOLDER/.test(askAfter.textContent), askAfter ? askAfter.textContent.trim() : "none");
  const mine = real.filter((c) => !c.textContent.includes("THE GAME"));
  ok("3 all 4 of your records are in the crates", mine.reduce((n, c) => n + Number(c.querySelector("i").textContent.replace(/,/g, "")), 0) === 4);

  // 4. dig into a crate
  const cross0 = B.cross;
  mine[0].click();
  await sleep(600);
  const dig = document.querySelector("#wall .w-dig");
  ok("4 a crate opens", !dig.hidden && document.querySelectorAll("#wall .d-rec").length >= 1);
  const title = () => document.querySelector("#wall .d-info h3")?.textContent;
  const first = title();
  const total = Number(document.querySelector("#wall .d-scrub").max) + 1;
  if (total > 1) {
    key("ArrowRight"); await sleep(300);
    ok("4 → flips to the next record", title() !== first, `${first} -> ${title()}`);
    ok("4 → does not move the crossfader while a crate is open", B.cross === cross0, `${cross0} -> ${B.cross}`);
    key("ArrowLeft"); await sleep(300);
    ok("4 ← flips back", title() === first);
    document.querySelector("#wall .d-stage").dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    await sleep(300);
    ok("4 the wheel flips two", document.querySelector("#wall .d-pos").textContent.startsWith(String(Math.min(total, 3)) + " /") || total < 3, document.querySelector("#wall .d-pos").textContent);
    const s = document.querySelector("#wall .d-scrub"); s.value = String(total - 1); s.dispatchEvent(new Event("input")); await sleep(300);
    ok("4 the scrub bar jumps to the end", document.querySelector("#wall .d-pos").textContent.startsWith(String(total) + " /"));
    key("Home"); await sleep(200);
    ok("4 Home goes to the first", document.querySelector("#wall .d-pos").textContent.startsWith("1 /"));
  }
  // 5. choose
  document.querySelector("#wall .d-info .w-decks .left").click();
  const want = title();
  for (let i = 0; i < 80 && E.decks[0].info?.title !== want; i++) await sleep(250);
  ok("5 LEFT puts the front record on the left deck", E.decks[0].isLoaded && E.decks[0].info.title === want, `${E.decks[0].info?.title} vs ${want}`);
  await sleep(300);
  ok("5 the info says it is on the left deck", document.querySelector("#wall .d-on")?.textContent.includes("LEFT"));
  // 6. close with Esc; the arrows are the crossfader again
  key("Escape"); await sleep(300);
  ok("6 Esc closes the crate", dig.hidden);
  key("ArrowRight"); await sleep(200);
  ok("6 the arrows move the crossfader again", B.cross !== cross0, `${cross0} -> ${B.cross}`);

  // 6b. a click on the empty stage closes the crate too (Esc leaves fullscreen); a click on a record does not
  crates().filter((c) => !c.textContent.includes("THE GAME"))[0].click(); await sleep(500);
  ok("6b the crate opens again", !dig.hidden);
  document.querySelector("#wall .d-rec.front").click(); await sleep(200);
  ok("6b a click on the front record leaves it open", !dig.hidden);
  document.querySelector("#wall .d-stage").click(); await sleep(300);
  ok("6b a click on the empty stage closes it", dig.hidden);

  // 7. the game's booth (a lesson or a night) has no wall and no stream panel; back to LIVE they return
  B.setMode("game"); await sleep(7000);
  ok("7 free play: the wall is up in front of the room, no stream panel, the game's layout (the game's own records come with the real FREE PLAY start: free-e2e)", !wall.hidden && document.getElementById("stream").hidden && B.L.live === null);
  B.setMode("live"); await sleep(3000);
  ok("7 back in LIVE: the wall and the stream panel are back", !wall.hidden && !document.getElementById("stream").hidden && !!B.L.live);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
