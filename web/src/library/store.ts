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
  /** How long the file is, read from its header when the track was scanned (library/length.ts; absent: the format cannot be read, or not scanned since). */
  seconds?: number;
}

/** One record of a playlist: where it lies (the library folder's NAME and the path inside it, so a folder that was removed and added again still matches) and
 * enough about it to show and to match it by artist and title when the file is not found. */
export interface PlaylistEntry { folder: string; path: string[]; title: string; artist: string; seconds: number }

/** A playlist of yours: kept in the browser, and saved to / loaded from an .m3u8 file. */
export interface Playlist { id: number; name: string; created: number; updated: number; items: PlaylistEntry[] }

export interface LibraryStore {
  folders(): Promise<LibraryFolder[]>;
  addFolder(name: string, handle: FileSystemDirectoryHandle | null): Promise<LibraryFolder>;
  /** The folder and all of its tracks. */
  removeFolder(id: number): Promise<void>;
  tracks(): Promise<LibraryTrack[]>;
  putTracks(list: LibraryTrack[]): Promise<void>;
  deleteTracks(keys: string[]): Promise<void>;
  playlists(): Promise<Playlist[]>;
  /** Saves a playlist (a new one has no id yet: the saved copy has). */
  putPlaylist(p: Omit<Playlist, "id"> & { id?: number }): Promise<Playlist>;
  deletePlaylist(id: number): Promise<void>;
}

export class MemoryStore implements LibraryStore {
  private nextPlaylist = 1;
  private readonly playlistMap = new Map<number, Playlist>();
  async playlists(): Promise<Playlist[]> { return [...this.playlistMap.values()].map((p) => structuredClone(p)); }
  async putPlaylist(p: Omit<Playlist, "id"> & { id?: number }): Promise<Playlist> {
    const saved = structuredClone({ ...p, id: p.id ?? this.nextPlaylist++ }) as Playlist;
    this.playlistMap.set(saved.id, saved);
    return structuredClone(saved);
  }
  async deletePlaylist(id: number): Promise<void> { this.playlistMap.delete(id); }
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

  /** Called when another tab of the page still holds the old database open and so blocks the upgrade (the page says so: close that tab). */
  static onBlocked: () => void = () => {};

  /** Opens (or creates, or upgrades) the database; throws where IndexedDB is not available. Version 2 added the playlists. */
  static async open(): Promise<IdbStore> {
    const open = indexedDB.open(DB, 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("folders")) db.createObjectStore("folders", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("tracks")) db.createObjectStore("tracks", { keyPath: "key" }).createIndex("folder", "folder");
      if (!db.objectStoreNames.contains("playlists")) db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
    };
    open.onblocked = () => IdbStore.onBlocked();
    const db = await request(open);
    // A newer version of the page in another tab wants to upgrade: let go of this one so it can.
    db.onversionchange = () => db.close();
    return new IdbStore(db);
  }

  async playlists(): Promise<Playlist[]> {
    return request(this.db.transaction("playlists").objectStore("playlists").getAll());
  }

  async putPlaylist(p: Omit<Playlist, "id"> & { id?: number }): Promise<Playlist> {
    const t = this.db.transaction("playlists", "readwrite");
    const id = await request(t.objectStore("playlists").put(p));
    await done(t);
    return { ...p, id: Number(id) } as Playlist;
  }

  async deletePlaylist(id: number): Promise<void> {
    const t = this.db.transaction("playlists", "readwrite");
    t.objectStore("playlists").delete(id);
    await done(t);
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
