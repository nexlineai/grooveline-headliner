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

export const TOP_BAR = 44;
const GEAR_H = 300;
// The mixer lost the FX buttons (they are with the effects now), so its strips moved outwards and it is 30 units narrower: the decks get those 30 units (15 each),
// so the unit `u` (and with it every knob) is what it was and the decks are wider.
const DECK_MIN = 311, MIXER_W = 196, GAP = 5.333, STRIP_CX = 28;
/** The effects strip above the gear row (a narrow window): its height and the gap under it (units). */
const FX_STRIP_H = 30, FX_STRIP_GAP = 4;
/** The effects controls sit in the TOP BAR, right after the stream bar's text and before the page's buttons (SETTINGS ...), when there is room. The page
 * measures the room (`BarRoom`: where the bar's text ends and where the buttons begin, so a longer label like EXIT FULLSCREEN counts, and the bar sheds words
 * until it fits: see `fitBar` in main.ts); without a measure these are what the page measured on 20 Nov at 1152 x 720 (a 1440 x 900 screen with the browser at
 * 100 %, which is 1.25 here) with EVERYTHING shown: the text ends at 445 px, the buttons (FULLSCREEN as EXIT FULLSCREEN) start 413 px from the right edge.
 * The controls need BAR_FX_PX; with less room than that the strip goes under the bar. */
export interface BarRoom { left: number; right: number }
const BAR_LEFT_PX = 455, BAR_RIGHT_PX = 423, BAR_FX_PX = 368, BAR_GAP_PX = 10;
const barRoom = (W: number, room?: BarRoom): BarRoom => room ? { left: room.left + BAR_GAP_PX, right: room.right - BAR_GAP_PX } : { left: BAR_LEFT_PX, right: W - BAR_RIGHT_PX };
/** What the controls need between the bar's text and its buttons, gaps included (the page sheds what the bar can spare until this is free). */
export const BAR_ROOM_NEEDED_PX = BAR_FX_PX + 2 * BAR_GAP_PX;
export const fxFitsTheBar = (W: number, room?: BarRoom): boolean => { const r = barRoom(W, room); return r.right - r.left >= BAR_FX_PX; };
/** The knobs of the mixer strips and of the effect unit are all this size (units). */
export const KNOB_R = 11;
/** The right of a deck's header (time, lamps, key, tempo) takes this many units; the title stops before it. */
export const HEADER_RIGHT = 134;

export interface LiveDeckGeometry {
  rect: Rect;
  /** Where the title starts (left aligned, baseline), and how wide it may be. */
  title: Point; titleMax: number;
  /** The right of the header, left to right: the time left (right aligned), the four lamps that count the bar, the key (right aligned, a smaller
   * type than the tempo) and the tempo (right aligned, at the corner). `titleMax` is where the title must stop: left of the time. */
  time: Point; lamps: Point[]; key: Point; bpm: Point;
  /** The zoomable waveform (it scrolls with the record), the strip of the WHOLE record under it (a touch there drops the needle),
   * and the two zoom buttons over the corner of the big one. */
  zoom: Rect; wave: Rect; zoomIn: Rect; zoomOut: Rect;
  platter: { c: Point; outer: number };
  /** The column between the platter and the pitch fader: tempo, key, pitch; and a reserved panel for loops (L2). */
  info: Rect; pitchText: Point; loop: Rect;
  /** What the eight pads are (CUES | LOOPS): two small tabs right above them. */
  modeTabs: Rect[];
  /** The loop controls, in the column beside the platter, on a grid of four columns: IN, OUT and LOOP (on/off, two columns wide) on the first
   * row, half and double on the second, an automatic loop of 4, 8, 16 or 32 beats on the third. */
  loopUi: { io: Rect[]; toggle: Rect; scale: Rect[]; auto: Rect[] };
  pitch: { x: number; y: number; travel: number };
  buttons: { cue: Point; play: Point; sync: Point; w: number; h: number };
  /** Eight pads under the transport (hot cues and loops: L2). */
  pads: Rect[];
}

export interface LiveStrip {
  x: number;
  /** GAIN, HI, MID, LOW from the top, then FILTER, which sits UNDER the fader (the fifth). */
  knobY: number[]; knobR: number;
  /** Where the FILTER's name goes (between the fader and the knob). */
  filterLabelY: number;
  cue: Point; cueW: number; cueH: number;
  fader: { x: number; y: number; travel: number };
}

