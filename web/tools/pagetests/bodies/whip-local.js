// WHIP against a REAL MediaMTX (v1.4.0, the version on Carapava) running on this machine: a 440 Hz tone from the page goes to live/<key>.
// Not in the standard suite: it needs MediaMTX (see whip-local.sh). #good = a key the auth stub allows, #bad = one it refuses.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
(async () => {
  const { WhipPublisher } = await import("/src/stream/whip.ts");
  const good = !location.hash.includes("bad");
  const ctx = new AudioContext();
  await ctx.resume();
  const osc = ctx.createOscillator(); osc.frequency.value = 440;
  const gain = ctx.createGain(); gain.gain.value = 0.25;
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain).connect(dest); osc.start();
  const states = [];
  const whip = new WhipPublisher({ endpoint: `http://127.0.0.1:8889/live/${good ? "goodkey" : "badkey"}/whip`, stream: dest.stream, retryMs: [500, 1000], onState: (s, d) => { states.push(s); T("state", s, d); } });
  window.__whip = whip;
  await whip.start();
  if (good) {
    ok("a real MediaMTX accepts the page's offer and the connection comes up", whip.state === "live", states.join(">"));
    await sleep(2000);
    const stats = await (async () => { try { const pc = whip.pc; const r = await pc.getStats(); let o = null; r.forEach((s) => { if (s.type === "outbound-rtp" && s.kind === "audio") o = s; }); return o; } catch { return null; } })();
    ok("audio is being sent (bytes counted by the browser)", !!stats && stats.bytesSent > 1000, stats ? `${stats.bytesSent} bytes, ${stats.packetsSent} packets` : "no stats");
    T("HOLD", "tone is on live/goodkey now");
    await sleep(Number(new URLSearchParams(location.search).get("hold") || 25) * 1000);
    await whip.stop();
    ok("stop() ends the session", whip.state === "stopped");
  } else {
    ok("a key the server does not allow is refused: failed, not retried, in plain words", whip.state === "failed" && /no slot/.test(whip.detail), `${states.join(">")} | ${whip.detail}`);
    await sleep(2500);
    ok("and it stays failed (no retry loop)", whip.state === "failed" && !states.includes("reconnecting"), states.join(">"));
  }
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
