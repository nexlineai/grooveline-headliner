// The paywall end to end inside the Worker (tools/app.js) with the REAL queries on a real SQLite
// (test/support/d1.ts runs migrations/0001): who may read the paid media, the email-link sign-in,
// Paddle's notifications, refunds. The asset store is a stand-in.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./support/d1.ts";
import { forgetOwnership } from "../tools/paywall/accounts.js";
import { hex, hmac } from "../tools/paywall/crypto.js";

import { createWorker } from "../tools/app.js";
import type { WorkerEnv } from "../tools/app.js";

type Env = WorkerEnv;

const GATED = ["/headliner/assets/Tracks/Low-Tide.m4a", "/headliner/assets/Story/white-label-01.mp4"];
const worker = createWorker({}, GATED);
const SECRET = "whsec_test";

let db: ReturnType<typeof fakeD1>;
let env: Env;
let asked: string[];
const ctx = { waitUntil(p: Promise<unknown>) { void p.catch(() => {}); } };
const mailed: string[] = [];

beforeEach(() => {
  db = fakeD1();
  forgetOwnership();
  asked = [];
  mailed.length = 0;
  env = {
    DB: db, PAYWALL: "on", SESSION_SECRET: "s3cret", PADDLE_WEBHOOK_SECRET: SECRET, PADDLE_PRICE_ID: "pri_game", PADDLE_CLIENT_TOKEN: "test_t", PADDLE_ENV: "sandbox", DEV_ECHO_LINK: "1",
    ASSETS: { fetch: async (r: Request) => { asked.push(new URL(r.url).pathname); return new Response("media", { status: 200, headers: { "Content-Type": "audio/mp4" } }); } },
  };
});

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://grooveline.org${path}`, init), env, ctx);
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://grooveline.org" }, body: JSON.stringify(body) });
const cookieOf = (r: Response) => (r.headers.get("Set-Cookie") ?? "").split(";")[0];

/** Sign in as `email` through the whole email-link path; returns the cookie. */
async function signIn(email: string, next?: string): Promise<string> {
  const r = await post("/headliner/api/login", { email, next });
  const { link } = await r.json() as { link: string };
  const token = new URL(link).searchParams.get("t")!;
  const used = await call("/headliner/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://grooveline.org" }, body: `t=${token}` });
  assert.equal(used.status, 303);
  return cookieOf(used);
}
const playerId = (email: string) => (db.raw.prepare("SELECT id FROM players WHERE email = ?").get(email) as { id: string }).id;
const giveGame = (email: string) => db.raw.prepare("INSERT INTO entitlements (player_id, product, source, ref, created_at) VALUES (?, 'career', 'grant', ?, 1)").run(playerId(email), `grant:${email}`);

