// Asking Apple whether a StoreKit transaction id is a real purchase of the career, through the App Store Server API.
// Facts from developer.apple.com (read 23 Nov 2026): production https://api.storekit.apple.com and sandbox
// https://api.storekit-sandbox.apple.com, GET /inApps/v1/transactions/{transactionId} (an original transaction id works too);
// 404 (errorCode 4040010) when the id is not in the environment asked; the request carries a JWT: header {alg: ES256, kid},
// claims {iss: issuer id, iat, exp (at most 60 minutes after iat), aud: "appstoreconnect-v1", bid: bundle id}, a NEW one
// per request, signed with the In-App Purchase key (the .p8 from App Store Connect, a PKCS8 P-256 key). NOT confirmed by those
// pages, taken from experience and to be checked on the first real answer: the response field `signedTransactionInfo`
// (a JWS whose payload has bundleId, productId, originalTransactionId, revocationDate, environment), that TestFlight
// purchases are in the sandbox, and the .p8 format. The JWS is read, not verified: it comes from Apple over TLS in answer to our
// own signed request, so the HTTPS endpoint is the check.
import { b64url, fromB64url } from "./crypto.js";

const enc = new TextEncoder();
export const APPLE_BASE = { production: "https://api.storekit.apple.com", sandbox: "https://api.storekit-sandbox.apple.com" };
const bases = (env) => ({ production: env.APPLE_BASE_PRODUCTION || APPLE_BASE.production, sandbox: env.APPLE_BASE_SANDBOX || APPLE_BASE.sandbox });

const keys = new Map(); // the imported key, per isolate
async function signingKey(pem) {
  if (!keys.has(pem)) {
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    keys.set(pem, await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]));
  }
  return keys.get(pem);
}

export async function appleJwt(env, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: env.APPSTORE_KEY_ID, typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({ iss: env.APPSTORE_ISSUER_ID, iat, exp: iat + 600, aud: "appstoreconnect-v1", bid: env.APPLE_BUNDLE_ID })));
  // Web Crypto's ECDSA signature is the raw r||s that a JWT wants (no DER wrapping to undo).
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(env.APPSTORE_KEY_P8), enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

export function decodeJws(jws) {
  const parts = String(jws ?? "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); } catch { return null; }
}

/** The transaction as Apple knows it. `hint` = the environment the app says made it ("production" or "sandbox"): asked first; the
 * other one only after a 404. {status: "ok", tx, environment} | {status: "not-found"} | {status: "error", detail}. A refusal of OUR
 * request (401), a rate limit or a server error is an error, never "not a buyer". */
export async function lookup(env, transactionId, hint = "", fetchFn = fetch) {
  const order = hint === "sandbox" ? ["sandbox", "production"] : ["production", "sandbox"];
  for (const environment of order) {
    let res;
    try {
      res = await fetchFn(`${bases(env)[environment]}/inApps/v1/transactions/${transactionId}`, { headers: { Authorization: `Bearer ${await appleJwt(env)}` } });
    } catch (e) {
      return { status: "error", detail: `network: ${e?.message ?? e}` };
    }
    if (res.status === 404) continue;
    if (!res.ok) return { status: "error", detail: `Apple answered ${res.status} in ${environment}` };
    const body = await res.json().catch(() => null);
    const tx = body && decodeJws(body.signedTransactionInfo);
    if (!tx) return { status: "error", detail: "unreadable answer" };
    return { status: "ok", tx, environment };
  }
  return { status: "not-found" };
}

/** A real purchase of OUR product in OUR app that has not been refunded or taken back from Family Sharing. */
export const entitled = (tx, env) => tx.bundleId === env.APPLE_BUNDLE_ID && tx.productId === env.APPLE_PRODUCT_ID && !tx.revocationDate;
