// Your own music: the folders you opened, the tracks found in them, and what is needed to open one. The
// page asks it for tracks; the panel draws it. Files are read in this browser only, never sent anywhere.

import { TAGS_VERSION, entriesFromFiles, listFolder, scanEntries, trackKey } from "./scan.ts";
import type { Entry } from "./scan.ts";
import { buildIndex } from "./search.ts";
import type { Indexed } from "./search.ts";
import { MemoryStore, openStore } from "./store.ts";
import type { LibraryFolder, LibraryStore, LibraryTrack } from "./store.ts";

export interface ScanState { folder: number; name: string; phase: "listing" | "reading"; found: number; done: number; total: number; }

export class Library {
  folders: LibraryFolder[] = [];
  tracks: LibraryTrack[] = [];
  index: Indexed[] = [];
  scan: ScanState | null = null;
  /** False where the browser keeps nothing between visits (no IndexedDB). */
  remembers = true;
  /** Folders that need a click before their files can be read again (the browser forgets the permission). */
  needsAccess = new Set<number>();
  /** Something changed: the MY MUSIC panel redraws. */
  onChange: () => void = () => {};
  /** Others who want to know (the record room). */
  private readonly listeners = new Set<() => void>();

  private store: LibraryStore = new MemoryStore();
  private readonly byKey = new Map<string, LibraryTrack>();
  /** Files of a folder opened without folder access (kept for this visit only). */
  private readonly files = new Map<string, File>();
  private abort: AbortController | null = null;
  private nextSession = -1;
  private indexTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  /** Can this browser open a folder and remember it (Chromium)? Others choose files each visit. */
  static get canPickFolder(): boolean { return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"; }

  /** Opens the store and loads what was remembered. Safe to call again. */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const opened = await openStore();
    this.store = opened.store;
    this.remembers = opened.remembers;
    this.folders = await this.store.folders();
    for (const t of await this.store.tracks()) this.byKey.set(t.key, t);
    this.reindex();
    await this.checkAccess();
    this.notify();
    // Tracks an older tag reader read (no length yet, say) are read again in the background, once, when the browser lets us without asking.
    this.refreshOld().catch(() => {});
  }

  /** Looks again through every folder that holds tracks read by an older version of the tag reader. */
  async refreshOld(): Promise<void> {
    for (const f of [...this.folders]) {
      if (!f.handle || this.needsAccess.has(f.id)) continue;
      if (!this.tracks.some((t) => t.folder === f.id && (t.v ?? 1) < TAGS_VERSION)) continue;
      await this.rescan(f);
    }
  }

  /** Looks through every folder again (new files, changed ones, gone ones). */
  async rescanAll(): Promise<void> {
    for (const f of [...this.folders]) if (f.handle) await this.rescan(f);
  }

  /** Calls `fn` whenever the library changes (a scan step, a folder added or removed). Returns a way to stop. */
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private notify(): void {
    this.onChange();
    for (const fn of this.listeners) fn();
  }

  private async checkAccess(): Promise<void> {
    this.needsAccess.clear();
    for (const f of this.folders) {
      try { if (f.handle && (await f.handle.queryPermission({ mode: "read" })) !== "granted") this.needsAccess.add(f.id); }
      catch { this.needsAccess.add(f.id); }
    }
  }

  private reindex(): void {
    if (this.indexTimer) { clearTimeout(this.indexTimer); this.indexTimer = null; }
    this.tracks = [...this.byKey.values()];
    this.index = buildIndex(this.tracks);
  }

  /** While a scan runs the list is rebuilt now and then, not for every batch. */
  private reindexSoon(): void {
    if (this.indexTimer) return;
    this.indexTimer = setTimeout(() => { this.indexTimer = null; this.reindex(); this.notify(); }, 500);
  }

  countOf(folder: number): number {
    let n = 0;
    for (const t of this.tracks) if (t.folder === folder) n++;
    return n;
  }

  /** Asks for a folder (the browser's own picker), then reads it. */
  async pickFolder(): Promise<void> {
    let handle: FileSystemDirectoryHandle;
    try { handle = await window.showDirectoryPicker!({ id: "headliner-music", mode: "read" }); }
    catch { return; } // closed without choosing
    await this.addHandle(handle);
  }

