// The camera preview in the STREAM panel: off by default, ON shows this browser's own picture, video only (never the camera's microphone),
// every track stopped when it is switched off or LIVE is left, and nothing at all sent anywhere (no connection, no request).
// Runs in Chromium with the FAKE camera (tools/pagetests/camera-fake.sh: --use-fake-device-for-media-stream --use-fake-ui-for-media-stream),
// so no real hardware is opened and no dialog ever waits.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(2) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const $ = (id) => document.getElementById(id);
const waitFor = async (f, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (f()) return true; await sleep(100); } return false; };
// What the camera must never make: a connection or a request.
let pcs = 0, calls = 0;
const RealPC = window.RTCPeerConnection, realFetch = window.fetch;
window.RTCPeerConnection = function (...a) { pcs++; return new RealPC(...a); };
window.RTCPeerConnection.prototype = RealPC.prototype;
window.fetch = (...a) => { calls++; return realFetch(...a); };
(async () => {
  const cam = headliner.camera, box = $("camera"), video = $("camera-video"), btn = $("camera-toggle"), panel = $("stream");
  const dl = document.querySelector("#stream dl");
  const ratio = () => { const r = video.getBoundingClientRect(); return r.height ? r.width / r.height : 0; };
  for (let i = 0; i < 100 && !(engine.decks[0].isLoaded && engine.decks[1].isLoaded); i++) await sleep(100);
  await sleep(2500);

  // the camera is OFF until he asks for it
  ok("off by default: no picture, the panel is not in its camera layout, the button says ON", box.hidden && !panel.classList.contains("camera-on") && btn.textContent === "ON" && video.srcObject === null && cam.view.on === false,
    `${btn.textContent} | hidden ${box.hidden} | on ${cam.view.on}`);
  ok("with one camera (the fake device) there is no select, and the panel says PREVIEW", $("camera-pick").hidden && /PREVIEW/.test(document.querySelector("#camera-bar .cam-label").textContent),
    `devices ${cam.view.devices.length}`);
  // the button is really there (not under the meter, the note or the buttons)
  const b = btn.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  ok("the mouse reaches the ON button (nothing overlaps it)", hit === btn, `${hit && hit.id || hit && hit.className}`);

  // ON
  pcs = 0; calls = 0;
  btn.click();
  ok("asking: the button says it is busy", btn.textContent === "..." || cam.view.on, btn.textContent);
  const started = await waitFor(() => cam.view.on && !video.paused && video.videoWidth > 0);
  const stream = video.srcObject, vt = stream ? stream.getVideoTracks() : [];
  ok("ON shows a playing picture of a MediaStream", started && stream instanceof MediaStream && !video.paused && video.videoWidth > 0, `${video.videoWidth}x${video.videoHeight} paused ${video.paused}`);
  ok("one live video track and NO audio track: the camera's microphone is never opened", vt.length === 1 && vt[0].readyState === "live" && stream.getAudioTracks().length === 0,
    `video ${vt.length}/${vt[0] && vt[0].readyState} audio ${stream.getAudioTracks().length}`);
  ok("nothing is sent: no connection and no request when the camera opens", pcs === 0 && calls === 0, `connections ${pcs} requests ${calls}`);
  ok("the picture is a 16:9 box inside the panel, beside the meter", Math.abs(ratio() - 16 / 9) < 0.02 && box.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 0.5,
    `ratio ${ratio().toFixed(3)} | box ${box.getBoundingClientRect().width.toFixed(0)}x${box.getBoundingClientRect().height.toFixed(0)}`);
  const m = $("meter").getBoundingClientRect(), v = video.getBoundingClientRect();
  ok("the master meter still works beside it (right of the picture, inside the panel)", m.width > 20 && m.left >= v.left && m.right <= panel.getBoundingClientRect().right + 0.5 && m.height > 40,
    `meter ${m.width.toFixed(0)}x${m.height.toFixed(0)}`);
  ok("the facts give way to the picture (the rows are hidden while it is on)", getComputedStyle(dl).display === "none");
  ok("the chosen camera is remembered in headliner.camera", localStorage.getItem("headliner.camera") === "", `${JSON.stringify(localStorage.getItem("headliner.camera"))}`);

  // OFF: the track is really ended
  btn.click();
  await sleep(400);
  ok("OFF ends the track and lets go of the picture", vt[0].readyState === "ended" && video.srcObject === null && box.hidden && !panel.classList.contains("camera-on"),
    `${vt[0].readyState} | srcObject ${video.srcObject && "kept"}`);
  ok("OFF brings the facts back", getComputedStyle(dl).display !== "none");

  // a blocked camera: the panel says where to allow it, in plain words (no stack trace)
  const md = navigator.mediaDevices, realGUM = md.getUserMedia;
  md.getUserMedia = () => Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }));
  btn.click();
  await waitFor(() => !cam.view.asking);
  const noteEl = $("stream-note"), words = noteEl.hidden ? "" : noteEl.textContent;
  ok("a blocked camera says where to allow it, in the panel's note", !cam.view.on && /blocked/i.test(words) && /address bar/i.test(words) && !/Error|at /.test(words), words);
  ok("and nothing is left running after the refusal", video.srcObject === null && box.hidden, `on ${cam.view.on}`);
  md.getUserMedia = realGUM;

  // ON again, then leave LIVE: the same 1 s rule as a show
  btn.click();
  await waitFor(() => cam.view.on && video.videoWidth > 0);
  const second = video.srcObject, st = second ? second.getVideoTracks()[0] : null;
  booth.setMode("game");
  const stopped = await waitFor(() => cam.view.on === false, 6000);
  ok("leaving LIVE stops the camera by itself (every track ended, the picture let go)", stopped && st !== null && st.readyState === "ended" && video.srcObject === null,
    `${st && st.readyState} | on ${cam.view.on}`);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
