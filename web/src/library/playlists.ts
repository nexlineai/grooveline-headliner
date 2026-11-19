// Your playlists: kept in the browser (library/store.ts), saved to and loaded from .m3u8 files (library/playlist.ts). This class is the one place that
// changes them; the view (playlistview.ts) only shows them and asks.

import { entryOf, entryPath, fileNameFor, parseM3u, toM3u, trackFinder, withEntry, withMoved } from "./playlist.ts";
import type { LibraryFolder, LibraryStore, LibraryTrack, Playlist, PlaylistEntry } from "./store.ts";

/** What the playlists need to know of the library. */
export interface PlaylistLibrary {
  folders: LibraryFolder[];
  tracks: LibraryTrack[];
}

export interface Imported { playlist: Playlist; found: number; total: number }

export class Playlists {
  lists: Playlist[] = [];
  private store: LibraryStore;
  private readonly lib: PlaylistLibrary;
  private readonly listeners = new Set<() => void>();
  private byPath: Map<string, LibraryTrack> | null = null;
  private pathsOf: LibraryTrack[] | null = null;

  constructor(store: LibraryStore, lib: PlaylistLibrary) { this.store = store; this.lib = lib; }

  /** The library opened its store: from now on the playlists are kept there (the object stays the same, so a view that listens keeps listening). */
  useStore(store: LibraryStore): void { this.store = store; }

  async load(): Promise<void> {
    this.lists = (await this.store.playlists()).sort((a, b) => a.created - b.created || a.id - b.id);
    this.changed();
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed(): void { for (const fn of this.listeners) fn(); }

  get(id: number): Playlist | undefined { return this.lists.find((p) => p.id === id); }

  private folderName = (id: number): string => this.lib.folders.find((f) => f.id === id)?.name ?? "";

  /** The library track an entry points at, or null when it is not in the library (now): by the folder's name and the path inside it. */
  trackOf(e: PlaylistEntry): LibraryTrack | null {
    if (!this.byPath || this.pathsOf !== this.lib.tracks) {
      this.pathsOf = this.lib.tracks;
      this.byPath = new Map(this.lib.tracks.map((t) => [entryPath({ folder: this.folderName(t.folder), path: t.path }).toLowerCase(), t]));
    }
    return this.byPath.get(entryPath(e).toLowerCase()) ?? null;
  }

  private async save(p: Omit<Playlist, "id"> & { id?: number }): Promise<Playlist> {
    p.updated = Date.now();
    const saved = await this.store.putPlaylist(p);
    const at = this.lists.findIndex((x) => x.id === saved.id);
    if (at >= 0) this.lists[at] = saved; else this.lists.push(saved);
    this.changed();
    return saved;
  }

  /** A new playlist (empty unless `items` are given): "Playlist 3" when no name is given. */
  async create(name = "", items: PlaylistEntry[] = []): Promise<Playlist> {
    const used = new Set(this.lists.map((p) => p.name.toLowerCase()));
    let n = this.lists.length + 1, label = name.trim().slice(0, 80);
    if (!label) { while (used.has(`playlist ${n}`)) n++; label = `Playlist ${n}`; }
    const now = Date.now();
    return this.save({ name: label, created: now, updated: now, items });
  }

  async rename(id: number, name: string): Promise<void> {
    const p = this.get(id), label = name.trim();
    if (p && label && label !== p.name) await this.save({ ...p, name: label.slice(0, 80) });
  }

  async remove(id: number): Promise<void> {
    await this.store.deletePlaylist(id);
    this.lists = this.lists.filter((p) => p.id !== id);
    this.changed();
  }

  /** Adds records of the library to a playlist (a record already in is not added again). Returns how many were new. */
  async add(id: number, tracks: LibraryTrack[]): Promise<number> {
    const p = this.get(id);
    if (!p) return 0;
    let items = p.items;
    for (const t of tracks) items = withEntry(items, entryOf(t, this.folderName(t.folder)));
    const added = items.length - p.items.length;
    if (added > 0) await this.save({ ...p, items });
    return added;
  }

  async removeAt(id: number, index: number): Promise<void> {
    const p = this.get(id);
    if (p && index >= 0 && index < p.items.length) await this.save({ ...p, items: p.items.filter((_, i) => i !== index) });
  }

  async move(id: number, from: number, to: number): Promise<void> {
    const p = this.get(id);
    if (!p) return;
    const items = withMoved(p.items, from, to);
    if (items !== p.items) await this.save({ ...p, items });
  }

  /** The playlist as an .m3u8 text, and the file name to save it under. */
  exportOf(id: number): { text: string; fileName: string } | null {
    const p = this.get(id);
    return p ? { text: toM3u(p), fileName: fileNameFor(p.name) } : null;
  }

  /** A playlist from the text of an .m3u / .m3u8: every line that finds its record in the library goes in; a line that does not is kept too (with what the file said
   * of it), so adding the folder later finds it. */
  async importText(text: string, fallbackName: string): Promise<Imported> {
    const parsed = parseM3u(text);
    const finder = trackFinder(this.lib.tracks, this.folderName);
    const items: PlaylistEntry[] = [];
    let found = 0;
    for (const line of parsed.lines) {
      const t = finder.find(line);
      let e: PlaylistEntry;
      if (t) { e = entryOf(t, this.folderName(t.folder)); found++; }
      else {
        const parts = line.path.replace(/\\/g, "/").replace(/^file:\/\/(localhost)?/i, "").split("/").filter(Boolean);
        const file = parts.pop() ?? line.path;
        e = { folder: parts.pop() ?? "", path: [file], title: line.title ?? file.replace(/\.\w+$/, ""), artist: line.artist ?? "", seconds: line.seconds ?? 0 };
      }
      const next = withEntry(items, e);
      if (next !== items) { items.push(e); }
    }
    const playlist = await this.create((parsed.name || fallbackName || "Imported playlist").trim(), items);
    return { playlist, found, total: parsed.lines.length };
  }
}
