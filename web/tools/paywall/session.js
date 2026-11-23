// The player's session: a signed cookie, nothing stored on the server. It says WHO (id and email),
// never what they own: ownership always comes from the database (accounts.js), so a refund takes
// effect without touching any cookie.
import { b64url, fromB64url, hmac, hmacOk } from "./crypto.js";

export const SESSION_COOKIE = "hl_s";
/** A browser that wants the paywall on before it is on for everyone (the dark launch, see index.js). */
export const PREVIEW_COOKIE = "hl_pw";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

export async function makeSession(secret, player, now = Date.now(), days = SESSION_DAYS) {
  const body = b64url(enc.encode(JSON.stringify({ p: player.id, e: player.email, x: Math.floor(now / 1000) + days * 86400 })));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

/** The {p, e} of a good, unexpired cookie value, else null. */
export async function readSession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  try {
    if (!(await hmacOk(secret, body, fromB64url(sig)))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (typeof p.p !== "string" || typeof p.e !== "string" || !(p.x > Math.floor(now / 1000))) return null;
    return { p: p.p, e: p.e };
  } catch {
    return null;
  }
}

export function cookieValue(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Set-Cookie text. Path /headliner: the game, its API and its media, nothing else on the site. */
export function setCookie(name, value, { maxAge = SESSION_DAYS * 86400, httpOnly = true } = {}) {
  return `${name}=${value}; Path=/headliner; Max-Age=${maxAge}; ${httpOnly ? "HttpOnly; " : ""}Secure; SameSite=Lax`;
}
export const clearCookie = (name) => setCookie(name, "", { maxAge: 0 });
