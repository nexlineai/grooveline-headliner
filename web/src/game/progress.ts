// What the player has done (port of CareerProgress and the lock rules in App/Chapter.swift),
// kept in this browser's local storage. Steps go in order; Zé's hidden unlock (hold the title's
// Grooveline logo three seconds) opens everything, as on the iPhone.

import type { Chapter, ChapterStep } from "./content.ts";

export interface CareerProgress {
  /** Best stars per lesson or night id. */
  stars: Record<string, number>;
  /** Story steps seen to the end. */
  seen: string[];
  /** The pattern of the record cut in the studio (chapter 8). */
  track: boolean[][] | null;
  /** THE BAG (chapter 12): the closing set, six record ids in order. */
  closingSet: string[] | null;
}

const KEY = "headliner.progress.v1";
const UNLOCK = "headliner.unlockAll";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private window: progress lasts this visit */ }
}

export function loadProgress(): CareerProgress {
  const empty: CareerProgress = { stars: {}, seen: [], track: null, closingSet: null };
  const raw = read(KEY);
  if (!raw) return empty;
  try {
    const p = JSON.parse(raw) as Partial<CareerProgress>;
    return { stars: p.stars ?? {}, seen: p.seen ?? [], track: p.track ?? null, closingSet: p.closingSet ?? null };
  } catch {
    return empty;
  }
}

export function saveProgress(p: CareerProgress): void { write(KEY, JSON.stringify(p)); }

export const unlockedAll = (): boolean => read(UNLOCK) === "1";
export function setUnlockAll(on: boolean): void { write(UNLOCK, on ? "1" : null); }

export function done(p: CareerProgress, step: ChapterStep): boolean {
  return step.kind === "story" ? p.seen.includes(step.id) : (p.stars[step.id] ?? 0) > 0;
}

/** Every step of the chapter done (a story seen, a lesson or night with a star). */
export const finished = (p: CareerProgress, c: Chapter): boolean => c.steps.every((s) => done(p, s));

/** The chapter the player is up to: the first one not finished (the last one when all are). */
export function current(p: CareerProgress, chapters: Chapter[]): number {
  return (chapters.find((c) => !finished(p, c)) ?? chapters[chapters.length - 1]).number;
}

/** Can this chapter be opened yet? */
export const reached = (p: CareerProgress, chapters: Chapter[], n: number): boolean => unlockedAll() || n <= current(p, chapters);

/** Can this step be played yet? Steps after the first one not done are locked. */
export function stepOpen(p: CareerProgress, c: Chapter, i: number): boolean {
  if (unlockedAll()) return true;
  const next = c.steps.findIndex((s) => !done(p, s));
  return next < 0 || i <= next;
}

/** Chapters whose records are in the free-play crate: the first from the start, the others once
 * their night has a star (a chapter without a night: once one of its lessons has one). */
export function recordsOpen(p: CareerProgress, chapters: Chapter[]): Set<number> {
  const open = new Set([1]);
  for (const c of chapters) {
    const nights = c.steps.filter((s) => s.kind === "night");
    const counted = nights.length ? nights : c.steps.filter((s) => s.kind === "lesson");
    if (counted.some((s) => (p.stars[s.id] ?? 0) > 0)) open.add(c.number);
  }
  return open;
}

/** Keeps the best stars for a lesson or night. */
export function record(p: CareerProgress, id: string, stars: number): void {
  if (stars > (p.stars[id] ?? 0)) p.stars[id] = stars;
  saveProgress(p);
}

export function markSeen(p: CareerProgress, id: string): void {
  if (!p.seen.includes(id)) { p.seen.push(id); saveProgress(p); }
}
