// The booth: the room on top, two turntables and a mixer below (port of App/BoothScene.swift,
// free play for now; lessons and nights follow once the content is exported from the iPhone code).
// The canvas draws in SpriteKit's world (y up, CSS pixels), so the iPhone's layout numbers,
// angles and touch arithmetic are used as they are.

import type { Deck, DeckEngine } from "../audio/engine.ts";
import { crossfade, faderGain, phaseOffset, pitchToPlay, readMix, verdict } from "../core/mixjudge.ts";
import type { DeckSnapshot, MixReading } from "../core/mixjudge.ts";
import {
  DIM, EDGE, Palette, button, centred, circle, contains, fader, knob, label, meter, picture, platterPicture,
  rgba, roundRect, sheenPicture, tonearm, wavePicture,
} from "./gear.ts";
import type { Point, RGB, Rect } from "./gear.ts";
import type { LessonDesk, LessonTarget } from "../game/content.ts";
import type { TrackInfo } from "../core/beatgrid.ts";
import { clash, compatible } from "../core/harmony.ts";
import type { NightRunner } from "../game/night.ts";
import type { NightInfo } from "../game/content.ts";
import type { LessonRunner } from "../game/lesson.ts";
import { PHRASE } from "../game/lesson.ts";

type Kind =
  | { t: "platter"; d: number } | { t: "rim"; d: number } | { t: "pitch"; d: number } | { t: "channel"; d: number }
  | { t: "cross" } | { t: "eq"; d: number; band: number } | { t: "play"; d: number } | { t: "cue"; d: number }
  | { t: "sync"; d: number } | { t: "needle"; d: number } | { t: "wave"; d: number } | { t: "phones"; d: number }
  | { t: "cueMix" } | { t: "filter"; d: number };

const keyOf = (k: Kind): string => `${k.t}:${"d" in k ? k.d : ""}:${"band" in k ? k.band : ""}`;

interface Grab { kind: Kind; start: Point; startValue: number; angle: number; }

/** What the DJ on the other deck is doing (back to back, chapter 11). Ramps are counted in beats
 * of her own record (`from`, `since`), or of yours where the iPhone says so. */
type PartnerMove =
  | { t: "on"; armed: boolean }              // her record on air; once your fader was down, yours coming up is your answer
  | { t: "waiting"; phrase: number }         // your record is up: at the end of her phrase she takes her low out
  | { t: "cutting"; from: number }           // her low goes down over two beats
  | { t: "swapped"; since: number }          // her low is out; she waits for yours (or two bars)
  | { t: "fading"; from: number; level: number } // her fader comes down (four bars; VEX one), then she stops
  | { t: "out"; since: number }              // her record is out; yours has been on alone since (s)
  | { t: "loading" }                         // her answer is being fetched (the web loads records in the background)
  | { t: "ready"; phrase: number }           // her answer turns at your tempo, fader down
  | { t: "rising"; from: number }            // her fader comes up over a phrase of yours (VEX: a bar)
  | { t: "bassing"; from: number }           // her low comes back in over two beats
  | { t: "stealing"; from: number; level: number } // VEX pulls your fader down over a beat
  | { t: "holding"; until: number; fought: boolean }; // your fader is his until then

/** Radians per second of a record at 33⅓ rpm. */
const TURN = 2 * Math.PI * (100 / 3) / 60;
/** The pitch fader covers ±8 %, like a classic turntable. */
const PITCH_RANGE = 0.08;
const MOODS = ["waiting", "nodding", "dancing", "nuts"];
/** Extra lift of a room's picture, as a part of its height, for rooms whose people stand low. */
const ROOM_LIFT: Record<string, number> = { field: 0.28, forest: 0.32, festival: 0.2, tent: 0.2, meridian: 0.15 };
const TINTS: RGB[] = [Palette.teal, Palette.magenta];

/** Where everything sits, worked out once per screen size (`build`). */
interface Layout {
  W: number; H: number; u: number; gearTop: number; left: number;
  deck: Rect[]; mixer: Rect;
  outer: number; r: number; centre: Point[];
  pivot: Point[]; armLength: number; armPivotAngle: number; needleReach: number;
  rowY: number[]; titleX: number[]; timeX: number[]; dotX: number[][];
  wave: Rect[];
  buttonW: number; buttonH: number; buttonX: number[][]; buttonY: number[];
  pitchX: number[]; pitchY: number[]; pitchTravel: number;
  bpmX: number[]; topY: number; phaseY: number; phaseWidth: number;
  knobX: number[]; knobY: number[]; knobTravel: number;
  channelX: number[]; channelY: number; channelTravel: number;
  phonesY: number; meterX: number[]; meterY: number;
  crossY: number; crossTravel: number; filterY: number;
}

export class Booth {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly roomLayer: HTMLElement;
  private readonly engine: DeckEngine;
  private get decks(): Deck[] { return this.engine.decks; }

