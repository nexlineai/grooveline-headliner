// GO LIVE in the stream panel, driven like a person: golive-local.sh clicks the REAL buttons with the mouse (CDP), this file defines the stand-in server answers and the checks
// (GL.p0 ... GL.p11), and the wrapper calls them between the clicks. The publish goes to a real MediaMTX on this machine; an ffmpeg reads it back at HOLD1 / HOLD2.
// The server answers are the real shapes (read from the Worker's code on 20 Nov): GET /me/next-slot (ids are UUID strings), GET /live names `booking_id`, GET /check/mount gives `video_key`.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const $ = (id) => document.getElementById(id);
const KEY = "zdb-b1", CHECK = "vcheck-0123456789abcdef0123", BOOKING = "0b6c1c3e-52b1-4d0c-9a5e-3f2f6d1a7c11";
const b64 = (o) => btoa(JSON.stringify(o));
const jwt = (p) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}.sig`;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60e3;
const G = window.GL = { slot: null, liveOn: false, liveAsked: 0, slotAsked: 0, keysSeen: [], pcs: [] };
// every connection the page makes, so a test can see that it was closed
const RealPC = window.RTCPeerConnection;
window.RTCPeerConnection = function (...a) { const pc = new RealPC(...a); G.pcs.push(pc); return pc; };
window.RTCPeerConnection.prototype = RealPC.prototype;
const open = () => G.pcs.filter((p) => p.connectionState !== "closed").length;
const panel = () => ({ chip: document.querySelector("#stream .s-state").textContent, note: $("stream-note").hidden ? "" : $("stream-note").textContent, go: $("go-live"), check: $("sound-check"),
  slot: $("stream-slot").textContent, timer: $("stream-onair").textContent, bar: $("bar-onair").querySelector("span").textContent, barDot: $("bar-onair").className, barTime: $("bar-time").textContent });
const show = (p) => `chip ${p.chip} | go ${p.go.textContent}${p.go.disabled ? " (off)" : ""} | note ${p.note.slice(0, 70)} | slot ${p.slot}`;
const slotAnswer = () => {
  const s = G.slot, now = Date.now();
  if (!s || now >= s.end) return { now: iso(now), slot: null, ingest: null };
  const phase = now >= s.start ? "on" : now >= s.start - 15 * MIN ? "early" : "later";
  return { now: iso(now), slot: { id: BOOKING, start: iso(s.start), end: iso(s.end), window_start: iso(s.start - 15 * MIN), phase, opens_in_s: Math.max(0, Math.round((s.start - 15 * MIN - now) / 1000)), description: "Test set", stream_type: "icecast" },
    ingest: phase === "later" ? null : { whip_url: `https://stream.grooveline.org/whip/live/${KEY}/whip`, audio: { codec: "opus", bitrate: 192000 } } };
};
const setSlot = (startInMs, lengthMs) => { const now = Date.now(); G.slot = { start: now + startInMs, end: now + startInMs + lengthMs }; };

