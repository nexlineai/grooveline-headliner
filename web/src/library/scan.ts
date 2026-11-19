// Walks a folder for audio files and reads their tags into library tracks, a few at a time, so a ten
// thousand track disk fills the list while you watch. A file whose size and date are unchanged since the
// last visit is not read again.

import { fromFilename, readTags } from "./tags.ts";
import type { Source } from "./tags.ts";
import type { LibraryTrack } from "./store.ts";

/** What can be played: the browser decodes these (AIFF through our own reader). WMA and ALAC cannot be told by name: ALAC fails at load. */
export const AUDIO_EXTENSIONS = new Set(["mp3", "flac", "m4a", "aac", "mp4", "wav", "aif", "aiff", "ogg", "opus"]);

/** Bumped whenever the tag reader learns something (2: ID3v2.4 cover pictures with frame flags, and covers in folders). */
export const TAGS_VERSION = 2;

export const extensionOf = (name: string): string => (name.includes(".") ? name.split(".").pop()! : "").toLowerCase();

/** A file found in a folder: where it is, and a way to open it when needed. `art`: the cover picture lying in the same folder, if any. */
export interface Entry { path: string[]; file: () => Promise<File>; art?: { path: string[]; file: () => Promise<File> }; }

/** Picture names that mean "the cover of what is in this folder", best first. */
const ART_NAMES = ["cover", "folder", "front", "albumart", "album", "artwork", "art"];
/** Names that only start like one ("AlbumArt_{GUID}_Large.jpg", "front cover.png"); a bare "art" would also catch "artist.jpg". */
const ART_PREFIXES = ART_NAMES.slice(0, -1);

/** The best cover picture among the files of one folder: cover.jpg, folder.jpg, front.png... (any case, jpg/jpeg/png;
 * a name that only starts like one comes after; the "Small" thumbnails of Windows Media Player are not used). */
export function pickArtName(names: string[]): string | null {
  let best: string | null = null, bestRank = Infinity;
  for (const name of names) {
    const m = /^(.*)\.(jpe?g|png)$/i.exec(name);
    if (!m || name.startsWith("._")) continue;
    const stem = m[1].toLowerCase();
    let rank = ART_NAMES.indexOf(stem);
    if (rank < 0) {
      const starts = ART_PREFIXES.findIndex((a) => stem.startsWith(a));
      if (starts < 0 || stem.endsWith("small")) continue;
      rank = ART_NAMES.length + starts;
    }
    if (rank < bestRank) { bestRank = rank; best = name; }
  }
  return best;
}

const SKIP_FOLDERS = new Set(["$RECYCLE.BIN", "System Volume Information", "@eaDir", ".Trash", ".Trashes"]);

/** Every audio file under `root`, depth first. `onFound` hears the running count. Folders it may not read are skipped. */
export async function listFolder(root: FileSystemDirectoryHandle, signal?: AbortSignal, onFound?: (n: number) => void): Promise<Entry[]> {
  const out: Entry[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, path: string[]): Promise<void> => {
    // This folder's own audio files and pictures: the cover picture belongs to the audio files beside it.
    const own: Entry[] = [], pictures = new Map<string, FileSystemFileHandle>();
    try {
      for await (const [name, handle] of dir.entries()) {
        if (signal?.aborted) return;
        if (handle.kind === "directory") {
          if (name.startsWith(".") || SKIP_FOLDERS.has(name)) continue;
          await walk(handle as FileSystemDirectoryHandle, [...path, name]);
        } else if (AUDIO_EXTENSIONS.has(extensionOf(name)) && !name.startsWith("._")) {
          const h = handle as FileSystemFileHandle;
          const e: Entry = { path: [...path, name], file: () => h.getFile() };
          own.push(e);
          out.push(e);
          if (out.length % 250 === 0) onFound?.(out.length);
        } else if (/\.(jpe?g|png)$/i.test(name)) {
          pictures.set(name, handle as FileSystemFileHandle);
        }
      }
    } catch { /* a folder that cannot be read */ }
    const art = own.length ? pickArtName([...pictures.keys()]) : null;
    if (art) { const h = pictures.get(art)!; for (const e of own) e.art = { path: [...path, art], file: () => h.getFile() }; }
  };
  await walk(root, []);
  onFound?.(out.length);
  return out;
}

