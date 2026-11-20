// WHIP publisher: sends a MediaStream (the booth's master, later a camera too) to a WHIP endpoint (MediaMTX) over one WebRTC connection (RFC 9725).
//
//   1. one peer connection, the tracks added send-only, Opus tuned for music (stereo, a fixed bitrate, no DTX);
//   2. the offer goes out once ICE gathering is done (no trickle: MediaMTX takes a complete offer) as `POST <endpoint>` with `Content-Type: application/sdp`;
//   3. the answer comes back with 201 and a `Location` (the session); `DELETE <Location>` ends it;
//   4. when the connection drops, it is made again with a growing wait, until stop(); an answer of 400/401/403/404/409/422 is NOT retried (the
//      server said no: wrong key, no slot now), the state says why.
//
// The state is what the page shows ("connecting", "live", "reconnecting", "failed"); the page never trusts it as "we are on air": the stream panel's ON AIR comes
// from the server's /live (the "flag trusted over reality" lesson). Everything the browser provides (fetch, the peer connection, timers) can be handed in, so the
// state machine is tested without a browser (test/whip.test.ts) and with a real one (web/tools/pagetests/whip-local.*).

export type WhipState = "idle" | "connecting" | "live" | "reconnecting" | "failed" | "stopped";

/** What the publisher uses of an RTCPeerConnection (so a test can stand one in). */
export interface WhipPeer {
  connectionState: string;
  iceGatheringState: string;
  localDescription: { sdp?: string } | null;
  onconnectionstatechange: ((e?: unknown) => void) | null;
  onicegatheringstatechange: ((e?: unknown) => void) | null;
  addTransceiver(track: MediaStreamTrack, init: { direction: "sendonly"; streams?: MediaStream[] }): { sender: { getParameters(): unknown; setParameters(p: never): Promise<void> } };
  createOffer(): Promise<{ type: "offer"; sdp?: string }>;
  setLocalDescription(d: { type: "offer"; sdp?: string }): Promise<void>;
  setRemoteDescription(d: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
}

export interface WhipOptions {
  /** The WHIP endpoint, for MediaMTX `https://<host>/whip/live/<stream key>/whip` (or `http://127.0.0.1:8889/live/<key>/whip` on this machine). */
  endpoint: string;
  /** What to send. */
  stream: MediaStream;
  /** Opus bits per second for the audio (stereo music: 128 000 to 256 000). */
  audioBitrate?: number;
  /** Waits (ms) between attempts to connect again; the last one is repeated until stop(). */
  retryMs?: number[];
  /** ICE gathering may take this long (ms) before the offer is sent with the candidates there are. */
  gatherMs?: number;
  /** A connection must be up this long (ms) after the answer, or it counts as failed. */
  connectMs?: number;
  /** "disconnected" gets this long (ms) to come back before the connection is made again. */
  graceMs?: number;
  iceServers?: RTCIceServer[];
  /** Extra headers on the WHIP requests (for example a bearer token). */
  headers?: Record<string, string>;
  onState?: (state: WhipState, detail: string) => void;
  /** For tests. */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  makePeer?: (config: RTCConfiguration) => WhipPeer;
}

/** The server said no: trying again changes nothing. */
const FATAL = new Set([400, 401, 403, 404, 409, 422]);

/** Why each of those means what it means for a DJ, in plain words. */
export function whipRefusal(status: number): string {
  switch (status) {
    case 401: case 403: return "The server did not allow this stream: there is no slot for this key right now.";
    case 404: return "The server has no stream at that address.";
    case 409: return "Someone is already sending to this stream.";
    case 400: case 422: return "The server did not understand the connection offer.";
    default: return `The server answered ${status}.`;
  }
}

/** Opus tuned for music: stereo, a fixed bitrate, forward error correction on, discontinuous transmission off (DTX cuts the sound in quiet passages). Other lines stay. */
export function tuneOpusSdp(sdp: string, bitrate: number): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const rtpmap = lines.find((l) => /^a=rtpmap:\d+ opus\/48000\/2/i.test(l));
  if (!rtpmap) return sdp;
  const pt = /^a=rtpmap:(\d+) /.exec(rtpmap)![1];
  const want: Record<string, string> = { stereo: "1", "sprop-stereo": "1", maxaveragebitrate: String(Math.round(bitrate)), useinbandfec: "1", usedtx: "0", maxplaybackrate: "48000" };
  const at = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
  if (at >= 0) {
    const have = new Map<string, string>();
    for (const part of lines[at].slice(`a=fmtp:${pt} `.length).split(";")) { const [k, v] = part.split("="); if (k.trim()) have.set(k.trim(), (v ?? "").trim()); }
    for (const [k, v] of Object.entries(want)) have.set(k, v);
    lines[at] = `a=fmtp:${pt} ${[...have].map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join(";")}`;
  } else {
    lines.splice(lines.indexOf(rtpmap) + 1, 0, `a=fmtp:${pt} ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(";")}`);
  }
  return lines.join(eol);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class WhipPublisher {
  state: WhipState = "idle";
  detail = "";
  /** How many times the connection was made again since start(). */
  reconnects = 0;
  private o: Required<Pick<WhipOptions, "endpoint" | "stream" | "audioBitrate" | "retryMs" | "gatherMs" | "connectMs" | "graceMs">> & WhipOptions;
  private pc: WhipPeer | null = null;
  private resource: string | null = null;
  /** Each start()/stop() bumps this: work from an older run stops quietly. */
  private run = 0;

  constructor(options: WhipOptions) {
    this.o = { audioBitrate: 192_000, retryMs: [1000, 2000, 4000, 8000, 15000], gatherMs: 2500, connectMs: 12_000, graceMs: 4000, ...options };
  }

  private set(state: WhipState, detail = ""): void {
    this.state = state; this.detail = detail;
    this.o.onState?.(state, detail);
  }

  /** Begins sending. Resolves when it is live, or the server refused (state "failed" and why), or stop() was called; until then it keeps trying. */
  async start(): Promise<void> {
    if (this.state === "connecting" || this.state === "live" || this.state === "reconnecting") return;
    const run = ++this.run;
    this.reconnects = 0;
    this.set("connecting");
    await this.attempt(run);
  }

  /** Ends the session on the server (DELETE) and closes the connection. The stream's tracks are the caller's: they are not stopped. */
  async stop(): Promise<void> {
    this.run++;
    const was = this.state;
    await this.teardown();
    if (was !== "idle") this.set("stopped");
  }

  /** Connects; a failure the server did not cause (no network, a timeout, a 5xx) is tried again with a growing wait, until stop(). Resolves when live, refused or stopped. */
  private async attempt(run: number): Promise<void> {
    for (let wait = 0; ; wait++) {
      if (run !== this.run) return;
      try {
        await this.connect(run);
        return;
      } catch (e) {
        if (run !== this.run) return;
        await this.teardown();
        if (e instanceof WhipRefused) { this.set("failed", e.message); return; }
        const reason = e instanceof Error ? e.message : String(e);
        this.set("reconnecting", reason);
        const waits = this.o.retryMs;
        await sleep(waits[Math.min(wait, waits.length - 1)] ?? 1000);
        if (run !== this.run) return;
        this.reconnects++;
      }
    }
  }

  private async connect(run: number): Promise<void> {
    const { endpoint, stream, audioBitrate } = this.o;
    const make = this.o.makePeer ?? ((c: RTCConfiguration) => new RTCPeerConnection(c) as unknown as WhipPeer);
    const pc = make({ iceServers: this.o.iceServers ?? [], bundlePolicy: "max-bundle" });
    this.pc = pc;
    for (const track of stream.getTracks()) {
      const t = pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      if (track.kind === "audio") {
        const params = t.sender.getParameters() as { encodings?: { maxBitrate?: number }[] };
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = audioBitrate;
        await t.sender.setParameters(params as never).catch(() => {});
      }
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription({ type: "offer", sdp: tuneOpusSdp(offer.sdp ?? "", audioBitrate) });
    await this.gathered(pc);
    if (run !== this.run) throw new Error("cancelled");
    const doFetch = this.o.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i));
    const res = await doFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/sdp", ...this.o.headers }, body: pc.localDescription?.sdp ?? "" });
    if (!res.ok) {
      if (FATAL.has(res.status)) throw new WhipRefused(res.status);
      throw new Error(`The server answered ${res.status}.`);
    }
    const location = res.headers.get("Location");
    this.resource = location ? new URL(location, endpoint).toString() : null;
    const answer = await res.text();
    if (run !== this.run) throw new Error("cancelled");
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    await this.up(pc, run);
    this.set("live");
    this.watch(pc, run);
  }

