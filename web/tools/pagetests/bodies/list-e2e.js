const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(2) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live && E.context && E.decks[0].isLoaded); i++) await sleep(100);
  const wall = document.getElementById("wall");
  for (let i = 0; i < 40 && wall.hidden; i++) await sleep(250);
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-list", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-list", { create: true });
  const put = async (d, name, bytes) => { const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  const a = await dir.getDirectoryHandle("A", { create: true }), b = await dir.getDirectoryHandle("B", { create: true });
  await put(a, "embedded.mp3", b64(SL["embedded.mp3"]));
  await put(b, "folder1.mp3", b64(SL["folder1.mp3"])); await put(b, "folder2.mp3", b64(SL["folder2.mp3"])); await put(b, "bare.mp3", b64(SL["bare.mp3"]));
  await H.library.init(); await H.library.addHandle(dir);
  await sleep(3500);
  const $ = (s) => document.querySelector(s);
  const rows = () => [...document.querySelectorAll("#wall .l-row")];
  const titles = () => rows().map((r) => r.querySelector(".l-title").textContent);
  const click = (txt, scope = "#wall .w-topr button") => [...document.querySelectorAll(scope)].find((x) => x.textContent === txt).click();

  // 1. the two views
  ok("1 the wall is the first view; there is a search box and WALL | LIST", !wall.classList.contains("listing") && !!$("#wall .w-search") && !!$("#wall .w-topr"));
  click("LIST"); await sleep(600);
  ok("1 LIST: the shelf and the crates go, the list comes, no covers in it", wall.classList.contains("listing") && getComputedStyle($("#wall .w-shelf")).display === "none" && getComputedStyle($("#wall .w-list")).display !== "none" && !$("#wall .l-row canvas"));
  ok("1 all 4 records are listed, with their tempo/key columns", rows().length === 4 && $("#wall .l-count").textContent.includes("4 records"), titles().join(" | "));
  ok("1 the choice is remembered", localStorage.getItem("headliner.libView") === "list");

  // 2. search
  const search = $("#wall .w-search");
  search.value = "folder"; search.dispatchEvent(new Event("input")); await sleep(400);
  ok("2 a search keeps only what matches", titles().length === 2 && titles().every((t) => /Folder/.test(t)), titles().join(" | "));
  ok("2 and says how many", $("#wall .l-count").textContent.includes("2 of 4"));
  search.value = "nothing like this"; search.dispatchEvent(new Event("input")); await sleep(300);
  ok("2 no match: an empty list and a message", rows().length === 0 && /Nothing matches/.test($("#wall .l-count").textContent));
  search.value = ""; search.dispatchEvent(new Event("input")); await sleep(300);
  ok("2 an empty search brings everything back", rows().length === 4);
  click("WALL"); await sleep(500);
  ok("2 back on the wall", !wall.classList.contains("listing") && getComputedStyle($("#wall .w-shelf")).display !== "none", `class "${wall.className}", shelf ${getComputedStyle($("#wall .w-shelf")).display}, buttons ${[...document.querySelectorAll("#wall .w-topr button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join(",")}`);
  search.value = "bare"; search.dispatchEvent(new Event("input")); await sleep(500);
  ok("2 typing a search on the wall shows the answer as a list", wall.classList.contains("listing") && titles().length === 1 && titles()[0] === "Bare Song", titles().join("|"));
  search.value = ""; search.dispatchEvent(new Event("input")); await sleep(300);

  // 3. sorting
  const col = (name) => [...document.querySelectorAll("#wall .l-col")].find((c) => c.textContent.startsWith(name));
  col("TITLE").click(); await sleep(300);
  const asc = titles();
  ok("3 TITLE sorts A to Z", JSON.stringify(asc) === JSON.stringify(asc.slice().sort((x, y) => x.localeCompare(y))), asc.join(" | "));
  col("TITLE").click(); await sleep(300);
  ok("3 a second click reverses it", JSON.stringify(titles()) === JSON.stringify(asc.slice().reverse()));
  ok("3 the sort is remembered", JSON.parse(localStorage.getItem("headliner.listSort")).by === "title");
  col("ARTIST").click(); await sleep(300);

  // 4. load from a row
  E.decks[0].motorOn = false; E.decks[1].motorOn = false; await sleep(800);
  const target = rows().find((r) => r.querySelector(".l-title").textContent === "Embedded Song");
  target.querySelector(".l-load button.left").click();
  for (let i = 0; i < 80 && E.decks[0].info?.title !== "Embedded Song"; i++) await sleep(250);
  ok("4 the A button puts that record on deck A", E.decks[0].info?.title === "Embedded Song");
  await sleep(1200);
  const mark = rows().find((r) => r.querySelector(".l-title").textContent === "Embedded Song")?.querySelector(".mark.a");
  ok("4 the line shows it is on deck A", !!mark, mark ? "" : rows().map((r) => r.className).join(","));

  // 5. a big library: only the lines in view exist, all of them can be reached
  const lib = H.library;
  const fake = (i) => ({ key: `9:${i}`, folder: 9, path: [`t${i}.mp3`], name: `t${i}.mp3`, ext: "mp3", size: 1, mtime: 1, title: `Track ${String(i).padStart(5, "0")}`, artist: `Artist ${String(i % 700).padStart(3, "0")}`, album: "", genre: i % 3 ? "House" : "", tagBpm: 100 + (i % 60), musicKey: "", camelot: `${1 + (i % 12)}${i % 2 ? "A" : "B"}` });
  for (let i = 0; i < 9000; i++) lib.byKey.set(`9:${i}`, fake(i));
  const t0 = performance.now(); lib.reindex(); lib.notify(); await sleep(2500);
  const total = Number($("#wall .l-count").textContent.replace(/[^0-9]/g, ""));
  ok("5 9,000+ records listed", total >= 9000, $("#wall .l-count").textContent);
  ok("5 only a few dozen lines exist as elements", rows().length > 5 && rows().length < 80, String(rows().length));
  const sc = $("#wall .l-scroll"), rowH = rows()[0].offsetHeight;
  ok("5 the scroll height covers every record", Math.abs($("#wall .l-spacer").offsetHeight - total * rowH) < total, `${$("#wall .l-spacer").offsetHeight} vs ${total * rowH}`);
  const before = titles()[0]; sc.scrollTop = rowH * 4000; await sleep(3000);
  ok("5 scrolling to the middle shows other records", rows().length > 5 && titles()[0] !== before, `${before} -> ${titles()[0]}`);
  sc.scrollTop = sc.scrollHeight; await sleep(2500);
  ok("5 the end of the list can be reached", rows().length > 5);
  search.value = "track 07777"; search.dispatchEvent(new Event("input")); await sleep(800);
  ok("5 a search finds one record among 9,000", titles().length === 1 && titles()[0] === "Track 07777", titles().join("|"));
  search.value = "artist 123 house"; search.dispatchEvent(new Event("input")); await sleep(800);
  ok("5 several words narrow it down", titles().length > 0 && titles().length < 20, String(titles().length));
  col("BPM").click(); await sleep(500);
  const bpms = rows().map((r) => Number(r.querySelector(".l-num").textContent));
  ok("5 BPM sorts slow to fast", bpms.every((v, i) => i === 0 || v >= bpms[i - 1]), bpms.slice(0, 8).join(","));
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