  /** A folder handle (from the picker): added to the library and read, or read again when it is already there. */
  async addHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    for (const f of this.folders) {
      if (f.handle && await f.handle.isSameEntry(handle)) { await this.rescan(f); return; }
    }
    const folder = await this.store.addFolder(handle.name, handle);
    this.folders.push(folder);
    this.notify();
    await this.rescan(folder);
  }

  /** The fallback for browsers with no folder access: the files of an `<input webkitdirectory>`, for this visit only. */
  async addFromFiles(list: File[]): Promise<void> {
    const entries = entriesFromFiles(list);
    if (entries.length === 0) return;
    const rel = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    const folder: LibraryFolder = { id: this.nextSession--, name: rel.split("/")[0] || "Chosen files", handle: null };
    this.folders.push(folder);
    for (const e of entries) {
      this.files.set(trackKey(folder.id, e.path), await e.file());
      if (e.art) this.files.set(trackKey(folder.id, e.art.path), await e.art.file());
    }
    await this.readEntries(folder, entries);
  }

  /** Looks through a folder again: new files are read, changed ones again, gone ones dropped. */
  async rescan(folder: LibraryFolder): Promise<void> {
    if (this.scan || !folder.handle) return;
    try { await this.ensureAccess(folder); } catch { this.notify(); return; }
    this.abort = new AbortController();
    this.scan = { folder: folder.id, name: folder.name, phase: "listing", found: 0, done: 0, total: 0 };
    this.notify();
    const entries = await listFolder(folder.handle, this.abort.signal, (n) => { if (this.scan) { this.scan.found = n; this.notify(); } });
    this.scan = null;
    await this.readEntries(folder, entries);
  }

  private async readEntries(folder: LibraryFolder, entries: Entry[]): Promise<void> {
    this.abort ??= new AbortController();
    this.scan = { folder: folder.id, name: folder.name, phase: "reading", found: entries.length, done: 0, total: entries.length };
    this.notify();
    const existing = new Map<string, LibraryTrack>();
    for (const t of this.byKey.values()) if (t.folder === folder.id) existing.set(t.key, t);
    const persist = folder.id >= 0;
    let last = 0;
    const result = await scanEntries(folder.id, entries, existing, {
      signal: this.abort.signal,
      batch: async (list) => {
        if (persist) await this.store.putTracks(list);
        for (const t of list) this.byKey.set(t.key, t);
        this.reindexSoon();
      },
      progress: (done, total) => {
        if (!this.scan) return;
        this.scan.done = done; this.scan.total = total;
        if (done - last >= 25 || done === total) { last = done; this.notify(); }
      },
    });
    if (result.complete) {
      const gone = [...existing.keys()].filter((k) => !result.seen.has(k));
      if (gone.length) { if (persist) await this.store.deleteTracks(gone); for (const k of gone) this.byKey.delete(k); }
    }
    this.scan = null;
    this.abort = null;
    this.reindex();
    this.notify();
  }

  /** Stops a scan that is running (what was read so far stays). */
  cancelScan(): void { this.abort?.abort(); }

  async removeFolder(id: number): Promise<void> {
    if (this.scan?.folder === id) this.cancelScan();
    if (id >= 0) await this.store.removeFolder(id);
    this.folders = this.folders.filter((f) => f.id !== id);
    for (const [k, t] of this.byKey) if (t.folder === id) { this.byKey.delete(k); this.files.delete(k); }
    this.needsAccess.delete(id);
    this.reindex();
    this.notify();
  }

  /** The browser asks before a folder is read in a new visit: this is called from a click. */
  private async ensureAccess(folder: LibraryFolder): Promise<void> {
    const h = folder.handle;
    if (!h) return;
    if ((await h.queryPermission({ mode: "read" })) !== "granted" && (await h.requestPermission({ mode: "read" })) !== "granted") {
      this.needsAccess.add(folder.id);
      throw new Error(`permission to read "${folder.name}" was not given`);
    }
    this.needsAccess.delete(folder.id);
  }

  /** The "RECONNECT" button of a folder. */
  async reconnect(folder: LibraryFolder): Promise<void> {
    try { await this.ensureAccess(folder); } catch { /* still not given */ }
    this.notify();
  }

  /** The file of a track (asking for the folder's permission if the browser forgot it). Throws with a sentence for the player. */
  async fileOf(track: LibraryTrack): Promise<File> {
    if (track.folder < 0) {
      const f = this.files.get(track.key);
      if (!f) throw new Error("this file was only open for the last visit: choose the folder again");
      return f;
    }
    const folder = this.folders.find((f) => f.id === track.folder);
    if (!folder?.handle) throw new Error("its folder is no longer in the library");
    await this.ensureAccess(folder);
    try {
      let dir = folder.handle;
      for (const part of track.path.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return await (await dir.getFileHandle(track.path[track.path.length - 1])).getFile();
    } catch {
      throw new Error("the file is not there any more (moved or renamed): scan the folder again");
    }
  }

  /** A file of a track's folder (the track itself, or its cover picture) for showing a sleeve. It never asks the browser for
   * anything (that needs a click): "locked" while the folder waits for its RECONNECT, null when the file is not there. */
  async fileQuiet(track: LibraryTrack, path: string[] = track.path): Promise<File | "locked" | null> {
    if (track.folder < 0) return this.files.get(trackKey(track.folder, path)) ?? null;
    const folder = this.folders.find((f) => f.id === track.folder);
    if (!folder?.handle) return null;
    if (this.needsAccess.has(folder.id)) return "locked";
    try {
      if ((await folder.handle.queryPermission({ mode: "read" })) !== "granted") return "locked";
      let dir = folder.handle;
      for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return await (await dir.getFileHandle(path[path.length - 1])).getFile();
    } catch {
      return null;
    }
  }

  /** Remembers a track that changed (its analysis, your grid corrections). */
  async update(track: LibraryTrack): Promise<void> {
    this.byKey.set(track.key, track);
    if (track.folder >= 0) await this.store.putTracks([track]);
  }
}
