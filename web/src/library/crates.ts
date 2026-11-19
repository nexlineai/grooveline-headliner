// The record room's data: every record you can pick (your own tracks and the game's), grouped into crates
// (A-Z in balanced crates, your own genre tags, or tempo bands) and the random "picks" of the wall. No DOM here.

import type { TrackInfo } from "../core/beatgrid.ts";
import { labelOf, tempoOf, trackId } from "./search.ts";
import type { LibraryTrack } from "./store.ts";

/** One record to pick: a track of your library, or a record of the game. */
export interface WallItem {
  /** Same as the id of the record once it is on a deck (`TrackInfo.id`). */
  id: string;
  title: string;
  artist: string;
  /** "124 BPM · 8A · Deep House" */
  sub: string;
  genre: string;
  /** The tempo it is known by (0: none yet). */
  bpm: number;
  /** Own music: where the cover comes from. Null for the game's records (they get a sleeve made from the name). */
  track: LibraryTrack | null;
  game: TrackInfo | null;
  /** A favourite of yours, and how often it was played (the game's records: neither). */
  fav: boolean;
  plays: number;
  /** For the list's columns: the length in seconds (0: not known), the file type ("MP3"; the game's records: ""), and the file's date (ms; 0: none). */
  seconds: number;
  type: string;
  mtime: number;
}

export function itemOfTrack(t: LibraryTrack): WallItem {
  const l = labelOf(t);
  return {
    id: trackId(t), title: t.title || t.name, artist: t.artist, sub: [l.sub.split(" · ").slice(0, 2).join(" · "), t.genre].filter(Boolean).join(" · "),
    genre: t.genre.trim(), bpm: tempoOf(t), track: t, game: null, fav: !!t.fav, plays: t.plays ?? 0,
    seconds: t.seconds ?? 0, type: (t.ext || "").toUpperCase(), mtime: t.mtime || 0,
  };
}

export function itemOfGame(info: TrackInfo): WallItem {
  return {
    id: info.id, title: info.title, artist: info.artist, sub: [`${info.bpm} BPM`, info.camelot, info.genre].filter(Boolean).join(" · "),
    genre: info.genre, bpm: info.bpm, track: null, game: info, fav: false, plays: 0,
    seconds: info.seconds || 0, type: "", mtime: 0,
  };
}

export interface Crate { id: string; label: string; items: WallItem[]; }
export type Grouping = "az" | "genre" | "tempo";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
// The text a record sorts by, made once (sorting ten thousand of them compares each many times).
const keys = new WeakMap<WallItem, string>();
const sortKey = (i: WallItem): string => { let k = keys.get(i); if (k === undefined) { k = `${i.artist || i.title}\u0000${i.title}`; keys.set(i, k); } return k; };
export const byName = (a: WallItem, b: WallItem): number => collator.compare(sortKey(a), sortKey(b));

/** "A".."Z", or "#" for a name that does not start with a letter (digits, symbols). */
export function initialOf(i: WallItem): string {
  const c = (i.artist || i.title).trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
}

/** The crates for a way of grouping. Empty ones are left out; each crate is in the order you would dig it. */
export function groupCrates(items: WallItem[], by: Grouping, count = 6): Crate[] {
  if (items.length === 0) return [];
  if (by === "az") return alphabet(items, count);
  if (by === "genre") return genres(items, count);
  return tempoBands(items);
}

/** Crates of about the same size, cut between letters: "A-C", "D-H"... */
function alphabet(items: WallItem[], count: number): Crate[] {
  const sorted = items.slice().sort(byName);
  const letters = new Map<string, WallItem[]>();
  for (const i of sorted) { const k = initialOf(i); letters.set(k, [...(letters.get(k) ?? []), i]); }
  // "#" sorts before "A": keep it in front.
  const order = [...letters.keys()].sort((a, b) => (a === "#" ? -1 : b === "#" ? 1 : a < b ? -1 : 1));
  const crates: Crate[] = [];
  const target = sorted.length / Math.max(1, count);
  let current: { letters: string[]; items: WallItem[] } = { letters: [], items: [] };
  const close = () => {
    if (!current.items.length) return;
    const first = current.letters[0], last = current.letters[current.letters.length - 1];
    crates.push({ id: `az:${first}${last}`, label: first === last ? first : `${first}–${last}`, items: current.items });
    current = { letters: [], items: [] };
  };
  for (const k of order) {
    const list = letters.get(k)!;
    // Start a new crate when this one is full enough, or when adding the letter would overshoot more than leaving it out undershoots.
    if (current.items.length && crates.length < count - 1 && (current.items.length >= target || current.items.length + list.length / 2 > target * 1.15 && current.items.length > target * 0.5)) close();
    current.letters.push(k);
    current.items.push(...list);
  }
  close();
  return crates;
}

