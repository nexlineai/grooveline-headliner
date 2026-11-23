// The database side (D1 "headliner-db", migrations/): players, sign-in links, what they own.
import { randomToken } from "./crypto.js";

export const PRODUCT = "career";

export const normEmail = (e) => String(e ?? "").trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

/** Fixed-window limiter. Returns true when the request is ALLOWED; a database error allows it (the
 * limiter must never be the reason nobody can sign in), the sign-in itself needs the database anyway. */
export async function rateLimit(env, bucket, max, windowSec, now = Date.now()) {
  try {
    const t = Math.floor(now / 1000);
    const row = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE bucket = ?").bind(bucket).first();
    if (!row || t - row.window_start >= windowSec) {
      await env.DB.prepare("INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = ?")
        .bind(bucket, t, t).run();
      return true;
    }
    if (row.count >= max) return false;
    await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").bind(bucket).run();
    return true;
  } catch (e) {
    console.error("[ratelimit] failing open:", e?.message);
    return true;
  }
}

export async function addLink(env, tokenHash, email, next, now = Date.now(), ttlMs = 15 * 60 * 1000) {
  await env.DB.prepare("DELETE FROM login_links WHERE expires_at < ?").bind(now - 24 * 3600 * 1000).run(); // old rows, a day after they ran out
  await env.DB.prepare("INSERT INTO login_links (token_hash, email, next, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(tokenHash, email, next, now, now + ttlMs).run();
}
/** A link that is still good, without using it. */
export async function peekLink(env, tokenHash, now = Date.now()) {
  return env.DB.prepare("SELECT email, next FROM login_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(tokenHash, now).first();
}
/** Uses a link once: {email, next}, or null when it is unknown, expired or already used. */
export async function useLink(env, tokenHash, now = Date.now()) {
  const done = await env.DB.prepare("UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(now, tokenHash, now).run();
  if (done.meta?.changes !== 1) return null;
  return env.DB.prepare("SELECT email, next FROM login_links WHERE token_hash = ?").bind(tokenHash).first();
}

/** The player with this email (made when there is none yet). */
export async function playerByEmail(env, email, now = Date.now()) {
  await env.DB.prepare("INSERT OR IGNORE INTO players (id, email, created_at) VALUES (?, ?, ?)").bind(randomToken(12), email, now).run();
  return env.DB.prepare("SELECT id, email FROM players WHERE email = ?").bind(email).first();
}
export async function playerById(env, id) {
  return env.DB.prepare("SELECT id, email FROM players WHERE id = ?").bind(id).first();
}
export async function touchLogin(env, id, now = Date.now()) {
  await env.DB.prepare("UPDATE players SET last_login = ? WHERE id = ?").bind(now, id).run();
}

// Ownership. Only a YES is remembered (by this isolate, for a minute): Paddle's success page can be
// shown before its notification arrives, and a remembered NO would keep a buyer locked out.
const yes = new Map();
const YES_MS = 60 * 1000;
export function forgetOwnership() { yes.clear(); }

export async function owns(env, playerId, { fresh = false, now = Date.now() } = {}) {
  if (!fresh) {
    const until = yes.get(playerId);
    if (until && until > now) return true;
  }
  const row = await env.DB.prepare("SELECT 1 AS ok FROM entitlements WHERE player_id = ? AND product = ? AND revoked_at IS NULL LIMIT 1").bind(playerId, PRODUCT).first();
  if (row) { yes.set(playerId, now + YES_MS); return true; }
  yes.delete(playerId);
  return false;
}

export async function grant(env, playerId, source, ref, now = Date.now()) {
  await env.DB.prepare("INSERT INTO entitlements (player_id, product, source, ref, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ref) DO NOTHING")
    .bind(playerId, PRODUCT, source, ref, now).run();
}
/** A refund or chargeback: the entitlement of that payment stops. Returns how many rows changed. */
export async function revoke(env, ref, now = Date.now()) {
  const r = await env.DB.prepare("UPDATE entitlements SET revoked_at = ? WHERE ref = ? AND revoked_at IS NULL").bind(now, ref).run();
  forgetOwnership();
  return r.meta?.changes ?? 0;
}
