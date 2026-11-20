// The WHIP publisher (stream/whip.ts) with a stand-in peer connection and a stand-in server: no browser, no network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { WhipPublisher, h264First, tuneOpusSdp, whipRefusal } from "../src/stream/whip.ts";
import type { WhipPeer, WhipState } from "../src/stream/whip.ts";

const OFFER = ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=0;usedtx=1", "a=sendonly", ""].join("\r\n");
const ANSWER = "v=0\r\ns=answer\r\n";

class FakePeer implements WhipPeer {
  connectionState = "new";
  iceGatheringState = "new";
  localDescription: { sdp?: string } | null = null;
  onconnectionstatechange: ((e?: unknown) => void) | null = null;
  onicegatheringstatechange: ((e?: unknown) => void) | null = null;
  closed = false;
  remote: string | null = null;
  tracks: string[] = [];
  bits: number[] = [];
  bitrate: number | null = null;
  /** The codec list the publisher asked the browser to prefer for the last transceiver, if it asked. */
  codecs: string[] = [];
  /** What the test wants the connection to do after the answer. */
  after: "connected" | "failed" | "never" = "connected";
  addTransceiver(track: MediaStreamTrack) {
    this.tracks.push(track.kind);
    const self = this;
    return {
      sender: {
        getParameters: () => ({}),
        setParameters: async (p: never) => { const b = (p as { encodings: { maxBitrate: number }[] }).encodings[0].maxBitrate; self.bitrate = b; self.bits.push(b); },
      },
      setCodecPreferences: (codecs: RTCRtpCodec[]) => { self.codecs = codecs.map((c) => c.mimeType); },
    };
  }
  async createOffer() { return { type: "offer" as const, sdp: OFFER }; }
  async setLocalDescription(d: { type: "offer"; sdp?: string }) {
    this.localDescription = { sdp: d.sdp };
    setTimeout(() => { this.iceGatheringState = "complete"; this.onicegatheringstatechange?.(); }, 1);
  }
  async setRemoteDescription(d: { type: "answer"; sdp: string }) {
    this.remote = d.sdp;
    if (this.after !== "never") setTimeout(() => this.set(this.after), 1);
  }
  set(s: string) { this.connectionState = s; this.onconnectionstatechange?.(); }
  close() { this.closed = true; this.connectionState = "closed"; }
}

interface Call { method: string; url: string; body: string; headers: Record<string, string> }
function rig(opts: { statuses?: number[]; peerAfter?: ("connected" | "failed" | "never")[]; video?: MediaStreamTrack | null; videoCodecs?: () => RTCRtpCodec[] } = {}) {
  const calls: Call[] = [];
  const peers: FakePeer[] = [];
  const states: [WhipState, string][] = [];
  let post = 0;
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ method: init?.method ?? "GET", url, body: String(init?.body ?? ""), headers: (init?.headers ?? {}) as Record<string, string> });
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    const status = opts.statuses?.[Math.min(post, opts.statuses.length - 1)] ?? 201;
    post++;
    return status === 201
      ? new Response(ANSWER, { status, headers: { Location: `/live/key/whip/session-${post}` } })
      : new Response("no", { status });
  };
  const stream = { getTracks: () => [{ kind: "audio" }] } as unknown as MediaStream;
  const make = (): WhipPeer => { const p = new FakePeer(); p.after = opts.peerAfter?.[Math.min(peers.length, opts.peerAfter.length - 1)] ?? "connected"; peers.push(p); return p; };
  const whip = new WhipPublisher({
    endpoint: "https://example.test/whip/live/key/whip", stream, fetchFn, makePeer: make,
    retryMs: [5, 5], gatherMs: 50, connectMs: 60, graceMs: 25, headers: { Authorization: "Bearer t" },
    video: opts.video ?? null, videoCodecs: opts.videoCodecs,
    onState: (s, d) => states.push([s, d]),
  });
  return { whip, calls, peers, states };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Opus for music in the offer", () => {
  test("an existing fmtp line is merged: stereo, the bitrate, FEC on, DTX off; other keys stay", () => {
    const out = tuneOpusSdp(OFFER, 192000);
    const line = out.split("\r\n").find((l) => l.startsWith("a=fmtp:111"))!;
    for (const want of ["stereo=1", "sprop-stereo=1", "maxaveragebitrate=192000", "useinbandfec=1", "usedtx=0", "minptime=10"]) assert.ok(line.includes(want), `${want} in ${line}`);
    assert.ok(!line.includes("usedtx=1") && !line.includes("useinbandfec=0"));
    assert.ok(out.includes("\r\n") && out.endsWith("\r\n"), "line endings kept");
  });
  test("no fmtp line: one is added right after the rtpmap line; no opus: nothing changes", () => {
    const bare = OFFER.split("\r\n").filter((l) => !l.startsWith("a=fmtp")).join("\r\n");
    const out = tuneOpusSdp(bare, 128000).split("\r\n");
    assert.match(out[out.indexOf("a=rtpmap:111 opus/48000/2") + 1], /^a=fmtp:111 stereo=1;.*maxaveragebitrate=128000/);
    assert.equal(tuneOpusSdp("v=0\nm=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\n", 128000), "v=0\nm=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\n");
  });
});

