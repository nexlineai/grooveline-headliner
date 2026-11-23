// Which media only the paid chapters (3-12) use. Built from USAGE, not from a field:
//   gated = referenced by a chapter 3-12 step  -  referenced by a chapter 1-2 step or by the game's own code
// Locking something chapters 1-2 need breaks the free game; leaving a few MB open leaks almost nothing.
// So anything not clearly and only paid stays free, and a file nobody references stays free.
//
// Used by tools/build.ts (writes dist/gated.json for the Worker) and test/gating.test.ts.

export interface Career {
  chapters: { number: number; steps: { id: string; kind: string; screens: { type: string; id?: string }[] }[] }[];
  lessons: Record<string, unknown>[];
  nights: Record<string, unknown>[];
  nightLines: unknown;
  handsOff: unknown;
  moods: string[];
}
export interface Scene { id: string; shots?: unknown[] }
export interface TrackRow { id: string; file: string; chapter?: number }

/** Chapters up to this one are free. */
export const FREE_CHAPTERS = 2;

/** Loaded from code or the menus (not from a chapter's data): always free, whatever the data says. */
export const ALWAYS_FREE = [
  "Art/menu-loop.m4a", "Art/title-floor.jpg", "Lessons/jingle.m4a", "Lessons/bag-01.m4a",
  "Tracks/tracks.json", "Story/scenes.json",
];

const strings = (o: unknown, out: string[] = []): string[] => {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) for (const v of o) strings(v, out);
  else if (o && typeof o === "object") for (const v of Object.values(o)) strings(v, out);
  return out;
};
const values = (o: unknown, key: string, out: string[] = []): string[] => {
  if (Array.isArray(o)) for (const v of o) values(v, key, out);
  else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      if (k === key && typeof v === "string") out.push(v);
      else values(v, key, out);
    }
  }
  return out;
};

export interface Gating {
  /** Media paths relative to assets/ (e.g. "Tracks/low-tide.m4a") only the paid chapters use. */
  gated: string[];
  /** The same for chapters 1-2 and the code: never gated (what a free player can reach). */
  free: string[];
  /** Per chapter: the paths its steps use (for the report and the tests). */
  byChapter: Record<number, string[]>;
}

/** `files`: every media path that exists, relative to assets/ ("Lessons/sync-01.m4a"). */
export function gating(career: Career, scenes: Scene[], tracks: TrackRow[], files: Iterable<string>): Gating {
  const all = new Set(files);
  // A name used in the data (a voice, a clip, a still) -> the files that carry it in its folder.
  const stems = (folder: string): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const f of all) {
      if (!f.startsWith(`${folder}/`)) continue;
      const stem = f.slice(folder.length + 1).replace(/\.[^.]+$/, "");
      m.set(stem, [...(m.get(stem) ?? []), f]);
    }
    return m;
  };
  const lessonVoice = stems("Lessons"), storyFile = stems("Story");
  const trackOf = new Map(tracks.map((t) => [t.id, t]));
  const trackChapter = (t: TrackRow): number => t.chapter ?? 1;
  const upTo = (n: number): string[] => tracks.filter((t) => trackChapter(t) <= n).map((t) => `Tracks/${t.file}`);
  const roomFiles = (room: string): string[] =>
    [`Art/room-${room}.jpg`, ...career.moods.map((_, i) => `Art/room-${room}-${["waiting", "nodding", "dancing", "nuts"][i]}.mp4`)].filter((f) => all.has(f));
  const sceneOf = new Map(scenes.map((s) => [s.id, s]));
  const lessonOf = new Map(career.lessons.map((l) => [String(l.id), l]));
  const nightOf = new Map(career.nights.map((n) => [String(n.id), n]));

  /** What one lesson, night or scene touches. */
  const touch = (o: unknown, into: Set<string>): void => {
    for (const s of strings(o)) {
      for (const f of lessonVoice.get(s) ?? []) into.add(f);
      for (const f of storyFile.get(s) ?? []) into.add(f);
      const t = trackOf.get(s);
      if (t) into.add(`Tracks/${t.file}`);
    }
    for (const room of values(o, "room")) for (const f of roomFiles(room)) into.add(f);
  };

  const byChapter: Record<number, Set<string>> = {};
  for (const c of career.chapters) {
    const into = (byChapter[c.number] = new Set<string>());
    for (const step of c.steps) {
      for (const screen of step.screens) {
        if (screen.type === "story" && screen.id) {
          const scene = sceneOf.get(screen.id);
          if (scene) touch(scene, into);
        }
      }
      const lesson = step.kind === "lesson" ? lessonOf.get(step.id) : undefined;
      if (lesson) {
        touch(lesson, into);
        const desk = (lesson as { desk?: { chapter?: number } }).desk;
        for (const f of upTo(desk?.chapter ?? c.number)) into.add(f); // a lesson's crate
      }
      const night = step.kind === "night" ? nightOf.get(step.id) : undefined;
      if (night) {
        touch(night, into);
        touch(career.nightLines, into); // the generic night lines (every night says them)
        touch(career.handsOff, into);
        for (const f of upTo(Number((night as { chapter?: number }).chapter ?? c.number))) into.add(f); // a night's crate: its chapter and the ones before
      }
    }
  }

  const free = new Set<string>(ALWAYS_FREE.filter((f) => all.has(f)));
  for (const f of upTo(1)) free.add(f);                                   // the two records free play starts with, and the first chapter's
  for (const c of career.chapters) if (c.number <= FREE_CHAPTERS) for (const f of byChapter[c.number]) free.add(f);
  for (const f of upTo(FREE_CHAPTERS)) free.add(f);                       // free play offers the records of the free chapters
  const gated = new Set<string>();
  for (const c of career.chapters) {
    if (c.number <= FREE_CHAPTERS) continue;
    for (const f of byChapter[c.number]) if (!free.has(f) && all.has(f)) gated.add(f);
  }
  const out = (s: Set<string>) => [...s].sort();
  return { gated: out(gated), free: out(free), byChapter: Object.fromEntries(Object.entries(byChapter).map(([k, v]) => [k, out(v)])) };
}
