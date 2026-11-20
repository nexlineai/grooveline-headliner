const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
(async () => {
  const H = window.headliner, B = H.booth, E = H.engine;
  for (let i = 0; i < 150 && !(B.L && B.L.live && E.decks[0].isLoaded && E.decks[1].isLoaded); i++) await sleep(100);
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("music-look", { recursive: true }); } catch {}
  const dir = await root.getDirectoryHandle("music-look", { create: true });
  const put = async (d, name, bytes) => { const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(bytes); await w.close(); };
  const a = await dir.getDirectoryHandle("A", { create: true }), b = await dir.getDirectoryHandle("B", { create: true });
  await put(a, "embedded.mp3", b64(SL["embedded.mp3"]));
  await put(b, "folder1.mp3", b64(SL["folder1.mp3"])); await put(b, "folder2.mp3", b64(SL["folder2.mp3"])); await put(b, "bare.mp3", b64(SL["bare.mp3"]));
  await H.library.init(); await H.library.addHandle(dir); await sleep(3500);
  const mode = new URLSearchParams(location.search).get("view");
  const t = H.library.tracks.find((x) => x.name === "folder1.mp3");
  if (mode === "list") {
    [...document.querySelectorAll("#wall .w-topr button")].find((x) => x.textContent === "LIST").click();
    await H.loadUserTrack(0, t); await sleep(2500);
    t.fav = true; await sleep(300);
  } else if (mode === "share") {
    document.getElementById("share-button").click();
  }
  await sleep(900);
  console.log("LOOK3", mode, document.querySelectorAll("#wall .w-crate").length);
})().catch((e) => console.log("ERR", e && e.stack || e));
