// The pieces of gear the booth is drawn from (port of App/BoothNodes.swift and Palette.swift).
// Everything here draws in the booth's world: CSS pixels with y pointing UP and angles growing
// anticlockwise, as in SpriteKit, so the iPhone's layout numbers and angles carry over as they are.

export type RGB = readonly [number, number, number];

/** The game's colours: a night palette with Grooveline teal as the thread. */
export const Palette = {
  night: [7, 9, 16] as RGB,
  panel: [16, 19, 28] as RGB,
  slot: [5, 6, 10] as RGB,
  metal: [158, 166, 179] as RGB,
  darkMetal: [43, 48, 59] as RGB,
  teal: [26, 212, 196] as RGB,
  magenta: [255, 61, 166] as RGB,
  orange: [255, 153, 61] as RGB,
  red: [255, 69, 69] as RGB,
  ink: [237, 237, 237] as RGB,
  white: [255, 255, 255] as RGB,
  black: [0, 0, 0] as RGB,
};
export const EDGE = "rgba(255,255,255,0.09)";
export const DIM = "rgba(255,255,255,0.38)";

export const rgba = (c: RGB, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Barlow Condensed ships with the game (OFL), so the labels look the same on every system. */
export const CONDENSED = `"Barlow Condensed", "Avenir Next Condensed", "Arial Narrow", sans-serif`;
export const MONO = `Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace`;

export interface Point { x: number; y: number; }
/** A rectangle in the booth's world: (x, y) is its bottom-left corner. */
export interface Rect { x: number; y: number; w: number; h: number; }

export const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
/** A touch area of `w` by `h` centred on a control. */
export const centred = (x: number, y: number, w: number, h: number): Rect => ({ x: x - w / 2, y: y - h / 2, w, h });

type Ctx = CanvasRenderingContext2D;

export function roundRect(ctx: Ctx, r: Rect, radius: number, fill: string | null, stroke: string | null = null, lineWidth = 1): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

export function circle(ctx: Ctx, x: number, y: number, radius: number, fill: string | null, stroke: string | null = null, lineWidth = 1): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

export interface LabelStyle {
  size: number;
  color?: string;
  mono?: boolean;
  align?: CanvasTextAlign;
  /** Squeeze the text to this width when it is wider. */
  maxWidth?: number;
  spacing?: number;
}

/** Text, upright in the y-up world, vertically centred on `y`. Returns the drawn width. */
export function label(ctx: Ctx, text: string, x: number, y: number, s: LabelStyle): number {
  if (!text) return 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.font = s.mono ? `bold ${s.size}px ${MONO}` : `600 ${s.size}px ${CONDENSED}`;
  ctx.fillStyle = s.color ?? DIM;
  ctx.textAlign = s.align ?? "center";
  ctx.textBaseline = "middle";
  if (s.spacing) ctx.letterSpacing = `${s.spacing}px`;
  const width = ctx.measureText(text).width;
  // Squeezed around its anchor (the text's left, right or centre stays where it is).
  if (s.maxWidth && width > s.maxWidth && s.maxWidth > 0) ctx.scale(s.maxWidth / width, s.maxWidth / width);
  ctx.fillText(text, 0, 0);
  ctx.restore();
  return Math.min(width, s.maxWidth ?? width);
}

/** A picture drawn in ordinary (y-down) canvas coordinates, put upright into the world, centred on
 * (x, y), turned by `angle` (anticlockwise, as SpriteKit's zRotation). */
export function picture(ctx: Ctx, img: CanvasImageSource, x: number, y: number, w: number, h: number, angle = 0): void {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.scale(1, -1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** A slot with a cap that slides along it. `value` 0...1 runs bottom to top, or left to right. */
export function fader(ctx: Ctx, x: number, y: number, o: {
  travel: number; vertical: boolean; capW: number; capH: number; tint: RGB; centreMark?: boolean; value: number; alpha?: number;
}): void {
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.translate(x, y);
  const { travel, vertical, capW, capH } = o;
  const slot = vertical ? { x: -2, y: -(travel + capH) / 2, w: 4, h: travel + capH } : { x: -(travel + capW) / 2, y: -2, w: travel + capW, h: 4 };
  roundRect(ctx, slot, 2, rgba(Palette.slot), EDGE);
  // Scale marks beside the slot; the middle one is longer.
  const off = Math.max(capW, capH) * 0.5 + 5;
  for (let i = 0; i <= 8; i++) {
    const long = i === 4;
    const at = (i / 8 - 0.5) * travel;
    const length = long ? 9 : 5;
    ctx.fillStyle = long && o.centreMark ? rgba(o.tint) : DIM;
    if (vertical) ctx.fillRect(-off - length / 2, at - 0.5, length, 1);
    else ctx.fillRect(at - 0.5, -off - length / 2, 1, length);
  }
  const p = (Math.min(1, Math.max(0, o.value)) - 0.5) * travel;
  const cx = vertical ? 0 : p, cy = vertical ? p : 0;
  roundRect(ctx, centred(cx, cy, capW, capH), Math.min(capW, capH) * 0.22, rgba(Palette.darkMetal), rgba(Palette.metal));
  ctx.fillStyle = rgba(o.tint);
  if (vertical) ctx.fillRect(cx - capW * 0.4, cy - 1, capW * 0.8, 2);
  else ctx.fillRect(cx - 1, cy - capH * 0.4, 2, capH * 0.8);
  ctx.restore();
}

/** A rotary knob. `value` 0...1; 0.5 points straight up. */
export function knob(ctx: Ctx, x: number, y: number, radius: number, tint: RGB, title: string, value: number): void {
  circle(ctx, x, y, radius + 2.5, rgba(Palette.slot), EDGE);
  circle(ctx, x, y, radius, rgba(Palette.darkMetal), rgba(Palette.metal));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((0.5 - Math.min(1, Math.max(0, value))) * 1.5 * Math.PI);
  roundRect(ctx, centred(0, radius * 0.58, 2.5, radius * 0.62), 1, rgba(tint));
  ctx.restore();
  if (title) label(ctx, title, x, y - radius - 9, { size: radius * 0.6 });
}

/** A push button that lights up. */
export function button(ctx: Ctx, x: number, y: number, w: number, h: number, title: string, tint: RGB, lit: boolean, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, centred(x, y, w, h), h * 0.28, lit ? rgba(tint) : rgba(Palette.slot), lit ? rgba(tint) : rgba(tint, 0.55), 1.5);
  label(ctx, title, x, y, { size: h * 0.46, color: lit ? "#000" : rgba(tint) });
  ctx.restore();
}

/** A ladder of lights: teal, then orange, then red at the top. */
export function meter(ctx: Ctx, x: number, y: number, w: number, h: number, level: number, count = 10): void {
  const lamp = h / count;
  const on = level * count;
  for (let i = 0; i < count; i++) {
    const c = i >= count - 1 ? Palette.red : i >= count - 4 ? Palette.orange : Palette.teal;
    roundRect(ctx, centred(x, y + (i + 0.5) * lamp - h / 2, w, lamp - 2), 1, rgba(c, i < on ? 1 : 0.16));
  }
}

/** A tonearm lying along +x from its pivot (x, y), turned by `angle`. */
export function tonearm(ctx: Ctx, x: number, y: number, length: number, u: number, angle: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  circle(ctx, 0, 0, 9 * u, rgba(Palette.darkMetal), rgba(Palette.metal));
  roundRect(ctx, centred(-13 * u, 0, 15 * u, 11 * u), 3 * u, rgba(Palette.metal));
  roundRect(ctx, centred(length / 2, 0, length, 3 * u), 1.5 * u, rgba(Palette.metal));
  roundRect(ctx, centred(length - 4 * u, 0, 15 * u, 8 * u), 1.5 * u, rgba(Palette.slot), rgba(Palette.metal));
  ctx.restore();
}

// Pictures drawn once and reused (ordinary y-down canvas coordinates, as UIKit's renderer).

function offscreen(w: number, h: number, scale: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

/** The platter with a record on it, seen from above. `r` is the record; the platter's dotted
 * rim reaches to `r * 1.07`, which is the size of the picture. */
/** `art`: a cover picture for the label (a record from your own library); the label keeps its rim in the deck's colour. */
export function platterPicture(r: number, tint: RGB, scale: number, art: CanvasImageSource | null = null): HTMLCanvasElement {
  const outer = r * 1.07;
  const { canvas, ctx: c } = offscreen(outer * 2, outer * 2, scale);
  const mid = outer;
  const ring = (radius: number, fill: string | null, stroke: string | null = null, width = 1) => circle(c, mid, mid, radius, fill, stroke, width);
  // Platter rim with strobe dots.
  ring(outer, rgba(Palette.darkMetal));
  ring(outer - 0.5, null, rgba(Palette.metal, 0.6));
  const dots = 72;
  for (let i = 0; i < dots; i++) {
    const a = i / dots * 2 * Math.PI;
    circle(c, mid + Math.cos(a) * r * 1.035, mid + Math.sin(a) * r * 1.035, r * 0.011, rgba(Palette.metal));
  }
  // Vinyl and its grooves; every few rings a brighter gap between tracks.
  ring(r, "rgb(8,8,8)");
  let groove = r * 0.965;
  let i = 0;
  while (groove > r * 0.42) {
    const gap = i % 8 === 0;
    ring(groove, null, `rgba(255,255,255,${gap ? 0.12 : 0.04})`, gap ? 1 : 0.5);
    groove -= r * 0.02;
    i += 1;
  }
  // Label, with a stripe the eye can follow.
  const lr = r * 0.34;
  ring(lr, rgba(tint));
  if (art) {
    const inner = lr * 0.88;
    c.save();
    c.beginPath();
    c.arc(mid, mid, inner, 0, 2 * Math.PI);
    c.clip();
    c.drawImage(art, mid - inner, mid - inner, inner * 2, inner * 2);
    c.restore();
    ring(inner, null, "rgba(0,0,0,0.55)", Math.max(1, lr * 0.03));
    // The stripe the eye follows, with a dark edge so it shows on any picture.
    c.strokeStyle = "rgba(0,0,0,0.55)";
    c.lineWidth = Math.max(2, r * 0.035) + 2;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(mid, mid - lr * 0.3);
    c.lineTo(mid, mid - lr * 0.9);
    c.stroke();
  } else {
    ring(lr * 0.74, null, "rgba(0,0,0,0.3)", lr * 0.07);
  }
  c.strokeStyle = "#fff";
  c.lineWidth = Math.max(2, r * 0.035);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(mid, mid - lr * 0.3);
  c.lineTo(mid, mid - lr * 0.9);
  c.stroke();
  // A sticker at the edge of the vinyl, the way DJs mark where the first beat is.
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.fillRect(mid - r * 0.022, mid - r * 0.99, r * 0.044, r * 0.11);
  // Spindle.
  ring(r * 0.035, rgba(Palette.metal));
  return canvas;
}

/** Light lying across the grooves. It stays still while the record turns under it. */
export function sheenPicture(r: number, scale: number): HTMLCanvasElement {
  const { canvas, ctx: c } = offscreen(r * 2, r * 2, scale);
  c.beginPath();
  c.arc(r, r, r * 0.97, 0, Math.PI * 2);
  c.arc(r, r, r * 0.37, 0, Math.PI * 2, true);
  c.clip("evenodd");
  const wedges: [number, RGB][] = [[-0.5, Palette.orange], [Math.PI - 0.5, Palette.magenta]];
  for (const [angle, tint] of wedges) {
    for (let k = 0; k < 16; k++) {
      const narrow = k / 16 * 0.36;
      c.fillStyle = rgba(tint, 0.022);
      c.beginPath();
      c.moveTo(r, r);
      c.arc(r, r, r, angle - 0.38 + narrow, angle + 0.38 - narrow);
      c.closePath();
      c.fill();
    }
  }
  return canvas;
}

/** The record's loudness along its length, mirrored round the middle line like a waveform.
 * `ticks` (0...1 along the strip) mark where each sixteen-bar phrase starts. */
export function wavePicture(levels: Float32Array, w: number, h: number, tint: RGB, ticks: number[], scale: number): HTMLCanvasElement {
  const { canvas, ctx: c } = offscreen(w, h, scale);
  const mid = h / 2;
  if (levels.length > 1) {
    const step = w / (levels.length - 1);
    c.beginPath();
    c.moveTo(0, mid);
    for (let i = 0; i < levels.length; i++) c.lineTo(i * step, mid - Math.max(0.6, levels[i] * (mid - 1)));
    for (let i = levels.length - 1; i >= 0; i--) c.lineTo(i * step, mid + Math.max(0.6, levels[i] * (mid - 1)));
    c.closePath();
    c.fillStyle = rgba(tint, 0.85);
    c.fill();
  } else {
    c.fillStyle = DIM;
    c.fillRect(0, mid - 0.5, w, 1);
  }
  c.fillStyle = "rgba(255,255,255,0.55)";
  for (const t of ticks) c.fillRect(t * w - 0.5, h - 3, 1, 3);
  return canvas;
}
