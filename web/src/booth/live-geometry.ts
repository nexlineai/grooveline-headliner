// The LIVE booth's layout (web only; the game's booth keeps the iPhone's). Pure arithmetic, no drawing and no DOM, so
// it can be tested at any window size. World: CSS pixels, y UP, origin bottom-left, like booth.ts.
//
//   +-----------------------------------------------------------------------------+
//   | top bar (stream state, the page's small buttons)                            |
//   +-----------+------------------+------------+------------------+--------------+
//   | deck A    | mixer            | FX         | deck B           |  the gear row
//   +-----------+------------------+------------+------------------+--------------+
//   | library: wall, crates, search                    | stream panel               |
//   +-----------------------------------------------------------------------------+
//
// Everything is drawn in design units `u` (1 u = `u` pixels). The gear row is 1000 u wide at least and 300 u high. When the
// window is wider than that, the extra width goes to the decks (a longer waveform), never to bigger knobs.

import { centred } from "./gear.ts";
import type { Point, Rect } from "./gear.ts";

export const TOP_BAR = 40;
const GEAR_H = 300;
const DECK_MIN = 296, MIXER_W = 226, FX_W = 112, GAP = 5.333;

export interface LiveDeckGeometry {
  rect: Rect;
  /** Where the title starts (left aligned, baseline), and how wide it may be. */
  title: Point; titleMax: number;
  /** Remaining time (right aligned) and the four beat lamps. */
  time: Point; lamps: Point[];
  /** The zoomable waveform (it scrolls with the record), the strip of the WHOLE record under it (a touch there drops the needle),
   * and the two zoom buttons over the corner of the big one. */
  zoom: Rect; wave: Rect; zoomIn: Rect; zoomOut: Rect;
  platter: { c: Point; outer: number };
  /** The column between the platter and the pitch fader: tempo, key, pitch; and a reserved panel for loops (L2). */
  info: Rect; pitchText: Point; loop: Rect;
  /** The loop controls, in the column beside the platter: what the pads do (cues or saved loops), IN and OUT, half and double, the loop on or
   * off, an automatic loop of 1, 2, 4 or 8 beats, and a line of help. */
  loopUi: { mode: Rect[]; io: Rect[]; scale: Rect[]; toggle: Rect; auto: Rect[]; hint: Point };
  pitch: { x: number; y: number; travel: number };
  buttons: { cue: Point; play: Point; sync: Point; w: number; h: number };
  /** Eight pads under the transport (hot cues and loops: L2). */
  pads: Rect[];
}

export interface LiveStrip {
  x: number;
  /** TRIM, HI, MID, LOW, FILTER from the top. */
  knobY: number[]; knobR: number;
  cue: Point; cueW: number; cueH: number;
  fader: { x: number; y: number; travel: number };
}

export interface LiveMixerGeometry {
  rect: Rect;
  /** The tempo of each deck at the top corners, the key right under it (the same size). */
  bpm: Point[]; key: Point[]; phase: { c: Point; w: number };
  strip: LiveStrip[];
  /** The middle column. */
  mid: { x: number; master: Point; masterR: number; meterX: number[]; meter: { y: number; h: number; w: number };
         mix: { x: number; y: number; w: number }; level: { x: number; y: number; w: number };
         cross: { x: number; y: number; travel: number } };
}

/** The effect controller: one unit, narrow: the effect's name (arrows either side), ON, four vertical faders for what the effect
 * does, and DIV, a vertical stepped selector for the note value. */
export interface LiveFxGeometry {
  rect: Rect; title: Point;
  name: Rect; on: Rect;
  faders: { x: number; y: number; travel: number }[]; capW: number; labelY: number;
  /** DIV: the four steps from the top (1/4, 1/8, 1/16, 1/32), where each cap sits, its touch area, and where its label goes. */
  div: { x: number; labelX: number; steps: Point[]; touch: Rect[]; labelY: number };
}

