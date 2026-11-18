// The title and the chapter screen (ports of App/TitleView.swift and ChapterView in
// App/Chapter.swift). Plain page elements over the booth; the booth is not drawn while they show.

import type { Chapter, ChapterStep } from "./game/content.ts";
import type { CareerProgress } from "./game/progress.ts";
import * as Progress from "./game/progress.ts";

const el = (tag: string, className = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

export interface ChapterActions {
  /** Play these steps one after the other, then come back to the chapter. */
  play: (steps: ChapterStep[]) => void;
  open: (chapter: number) => void;
  back: () => void;
}

/** One chapter: what it is, how many stars, CONTINUE from the first step not done to the end of
 * the chapter, and its steps (a finished chapter offers the next one). */
export function showChapter(root: HTMLElement, chapters: Chapter[], chapter: Chapter, p: CareerProgress, act: ChapterActions): void {
  root.replaceChildren();
  root.hidden = false;
  const next = chapter.steps.findIndex((s) => !Progress.done(p, s));
  const earned = chapter.steps.reduce((n, s) => n + (p.stars[s.id] ?? 0), 0);
  const possible = chapter.steps.filter((s) => s.kind !== "story").length * 3;
  const nextChapter = next < 0 ? chapters.find((c) => c.number === chapter.number + 1) : undefined;

  const left = el("div", "chapter-left");
  left.append(el("div", "kicker", `CHAPTER ${chapter.number}`));
  // The other chapters on their own line; the ones not reached yet show a lock and do nothing.
  const dots = el("div", "dots");
  for (const other of chapters) {
    if (other.number === chapter.number) continue;
    const open = Progress.reached(p, chapters, other.number);
    const dot = el("button", open ? "" : "locked", open ? String(other.number) : "") as HTMLButtonElement;
    if (!open) dot.innerHTML = `<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    dot.disabled = !open;
    dot.title = open ? other.title : "Locked";
    dot.addEventListener("click", () => act.open(other.number));
    dots.append(dot);
  }
  left.append(dots, el("h1", "", chapter.title), el("p", "line", chapter.line), el("div", "stars", `★ ${earned} / ${possible}`));
  const fromNext = () => act.play(chapter.steps.slice(next < 0 ? 0 : next));
  if (nextChapter) {
    const go = el("button", "primary", `CHAPTER ${nextChapter.number}  →`);
    go.addEventListener("click", () => act.open(nextChapter.number));
    const again = el("button", "quiet", "PLAY IT AGAIN");
    again.addEventListener("click", () => act.play(chapter.steps));
    left.append(go, again);
  } else {
    const go = el("button", "primary", next < 0 ? "PLAY IT AGAIN" : next === 0 ? "START" : "CONTINUE");
    go.addEventListener("click", fromNext);
    left.append(go);
  }

  const right = el("div", "chapter-steps");
  chapter.steps.forEach((step, i) => {
    const open = Progress.stepOpen(p, chapter, i);
    const isDone = Progress.done(p, step);
    const row = el("button", `step ${step.kind}${isDone ? " done" : ""}${i === next ? " next" : ""}`) as HTMLButtonElement;
    row.disabled = !open;
    const kind = el("span", "k", step.kind === "story" && step.icon === "bag.fill" ? "BAG" : step.kind.toUpperCase());
    const text = el("span", "t");
    text.append(el("b", "", step.title), el("span", "d", open ? step.detail : "Locked"));
    const stars = p.stars[step.id] ?? 0;
    const mark = el("span", "s", step.kind === "story" ? (isDone ? "✓" : "") : "★★★".slice(0, stars) + "☆☆☆".slice(stars));
    row.append(kind, text, mark);
    row.addEventListener("click", () => act.play([step]));
    right.append(row);
  });

  const back = el("button", "round back", "‹");
  back.setAttribute("aria-label", "Back");
  back.addEventListener("click", act.back);
  const body = el("div", "chapter-body");
  body.append(left, right);
  root.append(back, body);
}
