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
  // Kept FIRST, then handled: a refund is judged against the payment and the other refunds of it, which are these stored events (this one included).
  await env.DB.prepare("INSERT INTO paddle_events (event_id, event_type, received_at, body, handled) VALUES (?, ?, ?, ?, 'received') ON CONFLICT(event_id) DO UPDATE SET body = excluded.body")
    .bind(id, type, Date.now(), raw).run();
  const handled = await handle(env, type, event.data ?? {});
  await env.DB.prepare("UPDATE paddle_events SET handled = ? WHERE event_id = ?").bind(handled, id).run();
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
    // Part of the money back (a credit note for some of it) leaves the game with the player; all of it takes the game back.
    if (d.action === "refund") return (await refundedInFull(env, d)) ? `revoked ${await revoke(env, `txn:${d.transaction_id}`)}` : "ignored: partial refund";
    return "ignored: action";
  }
  return "ignored: event";
}

/** Has the money been given back in full? NOT by Paddle's label: a refund of the whole item arrives as `type: "partial"` at the top with the item
 * `type: "full"` (seen 23 Nov in the sandbox: 499 of 499, tax included), and that label wrongly kept the game with a refunded player. So the
 * amounts decide: the approved refunds of this payment (each adjustment once: created and updated are the same one) add up to what was paid.
 * If the payment is not on record (no stored transaction.completed with its total), only a refund Paddle calls "full" counts. */
async function refundedInFull(env, d) {
  const paid = await env.DB.prepare("SELECT json_extract(body, '$.data.details.totals.total') AS total FROM paddle_events WHERE event_type = 'transaction.completed' AND json_extract(body, '$.data.id') = ? LIMIT 1")
    .bind(d.transaction_id).first();
  const total = Number(paid?.total);
  if (!paid || !Number.isFinite(total) || total <= 0) return d.type === "full";
  const rows = await env.DB.prepare(
    "SELECT MAX(CAST(json_extract(body, '$.data.totals.total') AS INTEGER)) AS amount FROM paddle_events " +
    "WHERE event_type IN ('adjustment.created', 'adjustment.updated') AND json_extract(body, '$.data.transaction_id') = ? " +
    "AND json_extract(body, '$.data.status') = 'approved' AND json_extract(body, '$.data.action') = 'refund' GROUP BY json_extract(body, '$.data.id')")
    .bind(d.transaction_id).all();
  const refunded = (rows.results ?? []).reduce((n, r) => n + (Number(r.amount) || 0), 0);
  return refunded >= total || d.type === "full";
}
