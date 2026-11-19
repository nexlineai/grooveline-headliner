// How the LIVE booth looks (web only): graphite, thin lines, LED rings and meters, cyan for deck A and amber for deck B, no pink.
// Geometry comes from live-geometry.ts; this file only draws. The pointer and value code stays in booth.ts, so the keys, MIDI
// and the mouse reach these controls the same way they reach the game's.

import type { Deck } from "../audio/engine.ts";
import { FX_KNOBS, FX_TYPES, stepIndex } from "../audio/fx.ts";
import { levelFor, peakBetween } from "../audio/peaks.ts";
import { centred, circle, label, picture, roundRect, rgba, tonearm, wavePicture } from "./gear.ts";
import type { Point, RGB, Rect } from "./gear.ts";
import type { LiveGeometry } from "./live-geometry.ts";

type Ctx = CanvasRenderingContext2D;

export const LIVE = {
  bg: "#05070a", bgLow: "#090c11",
  panelTop: "#161b23", panelBottom: "#0c1015",
  edge: "rgba(255,255,255,0.075)", edgeHi: "rgba(255,255,255,0.17)",
  ink: "rgba(236,240,245,0.96)", dim: "rgba(236,240,245,0.46)", dimmer: "rgba(236,240,245,0.24)", off: "rgba(255,255,255,0.075)",
  /** Deck A, deck B. */
  deck: [[38, 198, 240], [255, 172, 40]] as RGB[],
  /** The knobs' lit rings, the same on both channels: the GAIN red, the highs yellow, the mids orange, the bass brown, and blue for the FILTER only
   * (which also sits in a thin blue outline, so it is not taken for an EQ knob). */
  filter: [70, 128, 255] as RGB,
  /** The effect unit's knobs and its fader: white, like the master (the mixer's colours belong to the mixer's knobs). */
  fxRing: [236, 240, 245] as RGB,
  eqHigh: [255, 212, 60] as RGB, eqMid: [255, 142, 30] as RGB, eqLow: [168, 106, 58] as RGB,
  /** The eight pads: hot cues and saved loops. No pink. */
  pad: [[38, 198, 240], [74, 226, 142], [255, 172, 40], [255, 112, 60], [90, 140, 255], [172, 112, 255], [200, 232, 70], [236, 240, 245]] as RGB[],
  cue: [255, 150, 40] as RGB, play: [74, 226, 142] as RGB, sync: [150, 205, 255] as RGB, warn: [255, 176, 40] as RGB, red: [255, 78, 64] as RGB,
};

const TURN = 2 * Math.PI * (100 / 3) / 60;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// MARK: - Parts

function panel(ctx: Ctx, r: Rect, u: number): void {
  const g = ctx.createLinearGradient(0, r.y + r.h, 0, r.y);
  g.addColorStop(0, LIVE.panelTop);
  g.addColorStop(1, LIVE.panelBottom);
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 7 * u);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = LIVE.edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  // A thin light along the top edge.
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fillRect(r.x + 7 * u, r.y + r.h - 1, r.w - 14 * u, 1);
}

