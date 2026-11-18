// The studio (chapter 8; port of App/Studio.swift): the drum machine's step grid over the room.
// The pattern is rendered into a record (`renderLoop`) and played on the left deck like any other
// record; CUT turns it into a whole record, your dubplate.

import type { TrackInfo } from "../core/beatgrid.ts";
import { ARRANGEMENT, DrumPattern, SAMPLE_RATE, STEPS, VOICES, barFrames, renderLoop, renderSections } from "../core/drummachine.ts";
import type { Deck } from "../audio/engine.ts";

export const STUDIO_BPM = 124;
/** Long enough to play like a record (about two minutes); it is one bar repeated. */
export const STUDIO_BARS = 64;

export function studioTrack(seconds: number): TrackInfo {
  return { id: "studio", title: "YOUR TRACK", artist: "YOU", label: "BEDROOM", genre: "Drum machine", bpm: STUDIO_BPM,
           key: "A minor", camelot: "8A", bars: STUDIO_BARS, seconds, file: "", chapter: 8 };
}

/** The record cut from the pattern (one copy, in your crate). */
export function cutInfo(seconds?: number): TrackInfo {
  const bars = ARRANGEMENT.reduce((n, s) => n + s.bars, 0);
  return { id: "your-dubplate", title: "YOUR DUBPLATE", artist: "YOU", label: "ONE COPY", genre: "Your own", bpm: STUDIO_BPM,
           key: "A minor", camelot: "8A", bars, seconds: seconds ?? bars * barFrames(STUDIO_BPM) / SAMPLE_RATE, file: "", chapter: 8 };
}

/** Cuts the pattern into a whole record on `deck`. `heavyLows`: the bad mixdown that booms on a
 * big system (the DUBPLATE night). The deck reads it at its own rate (no resampling needed). */
export function loadCut(pattern: DrumPattern, deck: Deck, heavyLows = false): void {
  const audio = renderSections(pattern, STUDIO_BPM, ARRANGEMENT, heavyLows);
  deck.loadMade(cutInfo(audio.left.length / SAMPLE_RATE), audio.left, audio.right, SAMPLE_RATE);
}

/** Renders the pattern and puts it on `deck`; with `keepPlace` a playing deck goes on playing. */
export function loadLoop(pattern: DrumPattern, deck: Deck, keepPlace: boolean): void {
  const audio = renderLoop(pattern, STUDIO_BPM, STUDIO_BARS);
  deck.loadMade(studioTrack(audio.left.length / SAMPLE_RATE), audio.left, audio.right, SAMPLE_RATE, keepPlace);
}

export function namedPattern(name: string | null): DrumPattern {
  if (name === "house") return new DrumPattern(DrumPattern.house.rows.map((r) => r.slice()));
  if (name === "track") return new DrumPattern(DrumPattern.track.rows.map((r) => r.slice()));
  return new DrumPattern();
}

const TINTS = ["#1ad4c4", "#ff993d", "#ff3da6", "#9ee052", "#a894ff"];
const PAGES = [[0, 1, 2], [3, 4]];

/** Rows of sixteen steps on two pages (DRUMS: kick, clap, hat; SYNTH: bass, chord). A click
 * switches a step; the column being played lights up. */
export class StudioGrid {
  pattern = new DrumPattern();
  page = 0;
  private readonly root: HTMLElement;
  private cells: HTMLElement[][] = [];
  private lit = -1;
  onChange: () => void = () => {};
  onCut: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
  }

  show(cutter: boolean): void {
    this.root.hidden = false;
    this.render(cutter);
  }

  hide(): void { this.root.hidden = true; }

  get shown(): boolean { return !this.root.hidden; }

  private render(cutter: boolean): void {
    const root = this.root;
    root.replaceChildren();
    const side = document.createElement("div");
    side.className = "tabs";
    ["DRUMS", "SYNTH"].forEach((title, i) => {
      const b = document.createElement("button");
      b.textContent = title;
      b.className = i === this.page ? "on" : "";
      b.addEventListener("click", () => { this.page = i; this.render(cutter); this.onChange(); });
      side.append(b);
    });
    if (cutter) {
      const cut = document.createElement("button");
      cut.textContent = "CUT";
      cut.className = "cut";
      cut.addEventListener("click", () => this.onCut());
      side.append(cut);
    }
    const rows = document.createElement("div");
    rows.className = "rows";
    this.cells = [];
    for (const row of PAGES[this.page]) {
      const line = document.createElement("div");
      line.className = "row";
      const name = document.createElement("span");
      name.textContent = VOICES[row];
      name.style.color = TINTS[row];
      line.append(name);
      const cells: HTMLElement[] = [];
      for (let s = 0; s < STEPS; s++) {
        const cell = document.createElement("button");
        cell.className = `cell${s % 4 === 0 ? " beat" : ""}${s > 0 && s % 4 === 0 ? " gap" : ""}`;
        const paint = () => { cell.style.background = this.pattern.rows[row][s] ? TINTS[row] : ""; };
        paint();
        cell.addEventListener("click", () => { this.pattern.rows[row][s] = !this.pattern.rows[row][s]; paint(); this.onChange(); });
        line.append(cell);
        cells.push(cell);
      }
      this.cells.push(cells);
      rows.append(line);
    }
    root.append(side, rows);
    this.lit = -1;
  }

  /** The running light: the column the left deck is playing (when it plays the pattern). */
  follow(deck: Deck): void {
    if (this.root.hidden) return;
    const playing = deck.motorOn && deck.rate > 0.5 && (deck.info?.id === "studio" || deck.info?.id === "your-dubplate");
    const now = playing ? ((Math.floor(deck.beat * 4) % STEPS) + STEPS) % STEPS : -1;
    if (now === this.lit) return;
    for (const cells of this.cells) {
      if (this.lit >= 0) cells[this.lit]?.classList.remove("now");
      if (now >= 0) cells[now]?.classList.add("now");
    }
    this.lit = now;
  }
}
