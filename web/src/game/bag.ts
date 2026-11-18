// Chapter 12, THE BAG (port of App/BagView.swift): the closing set, packed from your own records,
// six parts in order. Click a part on the left, then a record on the right; between two parts it
// says whether the keys fit and how far the tempo moves (the decks have no key lock).

import type { TrackInfo } from "../core/beatgrid.ts";
import { compatible } from "../core/harmony.ts";

export const PARTS = ["OPENER", "BUILD", "PEAK", "BREAK", "SECOND PEAK", "CLOSER"];
const HINTS = ["Say hello. Not too hot.", "Lift them up.", "The big one.", "Let them breathe.", "Higher than the first.", "The one they go home with."];

const el = (tag: string, className = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

/** A small sleeve colour per record (from its id), so the list reads like a shelf. */
function sleeve(t: TrackInfo): HTMLElement {
  let h = 0;
  for (const ch of t.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const s = el("span", "sleeve");
  s.style.background = `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 40) % 360} 60% 22%))`;
  return s;
}

export class BagScreen {
  private readonly root: HTMLElement;
  private readonly records: TrackInfo[];
  private readonly info: (id: string | null) => TrackInfo | null;
  private readonly onPack: (ids: string[]) => void;
  private readonly onBack: () => void;
  private picks: (string | null)[] = [null, null, null, null, null, null];
  private slot = 0;
  private voice: HTMLAudioElement | null = null;

  constructor(root: HTMLElement, records: TrackInfo[], info: (id: string | null) => TrackInfo | null, saved: string[] | null,
              onPack: (ids: string[]) => void, onBack: () => void) {
    this.root = root;
    this.records = records;
    this.info = info;
    this.onPack = onPack;
    this.onBack = onBack;
    if (saved && saved.length === 6) this.picks = saved.slice();
    this.slot = Math.max(0, this.picks.findIndex((p) => p === null));
  }

  show(): void {
    this.root.hidden = false;
    this.render();
    // Lia's words over the bag.
    this.voice = new Audio("assets/Lessons/bag-01.m4a");
    this.voice.play().catch(() => {});
  }

  close(): void {
    this.voice?.pause();
    this.voice = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private get full(): boolean { return this.picks.every((p) => p !== null); }

  private render(): void {
    const root = this.root;
    root.replaceChildren();
    const left = el("div", "bag-left");
    left.append(el("h2", "", "THE BAG"), el("div", "sub", "YOUR CLOSING SET · SIX RECORDS, IN ORDER"));
    PARTS.forEach((part, i) => {
      const track = this.info(this.picks[i]);
      const row = el("button", `slot${i === this.slot ? " chosen" : ""}`);
      const text = el("span", "t");
      text.append(el("span", "part", part), el("span", track ? "pick" : "hint", track ? `${track.title}  ·  ${Math.round(track.bpm)}  ·  ${track.camelot}` : HINTS[i]));
      row.append(el("span", "n", String(i + 1)), text);
      const before = i > 0 ? this.info(this.picks[i - 1]) : null;
      if (before && track) {
        const fits = compatible(before.camelot, track.camelot);
        const gap = track.bpm - before.bpm;
        row.append(el("span", `fit${fits ? "" : " fight"}`, `${fits ? "FITS" : "KEYS FIGHT"} ${gap >= 0 ? "+" : "-"}${Math.abs(Math.round(gap))}`));
      }
      row.addEventListener("click", () => { this.slot = i; this.render(); });
      left.append(row);
    });
    const pack = el("button", "pack", "PACK THE BAG") as HTMLButtonElement;
    pack.disabled = !this.full;
    pack.addEventListener("click", () => {
      if (!this.full) return;
      const ids = this.picks.map((p) => p!);
      this.close();
      this.onPack(ids);
    });
    left.append(pack);

    const list = el("div", "bag-records");
    for (const t of this.records) {
      const at = this.picks.indexOf(t.id);
      const row = el("button", "rec");
      const text = el("span", "t");
      text.append(el("b", "", t.title), el("span", "", `${t.artist}  ·  ${t.genre}`));
      row.append(sleeve(t), text, el("span", "num", String(Math.round(t.bpm))), el("span", "num", t.camelot), el("span", `at${at >= 0 ? " on" : ""}`, at >= 0 ? String(at + 1) : ""));
      row.addEventListener("click", () => this.put(t.id));
      list.append(row);
    }
    const back = el("button", "round back", "‹");
    back.addEventListener("click", () => { this.close(); this.onBack(); });
    const body = el("div", "bag-body");
    body.append(left, list);
    root.append(back, body);
  }

  /** Puts the record in the chosen part (moving it if it was in another), then on to the next empty part. */
  private put(id: string): void {
    const was = this.picks.indexOf(id);
    if (was >= 0) this.picks[was] = null;
    this.picks[this.slot] = id;
    const empty = this.picks.findIndex((p) => p === null);
    if (empty >= 0) this.slot = empty;
    const scroll = this.root.querySelector(".bag-records")?.scrollTop ?? 0;
    this.render();
    const list = this.root.querySelector(".bag-records");
    if (list) list.scrollTop = scroll;
  }
}