/** A rotary knob: a ring of LEDs round a dark cap with one white line. `bipolar`: the ring lights from the middle. */
function knob(ctx: Ctx, x: number, y: number, r: number, v: number, tint: RGB | null, bipolar: boolean, enabled = true, pointer: RGB | null = null): void {
  const value = clamp01(v);
  const R = r + 3.2 * Math.max(0.8, r / 9);
  const steps = 11;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1), a = (t - 0.5) * 1.5 * Math.PI;
    const lit = enabled && tint && (bipolar ? (t >= Math.min(0.5, value) - 1e-6 && t <= Math.max(0.5, value) + 1e-6 && Math.abs(value - 0.5) > 0.02 || (i === 5 && Math.abs(value - 0.5) <= 0.02)) : t <= value + 1e-6);
    ctx.fillStyle = lit && tint ? rgba(tint, 0.95) : LIVE.off;
    const dot = Math.max(0.9, r * 0.1);
    ctx.beginPath();
    ctx.arc(x + Math.sin(a) * R, y + Math.cos(a) * R, dot, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(x - r * 0.3, y + r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "#3b414c");
  g.addColorStop(1, "#14171c");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = enabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const a = (value - 0.5) * 1.5 * Math.PI;
  ctx.strokeStyle = enabled ? (pointer ? rgba(pointer, 1) : "rgba(255,255,255,0.95)") : "rgba(255,255,255,0.22)";
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + Math.sin(a) * r * 0.28, y + Math.cos(a) * r * 0.28);
  ctx.lineTo(x + Math.sin(a) * r * 0.86, y + Math.cos(a) * r * 0.86);
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** A fader: a thin slot with a scale beside it and a dark ridged cap. Vertical runs bottom to top, horizontal left to right. */
function fader(ctx: Ctx, x: number, y: number, travel: number, v: number, vertical: boolean, capW: number, capH: number, tint: RGB | null, u: number, o: { enabled?: boolean; centreMark?: boolean; oneSide?: boolean; noScale?: boolean } = {}): void {
  const enabled = o.enabled ?? true, value = clamp01(v);
  const len = travel + (vertical ? capH : capW);
  const slot: Rect = vertical ? { x: x - 1.6 * u, y: y - len / 2, w: 3.2 * u, h: len } : { x: x - len / 2, y: y - 1.6 * u, w: len, h: 3.2 * u };
  roundRect(ctx, slot, 1.6 * u, "#020304", "rgba(255,255,255,0.07)");
  // The scale: eleven marks, longer at the ends and the middle.
  for (let i = 0; i <= 10 && !o.noScale; i++) {
    const t = i / 10, long = i === 0 || i === 5 || i === 10, along = (t - 0.5) * travel, off = (Math.max(capW, capH) / 2 + 3 * u);
    ctx.fillStyle = long && o.centreMark && i === 5 && tint ? rgba(tint, 0.9) : LIVE.dimmer;
    const L = (long ? 5 : 3) * u;
    if (vertical) { ctx.fillRect(x - off - L, y + along - 0.5, L, 1); ctx.fillRect(x + off, y + along - 0.5, L, 1); }
    else { ctx.fillRect(x + along - 0.5, y - off - L, 1, L); if (!o.oneSide) ctx.fillRect(x + along - 0.5, y + off, 1, L); }
  }
  const p = (value - 0.5) * travel;
  const cx = vertical ? x : x + p, cy = vertical ? y + p : y;
  const cap = centred(cx, cy, capW, capH);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 4 * u;
  ctx.shadowOffsetY = -1.5 * u;
  const g = ctx.createLinearGradient(cap.x, cap.y + cap.h, cap.x, cap.y);
  g.addColorStop(0, "#1c2027");
  g.addColorStop(0.5, "#323842");
  g.addColorStop(1, "#1a1e25");
  ctx.beginPath();
  ctx.roundRect(cap.x, cap.y, cap.w, cap.h, 2 * u);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, cap, 2 * u, null, enabled ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.09)");
  // Ridges across the cap and the one bright line.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (const k of [-0.28, 0.28]) {
    if (vertical) ctx.fillRect(cap.x + 2 * u, cy + k * capH - 0.5, capW - 4 * u, 1);
    else ctx.fillRect(cx + k * capW - 0.5, cap.y + 2 * u, 1, capH - 4 * u);
  }
  ctx.fillStyle = enabled ? (tint ? rgba(tint, 0.95) : "rgba(255,255,255,0.9)") : "rgba(255,255,255,0.18)";
  if (vertical) ctx.fillRect(cap.x + 2 * u, cy - 0.7, capW - 4 * u, 1.4);
  else ctx.fillRect(cx - 0.7, cap.y + 2 * u, 1.4, capH - 4 * u);
}

/** A button with an LED: dark when off, tinted and lit when on. */
function button(ctx: Ctx, r: Rect, title: string, lit: boolean, tint: RGB, u: number, o: { enabled?: boolean; size?: number } = {}): void {
  const enabled = o.enabled ?? true;
  roundRect(ctx, r, 3.2 * u, lit ? rgba(tint, 0.16) : "#0a0d11", lit ? rgba(tint, 0.95) : enabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)", 1);
  if (lit) {
    ctx.save();
    ctx.shadowColor = rgba(tint, 0.55);
    ctx.shadowBlur = 8 * u;
    roundRect(ctx, r, 3.2 * u, null, rgba(tint, 0.5));
    ctx.restore();
  }
  label(ctx, title, r.x + r.w / 2, r.y + r.h / 2 + 0.4, { size: (o.size ?? Math.min(r.h * 0.5, 9.5 * u)) * BUTTON_TEXT, color: lit ? rgba(tint, 1) : enabled ? LIVE.ink : LIVE.dimmer, spacing: 0.6 * u });
}

/** A ladder of LEDs, bottom to top: green, amber, red at the very top. */
function meter(ctx: Ctx, x: number, y: number, w: number, h: number, level: number, u: number, segments = 16): void {
  const seg = h / segments, on = clamp01(level) * segments;
  for (let i = 0; i < segments; i++) {
    const c = i >= segments - 1 ? LIVE.red : i >= segments - 4 ? LIVE.warn : LIVE.play;
    roundRect(ctx, { x: x - w / 2, y: y + i * seg + 0.6, w, h: seg - 1.2 }, 0.8 * u, i < on ? rgba(c, 0.95) : "rgba(255,255,255,0.055)");
  }
}

/** The small captions are drawn this much bigger than their design size: on a laptop (a gear row about 1.5 px to the unit) 5.5 units were 8 px. */
const SMALL_TEXT = 1.16;
const BUTTON_TEXT = 1.1;
const small = (ctx: Ctx, text: string, x: number, y: number, size: number, o: { color?: string; align?: CanvasTextAlign; mono?: boolean } = {}): void => {
  label(ctx, text, x, y, { size: size * SMALL_TEXT, color: o.color ?? LIVE.dim, align: o.align, mono: o.mono, spacing: 0.7 });
};

