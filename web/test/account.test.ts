// The account helper: reading the site's sign-in and asking for the sound-check key.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fetchSoundCheckKey, jwtPayload, readSession } from "../src/stream/account.ts";

// As the Worker makes it (createJWT: btoa(JSON.stringify(payload))): Latin-1 bytes, one per character, standard base64 (the page also accepts the url-safe form).
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
const NOW = 1_800_000_000_000;
const store = (v: string | null) => ({ getItem: (k: string) => (k === "gl_token" ? v : null) });
const KEY = "vcheck-0123456789abcdef0123";

describe("the site's sign-in", () => {
  test("a token that has not run out is a session, with the DJ's name; exp is in milliseconds", () => {
    const s = readSession(store(jwt({ sub: "u1", dj_name: "zdb", exp: NOW + 3_600_000 })), NOW);
    assert.equal(s?.name, "zdb");
    assert.equal(s?.expires, NOW + 3_600_000);
  });
  test("no token, a token that is not a JWT, a missing exp, and one that has run out (or runs out within a minute) are all signed out", () => {
    for (const v of [null, "", "abc", "a.b.c", `${b64({})}.${b64({ dj_name: "x" })}.s`, jwt({ exp: NOW - 1 }), jwt({ exp: NOW + 30_000 }), jwt({ exp: "tomorrow" })]) assert.equal(readSession(store(v), NOW), null, String(v));
  });
  test("a storage that throws (a private window, blocked storage) is signed out, not a crash", () => {
    assert.equal(readSession({ getItem: () => { throw new Error("blocked"); } }, NOW), null);
    assert.equal(readSession(null, NOW), null);
  });
  test("jwtPayload reads url-safe base64 and refuses garbage", () => {
    assert.deepEqual(jwtPayload(jwt({ a: "é?>~" })), { a: "é?>~" }, "url-safe characters and a Latin-1 accent");
    assert.equal(readSession(store(jwt({ dj_name: "Zé Ñandú", exp: NOW + 3_600_000 })), NOW)?.name, "Zé Ñandú", "a name with accents survives (the Worker's Latin-1 encoding)");
    assert.equal(jwtPayload("x.y"), null);
    assert.equal(jwtPayload("a.!!!.c"), null);
  });
});

describe("the sound-check key", () => {
  const session = { token: "T", expires: NOW + 1e6, name: "zdb" };
  const answer = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  test("asks /check/mount with the bearer token and gives the key", async () => {
    let seen: { url: string; auth: string } | null = null;
    const r = await fetchSoundCheckKey(session, async (url, init) => { seen = { url, auth: (init?.headers as Record<string, string>).Authorization }; return new Response(JSON.stringify({ video_key: KEY }), { status: 200 }); });
    assert.deepEqual(r, { ok: true, key: KEY });
    assert.equal(seen!.url, "https://api.grooveline.org/check/mount");
    assert.equal(seen!.auth, "Bearer T");
  });
  test("401 and 403: signed out; 503 and other errors: unavailable; no network (or a blocked call): offline", async () => {
    assert.deepEqual(await fetchSoundCheckKey(session, answer(401, { error: "Unauthorized" })), { ok: false, reason: "signed-out", detail: "Your sign-in has run out." });
    assert.equal((await fetchSoundCheckKey(session, answer(403, {}))).ok, false);
    const unavailable = await fetchSoundCheckKey(session, answer(503, { error: "x" }));
    assert.equal(unavailable.ok === false && unavailable.reason, "unavailable");
    const offline = await fetchSoundCheckKey(session, async () => { throw new TypeError("Failed to fetch"); });
    assert.equal(offline.ok === false && offline.reason, "offline");
  });
  test("only a key of the exact shape is accepted (nothing else may be sent to the test path)", async () => {
    for (const body of [{}, { video_key: "" }, { video_key: "goodkey" }, { video_key: "vcheck-ZZ" }, { video_key: KEY + "0" }, { video_key: 5 }, "not json", { video_key: "live/../x" }]) {
      const r = await fetchSoundCheckKey(session, answer(200, body));
      assert.equal(r.ok, false, JSON.stringify(body));
    }
  });
});
