// Sorting and searching the library list: pure, so it is tested without a page.

import type { LibraryTrack } from "./store.ts";

/** The tempo to show and use: your correction, else the analysis, else the tag. 0 = unknown. */
export function tempoOf(t: LibraryTrack): number { return t.grid?.bpm ?? t.analysis?.bpm ?? t.tagBpm; }

/** The two lines of a row: "artist · title" and the rest. */
export function labelOf(t: LibraryTrack): { main: string; sub: string } {
  const bpm = tempoOf(t);
  const parts = [bpm > 0 ? `${Number.isInteger(bpm) ? bpm : bpm.toFixed(1)} BPM` : "", t.camelot, t.album, t.ext.toUpperCase()].filter(Boolean);
  return { main: t.artist ? `${t.artist} · ${t.title}` : t.title, sub: parts.join(" · ") };
}

export interface Indexed { track: LibraryTrack; haystack: string; }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The tracks sorted by artist, then title, each with the text a search looks through. */
export function buildIndex(tracks: LibraryTrack[]): Indexed[] {
  const keyed = tracks.map((track) => ({
    track, sort: `${track.artist}\u0000${track.title}`,
    haystack: `${track.artist} ${track.title} ${track.album} ${track.name} ${track.genre} ${track.camelot} ${tempoOf(track) || ""}`.toLowerCase(),
  }));
  keyed.sort((a, b) => collator.compare(a.sort, b.sort));
  return keyed.map(({ track, haystack }) => ({ track, haystack }));
}

/** Tracks that contain every word of `query` (any order, any case), at most `limit`; `total` is how many matched. */
export function filterIndex(index: Indexed[], query: string, limit: number): { shown: LibraryTrack[]; total: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown: LibraryTrack[] = [];
  let total = 0;
  for (const it of index) {
    if (words.every((w) => it.haystack.includes(w))) {
      total++;
      if (shown.length < limit) shown.push(it.track);
    }
  }
  return { shown, total };
}

/** A short stable id for a track (the waveform cache and a deck's info use it): the same file gives the same id. */
export function trackId(t: LibraryTrack): string {
  let h = 0x811c9dc5;
  const s = `${t.key}|${t.size}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `my:${h.toString(16)}`;
}
