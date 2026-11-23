// The manifest of the career pack: the media only chapters 3-12 use (web/tools/gating.ts decides which, from usage),
// as the iPhone's v1.2.0 download pack on Cloudflare R2 (vault: 2026-11-22-headliner-ios-review-and-v1.1-plan.md, "Architecture
// Verdict"; the spec for the app: headliner-v1.2-r2-pack-spec.md). Plain functions: tools/media-pack/make-manifest.mjs reads the
// disk and calls them, web/test/media-pack.test.ts runs them on made-up files.
import { gating } from "./gating.ts";
import type { Career, Scene, TrackRow } from "./gating.ts";

export interface PackFile {
  /** Relative to App/ and to the app's pack folder, e.g. "Tracks/vinil-raro.m4a". */
  path: string;
  bytes: number;
  /** The first chapter that uses the file (3-12): the app can fetch chapter 3 first and the rest in the background. */
  chapter: number;
  /** Lower-case hex SHA-256 of the file. */
  sha256: string;
  /** The object in the bucket: content-addressed, so a changed file is a new object and an old app keeps working. */
  key: string;
  type: string;
}
export interface PackManifest {
  schema: 1;
  pack: "career";
  /** Chapters from this one on are in the pack (the game's Store.firstPaidChapter). */
  firstPaidChapter: number;
  /** The commit of the repo the files were read from. */
  generatedFrom: string;
  totalBytes: number;
  files: PackFile[];
  /** What the app still carries (chapters 1-2, the menus, the code's own files), for the size line. */
  staysInApp: { files: number; bytes: number };
}

const TYPES: Record<string, string> = { m4a: "audio/mp4", mp4: "video/mp4", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", json: "application/json", ttf: "font/ttf" };
export const contentType = (path: string): string => TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
const extOf = (path: string): string => { const i = path.lastIndexOf("."); return i < 0 ? "" : path.slice(i).toLowerCase(); };

export const FIRST_PAID_CHAPTER = 3;

/** `media`: every media path (relative to App/); `sizeOf` and `hashOf` read one file. */
export function packManifest(
  career: Career, scenes: Scene[], tracks: TrackRow[], media: string[],
  sizeOf: (path: string) => number, hashOf: (path: string) => string, generatedFrom: string,
): PackManifest {
  const g = gating(career, scenes, tracks, media);
  const firstChapter = (path: string): number =>
    Math.min(...Object.entries(g.byChapter).filter(([, list]) => list.includes(path)).map(([n]) => Number(n)).filter((n) => n >= FIRST_PAID_CHAPTER));
  const files: PackFile[] = g.gated.map((path) => {
    const sha256 = hashOf(path);
    return { path, bytes: sizeOf(path), chapter: firstChapter(path), sha256, key: `pack/${sha256}${extOf(path)}`, type: contentType(path) };
  });
  const inPack = new Set(g.gated);
  const stays = media.filter((p) => !inPack.has(p));
  return {
    schema: 1, pack: "career", firstPaidChapter: FIRST_PAID_CHAPTER, generatedFrom,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0), files,
    staysInApp: { files: stays.length, bytes: stays.reduce((n, p) => n + sizeOf(p), 0) },
  };
}