  /** The offer waits for the candidates (a complete offer, no trickle), but not longer than `gatherMs`. */
  private gathered(pc: WhipPeer): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { pc.onicegatheringstatechange = null; clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, this.o.gatherMs);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") done(); };
    });
  }

  /** Resolves when the connection is up; rejects when it fails or takes longer than `connectMs`. */
  private up(pc: WhipPeer, run: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pc.onconnectionstatechange = null; reject(new Error("The connection did not come up in time.")); }, this.o.connectMs);
      const check = () => {
        if (run !== this.run) { clearTimeout(timer); reject(new Error("cancelled")); return; }
        if (pc.connectionState === "connected") { clearTimeout(timer); pc.onconnectionstatechange = null; resolve(); }
        else if (pc.connectionState === "failed" || pc.connectionState === "closed") { clearTimeout(timer); pc.onconnectionstatechange = null; reject(new Error("The connection failed.")); }
      };
      pc.onconnectionstatechange = check;
      check();
    });
  }

  /** Once live: a dropped connection is made again. */
  private watch(pc: WhipPeer, run: number): void {
    let grace: ReturnType<typeof setTimeout> | null = null;
    const lost = (why: string) => {
      if (run !== this.run || pc !== this.pc) return;
      pc.onconnectionstatechange = null;
      this.set("reconnecting", why);
      void this.teardown().then(() => { if (run === this.run) void this.attempt(run); });
    };
    pc.onconnectionstatechange = () => {
      if (run !== this.run || pc !== this.pc) return;
      const s = pc.connectionState;
      if (s === "connected") { if (grace) { clearTimeout(grace); grace = null; } if (this.state !== "live") this.set("live"); return; }
      if (s === "failed") { if (grace) clearTimeout(grace); lost("The connection failed."); return; }
      if (s === "disconnected" && !grace) {
        this.set("reconnecting", "The connection is unstable.");
        grace = setTimeout(() => { grace = null; if (pc.connectionState !== "connected") lost("The connection was lost."); }, this.o.graceMs);
      }
    };
  }

  private async teardown(): Promise<void> {
    const pc = this.pc, resource = this.resource;
    this.pc = null; this.resource = null;
    if (pc) { pc.onconnectionstatechange = null; pc.onicegatheringstatechange = null; try { pc.close(); } catch { /* closed already */ } }
    if (resource) {
      const doFetch = this.o.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i));
      await doFetch(resource, { method: "DELETE", headers: this.o.headers }).catch(() => {}); // best effort: the server drops a silent session by itself
    }
  }
}

/** A refusal that trying again will not change. */
class WhipRefused extends Error {
  status: number;
  constructor(status: number) { super(whipRefusal(status)); this.status = status; }
}
