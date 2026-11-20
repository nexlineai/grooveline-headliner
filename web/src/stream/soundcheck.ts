// The SOUND CHECK in the stream panel: sends the booth's master (the room, never the headphones) to the DJ's private test stream on the server, so the whole
// way (the page, the network, the proxy, the server) can be tried before a slot. Nobody hears it: the test key never reaches the radio, /live, the recorder
// or the posts. The panel shows what is true: "sending" is the connection, not "on air".
import { WHIP_BASE, readSession, fetchSoundCheckKey } from "./account.ts";
import type { Session } from "./account.ts";
import type { WhipState } from "./whip.ts";

export type CheckState = "signed-out" | "idle" | "asking" | "connecting" | "sending" | "reconnecting" | "failed";

export interface CheckView {
  state: CheckState;
  /** The button's words. */
  button: string;
  /** The panel's state chip (next to STREAM). */
  chip: string;
  /** One or two plain sentences under the facts (empty: nothing to say). */
  note: string;
  /** True while a click would STOP something. */
  stops: boolean;
}

export interface PublisherLike { start(): Promise<void>; stop(): Promise<void>; readonly state: WhipState; readonly detail: string }

export interface CheckDeps {
  session(): Session | null;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** The booth's master as a stream (null: the audio engine is not running). */
  stream(): MediaStream | null;
  makePublisher(endpoint: string, stream: MediaStream, onState: (s: WhipState, detail: string) => void): PublisherLike;
  /** Where the proxy is (default: the real one); a function so a test can point it elsewhere. */
  whipBase?(): string | undefined;
  openSignIn(): void;
  onChange(view: CheckView): void;
}

const VIEWS: Record<CheckState, Omit<CheckView, "state">> = {
  "signed-out": { button: "SIGN IN", chip: "OFF AIR", note: "Sign in on grooveline.org to try your stream.", stops: false },
  idle: { button: "SOUND CHECK", chip: "OFF AIR", note: "", stops: false },
  asking: { button: "STOP", chip: "CHECKING", note: "", stops: true },
  connecting: { button: "STOP", chip: "CONNECTING", note: "", stops: true },
  sending: { button: "STOP CHECK", chip: "SOUND CHECK", note: "Sending your master to a private test stream. Nobody hears it.", stops: true },
  reconnecting: { button: "STOP", chip: "RECONNECTING", note: "", stops: true },
  failed: { button: "SOUND CHECK", chip: "OFF AIR", note: "", stops: false },
};

export class SoundCheck {
  state: CheckState = "idle";
  private detail = "";
  private pub: PublisherLike | null = null;
  /** Bumped by every start and stop: a late answer from an older run is ignored. */
  private run = 0;
  private readonly d: CheckDeps;

  constructor(deps: CheckDeps) { this.d = deps; this.refresh(); }

  get view(): CheckView {
    const v = VIEWS[this.state];
    const showDetail = this.state === "failed" || this.state === "reconnecting" || this.state === "signed-out";
    return { state: this.state, ...v, note: showDetail && this.detail ? this.detail : v.note };
  }

  private set(state: CheckState, detail = ""): void { this.state = state; this.detail = detail; this.d.onChange(this.view); }

  /** The sign-in may have changed (another tab, a token that ran out): look again when nothing is running. */
  refresh(): void {
    if (this.pub) return;
    if (!this.d.session()) { if (this.state !== "signed-out") this.set("signed-out"); else this.d.onChange(this.view); }
    else if (this.state === "signed-out") this.set("idle");
    else this.d.onChange(this.view);
  }

  /** The button: sign in, start, or stop, as the view says. */
  async toggle(): Promise<void> {
    if (this.state === "signed-out") { this.d.openSignIn(); return; }
    if (this.view.stops) { await this.stop(); return; }
    await this.start();
  }

  async start(): Promise<void> {
    const run = ++this.run;
    const session = this.d.session();
    if (!session) { this.set("signed-out", "Sign in on grooveline.org to try your stream."); return; }
    const stream = this.d.stream();
    if (!stream) { this.set("failed", "The audio is not running yet: start a record first."); return; }
    this.set("asking");
    const got = await fetchSoundCheckKey(session, this.d.fetchFn);
    if (run !== this.run) return;
    if (!got.ok) { this.set(got.reason === "signed-out" ? "signed-out" : "failed", got.reason === "signed-out" ? "Your sign-in has run out: sign in again." : got.detail); return; }
    this.set("connecting");
    const pub = this.d.makePublisher(`${this.d.whipBase?.() ?? WHIP_BASE}/live/${got.key}/whip`, stream, (s, why) => {
      if (run !== this.run || pub !== this.pub) return;
      if (s === "live") this.set("sending");
      else if (s === "connecting") this.set("connecting");
      else if (s === "reconnecting") this.set("reconnecting", why);
      else if (s === "failed") { this.pub = null; this.set("failed", why); }
    });
    this.pub = pub;
    await pub.start();
    if (run !== this.run) return;
    if (pub.state === "live" && this.state !== "sending") this.set("sending");
  }

  async stop(): Promise<void> {
    this.run++;
    const pub = this.pub;
    this.pub = null;
    if (pub) await pub.stop().catch(() => {});
    this.set(this.d.session() ? "idle" : "signed-out");
  }
}