// the setup and the first checks (about 7 s), then the wrapper waits
G.p0 = async () => {
  const [A, B] = engine.decks;
  for (let i = 0; i < 100 && !(A.isLoaded && B.isLoaded); i++) await sleep(100);
  await sleep(2000);
  headliner.streamTest.whipBase = "http://127.0.0.1:8889";
  headliner.streamTest.fetchFn = async (url) => {
    if (url.endsWith("/me/next-slot")) { G.slotAsked++; return json(slotAnswer()); }
    if (url.endsWith("/live")) { G.liveAsked++; return json(G.liveOn && G.slot ? { live: true, stream_url: "https://radio.grooveline.org/zdb", dj_name: "Zé", booking_id: BOOKING, stream_type: "icecast", stream_key: null, slot_start: iso(G.slot.start), slot_end: iso(G.slot.end), description: "Test set" } : { live: false, stream_url: null, dj_name: null, stream_key: null }); }
    if (url.endsWith("/check/mount")) return json({ video_key: CHECK });
    return json({ error: "no such route" }, 404);
  };
  // the booth's master: deck A on air, so there is music to send
  booth.channel[0] = 0.9; booth.channel[1] = 0; booth.cross = 0; booth.applyMix(); engine.roomVolume = 0.75;
  A.motorOn = true; A.seek(12);
  // signed out first
  localStorage.removeItem("gl_token"); window.dispatchEvent(new StorageEvent("storage", { key: "gl_token" })); await sleep(600);
  let p = panel();
  ok("signed out: GO LIVE is off, SLOT shows a dash, and the check button offers SIGN IN", p.go.disabled && p.slot === "—" && p.check.textContent === "SIGN IN", show(p));
  // signed in with the slot 2 hours away
  setSlot(2 * 60 * MIN, 60 * MIN);
  localStorage.setItem("gl_token", jwt({ sub: "u1", dj_name: "Zé", exp: Date.now() + 3600e3 }));
  window.dispatchEvent(new StorageEvent("storage", { key: "gl_token" })); await sleep(2500);
  p = panel();
  ok("signed in, slot in 2 h: SLOT says when, GO LIVE is off, the note says it opens 15 minutes before, SOUND CHECK is on offer", /in 2 h/.test(p.slot) && p.go.disabled && /opens 15 minutes before/.test(p.note) && p.check.textContent === "SOUND CHECK" && !p.check.disabled, show(p));
  ok("the top bar says OFF AIR and 00:00:00", p.bar === "OFF AIR" && p.barTime === "00:00:00" && p.timer === "00:00:00", `${p.bar} ${p.barTime}`);
  // the window opens: 10 minutes before the start
  setSlot(10 * MIN, 60 * MIN); await goLive.refresh(); await sleep(1500);
  p = panel();
  ok("10 min before the start: GO LIVE is on, and the note says that going live now puts you on the radio at once", !p.go.disabled && p.go.textContent === "GO LIVE" && /on the radio at once/.test(p.note) && /starts in/.test(p.slot), show(p));
  const r = $("go-live").getBoundingClientRect();
  T("INFO", "go-live at", Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
};

// after the first real click: it asks, it does not send
G.p1 = () => {
  const p = panel();
  ok("first click in the early window: the button asks ON AIR NOW? and nothing is sent yet", p.go.textContent === "ON AIR NOW?" && /Click again/.test(p.note) && p.chip === "OFF AIR" && open() === 0, `${show(p)} | connections ${open()}`);
};

// after the second click, connected, but the radio does not list the booking yet
G.p2 = () => {
  const p = panel();
  ok("second click: SENDING (connected), not ON AIR; the radio is not listing the booking yet", p.chip === "SENDING" && p.go.textContent === "END SHOW" && /Waiting for the radio/.test(p.note) && p.timer === "00:00:00" && p.bar === "SENDING", show(p));
  ok("one connection is open, and the sound check is blocked while the show runs", open() === 1 && p.check.disabled, `connections ${open()} check disabled ${p.check.disabled}`);
  G.liveOn = true; // the radio now lists the DJ's mount
};

// ON AIR: the server's word, then the timer runs
G.p3 = () => {
  const p = panel();
  ok("when /live names the booking: ON AIR in the panel and the top bar (red dot), the timer runs", p.chip === "ON AIR" && /live/.test(p.barDot) && p.bar === "ON AIR" && p.timer !== "00:00:00" && p.timer === p.barTime, `${show(p)} | timer ${p.timer} bar ${p.barTime} (/live asked ${G.liveAsked})`);
  T("HOLD1", "on air now (read the stream back on the server side)");
};

// after END SHOW (real click): back to the early state, everything closed
G.p4 = () => {
  const p = panel();
  ok("END SHOW: the connection is closed, OFF AIR, GO LIVE offered again, the timer is back to 00:00:00", open() === 0 && p.chip === "OFF AIR" && p.go.textContent === "GO LIVE" && !p.go.disabled && p.timer === "00:00:00" && p.bar === "OFF AIR" && p.check.disabled === false, `${show(p)} | connections ${open()}`);
  G.liveOn = false;
  // a slot that is running (one click) and ends 15 s from now (the wrapper looks 6 s after that)
  setSlot(-60e3, 75e3); goLive.refresh();
};

// after the single click of a running slot
G.p5 = () => {
  const p = panel();
  ok("a slot that is running takes ONE click: SENDING, no question", p.chip === "SENDING" && open() === 1 && /now/.test(p.slot), show(p));
  G.liveOn = true;
};

// the slot's end
G.p6 = () => {
  const p = panel();
  ok("at the slot's end the audio stops by itself: the connection is closed, OFF AIR, GO LIVE is off", open() === 0 && p.chip === "OFF AIR" && p.go.disabled && p.timer === "00:00:00", `${show(p)} | connections ${open()}`);
  ok("and the panel says why: the slot has ended", /has ended/.test(p.note), p.note);
  G.liveOn = false;
  // next booking: running, 1 hour long, for the sound check -> go live sequence
  setSlot(-30e3, 60 * MIN); goLive.refresh();
};

// the sound check is running
G.p7 = () => {
  const p = panel();
  ok("SOUND CHECK sends: the chip says SOUND CHECK (not ON AIR), the button STOP CHECK, the note says nobody hears it", p.chip === "SOUND CHECK" && p.check.textContent === "STOP CHECK" && /Nobody hears it/.test(p.note) && open() === 1, `${show(p)} | check ${p.check.textContent}`);
  const r = $("go-live").getBoundingClientRect();
  ok("GO LIVE is on offer during the check (the slot is running)", !p.go.disabled, `go ${r.width}x${r.height}`);
};

// after STOP CHECK, then GO LIVE
G.p8 = () => {
  const p = panel();
  ok("check, STOP, then GO LIVE: SENDING with ONE open connection (the test's is closed, the show's is up)", p.chip === "SENDING" && open() === 1 && p.check.disabled, `${show(p)} | connections ${open()} of ${G.pcs.length} made`);
  G.liveOn = true;
};
G.p9 = () => {
  const p = panel();
  ok("after the check, GO LIVE reaches ON AIR too (the stream carried real tracks)", p.chip === "ON AIR" && p.timer !== "00:00:00", show(p));
  // the pages stream's tracks are alive: the sender's track is live and carries audio
  const tracks = G.pcs.filter((x) => x.connectionState !== "closed").flatMap((x) => x.getSenders().map((s) => s.track && s.track.readyState));
  ok("the sender's track is live", tracks.length === 1 && tracks[0] === "live", tracks.join());
  T("HOLD2", "on air after a sound check (read the stream back)");
};

// leaving LIVE ends a show
G.p10 = () => { booth.setMode("game"); };
G.p11 = () => {
  const p = panel();
  ok("leaving LIVE ends the show: nothing is connected, the state is not a busy one", open() === 0 && !goLive.busy, `${goLive.state} | connections ${open()}`);
  localStorage.removeItem("gl_token");
  T("DONE");
};
G.p0().catch((e) => T("ERROR", e && e.stack || e));
