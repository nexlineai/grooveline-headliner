// The iPhone's career pack gate (tools/paywall/pack.js, apple.js): buyers and testers get a ticket after APPLE confirms the purchase,
// and only a ticket reads the R2 objects. Apple is a fake server that checks our JWT's signature and claims with the public key, so the
// request we send is held to Apple's documented shape (ES256, kid, iss, aud appstoreconnect-v1, bid, exp within 60 minutes of iat).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./support/d1.ts";
import { createWorker } from "../tools/app.js";
import type { WorkerEnv } from "../tools/app.js";
import { makeTicket } from "../tools/paywall/pack.js";

const worker = createWorker({}, []);
const ctx = { waitUntil(p: Promise<unknown>) { void p.catch(() => {}); } };
const b64u = (b: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof b === "string" ? b : new Uint8Array(b)).toString("base64url");
const BUNDLE = "org.grooveline.headliner", PRODUCT = "org.grooveline.headliner.career";
const NAME = "a".repeat(64) + ".m4a";

// An in-memory R2 bucket with the bits the Worker uses: head, get (with a Range header), writeHttpMetadata, body, size, range.
class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array; type: string }>();
  gets: string[] = [];
  put(key: string, text: string, type = "audio/mp4") { this.objects.set(key, { bytes: new TextEncoder().encode(text), type }); }
  private meta(key: string) {
    const o = this.objects.get(key)!;
    return { size: o.bytes.length, httpEtag: '"e1"', writeHttpMetadata: (h: Headers) => { h.set("Content-Type", o.type); h.set("Cache-Control", "public, max-age=31536000, immutable"); } };
  }
  async head(key: string) { return this.objects.has(key) ? this.meta(key) : null; }
  async get(key: string, opts?: { range?: Headers }) {
    this.gets.push(key);
    const o = this.objects.get(key);
    if (!o) return null;
    let range: { offset: number; length: number } | undefined;
    const h = opts?.range?.get("Range");
    const m = h && /^bytes=(\d*)-(\d*)$/.exec(h);
    if (m) {
      const size = o.bytes.length;
      if (m[1] !== "" && Number(m[1]) >= size) range = { offset: 0, length: size }; // what real R2 does with a range past the end: the whole object
      else if (m[1] === "" && m[2] !== "") { const n = Math.min(Number(m[2]), size); range = { offset: size - n, length: n }; }
      else { const a = Number(m[1]); const b = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); range = { offset: a, length: b - a + 1 }; }
    }
    const slice = range ? o.bytes.slice(range.offset, range.offset + range.length) : o.bytes;
    return { ...this.meta(key), body: new Response(slice as unknown as BodyInit).body, range };
  }
}

// Apple, as far as the Worker can tell: which transactions exist in which environment, with a JWT check on every request.
interface Tx { bundleId?: string; productId?: string; originalTransactionId?: string; revocationDate?: number }
let apple: { production: Map<string, Tx>; sandbox: Map<string, Tx>; calls: string[]; force: null | number | "throw"; publicKey: CryptoKey; jwtOk: boolean };
const realFetch = globalThis.fetch;
let privatePem = "";

async function startApple() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  privatePem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  apple = { production: new Map(), sandbox: new Map(), calls: [], force: null, publicKey: pair.publicKey, jwtOk: true };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!/^api\.storekit(-sandbox)?\.apple\.com$/.test(url.host)) return realFetch(input, init);
    const environment = url.host.includes("sandbox") ? "sandbox" : "production";
    const id = /^\/inApps\/v1\/transactions\/(\d+)$/.exec(url.pathname)?.[1] ?? "";
    apple.calls.push(`${environment}:${id}`);
    // Apple's rules for the request token
    const token = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const [h, p, s] = token.split(".");
    try {
      const header = JSON.parse(Buffer.from(h, "base64url").toString()), claims = JSON.parse(Buffer.from(p, "base64url").toString());
      const sigOk = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, apple.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
      apple.jwtOk &&= sigOk && header.alg === "ES256" && header.kid === "KEYID123" && header.typ === "JWT" && claims.iss === "issuer-uuid"
        && claims.aud === "appstoreconnect-v1" && claims.bid === BUNDLE && claims.exp > claims.iat && claims.exp - claims.iat <= 3600;
    } catch { apple.jwtOk = false; }
    if (!apple.jwtOk) return new Response("{}", { status: 401 });
    if (apple.force === "throw") throw new Error("socket hang up");
    if (typeof apple.force === "number") return new Response("{}", { status: apple.force });
    const tx = apple[environment].get(id);
    if (!tx) return new Response(JSON.stringify({ errorCode: 4040010, errorMessage: "Transaction id not found." }), { status: 404 });
    const payload = { bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: id, environment: environment === "sandbox" ? "Sandbox" : "Production", transactionId: id, ...tx };
    return new Response(JSON.stringify({ signedTransactionInfo: `${b64u("{\"alg\":\"ES256\"}")}.${b64u(JSON.stringify(payload))}.${b64u("sig")}` }), { status: 200 });
  }) as typeof fetch;
}