describe("WHIP publisher", () => {
  test("connects: POST the offer as SDP, take the answer, live; the bitrate is set on the sender; the headers go along", async () => {
    const { whip, calls, peers, states } = rig();
    await whip.start();
    assert.equal(whip.state, "live");
    assert.deepEqual(states.map((s) => s[0]), ["connecting", "live"]);
    const post = calls[0];
    assert.equal(post.method, "POST");
    assert.equal(post.headers["Content-Type"], "application/sdp");
    assert.equal(post.headers.Authorization, "Bearer t");
    assert.ok(post.body.includes("maxaveragebitrate=192000") && post.body.includes("usedtx=0"), "the tuned offer is what is sent");
    assert.equal(peers[0].remote, ANSWER);
    assert.deepEqual(peers[0].tracks, ["audio"]);
    assert.equal(peers[0].bitrate, 192000);
    await whip.stop();
  });

  test("H264 first, everything else after it, nothing lost: that is what the offer should prefer for a camera", () => {
    const list = ["video/VP8", "video/H264", "video/VP9", "video/AV1"].map((mimeType) => ({ mimeType }) as RTCRtpCodec);
    assert.deepEqual(h264First(list).map((c) => c.mimeType), ["video/H264", "video/VP8", "video/VP9", "video/AV1"]);
    assert.deepEqual(h264First([]), []);
    assert.equal(h264First(list).length, list.length);
  });

  test("a camera track rides in the SAME connection: two transceivers, H264 preferred on the video one, its own bitrate", async () => {
    const video = { kind: "video", readyState: "live" } as unknown as MediaStreamTrack;
    const caps = ["video/VP8", "video/H264"].map((mimeType) => ({ mimeType }) as RTCRtpCodec);
    const { whip, peers } = rig({ video, videoCodecs: () => caps });
    await whip.start();
    assert.equal(whip.state, "live");
    assert.deepEqual(peers[0].tracks, ["audio", "video"]);
    assert.deepEqual(peers[0].codecs, ["video/H264", "video/VP8"]);
    assert.deepEqual(peers[0].bits, [192000, 1_500_000]);
    await whip.stop();
  });

  test("a camera that has ended is not sent; without a camera there is one transceiver only", async () => {
    const ended = { kind: "video", readyState: "ended" } as unknown as MediaStreamTrack;
    const one = rig({ video: ended });
    await one.whip.start();
    assert.deepEqual(one.peers[0].tracks, ["audio"]);
    await one.whip.stop();
    const none = rig();
    await none.whip.start();
    assert.deepEqual(none.peers[0].tracks, ["audio"]);
    await none.whip.stop();
  });

  test("stop(): DELETE on the session the server named (a relative Location is resolved), the connection closed, state stopped; the tracks are not touched", async () => {
    const { whip, calls, peers } = rig();
    await whip.start();
    await whip.stop();
    const del = calls.find((c) => c.method === "DELETE")!;
    assert.equal(del.url, "https://example.test/live/key/whip/session-1");
    assert.equal(peers[0].closed, true);
    assert.equal(whip.state, "stopped");
  });

  test("a refusal (401/403/404/409) is NOT retried: failed, with the reason in words, one POST only", async () => {
    for (const status of [401, 403, 404, 409]) {
      const { whip, calls, peers } = rig({ statuses: [status] });
      await whip.start();
      assert.equal(whip.state, "failed", String(status));
      assert.equal(whip.detail, whipRefusal(status));
      assert.equal(calls.filter((c) => c.method === "POST").length, 1);
      assert.ok(peers[0].closed, "the connection is closed");
      await wait(30);
      assert.equal(calls.filter((c) => c.method === "POST").length, 1, "and it does not come back");
    }
    assert.match(whipRefusal(401), /no slot/);
  });

  test("a server error (5xx) is retried with the waits, then it connects", async () => {
    const { whip, calls, states } = rig({ statuses: [503, 502, 201] });
    await whip.start();
    assert.equal(whip.state, "live");
    assert.equal(calls.filter((c) => c.method === "POST").length, 3);
    assert.ok(states.some(([s, d]) => s === "reconnecting" && d.includes("503")));
    assert.equal(whip.reconnects, 2);
    await whip.stop();
  });

  test("a network error is retried too", async () => {
    let n = 0;
    const base = rig();
    const flaky = new WhipPublisher({ endpoint: "https://example.test/w", stream: { getTracks: () => [{ kind: "audio" }] } as unknown as MediaStream, retryMs: [5], gatherMs: 20, connectMs: 60,
      makePeer: () => new FakePeer(), fetchFn: async (u, i) => { if (i?.method === "POST" && n++ < 2) throw new TypeError("Failed to fetch"); return base.whip && new Response(ANSWER, { status: 201 }); } });
    await flaky.start();
    assert.equal(flaky.state, "live");
    assert.equal(n, 3);
    await flaky.stop();
  });

  test("a connection that never comes up counts as failed after connectMs and is tried again", async () => {
    const { whip, peers, states } = rig({ peerAfter: ["never", "connected"] });
    await whip.start();
    assert.equal(whip.state, "live");
    assert.equal(peers.length, 2);
    assert.ok(peers[0].closed);
    assert.ok(states.some(([s, d]) => s === "reconnecting" && d.includes("in time")));
    await whip.stop();
  });

  test("when live and the connection FAILS, it is made again (a new peer), and is live again", async () => {
    const { whip, peers, states, calls } = rig();
    await whip.start();
    peers[0].set("failed");
    await wait(80);
    assert.equal(whip.state, "live");
    assert.equal(peers.length, 2);
    assert.ok(peers[0].closed);
    assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("session-1")), "the old session is ended");
    assert.deepEqual(states.map((s) => s[0]).slice(0, 4), ["connecting", "live", "reconnecting", "live"]);
    await whip.stop();
  });

  test("a short 'disconnected' that recovers within the grace time does NOT make a new connection", async () => {
    const { whip, peers, states } = rig();
    await whip.start();
    peers[0].set("disconnected");
    assert.equal(whip.state, "reconnecting");
    await wait(8);
    peers[0].set("connected");
    await wait(40);
    assert.equal(whip.state, "live");
    assert.equal(peers.length, 1, "the same connection");
    assert.deepEqual(states.map((s) => s[0]), ["connecting", "live", "reconnecting", "live"]);
    await whip.stop();
  });

  test("'disconnected' that does not recover is made again after the grace time", async () => {
    const { whip, peers } = rig();
    await whip.start();
    peers[0].set("disconnected");
    await wait(90);
    assert.equal(peers.length, 2);
    assert.equal(whip.state, "live");
    await whip.stop();
  });

  test("stop() while reconnecting ends it quietly: no new connection afterwards", async () => {
    const { whip, peers } = rig({ statuses: [201, 503] });
    await whip.start();
    peers[0].set("failed");
    await wait(5);
    await whip.stop();
    const n = peers.length;
    await wait(40);
    assert.equal(peers.length, n, "nothing starts again after stop");
    assert.equal(whip.state, "stopped");
  });

  test("start() twice while live does nothing; after stop() it can start again", async () => {
    const { whip, peers } = rig();
    await whip.start();
    await whip.start();
    assert.equal(peers.length, 1);
    await whip.stop();
    await whip.start();
    assert.equal(whip.state, "live");
    assert.equal(peers.length, 2);
    await whip.stop();
  });
});
