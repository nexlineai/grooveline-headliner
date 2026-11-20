// The SOUND CHECK in the stream panel, driven like a person: the real button, the real booth master, a fake sign-in token and a stand-in /check/mount answer.
// The publish goes to a real MediaMTX on this machine (stream-local.sh), which an ffmpeg reads back afterwards.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const $ = (id) => document.getElementById(id);
const KEY = "vcheck-0123456789abcdef0123";
const b64 = (o) => btoa(JSON.stringify(o)); // as the Worker makes its tokens (createJWT): Latin-1, standard base64
const jwt = (p) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}.sig`;
(async () => {
  const [A] = engine.decks;
  for (let i = 0; i < 100 && !(A.isLoaded && engine.decks[1].isLoaded); i++) await sleep(100);
  await sleep(2000);
  const panel = $("stream"), btn = $("sound-check"), chip = document.querySelector("#stream .s-state"), noteEl = $("stream-note");
  ok("the stream panel shows in LIVE with a SOUND CHECK button next to GO LIVE (still disabled)", !panel.hidden && !!btn && document.querySelector("#stream .go").disabled);

  // signed out
  localStorage.removeItem("gl_token"); headliner.soundCheck.refresh();
  ok("signed out: the button says SIGN IN and there is a plain note", btn.textContent === "SIGN IN" && /Sign in on grooveline.org/.test(noteEl.textContent) && !noteEl.hidden, `${btn.textContent} | ${noteEl.textContent}`);
  const opened = []; const realOpen = window.open; window.open = (u) => { opened.push(u); return null; };
  btn.click(); await sleep(200); window.open = realOpen;
  ok("SIGN IN opens grooveline.org/broadcast in a new tab", opened.length === 1 && opened[0] === "https://grooveline.org/broadcast", opened.join());

  // signed in (the site's token, in the same storage): the offer comes back by itself when the other tab stores it
  const asked = [];
  headliner.streamTest.fetchFn = async (url, init) => { asked.push({ url, auth: init && init.headers && init.headers.Authorization }); return new Response(JSON.stringify({ video_key: KEY }), { status: 200 }); };
  headliner.streamTest.whipBase = "http://127.0.0.1:8889";
  localStorage.setItem("gl_token", jwt({ sub: "u1", dj_name: "Zé", exp: Date.now() + 3600e3 }));
  window.dispatchEvent(new StorageEvent("storage", { key: "gl_token" })); await sleep(200);
  ok("signed in: the button offers SOUND CHECK, no note", btn.textContent === "SOUND CHECK" && noteEl.hidden, `${btn.textContent}`);

  // the booth's master: deck A on air, so there is music to send
  booth.channel[0] = 0.9; booth.channel[1] = 0; booth.cross = 0; booth.applyMix(); engine.roomVolume = 0.75;
  A.motorOn = true; A.seek(12);
  await sleep(800);

  btn.click();
  for (let i = 0; i < 80 && btn.textContent !== "STOP CHECK"; i++) await sleep(150);
  ok("clicking asked /check/mount with the sign-in as a bearer token", asked.length === 1 && asked[0].url === "https://api.grooveline.org/check/mount" && /^Bearer eyJ/.test(asked[0].auth || ""), JSON.stringify(asked[0] || {}).slice(0, 120));
  ok("it connected: the chip says SOUND CHECK (not ON AIR), the button STOP CHECK, and the note says nobody hears it", btn.textContent === "STOP CHECK" && chip.textContent === "SOUND CHECK" && /Nobody hears it/.test(noteEl.textContent), `${chip.textContent} | ${btn.textContent} | ${noteEl.textContent}`);
  ok("ON AIR stays 00:00:00 and LISTENERS —: a test is not a show", document.querySelector("#stream dd:nth-of-type(2)").textContent === "00:00:00" && /^\s*\S+\s*$/.test(document.querySelector("#stream dd:nth-of-type(3)").textContent));
  T("HOLD", "sending the booth's master now (read it back on the server side)");
  await sleep(Number(new URLSearchParams(location.search).get("hold") || 14) * 1000);

  btn.click(); await sleep(1200);
  ok("a second click stops it: back to the SOUND CHECK offer and OFF AIR", btn.textContent === "SOUND CHECK" && chip.textContent === "OFF AIR", `${btn.textContent} | ${chip.textContent}`);

  // the key call refused: a plain message, nothing sent
  headliner.streamTest.fetchFn = async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  btn.click(); await sleep(600);
  ok("an expired sign-in (401) puts the button back to SIGN IN with the reason", btn.textContent === "SIGN IN" && /sign-in has run out/.test(noteEl.textContent), `${btn.textContent} | ${noteEl.textContent}`);
  headliner.streamTest.fetchFn = async () => { throw new TypeError("Failed to fetch"); };
  localStorage.setItem("gl_token", jwt({ sub: "u1", dj_name: "Zé", exp: Date.now() + 3600e3 })); headliner.soundCheck.refresh();
  btn.click(); await sleep(600);
  ok("no network (or a blocked call) says so and can be tried again", /Could not reach/.test(noteEl.textContent) && btn.textContent === "SOUND CHECK", `${btn.textContent} | ${noteEl.textContent}`);

  // leaving LIVE ends a test in progress
  headliner.streamTest.fetchFn = async () => new Response(JSON.stringify({ video_key: KEY }), { status: 200 });
  btn.click();
  for (let i = 0; i < 80 && btn.textContent !== "STOP CHECK"; i++) await sleep(150);
  const was = btn.textContent;
  booth.setMode("game"); await sleep(3500);
  ok("leaving LIVE stops a test in progress", was === "STOP CHECK" && headliner.soundCheck.view.stops === false, `was ${was}, now ${headliner.soundCheck.view.state}`);
  localStorage.removeItem("gl_token");
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