let env: WorkerEnv;
let r2: FakeR2;
let n = 0;
beforeEach(async () => {
  await startApple();
  r2 = new FakeR2();
  r2.put("pack/manifest.json", '{"schema":1}', "application/json");
  r2.put(`pack/${NAME}`, "0123456789");
  env = { DB: fakeD1(), PACK: r2, PAYWALL: "off", SESSION_SECRET: "s3cret", APPSTORE_KEY_P8: privatePem, APPSTORE_KEY_ID: "KEYID123", APPSTORE_ISSUER_ID: "issuer-uuid", APPLE_BUNDLE_ID: BUNDLE, APPLE_PRODUCT_ID: PRODUCT, ASSETS: { fetch: async () => new Response("x") } };
  n = 0;
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://grooveline.org${path}`, init), env, ctx);
const ticketFor = (transactionId: string, extra: Record<string, unknown> = {}, ipAddr = "198.51.100.7") =>
  call("/headliner/api/pack-ticket", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ipAddr }, body: JSON.stringify({ transactionId, ...extra }) });
async function ticket(id = "1000000001", extra = {}, ipAddr?: string): Promise<string> {
  const r = await ticketFor(id, extra, ipAddr);
  assert.equal(r.status, 200, await r.clone().text());
  return ((await r.json()) as { ticket: string }).ticket;
}
const pack = (name: string, t: string | null, init: RequestInit = {}) => call(`/headliner/pack/${name}`, { ...init, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) } });

