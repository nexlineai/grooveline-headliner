const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const px = (canvas, x, y) => { const d = canvas.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]]; };
const near = (p, q, tol = 40) => p.every((v, i) => Math.abs(v - q[i]) <= tol);
const RED = [0xdd, 0x22, 0x22], BLUE = [0x22, 0x44, 0xdd];
(async () => {
  const H = window.headliner;
  for (let i = 0; i < 100 && !H.engine.context; i++) await sleep(100);
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-sl", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-sl", { create: true });
  const put = async (d, name, bytes) => { const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  const a = await dir.getDirectoryHandle("A Embedded", { create: true });
  const b = await dir.getDirectoryHandle("B Folder", { create: true });
  const c = await dir.getDirectoryHandle("C Bare", { create: true });
  await put(a, "embedded.mp3", b64(SL["embedded.mp3"]));
  await put(b, "folder1.mp3", b64(SL["folder1.mp3"]));
  await put(b, "folder2.mp3", b64(SL["folder2.mp3"]));
  await put(b, "Folder.JPG", b64(SL["blue.jpg"]));
  await put(c, "bare.mp3", b64(SL["bare.mp3"]));

  const lib = H.library, sleeves = H.sleeves;
  await lib.init();
  await lib.addHandle(dir);
  const by = (n) => lib.tracks.find((t) => t.name === n);
  ok("scan: 4 tracks", lib.tracks.length === 4, String(lib.tracks.length));
  ok("scan: the embedded cover is found in the tag", !!by("embedded.mp3")?.cover && by("embedded.mp3").cover.mime === "image/jpeg" && !by("embedded.mp3").art);
  ok("scan: the folder's Folder.JPG is found for both tracks beside it", JSON.stringify(by("folder1.mp3")?.art) === JSON.stringify(["B Folder", "Folder.JPG"]) && JSON.stringify(by("folder2.mp3")?.art) === JSON.stringify(["B Folder", "Folder.JPG"]));
  ok("scan: nothing for the bare one", !by("bare.mp3").cover && !by("bare.mp3").art);

  // The sleeves, straight from the module.
  const get = (t) => new Promise((res) => sleeves.request(t, res));
  const e = await get(by("embedded.mp3")), f1 = await get(by("folder1.mp3")), f2 = await get(by("folder2.mp3")), n = await get(by("bare.mp3"));
  ok("embedded cover decodes to a 160 px square canvas, red in the middle", e instanceof HTMLCanvasElement && e.width === 160 && e.height === 160 && near(px(e, 80, 80), RED), JSON.stringify(e instanceof HTMLCanvasElement ? px(e, 80, 80) : e));
  ok("folder picture decodes, blue in the middle", f1 instanceof HTMLCanvasElement && near(px(f1, 80, 80), BLUE), JSON.stringify(f1 instanceof HTMLCanvasElement ? px(f1, 80, 80) : f1));
  ok("the two tracks of the folder share one decoded picture", f1 === f2);
  ok("a track with no picture says none", n === "none");

  // The crate: MY MUSIC, sleeves view.
  H.showCrateTab("mine");
  await sleep(2500);
  const tiles = [...document.querySelectorAll("#mymusic .mm-sleeve")];
  ok("sleeves view is the default, 4 sleeves", tiles.length === 4 && document.querySelector("#mymusic .mm-list").classList.contains("sleeves"), String(tiles.length));
  const tileOf = (title) => tiles.find((x) => x.querySelector("b").textContent === title)?.querySelector("canvas");
  ok("the embedded sleeve shows its red cover", near(px(tileOf("Embedded Song"), 80, 80), RED), JSON.stringify(px(tileOf("Embedded Song"), 80, 80)));
  ok("the folder sleeves show the blue picture", near(px(tileOf("Folder Song"), 80, 80), BLUE) && near(px(tileOf("Folder Song Two"), 80, 80), BLUE));
  const gen = px(tileOf("Bare Song"), 80, 80);
  ok("the bare one is a made sleeve (neither red nor blue)", !near(gen, RED, 30) && !near(gen, BLUE, 30), JSON.stringify(gen));
  // tap opens LEFT / RIGHT on the cover
  const card = tiles[0];
  card.click();
  ok("a tap opens LEFT and RIGHT", card.classList.contains("open") && card.querySelectorAll(".mm-pick button").length === 2);
  tiles[1].click();
  ok("another tap closes the first", !card.classList.contains("open") && tiles[1].classList.contains("open"));
  // list view
  [...document.querySelectorAll("#mymusic .mm-bar button")].find((x) => x.textContent === "LIST").click();
  await sleep(1500);
  const rows = [...document.querySelectorAll("#mymusic .record")];
  ok("list view: 4 rows each with a small cover", rows.length === 4 && rows.every((r) => r.querySelector("canvas.mm-art")), String(rows.length));
  ok("list view: the cover is the real one", near(px(rows.find((r) => r.textContent.includes("Embedded Song")).querySelector("canvas"), 44, 44), RED));
  ok("the choice is remembered", localStorage.getItem("headliner.myMusicView") === "list");
  [...document.querySelectorAll("#mymusic .mm-bar button")].find((x) => x.textContent === "SLEEVES").click();

  // On the record's label.
  const B = H.booth;
  for (let i = 0; i < 100 && !B.L; i++) await sleep(100);
  const before = B.liveRenderer.platter[0];
  await H.loadUserTrack(0, by("embedded.mp3"));
  await sleep(3500);
  const lr = B.L.r * 0.34, img = B.liveRenderer.platter[0], sc = B.dpr, mid = img.width / 2;
  ok("a record with a cover: the label shows it (red right of the centre), still turning with the platter", img !== before && near(px(img, mid + lr * 0.5 * sc, mid), RED, 45), JSON.stringify(px(img, mid + lr * 0.5 * sc, mid)));
  ok("the rim of the label keeps the deck's colour (teal)", near(px(img, mid + lr * 0.95 * sc, mid), [38, 198, 240], 70), JSON.stringify(px(img, mid + lr * 0.95 * sc, mid)));
  await H.loadUserTrack(0, by("bare.mp3"));
  await sleep(3500);
  const img2 = B.liveRenderer.platter[0];
  ok("a record with no cover: the plain label again", !near(px(img2, mid + lr * 0.5 * sc, mid), RED, 60), JSON.stringify(px(img2, mid + lr * 0.5 * sc, mid)));
  await H.loadUserTrack(0, by("embedded.mp3")); await sleep(3000);
  ok("back to the cover", near(px(B.liveRenderer.platter[0], mid + lr * 0.5 * sc, mid), RED, 45));
  const lastId = B.decks[0].info.id;
  B.decks[0].loadMade({ id: "made", title: "m", artist: "", label: "", genre: "", bpm: 120, key: "", camelot: "8A", bars: 8, seconds: 1, file: "" }, new Float32Array(4800), new Float32Array(4800), 48000);
  await sleep(2500);
  ok("any other record on the deck (made, game, lesson): the cover goes without anyone clearing it", B.decks[0].info.id !== lastId && !near(px(B.liveRenderer.platter[0], mid + lr * 0.5 * sc, mid), RED, 60));
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
