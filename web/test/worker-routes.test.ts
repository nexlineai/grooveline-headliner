// The Worker's addresses (tools/app.js): the Headliner is served here; Grooveline Booth has its own Worker (repo nexlineai/grooveline-booth), so /booth and /booth/...
// are the site's again, and the old LIVE links redirect to the Booth. The asset store is a stand-in that records which file was asked for.
// tools/worker.js only feeds app.js its two build-time tables; the test hands it empty ones (paywall off, nothing gated).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../tools/app.js";

describe("the Worker's addresses", async () => {
  const worker = createWorker({}, []);
  const asked: string[] = [];
  const env = { ASSETS: { fetch: async (r: Request) => { asked.push(new URL(r.url).pathname + new URL(r.url).search); return new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }); } } };
  const get = (path: string) => worker.fetch(new Request(`https://grooveline.org${path}`), env, { waitUntil() {} });

  test("the old LIVE links go to the Booth; other parameters are kept", async () => {
    for (const [from, to] of [["/headliner/live", "/booth/"], ["/headliner/live/", "/booth/"], ["/headliner/?live", "/booth/"], ["/headliner/?live&publishCamera", "/booth/?publishCamera"]]) {
      const r = await get(from);
      assert.equal(r.status, 302, from);
      assert.equal(r.headers.get("Location"), `https://grooveline.org${to}`, from);
    }
  });
  test("the Headliner is unchanged, and /booth is not served here any more (the Booth Worker has it)", async () => {
    asked.length = 0;
    const h = await get("/headliner/");
    assert.equal(h.status, 200);
    assert.deepEqual(asked, ["/headliner/"]);
    assert.equal((await get("/headliner")).status, 308);
    const realFetch = globalThis.fetch; const passed: string[] = [];
    globalThis.fetch = (async (r: Request) => { passed.push(new URL(r.url).pathname); return new Response("site"); }) as typeof fetch;
    try { await get("/boothfoo"); await get("/booth/"); } finally { globalThis.fetch = realFetch; }
    assert.deepEqual(passed, ["/boothfoo", "/booth/"]);
    assert.ok(!asked.some((a) => a.startsWith("/booth")), "no booth file is read from the Headliner's assets");
  });
});
