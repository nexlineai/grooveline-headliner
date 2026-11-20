import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AUDIBLE, HEARTBEAT_MS, HOLD_MS, NowPlaying, NowPlayingPicker, RETRY_MS } from "../src/stream/nowplaying.ts";
import type { DeckNow } from "../src/stream/nowplaying.ts";

const deck = (title: string, level: number, playing = true, artist = "Art"): DeckNow => ({ playing, level, artist, title });

describe("which deck is playing", () => {
  test("nothing audible (silent, stopped, no title) is nothing", () => {
    const p = new NowPlayingPicker();
    assert.equal(p.pick([deck("A", 0), deck("B", 0.05)], 0), null);
    assert.equal(p.pick([deck("A", 0.9, false), deck("", 0.9)], 0), null);
    assert.equal(p.pick([deck("A", AUDIBLE - 0.01)], 0), null);
  });
  test("one audible deck is the answer, with its artist and title cleaned", () => {
    const p = new NowPlayingPicker();
    assert.deepEqual(p.pick([deck("  Saturday \u0007 Job ", 0.9, true, "Sol\nPoente"), deck("B", 0)], 0), { artist: "Sol Poente", title: "Saturday Job" });
  });
  test("a blend does not flicker: the other deck must be clearly louder for HOLD_MS; a stopped deck hands over at once", () => {
    const p = new NowPlayingPicker();
    assert.equal(p.pick([deck("A", 0.9), deck("B", 0)], 0)?.title, "A");
    assert.equal(p.pick([deck("A", 0.8), deck("B", 0.5)], 1000)?.title, "A", "B is in but not clearly louder");
    assert.equal(p.pick([deck("A", 0.4), deck("B", 0.9)], 2000)?.title, "A", "louder, but not for long enough yet");
    assert.equal(p.pick([deck("A", 0.4), deck("B", 0.9)], 2000 + HOLD_MS - 1)?.title, "A");
    assert.equal(p.pick([deck("A", 0.4), deck("B", 0.9)], 2000 + HOLD_MS)?.title, "B", "B has been louder for HOLD_MS");
    assert.equal(p.pick([deck("A", 0.95), deck("B", 0.5)], 20_000)?.title, "B", "A comes back louder: the clock starts again");
    assert.equal(p.pick([deck("A", 0.95, false), deck("B", 0.5)], 20_001)?.title, "B");
    assert.equal(p.pick([deck("A", 0.95, false), deck("B", 0.5, false)], 20_002), null);
    assert.equal(p.pick([deck("A", 0.3), deck("B", 0, false)], 20_003)?.title, "A", "after silence the audible deck is taken at once");
  });
  test("a louder deck that falls back before HOLD_MS never takes over", () => {
    const p = new NowPlayingPicker();
    p.pick([deck("A", 0.9), deck("B", 0)], 0);
    p.pick([deck("A", 0.3), deck("B", 0.9)], 1000);
    p.pick([deck("A", 0.9), deck("B", 0.2)], 5000);
    assert.equal(p.pick([deck("A", 0.3), deck("B", 0.9)], 6000 + HOLD_MS - 1)?.title, "A");
  });
});

describe("sending it", () => {
  function rig(opts: { id?: string | null; session?: boolean; decks?: DeckNow[]; status?: number } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const clock = { t: 1_000_000 };
    const st = { id: opts.id === undefined ? "b1" : opts.id, decks: opts.decks ?? [deck("Saturday Job", 0.9, true, "Sol Poente"), deck("", 0, false)], status: opts.status ?? 200, offline: false };
    const n = new NowPlaying({
      session: () => (opts.session === false ? null : { token: "tok", expires: 0, name: "z" }),
      fetchFn: async (url, init) => { calls.push({ url, init: init as RequestInit }); if (st.offline) throw new TypeError("offline"); return new Response("{}", { status: st.status }); },
      bookingId: () => st.id, decks: () => st.decks, now: () => clock.t,
    });
    return { n, calls, clock, st };
  }
  test("sends the booking, artist and title with the sign-in, once; again after the heartbeat; and again when the title changes", async () => {
    const r = rig();
    await r.n.tick();
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, "https://api.grooveline.org/me/now-playing");
    assert.equal((r.calls[0].init.headers as Record<string, string>).Authorization, "Bearer tok");
    assert.deepEqual(JSON.parse(r.calls[0].init.body as string), { booking_id: "b1", artist: "Sol Poente", title: "Saturday Job" });
    r.clock.t += 1000; await r.n.tick();
    r.clock.t += HEARTBEAT_MS - 2000; await r.n.tick();
    assert.equal(r.calls.length, 1, "the same title is not sent again before the heartbeat");
    r.clock.t += 1500; await r.n.tick();
    assert.equal(r.calls.length, 2, "the heartbeat");
    r.st.decks = [deck("Saturday Job", 0, true), deck("Low Tide", 0.9, true, "Marea")];
    r.clock.t += 1000; await r.n.tick();
    assert.equal(r.calls.length, 3, "a different track on the deck the room hears: sent at once (nothing was audible on A)");
    assert.equal(JSON.parse(r.calls[2].init.body as string).title, "Low Tide");
  });
  test("nothing sends without a booking (a sound check), without a sign-in, or while nothing is audible", async () => {
    for (const r of [rig({ id: null }), rig({ session: false }), rig({ decks: [deck("A", 0), deck("B", 0, false)] })]) { await r.n.tick(); assert.equal(r.calls.length, 0); }
  });
  test("a refused or failed send is tried again after RETRY_MS, not every second", async () => {
    const r = rig({ status: 403 });
    await r.n.tick();
    r.clock.t += 1000; await r.n.tick();
    assert.equal(r.calls.length, 1, "not hammering");
    r.st.status = 200; r.clock.t += RETRY_MS; await r.n.tick();
    assert.equal(r.calls.length, 2);
    r.st.offline = true; r.clock.t += HEARTBEAT_MS; await r.n.tick();
    r.clock.t += 1000; await r.n.tick();
    assert.equal(r.calls.length, 3, "an offline error is swallowed and waited out");
  });
});
