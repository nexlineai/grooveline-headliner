// The LIST view of the LIVE library: every record as one line (no covers), searchable and sortable, and scrolling through
// all of them however many there are (only the lines in view exist as elements). The rules (what matches a search, how the
// columns sort) are plain functions at the top; the element code is below.

import { byName } from "./crates.ts";
import type { WallItem } from "./crates.ts";

export type SortKey = "artist" | "title" | "time" | "bpm" | "key" | "type" | "date";
export const SORT_KEYS: SortKey[] = ["artist", "title", "time", "bpm", "key", "type", "date"];

const keyOf = (i: WallItem): string => i.track?.camelot ?? i.game?.camelot ?? "";

/** The text a search looks through: artist, title, the line under them (tempo, key, genre), album and file name. */
const haystacks = new WeakMap<WallItem, string>();
function haystack(i: WallItem): string {
  let h = haystacks.get(i);
  if (h === undefined) {
    h = `${i.artist} ${i.title} ${i.sub} ${i.track?.album ?? ""} ${i.track?.name ?? ""}`.toLowerCase();
    haystacks.set(i, h);
  }
  return h;
}

/** Every word you type must be in the record's text, in any order ("burial 8a" finds Burial's records in 8A). */
export function filterItems(items: WallItem[], query: string): WallItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((i) => { const h = haystack(i); return words.every((w) => h.includes(w)); });
}

/** "8A" -> 16, "8B" -> 17, "12A" -> 24; no key -> Infinity (last). */
export function camelotRank(key: string): number {
  const m = /^(\d{1,2})([AB])$/i.exec(key.trim());
  return m ? Number(m[1]) * 2 + (m[2].toUpperCase() === "B" ? 1 : 0) : Infinity;
}

/** A sorted copy. Records with no tempo, key, length or date come last whichever way it runs; ties are broken by name. */
export function sortItems(items: WallItem[], by: SortKey, descending = false): WallItem[] {
  const sign = descending ? -1 : 1;
  const value = (i: WallItem): number => by === "bpm" ? (i.bpm > 0 ? i.bpm : Infinity) : by === "time" ? (i.seconds > 0 ? i.seconds : Infinity) : by === "date" ? (i.mtime > 0 ? i.mtime : Infinity) : camelotRank(keyOf(i));
  const out = items.slice();
  if (by === "artist") return out.sort((a, b) => sign * byName(a, b));
  if (by === "title") return out.sort((a, b) => sign * (a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) || byName(a, b)));
  if (by === "type") return out.sort((a, b) => {
    if (!a.type !== !b.type) return a.type ? -1 : 1; // no type (the game's records) last
    return sign * a.type.localeCompare(b.type) || byName(a, b);
  });
  return out.sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === y) return byName(a, b);
    if (x === Infinity) return 1;
    if (y === Infinity) return -1;
    return sign * (x - y);
  });
}

// MARK: - The element

export interface ListHooks {
  load(deck: number, item: WallItem): void;
  onDeck(item: WallItem): number[];
  /** A click on the row itself (not on its A or B button): the page asks on which deck. */
  ask?(item: WallItem, anchor: { x: number; y: number; w: number; h: number }): void;
  /** The heart at the start of the row's buttons. */
  toggleFav?(item: WallItem): void;
}

