// The SOUND CHECK state machine, with a stand-in publisher and server.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SoundCheck } from "../src/stream/soundcheck.ts";
import type { CheckView, PublisherLike } from "../src/stream/soundcheck.ts";
import type { WhipState } from "../src/stream/whip.ts";

const KEY = "vcheck-0123456789abcdef0123";
const session = { token: "T", expires: Date.now() + 1e9, name: "zdb" };
const stream = { id: "master" } as unknown as MediaStream;

class FakePub implements PublisherLike {
  state: WhipState = "idle"; detail = ""; stopped = false; started = false;
  endpoint: string; onState: (s: WhipState, d: string) => void; after: WhipState;
  constructor(endpoint: string, onState: (s: WhipState, d: string) => void, after: WhipState = "live") { this.endpoint = endpoint; this.onState = onState; this.after = after; }
  async start() { this.started = true; this.onState("connecting", ""); await Promise.resolve(); this.state = this.after; this.detail = this.after === "failed" ? "The server did not allow this stream: there is no slot for this key right now." : ""; this.onState(this.state, this.detail); }
  async stop() { this.stopped = true; this.state = "stopped"; this.onState("stopped", ""); }
}

function rig(opts: { signedIn?: boolean; keyStatus?: number; after?: WhipState; noStream?: boolean; slowKey?: boolean } = {}) {
  const views: CheckView[] = [];
  const pubs: FakePub[] = [];
  let signedIn = opts.signedIn ?? true, signInOpened = 0;
  let release: () => void = () => {};
  const fetchFn = async () => {
    if (opts.slowKey) await new Promise<void>((r) => { release = r; });
    return new Response(JSON.stringify(opts.keyStatus && opts.keyStatus !== 200 ? { error: "x" } : { video_key: KEY }), { status: opts.keyStatus ?? 200 });
  };
  const sc = new SoundCheck({
    session: () => (signedIn ? session : null), fetchFn, stream: () => (opts.noStream ? null : stream),
    makePublisher: (endpoint, _s, onState) => { const p = new FakePub(endpoint, onState, opts.after); pubs.push(p); return p; },
    openSignIn: () => { signInOpened++; }, onChange: (v) => views.push(v),
  });
  return { sc, views, pubs, setSignedIn: (v: boolean) => { signedIn = v; }, signIns: () => signInOpened, release: () => release() };
}
const states = (views: CheckView[]) => views.map((v) => v.state);

describe("SOUND CHECK", () => {
  test("signed out: the button says SIGN IN and opens the sign-in; once signed in (another tab) it offers the check", async () => {
    const r = rig({ signedIn: false });
    assert.equal(r.sc.view.state, "signed-out");
    assert.equal(r.sc.view.button, "SIGN IN");
    await r.sc.toggle();
    assert.equal(r.signIns(), 1);
    assert.equal(r.pubs.length, 0);
    r.setSignedIn(true); r.sc.refresh();
    assert.equal(r.sc.view.state, "idle");
    assert.equal(r.sc.view.button, "SOUND CHECK");
  });

  test("start: asks for the key, connects to /whip/live/<key>/whip with the master stream, and says SOUND CHECK (not ON AIR) once sending", async () => {
    const r = rig();
    await r.sc.toggle();
    assert.deepEqual([...new Set(states(r.views))], ["idle", "asking", "connecting", "sending"]);
    assert.equal(r.pubs[0].endpoint, `https://stream.grooveline.org/whip/live/${KEY}/whip`);
    assert.equal(r.sc.view.chip, "SOUND CHECK");
    assert.equal(r.sc.view.button, "STOP CHECK");
    assert.match(r.sc.view.note, /Nobody hears it/);
  });

  test("a click while sending stops it (DELETE, the publisher stopped) and goes back to the offer", async () => {
    const r = rig();
    await r.sc.toggle();
    await r.sc.toggle();
    assert.ok(r.pubs[0].stopped);
    assert.equal(r.sc.view.state, "idle");
    assert.equal(r.sc.view.chip, "OFF AIR");
  });

  test("a refusal from the server is shown in words, with OFF AIR, and the check can be tried again", async () => {
    const r = rig({ after: "failed" });
    await r.sc.toggle();
    assert.equal(r.sc.view.state, "failed");
    assert.match(r.sc.view.note, /no slot for this key/);
    assert.equal(r.sc.view.chip, "OFF AIR");
    assert.equal(r.sc.view.button, "SOUND CHECK");
    await r.sc.toggle();
    assert.equal(r.pubs.length, 2, "a second try makes a new publisher");
  });

  test("the key call failing: 401 signs out with a reason; 503 says it is not available; neither makes a publisher", async () => {
    const a = rig({ keyStatus: 401 }); await a.sc.toggle();
    assert.equal(a.sc.view.state, "signed-out");
    assert.match(a.sc.view.note, /sign-in has run out/);
    const b = rig({ keyStatus: 503 }); await b.sc.toggle();
    assert.equal(b.sc.view.state, "failed");
    assert.match(b.sc.view.note, /not available/);
    assert.equal(a.pubs.length + b.pubs.length, 0);
  });

  test("the audio engine is not running: says so, asks nothing", async () => {
    const r = rig({ noStream: true });
    await r.sc.toggle();
    assert.equal(r.sc.view.state, "failed");
    assert.match(r.sc.view.note, /not running/);
  });

  test("a connection that drops shows RECONNECTING with the reason, then SOUND CHECK again", async () => {
    const r = rig();
    await r.sc.toggle();
    r.pubs[0].onState("reconnecting", "The connection was lost.");
    assert.equal(r.sc.view.state, "reconnecting");
    assert.equal(r.sc.view.note, "The connection was lost.");
    r.pubs[0].onState("live", "");
    assert.equal(r.sc.view.state, "sending");
  });

  test("stop while the key is still being asked: the late answer is ignored (no publisher is made)", async () => {
    const r = rig({ slowKey: true });
    const started = r.sc.toggle();
    await Promise.resolve();
    assert.equal(r.sc.view.state, "asking");
    await r.sc.stop();
    r.release();
    await started;
    assert.equal(r.pubs.length, 0);
    assert.equal(r.sc.view.state, "idle");
  });

  test("refresh() does not disturb a running check", async () => {
    const r = rig();
    await r.sc.toggle();
    r.setSignedIn(false); r.sc.refresh();
    assert.equal(r.sc.view.state, "sending");
  });
});