describe("tickets: Apple says who bought", () => {
  test("a production buyer gets a ticket, and the request to Apple is the documented one", async () => {
    apple.production.set("1000000001", {});
    const r = await ticketFor("1000000001");
    assert.equal(r.status, 200);
    const j = await r.json() as { ticket: string; expiresAt: number };
    assert.ok(Math.abs(j.expiresAt - (Date.now() / 1000 + 86400)) < 60, "a day");
    assert.deepEqual(apple.calls, ["production:1000000001"]);
    assert.equal(apple.jwtOk, true, "ES256, kid, iss, aud, bid, exp within 60 minutes, signature checked with the public key");
    assert.equal((await pack("manifest.json", j.ticket)).status, 200);
  });
  test("a TestFlight or App Review buyer is in the sandbox: found after production says 404; the app's hint goes first", async () => {
    apple.sandbox.set("2000000002", {});
    await ticket("2000000002");
    assert.deepEqual(apple.calls, ["production:2000000002", "sandbox:2000000002"]);
    apple.calls.length = 0;
    await ticket("2000000002", { environment: "sandbox" });
    assert.deepEqual(apple.calls, ["sandbox:2000000002"], "the hint is asked first and found: production is not asked");
    apple.calls.length = 0;
    apple.production.set("3000000003", {});
    await ticket("3000000003", { environment: "sandbox" });
    assert.deepEqual(apple.calls, ["sandbox:3000000003", "production:3000000003"], "a wrong hint still falls back");
  });
  test("not a buyer: unknown id, another app, another product, refunded: 403 and no ticket", async () => {
    apple.production.set("4", { bundleId: "com.example.other" });
    apple.production.set("5", { productId: "org.grooveline.headliner.tip" });
    apple.production.set("6", { revocationDate: 1700000000000 });
    for (const id of ["999999", "4", "5", "6"]) {
      const r = await ticketFor(id);
      assert.equal(r.status, 403, id);
      assert.ok(!(await r.text()).includes("ticket\":\""), id);
    }
  });
  test("bad input: an id that is not digits, a body that is not JSON", async () => {
    for (const id of ["", "abc", "12 34", "../1", "1".repeat(21)]) assert.equal((await ticketFor(id)).status, 400, id);
    assert.equal((await call("/headliner/api/pack-ticket", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" })).status, 400);
    assert.equal(apple.calls.length, 0, "Apple is not asked about nonsense");
  });
  test("when Apple or our key is the problem it is a 502, never 'not a buyer'", async () => {
    apple.production.set("7", {});
    for (const force of [401, 429, 500, "throw"] as const) {
      apple.force = force;
      assert.equal((await ticketFor("7", {}, `203.0.113.${typeof force === "number" ? force % 200 : 1}`)).status, 502, String(force));
    }
  });
  test("a shared transaction id works only so far: per id, per purchase and per network limits", async () => {
    apple.production.set("10", { originalTransactionId: "9" });
    // the 4 networks allowed, the 5th refused
    for (let i = 1; i <= 4; i++) assert.equal((await ticketFor("10", {}, `192.0.2.${i}`)).status, 200, `network ${i}`);
    assert.equal((await ticketFor("10", {}, "192.0.2.5")).status, 429, "the fifth network");
    assert.equal((await ticketFor("10", {}, "192.0.2.6")).status, 429, "and the sixth");
    assert.equal((await ticketFor("10", {}, "192.0.2.1")).status, 200, "a network already seen still works: strangers cannot push the owner out");
    // per purchase: 8 tickets a day (4 + 1 so far, then 3 more, then refused)
    for (let i = 0; i < 3; i++) assert.equal((await ticketFor("10", {}, "192.0.2.2")).status, 200);
    assert.equal((await ticketFor("10", {}, "192.0.2.2")).status, 429, "the ninth ticket of the day for one purchase");
  });
  test("asking again and again for one id stops before Apple is asked", async () => {
    apple.production.set("11", {});
    for (let i = 0; i < 12; i++) await ticketFor("11", {}, `198.18.0.${i}`);
    const before = apple.calls.length;
    assert.equal((await ticketFor("11", {}, "198.18.1.1")).status, 429);
    assert.equal(apple.calls.length, before);
  });
});

describe("the download needs a ticket", () => {
  test("no ticket, a forged one, an expired one, a web sign-in cookie value: 401", async () => {
    assert.equal((await pack("manifest.json", null)).status, 401);
    const good = await makeTicket(env, "1");
    assert.equal((await pack("manifest.json", good.ticket)).status, 200);
    assert.equal((await pack("manifest.json", good.ticket.slice(0, -3) + "AAA")).status, 401);
    assert.equal((await pack("manifest.json", (await makeTicket(env, "1", Date.now() - 2 * 86400 * 1000)).ticket)).status, 401);
    const session = `${Buffer.from(JSON.stringify({ p: "x", e: "a@b.c", x: 9e9 })).toString("base64url")}.AAAA`;
    assert.equal((await pack("manifest.json", session)).status, 401);
  });
  test("only manifest.json and <sha256>.<ext> are readable: nothing else in the bucket, no traversal, no pack/pack", async () => {
    r2.put("secret.txt", "no");
    const t = await makeTicket(env, "1").then((x) => x.ticket);
    r2.gets.length = 0;
    for (const bad of ["secret.txt", "pack/manifest.json", "pack/" + NAME, "A".repeat(64) + ".m4a", "a".repeat(63) + ".m4a", NAME + "/", "manifest.json.bak", "x%2fy", "%00"]) {
      assert.equal((await pack(bad, t)).status, 404, bad);
    }
    // `..` is collapsed by the URL parser before the Worker sees it (the request leaves the pack route altogether): R2 is untouched either way
    for (const bad of ["../secret.txt", "%2e%2e/secret.txt"]) await pack(bad, t);
    assert.deepEqual(r2.gets, [], "R2 is never asked for these");
  });
  test("an object: 200 with its type, size and no shared caching; byte ranges: 206 with Content-Range; HEAD; a missing object: 404", async () => {
    const t = await makeTicket(env, "1").then((x) => x.ticket);
    const whole = await pack(NAME, t);
    assert.equal(whole.status, 200);
    assert.equal(await whole.text(), "0123456789");
    assert.equal(whole.headers.get("Content-Type"), "audio/mp4");
    assert.equal(whole.headers.get("Content-Length"), "10");
    assert.equal(whole.headers.get("Accept-Ranges"), "bytes");
    assert.match(whole.headers.get("Cache-Control") ?? "", /private/);
    for (const [range, text, cr] of [["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=0-", "0123456789", "bytes 0-9/10"]]) {
      const r = await pack(NAME, t, { headers: { Range: range } });
      assert.equal(r.status, 206, range);
      assert.equal(await r.text(), text, range);
      assert.equal(r.headers.get("Content-Range"), cr, range);
      assert.equal(r.headers.get("Content-Length"), String(text.length), range);
    }
    const past = await pack(NAME, t, { headers: { Range: "bytes=100-200" } });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get("Content-Range"), "bytes */10");
    const head = await pack(NAME, t, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("Content-Length"), "10");
    assert.equal(await head.text(), "");
    assert.equal((await pack("b".repeat(64) + ".m4a", t)).status, 404);
  });
});

describe("set-up and switches", () => {
  test("not set up (no bucket, no key): 503, nothing breaks", async () => {
    delete env.PACK;
    assert.equal((await ticketFor("1")).status, 503);
    assert.equal((await pack("manifest.json", "x")).status, 503);
    env.PACK = r2; delete env.APPSTORE_KEY_P8;
    assert.equal((await ticketFor("1")).status, 503);
  });
  test("it does not depend on the web's PAYWALL switch", async () => {
    apple.production.set("12", {});
    for (const p of ["off", "on"]) { env.PAYWALL = p; assert.equal((await ticketFor("12", {}, `10.0.0.${p.length}`)).status, 200, p); }
  });
});
