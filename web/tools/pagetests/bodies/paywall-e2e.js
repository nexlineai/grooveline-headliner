// The paywall seen from the page (run by paywall-e2e.sh against the Worker with the gate ON and no sign-in):
// a STRANGER plays chapters 1-2 and every file the game asks for must be served. ?pw=play (a lesson or night
// opened by the URL, the bot plays it), ?pw=stories (every story step of chapters 1-2, a click skips a line),
// ?pw=tracks (the records free players are offered), ?pw=control (a night of chapter 3: the gate must show).
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(3) : x).join(" "));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mode = new URLSearchParams(location.search).get("pw") || "play";
  const H = window.headliner;
  const failedMedia = [];
  window.addEventListener("error", (e) => { const s = e.target && e.target.src; if (s && s.includes("/headliner/assets/")) failedMedia.push(new URL(s).pathname); }, true);
  const assets = () => performance.getEntriesByType("resource").filter((e) => e.name.includes("/headliner/assets/")).map((e) => ({ path: new URL(e.name).pathname, status: e.responseStatus }));
  const refused = () => [...new Set(assets().filter((a) => a.status === 403).map((a) => a.path))];

  if (mode === "play") {
    await sleep(Number(new URLSearchParams(location.search).get("for") || 60) * 1000);
  } else if (mode === "control") {
    await sleep(25000);
  } else if (mode === "stories") {
    const career = await (await fetch("content/career.json")).json();
    const story = document.getElementById("story");
    for (const c of career.chapters.filter((x) => x.number <= 2)) {
      for (let i = 0; i < c.steps.length; i++) {
        if (c.steps[i].kind !== "story") continue;
        H.play(c.number, i);
        const until = Date.now() + 45000;
        let shown = false;
        while (Date.now() < until) {
          await sleep(1500);
          if (!story.hidden) { shown = true; story.click(); } else if (shown) break;
        }
        T("story", c.number, c.steps[i].id, shown ? "played" : "NOT SHOWN");
      }
    }
  } else if (mode === "tracks") {
    const rows = await (await fetch("assets/Tracks/tracks.json")).json();
    let free = 0, paid = 0;
    for (const t of rows) {
      const res = await fetch(`assets/Tracks/${t.file}`, { headers: { Range: "bytes=0-9" } });
      if ((t.chapter ?? 1) <= 2) { ok(`free record ${t.id} is served`, res.status === 206 || res.status === 200, res.status); free++; }
      else { if (res.status !== 403) ok(`paid record ${t.id} is refused`, false, res.status); paid++; }
    }
    ok("the paid records are all refused", rows.filter((t) => (t.chapter ?? 1) > 2).every(() => true) && paid > 40, `${paid} paid, ${free} free`);
  }

  const seen = assets();
  const blocked = refused();
  if (mode === "control") {
    ok("control: a chapter 3 night is refused media (the gate and this test's eyes both work)", blocked.length > 0, `${blocked.length} refused, e.g. ${blocked[0] || "-"}`);
  } else {
    ok(`${mode}: no file of chapters 1-2 was refused`, blocked.length === 0, blocked.slice(0, 8).join(" "));
    ok(`${mode}: no media failed to load`, failedMedia.length === 0, failedMedia.slice(0, 5).join(" "));
    if (mode !== "tracks") ok(`${mode}: the game really asked for media`, seen.filter((a) => a.status >= 200 && a.status < 400).length >= 3, `${seen.length} requests`);
  }
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
