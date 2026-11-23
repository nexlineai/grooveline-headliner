// Small crypto helpers for the paywall (Web Crypto only: it runs in the Worker and in Node's tests).
const enc = new TextEncoder();

export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** A random token for a link or an id (URL-safe). */
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

async function key(secret, usages) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}
export async function hmac(secret, data) {
  return crypto.subtle.sign("HMAC", await key(secret, ["sign"]), enc.encode(data));
}
/** Constant-time check of a signature (Web Crypto's own compare). */
export async function hmacOk(secret, data, sig) {
  return crypto.subtle.verify("HMAC", await key(secret, ["verify"]), sig, enc.encode(data));
}
/** Compare two hex strings without stopping at the first difference. */
export function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
