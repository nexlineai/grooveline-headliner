// GO LIVE for a booked slot: the booth's master (the room, never the headphones) to the radio, from the browser. The page never trusts its own idea of being on air:
//   CONNECTED   the WebRTC connection to the server is up ("sending")
//   ON AIR      the server's /live names THIS booking as live (the radio has a source on the DJ's mount). Only then does the panel say ON AIR.
// The slot's times are the server's (see slot.ts). Going live in the 15 minutes before the start puts the DJ on the radio at once, so it takes a second click.
// At the slot's end the audio stops (the radio's credentials expire then: later audio would reach nobody) and the panel says so.
import { API_BASE } from "./account.ts";
import type { Session } from "./account.ts";
import { fetchNextSlot, inWords, phaseAt, slotLine } from "./slot.ts";
import type { Ingest, Slot } from "./slot.ts";
import type { PublisherLike } from "./soundcheck.ts";
import type { WhipState } from "./whip.ts";

export type LiveState = "signed-out" | "loading" | "unavailable" | "none" | "later" | "early" | "on" | "confirming" | "connecting" | "sending" | "onair" | "reconnecting" | "failed" | "ended";

export interface LiveView {
  state: LiveState;
  button: string;
  enabled: boolean;
  /** True while a click would END something. */
  stops: boolean;
  chip: string;
  /** The SLOT row of the panel. */
  slot: string;
  note: string;
  /** Laptop clock time when the server first said ON AIR (for the timer), else null. */
  onAirSince: number | null;
}

export interface LiveDeps {
  session(): Session | null;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  stream(): MediaStream | null;
  makePublisher(endpoint: string, stream: MediaStream, onState: (s: WhipState, detail: string) => void): PublisherLike;
  now?(): number;
  /** Something else that uses the master (the sound check) is stopped before going live. */
  beforeGo?(): Promise<void> | void;
  onChange(view: LiveView): void;
  /** How long the second click of the early window has. */
  confirmMs?: number;
}

const BUSY = new Set<LiveState>(["connecting", "sending", "onair", "reconnecting"]);

export class GoLive {
  state: LiveState = "loading";
  private slot: Slot | null = null;
  private ingest: Ingest | null = null;
  private offset = 0;
  private failure = "";
  private detail = "";
  private pub: PublisherLike | null = null;
  private run = 0;
  private onAirSince: number | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  /** A show was cut off by the slot's end: the panel keeps saying so (instead of "no slot booked") until another slot shows up. */
  private keepEnded = false;
  private last = "";
  private readonly d: LiveDeps;

  constructor(deps: LiveDeps) { this.d = deps; }

  private nowMs(): number { return (this.d.now ?? Date.now)(); }
  /** The server's time now. */
  get serverNow(): number { return this.nowMs() + this.offset; }
  get busy(): boolean { return BUSY.has(this.state); }
  /** Nothing is running and no second click is awaited (a method, so a check after an await is a fresh one). */
  private idle(): boolean { return !this.busy && this.state !== "confirming"; }

  get view(): LiveView {
    const st = this.state, slot = this.slot, server = this.serverNow;
    const line = st === "loading" || st === "signed-out" || st === "unavailable" ? "—" : slotLine(slot, server);
    const until = slot ? inWords(Date.parse(slot.start) - server) : "";
    const v = (button: string, enabled: boolean, stops: boolean, chip: string, note: string): LiveView => ({ state: st, button, enabled, stops, chip, slot: line, note: this.failure && !stops ? this.failure : note, onAirSince: this.onAirSince });
    switch (st) {
      case "signed-out": return v("GO LIVE", false, false, "OFF AIR", "");
      case "loading": return v("GO LIVE", false, false, "OFF AIR", "");
      case "unavailable": return v("GO LIVE", false, false, "OFF AIR", this.detail);
      case "none": return v("GO LIVE", false, false, "OFF AIR", "No slot booked. Book one on grooveline.org/broadcast.");
      case "later": return v("GO LIVE", false, false, "OFF AIR", "GO LIVE opens 15 minutes before your slot. Until then, the SOUND CHECK.");
      case "early": return v("GO LIVE", true, false, "OFF AIR", `Your slot starts in ${until}. Going live now puts you on the radio at once.`);
      case "confirming": return v("ON AIR NOW?", true, false, "OFF AIR", `Click again to go on the radio now. Your slot starts in ${until}.`);
      case "on": return v("GO LIVE", true, false, "OFF AIR", "Your slot is running.");
      case "connecting": return v("CANCEL", true, true, "CONNECTING", "");
      case "sending": return v("END SHOW", true, true, "SENDING", "Connected. Waiting for the radio to list you.");
      case "onair": return v("END SHOW", true, true, "ON AIR", "You are on the radio.");
      case "reconnecting": return v("END SHOW", true, true, "RECONNECTING", this.detail);
      case "failed": return v("GO LIVE", true, false, "OFF AIR", this.detail);
      case "ended": return v("GO LIVE", false, false, "OFF AIR", "Your slot has ended. The radio is back to its own music.");
    }
  }

  private emit(): void {
    const v = this.view, key = JSON.stringify(v);
    if (key === this.last) return;
    this.last = key;
    this.d.onChange(v);
  }
  private set(state: LiveState, detail = ""): void { this.state = state; this.detail = detail; this.emit(); }