  // Settings.
  private pitchFader = [0.5, 0.5]; // 1 = top = slower, as on a turntable
  private channel = [0.85, 0.85];
  private cross = 0.5;
  private eq = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]]; // per deck: low, mid, high
  private sync = [false, false];
  /** Headphone cue per channel: that record is heard in the headphones, before its fader. */
  private phones = [false, false];
  /** The one-knob filter per channel (0.5 = off). */
  private filterSetting = [0.5, 0.5];
  private syncAllowed = true;
  private hideNumbers = false;
  private hasFilter = true;
  /** A channel fader that is broken in this booth (stuck where the desk sets it). */
  private deadFader: number | null = null;

  /** The lesson being taught here, if any. */
  lesson: LessonRunner | null = null;
  /** The night being played here, if any: the crowd's energy follows the mixing. */
  night: NightRunner | null = null;
  /** A record stuck in one groove (a night's mishap): the deck, and where the groove starts (s). */
  private stuck: { deck: number; from: number } | null = null;
  /** A turntable whose belt slips (a night's mishap): its pitch wanders from then on. */
  private wander: { deck: number; since: number } | null = null;
  private lessonReady = false;
  /** Where a lesson cues every record, in bars past its first beat. */
  private cueBar: number | null = null;
  /** Every record (for the partner's answers). */
  tracks: TrackInfo[] = [];
  // Back to back: the deck the other DJ plays herself, what she is doing, hands put on her deck.
  private partnerDeck: number | null = null;
  private partnerMove: PartnerMove = { t: "on", armed: true };
  stepOns = 0;
  private partnerBag: string[] = [];
  private partnerPlayed = new Set<string>();
  partnerAnswers = 0;
  private partnerTrimAt = 0;
  private partnerStyle: "helena" | "vex" = "helena";
  partnerSteals = 0;
  partnerFights = 0;
  /** A hand landed on the partner's deck (the page buzzes). */
  onStepOn: () => void = () => {};

  /** Puts a record (by id) on a deck; the page knows where records live. */
  loadRecord: (d: number, id: string) => Promise<void> = async () => {};
  /** What the page knows for the lesson: jingles fired, the studio's grid, dubplates cut. */
  pageFacts: () => { jingles: number; jinglePlaying: boolean; pattern: boolean[][]; page: number; cuts: number } =
    () => ({ jingles: 0, jinglePlaying: false, pattern: [], page: 0, cuts: 0 });

  // Hands.
  private grabs = new Map<number, Grab>();
  private handTravel = [0, 0];
  private handSpeed = [0, 0];
  private rimTravel = [0, 0];
  private rimSpeed = [0, 0];
  /** While a needle is in the air: where on the record it will come down, 0...1. */
  private dropAt: (number | null)[] = [null, null];
  private lastDown = new Map<string, number>();

  // On screen.
  private L: Layout | null = null;
  private hits: { kind: Kind; rect: Rect }[] = [];
  private dpr = 1;
  private platterImg: HTMLCanvasElement[] = [];
  private sheenImg: HTMLCanvasElement | null = null;
  private waveImg: (HTMLCanvasElement | null)[] = [null, null];
  private waveFor: string[] = ["", ""];
  private meterLevel = [0, 0];
  private roomShade = 0.45;
  private room = "bedroom";
  private roomVideos: (HTMLVideoElement | null)[] = [null, null, null, null];
  private roomMissing = new Set<number>();
  private roomMood = -1;
  private lastTime = 0;
  /** What the room heard this frame. */
  lastReading: MixReading | null = null;

  constructor(canvas: HTMLCanvasElement, roomLayer: HTMLElement, engine: DeckEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.roomLayer = roomLayer;
    this.engine = engine;
    for (const d of [0, 1]) this.decks[d].volume = faderGain(this.channel[d]) * (d === 0 ? crossfade(this.cross).a : crossfade(this.cross).b);
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => { this.L = null; }).observe(canvas);
    this.buildRoom();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The screenshot run: both records turning, the second one synced to the first. */
  demo(): void {
    const [a, b] = this.decks;
    if (!a.isLoaded || !b.isLoaded) return;
    this.sync[1] = true;
    // Needles some way into the records, so the strips show something.
    a.seek(a.duration * 0.36);
    b.seek(b.duration * 0.12);
    a.motorOn = true;
    b.motorOn = true;
  }

  /** A new record was put on deck `d`: its pitch fader goes back to the middle. */
  recordChanged(d: number): void {
    this.pitchFader[d] = 0.5;
    this.decks[d].pitch = 0;
    this.dropAt[d] = null;
    this.waveFor[d] = "";
    // A lesson that cues its records past the intro cues the new one there too.
    if (this.cueBar !== null) {
      const deck = this.decks[d];
      deck.cuePoint = this.cueAt(this.cueBar, d);
      deck.seek(deck.cuePoint);
    }
  }

  /** Where a record is cued: `bar` bars after its first beat (when the record is that long),
   * otherwise on the first beat. */
  private cueAt(bar: number | null, d: number): number {
    const deck = this.decks[d];
    if (bar === null) return deck.grid.firstBeat;
    const at = deck.grid.secondsAtBeat(bar * 4);
    return at < deck.duration - 20 ? at : deck.grid.firstBeat;
  }

  /** A lesson (or a night) starts from a known desk: both records at their first beat and
   * stopped, pitch and EQ in the middle, and the faders and SYNC as the lesson wants them. */
  async setTheDesk(desk: LessonDesk, firstTwo: string[]): Promise<void> {
    this.cross = desk.crossfader;
    this.channel = desk.channel.slice();
    this.pitchFader = desk.pitch ? desk.pitch.slice() : [0.5, 0.5];
    this.hideNumbers = desk.hideBPM;
    this.eq = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]];
    this.filterSetting = [0.5, 0.5];
    this.hasFilter = desk.chapter >= 7;
    this.deadFader = desk.deadFader;
    this.engine.echoSeconds = desk.echo;
    this.sync = desk.sync.slice();
    this.syncAllowed = desk.syncAllowed;
    this.cueBar = desk.cueBar;
    if (desk.room !== this.room) { this.room = desk.room; this.buildRoom(); this.placeRoom(); }
    // The records this lesson is written for (default: the first two, 122 and 124 BPM).
    const wanted = desk.records ?? firstTwo;
    await Promise.all([0, 1].map((d) => wanted[d] && this.decks[d].info?.id !== wanted[d] ? this.loadRecord(d, wanted[d]) : Promise.resolve()));
    if (desk.cueMix !== null) this.engine.cueMix = desk.cueMix;
    this.phones = [false, false];
    for (const d of [0, 1]) {
      const deck = this.decks[d];
      deck.motorOn = false;
      deck.pitch = (0.5 - this.pitchFader[d]) * 2 * PITCH_RANGE;
      deck.bend = 0;
      deck.cuePoint = this.cueAt(desk.cueBar, d);
      deck.seek(deck.cuePoint);
      for (const band of [0, 1, 2]) deck.setEQ(band, 0.5);
      deck.setFilter(0.5);
      deck.cue = false;
    }
    // Back to back: her record is already on air when the lesson starts.
    this.partnerDeck = desk.partner;
    this.partnerMove = { t: "on", armed: true };
    this.stepOns = 0;
    this.partnerBag = desk.partnerBag.slice();
    this.partnerStyle = desk.partnerStyle;
    this.partnerSteals = 0;
    this.partnerFights = 0;
    this.partnerAnswers = 0;
    this.partnerPlayed = new Set();
    const h = desk.partner;
    if (h !== null && this.decks[h].isLoaded) {
      this.decks[h].motorOn = true;
      const id = this.decks[h].info?.id;
      if (id) this.partnerPlayed.add(id);
    }
    this.applyMix();
    this.L = null; // rebuild (the filter knobs may come or go)
  }

  /** Back to plain free play: no lesson, no night, the music at full level. */
  clearSession(): void {
    this.lesson?.stop();
    this.night?.stop();
    this.lesson = null;
    this.night = null;
    this.stuck = null;
    this.wander = null;
    this.partnerDeck = null;
    this.deadFader = null;
    this.cueBar = null;
    this.hideNumbers = false;
    this.syncAllowed = true;
    this.engine.masterVolume = 1;
    this.engine.echoSeconds = 0;
    this.L = null;
  }

  /** A night starts like a gig: the first record ready, the second one's fader down. */
  async startNight(runner: NightRunner, firstTwo: string[]): Promise<void> {
    this.clearSession();
    const info: NightInfo = runner.info;
    await this.setTheDesk({
      crossfader: 0.5, channel: [0.85, 0], sync: info.syncAllowed ? [false, true] : [false, false], cueMix: null,
      room: info.room, syncAllowed: info.syncAllowed, records: info.records, crate: true, chapter: info.chapter,
      hideBPM: false, pitch: null, bag: null, cueBar: null, studio: false, pattern: null, cutter: false,
      deadFader: info.deadFader, echo: info.echo, partner: info.partner, partnerBag: info.partnerBag, partnerStyle: info.partnerStyle,
    }, firstTwo);
    this.night = runner;
  }

  /** Starts a lesson on the desk it is written for. */
  async startLesson(runner: LessonRunner, firstTwo: string[]): Promise<void> {
    this.clearSession();
    await this.setTheDesk(runner.lesson.desk, firstTwo);
    this.lesson = runner;
    this.lessonReady = false;
  }

  // MARK: - Building the gear

  private build(): void {
    this.releaseAllHands();
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    if (W <= 200 || H <= 200) { this.L = null; return; }
    const left = 10, right = 10, bottom = 8;
    const gearTop = H * 0.58;
    const gx0 = left, gy0 = bottom;
    const gw = W - left - right, gh = gearTop - 6 - bottom;
    const u = gh / 210;
    const gap = 8 * u;
    const mixerW = Math.min(gw * 0.31, 224 * u);
    const deckW = (gw - mixerW - gap * 2) / 2;
    const deck: Rect[] = [
      { x: gx0, y: gy0, w: deckW, h: gh },
      { x: gx0 + deckW + gap + mixerW + gap, y: gy0, w: deckW, h: gh },
    ];
    const mixer: Rect = { x: gx0 + deckW + gap, y: gy0, w: mixerW, h: gh };
    const hits: { kind: Kind; rect: Rect }[] = [];
    const first = (kind: Kind, rect: Rect) => hits.unshift({ kind, rect });

    // Decks: platter as big as the panel allows, title and strip above, buttons below.
    const outer = Math.min((gh - 64 * u) / 2, (deckW - 86 * u) / 2);
    const r = outer / 1.07;
    const centre: Point[] = [], pivot: Point[] = [], rowY: number[] = [], titleX: number[] = [], timeX: number[] = [];
    const dotX: number[][] = [], wave: Rect[] = [], buttonX: number[][] = [], buttonY: number[] = [];
    const pitchX: number[] = [], pitchY: number[] = [];
    const buttonW = 46 * u, buttonH = 22 * u;
    const pitchTravel = gh - 78 * u;
    let armLength = 100, armPivotAngle = 0;
    for (const d of [0, 1]) {
      const rect = deck[d];
      const c = { x: rect.x + 8 * u + outer, y: rect.y + 34 * u + outer };
      centre.push(c);
      hits.push({ kind: { t: "platter", d }, rect: centred(c.x, c.y, outer * 2.16, outer * 2.16) });
      // Tonearm: pivot behind the platter on the right, needle travelling in as the record plays.
      const p = { x: c.x + r * 0.98, y: c.y + r * 0.86 };
      pivot.push(p);
      armLength = Math.hypot(p.x - c.x, p.y - c.y);
      armPivotAngle = Math.atan2(c.y - p.y, c.x - p.x);
      rowY.push(rect.y + rect.h - 8 * u);
      titleX.push(rect.x + 10 * u);
      timeX.push(rect.x + rect.w - 88 * u);
      dotX.push([0, 1, 2, 3].map((i) => rect.x + rect.w - 52 * u - (3 - i) * 9 * u));
      const w = { x: rect.x + 10 * u, y: rect.y + rect.h - 27 * u, w: rect.w - 58 * u, h: 12 * u };
      wave.push(w);
      // Easy to hit with a thumb: the touch area is much taller than the strip, upwards.
      first({ t: "wave", d }, { x: w.x - 8, y: w.y - 1, w: w.w + 16, h: w.h + 30 });
      const by = rect.y + 17 * u;
      buttonY.push(by);
      const xs = [0, 1, 2].map((i) => rect.x + 10 * u + buttonW / 2 + i * (buttonW + 8 * u));
      buttonX.push(xs);
      const kinds: Kind[] = [{ t: "cue", d }, { t: "play", d }, { t: "sync", d }];
      kinds.forEach((k, i) => first(k, centred(xs[i], by, buttonW + 8, buttonH + 12)));
      // Pitch fader on the right edge: up is slower.
      const px = rect.x + rect.w - 24 * u, py = rect.y + rect.h / 2 + 3 * u;
      pitchX.push(px); pitchY.push(py);
      first({ t: "pitch", d }, centred(px, py, 48 * u, pitchTravel + 32 * u));
    }

    // Mixer: tempos and verdict on top, EQ outside, faders inside, meters in the middle.
    const mx = mixer.x, my = mixer.y, mw = mixer.w, mh = mixer.h, mid = mx + mw / 2;
    const knobX = [mx + 27 * u, mx + mw - 27 * u];
    const knobY = [0, 1, 2].map((band) => my + 74 * u + band * 41 * u);
    const channelX = [mx + 72 * u, mx + mw - 72 * u];
    const channelY = my + 110 * u, channelTravel = 88 * u;
    const phonesY = my + 49 * u;
    const crossTravel = Math.min(112 * u, mw * 0.55);
    const crossY = my + 24 * u, filterY = my + 27 * u;
    for (const d of [0, 1]) {
      for (const band of [0, 1, 2]) first({ t: "eq", d, band }, centred(knobX[d], knobY[band], 42 * u, 40 * u));
      first({ t: "channel", d }, centred(channelX[d], channelY, 40 * u, channelTravel + 28 * u));
      first({ t: "phones", d }, centred(channelX[d], phonesY, 44 * u, 24 * u));
    }
    first({ t: "cueMix" }, centred(mid, phonesY, 30 * u, 26 * u));
    first({ t: "cross" }, centred(mid, crossY, crossTravel + 36 * u, 40 * u));
    // Filter knobs last, so they win the little overlap with the crossfader's touch area.
    if (this.hasFilter) for (const d of [0, 1]) first({ t: "filter", d }, centred(knobX[d], filterY, 30 * u, 30 * u));

    this.hits = hits;
    this.L = {
      W, H, u, gearTop, left, deck, mixer, outer, r, centre, pivot, armLength, armPivotAngle,
      needleReach: Math.max(20, 20 * u), rowY, titleX, timeX, dotX, wave, buttonW, buttonH, buttonX, buttonY,
      pitchX, pitchY, pitchTravel, bpmX: [mx + 32 * u, mx + mw - 32 * u], topY: my + mh - 15 * u, phaseY: my + mh - 30 * u,
      phaseWidth: Math.min(104 * u, mw * 0.5), knobX, knobY, knobTravel: 90 * u, channelX, channelY, channelTravel,
      phonesY, meterX: [mid - 9 * u, mid + 9 * u], meterY: my + 110 * u, crossY, crossTravel, filterY,
    };
    this.platterImg = TINTS.map((t) => platterPicture(r, t, this.dpr));
    this.sheenImg = sheenPicture(r, this.dpr);
    this.waveFor = ["", ""];
    this.placeRoom();
  }

  // MARK: - The room

  /** The room is the DJ's view over the desk: a picture as wide as the screen, with the people in
   * its upper part; the gear covers the rest. Looping clips of the same picture play on top. */
  private buildRoom(): void {
    this.roomLayer.replaceChildren();
    const still = document.createElement("img");
    still.src = `assets/Art/room-${this.room}.jpg`;
    still.alt = "";
    this.roomLayer.append(still);
    this.roomVideos = [null, null, null, null];
    this.roomMissing.clear();
    this.roomMood = -1;
  }

  private placeRoom(): void {
    const L = this.L;
    if (!L) return;
    // Picture and clips are the same crop (1456 x 472), lifted a little so heads and shoulders
    // sit in the part the gear leaves free.
    const h = L.W * 472 / 1456;
    // Open-air rooms have their people lower in the picture: lifted further, never so far that
    // the picture's bottom edge comes above the gear.
    const maxLift = Math.max(0, L.gearTop + h - L.H - L.W * 0.026);
    const lift = Math.min((ROOM_LIFT[this.room] ?? 0) * h, maxLift);
    Object.assign(this.roomLayer.style, { top: `${-(L.W * 0.026 + lift)}px`, width: `${L.W}px`, height: `${h}px` });
  }

  /** The clip of one mood, made the first time it is wanted. A room without a loop for a mood
   * borrows the nearest one it has. */
  private roomVideo(mood: number): HTMLVideoElement | null {
    if (mood < 0 || mood >= MOODS.length) return null;
    const have = this.roomVideos[mood];
    if (have) return have;
    if (this.roomMissing.has(mood)) {
      for (const m of [1, 2, 0, 3]) if (m !== mood && !this.roomMissing.has(m)) return this.roomVideo(m);
      return null;
    }
    const v = document.createElement("video");
    v.src = `assets/Art/room-${this.room}-${MOODS[mood]}.mp4`;
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
    v.style.opacity = "0";
    v.addEventListener("error", () => { this.roomMissing.add(mood); this.roomVideos[mood] = null; v.remove(); });
    this.roomLayer.append(v);
    this.roomVideos[mood] = v;
    return v;
  }

  /** Shows the room in `mood` (fading over from the mood before), or with -1 holds it still. */
  private showRoom(mood: number, dt: number): void {
    let wanted = mood;
    if (wanted >= 0 && !this.roomVideo(wanted)) wanted = this.roomVideo(2) ? 2 : -1;
    if (wanted >= 0) {
      this.roomMood = wanted;
      const v = this.roomVideos[wanted];
      if (v && v.paused) v.play().catch(() => {});
    }
    this.roomVideos.forEach((v, m) => {
      if (!v) return;
      const target = m === this.roomMood ? 1 : 0;
      const now = Number(v.style.opacity || 0);
      const next = now + (target - now) * Math.min(1, dt * 4);
      v.style.opacity = String(next);
      const gone = m !== this.roomMood && next < 0.02;
      if ((gone || wanted < 0) && !v.paused) v.pause();
    });
  }

  // MARK: - Hands

  private needleTip(d: number): Point {
    const L = this.L!;
    const a = this.armAngle(d);
    return { x: L.pivot[d].x + Math.cos(a) * L.armLength, y: L.pivot[d].y + Math.sin(a) * L.armLength };
  }

  private armAngle(d: number): number {
    const L = this.L!;
    const needle = L.r * (0.93 - 0.5 * (this.dropAt[d] ?? this.decks[d].progress));
    return L.armPivotAngle + 2 * Math.asin(Math.min(1, needle / (2 * L.armLength)));
  }

  /** How far through the record a needle is that sits `distance` from the spindle. */
  private progressAtNeedle(distance: number): number {
    const ratio = distance / Math.max(1, this.L!.r);
    return Math.min(1, Math.max(0, (0.93 - ratio) / 0.5));
  }

  private control(p: Point): Kind | null {
    const L = this.L;
    if (!L) return null;
    // The headshell first: it lies on the record, and picking it up must not grab the record.
    for (const d of [0, 1]) {
      if (!this.decks[d].isLoaded) continue;
      const tip = this.needleTip(d);
      if (Math.hypot(p.x - tip.x, p.y - tip.y) <= L.needleReach) return { t: "needle", d };
    }
    for (const hit of this.hits) {
      if (!contains(hit.rect, p)) continue;
      const k = hit.kind;
      if (k.t === "wave") {
        // The top of the platter's rim reaches into the strip's touch area; the rim wins there.
        const dist = Math.hypot(p.x - L.centre[k.d].x, p.y - L.centre[k.d].y);
        if (dist <= L.r * 1.13 || !this.decks[k.d].isLoaded) continue;
        return k;
      }
      if (k.t === "platter") {
        // On the record the hand grabs it; on the dotted rim it only pushes or drags.
        const dist = Math.hypot(p.x - L.centre[k.d].x, p.y - L.centre[k.d].y);
        if (dist <= L.r * 0.93) return k;
        if (dist <= L.r * 1.2) return { t: "rim", d: k.d };
        continue;
      }
      return k;
    }
    return null;
  }

  private value(k: Kind): number {
    switch (k.t) {
      case "pitch": return this.pitchFader[k.d];
      case "channel": return this.channel[k.d];
      case "cross": return this.cross;
      case "eq": return this.eq[k.d][k.band];
      case "filter": return this.filterSetting[k.d];
      case "cueMix": return this.engine.cueMix;
      default: return 0;
    }
  }

  private angle(p: Point, d: number): number {
    const c = this.L!.centre[d];
    return Math.atan2(p.y - c.y, p.x - c.x);
  }

  private holds(t: Kind["t"], d: number): boolean {
    for (const g of this.grabs.values()) if (g.kind.t === t && "d" in g.kind && g.kind.d === d) return true;
    return false;
  }

  /** Pointer position in the booth's world (y up). */
  private at(e: PointerEvent | WheelEvent): Point {
    const box = this.canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: box.height - (e.clientY - box.top) };
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    const p = this.at(e);
    const kind = this.control(p);
    if (!kind) return;
    if (this.partnerHolds(kind)) { this.stepOn(); return; }
    this.canvas.setPointerCapture(e.pointerId);
    const key = keyOf(kind);
    const doubleTap = e.timeStamp - (this.lastDown.get(key) ?? -1e9) < 350;
    this.lastDown.set(key, e.timeStamp);
    const grab: Grab = { kind, start: p, startValue: this.value(kind), angle: 0 };
    const decks = this.decks;
    switch (kind.t) {
      case "platter": {
        const d = kind.d;
        grab.angle = this.angle(p, d);
        this.handTravel[d] = 0;
        this.handSpeed[d] = decks[d].rate;
        decks[d].handRate = decks[d].rate;
        decks[d].held = true;
        break;
      }
      case "rim":
        grab.angle = this.angle(p, kind.d);
        this.rimTravel[kind.d] = 0;
        this.rimSpeed[kind.d] = 0;
        break;
      case "needle": {
        const d = kind.d, pv = this.L!.pivot[d];
        // Remember where on the headshell the finger sits, so the arm does not jump to it.
        grab.angle = Math.atan2(p.y - pv.y, p.x - pv.x) - this.armAngle(d);
        decks[d].lifted = true;
        this.dropAt[d] = decks[d].progress;
        break;
      }
      case "wave":
        decks[kind.d].lifted = true;
        this.dropAt[kind.d] = this.waveProgress(p, kind.d);
        break;
      case "play": {
        const deck = decks[kind.d];
        if (!deck.motorOn && deck.progress > 0.995) deck.seek(deck.cuePoint);
        deck.motorOn = !deck.motorOn;
        break;
      }
      case "cue":
        this.pressCue(kind.d);
        break;
      case "sync":
        if (!this.syncAllowed) break; // vinyl has no sync button
        this.sync[kind.d] = !this.sync[kind.d];
        if (!this.sync[kind.d]) decks[kind.d].bend = 0;
        break;
      case "phones":
        this.phones[kind.d] = !this.phones[kind.d];
        decks[kind.d].cue = this.phones[kind.d];
        break;
      case "eq":
        // A double tap puts a knob back at its default: EQ flat, in the middle.
        if (doubleTap) { this.setEQ(kind.d, kind.band, 0.5); grab.startValue = 0.5; }
        break;
      case "filter":
        if (doubleTap) { this.setFilter(kind.d, 0.5); grab.startValue = 0.5; }
        break;
      case "cueMix":
        // The cue mix's default is CUE: only the cued record in the headphones.
        if (doubleTap) { this.engine.cueMix = 0; grab.startValue = 0; }
        break;
      default:
        break;
    }
    this.grabs.set(e.pointerId, grab);
  }

  private move(e: PointerEvent): void {
    const grab = this.grabs.get(e.pointerId);
    if (!grab || !this.L) return;
    const L = this.L;
    const p = this.at(e);
    const k = grab.kind;
    switch (k.t) {
      case "platter": {
        const a = this.angle(p, k.d);
        this.handTravel[k.d] += turned(grab.angle, a);
        grab.angle = a;
        break;
      }
      case "rim": {
        const a = this.angle(p, k.d);
        this.rimTravel[k.d] += turned(grab.angle, a);
        grab.angle = a;
        break;
      }
      case "needle": {
        // The arm swings round its pivot after the finger; the needle stays on the grooves.
        const pv = L.pivot[k.d];
        let swing = Math.atan2(p.y - pv.y, p.x - pv.x) - grab.angle - L.armPivotAngle;
        while (swing > Math.PI) swing -= 2 * Math.PI;
        while (swing < -Math.PI) swing += 2 * Math.PI;
        this.dropAt[k.d] = this.progressAtNeedle(2 * L.armLength * Math.sin(Math.max(0, swing) / 2));
        break;
      }
      case "wave":
        this.dropAt[k.d] = this.waveProgress(p, k.d);
        break;
      case "pitch": {
        // Fine mode: with the finger well to the side of the fader it moves four times slower,
        // step by step from the last position, so switching modes mid-drag does not jump.
        const fine = Math.abs(p.x - L.pitchX[k.d]) > 60;
        const raw = clamp01(grab.startValue + (p.y - grab.start.y) / L.pitchTravel * (fine ? 0.25 : 1));
        grab.startValue = raw;
        grab.start = p;
        this.setPitchFader(k.d, raw);
        break;
      }
      case "channel":
        if (k.d === this.deadFader) break; // a broken fader: stuck where it is
        this.channel[k.d] = clamp01(grab.startValue + (p.y - grab.start.y) / L.channelTravel);
        this.applyMix();
        break;
      case "cross":
        this.cross = clamp01(grab.startValue + (p.x - grab.start.x) / L.crossTravel);
        this.applyMix();
        break;
      case "cueMix":
        this.engine.cueMix = clamp01(grab.startValue + (p.y - grab.start.y) / L.knobTravel);
        break;
      case "eq":
        this.setEQ(k.d, k.band, clamp01(grab.startValue + (p.y - grab.start.y) / L.knobTravel));
        break;
      case "filter":
        this.setFilter(k.d, clamp01(grab.startValue + (p.y - grab.start.y) / L.knobTravel));
        break;
      default:
        break;
    }
  }

  private up(e: PointerEvent): void {
    const grab = this.grabs.get(e.pointerId);
    if (!grab) return;
    this.grabs.delete(e.pointerId);
    const k = grab.kind;
    switch (k.t) {
      case "platter":
        if (!this.holds("platter", k.d)) this.decks[k.d].held = false;
        break;
      case "rim":
        if (!this.holds("rim", k.d) && !this.sync[k.d]) this.decks[k.d].bend = 0;
        break;
      case "needle":
      case "wave":
        if (!this.holds("needle", k.d) && !this.holds("wave", k.d)) this.dropNeedle(k.d);
        break;
      default:
        break;
    }
  }

  /** The mouse wheel turns knobs and moves faders (laptops): one notch is a small step. */
  private wheel(e: WheelEvent): void {
    const kind = this.control(this.at(e));
    if (!kind) return;
    e.preventDefault();
    if (this.partnerHolds(kind)) { this.stepOn(); return; }
    const step = -Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.025);
    switch (kind.t) {
      case "pitch": this.setPitchFader(kind.d, clamp01(this.pitchFader[kind.d] + step * 0.4)); break;
      case "channel": if (kind.d !== this.deadFader) { this.channel[kind.d] = clamp01(this.channel[kind.d] + step); this.applyMix(); } break;
      case "cross": this.cross = clamp01(this.cross - step); this.applyMix(); break;
      case "eq": this.setEQ(kind.d, kind.band, clamp01(this.eq[kind.d][kind.band] + step)); break;
      case "filter": this.setFilter(kind.d, clamp01(this.filterSetting[kind.d] + step)); break;
      case "cueMix": this.engine.cueMix = clamp01(this.engine.cueMix + step); break;
      default: break;
    }
  }

  private setPitchFader(d: number, raw: number): void {
    const v = Math.abs(raw - 0.5) < 0.012 ? 0.5 : raw; // a detent in the middle
    this.pitchFader[d] = v;
    if (this.sync[d]) { this.sync[d] = false; this.decks[d].bend = 0; } // touching the pitch takes over from sync
    this.decks[d].pitch = (0.5 - v) * 2 * PITCH_RANGE;
  }

  private setEQ(d: number, band: number, raw: number): void {
    const v = Math.abs(raw - 0.5) < 0.03 ? 0.5 : raw;
    this.eq[d][band] = v;
    this.decks[d].setEQ(band, v);
  }

  private setFilter(d: number, raw: number): void {
    const v = Math.abs(raw - 0.5) < 0.03 ? 0.5 : raw;
    this.filterSetting[d] = v;
    this.decks[d].setFilter(v);
  }

  private waveProgress(p: Point, d: number): number {
    const r = this.L!.wave[d];
    return r.w > 0 ? clamp01((p.x - r.x) / r.w) : 0;
  }

  /** The needle comes down where it was carried to. The record never stopped turning. */
  private dropNeedle(d: number): void {
    const deck = this.decks[d];
    const at = this.dropAt[d];
    if (at !== null) {
      // Not past the last groove; and at the very start, on the first beat.
      deck.seek(Math.min(Math.max(deck.grid.firstBeat, at * deck.duration), Math.max(0, deck.duration - 0.25)));
    }
    this.dropAt[d] = null;
    deck.lifted = false;
  }

  private releaseAllHands(): void {
    this.grabs.clear();
    for (const d of [0, 1]) {
      this.decks[d].held = false;
      if (!this.sync[d]) this.decks[d].bend = 0;
      // A needle left in the air goes back where it was.
      this.dropAt[d] = null;
      this.decks[d].lifted = false;
    }
  }

  /** CUE as on a club deck: stopped, it marks this spot; playing, it goes back to the mark and stops. */
  private pressCue(d: number): void {
    const deck = this.decks[d];
    if (deck.motorOn) {
      deck.motorOn = false;
      deck.seek(deck.cuePoint);
    } else {
      deck.cuePoint = deck.seconds;
    }
  }

  private applyMix(): void {
    const x = crossfade(this.cross);
    this.decks[0].volume = faderGain(this.channel[0]) * x.a;
    this.decks[1].volume = faderGain(this.channel[1]) * x.b;
    for (const d of [0, 1]) this.decks[d].cue = this.phones[d];
  }

  // MARK: - Every frame

  private frame(time: number): void {
    const dt = this.lastTime > 0 ? Math.min(0.05, Math.max(0.001, (time - this.lastTime) / 1000)) : 1 / 60;
    this.lastTime = time;
    if (!this.L) this.build();
    if (this.L) {
      this.moveHands(dt);
      this.runSync();
      this.drivePartner(time / 1000);
      this.draw(dt);
      this.teach(dt, time / 1000);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // MARK: - A night

  /** The crowd answers the mixing, things go wrong at their moment, and the room shows its mood. */
  private playNight(dt: number, reading: MixReading, snapshots: DeckSnapshot[], lead: number): void {
    const night = this.night!, info = night.info, decks = this.decks;
    const now = this.lastTime / 1000;
    const heard = (s: DeckSnapshot) => s.playing && s.gain > 0.03;
    // The record on air is the one that is heard; with both heard, the louder one.
    const onAir = heard(snapshots[0]) ? (heard(snapshots[1]) ? lead : 0) : 1;
    // A scratched record: the needle falls back into the same groove, one turn of the platter
    // (1.8 s at 33 rpm), until it is picked up and moved on or the deck is stopped.
    const s = this.stuck;
    if (s) {
      const deck = decks[s.deck];
      if (deck.lifted || !deck.motorOn) this.stuck = null;
      else if (deck.seconds >= s.from + 1.8 || deck.seconds < s.from - 0.5) deck.seek(s.from);
    }
    // A slipping belt: the deck's speed drifts slowly around where its pitch fader says.
    const w = this.wander;
    if (w && !this.sync[w.deck]) {
      const t = now - w.since;
      const drift = 0.0035 * Math.sin(t * 2 * Math.PI / 23) + 0.002 * Math.sin(t * 2 * Math.PI / 7.3);
      decks[w.deck].pitch = (0.5 - this.pitchFader[w.deck]) * 2 * PITCH_RANGE + drift;
    }
    // Two records heard together in keys that fight (or pitched apart: no key lock).
    const a = decks[0].info?.camelot, b = decks[1].info?.camelot;
    const keyClash = info.judgeKeys && reading.state === "blend" && !!a && !!b && clash(a, decks[0].pitch, b, decks[1].pitch);
    const page = this.pageFacts();
    night.update({
      dt, state: reading.state, quality: reading.quality, bassClash: reading.bassClash, lead: onAir,
      onAirRecord: reading.state === "silence" ? null : decks[onAir].info?.id ?? null, channel: this.channel.slice(),
      jingles: page.jingles, beat: decks[onAir].beat, stuck: this.stuck ? heard(snapshots[this.stuck.deck]) : false,
      keyClash, onAirBPM: decks[onAir].bpm, lowOnAir: this.eq[onAir][0], stepOns: this.stepOns,
      partnerAnswers: this.partnerAnswers, partnerSteals: this.partnerSteals, partnerFights: this.partnerFights,
    });
    // Things go wrong: somebody kicks the cable and the record on air stops.
    if (night.takeMishap()) {
      switch (info.mishap) {
        case "needleSkip": { // the needle jumps a groove: the record lands a little ahead of the beat
          const deck = decks[onAir];
          deck.seek(deck.seconds + 0.4 * deck.grid.beatLength);
          break;
        }
        case "stuckGroove": this.stuck = { deck: onAir, from: decks[onAir].seconds }; break;
        case "powerCut": for (const deck of decks) deck.motorOn = false; break; // the power is back a moment later
        case "pitchWander": this.wander = { deck: onAir, since: now }; break;
        case "rainRush": break; // the rain only fills the tent; the music plays on
        case "partnerCrash": // his laptop dies: his deck stops and he leaves; both decks are yours now
          if (this.partnerDeck !== null) { decks[this.partnerDeck].motorOn = false; this.partnerDeck = null; }
          break;
        default: decks[onAir].motorOn = false;
      }
    }
    // The music steps back a little while Tó talks, as in the lessons.
    const wanted = night.speaking || page.jinglePlaying ? 0.5 : 1;
    const level = this.engine.masterVolume;
    if (Math.abs(wanted - level) > 0.002) this.engine.masterVolume = level + (wanted - level) * Math.min(1, dt * 6);
    this.showRoom(night.mood, dt);
  }

  // MARK: - Back to back

  /** Her deck is hers (PHONES aside: cueing her in your headphones is fine); the crossfader is
   * hers too while her record is on. */
  private partnerHolds(k: Kind): boolean {
    const h = this.partnerDeck;
    if (h === null) return false;
    switch (k.t) {
      case "cross": return this.channel[h] > 0.04;
      case "phones": case "cueMix": return false;
      default: return "d" in k && k.d === h;
    }
  }

  /** A hand on the other DJ's deck: refused and counted (the lesson says so). */
  private stepOn(): void {
    this.stepOns += 1;
    this.onStepOn();
  }

  /** The crate asks before putting a record on a deck: never on hers (that counts as a step-on). */
  refuseLoad(d: number): boolean {
    if (d !== this.partnerDeck) return false;
    this.stepOn();
    return true;
  }

  /** She plays her own deck (port of BoothScene.drivePartner). Your answer: once your record is up
   * she takes her low out at her next phrase, waits for yours, fades hers out and stops it. Her
   * answer (a night, records in her bag): after yours has been on alone a while she puts on one
   * that fits, at your tempo, on your beat and phrase, fader down, then brings it up. */
  private drivePartner(time: number): void {
    const h = this.partnerDeck;
    if (h === null) return;
    const decks = this.decks, her = decks[h], you = 1 - h;
    const beat = her.beat, yours = decks[you].beat;
    const vex = this.partnerStyle === "vex";
    const m = this.partnerMove;
    switch (m.t) {
      case "on":
        if (!m.armed) {
          if (this.channel[you] <= 0.04) this.partnerMove = { t: "on", armed: true };
        } else if (her.rate > 0.5 && decks[you].rate > 0.5 && this.channel[you] >= 0.8) {
          // Helena waits for her phrase and swaps the bass; VEX just pulls his fader.
          this.partnerMove = vex ? { t: "fading", from: beat, level: this.channel[h] } : { t: "waiting", phrase: Math.floor(beat / PHRASE) };
        }
        break;
      case "waiting":
        if (Math.floor(beat / PHRASE) > m.phrase) this.partnerMove = { t: "cutting", from: beat };
        break;
      case "cutting":
        this.setPartnerLow(0.5 * (1 - clamp01((beat - m.from) / 2)), h);
        if (beat - m.from >= 2) this.partnerMove = { t: "swapped", since: beat };
        break;
      case "swapped":
        if (this.eq[you][0] >= 0.45 || beat - m.since >= 8) this.partnerMove = { t: "fading", from: beat, level: this.channel[h] };
        break;
      case "fading": {
        const t = clamp01((beat - m.from) / (vex ? 4 : 16));
        this.setPartnerFader(m.level * (1 - t), h);
        if (t >= 1) {
          her.motorOn = false;
          this.partnerMove = { t: "out", since: time };
        }
        break;
      }
      case "out": {
        if (this.partnerBag.length === 0) break;
        // Your record has to be on air by itself for a while before she answers it.
        if (!(decks[you].rate > 0.5 && this.channel[you] >= 0.5)) {
          this.partnerMove = { t: "out", since: time };
        } else if (time - m.since >= (vex ? 20 : 35)) {
          const track = this.partnerPick();
          if (!track) break;
          this.partnerMove = { t: "loading" };
          this.partnerPlayed.add(track.id);
          this.loadRecord(h, track.id).then(() => this.partnerLanded(h)).catch(() => { this.partnerMove = { t: "out", since: time }; });
        }
        break;
      }
      case "loading":
        break;
      case "ready": {
        this.partnerMatchTempo(h);
        // Her fader is down: a small slip is put right by moving the needle (now and then, so a
        // move has landed before the next is measured).
        const slip = phaseOffset(yours, beat);
        if (time >= this.partnerTrimAt && her.rate > 0.9 && Math.abs(slip) > 0.01) {
          her.seek(her.grid.secondsAtBeat(beat + slip));
          this.partnerTrimAt = time + 0.3;
        }
        // Helena comes in at your next phrase; VEX as soon as his record is up to speed.
        const go = vex ? her.rate > 0.9 && time >= this.partnerTrimAt : Math.floor(yours / PHRASE) > m.phrase;
        if (go) this.partnerMove = { t: "rising", from: yours };
        break;
      }
      case "rising": {
        this.partnerMatchTempo(h);
        // Helena over a phrase; VEX slams it up in a bar, bass and all, then grabs your fader.
        const t = clamp01((yours - m.from) / (vex ? 4 : PHRASE));
        this.setPartnerFader(0.85 * t, h);
        if (t >= 1) {
          if (vex) { this.partnerSteals += 1; this.partnerMove = { t: "stealing", from: beat, level: this.channel[you] }; }
          else this.partnerMove = { t: "bassing", from: beat };
        }
        break;
      }
      case "bassing":
        this.partnerMatchTempo(h);
        this.setPartnerLow(0.5 * clamp01((beat - m.from) / 2), h);
        if (beat - m.from >= 2) this.partnerMove = { t: "on", armed: false };
        break;
      case "stealing":
        this.partnerMatchTempo(h);
        this.setPartnerFader(m.level * (1 - clamp01(beat - m.from)), you);
        if (beat - m.from >= 1) this.partnerMove = { t: "holding", until: time + 8, fought: false };
        break;
      case "holding":
        if (!m.fought && this.channel[you] > 0.5) {
          this.partnerFights += 1;
          this.partnerMove = { t: "holding", until: m.until, fought: true };
        } else if (time >= m.until) {
          // After a fight your record is still up: he only hands over once it has been down.
          this.partnerMove = { t: "on", armed: !m.fought };
        }
        break;
    }
  }

  /** Her answer is on her deck: at your tempo, a phrase past her intro where yours is in its
   * phrase (plus the 0.05 s the platter takes to come up to speed), fader down, low out. */
  private partnerLanded(h: number): void {
    if (this.partnerDeck !== h) return;
    const her = this.decks[h], yours = this.decks[1 - h].beat;
    const vex = this.partnerStyle === "vex";
    this.setPartnerLow(vex ? 0.5 : 0, h);
    this.setPartnerFader(0, h);
    this.sync[h] = false;
    this.partnerMatchTempo(h);
    // (VEX lands on your beat but half a phrase off: his set, his timing.)
    const into = ((yours % PHRASE) + PHRASE) % PHRASE;
    her.seek(her.grid.secondsAtBeat(PHRASE + into + (vex ? 16 : 0) + 0.05 * her.bpm / 60));
    her.motorOn = true;
    this.partnerTrimAt = this.lastTime / 1000 + 0.3;
    this.partnerAnswers += 1;
    this.partnerMove = { t: "ready", phrase: Math.floor(yours / PHRASE) };
  }

  /** She rides her pitch fader to your tempo (with your SYNC on, yours follows hers: no change). */
  private partnerMatchTempo(h: number): void {
    const her = this.decks[h], you = this.decks[1 - h];
    if (!her.isLoaded || !you.isLoaded) return;
    const p = Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, pitchToPlay(her.grid.bpm, you.bpm)));
    if (Math.abs(p - her.pitch) <= 1e-7) return;
    her.pitch = p;
    this.pitchFader[h] = 0.5 - p / (2 * PITCH_RANGE);
  }

  /** Her answer: a record from her bag she has not played, in a key that fits yours and close to
   * your tempo (no key lock: her pitch fader moves its key too); failing that, any that fits.
   * VEX: the next record on his list, whatever you play. */
  private partnerPick(): TrackInfo | null {
    const h = this.partnerDeck;
    if (h === null) return null;
    const find = (id: string) => this.tracks.find((t) => t.id === id) ?? null;
    if (this.partnerStyle === "vex") {
      const id = this.partnerBag.find((x) => !this.partnerPlayed.has(x));
      return id ? find(id) : null;
    }
    const yours = this.decks[1 - h].info, tempo = this.decks[1 - h].bpm;
    const open = this.partnerBag.filter((x) => !this.partnerPlayed.has(x) && x !== yours?.id).map(find).filter((t): t is TrackInfo => t !== null);
    const fits = open.filter((t) => compatible(t.camelot, yours?.camelot ?? t.camelot));
    return fits.find((t) => Math.abs(t.bpm - tempo) <= 2.1) ?? fits[0] ?? null;
  }

  private setPartnerLow(v: number, h: number): void {
    this.eq[h][0] = v;
    this.decks[h].setEQ(0, v);
  }

  private setPartnerFader(v: number, h: number): void {
    this.channel[h] = v;
    this.applyMix();
  }

  /** Feeds the lesson what the decks are doing, points at the control it names, and turns the
   * music down a little while the coach talks. */
  private teach(dt: number, time: number): void {
    const lesson = this.lesson;
    if (!lesson) return;
    if (!this.lessonReady) { this.lessonReady = true; lesson.begin(); }
    const decks = this.decks;
    // In a lesson a record that runs out starts again, so nobody gets stuck waiting.
    decks.forEach((deck, d) => {
      // Back to back: her record never jumps while yours is in the room with it.
      if (d === this.partnerDeck && this.channel[1 - d] > 0.04) return;
      if (deck.motorOn && deck.progress > 0.985) deck.seek(deck.cuePoint < deck.duration * 0.9 ? deck.cuePoint : deck.grid.firstBeat);
    });
    const page = this.pageFacts();
    lesson.update({
      motorOn: decks.map((x) => x.motorOn),
      turning: decks.map((x) => x.rate > 0.5),
      beat: decks.map((x) => x.beat),
      cross: this.cross,
      channel: this.channel.slice(),
      eq: this.eq.map((x) => x.slice()),
      phonesOn: this.engine.phones !== "off",
      phones: this.phones.slice(),
      cueMix: this.engine.cueMix,
      bpm: decks.map((x) => x.bpm),
      phase: phaseOffset(decks[0].beat, decks[1].beat),
      records: decks.map((x) => x.info?.id ?? null),
      sync: this.sync.slice(),
      blend: this.lastReading?.state === "blend",
      bassClash: this.lastReading?.bassClash ?? false,
      jingles: page.jingles,
      time,
      filter: this.filterSetting.slice(),
      pattern: page.pattern,
      page: page.page,
      cuts: page.cuts,
      stepOns: this.stepOns,
    });
    // A step that makes the needle skip: it lands 0.4 beat on, the kicks fall apart.
    const skip = lesson.takeSkip();
    if (skip !== null && decks[skip]?.isLoaded) decks[skip].seek(decks[skip].seconds + 0.4 * decks[skip].grid.beatLength);
    const wanted = lesson.speaking || page.jinglePlaying ? 0.5 : 1;
    const now = this.engine.masterVolume;
    if (Math.abs(wanted - now) > 0.002) this.engine.masterVolume = now + (wanted - now) * Math.min(1, dt * 6);
    // The ring round the control the coach means.
    const target = lesson.target;
    const kind = target ? kindFor(target) : null;
    const hit = kind ? this.hits.find((h) => keyOf(h.kind) === keyOf(kind)) : null;
    if (hit) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 6);
      ctx.shadowColor = rgba(Palette.orange);
      ctx.shadowBlur = 8;
      roundRect(ctx, { x: hit.rect.x - 2, y: hit.rect.y - 2, w: hit.rect.w + 4, h: hit.rect.h + 4 }, 9, null, rgba(Palette.orange), 2.5);
      ctx.restore();
    }
  }

  private moveHands(dt: number): void {
    for (const d of [0, 1]) {
      const deck = this.decks[d];
      if (deck.held) {
        // Clockwise on screen is forwards, and angles grow anticlockwise, hence the minus.
        const speed = -this.handTravel[d] / dt / TURN;
        this.handTravel[d] = 0;
        this.handSpeed[d] = this.handSpeed[d] * 0.35 + speed * 0.65;
        deck.handRate = this.handSpeed[d];
      }
      if (this.holds("rim", d) && !this.sync[d]) {
        const speed = -this.rimTravel[d] / dt / TURN;
        this.rimTravel[d] = 0;
        this.rimSpeed[d] = this.rimSpeed[d] * 0.7 + speed * 0.3;
        deck.bend = Math.max(-0.08, Math.min(0.08, this.rimSpeed[d] * 0.06));
      }
    }
  }

  /** SYNC: copy the other deck's tempo, then lean on the record until the beats line up. */
  private runSync(): void {
    for (const d of [0, 1]) {
      if (!this.sync[d]) continue;
      const other = this.decks[1 - d], deck = this.decks[d];
      if (!deck.isLoaded || !other.isLoaded) continue;
      const p = Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, pitchToPlay(deck.grid.bpm, other.bpm)));
      if (Math.abs(p - deck.pitch) > 1e-7) {
        deck.pitch = p;
        this.pitchFader[d] = 0.5 - p / (2 * PITCH_RANGE);
      }
      // Back to back: never chase the partner's deck while her fader is down (her silent spin-up
      // would pull your record on air).
      const partnerSilent = 1 - d === this.partnerDeck && this.channel[1 - d] <= 0.04;
      if (deck.motorOn && !deck.held && !deck.lifted && deck.rate > 0.5 && other.rate > 0.5 && !partnerSilent) {
        const behind = phaseOffset(other.beat, deck.beat);
        deck.bend = Math.max(-0.06, Math.min(0.06, behind * 0.8));
      } else if (deck.bend !== 0) {
        deck.bend = 0;
      }
    }
  }

  private draw(dt: number): void {
    const L = this.L!, ctx = this.ctx, u = L.u;
    ctx.setTransform(this.dpr, 0, 0, -this.dpr, 0, L.H * this.dpr); // y up, as in SpriteKit
    ctx.clearRect(0, 0, L.W, L.H);

    // What the room hears.
    const snapshots: DeckSnapshot[] = [];
    const fade = crossfade(this.cross);
    for (const d of [0, 1]) {
      const deck = this.decks[d];
      const heardGain = deck.lifted ? 0 : faderGain(this.channel[d]) * (d === 0 ? fade.a : fade.b);
      snapshots.push({ playing: Math.abs(deck.rate) > 0.3, gain: heardGain, bpm: deck.bpm, beat: deck.beat, low: this.eq[d][0] });
    }
    const reading = readMix(snapshots[0], snapshots[1]);
    this.lastReading = reading;

    // The room: darker when nothing plays, a warm pulse on every beat of the loudest deck.
    const lead = snapshots[0].gain >= snapshots[1].gain ? 0 : 1;
    const heard = snapshots[lead].playing && snapshots[lead].gain > 0.03;
    this.roomShade += ((heard ? 0.06 : 0.45) - this.roomShade) * Math.min(1, dt * 3);
    ctx.fillStyle = `rgba(0,0,0,${this.roomShade})`;
    ctx.fillRect(0, L.gearTop, L.W, L.H - L.gearTop);
    if (heard) {
      const leadDeck = this.decks[lead];
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(Palette.orange, 0.12 * Math.exp(-leadDeck.grid.phase(leadDeck.seconds) * 5));
      ctx.fillRect(0, L.gearTop, L.W, L.H - L.gearTop);
      ctx.restore();
    }
    if (this.night) this.playNight(dt, reading, snapshots, lead);
    // Otherwise the friends dance while there is music and stop where they are when it goes quiet.
    else this.showRoom(heard ? 2 : -1, dt);
    // The desk the gear stands on hides the lower part of the picture.
    ctx.fillStyle = rgba(Palette.night);
    ctx.fillRect(0, 0, L.W, L.gearTop);
    ctx.fillStyle = rgba(Palette.teal, 0.5);
    ctx.fillRect(0, L.gearTop - 0.5, L.W, 1);

    for (const d of [0, 1]) this.drawDeck(d, dt);
    this.drawMixer(reading, snapshots);

    if (!this.engine.running) {
      label(ctx, `AUDIO OFF  ${this.engine.lastError ?? ""}`, L.left + 44, L.H - 14, { size: 10 * u, color: rgba(Palette.red), align: "left" });
    }
  }

  private drawDeck(d: number, dt: number): void {
    const L = this.L!, ctx = this.ctx, u = L.u, deck = this.decks[d], tint = TINTS[d];
    const rect = L.deck[d];
    roundRect(ctx, rect, 10 * u, rgba(Palette.panel), EDGE);
    const seconds = deck.seconds;

    // Platter and record (it turns with the needle's position), the light on the grooves, the arm.
    const c = L.centre[d];
    picture(ctx, this.platterImg[d], c.x, c.y, L.outer * 2, L.outer * 2, -seconds * TURN);
    if (this.sheenImg) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      picture(ctx, this.sheenImg, c.x, c.y, L.r * 2, L.r * 2);
      ctx.restore();
    }
    tonearm(ctx, L.pivot[d].x, L.pivot[d].y, L.armLength, u, this.armAngle(d), deck.lifted ? 1.05 : 1);

    // Top row: title, time left, four lamps that count the bar.
    const info = deck.info;
    const titleRoom = L.timeX[d] - 34 * u - L.titleX[d];
    label(ctx, info ? `${info.artist.toUpperCase()}  ·  ${info.title.toUpperCase()}` : "NO RECORD", L.titleX[d], L.rowY[d],
          { size: 8.5 * u, color: rgba(Palette.ink), align: "left", maxWidth: titleRoom });
    const drop = this.dropAt[d];
    const timeText = drop !== null ? clock(drop * deck.duration) : deck.isLoaded ? "-" + clock(Math.max(0, deck.duration - seconds)) : "";
    label(ctx, timeText, L.timeX[d], L.rowY[d], { size: 8.5 * u, color: drop !== null ? rgba(Palette.ink) : DIM, mono: true, align: "right" });
    const moving = Math.abs(deck.rate) > 0.3;
    const beatNow = deck.grid.beatInBar(seconds);
    const flash = 1 - deck.grid.phase(seconds);
    for (let i = 0; i < 4; i++) {
      circle(ctx, L.dotX[d][i], L.rowY[d], 2.6 * u, rgba(tint, moving && i === beatNow ? 0.35 + 0.65 * flash : 0.15));
    }

    this.drawWave(d);

    // Buttons.
    const cueLit = !deck.motorOn && Math.abs(seconds - deck.cuePoint) < 0.02;
    button(ctx, L.buttonX[d][0], L.buttonY[d], L.buttonW, L.buttonH, "CUE", Palette.orange, cueLit);
    button(ctx, L.buttonX[d][1], L.buttonY[d], L.buttonW, L.buttonH, "PLAY", tint, deck.motorOn);
    button(ctx, L.buttonX[d][2], L.buttonY[d], L.buttonW, L.buttonH, "SYNC", Palette.ink, this.sync[d], this.syncAllowed ? 1 : 0.25);

    // Pitch fader: up is slower.
    fader(ctx, L.pitchX[d], L.pitchY[d], { travel: L.pitchTravel, vertical: true, capW: 26 * u, capH: 13 * u, tint, centreMark: true, value: this.pitchFader[d] });
    label(ctx, "−", L.pitchX[d], L.pitchY[d] + L.pitchTravel / 2 + 20 * u, { size: 12 * u });
    const pct = deck.pitch * 100;
    label(ctx, `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`, L.pitchX[d] - 6 * u, rect.y + 13 * u, { size: 10 * u, color: rgba(tint), mono: true });

    this.meterLevel[d] = Math.max(deck.takePeak(), this.meterLevel[d] - dt * 1.6);
  }

  /** The record at a glance: loud and quiet stretches, a line where the needle is, an orange mark
   * at the cue point, and where a lifted needle will land. */
  private drawWave(d: number): void {
    const L = this.L!, ctx = this.ctx, deck = this.decks[d], r = L.wave[d];
    roundRect(ctx, { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, 3, rgba(Palette.slot), EDGE);
    const id = `${deck.info?.id ?? ""}:${deck.duration}:${r.w}`;
    if (this.waveFor[d] !== id) {
      this.waveFor[d] = id;
      const ticks: number[] = [];
      if (deck.duration > 0) {
        for (let beat = 0; ; beat += 64) { // sixteen bars
          const at = deck.grid.secondsAtBeat(beat) / deck.duration;
          if (at >= 1) break;
          ticks.push(at);
        }
      }
      this.waveImg[d] = wavePicture(deck.overview, r.w, r.h, TINTS[d], ticks, this.dpr);
    }
    const img = this.waveImg[d];
    if (img) picture(ctx, img, r.x + r.w / 2, r.y + r.h / 2, r.w, r.h);
    const at = r.x + r.w * deck.progress;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(r.x, r.y, Math.max(0.5, at - r.x), r.h);
    if (deck.isLoaded) {
      ctx.fillStyle = rgba(Palette.orange);
      ctx.fillRect(r.x + r.w * (deck.duration > 0 ? deck.cuePoint / deck.duration : 0) - 0.75, r.y, 1.5, r.h);
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(at - 0.75, r.y - 2, 1.5, r.h + 4);
    const drop = this.dropAt[d];
    if (drop !== null) {
      ctx.fillStyle = rgba(TINTS[d]);
      ctx.fillRect(r.x + r.w * drop - 1.25, r.y - 3, 2.5, r.h + 6);
    }
  }

  private drawMixer(reading: MixReading, snapshots: DeckSnapshot[]): void {
    const L = this.L!, ctx = this.ctx, u = L.u, rect = L.mixer, mid = rect.x + rect.w / 2;
    roundRect(ctx, rect, 10 * u, rgba(Palette.panel), EDGE);

    // Top: both tempos, the verdict, and how far apart the beats are.
    if (!this.hideNumbers) {
      for (const d of [0, 1]) {
        label(ctx, this.decks[d].isLoaded ? this.decks[d].bpm.toFixed(1) : "---.-", L.bpmX[d], L.topY, { size: 14 * u, color: rgba(TINTS[d]), mono: true });
      }
      const colour = reading.state === "blend"
        ? (reading.quality > 0.85 ? rgba(Palette.teal) : reading.quality > 0.3 ? rgba(Palette.orange) : rgba(Palette.red))
        : DIM;
      label(ctx, verdict(reading), mid, L.topY + 2 * u, { size: 11.5 * u, color: colour });
      roundRect(ctx, centred(mid, L.phaseY, L.phaseWidth, 3 * u), 1.5 * u, rgba(Palette.slot), EDGE);
      ctx.fillStyle = DIM;
      ctx.fillRect(mid - 0.75, L.phaseY - 5 * u, 1.5, 10 * u);
      // The dot shows where deck B's beat falls against deck A's, whenever both records turn.
      const bothTurn = snapshots[0].playing && snapshots[1].playing;
      const offset = bothTurn ? phaseOffset(snapshots[0].beat, snapshots[1].beat) : 0;
      circle(ctx, mid - offset * L.phaseWidth, L.phaseY, 4 * u,
             bothTurn ? (Math.abs(offset) < 0.03 ? rgba(Palette.teal) : rgba(Palette.orange)) : DIM);
    }

    // Channel strips: EQ knobs on the outside, fader inside, meters in the middle.
    const names = ["LOW", "MID", "HI"];
    for (const d of [0, 1]) {
      for (const band of [0, 1, 2]) knob(ctx, L.knobX[d], L.knobY[band], 13 * u, TINTS[d], names[band], this.eq[d][band]);
      fader(ctx, L.channelX[d], L.channelY, { travel: L.channelTravel, vertical: true, capW: 24 * u, capH: 13 * u, tint: TINTS[d], value: this.channel[d], alpha: d === this.deadFader ? 0.4 : 1 });
      button(ctx, L.channelX[d], L.phonesY, 36 * u, 15 * u, "PHONES", Palette.orange, this.phones[d]);
      meter(ctx, L.meterX[d], L.meterY, 7 * u, 96 * u, Math.min(1, this.meterLevel[d] * 1.15));
      if (this.hasFilter) knob(ctx, L.knobX[d], L.filterY, 10 * u, TINTS[d], "FILTER", this.filterSetting[d]);
    }
    // Cue mix, between the PHONES buttons: left = only the cued record, right = only the room.
    knob(ctx, mid, L.phonesY, 9 * u, Palette.orange, "", this.engine.cueMix);
    fader(ctx, mid, L.crossY, { travel: L.crossTravel, vertical: false, capW: 14 * u, capH: 24 * u, tint: Palette.teal, centreMark: true, value: this.cross });
  }
}

/** The control a lesson's target names (the crate and the jingle are page buttons: no ring). */
function kindFor(t: LessonTarget): Kind | null {
  switch (t.type) {
    case "play": case "cue": case "channel": case "phones": case "filter": case "pitch": case "sync": return { t: t.type, d: t.deck };
    case "record": return { t: "platter", d: t.deck };
    case "eq": return { t: "eq", d: t.deck, band: t.band };
    case "crossfader": return { t: "cross" };
    case "cueMixKnob": return { t: "cueMix" };
    default: return null;
  }
}

/** The shortest turn from angle `a` to angle `b`. */
function turned(a: number, b: number): number {
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function clock(seconds: number): string {
  const whole = Math.trunc(Math.max(0, seconds));
  return `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
