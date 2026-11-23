// The whole purchase path against a RUNNING Worker (real workerd, real local D1, the built dist):
//   wrangler d1 migrations apply headliner-db --local --config wrangler.test.toml --persist-to STATE
//   wrangler dev --config wrangler.test.toml --port 8788 --persist-to STATE
//   node tools/pagetests/paywall-local.mjs http://127.0.0.1:8788
// A stranger is refused the paid media, signs in by the emailed link (the test config echoes it),
// still cannot, "pays" (a notification signed with the test secret), then can, with byte ranges,
// and a refund closes it again. Needs dist/ built (node tools/build.ts).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8788";
const SECRET = "whsec_test_only"; // wrangler.test.toml
const gated = JSON.parse(readFileSync(new URL("../../dist/gated.json", import.meta.url), "utf8"));
const track = gated.find((p) => p.includes("/Tracks/"));
const clip = gated.find((p) => p.endsWith(".mp4") && p.includes("/Story/"));
const ok = (name) => console.log(`PASS ${name}`);
let cookie = "";
const call = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) } });
const json = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });

const email = `player${Date.now()}@example.com`;
assert.equal((await call(track)).status, 403); ok("a stranger is refused a paid record");
assert.equal((await call(clip, { headers: { Range: "bytes=0-1" } })).status, 403); ok("and a paid clip, even by byte range");
assert.equal((await call("/headliner/assets/Tracks/tracks.json")).status, 200); ok("free files are served");
const unlockPage = await call("/headliner/unlock/");
assert.equal(unlockPage.status, 200);
assert.equal(unlockPage.headers.get("cross-origin-embedder-policy"), null);
assert.match(await unlockPage.text(), /paddle\.js/); ok("the checkout page is served without cross-origin isolation");
assert.equal((await call("/headliner/")).headers.get("cross-origin-embedder-policy"), "require-corp"); ok("the game page still is isolated");

const { link } = await (await json("/headliner/api/login", { email })).json();
const token = new URL(link).searchParams.get("t");
const page = await call(`/headliner/login?t=${token}`);
assert.equal(page.status, 200); assert.match(await page.text(), /SIGN IN/); ok("the link opens a page with a button");
const used = await call("/headliner/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE }, body: `t=${token}` });
assert.equal(used.status, 303); cookie = used.headers.get("set-cookie").split(";")[0]; ok("the button signs in");
assert.equal((await call(`/headliner/login?t=${token}`)).status, 410); ok("the link works once");
let me = await (await call("/headliner/api/me")).json();
assert.deepEqual([me.signedIn, me.email, me.owns], [true, email, false]); assert.equal((await call(track)).status, 403); ok("signed in, not owning: still refused");

const pay = async (event) => {
  const raw = JSON.stringify(event), ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${raw}`).digest("hex");
  return fetch(BASE + "/headliner/api/paddle", { method: "POST", headers: { "Paddle-Signature": `ts=${ts};h1=${h1}` }, body: raw });
};
const txn = `txn_${Date.now()}`;
assert.equal((await pay({ event_id: `evt_${txn}`, event_type: "transaction.completed", data: { id: txn, status: "completed", custom_data: { player: me.player }, items: [{ price: { id: "pri_test" } }] } })).status, 200); ok("Paddle's notification is accepted");
me = await (await call("/headliner/api/me")).json(); assert.equal(me.owns, true); ok("the player owns the career");
const bought = await call(track);
assert.equal(bought.status, 200); assert.match(bought.headers.get("cache-control"), /private/); ok("the paid record is served (privately cached)");
await bought.arrayBuffer();
const part = await call(clip, { headers: { Range: "bytes=0-99" } });
assert.equal(part.status, 206); assert.equal((await part.arrayBuffer()).byteLength, 100); ok("a byte range of a paid clip: 206");
assert.equal((await fetch(BASE + clip)).status, 403); ok("another browser (no cookie) is still refused");
assert.equal((await pay({ event_id: `evt_ref_${txn}`, event_type: "adjustment.updated", data: { action: "refund", type: "full", status: "approved", transaction_id: txn } })).status, 200);
assert.equal((await call(track)).status, 403); ok("a refund closes it again");
console.log("DONE paywall-local");