/** Your own genre tags: the most common ones, the rest together, and what has none. */
function genres(items: WallItem[], count: number): Crate[] {
  const tally = new Map<string, { name: string; items: WallItem[] }>();
  const none: WallItem[] = [];
  for (const i of items) {
    if (!i.genre) { none.push(i); continue; }
    const k = i.genre.toLowerCase();
    const e = tally.get(k) ?? { name: i.genre, items: [] };
    e.items.push(i);
    tally.set(k, e);
  }
  const ranked = [...tally.values()].sort((a, b) => b.items.length - a.items.length || collator.compare(a.name, b.name));
  const named = ranked.slice(0, Math.max(1, count - 2));
  const rest = ranked.slice(named.length).flatMap((e) => e.items);
  const out: Crate[] = named.map((e) => ({ id: `genre:${e.name.toLowerCase()}`, label: e.name.toUpperCase(), items: e.items.slice().sort(byName) }));
  if (rest.length) out.push({ id: "genre:other", label: "OTHER GENRES", items: rest.sort(byName) });
  if (none.length) out.push({ id: "genre:none", label: "NO GENRE", items: none.sort(byName) });
  return out;
}

export const TEMPO_EDGES = [110, 120, 126, 134];

/** Tempo bands, slowest first, each dug from slow to fast. */
function tempoBands(items: WallItem[]): Crate[] {
  const labels = [`<${TEMPO_EDGES[0]}`, ...TEMPO_EDGES.slice(0, -1).map((e, i) => `${e}–${TEMPO_EDGES[i + 1]}`), `${TEMPO_EDGES[TEMPO_EDGES.length - 1]}+`];
  const bands: WallItem[][] = labels.map(() => []);
  const unknown: WallItem[] = [];
  for (const i of items) {
    if (!(i.bpm > 0)) { unknown.push(i); continue; }
    let b = TEMPO_EDGES.findIndex((e) => i.bpm < e);
    if (b < 0) b = TEMPO_EDGES.length;
    bands[b].push(i);
  }
  const byTempo = (a: WallItem, b: WallItem) => a.bpm - b.bpm || byName(a, b);
  const out: Crate[] = bands.map((list, n) => ({ id: `tempo:${n}`, label: `${labels[n]} BPM`, items: list.sort(byTempo) })).filter((c) => c.items.length);
  if (unknown.length) out.push({ id: "tempo:none", label: "NO TEMPO YET", items: unknown.sort(byName) });
  return out;
}

/** `n` random records for the wall, covers first: a wall of sleeves with pictures looks like one. Never the same record twice. */
export function pickRandom(items: WallItem[], n: number, rand: () => number = Math.random): WallItem[] {
  const shuffle = <T,>(list: T[]): T[] => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const withArt = shuffle(items.filter((i) => i.track && (i.track.cover || i.track.art)));
  if (withArt.length >= n) return withArt.slice(0, n);
  const others = shuffle(items.filter((i) => !withArt.includes(i)));
  return [...withArt, ...others].slice(0, n);
}

/** The records the shelf shows before any random ones: your favourites (the most played first), then the most played of the rest. */
export function rankShelf(items: WallItem[], n: number): WallItem[] {
  const byPlays = (a: WallItem, b: WallItem) => b.plays - a.plays || a.title.localeCompare(b.title);
  const favs = items.filter((i) => i.fav).sort(byPlays);
  const played = items.filter((i) => !i.fav && i.plays > 0).sort(byPlays);
  return [...favs, ...played].slice(0, n);
}
