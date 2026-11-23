// Paddle Billing, the server side: the signed notification that says a payment happened (or was
// given back). Everything provider-specific is in this file and web/unlock/: a switch to another
// merchant of record changes these two places and nothing else.
// Facts from developer.paddle.com (read 23 Nov 2026): header `Paddle-Signature: ts=<unix>;h1=<hex>`
// (h1 can appear twice while a secret is rotated), h1 = HMAC-SHA256 of `${ts}:${rawBody}` with the
// notification destination's secret; events transaction.completed and adjustment.created /
// adjustment.updated (action refund or chargeback, status approved); the buyer's email is NOT in
// the payload, so the player's id travels in `custom_data.player` from the checkout.
import { grant, playerById, revoke } from "./accounts.js";
import { hex, hmac, sameHex } from "./crypto.js";
import { json } from "./login.js";

/** Paddle's default is 5 seconds; a retried notification can be older. Replaying one changes nothing:
 * a payment is one row (ref), a refund is one update. */
export const TOLERANCE_SECONDS = 300;

export async function verifySignature(rawBody, header, secret, now = Date.now(), tolerance = TOLERANCE_SECONDS) {
  if (!header || !secret) return false;
  let ts = null;
  const h1 = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "h1") h1.push(v);
  }
  if (!ts || !/^\d+$/.test(ts) || !h1.length || Math.abs(now / 1000 - Number(ts)) > tolerance) return false;
  const mine = hex(await hmac(secret, `${ts}:${rawBody}`));
  return h1.some((h) => sameHex(h, mine));
}

/** POST /headliner/api/paddle */
export async function webhook(request, env) {
  if (!env.PADDLE_WEBHOOK_SECRET || !env.DB) return json({ error: "not configured" }, 503);
  const raw = await request.text(); // the exact bytes: the signature covers them
  if (!(await verifySignature(raw, request.headers.get("Paddle-Signature"), env.PADDLE_WEBHOOK_SECRET))) return json({ error: "bad signature" }, 401);
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: "bad body" }, 400); }
  const id = String(event?.event_id ?? "");
  const type = String(event?.event_type ?? "");
  if (!id || !type) return json({ error: "bad body" }, 400);
  const handled = await handle(env, type, event.data ?? {});
  await env.DB.prepare("INSERT INTO paddle_events (event_id, event_type, received_at, body, handled) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET handled = excluded.handled")
    .bind(id, type, Date.now(), raw, handled).run();
  return json({ ok: true, handled });
}

async function handle(env, type, d) {
  if (type === "transaction.completed") {
    if (d.status !== "completed") return "ignored: status";
    if (env.PADDLE_PRICE_ID && !(d.items ?? []).some((i) => i?.price?.id === env.PADDLE_PRICE_ID)) return "ignored: another product";
    const playerId = d.custom_data?.player;
    const player = typeof playerId === "string" ? await playerById(env, playerId) : null;
    if (!player) return "NO PLAYER: paid but not matched (check custom_data.player; give it by hand)";
    await grant(env, player.id, "paddle", `txn:${d.id}`);
    return `granted to ${player.id}`;
  }
  if (type === "adjustment.created" || type === "adjustment.updated") {
    if (d.status !== "approved") return "ignored: not approved";
    if (d.action === "chargeback") return `revoked ${await revoke(env, `txn:${d.transaction_id}`)}`;
    // A partial refund (a credit note for part of it) leaves the game with the player.
    if (d.action === "refund") return d.type === "full" ? `revoked ${await revoke(env, `txn:${d.transaction_id}`)}` : "ignored: partial refund";
    return "ignored: action";
  }
  return "ignored: event";
}
