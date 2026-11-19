// What the library remembers: the folders you opened (their handles, so a later visit needs one click, not a
// new search) and an index of every track in them (tags, analysis, your corrections). In IndexedDB; a plain
// in-memory store stands in where there is none (tests, a private window) and for a folder opened only for
// this visit.

import type { Cover } from "./tags.ts";

export interface LibraryFolder {
  id: number;
  name: string;
  /** The folder itself: null for a folder opened only for this visit (a browser without folder access). */
  handle: FileSystemDirectoryHandle | null;
}

export interface LibraryTrack {
  /** `${folder id}:${path}`: one per file. */
  key: string;
  /** Which version of the tag reader made this entry (absent: the first). A track from an older one is read again by the next scan. */
  v?: number;
  folder: number;
  /** Directories down to the file, the file name last. */
  path: string[];
  name: string;
  ext: string;
  size: number;
  mtime: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  /** The BPM the file's tag says (0 = none): often rounded, sometimes wrong. */
  tagBpm: number;
  /** The key as written, and on the Camelot wheel ("" = none). */
  musicKey: string;
  camelot: string;
  cover?: Cover;
  /** The cover picture lying in the track's folder (path from the library folder), when the file has none of its own. */
  art?: string[];
  /** What the analysis found when the track was first played; the tempo may be wrong by an octave. */
  analysis?: { bpm: number; firstBeat: number; confidence: number };
  /** Your corrections: they win over the analysis. */
  grid?: { bpm: number; firstBeat: number };
  /** The hot cues (seconds, null = empty) and the saved loops of LIVE's pads: kept with the track. */
  cues?: (number | null)[];
  loops?: ({ start: number; end: number } | null)[];
  /** A favourite (the heart), and how many times it was played for a while on a deck: the wall's shelf shows these first. */
  fav?: boolean;
  plays?: number;
}

export interface LibraryStore {
  folders(): Promise<LibraryFolder[]>;
  addFolder(name: string, handle: FileSystemDirectoryHandle | null): Promise<LibraryFolder>;
  /** The folder and all of its tracks. */
  removeFolder(id: number): Promise<void>;
  tracks(): Promise<LibraryTrack[]>;
  putTracks(list: LibraryTrack[]): Promise<void>;
  deleteTracks(keys: string[]): Promise<void>;
}

export class MemoryStore implements LibraryStore {
  private nextId = 1;
  private readonly folderList: LibraryFolder[] = [];
  private readonly trackMap = new Map<string, LibraryTrack>();
  async folders(): Promise<LibraryFolder[]> { return this.folderList.slice(); }
  async addFolder(name: string, handle: FileSystemDirectoryHandle | null): Promise<LibraryFolder> {
    const f = { id: this.nextId++, name, handle };
    this.folderList.push(f);
    return f;
  }
  async removeFolder(id: number): Promise<void> {
    const at = this.folderList.findIndex((f) => f.id === id);
    if (at >= 0) this.folderList.splice(at, 1);
    for (const [k, t] of this.trackMap) if (t.folder === id) this.trackMap.delete(k);
  }
  async tracks(): Promise<LibraryTrack[]> { return [...this.trackMap.values()]; }
  async putTracks(list: LibraryTrack[]): Promise<void> { for (const t of list) this.trackMap.set(t.key, t); }
  async deleteTracks(keys: string[]): Promise<void> { for (const k of keys) this.trackMap.delete(k); }
}

const DB = "headliner-library";

const request = <T>(r: IDBRequest<T>): Promise<T> => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const done = (t: IDBTransaction): Promise<void> => new Promise((ok, no) => { t.oncomplete = () => ok(); t.onerror = () => no(t.error); t.onabort = () => no(t.error); });

export class IdbStore implements LibraryStore {
  private readonly db: IDBDatabase;
  private constructor(db: IDBDatabase) { this.db = db; }

  /** Opens (or creates) the database; throws where IndexedDB is not available. */
  static async open(): Promise<IdbStore> {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore("folders", { keyPath: "id", autoIncrement: true });
      db.createObjectStore("tracks", { keyPath: "key" }).createIndex("folder", "folder");
    };
    return new IdbStore(await request(open));
  }

  async folders(): Promise<LibraryFolder[]> {
    return request(this.db.transaction("folders").objectStore("folders").getAll());
  }

  async addFolder(name: string, handle: FileSystemDirectoryHandle | null): Promise<LibraryFolder> {
    const t = this.db.transaction("folders", "readwrite");
    const id = await request(t.objectStore("folders").add({ name, handle }));
    await done(t);
    return { id: Number(id), name, handle };
  }

  async removeFolder(id: number): Promise<void> {
    const t = this.db.transaction(["folders", "tracks"], "readwrite");
    t.objectStore("folders").delete(id);
    const index = t.objectStore("tracks").index("folder");
    const keys = await request(index.getAllKeys(id));
    for (const k of keys) t.objectStore("tracks").delete(k);
    await done(t);
  }

  async tracks(): Promise<LibraryTrack[]> {
    return request(this.db.transaction("tracks").objectStore("tracks").getAll());
  }

  async putTracks(list: LibraryTrack[]): Promise<void> {
    if (list.length === 0) return;
    const t = this.db.transaction("tracks", "readwrite");
    const store = t.objectStore("tracks");
    for (const track of list) store.put(track);
    await done(t);
  }

  async deleteTracks(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const t = this.db.transaction("tracks", "readwrite");
    for (const k of keys) t.objectStore("tracks").delete(k);
    await done(t);
  }
}

/** IndexedDB when there is one, else memory (nothing is remembered). */
export async function openStore(): Promise<{ store: LibraryStore; remembers: boolean }> {
  try { return { store: await IdbStore.open(), remembers: true }; }
  catch { return { store: new MemoryStore(), remembers: false }; }
}