describe("the gate on the paid media", () => {
  test("paywall off: every file is served as before", async () => {
    env.PAYWALL = "off";
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a")).status, 200);
    assert.deepEqual(await (await call("/headliner/api/me")).json(), { paywall: false, signedIn: false, owns: true });
  });
  test("paywall on: a stranger gets 403 for paid media, free files are served", async () => {
    const paid = await call("/headliner/assets/Tracks/Low-Tide.m4a");
    assert.equal(paid.status, 403);
    assert.match(paid.headers.get("Cache-Control") ?? "", /no-store/);
    assert.equal(asked.length, 0, "the asset store is never asked");
    assert.equal((await call("/headliner/assets/Tracks/saturday-job.m4a")).status, 200);
    assert.equal((await call("/headliner/")).status, 200);
  });
  test("a request cannot step round the list: case, percent codes, slashes, HEAD, Range", async () => {
    for (const p of ["/headliner/assets/tracks/low-tide.m4a", "/headliner/assets/Tracks/%4cow-Tide.m4a", "/headliner/assets//Tracks///Low-Tide.m4a", "/headliner/assets/Tracks/Low-Tide.m4a/", "/headliner/assets/Tracks/./Low-Tide.m4a", "/headliner/assets/Tracks/x/../Low-Tide.m4a", "/headliner/assets/Tracks/Low-Tide.m4a?x=1"]) {
      assert.equal((await call(p)).status, 403, p);
    }
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { method: "HEAD" })).status, 403);
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Range: "bytes=0-1" } })).status, 403);
    assert.equal((await call("/headliner/assets/Tracks/%E0%A4%A")).status, 400, "a malformed path is refused, not passed on");
    assert.equal(asked.length, 0);
  });
  test("signed in but not owning: still 403; owning: served, privately cached; a refund closes it again", async () => {
    const cookie = await signIn("a@example.com");
    assert.equal((await call("/headliner/assets/Story/white-label-01.mp4", { headers: { Cookie: cookie } })).status, 403);
    giveGame("a@example.com");
    const ok = await call("/headliner/assets/Story/white-label-01.mp4", { headers: { Cookie: cookie } });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("Cache-Control") ?? "", /private/);
    db.raw.prepare("UPDATE entitlements SET revoked_at = 5").run();
    forgetOwnership(); // (a revoke through the webhook does this; here the row was changed by hand)
    assert.equal((await call("/headliner/assets/Story/white-label-01.mp4", { headers: { Cookie: cookie } })).status, 403);
  });
  test("a forged or tampered cookie is no sign-in", async () => {
    const cookie = await signIn("a@example.com");
    giveGame("a@example.com");
    const [name, value] = cookie.split("=");
    const forged = `${name}=${value.slice(0, -2)}xx`;
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Cookie: forged } })).status, 403);
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Cookie: `${name}=` + btoa(JSON.stringify({ p: playerId("a@example.com"), e: "a@example.com", x: 9e9 })) + ".AAAA" } })).status, 403);
  });
  test("the preview cookie turns the paywall on for one browser while it is off for everyone", async () => {
    env.PAYWALL = "off";
    const r = await call("/headliner/api/preview?on=1");
    assert.equal(r.status, 303);
    const cookie = cookieOf(r);
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a")).status, 200);
    assert.equal(((await (await call("/headliner/api/me", { headers: { Cookie: cookie } })).json()) as { paywall: boolean }).paywall, true);
  });
  test("with no database the paid media stay closed (never open by accident)", async () => {
    delete env.DB;
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a")).status, 403);
  });
});