  /** Reads the slot again (the page does this every half minute while nothing is running, and after anything changes). */
  async refresh(): Promise<void> {
    if (!this.idle()) return;
    const session = this.d.session();
    if (!session) { this.slot = null; this.ingest = null; this.set("signed-out"); return; }
    const got = await fetchNextSlot(session, this.d.fetchFn, () => this.nowMs());
    if (!this.idle()) return; // started meanwhile
    if (!got.ok) {
      if (got.reason === "signed-out") { this.set("signed-out"); return; }
      if (got.reason === "offline" && this.slot) { this.emit(); return; } // keep what we know; the countdown still runs on the last server time
      this.slot = null; this.ingest = null; this.set("unavailable", got.detail); return;
    }
    this.offset = got.offset; this.slot = got.data.slot; this.ingest = got.data.ingest;
    this.settle();
  }

  /** The state of an idle panel from the slot and the server's clock. */
  private settle(): void {
    if (!this.slot) { this.set(this.keepEnded && this.state === "ended" ? "ended" : "none"); return; }
    this.keepEnded = false;
    const phase = phaseAt(this.slot, this.serverNow);
    if (phase === "over") { this.slot = null; this.ingest = null; this.set("ended"); return; }
    this.set(phase);
  }

  /** Once a second: the countdown moves, the window opens, the slot ends. */
  tick(): void {
    if (!this.slot) return;
    const phase = phaseAt(this.slot, this.serverNow);
    if (this.busy) { if (phase === "over") void this.endAtSlotEnd(); else this.emit(); return; }
    if (this.state === "confirming") { if (phase === "over") { this.clearConfirm(); this.settle(); } else this.emit(); return; }
    if (this.state === "later" || this.state === "early" || this.state === "on") {
      if (phase !== this.state) { if (phase === "over") { this.settle(); void this.refresh(); } else this.set(phase); } else this.emit();
    }
  }

  /** The button: sign in is the SOUND CHECK's; this one starts, confirms or ends. */
  async toggle(): Promise<void> {
    switch (this.state) {
      case "early": this.askConfirm(); return;
      case "confirming": this.clearConfirm(); await this.go(); return;
      case "on": await this.go(); return;
      case "failed": this.failure = ""; await this.refresh(); return;
      case "connecting": case "sending": case "onair": case "reconnecting": await this.stop(); return;
      default: return;
    }
  }

  private askConfirm(): void {
    this.set("confirming");
    this.confirmTimer = setTimeout(() => { this.confirmTimer = null; if (this.state === "confirming") this.settle(); }, this.d.confirmMs ?? 6000);
  }
  private clearConfirm(): void { if (this.confirmTimer) { clearTimeout(this.confirmTimer); this.confirmTimer = null; } }

  private async go(): Promise<void> {
    const run = ++this.run;
    this.failure = ""; this.keepEnded = false;
    const ingest = this.ingest;
    if (!ingest || !this.slot) { await this.refresh(); return; }
    this.set("connecting");
    await this.d.beforeGo?.();
    if (run !== this.run) return;
    const stream = this.d.stream();
    if (!stream) { this.set("failed", "The audio is not running yet: start a record first."); return; }
    const pub = this.d.makePublisher(ingest.whip_url, stream, (s, why) => {
      if (run !== this.run || pub !== this.pub) return;
      if (s === "live") { if (this.state !== "onair") this.set("sending"); }
      else if (s === "connecting") this.set("connecting");
      else if (s === "reconnecting") this.set("reconnecting", why);
      else if (s === "failed") { this.pub = null; this.onAirSince = null; this.set("failed", why); }
    });
    this.pub = pub;
    await pub.start();
    if (run !== this.run) return;
    if (pub.state === "live" && this.state === "connecting") this.set("sending");
  }

  /** Ends the show on purpose (or cancels a connection that is still being made). */
  async stop(): Promise<void> {
    this.run++;
    this.clearConfirm();
    const pub = this.pub;
    this.pub = null; this.onAirSince = null;
    if (pub) await pub.stop().catch(() => {});
    this.settle(); // back to what the slot says (the state was a busy one, which refresh() would not leave), then read it fresh
    await this.refresh();
  }

  /** The slot's end, with the show still going: the audio stops now. */
  private async endAtSlotEnd(): Promise<void> {
    this.run++;
    const pub = this.pub;
    this.pub = null; this.onAirSince = null;
    if (pub) await pub.stop().catch(() => {});
    this.slot = null; this.ingest = null;
    this.keepEnded = true;
    this.set("ended");
    void this.refresh(); // the next booking, if any
  }

  /** The radio's own word: is /live naming this booking? (The page calls it every few seconds while it is sending.) */
  async pollLive(): Promise<void> {
    if (!this.pub || !this.slot || !(this.state === "sending" || this.state === "onair")) return;
    const run = this.run, slot = this.slot;
    let live = false;
    try {
      const res = await (this.d.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i)))(`${API_BASE}/live`, { headers: { Accept: "application/json" } });
      if (res.ok) { const b = (await res.json()) as { live?: boolean; booking_id?: string }; live = b.live === true && b.booking_id === slot.id; }
    } catch { return; } // unknown: leave the state as it is
    if (run !== this.run || !this.pub) return;
    if (live) { if (this.state !== "onair") { this.onAirSince = this.nowMs(); this.set("onair"); } }
    else if (this.state === "onair") { this.onAirSince = null; this.set("sending"); }
  }
}
