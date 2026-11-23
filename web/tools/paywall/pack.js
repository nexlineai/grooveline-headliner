// The iPhone's career pack (chapters 3-12 media on R2, tools/media-pack/ on branch r2-media-pack) for buyers and testers only:
//   POST /headliner/api/pack-ticket  {transactionId, environment?}  -> {ticket, expiresAt}   (Apple confirms the purchase)
//   GET|HEAD /headliner/pack/<name>  Authorization: Bearer <ticket>                      -> the R2 object (name = manifest.json | <sha256>.<ext>)
// TestFlight testers and App Review buy in the sandbox, which Apple's API also answers, so they need nothing special; a build that
// opens the career WITHOUT a transaction (the hidden logo hold, a failed product load) has nothing to show here: the app must send
// those people through UNLOCK (free in TestFlight) before it downloads. Independent of PAYWALL (that is the web's switch).
// A transaction id is not a secret, so the gate proves that SOMEONE bought; a shared id works for others up to the limits below.
import { rateLimit } from "./accounts.js";
import { b64url, fromB64url, hmac, hmacOk } from "./crypto.js";
import { json } from "./login.js";
import { entitled, lookup } from "./apple.js";

const TICKET_HOURS = 24;
const SAFE_NAME = /^(manifest\.json|[0-9a-f]{64}\.[a-z0-9]{1,8})$/;
const enc = new TextEncoder();
const secretOf = (env) => env.PACK_SECRET || env.SESSION_SECRET;
const ip = (request) => request.headers.get("CF-Connecting-IP") || "unknown";

const configured = (env) => !!(env.PACK && env.DB && secretOf(env) && env.APPSTORE_KEY_P8 && env.APPSTORE_KEY_ID && env.APPSTORE_ISSUER_ID && env.APPLE_BUNDLE_ID && env.APPLE_PRODUCT_ID);

export async function makeTicket(env, sub, now = Date.now()) {
  const x = Math.floor(now / 1000) + TICKET_HOURS * 3600;
  const body = b64url(enc.encode(JSON.stringify({ k: "pack", s: sub, x })));
  return { ticket: `${body}.${b64url(await hmac(secretOf(env), body))}`, expiresAt: x };
}
export async function readTicket(token, env, now = Date.now()) {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig || !secretOf(env)) return null;
  try {
    if (!(await hmacOk(secretOf(env), body, fromB64url(sig)))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return p.k === "pack" && p.x > Math.floor(now / 1000) ? p : null;
  } catch { return null; }
}

/** At most `max` different networks may ask for tickets for ONE purchase in a day (a phone moves between wifi and cellular: a few is normal).
 * A network already seen is always let in, and a refused network is NOT recorded, so a stranger who knows a transaction id can use up
 * the room but never push the real owner out. */
async function withinDistinctIps(env, original, address, max, now = Date.now()) {
  const t = Math.floor(now / 1000), since = t - 86400;
  const bucket = `packip:${original}:${address}`;
  const known = await env.DB.prepare("SELECT 1 AS ok FROM rate_limits WHERE bucket = ? AND window_start >= ?").bind(bucket, since).first();
  if (known) return true;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket LIKE ? AND window_start >= ?").bind(`packip:${original}:%`, since).first();
  if ((row?.n ?? 0) >= max) return false;
  await env.DB.prepare("INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = ?").bind(bucket, t, t).run();
  return true;
}

export async function issueTicket(request, env) {
  if (!configured(env)) return json({ error: "The download is not set up yet." }, 503);
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return json({ error: "bad request" }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const id = String(body?.transactionId ?? "");
  if (!/^\d{1,20}$/.test(id)) return json({ error: "bad transaction id" }, 400);
  const hint = body?.environment === "sandbox" || body?.environment === "production" ? body.environment : "";
  if (!(await rateLimit(env, `pack-ip:${ip(request)}`, 30, 3600)) || !(await rateLimit(env, `pack-req:${id}`, 12, 86400))) {
    return json({ error: "Too many requests. Try again later." }, 429);
  }
  const found = await lookup(env, id, hint);
  if (found.status === "error") { console.error(`[pack] ${found.detail}`); return json({ error: "Apple could not be reached. Try again." }, 502); }
  if (found.status === "not-found" || !entitled(found.tx, env)) return json({ error: "No purchase of the career was found for this transaction." }, 403);
  const original = /^\d{1,20}$/.test(String(found.tx.originalTransactionId)) ? String(found.tx.originalTransactionId) : id;
  // The network check first: a refusal there costs the owner nothing (only tickets that are issued count against the day's 8).
  if (!(await withinDistinctIps(env, original, ip(request), 4)) || !(await rateLimit(env, `pack-orig:${original}`, 8, 86400))) {
    return json({ error: "Too many downloads started with this purchase today. Try again tomorrow." }, 429);
  }
  return json(await makeTicket(env, original));
}

export async function servePack(request, env, name) {
  if (!env.PACK || !secretOf(env)) return json({ error: "The download is not set up yet." }, 503);
  if (!SAFE_NAME.test(name)) return json({ error: "not found" }, 404);
  const auth = request.headers.get("Authorization") || "";
  if (!(await readTicket(auth.startsWith("Bearer ") ? auth.slice(7) : "", env))) {
    return json({ error: "A valid ticket is needed (ask for a new one)." }, 401, { "WWW-Authenticate": "Bearer" });
  }
  const key = `pack/${name}`;
  if (request.method === "HEAD") {
    const head = await env.PACK.head(key);
    if (!head) return json({ error: "not found" }, 404);
    return new Response(null, { status: 200, headers: objectHeaders(head, null) });
  }
  const object = await env.PACK.get(key, { range: request.headers });
  if (!object) return json({ error: "not found" }, 404);
  const ranged = !!object.range && request.headers.has("Range");
  // R2 answers a range that starts past the end with the whole object; the right answer is 416.
  const start = /^bytes=(\d+)-/.exec(request.headers.get("Range") ?? "")?.[1];
  if (start !== undefined && Number(start) >= object.size) {
    object.body?.cancel();
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${object.size}`, "Cache-Control": "private, no-store" } });
  }
  return new Response(object.body, { status: ranged ? 206 : 200, headers: objectHeaders(object, ranged ? object.range : null) });
}

function objectHeaders(object, range) {
  const h = new Headers();
  object.writeHttpMetadata?.(h);
  h.set("Content-Type", h.get("Content-Type") || "application/octet-stream");
  h.set("Accept-Ranges", "bytes");
  h.set("Cache-Control", "private, no-store"); // behind a ticket: nothing in between may keep a copy
  if (object.httpEtag) h.set("ETag", object.httpEtag);
  if (range) {
    h.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    h.set("Content-Length", String(range.length));
  } else {
    h.set("Content-Length", String(object.size));
  }
  return h;
}