export interface LiveMixerGeometry {
  rect: Rect;
  /** Where deck B's beat falls against deck A's. */
  phase: { c: Point; w: number };
  strip: LiveStrip[];
  /** The middle column. */
  mid: { x: number; master: Point; masterR: number; meterX: number[]; meter: { y: number; h: number; w: number };
         mix: { x: number; y: number; w: number }; level: { x: number; y: number; w: number };
         cross: { x: number; y: number; travel: number } };
}

/** The effect controller: one unit, narrow: the effect's name (arrows either side), ON, four vertical faders for what the effect
 * does, and DIV, a vertical stepped selector for the note value. */
/** The effects strip, a thin panel across the top of the gear row: the effect's name between two arrows, its four knobs (a little smaller than the
 * mixer's, each with its name and, for a stepped one, its value to the right) and a short horizontal LEVEL fader. Which channels it works on is
 * set by the FX buttons at the two ends of it (`send`). */
export interface LiveFxGeometry {
  rect: Rect;
  /** The FX buttons that send a channel through the effect: channel A's at the LEFT end of the effects, channel B's at the RIGHT end. */
  send: Rect[];
  /** What the text sizes are multiplied by (the strip: the booth's `u`; in the bar: a fixed number, since the bar is pixels, not units). */
  text: number;
  name: Rect;
  /** In the strip a knob's name and step sit to its right; in the bar the name is UNDER the knob (left aligned with it) and the step to its right. */
  knobs: { c: Point; r: number; touch: Rect; name: Point; value: Point }[];
  level: { x: number; y: number; travel: number; capW: number; capH: number; label: Point; labelAlign: "left" | "center"; touch: Rect };
}

