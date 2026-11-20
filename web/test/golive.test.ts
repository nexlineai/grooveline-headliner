// GO LIVE: the state machine, with a stand-in server, publisher and clock.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GoLive } from "../src/stream/golive.ts";
import type { LiveView } from "../src/stream/golive.ts";
import type { PublisherLike } from "../src/stream/soundcheck.ts";
import type { WhipState } from "../src/stream/whip.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const session = { token: "T", expires: T0 + 1e9, name: "zdb" };
const stream = { id: "master" } as unknown as MediaStream;
const WHIP = "https://stream.grooveline.org/whip/live/zdb-b1/whip";

class FakePub implements PublisherLike {
  state: WhipState = "idle"; detail = ""; stopped = false;
  endpoint: string; onState: (s: WhipState, d: string) => void; after: WhipState;
  constructor(endpoint: string, onState: (s: WhipState, d: string) => void, after: WhipState = "live") { this.endpoint = endpoint; this.onState = onState; this.after = after; }
  async start() { this.onState("connecting", ""); await Promise.resolve(); this.state = this.after; this.detail = this.after === "failed" ? "The server did not allow this stream: there is no slot for this key right now." : ""; this.onState(this.state, this.detail); }
  async stop() { this.stopped = true; this.state = "stopped"; this.onState("stopped", ""); }
}

