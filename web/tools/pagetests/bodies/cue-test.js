// Drives CUE through the booth's own press/release in the page (no mouse), prints what the audio thread did.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = engine.decks[0];
const cue = (down) => down ? booth.press({ t: "cue", d: 0 }) : booth.release({ t: "cue", d: 0 });
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
(async () => {
  for (let i = 0; i < 100 && !D.isLoaded; i++) await sleep(100);
  await sleep(500);
  T("loaded", D.isLoaded, "cuePoint", D.cuePoint, "dur", D.duration, "ctx", engine.context && engine.context.state);
  D.motorOn = false; await sleep(400);
  const c0 = D.cuePoint;

  // A: stopped on the mark: CUE held plays, let go: silent, back on the mark.
  cue(true);
  const up = []; let quickAtStart = D._quick;
  for (let i = 0; i < 12; i++) { up.push(D.rate.toFixed(2)); await sleep(3); }
  T("A rate after press (3 ms steps):", up.join(" "), "quick at start", quickAtStart);
  await sleep(300);
  ok("A quick glide ended during the hold (pitch/sync move smoothly)", D._quick === false);
  const a1 = D.seconds, ar = D.rate;
  ok("A preview plays", ar > 0.9 && a1 > c0 + 0.2, `rate ${ar.toFixed(3)} at +${(a1 - c0).toFixed(3)}s motorOn ${D.motorOn}`);
  cue(false);
  const trace = [];
  for (let i = 0; i < 20; i++) { trace.push(D.rate.toFixed(2)); await sleep(3); }
  T("A rate after release (3 ms steps):", trace.join(" "));
  await sleep(150);
  ok("A back on the mark, stopped", Math.abs(D.seconds - c0) < 0.01 && Math.abs(D.rate) < 0.01 && !D.motorOn, `at ${D.seconds.toFixed(4)} vs ${c0.toFixed(4)} rate ${D.rate.toFixed(4)}`);

  // B: needle moved to a new spot: CUE marks it, plays from there, let go: back on the NEW mark.
  D.seek(20); await sleep(150);
  cue(true); await sleep(400);
  ok("B marked the new spot", Math.abs(D.cuePoint - 20) < 0.02, `cuePoint ${D.cuePoint.toFixed(4)}`);
  ok("B plays from it", D.rate > 0.9 && D.seconds > 20.3, `at ${D.seconds.toFixed(3)}`);
  cue(false); await sleep(200);
  ok("B returned to the new mark", Math.abs(D.seconds - 20) < 0.01 && D.rate < 0.01, `at ${D.seconds.toFixed(4)}`);

  // C: playing, CUE: back to the mark and stopped, no preview.
  D.motorOn = true; await sleep(600);
  ok("C was playing", D.rate > 0.9 && D.seconds > 20.3);
  cue(true); await sleep(150);
  ok("C stopped on the mark", !D.motorOn && Math.abs(D.seconds - 20) < 0.01 && D.rate < 0.01 && !booth.previewing[0], `at ${D.seconds.toFixed(4)} rate ${D.rate.toFixed(4)}`);
  cue(false); await sleep(100);
  ok("C release does nothing", !D.motorOn && Math.abs(D.seconds - 20) < 0.01);

  // D: hold CUE, press PLAY, let go of CUE: keeps playing. Then CUE (playing) stops it at the mark.
  cue(true); await sleep(200);
  booth.press({ t: "play", d: 0 }); cue(false); await sleep(400);
  ok("D keeps playing after CUE is let go", D.motorOn && D.rate > 0.9 && D.seconds > 20.4, `at ${D.seconds.toFixed(3)}`);
  cue(true); await sleep(150); cue(false); await sleep(100);
  ok("D CUE stops it at the mark", !D.motorOn && Math.abs(D.seconds - 20) < 0.01);

  // E: a lesson's facts do not see a preview as a start.
  let facts = null;
  booth.lesson = { version: -1, update: (f) => { facts = f; }, begin() {}, stop() {}, takeSkip: () => null, speaking: false, target: null }; booth.lessonReady = true;
  await sleep(2500); // a lesson rebuilds the booth (the effect bar goes), which ends any hold
  cue(true); await sleep(2500);
  ok("E preview hidden from the lesson", facts && facts.motorOn[0] === false && facts.turning[0] === false && D.rate > 0.9, `motorOn ${facts && facts.motorOn[0]} turning ${facts && facts.turning[0]} rate ${D.rate.toFixed(2)}`);
  booth.press({ t: "play", d: 0 }); await sleep(2500);
  ok("E PLAY during the hold makes it a real start", facts && facts.motorOn[0] === true && facts.turning[0] === true);
  cue(false); booth.lesson = null; D.motorOn = false; await sleep(300);
  D.seek(20); await sleep(300);

  // F: a quick double tap and ten taps do not drift the mark.
  const m = D.cuePoint;
  cue(true); await sleep(12); cue(false); await sleep(8); cue(true); await sleep(12); cue(false); await sleep(200);
  ok("F double tap: mark stays", Math.abs(D.cuePoint - m) < 0.001 && Math.abs(D.seconds - m) < 0.01, `mark ${D.cuePoint.toFixed(4)} at ${D.seconds.toFixed(4)}`);
  for (let i = 0; i < 10; i++) { cue(true); await sleep(40); cue(false); await sleep(90); }
  await sleep(100);
  ok("F ten taps: mark stays", Math.abs(D.cuePoint - m) < 0.001 && Math.abs(D.seconds - m) < 0.01, `mark ${D.cuePoint.toFixed(4)} at ${D.seconds.toFixed(4)}`);

  // G: keyboard path (A = left CUE), a long hold.
  const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: "KeyA", key: "a", bubbles: true }));
  key("keydown"); key("keydown"); await sleep(300);
  ok("G key hold plays (repeat ignored)", D.rate > 0.9 && booth.previewing[0]);
  key("keyup"); await sleep(200);
  ok("G key let go: back on the mark", D.rate < 0.01 && Math.abs(D.seconds - m) < 0.01, `at ${D.seconds.toFixed(4)}`);

  // H: a window blur while held stops it.
  cue(true); await sleep(200); window.dispatchEvent(new Event("blur")); await sleep(200);
  ok("H blur ends a hold", !booth.previewing[0] && D.rate < 0.01 && Math.abs(D.seconds - m) < 0.01);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
