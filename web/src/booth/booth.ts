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
import { liveGeometry, liveTouch } from "./live-geometry.ts";
import type { LiveGeometry } from "./live-geometry.ts";
import { LiveRenderer } from "./live-draw.ts";
import type { LiveView } from "./live-draw.ts";
import type { LessonDesk, LessonTarget } from "../game/content.ts";
import type { TrackInfo } from "../core/beatgrid.ts";
import { clash, compatible } from "../core/harmony.ts";
import type { NightRunner } from "../game/night.ts";
import type { NightInfo } from "../game/content.ts";
import type { LessonRunner } from "../game/lesson.ts";
import { PHRASE } from "../game/lesson.ts";
import { FX_DEFAULTS, FX_DIVISIONS, FX_KNOBS, FX_TYPES, PHONES_UNITY, ROOM_UNITY, beatDelaySeconds, fxTempoKnob, stepIndex, stepValue, trimDecibels } from "../audio/fx.ts";

export type Kind =
  | { t: "jog"; d: number }
  | { t: "platter"; d: number } | { t: "rim"; d: number } | { t: "pitch"; d: number } | { t: "channel"; d: number }
  | { t: "cross" } | { t: "eq"; d: number; band: number } | { t: "play"; d: number } | { t: "cue"; d: number }
  | { t: "sync"; d: number } | { t: "needle"; d: number } | { t: "wave"; d: number } | { t: "phones"; d: number }
  | { t: "cueMix" } | { t: "phonesLevel" } | { t: "filter"; d: number }
  // LIVE only: the channel's gain (TRIM) and the master volume.
  | { t: "trim"; d: number } | { t: "master" }
  // LIVE only: a pad under the deck (`band` = which one), a loop control (`band` = LOOP_ACTIONS), the zoom buttons (band +1 in, -1 out), and the zoomable waveform.
  | { t: "pad"; d: number; band: number } | { t: "loop"; d: number; band: number } | { t: "zoom"; d: number; band: number } | { t: "zwave"; d: number }
  // The effect unit (free play): `d` is the effect or the note value, -1 = the next one.
  | { t: "fxOn" } | { t: "fxAmount" } | { t: "fxType"; d: number } | { t: "fxDiv"; d: number } | { t: "fxParam"; d: number };

