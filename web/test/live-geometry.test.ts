// The LIVE layout (booth/live-geometry.ts): at every window size nothing overlaps, nothing leaves its module, controls stay usable.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TOP_BAR, liveGeometry, liveTouch } from "../src/booth/live-geometry.ts";
import type { Rect } from "../src/booth/gear.ts";

const SIZES: [number, number][] = [[1024, 600], [1280, 720], [1366, 768], [1600, 800], [1920, 1080], [2560, 1440], [1440, 900]];
const E = 0.01;
const inside = (outer: Rect, r: Rect) => r.x >= outer.x - E && r.y >= outer.y - E && r.x + r.w <= outer.x + outer.w + E && r.y + r.h <= outer.y + outer.h + E;
const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x + E || b.x + b.w <= a.x + E || a.y + a.h <= b.y + E || b.y + b.h <= a.y + E;
const box = (x: number, y: number, r: number): Rect => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });

describe("LIVE layout", () => {
  for (const [W, H] of SIZES) {
    describe(`${W}x${H}`, () => {
      const g = liveGeometry(W, H);
      const window: Rect = { x: 0, y: 0, w: W, h: H };

      test("the four modules sit in one row, in order, inside the window, below the top bar, without touching", () => {
        const mods = [g.deck[0].rect, g.mixer.rect, g.fx.rect, g.deck[1].rect];
        for (const m of mods) assert.ok(inside(window, m), JSON.stringify(m));
        for (let i = 1; i < mods.length; i++) assert.ok(mods[i - 1].x + mods[i - 1].w < mods[i].x, `module ${i - 1} ends before module ${i}`);
        assert.ok(g.gear.y + g.gear.h <= H - TOP_BAR + E);
        assert.ok(mods.every((m) => Math.abs(m.y - g.gear.y) < E && Math.abs(m.h - g.gear.h) < E));
      });

      test("the library and the stream panel are under the gear row, side by side, and have room to work in", () => {
        assert.ok(inside(window, g.library) && inside(window, g.streamPanel));
        assert.ok(apart(g.library, g.streamPanel));
        assert.ok(g.library.y + g.library.h <= g.gear.y + E);
        assert.ok(g.library.h >= 0.28 * H, `library height ${g.library.h} of ${H}`);
        assert.ok(g.library.w >= 0.5 * W);
      });

      test("the waveforms: the big one, the strip of the whole record under it, the zoom buttons over its corner; the big one is big", () => {
        for (const d of g.deck) {
          assert.ok(inside(d.rect, d.zoom) && inside(d.rect, d.wave));
          assert.ok(apart(d.zoom, d.wave) && d.wave.y + d.wave.h <= d.zoom.y + E, "the strip under the big waveform");
          assert.ok(inside(d.zoom, d.zoomIn) && inside(d.zoom, d.zoomOut) && apart(d.zoomIn, d.zoomOut));
          assert.ok(d.zoom.h >= 40 * g.u && d.zoom.w >= 270 * g.u, "a waveform worth zooming");
          assert.ok(d.zoom.y >= d.platter.c.y + d.platter.outer - E, "the waveforms above the platter");
        }
      });

      test("the loop controls: five rows in the column beside the platter, inside it, apart, big enough to touch", () => {
        for (const d of g.deck) {
          const L = d.loopUi, all = [...L.mode, ...L.io, ...L.scale, L.toggle, ...L.auto];
          for (const r of all) { assert.ok(inside(d.rect, r)); assert.ok(r.w >= 14 * g.u && r.h >= 16 * g.u); assert.ok(r.x >= d.platter.c.x + d.platter.outer + 4 * g.u, "right of the platter"); assert.ok(r.x + r.w < d.pitch.x - 12 * g.u, "left of the pitch fader"); }
          for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) assert.ok(apart(all[a], all[b]), `controls ${a} and ${b}`);
          assert.ok(d.loopUi.hint.y > d.rect.y);
        }
      });

      test("every part of a deck stays inside it: waveform, platter, readouts, pitch fader, transport, pads", () => {
        for (const d of g.deck) {
          assert.ok(inside(d.rect, d.wave));
          assert.ok(inside(d.rect, box(d.platter.c.x, d.platter.c.y, d.platter.outer)), "the platter");
          assert.ok(inside(d.rect, d.info) && inside(d.rect, d.loop));
          assert.ok(inside(d.rect, { x: d.pitch.x - 14 * g.u, y: d.pitch.y - d.pitch.travel / 2 - 8 * g.u, w: 28 * g.u, h: d.pitch.travel + 16 * g.u }), "the pitch fader");
          for (const k of ["cue", "play", "sync"] as const) assert.ok(inside(d.rect, { x: d.buttons[k].x - d.buttons.w / 2, y: d.buttons[k].y - d.buttons.h / 2, w: d.buttons.w, h: d.buttons.h }), k);
          for (const p of d.pads) assert.ok(inside(d.rect, p));
        }
      });

      test("inside a deck nothing lies on anything else: the platter keeps clear of the info column, the pitch fader, the waveform and the transport", () => {
        for (const d of g.deck) {
          const p = box(d.platter.c.x, d.platter.c.y, d.platter.outer);
          assert.ok(p.x + p.w < d.info.x, "platter left of the info column");
          assert.ok(d.info.x + d.info.w < d.pitch.x - 12 * g.u, "info column left of the pitch fader");
          assert.ok(p.y + p.h <= d.wave.y + E, "platter under the waveform");
          const buttons = [d.buttons.cue, d.buttons.play, d.buttons.sync].map((c) => ({ x: c.x - d.buttons.w / 2, y: c.y - d.buttons.h / 2, w: d.buttons.w, h: d.buttons.h }));
          for (const b of buttons) { assert.ok(b.y + b.h <= p.y + 2 * g.u, "transport under the platter"); for (const pad of d.pads) assert.ok(apart(b, pad), "transport and pads"); }
          for (let i = 1; i < buttons.length; i++) assert.ok(apart(buttons[i - 1], buttons[i]));
          for (let i = 1; i < d.pads.length; i++) assert.ok(apart(d.pads[i - 1], d.pads[i]));
        }
      });

      test("the mixer: strips and the middle column inside it, knobs apart from each other, the fader clear of the CUE button, the crossfader low in the middle", () => {
        const M = g.mixer;
        for (const s of M.strip) {
          for (const y of s.knobY) assert.ok(inside(M.rect, box(s.x, y, s.knobR)));
          for (let i = 1; i < s.knobY.length; i++) assert.ok(s.knobY[i - 1] - s.knobY[i] >= 2 * s.knobR + 4 * g.u, "knobs apart");
          const cue = { x: s.cue.x - s.cueW / 2, y: s.cue.y - s.cueH / 2, w: s.cueW, h: s.cueH };
          assert.ok(inside(M.rect, cue));
          const fader: Rect = { x: s.fader.x - 12 * g.u, y: s.fader.y - s.fader.travel / 2 - 7 * g.u, w: 24 * g.u, h: s.fader.travel + 14 * g.u };
          assert.ok(inside(M.rect, fader));
          assert.ok(apart(cue, fader), "CUE button and the fader");
          assert.ok(s.knobY[4] - s.knobR > cue.y + cue.h, "the last knob above the CUE button");
        }
        const mid = M.mid, strips = M.strip.map((s) => s.x);
        assert.ok(inside(M.rect, box(mid.master.x, mid.master.y, mid.masterR)));
        for (const mx of mid.meterX) assert.ok(inside(M.rect, { x: mx - mid.meter.w / 2, y: mid.meter.y, w: mid.meter.w, h: mid.meter.h }));
        for (const sl of [mid.mix, mid.level]) assert.ok(inside(M.rect, { x: sl.x - sl.w / 2, y: sl.y - 6 * g.u, w: sl.w, h: 12 * g.u }));
        assert.ok(inside(M.rect, { x: mid.cross.x - mid.cross.travel / 2 - 10 * g.u, y: mid.cross.y - 12 * g.u, w: mid.cross.travel + 20 * g.u, h: 24 * g.u }));
        assert.ok(strips[0] + 14 * g.u < mid.cross.x - mid.cross.travel / 2 - 8 * g.u, "the crossfader keeps clear of the channel faders");
        assert.ok(mid.cross.y < mid.level.y, "the crossfader under the headphone faders");
      });

      test("the FX controller: one narrow unit with its name, ON, four vertical faders and DIV, everything inside it and apart", () => {
        const F = g.fx, u = g.u;
        assert.ok(F.rect.w <= 0.14 * g.gear.w + 1, "narrow: the decks get the room");
        for (const r of [F.name, F.on]) assert.ok(inside(F.rect, r));
        assert.ok(apart(F.name, F.on));
        for (const f of F.faders) assert.ok(inside(F.rect, { x: f.x - F.capW / 2, y: f.y - f.travel / 2 - 6 * u, w: F.capW, h: f.travel + 12 * u }));
        for (let i = 1; i < F.faders.length; i++) assert.ok(F.faders[i].x - F.faders[i - 1].x >= F.capW + 2 * u, "faders apart");
        assert.ok(F.faders[0].y + F.faders[0].travel / 2 + 6 * u < F.on.y, "the faders under the ON button");
        const lastFader = F.faders[F.faders.length - 1];
        assert.ok(lastFader.x + F.capW / 2 + 2 * u < F.div.x - 3 * u, "DIV right of the faders");
        assert.equal(F.div.steps.length, 4);
        F.div.steps.forEach((p, i) => { assert.ok(inside(F.rect, box(p.x, p.y, 4 * u))); if (i) assert.ok(F.div.steps[i - 1].y > p.y, "1/4 at the top, 1/32 at the bottom"); });
        F.div.touch.forEach((r, i) => { assert.ok(inside(F.rect, r), `DIV step ${i}`); if (i) assert.ok(apart(F.div.touch[i - 1], r)); });
        // The labels under the faders fit between the module's edges.
        assert.ok(F.labelY - 3 * u > F.rect.y && F.labelY < F.faders[0].y - F.faders[0].travel / 2);
      });

      test("the readouts: the key sits right under the tempo at the same x, clear of the knobs; the pitch reads out under its fader", () => {
        const M = g.mixer;
        for (let d = 0; d < 2; d++) {
          assert.ok(M.key[d].y < M.bpm[d].y && M.bpm[d].y - M.key[d].y <= 16 * g.u, "key under the tempo");
          assert.equal(Math.round(M.key[d].x), Math.round(M.bpm[d].x));
          // The key (about 16 units wide, toward the middle from its corner) must not run into the GAIN knob or its ring beside it.
          const s = M.strip[d], ring = s.knobR + 3.5 * g.u;
          const keyBox: Rect = d === 0 ? { x: M.key[d].x, y: M.key[d].y - 5 * g.u, w: 18 * g.u, h: 10 * g.u } : { x: M.key[d].x - 18 * g.u, y: M.key[d].y - 5 * g.u, w: 18 * g.u, h: 10 * g.u };
          assert.ok(apart(keyBox, box(s.x, s.knobY[0], ring)), "key and the first knob");
          assert.ok(inside(M.rect, keyBox));
        }
        for (const d of g.deck) {
          assert.ok(d.pitchText.y < d.pitch.y - d.pitch.travel / 2, "pitch % under the fader");
          assert.ok(inside(d.rect, { x: d.pitchText.x - 16 * g.u, y: d.pitchText.y - 5 * g.u, w: 32 * g.u, h: 10 * g.u }));
        }
      });

      test("the FILTER knob's square (a knob and a margin, drawn round it) stays inside the strip and clear of the knob above and the CUE button below", () => {
        for (const s of g.mixer.strip) {
          const half = s.knobR + 6.5 * g.u, sq = box(s.x, s.knobY[4], half);
          assert.ok(inside(g.mixer.rect, sq));
          assert.ok(s.knobY[3] - s.knobR - 3.5 * g.u > sq.y + sq.h - E, "clear of LOW's ring");
          assert.ok(sq.y > s.cue.y + s.cueH / 2 - E, "clear of the CUE button");
        }
      });

      test("touch areas: knobs, faders and buttons are big enough for a finger and a mouse, and do not overlap each other", () => {
        const t = liveTouch(g);
        const all: Rect[] = [...t.eq.flat(), ...t.channel, ...t.cue, t.cross, t.master, t.mix, t.level];
        for (const r of all) { assert.ok(inside(g.mixer.rect, r)); }
        for (const r of t.eq.flat()) assert.ok(r.w >= 20 && r.h >= 14, `a knob's touch area is ${r.w}x${r.h} px`);
        for (const r of [...t.cue, t.mix, t.level]) assert.ok(r.h >= 10);
        for (let a = 0; a < t.eq.length; a++) for (const k of t.eq[a]) { assert.ok(apart(k, t.channel[a]), "knobs and the fader"); assert.ok(apart(k, t.cue[a])); }
        assert.ok(apart(t.mix, t.level), "the two headphone faders apart");
        assert.ok(apart(t.cross, t.level), "the crossfader and the headphone faders apart");
        assert.ok(apart(t.master, t.mix));
      });
    });
  }

  test("the unit grows with the window and stays readable", () => {
    const small = liveGeometry(1024, 600), big = liveGeometry(1920, 1080);
    assert.ok(big.u > small.u);
    assert.ok(small.u >= 0.5);
    assert.ok(small.mixer.strip[0].knobR >= 4.5, "a knob is at least 9 px wide at the smallest size we care about");
  });

  test("a wider window gives the extra width to the decks (a longer waveform), not to the knobs", () => {
    const a = liveGeometry(1600, 800), b = liveGeometry(2400, 800);
    assert.equal(a.u, b.u, "same unit when the height limits it");
    assert.ok(b.deck[0].wave.w > a.deck[0].wave.w);
    assert.equal(b.mixer.rect.w, a.mixer.rect.w);
  });
});
