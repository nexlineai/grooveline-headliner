// The camera IN SHOW (22 Nov review): a check or a show that carries the picture locks the camera's controls (OFF, the camera list, IN SHOW), and
// STOP / END SHOW always stops AT ONCE, even when the camera is off or failing. (Before the fix the stop click first tried to start the camera and,
// when that failed, never reached the stop: the show could not be ended from its button.) Fake camera (camera-fake.sh); the WHIP address points
// at a closed local port, so the check stays "connecting": a running connection attempt, which is what a STOP must end.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(2) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const $ = (id) => document.getElementById(id);
const waitFor = async (f, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (f()) return true; await sleep(100); } return false; };
const b64 = (o) => btoa(JSON.stringify(o));
const jwt = (p) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}.sig`;
(async () => {
  for (let i = 0; i < 100 && !(engine.decks[0].isLoaded && engine.decks[1].isLoaded); i++) await sleep(100);
  await sleep(2000);
  const cam = headliner.camera, check = $("sound-check"), camBtn = $("camera-toggle"), send = $("camera-send"), label = document.querySelector("#camera-bar .cam-label");
  headliner.streamTest.fetchFn = async (url) => url.endsWith("/check/mount") ? new Response(JSON.stringify({ video_key: "vcheck-0123456789abcdef0123" }), { status: 200 })
    : new Response(JSON.stringify({ now: new Date().toISOString(), slot: null, ingest: null }), { status: 200 });
  headliner.streamTest.whipBase = "http://127.0.0.1:9"; // nothing listens: the connection keeps trying
  localStorage.setItem("gl_token", jwt({ sub: "u1", dj_name: "Zé", exp: Date.now() + 3600e3 }));
  window.dispatchEvent(new StorageEvent("storage", { key: "gl_token" })); await sleep(600);
  booth.channel[0] = 0.9; booth.applyMix(); engine.decks[0].motorOn = true;
  if (!send.classList.contains("on")) send.click();
  ok("IN SHOW on, camera off, SOUND CHECK offered", send.classList.contains("on") && !cam.view.on && check.textContent === "SOUND CHECK", `${check.textContent} cam ${cam.view.on}`);

  check.click();
  await waitFor(() => cam.view.on && soundCheck.view.stops, 12000);
  ok("SOUND CHECK with IN SHOW starts the camera first, then the check (a connection is being made)", cam.view.on && soundCheck.view.stops, `${soundCheck.state} cam ${cam.view.on}`);
  ok("while the picture goes out: PREVIEW · IN SHOW, and the camera's OFF, its list and IN SHOW are locked", label.textContent.includes("IN SHOW") && camBtn.disabled && $("camera-pick").disabled && send.disabled,
    `${label.textContent} off ${camBtn.disabled} pick ${$("camera-pick").disabled} send ${send.disabled}`);
  camBtn.click(); await sleep(500);
  ok("a click on the locked OFF does not end the picture", cam.view.on, `cam ${cam.view.on}`);

  // the camera dies (unplugged, taken by another program) and can no longer be started
  const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Could not start video source", "NotReadableError"));
  await cam.stop(); await sleep(300);
  check.click();
  await waitFor(() => !soundCheck.view.stops, 3000);
  ok("STOP works at once with the camera gone: the check ends, nothing waits for the camera", !soundCheck.view.stops && check.textContent === "SOUND CHECK", `${soundCheck.state} | ${check.textContent}`);
  ok("and the camera was not asked again by the stop", !cam.view.on, `cam ${cam.view.on}`);
  ok("the camera controls are free again", !camBtn.disabled && !send.disabled);

  // starting again with IN SHOW and a dead camera: refused with words, nothing sent (the rule from 21 Nov is kept)
  check.click(); await sleep(1500);
  ok("a NEW start with IN SHOW and a dead camera is refused, and says why", !soundCheck.view.stops && $("stream-note").textContent.length > 0, $("stream-note").textContent.slice(0, 80));
  navigator.mediaDevices.getUserMedia = realGum;
  send.click(); localStorage.removeItem("headliner.publishVideo"); localStorage.removeItem("gl_token");
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