/** The platter: aluminium rim with strobe dots, the record with its grooves, the label (or a cover), a marker line. */
export function livePlatterPicture(r: number, tint: RGB, scale: number, art: CanvasImageSource | null): HTMLCanvasElement {
  const outer = r * 1.07;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(outer * 2 * scale);
  canvas.height = Math.ceil(outer * 2 * scale);
  const c = canvas.getContext("2d")!;
  c.scale(scale, scale);
  const m = outer;
  const ring = (rad: number, fill: string | CanvasGradient | null, stroke: string | null = null, lw = 1) => {
    c.beginPath(); c.arc(m, m, rad, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  };
  // The platter rim: a brushed light-grey ring.
  const rim = c.createLinearGradient(0, 0, outer * 2, outer * 2);
  rim.addColorStop(0, "#3b414b");
  rim.addColorStop(0.5, "#15181d");
  rim.addColorStop(1, "#343a44");
  ring(outer, rim, "rgba(255,255,255,0.14)");
  ring(outer - 2.2, null, "rgba(0,0,0,0.6)");
  // Strobe marks, in four groups like a real turntable's.
  const dots = 96;
  for (let i = 0; i < dots; i++) {
    const a = i / dots * Math.PI * 2;
    const long = i % 24 === 0;
    c.strokeStyle = long ? rgba(tint, 0.9) : "rgba(235,240,246,0.5)";
    c.lineWidth = long ? 1.6 : 1;
    c.beginPath();
    c.moveTo(m + Math.cos(a) * (r * 1.015), m + Math.sin(a) * (r * 1.015));
    c.lineTo(m + Math.cos(a) * (r * (long ? 1.06 : 1.045)), m + Math.sin(a) * (r * (long ? 1.06 : 1.045)));
    c.stroke();
  }
  // The record.
  const vinyl = c.createRadialGradient(m, m, r * 0.3, m, m, r);
  vinyl.addColorStop(0, "#0b0c0e");
  vinyl.addColorStop(1, "#050506");
  ring(r, vinyl);
  let groove = r * 0.97, i = 0;
  while (groove > r * 0.42) {
    const gap = i % 9 === 0;
    ring(groove, null, `rgba(255,255,255,${gap ? 0.1 : 0.032})`, gap ? 1 : 0.5);
    groove -= r * 0.018;
    i += 1;
  }
  // The label.
  const lr = r * 0.34;
  ring(lr, rgba(tint, 0.95));
  if (art) {
    const inner = lr * 0.9;
    c.save(); c.beginPath(); c.arc(m, m, inner, 0, Math.PI * 2); c.clip(); c.drawImage(art, m - inner, m - inner, inner * 2, inner * 2); c.restore();
    ring(inner, null, "rgba(0,0,0,0.6)", 1);
  } else {
    ring(lr * 0.78, null, "rgba(0,0,0,0.28)", lr * 0.05);
    ring(lr * 0.5, "rgba(0,0,0,0.12)");
  }
  // The marker line from the spindle to the label's edge (it shows the record turning), and the spindle.
  c.strokeStyle = "rgba(0,0,0,0.6)";
  c.lineWidth = Math.max(2, r * 0.032) + 2;
  c.lineCap = "round";
  c.beginPath(); c.moveTo(m, m - lr * 0.3); c.lineTo(m, m - lr * 0.92); c.stroke();
  c.strokeStyle = "#fff";
  c.lineWidth = Math.max(2, r * 0.032);
  c.beginPath(); c.moveTo(m, m - lr * 0.3); c.lineTo(m, m - lr * 0.92); c.stroke();
  ring(r * 0.03, "#c9d0da");
  return canvas;
}

// MARK: - The view the booth hands over

export interface LiveView {
  decks: Deck[];
  pitchFader: number[]; channel: number[]; cross: number; eq: number[][]; filter: number[]; trim: number[]; phones: boolean[]; sync: boolean[];
  cueDown: boolean[]; previewing: boolean[]; meter: number[]; dropAt: (number | null)[];
  cueMix: number; phonesLevel: number; master: number;
  fx: { type: number; div: number; amount: number; on: boolean; params: number[] };
  armAngle(d: number): number;
  pivot: Point[]; armLength: number;
  labelArt: ({ id: string; img: CanvasImageSource } | null)[];
  alerts: ({ text: string; until: number } | null)[];
  trimDb(d: number): number;
  now: number;
  dpr: number;
  /** Deck B's beat against deck A's, -0.5...0.5, or null when they are not both turning. */
  phase: number | null;
  syncAllowed: boolean;
  /** What the pads under each deck are, and how far each deck's big waveform is zoomed (level 0 = the whole record). */
  padMode: ("cues" | "loops")[];
  zoom: { level: number; seconds: number }[];
}

const clock = (seconds: number): string => {
  const whole = Math.trunc(Math.max(0, seconds));
  return `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** Draws the LIVE booth. Keeps the pictures that are slow to make (the platters, the waveforms) between frames. */
export class LiveRenderer {
  private platter: (HTMLCanvasElement | null)[] = [null, null];
  private platterKey = ["", ""];
  private wave: (HTMLCanvasElement | null)[] = [null, null];
  private waveKey = ["", ""];

  /** Forget the pictures (the window changed size). */
  reset(): void { this.platter = [null, null]; this.platterKey = ["", ""]; this.wave = [null, null]; this.waveKey = ["", ""]; }

  draw(ctx: Ctx, g: LiveGeometry, v: LiveView): void {
    this.chrome(ctx, g);
    for (const d of [0, 1]) this.deck(ctx, g, v, d);
    this.mixer(ctx, g, v);
    this.fxModule(ctx, g, v);
  }

  // MARK: Background

  private chrome(ctx: Ctx, g: LiveGeometry): void {
    const bg = ctx.createLinearGradient(0, g.H, 0, 0);
    bg.addColorStop(0, LIVE.bg);
    bg.addColorStop(1, LIVE.bgLow);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, g.W, g.H);
    // The top bar (the page's buttons sit on it).
    const t = g.topBar;
    const tg = ctx.createLinearGradient(0, t.y + t.h, 0, t.y);
    tg.addColorStop(0, "#131820");
    tg.addColorStop(1, "#0b0e13");
    ctx.fillStyle = tg;
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = LIVE.edge;
    ctx.fillRect(t.x, t.y, t.w, 1);
  }

  // MARK: A deck

  private platterFor(d: number, g: LiveGeometry, v: LiveView): HTMLCanvasElement {
    const art = v.labelArt[d] && v.labelArt[d]!.id === v.decks[d].info?.id ? v.labelArt[d] : null;
    const key = `${g.deck[d].platter.outer.toFixed(1)}:${art ? art.id : ""}:${v.dpr}`;
    if (!this.platter[d] || this.platterKey[d] !== key) {
      this.platterKey[d] = key;
      this.platter[d] = livePlatterPicture(g.deck[d].platter.outer / 1.07, LIVE.deck[d], v.dpr, art ? art.img : null);
    }
    return this.platter[d]!;
  }

  private deck(ctx: Ctx, g: LiveGeometry, v: LiveView, d: number): void {
    const G = g.deck[d], u = g.u, deck = v.decks[d], tint = LIVE.deck[d];
    panel(ctx, G.rect, u);
    const seconds = deck.seconds, moving = Math.abs(deck.rate) > 0.3;

    // Header: the record, time left, four lamps that count the bar.
    const info = deck.info;
    // The deck's badge, then the record.
    roundRect(ctx, centred(G.title.x + 7 * u, G.title.y, 14 * u, 13 * u), 2.5 * u, rgba(tint, 0.95));
    label(ctx, d === 0 ? "A" : "B", G.title.x + 7 * u, G.title.y + 0.3, { size: 9 * u, color: "#04070a", spacing: 0 });
    label(ctx, info ? `${info.artist.toUpperCase()}  ·  ${info.title.toUpperCase()}` : "NO RECORD", G.title.x + 20 * u, G.title.y, { size: 9 * u, color: LIVE.ink, align: "left", maxWidth: G.titleMax - 20 * u, spacing: 0.5 * u });
    const drop = v.dropAt[d];
    const timeText = drop !== null ? clock(drop * deck.duration) : deck.isLoaded ? "-" + clock(Math.max(0, deck.duration - seconds)) : "";
    label(ctx, timeText, G.time.x, G.time.y, { size: 9 * u, color: drop !== null ? LIVE.ink : LIVE.dim, mono: true, align: "right" });
    const beatNow = deck.grid.beatInBar(seconds), flash = 1 - deck.grid.phase(seconds);
    for (let i = 0; i < 4; i++) circle(ctx, G.lamps[i].x, G.lamps[i].y, 2.5 * u, rgba(tint, moving && i === beatNow ? 0.35 + 0.65 * flash : 0.16));

    this.zoomWave(ctx, g, v, d);
    this.overviewStrip(ctx, g, v, d);

    // The platter, the sheen on the grooves, the arm.
    const c = G.platter.c, p = this.platterFor(d, g, v);
    picture(ctx, p, c.x, c.y, G.platter.outer * 2, G.platter.outer * 2, -seconds * TURN);
    tonearm(ctx, v.pivot[d].x, v.pivot[d].y, v.armLength, u, v.armAngle(d), deck.lifted ? 1.05 : 1);

    // Pitch fader: up is slower; the pitch reads out under it (the tempo and the key are in the mixer).
    fader(ctx, G.pitch.x, G.pitch.y, G.pitch.travel, v.pitchFader[d], true, 24 * u, 12 * u, tint, u, { centreMark: true });
    small(ctx, "−", G.pitch.x, G.pitch.y + G.pitch.travel / 2 + 16 * u, 9 * u, { color: LIVE.dim });
    small(ctx, "+", G.pitch.x, G.pitch.y - G.pitch.travel / 2 - 16 * u, 9 * u, { color: LIVE.dim });
    const pct = deck.pitch * 100;
    label(ctx, `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`, G.pitchText.x, G.pitchText.y, { size: 9.5 * u, color: LIVE.ink, mono: true });

    // Transport.
    const B = G.buttons, cueLit = v.cueDown[d] || (!deck.motorOn && Math.abs(seconds - deck.cuePoint) < 0.02);
    button(ctx, centred(B.cue.x, B.cue.y, B.w, B.h), "CUE", cueLit, LIVE.cue, u);
    button(ctx, centred(B.play.x, B.play.y, B.w, B.h), "PLAY", deck.motorOn && !v.previewing[d], LIVE.play, u);
    button(ctx, centred(B.sync.x, B.sync.y, B.w, B.h), "SYNC", v.sync[d], LIVE.sync, u, { enabled: v.syncAllowed });
    this.loopColumn(ctx, g, v, d);
    this.pads(ctx, g, v, d);

    // A message for this deck (a record cannot be changed while it plays).
    const alert = v.alerts[d];
    if (alert && alert.until > v.now) {
      const k = Math.min(1, (alert.until - v.now) / 400);
      const r: Rect = { x: G.zoom.x, y: G.zoom.y + G.zoom.h * 0.18, w: G.zoom.w, h: G.zoom.h * 0.64 };
      ctx.save();
      ctx.globalAlpha = k;
      roundRect(ctx, r, 4 * u, "rgba(20,12,4,0.94)", rgba(LIVE.warn, 0.95), 1.5);
      label(ctx, alert.text, r.x + r.w / 2, r.y + r.h / 2, { size: 9.5 * u, color: rgba(LIVE.warn), spacing: 0.8 * u, maxWidth: r.w - 16 * u });
      ctx.restore();
    }
  }

  private overviewStrip(ctx: Ctx, g: LiveGeometry, v: LiveView, d: number): void {
    const r = g.deck[d].wave, deck = v.decks[d], tint = LIVE.deck[d];
    roundRect(ctx, { x: r.x - 1.5, y: r.y - 1.5, w: r.w + 3, h: r.h + 3 }, 3 * g.u, "#020304", "rgba(255,255,255,0.08)");
    const key = `${deck.info?.id ?? ""}:${deck.duration}:${r.w.toFixed(0)}x${r.h.toFixed(0)}:${deck.grid.bpm}:${deck.grid.firstBeat}:${v.dpr}`;
    if (this.waveKey[d] !== key) {
      this.waveKey[d] = key;
      const ticks: number[] = [];
      if (deck.duration > 0) for (let beat = 0; ; beat += 64) { const at = deck.grid.secondsAtBeat(beat) / deck.duration; if (at >= 1) break; ticks.push(at); }
      this.wave[d] = wavePicture(deck.overview, r.w, r.h, tint, ticks, v.dpr);
    }
    const img = this.wave[d];
    if (img) picture(ctx, img, r.x + r.w / 2, r.y + r.h / 2, r.w, r.h);
    // The centre line and the part already played, dimmed.
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(r.x, r.y + r.h / 2 - 0.5, r.w, 1);
    const at = r.x + r.w * deck.progress;
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(r.x, r.y, Math.max(0.5, at - r.x), r.h);
    if (deck.isLoaded) {
      const mx = r.x + r.w * (deck.duration > 0 ? deck.cuePoint / deck.duration : 0), flag = Math.min(8, r.h * 0.18);
      ctx.fillStyle = rgba(LIVE.cue);
      ctx.fillRect(mx - 0.75, r.y, 1.5, r.h);
      ctx.beginPath();
      ctx.moveTo(mx - flag * 0.7, r.y + r.h);
      ctx.lineTo(mx + flag * 0.7, r.y + r.h);
      ctx.lineTo(mx, r.y + r.h - flag);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(at - 0.75, r.y - 2, 1.5, r.h + 4);
    const drop = v.dropAt[d];
    if (drop !== null) { ctx.fillStyle = rgba(tint); ctx.fillRect(r.x + r.w * drop - 1.25, r.y - 3, 2.5, r.h + 6); }
    if (deck.isLoaded && deck.duration > 0) {
      const X = (sec: number) => r.x + r.w * Math.max(0, Math.min(1, sec / deck.duration));
      // The saved marks, a loop, and which part of the record the big waveform is showing.
      deck.hotCues.forEach((c, i) => { if (c !== null) { ctx.fillStyle = rgba(LIVE.pad[i]); ctx.fillRect(X(c) - 0.75, r.y, 1.5, r.h); } });
      if (deck.loopEnd > deck.loopStart) { ctx.fillStyle = deck.loopOn ? rgba(LIVE.play, 0.35) : "rgba(255,255,255,0.12)"; ctx.fillRect(X(deck.loopStart), r.y, Math.max(1, X(deck.loopEnd) - X(deck.loopStart)), r.h); }
      const z = v.zoom[d];
      if (z.level > 0 && z.seconds < deck.duration) {
        const centre = drop !== null ? drop * deck.duration : deck.seconds, x0 = X(centre - z.seconds / 2), x1 = X(centre + z.seconds / 2);
        roundRect(ctx, { x: x0, y: r.y - 1, w: Math.max(3, x1 - x0), h: r.h + 2 }, 2, null, "rgba(255,255,255,0.5)", 1);
      }
    }
  }

  // MARK: The big waveform

  /** The record scrolling under a fixed needle, as far in as the zoom says; the beat grid, the cue, the hot cues and the loop on it. */
  private zoomWave(ctx: Ctx, g: LiveGeometry, v: LiveView, d: number): void {
    const G = g.deck[d], r = G.zoom, deck = v.decks[d], u = g.u, tint = LIVE.deck[d];
    roundRect(ctx, { x: r.x - 1.5, y: r.y - 1.5, w: r.w + 3, h: r.h + 3 }, 3 * u, "#020304", "rgba(255,255,255,0.08)");
    const mid = r.y + r.h / 2;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(r.x, mid - 0.5, r.w, 1);
    const peaks = deck.peaks;
    if (!deck.isLoaded || !peaks) { small(ctx, "NO RECORD", r.x + r.w / 2, mid, 8 * u, { color: LIVE.dimmer }); return; }
    const win = v.zoom[d].seconds, whole = v.zoom[d].level === 0 || win >= deck.duration;
    const drop = v.dropAt[d];
    const centre = whole ? deck.duration / 2 : drop !== null ? drop * deck.duration : deck.seconds;
    const secPerPx = win / r.w, t0 = centre - win / 2, rate = deck.fileRate;
    const lv = levelFor(peaks, secPerPx * rate).level;
    const playX = whole ? r.x + r.w * (deck.seconds / deck.duration) : r.x + r.w / 2;
    const amp = r.h / 2 - 2;
    const cols = Math.floor(r.w);
    // One closed shape (the top edge, then the bottom edge back), filled dim where the record has played and bright where it is to come.
    const shape = new Path2D();
    shape.moveTo(r.x, mid);
    const heights: number[] = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const p = peakBetween(peaks, lv, (t0 + x * secPerPx) * rate, (t0 + (x + 1) * secPerPx) * rate);
      heights[x] = p > 0 ? Math.max(0.6, amp * Math.min(1, Math.pow(p, 0.8))) : 0;
      shape.lineTo(r.x + x, mid + heights[x]);
    }
    shape.lineTo(r.x + cols, mid);
    for (let x = cols - 1; x >= 0; x--) shape.lineTo(r.x + x, mid - heights[x]);
    shape.closePath();
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, Math.max(0, playX - r.x), r.h); ctx.clip();
    ctx.fillStyle = rgba(tint, 0.3);
    ctx.fill(shape);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(playX, r.y, r.x + r.w - playX, r.h); ctx.clip();
    ctx.fillStyle = rgba(tint, 0.9);
    ctx.fill(shape);
    ctx.restore();

    // The beat grid, where the beats are far enough apart to tell (bars brighter).
    const pxPerBeat = deck.grid.beatLength / secPerPx;
    if (pxPerBeat >= 6) {
      const b0 = Math.ceil(deck.grid.beat(t0)), b1 = Math.floor(deck.grid.beat(t0 + win));
      for (let b = b0; b <= b1 && b - b0 < 600; b++) {
        const x = r.x + (deck.grid.secondsAtBeat(b) - t0) / secPerPx, bar = b % 4 === 0;
        ctx.fillStyle = bar ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.16)";
        ctx.fillRect(x - 0.5, bar ? r.y : r.y + r.h * 0.3, 1, bar ? r.h : r.h * 0.4);
      }
    }
    const X = (sec: number) => r.x + (sec - t0) / secPerPx;
    const inside = (x: number) => x >= r.x - 1 && x <= r.x + r.w + 1;
    // The loop.
    if (deck.loopEnd > deck.loopStart) {
      const a = Math.max(r.x, X(deck.loopStart)), b = Math.min(r.x + r.w, X(deck.loopEnd));
      if (b > a) { ctx.fillStyle = deck.loopOn ? rgba(LIVE.play, 0.17) : "rgba(255,255,255,0.06)"; ctx.fillRect(a, r.y, b - a, r.h); }
      for (const sec of [deck.loopStart, deck.loopEnd]) if (inside(X(sec))) { ctx.fillStyle = deck.loopOn ? rgba(LIVE.play, 0.95) : "rgba(255,255,255,0.4)"; ctx.fillRect(X(sec) - 0.75, r.y, 1.5, r.h); }
    }
    // The cue mark (orange) and the hot cues (their pad's colour, numbered).
    const flag = (sec: number, colour: RGB, text?: string): void => {
      const x = X(sec);
      if (!inside(x)) return;
      ctx.fillStyle = rgba(colour);
      ctx.fillRect(x - 0.75, r.y, 1.5, r.h);
      ctx.beginPath(); ctx.moveTo(x - 4.5 * u, r.y + r.h); ctx.lineTo(x + 4.5 * u, r.y + r.h); ctx.lineTo(x, r.y + r.h - 6 * u); ctx.closePath(); ctx.fill();
      if (text) label(ctx, text, x + 8 * u, r.y + r.h - 5 * u, { size: 6.4 * u, color: rgba(colour), mono: true, align: "left" });
    };
    flag(deck.cuePoint, LIVE.cue);
    deck.hotCues.forEach((c, i) => { if (c !== null) flag(c, LIVE.pad[i], String(i + 1)); });
    // The needle (white), and the place a drag will drop it (deck colour).
    ctx.fillStyle = "#fff";
    ctx.fillRect(playX - 0.75, r.y - 2, 1.5, r.h + 4);
    if (drop !== null) { ctx.fillStyle = rgba(tint); ctx.fillRect((whole ? r.x + r.w * drop : r.x + r.w / 2) - 1.25, r.y - 3, 2.5, r.h + 6); }
    // The zoom: what the picture shows, and the two buttons over its corner.
    small(ctx, whole ? "WHOLE" : `${win} S`, r.x + 6 * u, r.y + r.h - 7 * u, 6 * u, { align: "left", color: LIVE.dim, mono: true });
    button(ctx, G.zoomOut, "\u2212", false, LIVE.sync, u, { size: 9 * u, enabled: v.zoom[d].level > 0 });
    button(ctx, G.zoomIn, "+", false, LIVE.sync, u, { size: 9 * u, enabled: v.zoom[d].level < 6 });
  }

  // MARK: Loops and pads

  /** The column beside the platter: what the pads are, IN and OUT, half and double, the loop on or off, an automatic loop. */
  private loopColumn(ctx: Ctx, g: LiveGeometry, v: LiveView, d: number): void {
    const G = g.deck[d], L = G.loopUi, u = g.u, deck = v.decks[d], tint = LIVE.deck[d];
    const mode = v.padMode[d], has = deck.loopEnd > deck.loopStart, loaded = deck.isLoaded;
    // What the eight pads are: two slim tabs right above them.
    button(ctx, G.modeTabs[0], "CUES", mode === "cues", tint, u, { size: 6.2 * u });
    button(ctx, G.modeTabs[1], "LOOPS", mode === "loops", tint, u, { size: 6.2 * u });
    button(ctx, L.io[0], "IN", false, LIVE.play, u, { enabled: loaded, size: 6.8 * u });
    button(ctx, L.io[1], "OUT", false, LIVE.play, u, { enabled: loaded, size: 6.8 * u });
    button(ctx, L.toggle, "LOOP", deck.loopOn, LIVE.play, u, { enabled: has, size: 6.8 * u });
    button(ctx, L.scale[0], "\u00bd", false, LIVE.sync, u, { enabled: has, size: 8 * u });
    button(ctx, L.scale[1], "\u00d72", false, LIVE.sync, u, { enabled: has, size: 7.4 * u });
    const beats = has && deck.grid.beatLength > 0 ? (deck.loopEnd - deck.loopStart) / deck.grid.beatLength : 0;
    [4, 8, 16, 32].forEach((n, i) => button(ctx, L.auto[i], String(n), deck.loopOn && Math.abs(beats - n) < 0.04 * n, LIVE.play, u, { enabled: loaded, size: 6.6 * u }));
  }

  /** Eight pads under the transport: the hot cues (a set one shows its time), or the saved loops (a set one shows its length in beats). */
  private pads(ctx: Ctx, g: LiveGeometry, v: LiveView, d: number): void {
    const G = g.deck[d], u = g.u, deck = v.decks[d], loops = v.padMode[d] === "loops";
    G.pads.forEach((r, i) => {
      const colour = LIVE.pad[i];
      const cue = deck.hotCues[i], slot = deck.loopSlots[i];
      const set = loops ? slot !== null : cue !== null;
      const current = loops && slot !== null && deck.loopOn && Math.abs(slot.start - deck.loopStart) < 1e-6 && Math.abs(slot.end - deck.loopEnd) < 1e-6;
      roundRect(ctx, r, 3 * u, set ? rgba(colour, 0.2) : "rgba(255,255,255,0.025)", set ? rgba(current ? LIVE.play : colour, 0.95) : "rgba(255,255,255,0.09)", current ? 1.8 : 1);
      // The number on top, what the pad holds under it (the time of a cue, the length of a saved loop).
      small(ctx, String(i + 1), r.x + 6 * u, r.y + r.h * (set ? 0.7 : 0.5), 7.2 * u, { color: set ? rgba(colour) : LIVE.dimmer, mono: true, align: "left" });
      if (set) {
        const text = loops ? (() => { const b = (slot!.end - slot!.start) / Math.max(0.001, deck.grid.beatLength); return `${b >= 1 ? Math.round(b * 4) / 4 : Math.round(b * 8) / 8}B`; })() : clock(cue!);
        small(ctx, text, r.x + r.w - 5 * u, r.y + r.h * 0.3, 6.6 * u, { color: LIVE.ink, mono: true, align: "right" });
      }
    });
  }

  // MARK: The mixer

  private mixer(ctx: Ctx, g: LiveGeometry, v: LiveView): void {
    const M = g.mixer, u = g.u;
    panel(ctx, M.rect, u);
    // Tempos at the top, and where deck B's beat falls against deck A's.
    [0, 1].forEach((d) => label(ctx, v.decks[d].isLoaded ? v.decks[d].bpm.toFixed(1) : "---.-", M.bpm[d].x, M.bpm[d].y, { size: 11 * u, color: rgba(LIVE.deck[d]), mono: true, align: d === 0 ? "left" : "right" }));
    // The key right under it, in the same size.
    [0, 1].forEach((d) => label(ctx, v.decks[d].info?.camelot ?? "--", M.key[d].x, M.key[d].y, { size: 11 * u, color: LIVE.ink, mono: true, align: d === 0 ? "left" : "right" }));
    roundRect(ctx, centred(M.phase.c.x, M.phase.c.y, M.phase.w, 3 * u), 1.5 * u, "#020304", "rgba(255,255,255,0.08)");
    ctx.fillStyle = LIVE.dimmer;
    ctx.fillRect(M.phase.c.x - 0.6, M.phase.c.y - 4.5 * u, 1.2, 9 * u);
    if (v.phase !== null) circle(ctx, M.phase.c.x - v.phase * M.phase.w, M.phase.c.y, 3.4 * u, Math.abs(v.phase) < 0.03 ? rgba(LIVE.play) : rgba(LIVE.warn));
    else circle(ctx, M.phase.c.x, M.phase.c.y, 3 * u, "rgba(255,255,255,0.1)");

    const names = ["GAIN", "HI", "MID", "LOW", "FILTER"];
    M.strip.forEach((s, d) => {
      const tint = LIVE.deck[d];
      const rings = [LIVE.red, LIVE.eqHigh, LIVE.eqMid, LIVE.eqLow, LIVE.filter];
      const values = [(v.trim[d]), v.eq[d][2], v.eq[d][1], v.eq[d][0], v.filter[d]];
      const bipolar = [true, true, true, true, true];
      s.knobY.forEach((y, i) => {
        // The gain's pointer is red; the FILTER knob sits in a thin blue outline (no fill), so neither is taken for an EQ knob.
        if (i === 4) roundRect(ctx, centred(s.x, y, 2 * (s.knobR + 6.5 * u), 2 * (s.knobR + 6.5 * u)), 4 * u, null, rgba(LIVE.filter, 0.4), 1);
        knob(ctx, s.x, y, s.knobR, values[i], rings[i], bipolar[i], true, i === 0 ? LIVE.red : null);
        small(ctx, names[i], s.x + (d === 0 ? 1 : -1) * 19 * u, y, 5.6 * u, { align: d === 0 ? "left" : "right" });
      });
      // The gain, in dB, once it is not at zero.
      const db = Math.round(v.trimDb(d));
      if (db !== 0) small(ctx, `${db > 0 ? "+" : "−"}${Math.abs(db)} dB`, s.x + (d === 0 ? 1 : -1) * 19 * u, s.knobY[0] - 8 * u, 5.2 * u, { align: d === 0 ? "left" : "right", color: rgba(LIVE.red) });
      button(ctx, centred(s.cue.x, s.cue.y, s.cueW, s.cueH), "CUE", v.phones[d], LIVE.cue, u, { size: 7.4 * u });
      fader(ctx, s.fader.x, s.fader.y, s.fader.travel, v.channel[d], true, 24 * u, 13 * u, tint, u);
    });

    const m = M.mid;
    knob(ctx, m.master.x, m.master.y, m.masterR, v.master, [236, 240, 245], false);
    small(ctx, "MASTER", m.master.x, m.master.y - m.masterR - 9 * u, 5.8 * u);
    [0, 1].forEach((d) => {
      meter(ctx, m.meterX[d], m.meter.y, m.meter.w, m.meter.h, Math.min(1, v.meter[d] * 1.15), u);
      small(ctx, d === 0 ? "A" : "B", m.meterX[d], m.meter.y - 7 * u, 6 * u, { color: rgba(LIVE.deck[d]) });
    });
    // The headphones: how much of the room is in them, and how loud they are.
    for (const [row, value, name] of [[m.mix, v.cueMix, "CUE · MIX"], [m.level, Math.min(1, v.phonesLevel), "PHONES"]] as const) {
      small(ctx, name, row.x, row.y + 8.5 * u, 5.2 * u);
      fader(ctx, row.x, row.y, row.w - 12 * u, value, false, 9 * u, 13 * u, null, u, { oneSide: true });
    }
    fader(ctx, m.cross.x, m.cross.y, m.cross.travel, v.cross, false, 13 * u, 22 * u, [236, 240, 245], u, { centreMark: true });
    small(ctx, "A", m.cross.x - m.cross.travel / 2 - 13 * u, m.cross.y, 7 * u, { color: rgba(LIVE.deck[0]) });
    small(ctx, "B", m.cross.x + m.cross.travel / 2 + 13 * u, m.cross.y, 7 * u, { color: rgba(LIVE.deck[1]) });
  }

  // MARK: The effects

  private fxModule(ctx: Ctx, g: LiveGeometry, v: LiveView): void {
    const F = g.fx, u = g.u;
    panel(ctx, F.rect, u);
    small(ctx, "EFFECT", F.title.x, F.title.y, 6.6 * u, { color: LIVE.dim });
    // The effect's name between two arrows (a touch on the left third goes back, anywhere else forward).
    button(ctx, F.name, FX_TYPES[v.fx.type], false, LIVE.deck[0], u, { size: 7.2 * u });
    small(ctx, "\u2039", F.name.x + 7 * u, F.name.y + F.name.h / 2, 10 * u, { color: LIVE.ink });
    small(ctx, "\u203a", F.name.x + F.name.w - 7 * u, F.name.y + F.name.h / 2, 10 * u, { color: LIVE.ink });
    button(ctx, F.on, "ON", v.fx.on, LIVE.play, u, { size: 8 * u });
    // The four knobs of this effect, the size of the mixer's: each with its name, and a stepped one with the step it is on.
    FX_KNOBS[v.fx.type].forEach((def, i) => {
      const k = F.knobs[i], value = v.fx.params[i] ?? 0;
      knob(ctx, k.c.x, k.c.y, k.r, value, LIVE.fxRing, false);
      small(ctx, def.name, k.name.x, k.name.y, 5.6 * u);
      if (def.steps) small(ctx, def.steps[stepIndex(value, def.steps.length)], k.value.x, k.value.y, 6.2 * u, { color: LIVE.ink, mono: true });
    });
    // LEVEL: a long fader, how much of the effect there is.
    const L = F.level;
    fader(ctx, L.x, L.y, L.travel, v.fx.amount, true, L.capW, 13 * u, LIVE.fxRing, u);
    small(ctx, "LEVEL", L.x, L.labelY, 5.6 * u);
  }
}
