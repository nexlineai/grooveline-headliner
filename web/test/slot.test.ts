// The slot helper: reading /me/next-slot, the server's clock, the phases and the words.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { WINDOW_MS, fetchNextSlot, inWords, phaseAt, slotLine } from "../src/stream/slot.ts";

const session = { token: "T", expires: Date.now() + 1e9, name: "zdb" };
const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const slot = (startOffset: number, endOffset: number, phase: "later" | "early" | "on" = "on") => ({ id: "b1", start: iso(NOW + startOffset), end: iso(NOW + endOffset), window_start: iso(NOW + startOffset - WINDOW_MS), phase, opens_in_s: 0, description: "", stream_type: "icecast" });
const answer = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("reading /me/next-slot", () => {
  test("gives the answer and how far the laptop's clock is from the server's (the server is 90 s ahead here)", async () => {
    const r = await fetchNextSlot(session, answer(200, { now: iso(NOW + 90_000), slot: slot(60 * MIN, 120 * MIN, "later"), ingest: null }), () => NOW);
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.data.slot?.id, "b1"); assert.equal(r.offset, 90_000); assert.equal(r.data.ingest, null); }
  });
  test("asks with the bearer token", async () => {
    let seen = "";
    await fetchNextSlot(session, async (url, init) => { seen = `${url} ${(init?.headers as Record<string, string>).Authorization}`; return new Response(JSON.stringify({ now: iso(NOW), slot: null, ingest: null }), { status: 200 }); }, () => NOW);
    assert.equal(seen, "https://api.grooveline.org/me/next-slot Bearer T");
  });
  test("no slot is a good answer (slot null); the address must be https, else it is dropped", async () => {
    const none = await fetchNextSlot(session, answer(200, { now: iso(NOW), slot: null, ingest: null }), () => NOW);
    assert.ok(none.ok && none.data.slot === null);
    const bad = await fetchNextSlot(session, answer(200, { now: iso(NOW), slot: slot(-MIN, 60 * MIN), ingest: { whip_url: "http://evil.example/x", audio: { codec: "opus", bitrate: 1 } } }), () => NOW);
    assert.ok(bad.ok && bad.data.ingest === null);
    const good = await fetchNextSlot(session, answer(200, { now: iso(NOW), slot: slot(-MIN, 60 * MIN), ingest: { whip_url: "https://stream.grooveline.org/whip/live/k/whip", audio: { codec: "opus", bitrate: 192000 } } }), () => NOW);
    assert.ok(good.ok && good.data.ingest?.whip_url.startsWith("https://"));
  });
  test("401/403: signed out; 404: not available yet (the Worker has no route); other errors and nonsense: could not be read; no network: offline", async () => {
    const r = async (status: number, body: unknown = {}) => fetchNextSlot(session, answer(status, body), () => NOW);
    assert.equal((await r(401) as { reason: string }).reason, "signed-out");
    assert.equal((await r(403) as { reason: string }).reason, "signed-out");
    const nf = await r(404) as { reason: string; detail: string };
    assert.equal(nf.reason, "unavailable"); assert.match(nf.detail, /not available yet/);
    assert.match((await r(500) as { detail: string }).detail, /could not be read/);
    assert.equal((await r(200, "not json") as { ok: boolean }).ok, false);
    assert.equal((await r(200, { now: "nonsense", slot: null }) as { ok: boolean }).ok, false);
    assert.equal((await r(200, { now: iso(NOW), slot: { id: "x", start: "bad", end: "bad" } }) as { ok: boolean }).ok, false);
    const off = await fetchNextSlot(session, async () => { throw new TypeError("Failed to fetch"); }, () => NOW);
    assert.equal(off.ok === false && off.reason, "offline");
  });
});

describe("phases on the server's clock", () => {
  const s = slot(60 * MIN, 120 * MIN);
  test("later, early (the 15 minutes before the start), on, over, at the exact edges", () => {
    assert.equal(phaseAt(s, NOW), "later");
    assert.equal(phaseAt(s, NOW + 45 * MIN - 1), "later");
    assert.equal(phaseAt(s, NOW + 45 * MIN), "early");
    assert.equal(phaseAt(s, NOW + 60 * MIN - 1), "early");
    assert.equal(phaseAt(s, NOW + 60 * MIN), "on");
    assert.equal(phaseAt(s, NOW + 120 * MIN - 1), "on");
    assert.equal(phaseAt(s, NOW + 120 * MIN), "over");
  });
});

describe("words", () => {
  test("inWords", () => {
    assert.equal(inWords(40_000), "40 s");
    assert.equal(inWords(89_000), "89 s");
    assert.equal(inWords(10 * MIN), "10 min");
    assert.equal(inWords(9 * MIN + 1), "10 min", "rounded up");
    assert.equal(inWords(130 * MIN), "2 h 10 min");
    assert.equal(inWords(120 * MIN), "2 h");
    assert.equal(inWords(72 * 60 * MIN), "3 days");
    assert.equal(inWords(-5), "0 s");
  });
  test("slotLine: none booked; later; starts in; now; the day shows when it is not today", () => {
    assert.equal(slotLine(null, NOW, "en-GB"), "none booked");
    const here = (h: number, m: number) => new Date(2026, 10, 20, h, m).getTime();
    const mk = (a: number, b: number) => ({ ...slot(0, 0), start: iso(a), end: iso(b) });
    assert.match(slotLine(mk(here(20, 0), here(22, 0)), here(12, 0), "en-GB"), /^20:00–22:00 · in 8 h$/);
    assert.match(slotLine(mk(here(20, 0), here(22, 0)), here(19, 50), "en-GB"), /starts in 10 min$/);
    assert.match(slotLine(mk(here(20, 0), here(22, 0)), here(20, 30), "en-GB"), /· now$/);
    const tomorrow = mk(here(20, 0) + 24 * 60 * MIN, here(22, 0) + 24 * 60 * MIN);
    assert.match(slotLine(tomorrow, here(12, 0), "en-GB"), /^\w{3} 20:00–22:00 · in 1 day|^\w{3} 20:00–22:00 · in 32 h/);
  });
});