export interface ListView {
  /** All the records there are (the list keeps its search and its sort). */
  setItems(items: WallItem[]): void;
  setQuery(query: string): void;
  /** The "on a deck" marks follow the decks. */
  refreshMarks(): void;
  /** The line height changed (the window did). */
  resize(): void;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const n = (v: number) => v.toLocaleString("en");
const SORT_STORE = "headliner.listSort";
const COLUMNS: [SortKey | null, string][] = [["artist", "ARTIST"], ["title", "TITLE"], ["time", "TIME"], ["bpm", "BPM"], ["key", "KEY"], ["type", "TYPE"], ["date", "DATE"], [null, "GENRE"]];

/** 3:45, or 1:02:09 over an hour; nothing when the length is not known. */
export function clockOf(seconds: number): string {
  if (!(seconds > 0)) return "";
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
/** The file's date as 2026-11-19 (the day it was last written, in your time zone); nothing when there is none. */
export function dateOf(ms: number): string {
  if (!(ms > 0)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildList(host: HTMLElement, hooks: ListHooks): ListView {
  let all: WallItem[] = [];
  let shown: WallItem[] = [];
  let query = "";
  let sort: { by: SortKey; descending: boolean } = (() => { try { const s = JSON.parse(localStorage.getItem(SORT_STORE) ?? ""); if (SORT_KEYS.includes(s.by)) return { by: s.by as SortKey, descending: !!s.descending }; } catch { /* nothing saved */ } return { by: "artist", descending: false }; })();
  let rowH = 26;

  const head = make("div", "l-head");
  const scroller = make("div", "l-scroll");
  const spacer = make("div", "l-spacer");
  const count = make("div", "l-count");
  scroller.append(spacer);
  host.replaceChildren(head, scroller, count);

  function drawHead(): void {
    head.replaceChildren();
    for (const [by, name] of COLUMNS) {
      const c = make("button", by === sort.by ? "l-col on" : "l-col", name + (by === sort.by ? (sort.descending ? " ▾" : " ▴") : ""));
      c.type = "button";
      if (by) c.addEventListener("click", () => {
        sort = by === sort.by ? { by, descending: !sort.descending } : { by, descending: by === "date" }; // the newest files first
        try { localStorage.setItem(SORT_STORE, JSON.stringify(sort)); } catch { /* private window */ }
        apply();
      });
      else c.disabled = true;
      head.append(c);
    }
    head.append(make("span", "l-col end", "PLAY ON"));
  }

  function apply(): void {
    shown = sortItems(filterItems(all, query), sort.by, sort.descending);
    drawHead();
    spacer.style.height = `${shown.length * rowH}px`;
    scroller.scrollTop = 0;
    count.textContent = query ? `${n(shown.length)} of ${n(all.length)} records` : `${n(all.length)} records`;
    if (all.length === 0) count.textContent = "No records yet.";
    else if (query && shown.length === 0) count.textContent = "Nothing matches.";
    render();
  }

  let marks = "";
  function render(): void {
    const first = Math.max(0, Math.floor(scroller.scrollTop / rowH) - 3);
    const last = Math.min(shown.length, Math.ceil((scroller.scrollTop + scroller.clientHeight) / rowH) + 3);
    for (const el of [...scroller.querySelectorAll(".l-row")]) el.remove();
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const item = shown[i];
      const on = hooks.onDeck(item);
      const row = make("div", "l-row" + (on.length ? " on" : "") + (on.includes(0) ? " ona" : "") + (on.includes(1) ? " onb" : ""));
      row.style.top = `${i * rowH}px`;
      row.style.height = `${rowH}px`;
      const who = make("span", "l-artist");
      for (const d of on) who.append(make("i", d === 0 ? "mark a" : "mark b", d === 0 ? "A" : "B"));
      who.append(item.artist || "—");
      const genre = item.genre || "";
      row.append(who, make("span", "l-title", item.title), make("span", "l-time", clockOf(item.seconds)),
                 make("span", "l-num", item.bpm > 0 ? (Number.isInteger(item.bpm) ? String(item.bpm) : item.bpm.toFixed(1)) : ""),
                 make("span", "l-key", keyOf(item)), make("span", "l-type", item.type), make("span", "l-date", dateOf(item.mtime)), make("span", "l-genre", genre));
      const buttons = make("span", "l-load");
      if (hooks.toggleFav) {
        const heart = make("button", "heart" + (item.fav ? " on" : ""), "\u2665");
        heart.type = "button";
        heart.title = item.fav ? "Remove from your favourites" : "Add to your favourites";
        heart.addEventListener("click", () => hooks.toggleFav!(item));
        buttons.append(heart);
      }
      for (const d of [0, 1]) {
        const b = make("button", d === 0 ? "left" : "right", d === 0 ? "A" : "B");
        b.type = "button";
        b.title = d === 0 ? "Load on the left deck" : "Load on the right deck";
        b.addEventListener("click", () => hooks.load(d, item));
        buttons.append(b);
      }
      row.append(buttons);
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const r = row.getBoundingClientRect();
        hooks.ask?.(item, { x: r.x, y: r.y, w: r.width, h: r.height });
      });
      frag.append(row);
    }
    scroller.append(frag);
    marks = signature(first, last);
  }

  const signature = (a: number, b: number): string => { let s = ""; for (let i = a; i < b; i++) s += hooks.onDeck(shown[i]).join(""); return s; };
  let queued = false;
  scroller.addEventListener("scroll", () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); });

  drawHead();
  return {
    setItems(items: WallItem[]): void {
      all = items;
      const top = scroller.scrollTop;
      apply();
      scroller.scrollTop = Math.min(top, Math.max(0, shown.length * rowH - scroller.clientHeight)); // a scan adds records: keep the place
      render();
    },
    setQuery(q: string): void { if (q === query) return; query = q; apply(); },
    refreshMarks(): void {
      const first = Math.max(0, Math.floor(scroller.scrollTop / rowH) - 3);
      const last = Math.min(shown.length, Math.ceil((scroller.scrollTop + scroller.clientHeight) / rowH) + 3);
      if (signature(first, last) !== marks) render();
    },
    resize(): void {
      const ws = parseFloat(getComputedStyle(host).getPropertyValue("--wz")) || 1;
      const next = Math.max(20, Math.round(26 * ws));
      if (next === rowH) { render(); return; }
      rowH = next;
      spacer.style.height = `${shown.length * rowH}px`;
      render();
    },
  };
}