describe("email-link sign-in", () => {
  test("the link: a page with a button (not used by opening it), then one use", async () => {
    const r = await post("/headliner/api/login", { email: "A@Example.com " });
    assert.equal(r.status, 200);
    const { link } = await r.json() as { link: string };
    const token = new URL(link).searchParams.get("t")!;
    assert.match(link, /^https:\/\/grooveline\.org\/headliner\/login\?t=/);
    for (let i = 0; i < 3; i++) { // opening it (a mail scanner does) spends nothing
      const page = await call(`/headliner/login?t=${token}`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<button type="submit">SIGN IN/);
    }
    const form = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://grooveline.org" }, body: `t=${token}` };
    const used = await call("/headliner/login", form);
    assert.equal(used.status, 303);
    assert.equal(used.headers.get("Location"), "/headliner/?signedin=1");
    assert.match(used.headers.get("Set-Cookie") ?? "", /^hl_s=.+; Path=\/headliner; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
    assert.equal((await call("/headliner/login", form)).status, 410, "a second use is refused");
    assert.equal((await call(`/headliner/login?t=${token}`)).status, 410);
    const me = await (await call("/headliner/api/me", { headers: { Cookie: cookieOf(used) } })).json() as { signedIn: boolean; email: string; owns: boolean };
    assert.deepEqual([me.signedIn, me.email, me.owns], [true, "a@example.com", false]);
  });
  test("the email in the database is the same person whatever the case", async () => {
    await signIn("B@x.com");
    await signIn("b@X.com");
    assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM players").get() as { n: number }).n, 1);
  });
  test("a link that has run out is refused", async () => {
    const { link } = await (await post("/headliner/api/login", { email: "a@example.com" })).json() as { link: string };
    db.raw.prepare("UPDATE login_links SET expires_at = 1").run();
    assert.equal((await call(link.replace("https://grooveline.org", ""))).status, 410);
  });
  test("the link carries the player on to the checkout page when asked", async () => {
    const { link } = await (await post("/headliner/api/login", { email: "a@example.com", next: "unlock" })).json() as { link: string };
    const token = new URL(link).searchParams.get("t")!;
    const used = await call("/headliner/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://grooveline.org" }, body: `t=${token}` });
    assert.equal(used.headers.get("Location"), "/headliner/unlock/?signedin=1");
  });
  test("the answer is the same for every address; bad input and cross-site posts are refused; the DB holds no token", async () => {
    assert.equal((await post("/headliner/api/login", { email: "not-an-email" })).status, 400);
    assert.equal((await call("/headliner/api/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ email: "a@example.com" }) })).status, 400, "a plain form post cannot start it");
    assert.equal((await call("/headliner/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ email: "a@example.com" }) })).status, 400);
    delete env.DEV_ECHO_LINK;
    const r = await post("/headliner/api/login", { email: "someone@example.com" });
    assert.deepEqual(await r.json(), { ok: true });
    const stored = db.raw.prepare("SELECT token_hash FROM login_links").all() as { token_hash: string }[];
    assert.match(stored[0].token_hash, /^[0-9a-f]{64}$/);
  });
  test("asking again and again is limited by address and by email", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post("/headliner/api/login", { email: "same@example.com" })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 429, 429]);
  });
  test("sign-out clears the cookie", async () => {
    const r = await post("/headliner/api/logout", {});
    assert.match(r.headers.get("Set-Cookie") ?? "", /^hl_s=; .*Max-Age=0/);
  });
});

/** A Paddle notification, signed as Paddle signs it. */
async function paddle(event: object, { secret = SECRET, ts = Math.floor(Date.now() / 1000), body }: { secret?: string; ts?: number; body?: string } = {}) {
  const raw = body ?? JSON.stringify(event);
  const sig = hex(await hmac(secret, `${ts}:${raw}`));
  return call("/headliner/api/paddle", { method: "POST", headers: { "Paddle-Signature": `ts=${ts};h1=${sig}`, "Content-Type": "application/json" }, body: raw });
}
const paid = (player: string, id = "txn_1", extra: object = {}) => ({ event_id: `evt_${id}`, event_type: "transaction.completed", data: { id, status: "completed", custom_data: { player }, items: [{ price: { id: "pri_game" } }], ...extra } });
const entitlements = () => (db.raw.prepare("SELECT ref, revoked_at FROM entitlements").all() as { ref: string; revoked_at: number | null }[]).map((r) => ({ ...r }));

describe("Paddle's notifications", () => {
  test("a payment gives the game to the player who paid; a replay changes nothing", async () => {
    const cookie = await signIn("a@example.com");
    const id = playerId("a@example.com");
    const r = await paddle(paid(id));
    assert.equal(r.status, 200);
    assert.deepEqual(entitlements(), [{ ref: "txn:txn_1", revoked_at: null }]);
    await paddle(paid(id));
    assert.equal(entitlements().length, 1);
    assert.equal(((await (await call("/headliner/api/me", { headers: { Cookie: cookie } })).json()) as { owns: boolean }).owns, true);
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Cookie: cookie } })).status, 200);
  });
  test("the success page can come before the notification: the buyer is let in as soon as it lands", async () => {
    const cookie = await signIn("a@example.com");
    const me = async () => ((await (await call("/headliner/api/me", { headers: { Cookie: cookie } })).json()) as { owns: boolean }).owns;
    assert.equal(await me(), false);
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Cookie: cookie } })).status, 403);
    await paddle(paid(playerId("a@example.com")));
    assert.equal((await call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Cookie: cookie } })).status, 200, "a remembered NO would still say 403");
    assert.equal(await me(), true);
  });
  test("refused: a bad or missing signature, another secret, an old timestamp, a changed body", async () => {
    const id = (await signIn("a@example.com"), playerId("a@example.com"));
    const event = paid(id);
    assert.equal((await call("/headliner/api/paddle", { method: "POST", body: JSON.stringify(event) })).status, 401);
    assert.equal((await paddle(event, { secret: "other" })).status, 401);
    assert.equal((await paddle(event, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
    const good = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = hex(await hmac(SECRET, `${ts}:${good}`));
    const changed = await call("/headliner/api/paddle", { method: "POST", headers: { "Paddle-Signature": `ts=${ts};h1=${sig}` }, body: good.replace("txn_1", "txn_2") });
    assert.equal(changed.status, 401);
    assert.equal(entitlements().length, 0);
  });
  test("two h1 values (a secret being rotated) are fine when one matches", async () => {
    const id = (await signIn("a@example.com"), playerId("a@example.com"));
    const raw = JSON.stringify(paid(id));
    const ts = Math.floor(Date.now() / 1000);
    const sig = hex(await hmac(SECRET, `${ts}:${raw}`));
    const r = await call("/headliner/api/paddle", { method: "POST", headers: { "Paddle-Signature": `ts=${ts};h1=${"0".repeat(64)};h1=${sig}` }, body: raw });
    assert.equal(r.status, 200);
    assert.equal(entitlements().length, 1);
  });
  test("a payment for another product, or for nobody known, gives nothing and is kept to look at", async () => {
    const id = (await signIn("a@example.com"), playerId("a@example.com"));
    await paddle(paid(id, "txn_other", { items: [{ price: { id: "pri_something_else" } }] }));
    const r = await (await paddle(paid("nobody", "txn_lost"))).json() as { handled: string };
    assert.match(r.handled, /NO PLAYER/);
    assert.equal(entitlements().length, 0);
    const kept = db.raw.prepare("SELECT event_id, handled FROM paddle_events ORDER BY event_id").all() as { event_id: string; handled: string }[];
    assert.deepEqual(kept.map((k) => k.event_id), ["evt_txn_lost", "evt_txn_other"]);
  });
  test("a full refund or a chargeback takes the game back; a partial refund does not", async () => {
    const cookie = await signIn("a@example.com");
    const id = playerId("a@example.com");
    await paddle(paid(id, "txn_a"));
    const media = () => call("/headliner/assets/Tracks/Low-Tide.m4a", { headers: { Cookie: cookie } });
    assert.equal((await media()).status, 200);
    await paddle({ event_id: "evt_adj1", event_type: "adjustment.created", data: { action: "refund", type: "partial", status: "approved", transaction_id: "txn_a" } });
    assert.equal((await media()).status, 200, "partial: kept");
    await paddle({ event_id: "evt_adj2", event_type: "adjustment.created", data: { action: "refund", type: "full", status: "pending_approval", transaction_id: "txn_a" } });
    assert.equal((await media()).status, 200, "not approved yet: kept");
    await paddle({ event_id: "evt_adj3", event_type: "adjustment.updated", data: { action: "refund", type: "full", status: "approved", transaction_id: "txn_a" } });
    assert.equal((await media()).status, 403, "approved full refund: closed at once");
    assert.equal(entitlements()[0].revoked_at !== null, true);
    await paddle(paid(id, "txn_b"));
    assert.equal((await media()).status, 200, "buying again opens it again");
    await paddle({ event_id: "evt_adj4", event_type: "adjustment.created", data: { action: "chargeback", status: "approved", transaction_id: "txn_b" } });
    assert.equal((await media()).status, 403);
  });
  test("not set up (no secret or no database): the notification is refused with 503 so Paddle tries again later", async () => {
    delete env.PADDLE_WEBHOOK_SECRET;
    assert.equal((await paddle(paid("x"))).status, 503);
  });
});

describe("what the page asks", () => {
  test("/api/me when signed out, with the checkout settings (public values only)", async () => {
    const me = await (await call("/headliner/api/me")).json();
    assert.deepEqual(me, { paywall: true, signedIn: false, owns: false, checkout: { env: "sandbox", token: "test_t", price: "pri_game" } });
  });
  test("the account answers are never cached", async () => {
    for (const p of ["/headliner/api/me", "/headliner/login?t=nope"]) assert.match((await call(p)).headers.get("Cache-Control") ?? "", /no-store/, p);
  });
  test("the checkout page is not cross-origin isolated (Paddle's iframe would be blocked), the game still is", async () => {
    const unlock = await call("/headliner/unlock/");
    assert.equal(unlock.headers.get("Cross-Origin-Embedder-Policy"), null);
    assert.equal(unlock.headers.get("Cross-Origin-Opener-Policy"), null);
    assert.match(unlock.headers.get("Content-Security-Policy") ?? "", /cdn\.paddle\.com/);
    const game = await call("/headliner/");
    assert.equal(game.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
    assert.equal(game.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
    assert.match((await call("/headliner/login?t=x")).headers.get("Content-Security-Policy") ?? "", /form-action 'self'/);
  });
});
