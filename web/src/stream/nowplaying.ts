// What the booth is playing, for the site's player. The radio's own stream cannot carry a title (an Ogg mount takes none from outside, and the web show's audio is re-encoded on the
// server), so while the show is sending the page tells the Worker (POST /me/now-playing) and the site reads it from /live as `now_playing`.
// Which deck counts as "playing": the one the ROOM hears (channel fader x crossfader, as the engine's deck volume), really playing, with a title. When the other deck becomes clearly
// louder it takes over only after HOLD_MS, so a blend does not make the title flicker. Nothing audible: nothing is sent (the Worker forgets the last title after four minutes).
import { API_BASE } from "./account.ts";
import type { Session } from "./account.ts";

export interface DeckNow { playing: boolean; /** 0...1: how much of this deck the room hears. */ level: number; artist: string; title: string }
export interface Now { artist: string; title: string }

/** Below this level a deck is not in the room. */
export const AUDIBLE = 0.12;
/** The other deck must stay clearly louder for this long before the title changes. */
export const HOLD_MS = 8000;
/** The same title is sent again this often (the Worker forgets a title after four minutes without one). */
export const HEARTBEAT_MS = 60_000;
/** After a failed send, wait this long before trying again. */
export const RETRY_MS = 15_000;

const clip = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);

export class NowPlayingPicker {
  private current: number | null = null;
  private candidate: number | null = null;
  private since = 0;

  pick(decks: DeckNow[], nowMs: number): Now | null {
    const audible = decks.map((d, i) => ({ i, d })).filter(({ d }) => d.playing && d.level >= AUDIBLE && clip(d.title) !== "");
    if (!audible.length) { this.current = null; this.candidate = null; return null; }
    audible.sort((a, b) => b.d.level - a.d.level);
    const best = audible[0];
    const cur = audible.find((x) => x.i === this.current);
    if (!cur) { this.current = best.i; this.candidate = null; }
    else if (best.i !== this.current && best.d.level > cur.d.level * 1.25) {
      if (this.candidate !== best.i) { this.candidate = best.i; this.since = nowMs; }
      else if (nowMs - this.since >= HOLD_MS) { this.current = best.i; this.candidate = null; }
    } else this.candidate = null;
    const d = decks[this.current as number];
    return { artist: clip(d.artist), title: clip(d.title) };
  }

  reset(): void { this.current = null; this.candidate = null; }
}

export interface NowPlayingDeps {
  session(): Session | null;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** The booking being sent for, or null when nothing is sending (a sound check has none). */
  bookingId(): string | null;
  decks(): DeckNow[];
  now?(): number;
}

export class NowPlaying {
  private readonly picker = new NowPlayingPicker();
  private sent = "";
  private sentAt = 0;
  private retryAt = 0;
  private inFlight = false;
  private readonly d: NowPlayingDeps;
  constructor(deps: NowPlayingDeps) { this.d = deps; }

  /** Once a second while the show is sending. */
  async tick(): Promise<void> {
    const nowMs = (this.d.now ?? Date.now)();
    const id = this.d.bookingId();
    if (!id) { this.picker.reset(); this.sent = ""; return; }
    const session = this.d.session();
    if (!session) return;
    const now = this.picker.pick(this.d.decks(), nowMs);
    if (!now) return;
    const key = `${id}\n${now.artist}\n${now.title}`;
    if (this.inFlight || nowMs < this.retryAt) return;
    if (key === this.sent && nowMs - this.sentAt < HEARTBEAT_MS) return;
    this.inFlight = true;
    try {
      const res = await (this.d.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i)))(`${API_BASE}/me/now-playing`, {
        method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ booking_id: id, artist: now.artist, title: now.title }),
      });
      if (res.ok) { this.sent = key; this.sentAt = nowMs; this.retryAt = 0; } else this.retryAt = nowMs + RETRY_MS;
    } catch { this.retryAt = nowMs + RETRY_MS; /* offline: tried again after RETRY_MS */ }
    finally { this.inFlight = false; }
  }
}
