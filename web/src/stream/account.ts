// The DJ's grooveline.org account, from the page's point of view. The site's /broadcast signs in and keeps the token in localStorage ("gl_token"); the
// Headliner page is on the same origin (grooveline.org/headliner), so it reads the same token and nothing here asks for a password.
// The token is a JWT whose payload carries `exp` in MILLISECONDS (the Worker's createJWT), signed by the server: the page only reads it, never trusts it
// for anything but "is it worth asking the server": the server checks it on every call.

export const API_BASE = "https://api.grooveline.org";
export const WHIP_BASE = "https://stream.grooveline.org/whip";
/** The page for signing in. */
export const SIGN_IN_URL = "https://grooveline.org/broadcast";

export interface Session { token: string; expires: number; name: string }

/** The payload of a JWT (no check of the signature: the server does that). Null if it is not one. */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    // Exactly as the Worker's own verifyJWT reads it (JSON.parse(atob(body))): the Worker writes the body with btoa, so it is LATIN-1, one byte a character:
    // an accent such as "é" is the single byte 0xE9, and atob gives it back as "é". (Decoding as UTF-8 would garble it.)
    const p = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch { return null; }
}

/** The signed-in DJ, or null: no token, a token that is not a JWT, or one that has run out (a minute early, so a call does not start with a dying token). */
export function readSession(storage: Pick<Storage, "getItem"> | null, now = Date.now()): Session | null {
  let token: string | null = null;
  try { token = storage?.getItem("gl_token") ?? null; } catch { return null; }
  if (!token) return null;
  const p = jwtPayload(token);
  if (!p) return null;
  const expires = typeof p.exp === "number" ? p.exp : 0;
  if (expires - 60_000 <= now) return null;
  return { token, expires, name: typeof p.dj_name === "string" ? p.dj_name : "" };
}

export type ApiFailure = "signed-out" | "unavailable" | "offline";
export type KeyResult = { ok: true; key: string } | { ok: false; reason: ApiFailure; detail: string };

/** The sound-check video key: private to this account, always valid, never reaches the radio (the Worker's /check/mount). */
export async function fetchSoundCheckKey(session: Session, fetchFn: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): Promise<KeyResult> {
  let res: Response;
  try {
    res = await fetchFn(`${API_BASE}/check/mount`, { headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json" } });
  } catch {
    return { ok: false, reason: "offline", detail: "Could not reach grooveline.org." };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "signed-out", detail: "Your sign-in has run out." };
  if (!res.ok) return { ok: false, reason: "unavailable", detail: "The sound check is not available right now." };
  let body: { video_key?: unknown } | null = null;
  try { body = (await res.json()) as { video_key?: unknown }; } catch { /* handled below */ }
  const key = typeof body?.video_key === "string" ? body.video_key : "";
  // The same shape the Broadcaster app insists on: nothing else may be sent to the test path.
  if (!/^vcheck-[0-9a-f]{20}$/.test(key)) return { ok: false, reason: "unavailable", detail: "The video sound check is not available for this account." };
  return { ok: true, key };
}
