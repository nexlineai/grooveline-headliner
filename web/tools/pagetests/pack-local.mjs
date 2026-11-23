// The iPhone pack gate in the REAL Worker runtime (workerd): workerd's own Web Crypto imports a PKCS8 P-256 key and signs the App Store Server
// API token, real local R2 answers byte ranges, and a stub Apple server (two ports, production and sandbox) checks every token's signature and
// claims with the public key. Starts everything itself:   node tools/pagetests/pack-local.mjs
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..", "..");
const STATE = mkdtempSync(path.join(tmpdir(), "packlocal-"));
const PORT = 8794, PROD = 4511, SAND = 4512;
const BUNDLE = "org.grooveline.headliner", PRODUCT = "org.grooveline.headliner.career";
const ok = (name) => console.log(`PASS ${name}`);

// A P-256 key like Apple's .p8 (PKCS8 PEM) and a stub of Apple's server that holds us to Apple's documented token
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const pub = publicKey;
const known = { [PROD]: new Map(), [SAND]: new Map() };
let tokenProblems = [], appleCalls = [], force = null;
function apple(port) {
  return createServer((req, res) => {
    appleCalls.push(`${port === PROD ? "production" : "sandbox"} ${req.url}`);
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const [h, p, s] = token.split(".");
    try {
      const header = JSON.parse(Buffer.from(h, "base64url")), claims = JSON.parse(Buffer.from(p, "base64url"));
      const sig = cryptoVerify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
      if (!(sig && header.alg === "ES256" && header.kid === "KEYID123" && claims.iss === "issuer-uuid" && claims.aud === "appstoreconnect-v1" && claims.bid === BUNDLE && claims.exp - claims.iat <= 3600)) tokenProblems.push("bad token");
    } catch (e) { tokenProblems.push(String(e)); }
    if (tokenProblems.length) { res.writeHead(401).end("{}"); return; }
    if (force) { res.writeHead(force).end("{}"); return; }
    const id = req.url.split("/").pop();
    const tx = known[port].get(id);
    if (!tx) { res.writeHead(404).end(JSON.stringify({ errorCode: 4040010 })); return; }
    const payload = { bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: id, transactionId: id, ...tx };
    const jws = ["{}", JSON.stringify(payload), "sig"].map((x) => Buffer.from(x).toString("base64url")).join(".");
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ signedTransactionInfo: jws }));
  }).listen(port, "127.0.0.1");
}
const servers = [apple(PROD), apple(SAND)];

const run = (args) => execFileSync("wrangler", args, { cwd: WEB, stdio: "pipe" });
const flags = ["--local", "--persist-to", STATE, "--config", "wrangler.test.toml"];
run(["d1", "migrations", "apply", "headliner-db", ...flags]);
const NAME = "a".repeat(64) + ".m4a";
writeFileSync(path.join(STATE, "obj.bin"), "0123456789");
writeFileSync(path.join(STATE, "manifest.json"), '{"schema":1,"pack":"career"}');
run(["r2", "object", "put", `headliner-media-test/pack/${NAME}`, "--file", path.join(STATE, "obj.bin"), "--content-type", "audio/mp4", ...flags]);
run(["r2", "object", "put", "headliner-media-test/pack/manifest.json", "--file", path.join(STATE, "manifest.json"), "--content-type", "application/json", ...flags]);
writeFileSync(path.join(STATE, "secrets.env"), `APPSTORE_KEY_P8="${pem.replace(/\n/g, "\\n")}"\nAPPSTORE_KEY_ID=KEYID123\nAPPSTORE_ISSUER_ID=issuer-uuid\n`);

const dev = spawn("wrangler", ["dev", "--config", "wrangler.test.toml", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", STATE, "--env-file", path.join(STATE, "secrets.env"),
  "--var", `APPLE_BASE_PRODUCTION:http://127.0.0.1:${PROD}`, "--var", `APPLE_BASE_SANDBOX:http://127.0.0.1:${SAND}`], { cwd: WEB, stdio: "pipe" });
let log = ""; dev.stdout.on("data", (d) => { log += d; }); dev.stderr.on("data", (d) => { log += d; });
const stop = () => { dev.kill(); servers.forEach((s) => s.close()); rmSync(STATE, { recursive: true, force: true }); };
process.on("exit", stop);
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/headliner/api/me`)).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 1000)); }

const ticketFor = (id, extra = {}) => fetch(`${BASE}/headliner/api/pack-ticket`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: id, ...extra }) });
try {
  known[PROD].set("1000000001", {});
  known[SAND].set("2000000002", {});
  known[PROD].set("3", { revocationDate: 1700000000000 });
  let r = await ticketFor("1000000001");
  const body = await r.text();
  assert.equal(r.status, 200, body);
  const t1 = JSON.parse(body).ticket;
  assert.equal(tokenProblems.length, 0, tokenProblems.join()); ok("workerd signs an ES256 token Apple's rules accept (kid, iss, aud, bid, exp, signature)");
  r = await ticketFor("2000000002");
  assert.equal(r.status, 200); assert.ok(appleCalls.some((c) => c.startsWith("sandbox"))); ok("a sandbox purchase (TestFlight, App Review) is found after production says 404");
  assert.equal((await ticketFor("999")).status, 403); assert.equal((await ticketFor("3")).status, 403); ok("an unknown id and a refunded purchase get no ticket");
  force = 500; assert.equal((await ticketFor("1000000001")).status, 502); force = null; ok("Apple failing is a 502, not 'not a buyer'");

  const get = (name, t, init = {}) => fetch(`${BASE}/headliner/pack/${name}`, { ...init, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) } });
  assert.equal((await get(NAME, null)).status, 401); assert.equal((await get(NAME, t1 + "x")).status, 401); ok("no ticket or a forged one: 401");
  r = await get("manifest.json", t1); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { schema: 1, pack: "career" }); ok("the manifest, with a ticket");
  r = await get(NAME, t1); assert.equal(await r.text(), "0123456789"); assert.equal(r.headers.get("content-type"), "audio/mp4"); assert.match(r.headers.get("cache-control"), /private/); ok("an object: bytes, type, no shared caching");
  r = await get(NAME, t1, { headers: { Range: "bytes=2-5" } }); assert.equal(r.status, 206); assert.equal(await r.text(), "2345"); assert.equal(r.headers.get("content-range"), "bytes 2-5/10"); ok("real R2 byte range: 206 and Content-Range");
  r = await get(NAME, t1, { headers: { Range: "bytes=-3" } }); assert.equal(await r.text(), "789"); assert.equal(r.headers.get("content-range"), "bytes 7-9/10"); ok("a suffix range");
  r = await get(NAME, t1, { method: "HEAD" }); assert.equal(r.status, 200); assert.equal(r.headers.get("content-length"), "10"); ok("HEAD");
  r = await get(NAME, t1, { headers: { Range: "bytes=100-200" } }); assert.equal(r.status, 416); assert.equal(r.headers.get("content-range"), "bytes */10"); ok("a range past the end: 416 (real R2 would send the whole object)");
  assert.equal((await get("c".repeat(64) + ".m4a", t1)).status, 404); assert.equal((await get("secret.txt", t1)).status, 404); ok("a missing object and a name outside the pack: 404");
  console.log("DONE pack-local");
} catch (e) {
  console.log("FAIL", e.message); console.log(log.split("\n").slice(-15).join("\n")); process.exitCode = 1;
} finally { stop(); }