export const keyOf = (k: Kind): string => `${k.t}:${"d" in k ? k.d : ""}:${"band" in k ? k.band : ""}`;

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
/** The cue mix and headphones level knobs sit this far (in units) either side of the mixer's middle. */
const KNOB_GAP = 11;
/** What the loop buttons do (`Kind.band` of a "loop"). */
export const LOOP_ACTIONS = ["cues", "loops", "in", "out", "half", "double", "toggle", "auto4", "auto8", "auto16", "auto32"] as const;
/** How many seconds the big waveform shows at each zoom level (0 = the whole record). */
export const ZOOM_SECONDS = [0, 60, 30, 15, 8, 4, 2];
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
  phonesY: number; meterX: number[]; meterY: number; meterH: number;
  /** The gain knobs above the faders (free play only): their height, else null. */
  trimY: number | null;
  /** The effect bar under the gear (free play only). */
  fx: { panel: Rect; cy: number; typeX: number[]; divX: number[]; knobX: number; onX: number } | null;
  /** The LIVE booth's geometry (null in the game's booth), and how far a horizontal headphone fader runs. */
  live: LiveGeometry | null; sliderTravel: number; fxTravel: number;
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
  /** The gain knob per channel (0.5 = 0 dB); it only works in free play (a lesson or a night is the iPhone's desk). */
  private trimSetting = [0.5, 0.5];
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
  /** MIDI learn: a click on a control picks it instead of using it. */
  learnPick: ((k: Kind) => void) | null = null;
  // Keys and controllers: a nudge held down (-1, 0, 1) and a jog wheel's push, per deck.
  private keyNudge = [0, 0];
  private jogSpeed = [0, 0];
  private nudging = [false, false];
  // CUE: the button is down, and whether this hold is playing the record (a preview that goes back
  // to the mark when CUE is let go).
  private cueDown = [false, false];
  private previewing = [false, false];
  /** The effect unit: which effect, which note value, how much, on or off. Off at every start. */
  fx = { type: 0, div: 1, amount: 0.5, on: false, params: FX_DEFAULTS[0].slice() };
  /** The four knobs of every effect, kept as you left them (null: the effect's defaults). */
  private fxSaved: (number[] | null)[] = FX_TYPES.map(() => null);
  private fxSent = 0;

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
  /** A cover picture for the label of the record on a deck (a track of your library), and which one is drawn into `platterImg` now. */
  private labelArt: ({ id: string; img: CanvasImageSource } | null)[] = [null, null];
  private labelShown: (string | null)[] = [null, null];
  private waveImg: (HTMLCanvasElement | null)[] = [null, null];
  private waveFor: string[] = ["", ""];
  private meterLevel = [0, 0];
  private roomShade = 0.45;
  private room = "bedroom";
  private roomVideos: (HTMLVideoElement | null)[] = [null, null, null, null];
  private roomMissing = new Set<number>();
  private roomMood = -1;
  /** The record room is up over the room (free play): its clips are not played (nobody sees them). */
  private roomHidden = false;
  /** "game": the iPhone's desk (lessons, nights, free play). "live": the DJ's booth with its own layout. */
  mode: "game" | "live" = "game";
  private live: LiveGeometry | null = null;
  private readonly liveRenderer = new LiveRenderer();
  /** LIVE's master knob while the game's booth is showing. */
  private liveMaster = ROOM_UNITY;
  /** What the pads under each deck are: the hot cues, or the saved loops. */
  private padMode: ("cues" | "loops")[] = ["cues", "cues"];
  /** The zoom of each deck's big waveform (an index into ZOOM_SECONDS), kept between visits. */
  private zoomLevel: number[] = (() => { try { const z = JSON.parse(localStorage.getItem("headliner.zoom") ?? "[]"); return [0, 1].map((d) => (Number.isInteger(z[d]) && z[d] >= 0 && z[d] < ZOOM_SECONDS.length ? z[d] : 3)); } catch { return [3, 3]; } })();
  private lastWheelZoom = 0;
  /** A message over a deck (a record cannot be changed while it plays), and until when. */
  private alerts: ({ text: string; until: number } | null)[] = [null, null];
  private lastTime = 0;
  /** What the room heard this frame. */
  lastReading: MixReading | null = null;

  constructor(canvas: HTMLCanvasElement, roomLayer: HTMLElement, engine: DeckEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.roomLayer = roomLayer;
    this.engine = engine;
    for (const d of [0, 1]) this.decks[d].volume = faderGain(this.channel[d]) * (d === 0 ? crossfade(this.cross).a : crossfade(this.cross).b);
    try {
      const saved = JSON.parse(localStorage.getItem("headliner.fx") ?? "{}") as { type?: number; div?: number; amount?: number; knobs?: unknown };
      if (saved.type !== undefined && saved.type >= 0 && saved.type < FX_TYPES.length) this.fx.type = Math.trunc(saved.type);
      if (saved.amount !== undefined && saved.amount >= 0 && saved.amount <= 1) this.fx.amount = saved.amount;
      if (Array.isArray(saved.knobs)) {
        FX_TYPES.forEach((_, t) => {
          const k = (saved.knobs as unknown[])[t];
          if (Array.isArray(k) && k.length === 4 && k.every((x) => typeof x === "number" && x >= 0 && x <= 1)) this.fxSaved[t] = k as number[];
        });
      } else if (saved.div !== undefined && saved.div >= 0 && saved.div < FX_DIVISIONS.length) {
        this.fxSaved[0] = [stepValue(Math.trunc(saved.div), FX_DIVISIONS.length), ...FX_DEFAULTS[0].slice(1)]; // an older save: only the note value
      }
    } catch { /* nothing saved */ }
    this.fx.params = (this.fxSaved[this.fx.type] ?? FX_DEFAULTS[this.fx.type]).slice();
    engine.fxType = this.fx.type;
    engine.fxAmount = this.fx.amount;
    engine.fxOn = false;
    this.pushFxKnobs();
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => { this.move(e); this.hoverTitle(e); });
    canvas.addEventListener("pointerleave", () => this.tip(null));
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
    this.cueDown = [false, false];
    this.previewing = [false, false];
    this.fx.on = false; // a lesson or a night is the iPhone's desk: no effect unit
    this.engine.fxOn = false;
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
    if (this.mode === "live") { this.buildLive(W, H); return; }
    this.live = null;
    const left = 10, right = 10, bottom = 8;
    const gx0 = left;
    const gw = W - left - right;
    // Free play has the effect bar as a third row under the decks and the mixer (36 units and a gap).
    const fxBar = this.lesson === null && this.night === null;
    const BAR = 36, BAR_GAP = 6;
    // The gear is drawn in units `u` (the iPhone's: 210 high, 816 wide with a mixer 224 wide): as big
    // as the height (at most the lower 58 %) and the width both allow. On a tall screen (fullscreen
    // 16:9) the width is the limit; the gear then sits at the bottom and the room takes the rest.
    const u = Math.min((H * 0.58 - 6 - bottom) / (210 + (fxBar ? BAR + BAR_GAP : 0)), gw / 816);
    const gh = 210 * u;
    const gy0 = bottom + (fxBar ? (BAR + BAR_GAP) * u : 0);
    const gearTop = gy0 + gh + 6;
    // The overlays (lesson, night, studio grid, record room) are as high as the room above the gear: 100vh minus this.
    document.documentElement.style.setProperty("--gear-h", `${gearTop}px`);
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
    // Free play has a gain knob above each fader: the faders are a little shorter to make room.
    const trimY = fxBar ? my + 163 * u : null;
    const channelTravel = (fxBar ? 72 : 88) * u, channelY = my + (fxBar ? 102 : 110) * u;
    const phonesY = my + 49 * u;
    const crossTravel = Math.min(112 * u, mw * 0.55);
    const crossY = my + 24 * u, filterY = my + 27 * u;
    for (const d of [0, 1]) {
      for (const band of [0, 1, 2]) first({ t: "eq", d, band }, centred(knobX[d], knobY[band], 42 * u, 40 * u));
      first({ t: "channel", d }, centred(channelX[d], channelY, 40 * u, channelTravel + 28 * u));
      first({ t: "phones", d }, centred(channelX[d], phonesY, 44 * u, 24 * u));
      if (trimY !== null) first({ t: "trim", d }, centred(channelX[d], trimY, 30 * u, 30 * u));
    }
    // The cue mix and the headphones level knobs side by side between the PHONES buttons.
    first({ t: "cueMix" }, centred(mid - KNOB_GAP * u, phonesY, 22 * u, 26 * u));
    first({ t: "phonesLevel" }, centred(mid + KNOB_GAP * u, phonesY, 22 * u, 26 * u));
    first({ t: "cross" }, centred(mid, crossY, crossTravel + 36 * u, 40 * u));
    // Filter knobs last, so they win the little overlap with the crossfader's touch area.
    if (this.hasFilter) for (const d of [0, 1]) first({ t: "filter", d }, centred(knobX[d], filterY, 30 * u, 30 * u));

    let fx: Layout["fx"] = null;
    if (fxBar) {
      // Centred under the mixer: effects, note values, amount, ON.
      const px = mid - 212 * u, cy = bottom + (BAR / 2) * u;
      fx = { panel: { x: px, y: bottom, w: 424 * u, h: BAR * u }, cy,
             typeX: [0, 1, 2].map((i) => px + (37 + i * 54) * u), divX: [0, 1, 2, 3].map((i) => px + (200 + i * 36) * u),
             knobX: px + 348 * u, onX: px + 392 * u };
      fx.typeX.forEach((x, i) => first({ t: "fxType", d: i }, centred(x, cy, 54 * u, 30 * u)));
      fx.divX.forEach((x, i) => first({ t: "fxDiv", d: i }, centred(x, cy, 36 * u, 30 * u)));
      first({ t: "fxAmount" }, centred(fx.knobX, cy, 26 * u, 30 * u));
      first({ t: "fxOn" }, centred(fx.onX, cy, 44 * u, 30 * u));
    }

    this.hits = hits;
    this.L = {
      W, H, u, gearTop, left, deck, mixer, outer, r, centre, pivot, armLength, armPivotAngle,
      needleReach: Math.max(20, 20 * u), rowY, titleX, timeX, dotX, wave, buttonW, buttonH, buttonX, buttonY,
      pitchX, pitchY, pitchTravel, bpmX: [mx + 32 * u, mx + mw - 32 * u], topY: my + mh - 15 * u, phaseY: my + mh - 30 * u,
      phaseWidth: Math.min(104 * u, mw * 0.5), knobX, knobY, knobTravel: 90 * u, channelX, channelY, channelTravel,
      phonesY, meterX: [mid - 9 * u, mid + 9 * u], meterY: channelY, meterH: channelTravel + 8 * u, trimY, fx, live: null, sliderTravel: 0, fxTravel: 0, crossY, crossTravel, filterY,
    };
    this.platterImg = TINTS.map((t) => platterPicture(r, t, this.dpr));
    this.labelShown = [null, null]; // the next frame draws the covers again
    this.sheenImg = sheenPicture(r, this.dpr);
    this.waveFor = ["", ""];
    this.placeRoom();
  }

  /** The LIVE booth: free play's own layout. Everything is registered with the same pointer code as the game's gear. */
  private buildLive(W: number, H: number): void {
    const g = liveGeometry(W, H), u = g.u, T = liveTouch(g), M = g.mixer;
    this.live = g;
    this.liveRenderer.reset();
    const hits: { kind: Kind; rect: Rect }[] = [];
    const first = (kind: Kind, rect: Rect) => hits.unshift({ kind, rect });
    const outer = g.deck[0].platter.outer, r = outer / 1.07;
    const centre: Point[] = [], pivot: Point[] = [], rowY: number[] = [], titleX: number[] = [], timeX: number[] = [];
    const dotX: number[][] = [], wave: Rect[] = [], buttonX: number[][] = [], buttonY: number[] = [], pitchX: number[] = [], pitchY: number[] = [];
    let armLength = 100, armPivotAngle = 0;
    for (const d of [0, 1]) {
      const G = g.deck[d], c = G.platter.c, B = G.buttons;
      centre.push(c);
      hits.push({ kind: { t: "platter", d }, rect: centred(c.x, c.y, outer * 2.16, outer * 2.16) });
      const p = { x: c.x + r * 0.98, y: c.y + r * 0.86 };
      pivot.push(p);
      armLength = Math.hypot(p.x - c.x, p.y - c.y);
      armPivotAngle = Math.atan2(c.y - p.y, c.x - p.x);
      rowY.push(G.title.y); titleX.push(G.title.x); timeX.push(G.time.x); dotX.push(G.lamps.map((l) => l.x));
      wave.push(G.wave);
      // The strip of the whole record drops the needle; the big waveform scrolls with a drag; the zoom buttons sit over its corner.
      first({ t: "wave", d }, { x: G.wave.x - 4, y: G.wave.y - 4, w: G.wave.w + 8, h: G.wave.h + 8 });
      first({ t: "zwave", d }, G.zoom);
      first({ t: "zoom", d, band: -1 }, G.zoomOut);
      first({ t: "zoom", d, band: 1 }, G.zoomIn);
      const LU = G.loopUi;
      [...G.modeTabs, ...LU.io, ...LU.scale, LU.toggle, ...LU.auto].forEach((r, i) => first({ t: "loop", d, band: i }, r)); // the eleven controls come in the order of LOOP_ACTIONS
      G.pads.forEach((r, i) => first({ t: "pad", d, band: i }, r));
      buttonY.push(B.cue.y); buttonX.push([B.cue.x, B.play.x, B.sync.x]);
      ([{ t: "cue", d }, { t: "play", d }, { t: "sync", d }] as Kind[]).forEach((k, i) => first(k, centred([B.cue, B.play, B.sync][i].x, B.cue.y, B.w + 6, B.h + 8)));
      pitchX.push(G.pitch.x); pitchY.push(G.pitch.y);
      first({ t: "pitch", d }, centred(G.pitch.x, G.pitch.y, 46 * u, G.pitch.travel + 28 * u));
    }
    for (const d of [0, 1]) {
      // The strip, top to bottom: TRIM, HI, MID, LOW, FILTER.
      first({ t: "trim", d }, T.eq[d][0]);
      first({ t: "eq", d, band: 2 }, T.eq[d][1]);
      first({ t: "eq", d, band: 1 }, T.eq[d][2]);
      first({ t: "eq", d, band: 0 }, T.eq[d][3]);
      first({ t: "filter", d }, T.eq[d][4]);
      first({ t: "channel", d }, T.channel[d]);
      first({ t: "phones", d }, T.cue[d]);
    }
    first({ t: "cross" }, T.cross);
    first({ t: "master" }, T.master);
    first({ t: "cueMix" }, T.mix);
    first({ t: "phonesLevel" }, T.level);
    // The effect controller: the name (the left third goes to the effect before, the rest to the next), ON, the LEVEL fader, DIV.
    const F = g.fx, lvl = F.level;
    first({ t: "fxType", d: -1 }, F.name);
    first({ t: "fxType", d: -2 }, { x: F.name.x, y: F.name.y, w: F.name.w * 0.3, h: F.name.h });
    first({ t: "fxOn" }, F.on);
    first({ t: "fxAmount" }, centred(lvl.x, lvl.y, lvl.capW + 4 * u, lvl.travel + 16 * u));
    F.knobs.forEach((k, i) => first({ t: "fxParam", d: i }, k.touch));

    this.hits = hits;
    const B0 = g.deck[0].buttons;
    this.L = {
      W, H, u, gearTop: g.gear.y + g.gear.h, left: g.gear.x, deck: g.deck.map((d) => d.rect), mixer: M.rect, outer, r, centre, pivot, armLength, armPivotAngle,
      needleReach: Math.max(20, 20 * u), rowY, titleX, timeX, dotX, wave, buttonW: B0.w, buttonH: B0.h, buttonX, buttonY,
      pitchX, pitchY, pitchTravel: g.deck[0].pitch.travel, bpmX: [0, 0], topY: 0, phaseY: 0, phaseWidth: 0,
      knobX: M.strip.map((s) => s.x), knobY: M.strip[0].knobY, knobTravel: 90 * u, channelX: M.strip.map((s) => s.fader.x), channelY: M.strip[0].fader.y,
      channelTravel: M.strip[0].fader.travel, phonesY: M.mid.mix.y, meterX: M.mid.meterX, meterY: M.mid.meter.y, meterH: M.mid.meter.h,
      trimY: null, fx: null, live: g, sliderTravel: M.mid.mix.w - 12 * u, fxTravel: g.fx.level.travel, crossY: M.mid.cross.y, crossTravel: M.mid.cross.travel, filterY: 0,
    };
    this.labelShown = [null, null];
    // Where the page's own parts sit (the library and the stream panel are HTML over the canvas), published as CSS variables.
    const css = document.documentElement.style, top = (r: Rect) => H - (r.y + r.h);
    css.setProperty("--bar-h", `${g.topBar.h}px`);
    for (const [name, rect] of [["lib", g.library], ["stream", g.streamPanel]] as const) {
      css.setProperty(`--${name}-left`, `${rect.x}px`); css.setProperty(`--${name}-top`, `${top(rect)}px`);
      css.setProperty(`--${name}-w`, `${rect.w}px`); css.setProperty(`--${name}-h`, `${rect.h}px`);
    }
  }

  /** The booth for the game (lessons, nights: the iPhone's desk) or for LIVE (free play). */
  setMode(mode: "game" | "live"): void {
    if (mode === this.mode) return;
    this.endCueHolds();
    this.mode = mode;
    document.body.classList.toggle("live", mode === "live");
    // LIVE has no room: a crowd clip a night left playing would go on decoding behind `display: none`. The game's own `showRoom` plays it again.
    if (mode === "live") for (const v of this.roomVideos) if (v && !v.paused) v.pause();
    for (const d of this.decks) d.smoothSeek = mode === "live"; // a needle drop while the record turns fades across (no click); the game's booth keeps the hard jump
    // Free play's effect bar offers the first three effects: LIVE's other four are left behind.
    if (mode === "game" && this.fx.type > 2) this.setFxType(0);
    // LIVE's master knob (the room only) comes back where it was left; the game's booth runs at the mixer's own level.
    if (mode === "live") this.engine.roomVolume = this.liveMaster;
    else { this.liveMaster = this.engine.roomVolume; this.engine.roomVolume = ROOM_UNITY; }
    this.padMode = ["cues", "cues"];
    this.L = null;
  }

  /** A message over a deck, for a few seconds (for example: a record cannot be changed while it plays). */
  alertDeck(d: number, text: string, ms = 3200): void { this.alerts[d] = { text, until: performance.now() + ms }; }

  private liveView(): LiveView {
    const L = this.L!;
    const both = Math.abs(this.decks[0].rate) > 0.3 && Math.abs(this.decks[1].rate) > 0.3;
    return {
      decks: this.decks, pitchFader: this.pitchFader, channel: this.channel, cross: this.cross, eq: this.eq, filter: this.filterSetting, trim: this.trimSetting,
      phones: this.phones, sync: this.sync, cueDown: this.cueDown, previewing: this.previewing, meter: this.meterLevel, dropAt: this.dropAt,
      cueMix: this.engine.cueMix, phonesLevel: this.engine.phonesLevel, master: this.engine.roomVolume, fx: this.fx,
      armAngle: (d) => this.armAngle(d), pivot: L.pivot, armLength: L.armLength, labelArt: this.labelArt, alerts: this.alerts,
      trimDb: (d) => trimDecibels(this.trimSetting[d]), now: performance.now(), dpr: this.dpr,
      phase: both ? phaseOffset(this.decks[0].beat, this.decks[1].beat) : null, syncAllowed: this.syncAllowed,
      padMode: this.padMode, zoom: this.zoomLevel.map((_, d) => ({ level: this.zoomLevel[d], seconds: this.windowSeconds(d) })),
    };
  }

  private drawLive(dt: number): void {
    const L = this.L!, ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, -this.dpr, 0, L.H * this.dpr); // y up, as everywhere in the booth
    ctx.clearRect(0, 0, L.W, L.H);
    for (const d of [0, 1]) this.meterLevel[d] = Math.max(this.decks[d].takePeak(), this.meterLevel[d] - dt * 1.6);
    this.liveRenderer.draw(ctx, L.live!, this.liveView());
    if (!this.engine.running) label(ctx, `AUDIO OFF  ${this.engine.lastError ?? ""}`, L.W / 2, L.H - 20, { size: 10, color: rgba(Palette.red) });
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

  setRoomHidden(hidden: boolean): void { this.roomHidden = hidden; }

  /** Shows the room in `mood` (fading over from the mood before), or with -1 holds it still. */
  private showRoom(mood: number, dt: number): void {
    if (this.roomHidden) { for (const v of this.roomVideos) if (v && !v.paused) v.pause(); return; }
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
      case "trim": return this.trimSetting[k.d];
      case "master": return this.engine.roomVolume;
      case "cueMix": return this.engine.cueMix;
      case "phonesLevel": return this.engine.phonesLevel;
      case "fxAmount": return this.fx.amount;
      case "fxParam": return this.fx.params[k.d] ?? 0;
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
    if (this.learnPick) {
      // Learning: this is the control a MIDI knob, fader or button will move (the record = its jog).
      this.learnPick(kind.t === "platter" || kind.t === "rim" ? { t: "jog", d: kind.d } : kind);
      return;
    }
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
      case "zwave":
        // The big waveform is dragged like a record: the needle is lifted and carried, and drops where the picture is let go.
        decks[kind.d].lifted = true;
        grab.startValue = decks[kind.d].seconds;
        this.dropAt[kind.d] = decks[kind.d].progress;
        break;
      case "pad":
        this.padDown(kind.d, kind.band, e.shiftKey || e.altKey || e.button === 2);
        break;
      case "loop":
      case "zoom":
        this.press(kind);
        break;
      case "play":
      case "cue":
      case "sync":
      case "phones":
      case "fxOn":
      case "fxType":
      case "fxDiv":
        this.press(kind);
        break;
      case "fxAmount":
        if (doubleTap) { this.setFxAmount(0.5); grab.startValue = 0.5; }
        break;
      case "fxParam":
        // A double tap puts the knob back where the effect rests.
        if (doubleTap) { const v = FX_DEFAULTS[this.fx.type][kind.d]; this.setFxParam(kind.d, v); grab.startValue = v; }
        break;
      case "eq":
        // A double tap puts a knob back at its default: EQ flat, in the middle.
        if (doubleTap) { this.setEQ(kind.d, kind.band, 0.5); grab.startValue = 0.5; }
        break;
      case "filter":
        if (doubleTap) { this.setFilter(kind.d, 0.5); grab.startValue = 0.5; }
        break;
      case "trim":
        if (doubleTap) { this.setTrim(kind.d, 0.5); grab.startValue = 0.5; }
        break;
      case "master":
        if (doubleTap) { this.engine.roomVolume = ROOM_UNITY; grab.startValue = ROOM_UNITY; }
        break;
      case "phonesLevel":
        // The headphones level's default is unity: as loud as before the knob.
        if (doubleTap) { this.engine.phonesLevel = PHONES_UNITY; grab.startValue = PHONES_UNITY; }
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

  /** LIVE: the pointer over a deck's title shows the whole title (a long one is cut short in the deck). */
  private hoverTitle(e: PointerEvent): void {
    const L = this.L;
    if (!L?.live || this.grabs.size > 0) { this.tip(null); return; }
    const p = this.at(e), u = L.live.u;
    for (let d = 0; d < 2; d++) {
      const G = L.live.deck[d], info = this.decks[d].info;
      if (info && p.x >= G.title.x && p.x <= G.title.x + G.titleMax && Math.abs(p.y - G.title.y) <= 9 * u) { this.tip(`${info.artist} \u00b7 ${info.title}`, e); return; }
    }
    this.tip(null);
  }

  private tipEl: HTMLElement | null = null;
  private tip(text: string | null, e?: PointerEvent): void {
    const el = (this.tipEl ??= document.getElementById("deck-tip"));
    if (!el) return;
    if (text === null || !e) { el.hidden = true; return; }
    el.textContent = text;
    el.hidden = false;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, e.clientX + 12))}px`;
    el.style.top = `${e.clientY + 18}px`;
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
      case "zwave": {
        const deck = this.decks[k.d], r = L.live!.deck[k.d].zoom;
        // Dragging the picture to the right shows what came before: the needle goes back by as many seconds as the picture moved.
        const t = grab.startValue - (p.x - grab.start.x) * (this.windowSeconds(k.d) / r.w);
        this.dropAt[k.d] = deck.duration > 0 ? clamp01(t / deck.duration) : 0;
        break;
      }
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
        this.engine.cueMix = clamp01(grab.startValue + (L.live ? (p.x - grab.start.x) / L.sliderTravel : (p.y - grab.start.y) / L.knobTravel));
        break;
      case "phonesLevel":
        this.engine.phonesLevel = clamp01(grab.startValue + (L.live ? (p.x - grab.start.x) / L.sliderTravel : (p.y - grab.start.y) / L.knobTravel));
        break;
      case "master":
        this.engine.roomVolume = clamp01(grab.startValue + (p.y - grab.start.y) / L.knobTravel);
        break;
      case "fxAmount":
        this.setFxAmount(grab.startValue + (p.y - grab.start.y) / (L.live ? L.fxTravel : L.knobTravel));
        break;
      case "fxParam":
        this.setFxParam(k.d, grab.startValue + (p.y - grab.start.y) / L.knobTravel);
        break;
      case "eq":
        this.setEQ(k.d, k.band, clamp01(grab.startValue + (p.y - grab.start.y) / L.knobTravel));
        break;
      case "filter":
        this.setFilter(k.d, clamp01(grab.startValue + (p.y - grab.start.y) / L.knobTravel));
        break;
      case "trim":
        this.setTrim(k.d, clamp01(grab.startValue + (p.y - grab.start.y) / L.knobTravel));
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
      case "zwave":
        if (!this.holds("needle", k.d) && !this.holds("wave", k.d) && !this.holds("zwave", k.d)) this.dropNeedle(k.d);
        break;
      case "cue":
        if (!this.holds("cue", k.d)) this.release(k);
        break;
      default:
        break;
    }
  }

  // MARK: - Pads, loops and zoom (LIVE)

  /** How many seconds the big waveform shows across now (the whole record at level 0, or when it is shorter than the level). */
  windowSeconds(d: number): number {
    const deck = this.decks[d], level = this.zoomLevel[d], dur = Math.max(1, deck.duration);
    return level === 0 || ZOOM_SECONDS[level] >= dur ? dur : ZOOM_SECONDS[level];
  }

  private zoomBy(d: number, by: number): void {
    this.zoomLevel[d] = Math.max(0, Math.min(ZOOM_SECONDS.length - 1, this.zoomLevel[d] + (by > 0 ? 1 : -1)));
    try { localStorage.setItem("headliner.zoom", JSON.stringify(this.zoomLevel)); } catch { /* private window */ }
  }

  /** A pad: with the cues showing, an empty one is set and a set one jumps; with the loops showing, an empty one keeps the loop and a full one starts it. */
  private padPress(d: number, i: number): void {
    const deck = this.decks[d];
    if (this.mode !== "live" || !deck.isLoaded) return;
    if (this.padMode[d] === "cues") deck.hotCuePress(i); else deck.loopSlotPress(i);
  }

  /** The pointer on a pad: shift, alt or the right button clears it. */
  private padDown(d: number, i: number, clear: boolean): void {
    if (!clear) { this.padPress(d, i); return; }
    if (this.padMode[d] === "cues") this.decks[d].clearHotCue(i); else this.decks[d].clearLoopSlot(i);
  }

  private loopAction(d: number, action: number): void {
    const deck = this.decks[d], a = LOOP_ACTIONS[action];
    if (this.mode !== "live" || !a) return;
    if (a === "cues" || a === "loops") { this.padMode[d] = a; return; }
    if (!deck.isLoaded) return;
    if (a === "in") deck.loopIn();
    else if (a === "out") deck.loopOut();
    else if (a === "half") deck.loopScale(0.5);
    else if (a === "double") deck.loopScale(2);
    else if (a === "toggle") deck.toggleLoop();
    else deck.autoLoop(Number(a.slice(4)));
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
      case "trim": this.setTrim(kind.d, clamp01(this.trimSetting[kind.d] + step)); break;
      case "zwave": case "wave": case "zoom": {
        // The wheel over a waveform zooms it (one level for each little burst of the wheel).
        const now = performance.now();
        if (now - this.lastWheelZoom > 90) { this.lastWheelZoom = now; this.zoomBy(kind.d, e.deltaY < 0 ? 1 : -1); }
        break;
      }
      case "master": this.engine.roomVolume = clamp01(this.engine.roomVolume + step); break;
      case "cueMix": this.engine.cueMix = clamp01(this.engine.cueMix + step); break;
      case "phonesLevel": this.engine.phonesLevel = clamp01(this.engine.phonesLevel + step); break;
      case "fxAmount": this.setFxAmount(this.fx.amount + step); break;
      case "fxParam": {
        // A stepped knob moves one step for a notch of the wheel; the others by the usual small step.
        const knob = FX_KNOBS[this.fx.type][kind.d], n = knob.steps?.length ?? 0;
        this.setFxParam(kind.d, n ? this.fx.params[kind.d] + Math.sign(step) / (n - 1) : this.fx.params[kind.d] + step);
        break;
      }
      default: break;
    }
  }

  // MARK: - One way in for touch, keys and controllers

  /** A button: PLAY, CUE, SYNC, PHONES (her deck refuses it in a back to back). */
  press(k: Kind): void {
    if (this.partnerHolds(k)) { this.stepOn(); return; }
    const decks = this.decks;
    switch (k.t) {
      case "pad": this.padPress(k.d, k.band); break;
      case "loop": this.loopAction(k.d, k.band); break;
      case "zoom": this.zoomBy(k.d, k.band); break;
      case "play": {
        const deck = decks[k.d];
        deck.finishPark();
        if (this.previewing[k.d]) {
          // PLAY while CUE is held: the record goes on playing when CUE is let go.
          this.previewing[k.d] = false;
          deck.latch();
          break;
        }
        if (!deck.motorOn && deck.progress > 0.995) deck.seek(deck.cuePoint);
        deck.motorOn = !deck.motorOn;
        break;
      }
      case "cue":
        this.pressCue(k.d);
        break;
      case "sync":
        if (!this.syncAllowed) break; // vinyl has no sync button
        this.sync[k.d] = !this.sync[k.d];
        if (!this.sync[k.d]) decks[k.d].bend = 0;
        break;
      case "phones":
        this.phones[k.d] = !this.phones[k.d];
        decks[k.d].cue = this.phones[k.d];
        break;
      case "fxOn": if (this.mode === "live" || this.L?.fx) this.setFxOn(!this.fx.on); break;
      case "fxType": if (this.mode === "live" || this.L?.fx) this.setFxType(k.d === -2 ? (this.fx.type + FX_TYPES.length - 1) % FX_TYPES.length : k.d < 0 ? (this.fx.type + 1) % FX_TYPES.length : k.d); break;
      case "fxDiv": if (this.mode === "live" || this.L?.fx) this.setFxDiv(k.d < 0 ? (this.fx.div + 1) % FX_DIVISIONS.length : k.d); break;
      case "fxParam": break; // a knob has no press
      default:
        break;
    }
  }

  // MARK: - The effect unit

  private setFxOn(on: boolean): void { this.fx.on = on; this.engine.fxOn = on; }
  /** Another effect: its four knobs come back as you left them. */
  private setFxType(i: number): void {
    this.fxSaved[this.fx.type] = this.fx.params.slice();
    this.fx.type = i;
    this.fx.params = (this.fxSaved[i] ?? FX_DEFAULTS[i]).slice();
    this.engine.fxType = i;
    this.pushFxKnobs();
    this.saveFx();
  }
  /** The note value (Y key, MIDI): the effect's tempo knob steps to it; a reverb has none. */
  private setFxDiv(i: number): void {
    const t = fxTempoKnob(this.fx.type);
    if (t >= 0) this.setFxParam(t, stepValue(i, FX_DIVISIONS.length));
  }
  /** One knob of the effect, 0...1 (a stepped knob snaps to a step). */
  private setFxParam(i: number, v: number): void {
    const knob = FX_KNOBS[this.fx.type][i];
    if (!knob) return;
    const value = knob.steps ? stepValue(stepIndex(v, knob.steps.length), knob.steps.length) : clamp01(v);
    this.fx.params[i] = value;
    this.engine.setFxKnob(i, value);
    if (knob.tempo) this.fx.div = stepIndex(value, FX_DIVISIONS.length);
    this.saveFx();
  }
  /** The effect's four knobs (and its note value) to the sound. */
  private pushFxKnobs(): void {
    this.fx.params.forEach((v, i) => this.engine.setFxKnob(i, v));
    const t = fxTempoKnob(this.fx.type);
    if (t >= 0) this.fx.div = stepIndex(this.fx.params[t], FX_DIVISIONS.length);
  }
  private setFxAmount(x: number): void { this.fx.amount = clamp01(x); this.engine.fxAmount = this.fx.amount; this.saveFx(); }
  private saveFx(): void {
    this.fxSaved[this.fx.type] = this.fx.params.slice();
    try { localStorage.setItem("headliner.fx", JSON.stringify({ type: this.fx.type, amount: this.fx.amount, knobs: this.fxSaved })); } catch { /* private window */ }
  }

  /** The delay's time follows the tempo of the record the room hears: the louder of the playing
   * ones, or the left one when nothing plays. Sent only when it moved a little (SYNC nudges the tempo
   * all the time). */
  private updateFxTime(): void {
    if (this.mode !== "live" && !this.L?.fx) return;
    let best = -1, loudest = 0;
    this.decks.forEach((deck, d) => { if (deck.isLoaded && deck.motorOn && deck.rate > 0.3 && deck.volume > loudest) { best = d; loudest = deck.volume; } });
    const seconds = beatDelaySeconds(this.decks[best >= 0 ? best : 0].bpm, this.fx.div);
    if (Math.abs(seconds - this.fxSent) > 0.0002) { this.fxSent = seconds; this.engine.fxDelaySeconds = seconds; }
  }

  /** A button let go. Only CUE cares: it was playing the record while held. */
  release(k: Kind): void {
    if (k.t === "cue") this.releaseCue(k.d);
  }

  /** A fader or a knob to a position, 0...1, with the same rules as a finger. `detents`: the
   * middle catches it, as for a finger dragging across (off for key steps, which are smaller than
   * the detent and would never leave the middle). */
  setValue(k: Kind, v: number, detents = true): void {
    if (this.partnerHolds(k)) { this.stepOn(); return; }
    const x = clamp01(v);
    switch (k.t) {
      case "pitch": this.setPitchFader(k.d, x, detents); break;
      case "channel": if (k.d !== this.deadFader) { this.channel[k.d] = x; this.applyMix(); } break;
      case "cross": this.cross = x; this.applyMix(); break;
      case "eq": this.setEQ(k.d, k.band, x); break;
      case "filter": this.setFilter(k.d, x); break;
      case "trim": this.setTrim(k.d, x); break;
      case "master": this.engine.roomVolume = x; break;
      case "cueMix": this.engine.cueMix = x; break;
      case "phonesLevel": this.engine.phonesLevel = x; break;
      case "fxAmount": this.setFxAmount(x); break;
      case "fxParam": this.setFxParam(k.d, x); break;
      default: break;
    }
  }

  /** Where a fader or knob is now, 0...1. */
  valueOf(k: Kind): number { return this.value(k); }

  /** A nudge held on a key: -1 slower, 1 faster, 0 let go (SYNC does its own pulling). */
  nudgeKey(d: number, dir: number): void {
    if (dir !== 0 && this.partnerHolds({ t: "rim", d })) { this.stepOn(); return; }
    this.keyNudge[d] = dir;
  }

  /** A jog wheel turned by `ticks` (positive = forwards): a playing record is pushed or held back
   * like a hand on the rim; a stopped one is moved through (to find a spot). */
  jog(d: number, ticks: number): void {
    if (this.partnerHolds({ t: "platter", d })) { this.stepOn(); return; }
    const deck = this.decks[d];
    if (!deck.isLoaded || ticks === 0) return;
    if (deck.motorOn && Math.abs(deck.rate) > 0.3) {
      this.jogSpeed[d] = Math.max(-0.08, Math.min(0.08, this.jogSpeed[d] + ticks * 0.004));
    } else {
      deck.seek(Math.max(deck.grid.firstBeat, Math.min(deck.duration - 0.25, deck.seconds + ticks * 0.025)));
    }
  }

  /** Lets go of every key and jog (the window lost the keyboard). */
  releaseKeys(): void {
    this.keyNudge = [0, 0];
    this.jogSpeed = [0, 0];
    this.endCueHolds();
  }

  private setPitchFader(d: number, raw: number, detent = true): void {
    const v = detent && Math.abs(raw - 0.5) < 0.012 ? 0.5 : raw; // a detent in the middle
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

  private setTrim(d: number, raw: number): void {
    this.trimSetting[d] = Math.abs(raw - 0.5) < 0.03 ? 0.5 : raw;
    this.applyTrim();
  }

  /** The gain knobs act in LIVE and in free play; in a lesson or a night every channel is at 0 dB (the knob keeps its place). */
  private applyTrim(): void {
    const on = this.mode === "live" || (this.lesson === null && this.night === null);
    for (const d of [0, 1]) this.decks[d].trim = on ? this.trimSetting[d] : 0.5;
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
    this.endCueHolds();
    for (const d of [0, 1]) {
      this.decks[d].held = false;
      if (!this.sync[d]) this.decks[d].bend = 0;
      // A needle left in the air goes back where it was.
      this.dropAt[d] = null;
      this.decks[d].lifted = false;
    }
  }

  /** CUE as on a club deck. Playing: back to the mark, stopped. Stopped: the needle's spot becomes
   * the mark (unless it is already on it) and the record plays from there for as long as CUE is
   * held; let go, and it stops and goes back to the mark. PLAY pressed during the hold keeps it
   * playing. */
  private pressCue(d: number): void {
    const deck = this.decks[d];
    if (this.cueDown[d] || !deck.isLoaded || deck.lifted) return;
    // A return still settling (a quick double tap): the needle is about to be on the mark.
    const parked = deck.finishPark();
    this.cueDown[d] = true;
    if (deck.motorOn) { deck.park(deck.cuePoint); return; }
    if (!parked) {
      if (deck.progress > 0.995) deck.seek(deck.cuePoint);
      else if (Math.abs(deck.seconds - deck.cuePoint) > 0.02) deck.cuePoint = deck.seconds;
    }
    this.previewing[d] = true;
    deck.preview();
  }

  private releaseCue(d: number): void {
    if (!this.cueDown[d]) return;
    this.cueDown[d] = false;
    if (!this.previewing[d]) return;
    this.previewing[d] = false;
    this.decks[d].park(this.decks[d].cuePoint);
  }

  /** Every CUE let go (the window lost the keyboard, the booth was rebuilt): a preview that is
   * playing stops and goes back to its mark. */
  private endCueHolds(): void {
    for (const d of [0, 1]) {
      this.cueDown[d] = false;
      if (!this.previewing[d]) continue;
      this.previewing[d] = false;
      this.decks[d].park(this.decks[d].cuePoint);
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
    // The layout changes with the mode (the game's booth is the iPhone's desk; LIVE has its own).
    if (this.L && (this.L.live !== null) !== (this.mode === "live")) this.L = null;
    // The effect bar and the gain knobs come and go with free play (a lesson or a night is the iPhone's desk).
    if (this.L && this.L.live === null && (this.L.fx !== null) !== (this.lesson === null && this.night === null)) this.L = null;
    if (!this.L) this.build();
    this.applyTrim();
    if (this.L) {
      this.updateFxTime();
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
      case "phones": case "cueMix": case "phonesLevel": case "master": case "fxOn": case "fxAmount": case "fxType": case "fxDiv": case "fxParam": return false;
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
      // A CUE preview is not a start: it ends when CUE is let go (PLAY pressed during it makes it one).
      motorOn: decks.map((x, i) => x.motorOn && !this.previewing[i]),
      turning: decks.map((x, i) => x.rate > 0.5 && !this.previewing[i]),
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
      } else if (this.keyNudge[d] !== 0 && deck.isLoaded && !(deck.motorOn && Math.abs(deck.rate) > 0.3)) {
        // A nudge held on a stopped record moves through it (twice its speed), like the jog does.
        deck.seek(Math.max(deck.grid.firstBeat, Math.min(deck.duration - 0.25, deck.seconds + this.keyNudge[d] * dt * 2)));
      } else if (!this.sync[d]) {
        // A key held, or a jog wheel turned: the same push as a hand on the rim.
        const push = this.keyNudge[d] * 0.04 + this.jogSpeed[d];
        this.jogSpeed[d] = Math.abs(this.jogSpeed[d]) < 1e-3 ? 0 : this.jogSpeed[d] * Math.exp(-dt * 8);
        if (push !== 0) {
          deck.bend = Math.max(-0.08, Math.min(0.08, push));
          this.nudging[d] = true;
        } else if (this.nudging[d]) {
          deck.bend = 0;
          this.nudging[d] = false;
        }
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

  /** A cover picture for the label of the record with this id (web only). It is drawn only while that very record is on the deck,
   * so a record loaded after it, a lesson or a night never shows it. */
  setLabelArt(d: number, id: string | null, img: CanvasImageSource | null): void {
    this.labelArt[d] = id && img ? { id, img } : null;
  }

  private draw(dt: number): void {
    if (this.L!.live) { this.drawLive(dt); return; }
    const L = this.L!, ctx = this.ctx, u = L.u;
    for (const d of [0, 1]) {
      const art = this.labelArt[d];
      const want = art && art.id === this.decks[d].info?.id ? art.id : null;
      if (want !== this.labelShown[d]) {
        this.labelShown[d] = want;
        this.platterImg[d] = platterPicture(L.r, TINTS[d], this.dpr, want ? art!.img : null);
      }
    }
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
    const cueLit = this.cueDown[d] || (!deck.motorOn && Math.abs(seconds - deck.cuePoint) < 0.02);
    button(ctx, L.buttonX[d][0], L.buttonY[d], L.buttonW, L.buttonH, "CUE", Palette.orange, cueLit);
    button(ctx, L.buttonX[d][1], L.buttonY[d], L.buttonW, L.buttonH, "PLAY", tint, deck.motorOn && !this.previewing[d]);
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
    const id = `${deck.info?.id ?? ""}:${deck.duration}:${r.w}:${deck.grid.bpm}:${deck.grid.firstBeat}`; // the grid's ticks are part of the picture
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
      // The cue mark: a line, and a flag at the top so it can be found at a glance.
      const mx = r.x + r.w * (deck.duration > 0 ? deck.cuePoint / deck.duration : 0), flag = Math.min(7, r.h * 0.4);
      ctx.fillStyle = rgba(Palette.orange);
      ctx.fillRect(mx - 1, r.y, 2, r.h);
      ctx.beginPath();
      ctx.moveTo(mx - flag * 0.7, r.y + r.h);
      ctx.lineTo(mx + flag * 0.7, r.y + r.h);
      ctx.lineTo(mx, r.y + r.h - flag);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(at - 0.75, r.y - 2, 1.5, r.h + 4);
    const drop = this.dropAt[d];
    if (drop !== null) {
      ctx.fillStyle = rgba(TINTS[d]);
      ctx.fillRect(r.x + r.w * drop - 1.25, r.y - 3, 2.5, r.h + 6);
    }
  }

  /** The effect bar: the effect, the note value, the amount, ON. */
  private drawFxBar(): void {
    const L = this.L!, F = L.fx;
    if (!F) return;
    const ctx = this.ctx, u = L.u;
    roundRect(ctx, F.panel, 10 * u, rgba(Palette.panel), EDGE);
    // The bar offers the first three effects (the DJ booth, LIVE, has all seven with their own knobs).
    F.typeX.forEach((x, i) => button(ctx, x, F.cy, 50 * u, 20 * u, FX_TYPES[i], Palette.orange, this.fx.type === i));
    // The reverb has no note value.
    F.divX.forEach((x, i) => button(ctx, x, F.cy, 32 * u, 20 * u, FX_DIVISIONS[i].label, Palette.ink, this.fx.div === i, this.fx.type === 1 ? 0.3 : 1));
    knob(ctx, F.knobX, F.cy + 3 * u, 8 * u, Palette.orange, "AMOUNT", this.fx.amount);
    button(ctx, F.onX, F.cy, 40 * u, 20 * u, "ON", Palette.red, this.fx.on);
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
      meter(ctx, L.meterX[d], L.meterY, 7 * u, L.meterH, Math.min(1, this.meterLevel[d] * 1.15));
      if (this.hasFilter) knob(ctx, L.knobX[d], L.filterY, 10 * u, TINTS[d], "FILTER", this.filterSetting[d]);
      if (L.trimY !== null) {
        // Free play: the gain knob above the fader; turned, it shows how many dB.
        const dB = trimDecibels(this.trimSetting[d]);
        knob(ctx, L.channelX[d], L.trimY, 9 * u, TINTS[d], dB === 0 ? "GAIN" : `${dB > 0 ? "+" : "\u2212"}${Math.abs(Math.round(dB))} dB`, this.trimSetting[d]);
      }
    }
    this.drawFxBar();
    // Cue mix, between the PHONES buttons: left = only the cued record, right = only the room.
    knob(ctx, mid - KNOB_GAP * u, L.phonesY, 7.5 * u, Palette.orange, "", this.engine.cueMix);
    label(ctx, "MIX", mid - KNOB_GAP * u, L.phonesY - 12.5 * u, { size: 4.6 * u, color: DIM });
    // The headphones level: unity (as loud as before) at 0.7, a little boost above.
    knob(ctx, mid + KNOB_GAP * u, L.phonesY, 7.5 * u, Palette.orange, "", this.engine.phonesLevel);
    label(ctx, "VOL", mid + KNOB_GAP * u, L.phonesY - 12.5 * u, { size: 4.6 * u, color: DIM });
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