/** Entries from a `<input webkitdirectory>` (a browser with no folder access): the files themselves, the path from webkitRelativePath. */
export function entriesFromFiles(files: File[]): Entry[] {
  const pathOf = (f: File): string[] => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split("/");
    return parts.length > 1 ? parts.slice(1) : parts; // the first part is the chosen folder's own name
  };
  // The pictures of each folder (by the folder's path), for the cover beside the audio files.
  const pictures = new Map<string, File[]>();
  for (const f of files) {
    if (!/\.(jpe?g|png)$/i.test(f.name)) continue;
    const dir = pathOf(f).slice(0, -1).join("/");
    pictures.set(dir, [...(pictures.get(dir) ?? []), f]);
  }
  return files
    .filter((f) => AUDIO_EXTENSIONS.has(extensionOf(f.name)) && !f.name.startsWith("._"))
    .map((f) => {
      const path = pathOf(f);
      const e: Entry = { path, file: async () => f };
      const near = pictures.get(path.slice(0, -1).join("/"));
      const name = near ? pickArtName(near.map((p) => p.name)) : null;
      const picture = name ? near!.find((p) => p.name === name) : undefined;
      if (picture) e.art = { path: pathOf(picture), file: async () => picture };
      return e;
    });
}

export const trackKey = (folder: number, path: string[]): string => `${folder}:${path.join("/")}`;

export function fileSource(file: File): Source {
  return { size: file.size, read: async (start, length) => new Uint8Array(await file.slice(start, Math.min(file.size, start + length)).arrayBuffer()) };
}

/** A library track from a file: its tags, and what its name says where the tags do not. */
export async function trackFromFile(folder: number, path: string[], file: File): Promise<LibraryTrack> {
  const name = path[path.length - 1];
  const tags = await readTags(fileSource(file));
  const guess = fromFilename(name);
  return {
    key: trackKey(folder, path), v: TAGS_VERSION, folder, path, name, ext: extensionOf(name), size: file.size, mtime: file.lastModified,
    title: tags.title || guess.title, artist: tags.artist || guess.artist || "", album: tags.album ?? "", genre: tags.genre ?? "",
    tagBpm: tags.bpm ?? 0, musicKey: tags.key ?? "", camelot: tags.camelot ?? "", cover: tags.cover,
  };
}

export interface ScanHooks {
  /** New or changed tracks, in batches. */
  batch(list: LibraryTrack[]): void | Promise<void>;
  progress?(done: number, total: number): void;
  signal?: AbortSignal;
}

/** Reads the tags of `entries` (six at a time). Returns every key seen, so the caller can drop what has gone. */
export async function scanEntries(folder: number, entries: Entry[], existing: Map<string, LibraryTrack>, hooks: ScanHooks, concurrency = 6): Promise<{ seen: Set<string>; added: number; changed: number; complete: boolean }> {
  const seen = new Set<string>();
  let next = 0, doneCount = 0, added = 0, changed = 0;
  let pending: LibraryTrack[] = [];
  const flush = async () => { if (pending.length) { const list = pending; pending = []; await hooks.batch(list); } };
  const worker = async () => {
    while (next < entries.length && !hooks.signal?.aborted) {
      const e = entries[next++];
      try {
        const file = await e.file();
        const key = trackKey(folder, e.path);
        seen.add(key);
        const old = existing.get(key);
        const art = e.art?.path;
        if (!old || old.size !== file.size || old.mtime !== file.lastModified || (old.v ?? 1) < TAGS_VERSION) {
          const t = await trackFromFile(folder, e.path, file);
          // Your corrections and what the analysis found belong to the file: they stay while the file's name does.
          if (old) { t.grid = old.grid; t.analysis = old.analysis; changed++; } else added++;
          if (art) t.art = art;
          pending.push(t);
          if (pending.length >= 100) await flush();
        } else if ((old.art ?? []).join("/") !== (art ?? []).join("/")) {
          // The file is the same but a cover picture came or went in its folder: no tags to read again.
          const t = { ...old };
          if (art) t.art = art; else delete t.art;
          pending.push(t);
          if (pending.length >= 100) await flush();
        }
      } catch { /* a file that vanished or cannot be read */ }
      hooks.progress?.(++doneCount, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  await flush();
  return { seen, added, changed, complete: !hooks.signal?.aborted };
}
