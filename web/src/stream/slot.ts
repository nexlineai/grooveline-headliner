// The DJ's next slot, as the Worker's GET /me/next-slot gives it, and what the page makes of it. Times come from the SERVER ("now" in the answer): the page keeps the
// difference to the laptop's clock and counts from the server's time, so a wrong laptop clock cannot open or close a slot.
import { API_BASE } from "./account.ts";
import type { Session } from "./account.ts";

export type Phase = "later" | "early" | "on" | "over";

export interface Slot {
  id: string; start: string; end: string; window_start: string;
  /** What the server said at the time of the answer; `phaseAt` recomputes it as the clock moves. */
  phase: Exclude<Phase, "over">;
  opens_in_s: number; description: string; stream_type: string;
}
export interface Ingest { whip_url: string; audio: { codec: string; bitrate: number } }
export interface NextSlot { now: string; slot: Slot | null; ingest: Ingest | null }

export type SlotResult =
  | { ok: true; data: NextSlot; offset: number }
  | { ok: false; reason: "signed-out" | "unavailable" | "offline"; detail: string };

/** The sync agent lets a key publish from 15 minutes before the start; the radio takes the audio until the end. */
export const WINDOW_MS = 15 * 60_000;

export async function fetchNextSlot(session: Session, fetchFn: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i), nowFn: () => number = Date.now): Promise<SlotResult> {
  const sent = nowFn();
  let res: Response;
  try { res = await fetchFn(`${API_BASE}/me/next-slot`, { headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json" } }); }
  catch { return { ok: false, reason: "offline", detail: "Could not reach grooveline.org." }; }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "signed-out", detail: "Your sign-in has run out: sign in again." };
  // 404: the Worker has no such route yet (not deployed).
  if (!res.ok) return { ok: false, reason: "unavailable", detail: res.status === 404 ? "Going live from the page is not available yet." : "Your slot could not be read right now." };
  let body: Partial<NextSlot> | null = null;
  try { body = (await res.json()) as Partial<NextSlot>; } catch { /* below */ }
  const serverMs = Date.parse(String(body?.now ?? ""));
  if (!body || !Number.isFinite(serverMs)) return { ok: false, reason: "unavailable", detail: "Your slot could not be read right now." };
  const slot = body.slot ?? null;
  if (slot && (!Number.isFinite(Date.parse(slot.start)) || !Number.isFinite(Date.parse(slot.end)) || typeof slot.id !== "string")) return { ok: false, reason: "unavailable", detail: "Your slot could not be read right now." };
  const ingest = body.ingest && typeof body.ingest.whip_url === "string" && body.ingest.whip_url.startsWith("https://") ? body.ingest : null;
  // The server's time at the middle of the call, against the laptop's: the difference is how much the laptop is off.
  const offset = serverMs - (sent + (nowFn() - sent) / 2);
  return { ok: true, data: { now: String(body.now), slot, ingest }, offset };
}

/** The phase at a moment of the SERVER's clock. */
export function phaseAt(slot: Pick<Slot, "start" | "end">, serverMs: number): Phase {
  const start = Date.parse(slot.start), end = Date.parse(slot.end);
  if (serverMs >= end) return "over";
  if (serverMs >= start) return "on";
  return serverMs >= start - WINDOW_MS ? "early" : "later";
}

/** "2 h 10 min", "9 min", "40 s": how long until `ms` from now, in words (rounded up to what matters). */
export function inWords(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 120) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** The slot in a line for the panel: when it is (the DJ's own local time) and how far away or how long left. */
export function slotLine(slot: Slot | null, serverMs: number, locale?: string): string {
  if (!slot) return "none booked";
  const start = Date.parse(slot.start), end = Date.parse(slot.end);
  const hm = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = new Date(start).toLocaleDateString(locale, { weekday: "short" });
  const sameDay = new Date(start).toDateString() === new Date(serverMs).toDateString();
  const when = `${sameDay ? "" : day + " "}${hm(start)}–${hm(end)}`;
  const phase = phaseAt(slot, serverMs);
  if (phase === "on") return `${when} · now`;
  return `${when} · in ${inWords(start - serverMs)}`;
}
