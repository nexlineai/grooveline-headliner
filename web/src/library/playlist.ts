// Playlists as plain data and plain functions: the .m3u8 file they are saved to and read from, and how a line of such a file finds its record in
// your library. No DOM and no store here (see playlists.ts for those).

import type { LibraryTrack, Playlist, PlaylistEntry } from "./store.ts";

/** A library track as a playlist entry (`folderName`: the name of the folder it lies in). */
export function entryOf(t: LibraryTrack, folderName: string): PlaylistEntry {
  return { folder: folderName, path: t.path.slice(), title: t.title || t.name, artist: t.artist, seconds: t.seconds ?? 0 };
}

/** Where an entry lies, as one text: "Folder/Sub/file.mp3". */
export const entryPath = (e: { folder: string; path: string[] }): string => [e.folder, ...e.path].join("/");

// MARK: - The file

/** Extended M3U, UTF-8: one `#EXTINF:seconds,Artist - Title` line and one path per record, the path relative to the folder that holds your music folders
 * (so "Music/House/a.mp3"). Mixxx, Traktor, VirtualDJ and most players read it. */
export function toM3u(p: Playlist): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${p.name.replace(/[\r\n]+/g, " ")}`];
  for (const e of p.items) {
    const label = [e.artist, e.title].filter(Boolean).join(" - ").replace(/[\r\n]+/g, " ");
    lines.push(`#EXTINF:${e.seconds > 0 ? Math.round(e.seconds) : -1},${label}`, entryPath(e));
  }
  return lines.join("\n") + "\n";
}

export interface ParsedLine { path: string; title?: string; artist?: string; seconds?: number }
export interface ParsedM3u { name?: string; lines: ParsedLine[] }

/** Reads an .m3u / .m3u8 (extended or not; any line ending, with or without a byte order mark; Windows paths): the name, and the path of each record
 * with what its #EXTINF said. Streams (http://) and comments are skipped. */
export function parseM3u(text: string): ParsedM3u {
  const out: ParsedM3u = { lines: [] };
  let info: { seconds?: number; artist?: string; title?: string } | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const pl = /^#PLAYLIST:(.*)$/i.exec(line);
      if (pl) { out.name = pl[1].trim() || out.name; continue; }
      const ext = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)\s*(?:,(.*))?$/i.exec(line);
      if (ext) {
        const label = (ext[2] ?? "").trim(), dash = label.indexOf(" - ");
        info = { ...(Number(ext[1]) > 0 ? { seconds: Number(ext[1]) } : {}), ...(dash > 0 ? { artist: label.slice(0, dash).trim(), title: label.slice(dash + 3).trim() } : label ? { title: label } : {}) };
      }
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !/^file:\/\//i.test(line)) { info = null; continue; } // a stream or another kind of address
    out.lines.push({ path: line, ...(info ?? {}) });
    info = null;
  }
  return out;
}

/** A path as it is compared: forward slashes, no file:// and no drive letter, lower case, no leading "./", "../" or "/". */
export function normalPath(p: string): string[] {
  let s = p.replace(/^file:\/\/(localhost)?/i, "");
  try { s = decodeURIComponent(s); } catch { /* not encoded */ }
  s = s.replace(/\\/g, "/").replace(/^[a-z]:/i, "");
  return s.toLowerCase().split("/").filter((x) => x && x !== "." && x !== "..");
}

// MARK: - Finding the records

export interface TrackFinder {
  /** The track for a line of a file or an entry of a playlist, or null. */
  find(line: { path: string; artist?: string; title?: string }): LibraryTrack | null;
}

/** An index over the library: by file name and by artist and title, built once for an import of any size. */
export function trackFinder(tracks: LibraryTrack[], folderName: (id: number) => string): TrackFinder {
  const byFile = new Map<string, LibraryTrack[]>();
  const byLabel = new Map<string, LibraryTrack[]>();
  for (const t of tracks) {
    const f = t.name.toLowerCase();
    (byFile.get(f) ?? byFile.set(f, []).get(f)!).push(t);
    if (t.artist && t.title) { const l = `${t.artist} - ${t.title}`.toLowerCase(); (byLabel.get(l) ?? byLabel.set(l, []).get(l)!).push(t); }
  }
  const rel = new Map<LibraryTrack, string[]>();
  const relOf = (t: LibraryTrack): string[] => { let r = rel.get(t); if (!r) { r = [folderName(t.folder), ...t.path].map((x) => x.toLowerCase()); rel.set(t, r); } return r; };
  return {
    find(line): LibraryTrack | null {
      const parts = normalPath(line.path);
      const file = parts[parts.length - 1];
      const same = file ? byFile.get(file) : undefined;
      if (same && same.length) {
        // The one whose path agrees with the line's the furthest back from the file name (Folder/Sub/file.mp3 beats Other/file.mp3).
        let best: LibraryTrack | null = null, bestScore = -1, tie = false;
        for (const t of same) {
          const r = relOf(t);
          let k = 0;
          while (k < parts.length && k < r.length && parts[parts.length - 1 - k] === r[r.length - 1 - k]) k++;
          if (k > bestScore) { best = t; bestScore = k; tie = false; } else if (k === bestScore) tie = true;
        }
        // A file name found in several places with nothing to tell them apart (a bare "01.mp3"): the artist and title decide, else it is not guessed.
        if (!tie || bestScore > 1) return best;
        const label = line.artist && line.title ? `${line.artist} - ${line.title}`.toLowerCase() : "";
        const named = label ? same.find((t) => `${t.artist} - ${t.title}`.toLowerCase() === label) : undefined;
        return named ?? null;
      }
      const label = line.artist && line.title ? `${line.artist} - ${line.title}`.toLowerCase() : "";
      const named = label ? byLabel.get(label) : undefined;
      return named && named.length === 1 ? named[0] : null;
    },
  };
}

// MARK: - Editing

/** The entries with `entry` added at the end, unless the same record is already in. */
export function withEntry(items: PlaylistEntry[], entry: PlaylistEntry): PlaylistEntry[] {
  const at = entryPath(entry).toLowerCase();
  return items.some((e) => entryPath(e).toLowerCase() === at) ? items : [...items, entry];
}

/** The entries with the one at `from` moved to `to` (both clamped); the same array when nothing moves. */
export function withMoved(items: PlaylistEntry[], from: number, to: number): PlaylistEntry[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (target === from) return items;
  const out = items.slice();
  const [e] = out.splice(from, 1);
  out.splice(target, 0, e);
  return out;
}

/** A file name for a playlist: no characters a file system objects to. */
export function fileNameFor(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "playlist";
  return `${base}.m3u8`;
}
