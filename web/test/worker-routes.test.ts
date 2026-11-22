// The Worker's addresses (tools/worker.js): the Headliner is served here; Grooveline Booth has its own Worker (repo nexlineai/grooveline-booth), so /booth and /booth/...
// are the site's again, and the old LIVE links redirect to the Booth. The asset store is a stand-in that records which file was asked for.
// The real tools/worker.js is loaded with its one build-time import (dist/sizes.json, the media sizes) replaced by an empty table.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("the Worker's addresses", async () => {
  const src = readFileSync(new URL("../tools/worker.js", import.meta.url), "utf8");
  assert.match(src, /^import SIZES from .*$/m, "the build-time import this test replaces");
  const code = src.replace(/^import SIZES from .*$/m, "const SIZES = {};");
  const worker = (await import("data:text/javascript," + encodeURIComponent(code))).default as { fetch(r: Request, env: unknown): Promise<Response> };
  const asked: string[] = [];
  const env = { ASSETS: { fetch: async (r: Request) => { asked.push(new URL(r.url).pathname + new URL(r.url).search); return new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }); } } };
  const get = (path: string) => worker.fetch(new Request(`https://grooveline.org${path}`), env);

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