export interface LiveGeometry {
  W: number; H: number; u: number;
  /** The effects controls are in the top bar (else a strip above the gear row). */
  fxInBar: boolean;
  topBar: Rect; gear: Rect;
  deck: LiveDeckGeometry[]; mixer: LiveMixerGeometry; fx: LiveFxGeometry;
  /** Under the gear row. */
  lower: Rect; library: Rect; streamPanel: Rect;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export function liveGeometry(W: number, H: number, room?: BarRoom): LiveGeometry {
  const margin = 10;
  const fixedW = MIXER_W + 2 * GAP + 2 * DECK_MIN;
  const uW = (W - 2 * margin) / fixedW;
  const fxInBar = fxFitsTheBar(W, room);
  // In the bar the effects cost the gear row no height; as a strip they cost its height and a gap.
  const stripUnits = fxInBar ? 0 : FX_STRIP_H + FX_STRIP_GAP;
  const uH = (H * (fxInBar ? 0.68 : 0.71) - TOP_BAR - 8) / (GEAR_H + stripUnits);
  const u = clamp(Math.min(uW, uH), 0.5, 3);
  const gearH = GEAR_H * u;
  const stripTop = H - TOP_BAR - 4;
  const stripY = stripTop - FX_STRIP_H * u;
  const gearTop = fxInBar ? stripTop : stripY - FX_STRIP_GAP * u;
  const gearY = gearTop - gearH;
  // The decks share what is left of the width.
  const deckW = Math.max(DECK_MIN * u, (W - 2 * margin - (MIXER_W + 2 * GAP) * u) / 2);
  const total = 2 * deckW + (MIXER_W + 2 * GAP) * u;
  let x = (W - total) / 2;
  const rectA = { x, y: gearY, w: deckW, h: gearH };
  x += deckW + GAP * u;
  const rectM = { x, y: gearY, w: MIXER_W * u, h: gearH };
  x += MIXER_W * u + GAP * u;
  const rectB = { x, y: gearY, w: deckW, h: gearH };

  const deck = [rectA, rectB].map((rect) => deckGeometry(rect, u));
  const mixer = mixerGeometry(rectM, u);
  const fx = fxInBar ? fxBarGeometry(H, barRoom(W, room)) : fxGeometry({ x: (W - total) / 2, y: stripY, w: total, h: FX_STRIP_H * u }, u);

  const lowerTop = gearY - 8;
  const lower: Rect = { x: margin, y: 6, w: W - 2 * margin, h: Math.max(0, lowerTop - 6) };
  const panelW = clamp(W * 0.24, 230, 420);
  const library: Rect = { x: lower.x, y: lower.y, w: lower.w - panelW - 10, h: lower.h };
  const streamPanel: Rect = { x: lower.x + lower.w - panelW, y: lower.y, w: panelW, h: lower.h };
  return { W, H, u, fxInBar, topBar: { x: 0, y: H - TOP_BAR, w: W, h: TOP_BAR }, gear: { x: (W - total) / 2, y: gearY, w: total, h: gearH }, deck, mixer, fx, lower, library, streamPanel };
}

function deckGeometry(rect: Rect, u: number): LiveDeckGeometry {
  const top = rect.y + rect.h, w = rect.w / u;
  const P = (dx: number, dy: number): Point => ({ x: rect.x + dx * u, y: top - dy * u });
  const outer = 64;
  const c = P(8 + outer, 92 + outer);
  const infoX = 8 + 2 * outer + 22, pitchX = w - 22;
  const infoW = pitchX - 22 - infoX;
  const padW = (w - 16 - 7 * 3) / 8;
  return {
    rect,
    title: P(8, 11), titleMax: (w - 8 - HEADER_RIGHT - 6) * u,
    time: P(w - 104, 11), lamps: [0, 1, 2, 3].map((i) => P(w - 96 + i * 8, 11)), key: P(w - 45, 11), bpm: P(w - 8, 11),
    zoom: { x: rect.x + 8 * u, y: top - 76 * u, w: rect.w - 16 * u, h: 56 * u },
    wave: { x: rect.x + 8 * u, y: top - 90 * u, w: rect.w - 16 * u, h: 11 * u },
    zoomOut: { x: rect.x + (w - 8 - 31) * u, y: top - 33 * u, w: 14 * u, h: 12 * u },
    zoomIn: { x: rect.x + (w - 8 - 16) * u, y: top - 33 * u, w: 14 * u, h: 12 * u },
    platter: { c, outer: outer * u },
    info: { x: rect.x + infoX * u, y: top - 236 * u, w: infoW * u, h: 140 * u },
    // The tempo and the key are in the mixer; the pitch reads out under its fader.
    pitchText: P(pitchX, 255),
    modeTabs: [0, 1].map((i) => ({ x: rect.x + (8 + i * 47) * u, y: top - (249 + 12) * u, w: 44 * u, h: 12 * u })),
    loop: { x: rect.x + infoX * u, y: top - 232 * u, w: infoW * u, h: 52 * u },
    loopUi: loopControls(rect, u, infoX, infoW),
    pitch: { x: rect.x + pitchX * u, y: top - 164 * u, travel: 128 * u },
    buttons: { cue: P(8 + 28, 236), play: P(8 + 28 + 60, 236), sync: P(8 + 28 + 120, 236), w: 56 * u, h: 22 * u },
    pads: Array.from({ length: 8 }, (_, i) => ({ x: rect.x + (8 + i * (padW + 3)) * u, y: top - 288 * u, w: padW * u, h: 24 * u })),
  };
}

/** Three short rows on a grid of four columns in the column between the platter and the pitch fader (16 units high, 6 apart). */
function loopControls(rect: Rect, u: number, infoX: number, infoW: number): LiveDeckGeometry["loopUi"] {
  const top = rect.y + rect.h;
  // The buttons stay small however wide the deck is: the grid is centred in the column.
  const col = Math.min(21.5, (infoW - 3 * 3) / 4), x0 = infoX + (infoW - (4 * col + 9)) / 2;
  const R = (row: number, from: number, span: number): Rect => ({
    x: rect.x + (x0 + from * (col + 3)) * u, y: top - (118 + row * 22 + 16) * u, w: (span * col + (span - 1) * 3) * u, h: 16 * u,
  });
  return {
    io: [R(0, 0, 1), R(0, 1, 1)],
    toggle: R(0, 2, 2),
    scale: [R(1, 0, 2), R(1, 2, 2)],
    auto: [0, 1, 2, 3].map((i) => R(2, i, 1)),
  };
}

function mixerGeometry(rect: Rect, u: number): LiveMixerGeometry {
  const top = rect.y + rect.h, w = MIXER_W;
  const P = (dx: number, dy: number): Point => ({ x: rect.x + dx * u, y: top - dy * u });
  const centre = w / 2;
  const strip = [STRIP_CX, w - STRIP_CX].map((cx): LiveStrip => ({
    x: rect.x + cx * u,
    knobY: [24, 58, 92, 126, 282].map((dy) => top - dy * u), knobR: KNOB_R * u, filterLabelY: top - 260 * u,
    cue: P(cx, 162), cueW: 44 * u, cueH: 14 * u,
    fader: { x: rect.x + cx * u, y: top - 212 * u, travel: 64 * u },
  }));
  return {
    rect,
    phase: { c: P(centre, 11), w: 70 * u },
    strip,
    mid: {
      x: rect.x + centre * u, master: P(centre, 42), masterR: 12.5 * u,
      meterX: [rect.x + (centre - 12) * u, rect.x + (centre + 12) * u], meter: { y: top - 168 * u, h: 96 * u, w: 9 * u },
      mix: { x: rect.x + centre * u, y: top - 192 * u, w: 66 * u }, level: { x: rect.x + centre * u, y: top - 216 * u, w: 66 * u },
      cross: { x: rect.x + centre * u, y: top - 266 * u, travel: 54 * u },
    },
  };
}

function fxGeometry(rect: Rect, u: number): LiveFxGeometry {
  const top = rect.y + rect.h, w = rect.w / u, cy = top - (FX_STRIP_H / 2) * u;
  // The cluster is centred: FX of channel A, the name (100), four knobs (64 each, with their words to the right), LEVEL (150), FX of channel B.
  const SEND_W = 30, NAME_W = 100, KNOB_PITCH = 64, LEVEL_W = 150, G = 14;
  const total = SEND_W + G + NAME_W + G + 4 * KNOB_PITCH + G + LEVEL_W + G + SEND_W;
  const x0 = Math.max(30, (w - total) / 2);
  const at = (dx: number): number => rect.x + dx * u;
  const nameX = x0 + SEND_W + G;
  const knobX = (i: number): number => nameX + NAME_W + G + i * KNOB_PITCH + 9;
  const lx = nameX + NAME_W + G + 4 * KNOB_PITCH + G;
  const travel = 44; // a short fader: a few units of the hand move it from end to end
  const send = (dx: number): Rect => ({ x: at(dx), y: cy - 11 * u, w: SEND_W * u, h: 22 * u });
  return {
    rect, text: u,
    send: [send(x0), send(lx + LEVEL_W + G)],
    name: { x: at(nameX), y: cy - 11 * u, w: NAME_W * u, h: 22 * u },
    knobs: [0, 1, 2, 3].map((i) => ({
      c: { x: at(knobX(i)), y: cy }, r: 7.5 * u,
      touch: { x: at(knobX(i) - 10), y: cy - 13 * u, w: 62 * u, h: 26 * u },
      name: { x: at(knobX(i) + 12), y: cy + 5 * u }, value: { x: at(knobX(i) + 12), y: cy - 5 * u },
    })),
    level: { x: at(lx + 44 + travel / 2), y: cy, travel: travel * u, capW: 10 * u, capH: 16 * u, label: { x: at(lx), y: cy }, labelAlign: "left",
             touch: { x: at(lx + 40), y: cy - 13 * u, w: (travel + 14) * u, h: 26 * u } },
  };
}

/** The effects controls in the top bar, left to right from `x0` (just after the stream bar's text): the FX button of channel A, the name, four knobs, LEVEL, the FX button
 * of channel B. Everything is in pixels (the bar is 44 px high whatever the scale) and inside its TOP 32 px: the page's orange message sits under them. A knob's name is
 * under the knob, its step to the right, so four knobs take 42 px each; LEVEL is a short fader with its name under it. Total `BAR_FX_PX`. */
function fxBarGeometry(H: number, room: BarRoom): LiveFxGeometry {
  // Spare room is shared: a little after the time, the rest before the buttons.
  const x0 = room.left + Math.min(20, (room.right - room.left - BAR_FX_PX) / 2);
  const kcy = H - 14.5, lcy = H - 29, bcy = H - 16.5;
  const SEND_W = 26, SEND_H = 24, NAME_W = 76, PITCH = 42, G = 7, R = 10;
  const nameX = x0 + SEND_W + G;
  const cell = (i: number): number => nameX + NAME_W + G + i * PITCH;
  const lx = cell(4) + 2, travel = 40, capW = 9, fw = travel + capW;
  const sendB = lx + fw + G;
  const rect: Rect = { x: x0, y: H - 32, w: sendB + SEND_W - x0, h: 32 };
  const send = (x: number): Rect => ({ x, y: bcy - SEND_H / 2, w: SEND_W, h: SEND_H });
  return {
    rect, text: 1.3, send: [send(x0), send(sendB)],
    name: { x: nameX, y: bcy - SEND_H / 2, w: NAME_W, h: SEND_H },
    knobs: [0, 1, 2, 3].map((i) => ({
      c: { x: cell(i) + 14, y: kcy }, r: R,
      touch: { x: cell(i) + 1, y: H - 32, w: PITCH - 2, h: 32 },
      name: { x: cell(i) + 4, y: lcy }, value: { x: cell(i) + 27, y: kcy },
    })),
    level: { x: lx + fw / 2, y: kcy, travel, capW, capH: 16, label: { x: lx + fw / 2, y: lcy }, labelAlign: "center", touch: { x: lx - 2, y: H - 32, w: fw + 4, h: 32 } },
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
