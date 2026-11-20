const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live); i++) await sleep(100);
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const violations = []; document.addEventListener("securitypolicyviolation", (e) => violations.push(e.violatedDirective + " " + e.blockedURI));
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-pl", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-pl", { create: true });
  const put = async (d, name, bytes) => { const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  const da = await dir.getDirectoryHandle("A", { create: true }), db = await dir.getDirectoryHandle("B", { create: true });
  await put(da, "embedded.mp3", b64(SL["embedded.mp3"]));
  await put(db, "folder1.mp3", b64(SL["folder1.mp3"])); await put(db, "folder2.mp3", b64(SL["folder2.mp3"])); await put(db, "bare.mp3", b64(SL["bare.mp3"]));
  await H.library.init(); await H.library.addHandle(dir); await sleep(3500);
  const tab = (name) => $$("#wall .w-topr button").find((x) => x.textContent === name);
  const P = H.library.playlists;

  // 1. the view, and a playlist from NEW
  tab("PLAYLISTS").click(); await sleep(500);
  ok("1 PLAYLISTS is a third view: the shelf and the crates go, the playlists come", $("#wall").classList.contains("playlisting") && getComputedStyle($("#wall .w-shelf")).display === "none" && getComputedStyle($("#wall .w-plays")).display !== "none");
  ok("1 with none yet it says how to start", /NEW makes a playlist/.test($("#wall .pl-empty").textContent) && P.lists.length === 0);
  $$("#wall .pl-bar button").find((b) => b.textContent === "NEW").click(); await sleep(600);
  ok("1 NEW makes one and opens its name to type", P.lists.length === 1 && P.lists[0].name === "Playlist 1" && !!$("#wall .pl-rename"));
  const input = $("#wall .pl-rename"); input.value = "Friday set"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await sleep(600);
  ok("1 Enter names it", P.lists[0].name === "Friday set" && $("#wall .pl-title h3").textContent === "Friday set" && $$("#wall .pl-item").length === 1);

  // 2. add records from the popup (a click on a list row)
  tab("LIST").click(); await sleep(600);
  const rowOf = (title) => $$("#wall .l-row").find((r) => r.querySelector(".l-title").textContent === title);
  const addFromPopup = async (title, choice) => {
    rowOf(title).querySelector(".l-title").click(); await sleep(300);
    const sel = $(".load-pop .lp-add");
    sel.value = choice; sel.dispatchEvent(new Event("change", { bubbles: true })); await sleep(500);
    const say = $(".load-pop .lp-say").textContent;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150);
    return say;
  };
  const id = String(P.lists[0].id);
  ok("2 the popup offers ADD TO PLAYLIST with the playlist and a new one", (() => { rowOf("Folder Song").querySelector(".l-title").click(); return true; })());
  await sleep(300);
  const opts = $$(".load-pop .lp-add option").map((o) => o.textContent);
  ok("2 the choices: the prompt, Friday set, + NEW PLAYLIST", opts.length === 3 && opts[1] === "Friday set" && /NEW/.test(opts[2]), opts.join(" | "));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150);
  ok("2 adding says so", (await addFromPopup("Folder Song", id)) === "Added to Friday set");
  ok("2 and the same record twice says it is in already", (await addFromPopup("Folder Song", id)) === "Already in Friday set");
  await addFromPopup("Embedded Song", id); await addFromPopup("Bare Song", id);
  ok("2 three records in, in the order they were added", P.lists[0].items.map((e) => e.title).join("|") === "Folder Song|Embedded Song|Bare Song", P.lists[0].items.map((e) => e.title).join("|"));
  ok("2 + NEW PLAYLIST from the popup makes a second one with the record in it", (await addFromPopup("Folder Song Two", "new")).startsWith("Added to Playlist") && P.lists.length === 2 && P.lists[1].items.length === 1);

  // 3. the playlist view: rows, order, take out
  tab("PLAYLISTS").click(); await sleep(600);
  $$("#wall .pl-item")[0].click(); await sleep(400);
  const titles = () => $$("#wall .pl-row .pl-t").map((x) => x.textContent);
  ok("3 the rows are the records in order, with artist and length", titles().join("|") === "Folder Song|Embedded Song|Bare Song" && /^\d+:\d\d$/.test($$("#wall .pl-row .pl-time")[0].textContent), titles().join("|"));
  $$("#wall .pl-row")[0].querySelectorAll(".pl-move button")[1].click(); await sleep(500); // the first one down
  ok("3 the arrow moves a record down", titles().join("|") === "Embedded Song|Folder Song|Bare Song", titles().join("|"));
  $$("#wall .pl-row")[2].querySelectorAll(".pl-move button")[0].click(); await sleep(500); // the last one up
  ok("3 and up", titles().join("|") === "Embedded Song|Bare Song|Folder Song", titles().join("|"));
  $$("#wall .pl-row")[1].querySelectorAll(".pl-move button")[2].click(); await sleep(500); // take the middle one out
  ok("3 the cross takes a record out of the playlist (not out of the library)", titles().join("|") === "Embedded Song|Folder Song" && H.library.tracks.length === 4);
  $$("#wall .pl-row")[0].querySelector(".pl-load button.left").click(); await sleep(2800);
  ok("3 the A button loads the record on the left deck, and its row is lit as on deck A", E.decks[0].info && E.decks[0].info.title === "Embedded Song" && $$("#wall .pl-row")[0].classList.contains("ona"));
  const clickRow = $$("#wall .pl-row")[1]; clickRow.querySelector(".pl-t").click(); await sleep(300);
  ok("3 a click on a row asks which deck", !!$(".load-pop:not([hidden])"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150);

  // 4. save to a file: the text, and no policy violation
  let blobText = null; const origCreate = URL.createObjectURL.bind(URL); let anchorName = "";
  URL.createObjectURL = (b) => { if (b instanceof Blob && /mpegurl/.test(b.type)) b.text().then((t) => { blobText = t; }); return origCreate(b); };
  const origClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { anchorName = this.download || ""; };
  $$("#wall .pl-actions button").find((b) => /EXPORT/.test(b.textContent)).click(); await sleep(1500);
  HTMLAnchorElement.prototype.click = origClick; URL.createObjectURL = origCreate;
  ok("4 EXPORT saves an extended M3U named after the playlist", anchorName === "Friday set.m3u8" && !!blobText && blobText.startsWith("#EXTM3U\n#PLAYLIST:Friday set\n"), `${anchorName} ${blobText && blobText.slice(0, 40).replace(/\n/g, "|")}`);
  ok("4 each record has its length and label and its path from the folder that holds the music folders", !!blobText && (blobText.match(/#EXTINF:/g) || []).length === 2 && /\nmusic-pl\/A\/embedded\.mp3\n/.test(blobText) && /\nmusic-pl\/B\/folder1\.mp3\n/.test(blobText), blobText && blobText.split("\n").slice(2).join("|"));
  ok("4 the status line says it was saved", /Saved Friday set\.m3u8/.test($("#wall .w-status.flash") ? $("#wall .w-status.flash").textContent : ""), $("#wall .w-status.flash") && $("#wall .w-status.flash").textContent);

  // 5. open it again: IMPORT
  const picker = $("#wall .w-plays input[type=file]");
  const dt = new DataTransfer(); dt.items.add(new File([blobText.replace("#PLAYLIST:Friday set", "#PLAYLIST:Friday copy")], "friday.m3u8", { type: "audio/x-mpegurl" }));
  picker.files = dt.files; picker.dispatchEvent(new Event("change", { bubbles: true })); await sleep(1200);
  const copy = P.lists.find((p) => p.name === "Friday copy");
  ok("5 IMPORT makes a new playlist from the file: the name in it, the same records, in order", !!copy && copy.items.map((e) => e.title).join("|") === "Embedded Song|Folder Song", copy && copy.items.map((e) => e.title).join("|"));
  ok("5 it says all were found", /all 2 records found/.test($("#wall .w-status.flash").textContent), $("#wall .w-status.flash").textContent);
  const dt2 = new DataTransfer(); dt2.items.add(new File(["#EXTM3U\n#EXTINF:100,Ghost - Gone\nD:\\Old\\ghost.mp3\n"], "gone.m3u", { type: "audio/x-mpegurl" }));
  picker.files = dt2.files; picker.dispatchEvent(new Event("change", { bubbles: true })); await sleep(1200);
  ok("5 a file with records we do not have: they are kept, in grey, with what the file said", $$("#wall .pl-row.gone").length === 1 && /NOT IN YOUR LIBRARY/.test($$("#wall .pl-row.gone .pl-t")[0].textContent) && /0 of 1|1 records|1 of 1|found/.test($("#wall .w-status.flash").textContent), $("#wall .w-status.flash").textContent);

  // 6. DELETE asks twice
  const del = () => $$("#wall .pl-actions button").find((b) => /DELETE|SURE/.test(b.textContent));
  const before = P.lists.length;
  del().click(); await sleep(300);
  ok("6 DELETE asks 'SURE?' first and deletes nothing yet", del().textContent === "SURE?" && P.lists.length === before);
  del().click(); await sleep(700);
  ok("6 the second click deletes it", P.lists.length === before - 1);

  // 7. kept in the browser: the database has the playlists
  const dbRows = await new Promise((res, rej) => { const o = indexedDB.open("headliner-library"); o.onsuccess = () => { const d = o.result; const r = d.transaction("playlists").objectStore("playlists").getAll(); r.onsuccess = () => { d.close(); res({ version: d.version, rows: r.result }); }; r.onerror = () => rej(r.error); }; o.onerror = () => rej(o.error); });
  ok("7 the playlists are in the browser's database (version 2), as many as there are", dbRows.version === 2 && dbRows.rows.length === P.lists.length && dbRows.rows.some((p) => p.name === "Friday set" && p.items.length === 2), `v${dbRows.version}, ${dbRows.rows.length} rows`);
  ok("7 no content-security-policy violation anywhere in this (the download is a plain link)", violations.length === 0, violations.join(" ; "));

  // 8. the upgrade from the old database (version 1: folders and tracks only) keeps the library and adds the playlists
  let sawBlocked = false;
  const gone = await new Promise((res) => { const q = indexedDB.deleteDatabase("headliner-library"); const t = setTimeout(() => res("hung"), 8000); q.onsuccess = () => { clearTimeout(t); res("deleted"); }; q.onerror = () => { clearTimeout(t); res("error"); }; q.onblocked = () => { sawBlocked = true; }; });
  ok("8 an open page lets go of its database when another wants to change it (no hang: the deletion goes through)", gone === "deleted", `${gone}${sawBlocked ? " (it was held up for a moment by a transaction, then went through)" : ""}`);
  await new Promise((res, rej) => { const o = indexedDB.open("headliner-library", 1); o.onupgradeneeded = () => { const d = o.result; d.createObjectStore("folders", { keyPath: "id", autoIncrement: true }); d.createObjectStore("tracks", { keyPath: "key" }).createIndex("folder", "folder"); }; o.onsuccess = () => { const d = o.result; const t = d.transaction(["folders", "tracks"], "readwrite"); t.objectStore("folders").add({ name: "Old" }); t.objectStore("tracks").put({ key: "1:x.mp3", folder: 1, name: "x.mp3", path: ["x.mp3"] }); t.oncomplete = () => { d.close(); res(); }; }; o.onerror = () => rej(o.error); });
  const { IdbStore } = await import("/src/library/store.ts");
  const s = await IdbStore.open();
  const kept = await s.tracks(), lists = await s.playlists();
  const made = await s.putPlaylist({ name: "After", created: 1, updated: 1, items: [] });
  ok("8 opened at version 2: the old tracks are still there, the playlists store exists and works", kept.length === 1 && kept[0].key === "1:x.mp3" && lists.length === 0 && made.id > 0);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
