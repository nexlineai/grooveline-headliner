// Walks a folder for audio files and reads their tags into library tracks, a few at a time, so a ten
// thousand track disk fills the list while you watch. A file whose size and date are unchanged since the
// last visit is not read again.

import { fromFilename, readTags } from "./tags.ts";
import type { Source } from "./tags.ts";
import type { LibraryTrack } from "./store.ts";

/** What can be played: the browser decodes these (AIFF through our own reader). WMA and ALAC cannot be told by name: ALAC fails at load. */
export const AUDIO_EXTENSIONS = new Set(["mp3", "flac", "m4a", "aac", "mp4", "wav", "aif", "aiff", "ogg", "opus"]);

export const extensionOf = (name: string): string => (name.includes(".") ? name.split(".").pop()! : "").toLowerCase();

/** A file found in a folder: where it is, and a way to open it when needed. */
export interface Entry { path: string[]; file: () => Promise<File>; }

const SKIP_FOLDERS = new Set(["$RECYCLE.BIN", "System Volume Information", "@eaDir", ".Trash", ".Trashes"]);

/** Every audio file under `root`, depth first. `onFound` hears the running count. Folders it may not read are skipped. */
export async function listFolder(root: FileSystemDirectoryHandle, signal?: AbortSignal, onFound?: (n: number) => void): Promise<Entry[]> {
  const out: Entry[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, path: string[]): Promise<void> => {
    try {
      for await (const [name, handle] of dir.entries()) {
        if (signal?.aborted) return;
        if (handle.kind === "directory") {
          if (name.startsWith(".") || SKIP_FOLDERS.has(name)) continue;
          await walk(handle as FileSystemDirectoryHandle, [...path, name]);
        } else if (AUDIO_EXTENSIONS.has(extensionOf(name)) && !name.startsWith("._")) {
          const h = handle as FileSystemFileHandle;
          out.push({ path: [...path, name], file: () => h.getFile() });
          if (out.length % 250 === 0) onFound?.(out.length);
        }
      }
    } catch { /* a folder that cannot be read */ }
  };
  await walk(root, []);
  onFound?.(out.length);
  return out;
}

/** Entries from a `<input webkitdirectory>` (a browser with no folder access): the files themselves, the path from webkitRelativePath. */
export function entriesFromFiles(files: File[]): Entry[] {
  return files
    .filter((f) => AUDIO_EXTENSIONS.has(extensionOf(f.name)) && !f.name.startsWith("._"))
    .map((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const parts = rel.split("/");
      return { path: parts.length > 1 ? parts.slice(1) : parts, file: async () => f }; // the first part is the chosen folder's own name
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
    key: trackKey(folder, path), folder, path, name, ext: extensionOf(name), size: file.size, mtime: file.lastModified,
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
        if (!old || old.size !== file.size || old.mtime !== file.lastModified) {
          const t = await trackFromFile(folder, e.path, file);
          // Your corrections and what the analysis found belong to the file: they stay while the file's name does.
          if (old) { t.grid = old.grid; t.analysis = old.analysis; changed++; } else added++;
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
