// The LIVE layout (booth/live-geometry.ts): at every window size nothing overlaps, nothing leaves its module, controls stay usable.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BAR_ROOM_NEEDED_PX, TOP_BAR, fxFitsTheBar, liveGeometry, liveTouch } from "../src/booth/live-geometry.ts";
import type { Rect } from "../src/booth/gear.ts";

// 1152 x 720 is Zé's 1440 x 900 screen with the browser at 100 % (Chrome follows the 1.25 text scaling here); 1130 x 650 the same window with the tab bar.
const SIZES: [number, number][] = [[1024, 600], [1152, 720], [1130, 650], [1280, 720], [1366, 768], [1600, 800], [1920, 1080], [2560, 1440], [1440, 900]];
const E = 0.01;
const inside = (outer: Rect, r: Rect) => r.x >= outer.x - E && r.y >= outer.y - E && r.x + r.w <= outer.x + outer.w + E && r.y + r.h <= outer.y + outer.h + E;
const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x + E || b.x + b.w <= a.x + E || a.y + a.h <= b.y + E || b.y + b.h <= a.y + E;
const box = (x: number, y: number, r: number): Rect => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });

describe("LIVE layout", () => {
  for (const [W, H] of SIZES) {
    describe(`${W}x${H}`, () => {
      const g = liveGeometry(W, H);
      const window: Rect = { x: 0, y: 0, w: W, h: H };

      test("the three modules sit in one row, in order, inside the window, with the effects strip above them and below the top bar, without touching", () => {
        const mods = [g.deck[0].rect, g.mixer.rect, g.deck[1].rect];
        for (const m of [...mods, g.fx.rect]) assert.ok(inside(window, m), JSON.stringify(m));
        for (let i = 1; i < mods.length; i++) assert.ok(mods[i - 1].x + mods[i - 1].w < mods[i].x, `module ${i - 1} ends before module ${i}`);
        assert.ok(g.fx.rect.y >= g.gear.y + g.gear.h, "the effects above the gear row");
        if (!g.fxInBar) assert.ok(g.fx.rect.y + g.fx.rect.h <= H - TOP_BAR + E, "a strip below the top bar");
        assert.ok(mods.every((m) => Math.abs(m.y - g.gear.y) < E && Math.abs(m.h - g.gear.h) < E));
      });

      test("the library and the stream panel are under the gear row, side by side, and have room to work in", () => {
        assert.ok(inside(window, g.library) && inside(window, g.streamPanel));
        assert.ok(apart(g.library, g.streamPanel));
        assert.ok(g.library.y + g.library.h <= g.gear.y + E);
        assert.ok(g.library.h >= 0.26 * H, `library height ${g.library.h} of ${H}`);
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

      test("the loop controls: three short rows beside the platter, inside the deck, apart, big enough to touch; the mode tabs sit right above the pads", () => {
        for (const d of g.deck) {
          const L = d.loopUi, all = [...L.io, L.toggle, ...L.scale, ...L.auto];
          for (const r of all) { assert.ok(inside(d.rect, r)); assert.ok(r.w >= 14 * g.u && r.h >= 15 * g.u); assert.ok(r.x >= d.platter.c.x + d.platter.outer + 4 * g.u, "right of the platter"); assert.ok(r.x + r.w < d.pitch.x - 12 * g.u, "left of the pitch fader"); }
          for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) assert.ok(apart(all[a], all[b]), `controls ${a} and ${b}`);
          assert.ok(Math.max(...all.map((r) => r.w)) <= 50 * g.u, "no wide buttons");
          for (const t of d.modeTabs) { assert.ok(inside(d.rect, t) && apart(t, d.pads[0]) && t.h >= 11 * g.u); assert.ok(t.y >= d.pads[0].y + d.pads[0].h && t.y - (d.pads[0].y + d.pads[0].h) < 8 * g.u, "right above the pads"); }
          assert.ok(apart(d.modeTabs[0], d.modeTabs[1]));
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
          for (let i = 1; i < 4; i++) assert.ok(s.knobY[i - 1] - s.knobY[i] >= 2 * s.knobR + 4 * g.u, "knobs apart");
          const cue = { x: s.cue.x - s.cueW / 2, y: s.cue.y - s.cueH / 2, w: s.cueW, h: s.cueH };
          assert.ok(inside(M.rect, cue));
          const fader: Rect = { x: s.fader.x - 12 * g.u, y: s.fader.y - s.fader.travel / 2 - 7 * g.u, w: 24 * g.u, h: s.fader.travel + 14 * g.u };
          assert.ok(inside(M.rect, fader));
          assert.ok(apart(cue, fader), "CUE button and the fader");
          assert.ok(s.knobY[3] - s.knobR > cue.y + cue.h, "the last of the four knobs above the CUE button");
          // FILTER is under the fader: its name between the fader and the knob, the knob inside the strip.
          assert.ok(s.knobY[4] + s.knobR < fader.y - 1 && s.filterLabelY > s.knobY[4] + s.knobR && s.filterLabelY < fader.y, "FILTER under the fader");
          assert.ok(inside(M.rect, box(s.x, s.knobY[4], s.knobR + 3.5 * g.u)), "FILTER's ring inside the mixer");
        }
        const mid = M.mid, strips = M.strip.map((s) => s.x);
        assert.ok(inside(M.rect, box(mid.master.x, mid.master.y, mid.masterR)));
        for (const mx of mid.meterX) assert.ok(inside(M.rect, { x: mx - mid.meter.w / 2, y: mid.meter.y, w: mid.meter.w, h: mid.meter.h }));
        for (const sl of [mid.mix, mid.level]) assert.ok(inside(M.rect, { x: sl.x - sl.w / 2, y: sl.y - 6 * g.u, w: sl.w, h: 12 * g.u }));
        assert.ok(inside(M.rect, { x: mid.cross.x - mid.cross.travel / 2 - 10 * g.u, y: mid.cross.y - 12 * g.u, w: mid.cross.travel + 20 * g.u, h: 24 * g.u }));
        assert.ok(strips[0] + 14 * g.u < mid.cross.x - mid.cross.travel / 2 - 8 * g.u, "the crossfader keeps clear of the channel faders");
        assert.ok(mid.cross.y < mid.level.y, "the crossfader under the headphone faders");
      });

      test("the effects controls: in the TOP BAR right after the stream bar when the window is wide enough, else a thin strip above the gear row; the name, four small knobs, a SHORT horizontal LEVEL fader; all inside and apart", () => {
        const F = g.fx, u = g.u, M = g.mixer;
        assert.equal(g.fxInBar, fxFitsTheBar(W));
        if (g.fxInBar) {
          assert.ok(F.rect.y >= H - TOP_BAR - E && F.rect.y + F.rect.h <= H + E, "inside the top bar");
          assert.ok(F.rect.x >= 373, "after the stream bar's time");
          assert.ok(F.rect.x + F.rect.w <= W - 416 + E, "clear of the buttons on the right (EXIT FULLSCREEN included)");
          assert.ok(g.gear.y + g.gear.h <= H - TOP_BAR - 2, "the gear row starts under the bar: the controls cost it no height");
        } else {
          assert.ok(F.rect.y > g.gear.y + g.gear.h, "above the gear row");
          assert.ok(F.rect.h <= 31 * u && F.rect.h >= 28 * u, "thin");
          assert.ok(Math.abs(F.rect.w - g.gear.w) < 1, "as wide as the gear row");
        }
        assert.ok(inside(F.rect, F.name));
        assert.equal(F.knobs.length, 4);
        F.knobs.forEach((k, i) => {
          assert.ok(k.r < M.strip[0].knobR, "smaller than the mixer's knobs");
          if (!g.fxInBar) assert.ok(k.r >= 0.5 * M.strip[0].knobR, "but not tiny"); else assert.ok(k.r >= 9, "in the bar: not smaller than 9 px");
          assert.ok(inside(F.rect, box(k.c.x, k.c.y, k.r)) && inside(F.rect, k.touch), `knob ${i} inside`);
          assert.ok(k.value.x > k.c.x + k.r, "its step to the right of it");
          if (g.fxInBar) assert.ok(k.name.y < k.c.y - k.r + 2 && k.name.x < k.c.x, "in the bar its name is UNDER the knob, starting at its left edge");
          else assert.ok(k.name.x > k.c.x + k.r, "its name to the right of it");
          if (i) { assert.ok(apart(F.knobs[i - 1].touch, k.touch), "touch areas apart"); assert.ok(k.c.x > F.knobs[i - 1].c.x + 2 * k.r + 4, "knobs apart"); }
        });
        assert.ok(apart(F.name, F.knobs[0].touch), "the name apart from the first knob");
        const L = F.level;
        assert.ok(inside(F.rect, { x: L.x - L.travel / 2 - L.capW / 2, y: L.y - L.capH / 2, w: L.travel + L.capW, h: L.capH }), "the fader inside");
        assert.ok(inside(F.rect, L.touch));
        assert.ok(L.x - L.travel / 2 - L.capW / 2 > F.knobs[3].touch.x + F.knobs[3].touch.w - 1, "the fader right of the knobs");
        if (g.fxInBar) assert.ok(L.labelAlign === "center" && Math.abs(L.label.x - L.x) < E && L.label.y < L.y, "in the bar LEVEL's name is centred under the fader");
        else assert.ok(L.label.x < L.x - L.travel / 2 - L.capW / 2, "its name to the left of it");
        assert.ok(apart(F.knobs[3].touch, L.touch));
        // Short: a hand's width, not a long slide (the channel faders are 74 units; this one at most about two thirds of the pixels of that).
        assert.ok(L.travel <= 0.75 * M.strip[0].fader.travel, `a short travel: ${L.travel} of ${M.strip[0].fader.travel}`);
        if (!g.fxInBar) assert.ok(F.name.x > F.rect.x + 40 * u && L.touch.x + L.touch.w < F.rect.x + F.rect.w - 40 * u, "the cluster in the middle of the strip");
      });

      test("the FX buttons: a square one on the OUTER side of each FILTER knob, inside the mixer, clear of the knob and its ring, big enough to touch", () => {
        const M = g.mixer;
        M.strip.forEach((s, d) => {
          const r = s.fxBtn;
          assert.ok(Math.abs(r.w - r.h) < 1e-6 && r.w >= 15 * g.u, "square");
          assert.ok(inside(M.rect, r));
          assert.ok(apart(r, box(s.x, s.knobY[4], s.knobR + 3.5 * g.u)), "clear of the FILTER knob and its ring");
          const cx = r.x + r.w / 2;
          if (d === 0) assert.ok(cx < s.x, "channel A: left of its filter"); else assert.ok(cx > s.x, "channel B: right of its filter");
          assert.ok(Math.abs(r.y + r.h / 2 - s.knobY[4]) < 1e-6, "level with the knob");
          const fader: Rect = { x: s.fader.x - 12 * g.u, y: s.fader.y - s.fader.travel / 2 - 7 * g.u, w: 24 * g.u, h: s.fader.travel + 14 * g.u };
          assert.ok(apart(r, fader), "clear of the channel fader");
        });
      });

      test("the deck header, left to right: the title (cut short, never over the rest), the time, the four bar lamps, the key (a smaller type), the tempo at the corner; the pitch reads out under its fader", () => {
        for (const d of g.deck) {
          const right = d.rect.x + d.rect.w;
          // The right of the header in order, with room for each text: time 30 units, lamps 4 x 8, key 16, tempo 31.
          assert.ok(d.time.x < d.lamps[0].x - 2.5 * g.u, "the time left of the lamps");
          for (let i = 1; i < 4; i++) assert.ok(d.lamps[i].x - d.lamps[i - 1].x >= 7.9 * g.u);
          assert.ok(d.lamps[3].x + 2.5 * g.u < d.key.x - 16 * g.u + 8 * g.u, "the lamps left of the key");
          assert.ok(d.key.x < d.bpm.x - 31 * g.u + 2 * g.u, "the key left of the tempo");
          assert.ok(Math.abs(d.bpm.x - (right - 8 * g.u)) < 1e-6, "the tempo at the corner");
          assert.equal(Math.round(d.key.y), Math.round(d.bpm.y)); assert.equal(Math.round(d.time.y), Math.round(d.bpm.y));
          // The title stops before the time's text (30 units left of the time's right edge).
          assert.ok(d.title.x + d.titleMax <= d.time.x - 30 * g.u + 1e-6, "a long title does not run into the time");
          assert.ok(d.titleMax >= 100 * g.u, "and still has room");
          assert.ok(d.pitchText.y < d.pitch.y - d.pitch.travel / 2, "pitch % under the fader");
          assert.ok(inside(d.rect, { x: d.pitchText.x - 16 * g.u, y: d.pitchText.y - 5 * g.u, w: 32 * g.u, h: 10 * g.u }));
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

  test("Zé's 100 % window (1152 x 720, EXIT FULLSCREEN, measured on 20 Nov): the effects sit in the top bar between the time and the buttons, with and without the page's measure", () => {
    const room = { left: 363, right: 739 }; // livebar ends at 363, #top starts at 739 (measured in the page)
    for (const r of [undefined, room]) {
      const g = liveGeometry(1152, 720, r);
      assert.ok(g.fxInBar, "in the bar, not the strip above the decks");
      assert.ok(g.fx.rect.x >= 363 + 10 - E && g.fx.rect.x + g.fx.rect.w <= 739 - 10 + E, "between 00:00:00 and KEYS & MIDI");
    }
  });

  test("the page's measure decides: a bar with less room than the controls need puts them in the strip, and a wide window with a crowded bar too", () => {
    assert.ok(!liveGeometry(1152, 720, { left: 363, right: 680 }).fxInBar, "317 px between the text and the buttons, 20 of them gaps: 297 is not enough");
    assert.ok(liveGeometry(1152, 720, { left: 363, right: 700 }).fxInBar, "337 px between them is enough");
    assert.ok(!liveGeometry(1920, 1080, { left: 700, right: 960 }).fxInBar, "a crowded bar in a wide window");
    assert.ok(liveGeometry(1100, 700, { left: 363, right: 1100 - 330 }).fxInBar === fxFitsTheBar(1100, { left: 363, right: 1100 - 330 }));
  });

  test("the room the page asks for (BAR_ROOM_NEEDED_PX) is exactly what makes the effects fit: one pixel less and they go to the strip", () => {
    assert.ok(liveGeometry(1920, 1080, { left: 200, right: 200 + BAR_ROOM_NEEDED_PX }).fxInBar);
    assert.ok(!liveGeometry(1920, 1080, { left: 200, right: 200 + BAR_ROOM_NEEDED_PX - 1 }).fxInBar);
    const g = liveGeometry(1920, 1080, { left: 200, right: 200 + BAR_ROOM_NEEDED_PX });
    assert.ok(g.fx.rect.x >= 210 - E && g.fx.rect.x + g.fx.rect.w <= 200 + BAR_ROOM_NEEDED_PX - 10 + E, "inside it, a gap each side");
  });

  test("in the bar the controls keep their size however big the window is (pixels, not units), and stay inside the top 28 px so the page's message fits under them", () => {
    const a = liveGeometry(1152, 720), b = liveGeometry(2560, 1440);
    assert.ok(a.fxInBar && b.fxInBar);
    assert.equal(a.fx.text, b.fx.text);
    assert.equal(a.fx.rect.w, b.fx.rect.w);
    assert.equal(b.fx.knobs[0].r, 9);
    for (const g of [a, b]) assert.ok(g.fx.rect.y >= g.H - 28 - E && g.fx.rect.y + g.fx.rect.h <= g.H + E);
  });
});
