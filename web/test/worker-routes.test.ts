// The Worker's addresses (tools/worker.js): grooveline.org/booth/ (Grooveline Booth) is served from the Headliner's files, the old LIVE links go
// to the Booth, and the Headliner itself is unchanged. The asset store is a stand-in that records which file was asked for.
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

  test("/booth goes to /booth/ (permanent), and /booth/ is the Headliner's index page", async () => {
    const r = await get("/booth");
    assert.equal(r.status, 308);
    assert.equal(r.headers.get("Location"), "https://grooveline.org/booth/");
    asked.length = 0;
    const p = await get("/booth/");
    assert.equal(p.status, 200);
    assert.deepEqual(asked, ["/headliner/"]);
    assert.equal(p.headers.get("Cross-Origin-Embedder-Policy"), "require-corp", "the same headers as the Headliner (shared memory for the audio)");
    assert.match(p.headers.get("Content-Security-Policy") ?? "", /connect-src 'self' https:\/\/api\.grooveline\.org https:\/\/stream\.grooveline\.org/);
  });
  test("/booth/<file> is read from /headliner/<file>, the query kept", async () => {
    asked.length = 0;
    await get("/booth/src/main.js"); await get("/booth/icon.svg"); await get("/booth/?publishCamera");
    assert.deepEqual(asked, ["/headliner/src/main.js", "/headliner/icon.svg", "/headliner/?publishCamera"]);
  });
  test("the old LIVE links go to the Booth; other parameters are kept", async () => {
    for (const [from, to] of [["/headliner/live", "/booth/"], ["/headliner/live/", "/booth/"], ["/headliner/?live", "/booth/"], ["/headliner/?live&publishCamera", "/booth/?publishCamera"]]) {
      const r = await get(from);
      assert.equal(r.status, 302, from);
      assert.equal(r.headers.get("Location"), `https://grooveline.org${to}`, from);
    }
  });
  test("the Headliner is unchanged, and a neighbouring path is the site's", async () => {
    asked.length = 0;
    const h = await get("/headliner/");
    assert.equal(h.status, 200);
    assert.deepEqual(asked, ["/headliner/"]);
    assert.equal((await get("/headliner")).status, 308);
    const realFetch = globalThis.fetch; let passed = "";
    globalThis.fetch = (async (r: Request) => { passed = new URL(r.url).pathname; return new Response("site"); }) as typeof fetch;
    try { await get("/boothfoo"); } finally { globalThis.fetch = realFetch; }
    assert.equal(passed, "/boothfoo", "only /booth and /booth/... are the Booth's");
  });
});