export interface LiveGeometry {
  W: number; H: number; u: number;
  topBar: Rect; gear: Rect;
  deck: LiveDeckGeometry[]; mixer: LiveMixerGeometry; fx: LiveFxGeometry;
  /** Under the gear row. */
  lower: Rect; library: Rect; streamPanel: Rect;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export function liveGeometry(W: number, H: number): LiveGeometry {
  const margin = 10;
  const fixedW = MIXER_W + FX_W + 3 * GAP + 2 * DECK_MIN;
  const uW = (W - 2 * margin) / fixedW;
  const uH = (H * 0.63 - TOP_BAR - 8) / GEAR_H;
  const u = clamp(Math.min(uW, uH), 0.5, 3);
  const gearH = GEAR_H * u;
  const gearTop = H - TOP_BAR - 4;
  const gearY = gearTop - gearH;
  // The decks share what is left of the width.
  const deckW = Math.max(DECK_MIN * u, (W - 2 * margin - (MIXER_W + FX_W + 3 * GAP) * u) / 2);
  const total = 2 * deckW + (MIXER_W + FX_W + 3 * GAP) * u;
  let x = (W - total) / 2;
  const rectA = { x, y: gearY, w: deckW, h: gearH };
  x += deckW + GAP * u;
  const rectM = { x, y: gearY, w: MIXER_W * u, h: gearH };
  x += MIXER_W * u + GAP * u;
  const rectF = { x, y: gearY, w: FX_W * u, h: gearH };
  x += FX_W * u + GAP * u;
  const rectB = { x, y: gearY, w: deckW, h: gearH };

  const deck = [rectA, rectB].map((rect) => deckGeometry(rect, u));
  const mixer = mixerGeometry(rectM, u);
  const fx = fxGeometry(rectF, u);

  const lowerTop = gearY - 8;
  const lower: Rect = { x: margin, y: 6, w: W - 2 * margin, h: Math.max(0, lowerTop - 6) };
  const panelW = clamp(W * 0.24, 230, 420);
  const library: Rect = { x: lower.x, y: lower.y, w: lower.w - panelW - 10, h: lower.h };
  const streamPanel: Rect = { x: lower.x + lower.w - panelW, y: lower.y, w: panelW, h: lower.h };
  return { W, H, u, topBar: { x: 0, y: H - TOP_BAR, w: W, h: TOP_BAR }, gear: { x: (W - total) / 2, y: gearY, w: total, h: gearH }, deck, mixer, fx, lower, library, streamPanel };
}

function deckGeometry(rect: Rect, u: number): LiveDeckGeometry {
  const top = rect.y + rect.h, w = rect.w / u;
  const P = (dx: number, dy: number): Point => ({ x: rect.x + dx * u, y: top - dy * u });
  const outer = 68;
  const c = P(8 + outer, 96 + outer);
  const infoX = 8 + 2 * outer + 22, pitchX = w - 22;
  const infoW = pitchX - 22 - infoX;
  const padW = (w - 16 - 7 * 3) / 8;
  return {
    rect,
    title: P(8, 11), titleMax: (w - 8 - 58 - 14) * u,
    time: P(w - 52, 11), lamps: [0, 1, 2, 3].map((i) => P(w - 36 + i * 9, 11)),
    zoom: { x: rect.x + 8 * u, y: top - 76 * u, w: rect.w - 16 * u, h: 56 * u },
    wave: { x: rect.x + 8 * u, y: top - 90 * u, w: rect.w - 16 * u, h: 11 * u },
    zoomOut: { x: rect.x + (w - 8 - 31) * u, y: top - 33 * u, w: 14 * u, h: 12 * u },
    zoomIn: { x: rect.x + (w - 8 - 16) * u, y: top - 33 * u, w: 14 * u, h: 12 * u },
    platter: { c, outer: outer * u },
    info: { x: rect.x + infoX * u, y: top - 236 * u, w: infoW * u, h: 140 * u },
    // The tempo and the key are in the mixer; the pitch reads out under its fader.
    pitchText: P(pitchX, 258),
    loop: { x: rect.x + infoX * u, y: top - 232 * u, w: infoW * u, h: 52 * u },
    loopUi: loopControls(rect, u, infoX, infoW),
    pitch: { x: rect.x + pitchX * u, y: top - 164 * u, travel: 128 * u },
    buttons: { cue: P(8 + 28, 247), play: P(8 + 28 + 60, 247), sync: P(8 + 28 + 120, 247), w: 56 * u, h: 22 * u },
    pads: Array.from({ length: 8 }, (_, i) => ({ x: rect.x + (8 + i * (padW + 3)) * u, y: top - 288 * u, w: padW * u, h: 24 * u })),
  };
}

/** Five rows in the column between the platter and the pitch fader: 18 units high, 6 apart. */
function loopControls(rect: Rect, u: number, infoX: number, infoW: number): LiveDeckGeometry["loopUi"] {
  const top = rect.y + rect.h;
  const row = (i: number): number => 100 + i * 24;
  const R = (dx: number, dy: number, w: number): Rect => ({ x: rect.x + (infoX + dx) * u, y: top - (dy + 18) * u, w: w * u, h: 18 * u });
  const half = (infoW - 3) / 2, quarter = (infoW - 9) / 4;
  return {
    mode: [R(0, row(0), half), R(half + 3, row(0), half)],
    io: [R(0, row(1), half), R(half + 3, row(1), half)],
    scale: [R(0, row(2), half), R(half + 3, row(2), half)],
    toggle: R(0, row(3), infoW),
    auto: [0, 1, 2, 3].map((i) => R(i * (quarter + 3), row(4), quarter)),
    hint: { x: rect.x + (infoX + infoW / 2) * u, y: top - (row(4) + 18 + 9) * u },
  };
}

function mixerGeometry(rect: Rect, u: number): LiveMixerGeometry {
  const top = rect.y + rect.h, w = MIXER_W;
  const P = (dx: number, dy: number): Point => ({ x: rect.x + dx * u, y: top - dy * u });
  const centre = w / 2;
  const strip = [40, w - 40].map((cx): LiveStrip => ({
    x: rect.x + cx * u,
    knobY: [36, 66, 96, 126, 156].map((dy) => top - dy * u), knobR: 9 * u,
    cue: P(cx, 180), cueW: 44 * u, cueH: 14 * u,
    fader: { x: rect.x + cx * u, y: top - 244 * u, travel: 92 * u },
  }));
  return {
    rect,
    bpm: [P(8, 11), P(w - 8, 11)], key: [P(8, 24), P(w - 8, 24)], phase: { c: P(centre, 11), w: 70 * u },
    strip,
    mid: {
      x: rect.x + centre * u, master: P(centre, 40), masterR: 11 * u,
      meterX: [rect.x + (centre - 12) * u, rect.x + (centre + 12) * u], meter: { y: top - 168 * u, h: 96 * u, w: 9 * u },
      mix: { x: rect.x + centre * u, y: top - 192 * u, w: 66 * u }, level: { x: rect.x + centre * u, y: top - 216 * u, w: 66 * u },
      cross: { x: rect.x + centre * u, y: top - 266 * u, travel: 54 * u },
    },
  };
}

function fxGeometry(rect: Rect, u: number): LiveFxGeometry {
  const top = rect.y + rect.h;
  const P = (dx: number, dy: number): Point => ({ x: rect.x + dx * u, y: top - dy * u });
  const R = (dx: number, dy: number, w: number, h: number): Rect => ({ x: rect.x + dx * u, y: top - (dy + h) * u, w: w * u, h: h * u });
  const stepY = [100, 140, 180, 220];
  return {
    rect, title: P(FX_W / 2, 11),
    name: R(6, 22, FX_W - 12, 18), on: R(6, 46, FX_W - 12, 18),
    // Four faders (the first works now; the others come with their effects), then DIV.
    faders: [14, 31, 48, 65].map((dx) => ({ x: rect.x + dx * u, y: top - 160 * u, travel: 140 * u })), capW: 13 * u, labelY: top - 246 * u,
    div: { x: rect.x + 82 * u, labelX: rect.x + 88 * u, steps: stepY.map((dy) => P(82, dy)), touch: stepY.map((dy) => R(74, dy - 20, 38, 40)), labelY: top - 246 * u },
  };
}

/** Touch areas for the controls of one deck and the mixer, derived from the geometry (the page registers them as hits). */
export function liveTouch(g: LiveGeometry): { eq: Rect[][]; channel: Rect[]; cue: Rect[]; cross: Rect; master: Rect; mix: Rect; level: Rect } {
  const u = g.u, M = g.mixer;
  return {
    eq: M.strip.map((s) => s.knobY.map((y) => centred(s.x, y, 36 * u, 28 * u))),
    channel: M.strip.map((s) => centred(s.fader.x, s.fader.y, 36 * u, s.fader.travel + 16 * u)),
    cue: M.strip.map((s) => centred(s.cue.x, s.cue.y, s.cueW + 6 * u, s.cueH + 4 * u)),
    cross: centred(M.mid.cross.x, M.mid.cross.y, M.mid.cross.travel + 34 * u, 30 * u),
    master: centred(M.mid.master.x, M.mid.master.y, 3 * M.mid.masterR, 3 * M.mid.masterR),
    mix: centred(M.mid.mix.x, M.mid.mix.y, M.mid.mix.w + 18 * u, 18 * u),
    level: centred(M.mid.level.x, M.mid.level.y, M.mid.level.w + 18 * u, 18 * u),
  };
}