/** A world: the laptop clock `clock.t`, the server's clock is `clock.t + skew`; bookings relative to the SERVER's now at T0. */
function rig(opts: { startIn?: number; length?: number; skew?: number; signedIn?: boolean; after?: WhipState; api?: number; noStream?: boolean; liveAnswer?: () => unknown } = {}) {
  const clock = { t: T0 };
  const skew = opts.skew ?? 0;
  const startAbs = T0 + skew + (opts.startIn ?? 60 * MIN), endAbs = startAbs + (opts.length ?? 120 * MIN);
  const views: LiveView[] = [], pubs: FakePub[] = [], calls: string[] = [];
  let signedIn = opts.signedIn ?? true, slotGone = false, beforeGo = 0;
  const answerSlot = () => {
    const serverNow = clock.t + skew;
    const phase = serverNow < startAbs - 15 * MIN ? "later" : serverNow < startAbs ? "early" : "on";
    const ingest = phase === "later" ? null : { whip_url: WHIP, audio: { codec: "opus", bitrate: 192000 } };
    return { now: iso(serverNow), slot: slotGone || serverNow >= endAbs ? null : { id: "b1", start: iso(startAbs), end: iso(endAbs), window_start: iso(startAbs - 15 * MIN), phase, opens_in_s: 0, description: "", stream_type: "icecast" }, ingest: slotGone || serverNow >= endAbs ? null : ingest };
  };
  const fetchFn = async (url: string) => {
    calls.push(url);
    if (url.endsWith("/me/next-slot")) return new Response(JSON.stringify(answerSlot()), { status: opts.api ?? 200 });
    if (url.endsWith("/live")) return new Response(JSON.stringify(opts.liveAnswer ? opts.liveAnswer() : { live: false }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const g = new GoLive({
    session: () => (signedIn ? session : null), fetchFn, stream: () => (opts.noStream ? null : stream), now: () => clock.t, confirmMs: 50,
    makePublisher: (endpoint, _s, onState) => { const p = new FakePub(endpoint, onState, opts.after); pubs.push(p); return p; },
    beforeGo: () => { beforeGo++; }, onChange: (v) => views.push(v),
  });
  return { g, clock, views, pubs, calls, beforeGo: () => beforeGo, setSignedIn: (v: boolean) => { signedIn = v; }, dropSlot: () => { slotGone = true; }, endAbs, startAbs };
}

describe("GO LIVE phases", () => {
  test("no sign-in: signed out, the button off; no network call at all", async () => {
    const r = rig({ signedIn: false });
    await r.g.refresh();
    assert.equal(r.g.state, "signed-out");
    assert.equal(r.g.view.enabled, false);
    assert.equal(r.calls.length, 0);
  });

  test("no slot booked: the button off, a plain note", async () => {
    const r = rig();
    r.dropSlot(); await r.g.refresh();
    assert.equal(r.g.state, "none");
    assert.equal(r.g.view.enabled, false);
    assert.match(r.g.view.note, /No slot booked/);
    assert.equal(r.g.view.slot, "none booked");
  });

  test("more than 15 min before: later, GO LIVE off, the note points to the sound check; the slot line counts down", async () => {
    const r = rig({ startIn: 60 * MIN });
    await r.g.refresh();
    assert.equal(r.g.state, "later");
    assert.equal(r.g.view.enabled, false);
    assert.match(r.g.view.note, /SOUND CHECK/);
    assert.match(r.g.view.slot, /in 60 min$/);
    r.clock.t += 30 * MIN; r.g.tick();
    assert.match(r.g.view.slot, /in 30 min$/);
  });

  test("the window opens by itself as the clock moves (no new request): later, early, on", async () => {
    const r = rig({ startIn: 20 * MIN });
    await r.g.refresh();
    assert.equal(r.g.state, "later");
    r.clock.t += 6 * MIN; r.g.tick();
    assert.equal(r.g.state, "early");
    assert.equal(r.g.view.enabled, true);
    assert.match(r.g.view.note, /on the radio at once/);
    r.clock.t += 15 * MIN; r.g.tick();
    assert.equal(r.g.state, "on");
    assert.match(r.g.view.note, /running/);
  });

  test("the SERVER's clock decides, not the laptop's: a laptop 40 minutes behind still sees the window open when the server's does", async () => {
    const r = rig({ startIn: 10 * MIN, skew: 40 * MIN }); // the server is 40 min ahead of the laptop; the slot starts 10 min after the server's now
    await r.g.refresh();
    assert.equal(r.g.state, "early", "10 min before the start on the server's clock");
    r.clock.t += 10 * MIN; r.g.tick();
    assert.equal(r.g.state, "on");
  });
});

describe("going live", () => {
  test("in the early window it takes TWO clicks (it puts the DJ on the radio at once); the second must come soon", async () => {
    const r = rig({ startIn: 10 * MIN });
    await r.g.refresh();
    await r.g.toggle();
    assert.equal(r.g.state, "confirming");
    assert.equal(r.g.view.button, "ON AIR NOW?");
    assert.equal(r.pubs.length, 0, "nothing is sent after one click");
    await new Promise((x) => setTimeout(x, 90));
    assert.equal(r.g.state, "early", "the second click did not come: back to early");
    await r.g.toggle(); await r.g.toggle();
    assert.equal(r.pubs.length, 1);
    assert.equal(r.pubs[0].endpoint, WHIP);
    assert.equal(r.g.state, "sending");
    assert.equal(r.beforeGo(), 1, "the sound check was told to stop first");
  });

  test("while the slot runs one click goes; CONNECTED is SENDING, not ON AIR; ON AIR only when /live names this booking", async () => {
    const r = rig({ startIn: -10 * MIN, liveAnswer: () => ({ live: true, booking_id: "b1" }) });
    await r.g.refresh();
    assert.equal(r.g.state, "on");
    await r.g.toggle();
    assert.equal(r.g.state, "sending");
    assert.equal(r.g.view.chip, "SENDING");
    assert.equal(r.g.view.onAirSince, null);
    await r.g.pollLive();
    assert.equal(r.g.state, "onair");
    assert.equal(r.g.view.chip, "ON AIR");
    assert.equal(r.g.view.onAirSince, T0);
  });

  test("/live naming ANOTHER booking (or not live) never makes it ON AIR; if the radio stops listing it, back to SENDING", async () => {
    let answer: unknown = { live: true, booking_id: "someone-else" };
    const r = rig({ startIn: -10 * MIN, liveAnswer: () => answer });
    await r.g.refresh(); await r.g.toggle();
    await r.g.pollLive();
    assert.equal(r.g.state, "sending");
    answer = { live: true, booking_id: "b1" }; await r.g.pollLive();
    assert.equal(r.g.state, "onair");
    answer = { live: false }; await r.g.pollLive();
    assert.equal(r.g.state, "sending");
    assert.equal(r.g.view.onAirSince, null);
  });

  test("a /live call that fails or answers an error changes nothing", async () => {
    const r = rig({ startIn: -10 * MIN, liveAnswer: () => { throw new Error("x"); } });
    await r.g.refresh(); await r.g.toggle();
    await r.g.pollLive().catch(() => {});
    assert.equal(r.g.state, "sending");
  });

  test("END SHOW stops the publisher (DELETE), forgets ON AIR, and asks the server for the slot again", async () => {
    const r = rig({ startIn: -10 * MIN, liveAnswer: () => ({ live: true, booking_id: "b1" }) });
    await r.g.refresh(); await r.g.toggle(); await r.g.pollLive();
    const before = r.calls.filter((c) => c.endsWith("/me/next-slot")).length;
    await r.g.toggle();
    assert.ok(r.pubs[0].stopped);
    assert.equal(r.g.state, "on");
    assert.equal(r.g.view.onAirSince, null);
    assert.equal(r.calls.filter((c) => c.endsWith("/me/next-slot")).length, before + 1);
  });

  test("a refusal from the server is shown in words with the button ready to try again", async () => {
    const r = rig({ startIn: -10 * MIN, after: "failed" });
    await r.g.refresh(); await r.g.toggle();
    assert.equal(r.g.state, "failed");
    assert.match(r.g.view.note, /no slot for this key/);
    assert.equal(r.g.view.enabled, true);
    await r.g.toggle();
    assert.equal(r.g.state, "on", "a click clears it and reads the slot again");
  });

  test("the audio engine not running: says so and sends nothing", async () => {
    const r = rig({ startIn: -10 * MIN, noStream: true });
    await r.g.refresh(); await r.g.toggle();
    assert.equal(r.g.state, "failed");
    assert.match(r.g.view.note, /not running/);
    assert.equal(r.pubs.length, 0);
  });

  test("a dropped connection shows RECONNECTING with the reason and goes back to SENDING", async () => {
    const r = rig({ startIn: -10 * MIN });
    await r.g.refresh(); await r.g.toggle();
    r.pubs[0].onState("reconnecting", "The connection was lost.");
    assert.equal(r.g.state, "reconnecting");
    assert.equal(r.g.view.note, "The connection was lost.");
    assert.equal(r.g.view.chip, "RECONNECTING");
    r.pubs[0].onState("live", "");
    assert.equal(r.g.state, "sending");
  });
});

describe("the end of the slot", () => {
  test("at slot_end (server clock) a running show is stopped, the panel says the slot has ended; nothing is sent after", async () => {
    const r = rig({ startIn: -10 * MIN, length: 60 * MIN, liveAnswer: () => ({ live: true, booking_id: "b1" }) });
    await r.g.refresh(); await r.g.toggle(); await r.g.pollLive();
    assert.equal(r.g.state, "onair");
    r.clock.t = r.endAbs - 1000; r.g.tick();
    assert.equal(r.g.state, "onair");
    r.clock.t = r.endAbs; r.g.tick();
    await new Promise((x) => setTimeout(x, 20));
    assert.ok(r.pubs[0].stopped, "the audio stopped at the end");
    assert.equal(r.g.state, "ended", "a show cut off by the slot's end keeps saying so, the refresh with no next slot does not turn it into none");
    assert.match(r.g.view.note, /has ended/);
    assert.equal(r.g.view.onAirSince, null);
  });

  test("an idle panel whose slot passes reads the next one (or none)", async () => {
    const r = rig({ startIn: -10 * MIN, length: 20 * MIN });
    await r.g.refresh();
    assert.equal(r.g.state, "on");
    r.clock.t = r.endAbs + 1000; r.g.tick();
    await new Promise((x) => setTimeout(x, 20));
    assert.equal(r.g.state, "none");
  });
});

describe("the server answering badly", () => {
  test("404 (the Worker has no such route yet): not available yet, the button off", async () => {
    const r = rig({ api: 404 });
    await r.g.refresh();
    assert.equal(r.g.state, "unavailable");
    assert.match(r.g.view.note, /not available yet/);
    assert.equal(r.g.view.enabled, false);
  });
  test("401: signed out", async () => {
    const r = rig({ api: 401 });
    await r.g.refresh();
    assert.equal(r.g.state, "signed-out");
  });
  test("refresh() never disturbs a show or a pending confirmation", async () => {
    const r = rig({ startIn: -10 * MIN });
    await r.g.refresh(); await r.g.toggle();
    r.setSignedIn(false); await r.g.refresh();
    assert.equal(r.g.state, "sending");
    const e = rig({ startIn: 5 * MIN });
    await e.g.refresh(); await e.g.toggle();
    await e.g.refresh();
    assert.equal(e.g.state, "confirming");
  });
});
