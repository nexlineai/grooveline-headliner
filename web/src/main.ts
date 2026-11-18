// Grooveline Headliner in the browser: the booth, free play and the lessons.
// Browsers start sound only after a click or a touch, so the page waits for one.
//   ?lesson=<id>   start straight in a lesson (also: &step=<n>)
//   ?demo          both records turning (screenshots)
//   ?autostart     no click needed (screenshots; the browser must allow sound)

import type { TrackInfo } from "./core/beatgrid.ts";
import { DeckEngine } from "./audio/engine.ts";
import { Booth } from "./booth/booth.ts";
import { loadContent } from "./game/content.ts";
import type { Content, Lesson } from "./game/content.ts";
import { LessonRunner } from "./game/lesson.ts";
import { StudioGrid, loadCut, loadLoop, namedPattern } from "./game/studio.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new DeckEngine();
const booth = new Booth($<HTMLCanvasElement>("booth"), $("room"), engine);
const start = $("start"), crate = $("crate"), crateList = $("crate-list"), phonesPanel = $("phones"), note = $("note");
const lessonsSheet = $("lessons"), lessonsList = $("lessons-list");
const overlay = $("lesson"), result = $("lesson-result");
const params = new URLSearchParams(location.search);
// For the screenshot tool's `eval` (tools/shot.ts) and the browser console.
Object.assign(window, { headliner: { engine, booth } });

let content: Content | null = null;
let tracks: TrackInfo[] = [];

// The radio studio's station ID (played outside the mixer, as on the iPhone), and the studio's grid.
let jingles = 0;
let jingle: HTMLAudioElement | null = null;
const jinglePlaying = () => !!jingle && !jingle.paused && !jingle.ended;
function playJingle(): void {
  if (jinglePlaying()) return;
  jingle = new Audio("assets/Lessons/jingle.m4a");
  jingle.play().catch(() => {});
  jingles += 1;
}
const grid = new StudioGrid($("studio"));
let cuts = 0;
booth.pageFacts = () => ({ jingles, jinglePlaying: jinglePlaying(), pattern: grid.pattern.rows, page: grid.page, cuts });
grid.onChange = () => {
  // The left deck plays the new version from where it is (not once the dubplate is cut).
  if (booth.lesson?.lesson.desk.studio && engine.decks[0].info?.id !== "your-dubplate") loadLoop(grid.pattern, engine.decks[0], true);
};
grid.onCut = () => {
  // CUT: the loop becomes a whole record on the left deck (kept with the progress, later).
  loadCut(grid.pattern, engine.decks[0]);
  booth.recordChanged(0);
  cuts += 1;
};
(function follow() { grid.follow(engine.decks[0]); requestAnimationFrame(follow); })();

// The canvas only uses a web font once it has loaded; ask for it now.
document.fonts.load(`600 16px "Barlow Condensed"`).catch(() => {});

async function loadRecord(d: number, track: TrackInfo): Promise<void> {
  const deck = engine.decks[d];
  if (deck.motorOn && Math.abs(deck.rate) > 0.1 && !booth.lesson) {
    note.textContent = "Stop the deck before you change its record.";
    return;
  }
  note.textContent = `Loading ${track.title}…`;
  await engine.load(d, track, `assets/Tracks/${track.file}`);
  booth.recordChanged(d);
  note.textContent = "";
}

booth.loadRecord = async (d, id) => {
  const track = tracks.find((t) => t.id === id);
  if (!track) throw new Error(`no record "${id}"`);
  await loadRecord(d, track);
};

async function begin(): Promise<void> {
  start.classList.add("busy");
  try {
    await engine.start();
    content = await loadContent();
    tracks = content.tracks;
    fillLessons();
    const lesson = params.get("lesson");
    if (lesson) {
      await startLesson(lesson, Number(params.get("step") ?? 0));
    } else {
      // Lessons rely on the first two records (122 and 124 BPM); free play starts with them too.
      await Promise.all([loadRecord(0, tracks[0]), loadRecord(1, tracks[1])]);
      freePlay();
      if (params.has("demo")) booth.demo();
    }
    start.hidden = true;
  } catch (e) {
    start.classList.remove("busy");
    start.querySelector("p")!.textContent = `Could not start: ${e}`;
    throw e;
  }
  const c = engine.context;
  if (c) console.info(`audio ${c.sampleRate} Hz, latency ${(engine.latency * 1000).toFixed(1)} ms, shared memory ${engine.sharedMemory}`);
}

// MARK: - Free play and the crate

/** Free play: every chapter's records (a preview without progress yet). */
function freePlay(): void {
  booth.lesson?.stop();
  booth.lesson = null;
  overlay.hidden = true;
  result.hidden = true;
  grid.hide();
  $("crate-button").hidden = false;
  $("jingle-button").hidden = true;
  fillCrate(null, 12);
}

/** The crate: newest chapter first, onto the left or the right deck. `bag`: only these records
 * (a lesson's or a night's bag). Never the white label: it is the end of the game (zdB's dubplate). */
function fillCrate(bag: string[] | null, chapter: number): void {
  crateList.replaceChildren();
  const order = tracks.map((t, i) => ({ t, i }))
    .filter(({ t }) => t.id !== "white-label" && (bag ? bag.includes(t.id) : (t.chapter ?? 1) <= chapter))
    .sort((x, y) => (y.t.chapter ?? 1) - (x.t.chapter ?? 1) || x.i - y.i);
  for (const { t } of order) {
    const row = document.createElement("div");
    row.className = "record";
    const name = document.createElement("div");
    name.className = "name";
    name.innerHTML = `<b></b><span></span>`;
    name.querySelector("b")!.textContent = `${t.artist} · ${t.title}`;
    name.querySelector("span")!.textContent = `${t.bpm} BPM · ${t.camelot} · ${t.genre} · chapter ${t.chapter ?? 1}`;
    row.append(name);
    for (const d of [0, 1]) {
      const b = document.createElement("button");
      b.textContent = d === 0 ? "LEFT" : "RIGHT";
      b.className = d === 0 ? "left" : "right";
      b.addEventListener("click", () => { crate.hidden = true; loadRecord(d, t).catch((e) => { note.textContent = String(e); }); });
      row.append(b);
    }
    crateList.append(row);
  }
}

// MARK: - Lessons

function fillLessons(): void {
  if (!content) return;
  lessonsList.replaceChildren();
  const chapterOf = new Map<string, number>();
  for (const c of content.career.chapters) for (const s of c.steps) for (const sc of s.screens) if (sc.type === "lesson") chapterOf.set(sc.id, c.number);
  for (const l of content.career.lessons) {
    const row = document.createElement("button");
    row.className = "lesson-row";
    row.innerHTML = `<span class="n"></span><b></b><span class="c"></span>`;
    row.querySelector(".n")!.textContent = String(l.number);
    row.querySelector("b")!.textContent = l.title;
    // Lessons that need a part of the booth the web does not have yet are shown, not offered.
    const missing = l.desk.partner !== null ? "the partner's deck" : null;
    row.querySelector(".c")!.textContent = `chapter ${chapterOf.get(l.id) ?? "?"} · ${l.coach}${missing ? ` · needs ${missing}, not on the web yet` : ""}`;
    row.disabled = missing !== null;
    row.addEventListener("click", () => { lessonsSheet.hidden = true; startLesson(l.id).catch((e) => { note.textContent = String(e); }); });
    lessonsList.append(row);
  }
}

async function startLesson(id: string, step = 0): Promise<void> {
  const lesson = content?.career.lessons.find((l) => l.id === id);
  if (!lesson || !content) throw new Error(`no lesson "${id}"`);
  result.hidden = true;
  const runner = new LessonRunner(lesson, content.career.handsOff);
  runner.startAt = step;
  note.textContent = `Lesson ${lesson.number}…`;
  await booth.startLesson(runner, [tracks[0].id, tracks[1].id]);
  note.textContent = "";
  grid.hide();
  if (lesson.desk.studio) {
    // A studio lesson starts from its own pattern, or an empty one; the dubplate lesson cuts what
    // you made (or the groove from the lessons).
    grid.pattern = lesson.desk.cutter && grid.pattern.rows.some((r) => r.some(Boolean)) ? grid.pattern : namedPattern(lesson.desk.pattern);
    grid.page = 0;
    loadLoop(grid.pattern, engine.decks[0], false);
    grid.show(lesson.desk.cutter);
  }
  $("lesson-words").hidden = lesson.desk.studio; // the grid takes the room; the coach is heard
  $("jingle-button").hidden = lesson.desk.room !== "studio";
  $("crate-button").hidden = !lesson.desk.crate;
  if (lesson.desk.crate) fillCrate(lesson.desk.bag, lesson.desk.chapter);
  overlay.hidden = false;
  $("lesson-coach").textContent = lesson.coach;
  shown = -1;
}

/** The overlay follows the runner (only when something changed). */
let shown = -1;
function showLesson(): void {
  const r = booth.lesson;
  if (r && r.version !== shown) {
    shown = r.version;
    if (r.stars !== null) {
      overlay.hidden = true;
      result.hidden = false;
      showResult(r.lesson, r.stars, r.verdict);
    } else {
      overlay.hidden = false;
      $("lesson-chip").classList.toggle("done", r.taskDone);
      $("lesson-task").textContent = r.task;
      $("lesson-progress").textContent = r.progress;
      $("lesson-progress").hidden = !r.progress;
      $("lesson-caption").textContent = r.caption;
      // The page's buttons pulse when the coach points at them.
      $("crate-button").classList.toggle("pointed", r.target?.type === "crate");
      $("jingle-button").classList.toggle("pointed", r.target?.type === "jingle");
    }
  }
  requestAnimationFrame(showLesson);
}
requestAnimationFrame(showLesson);

function showResult(lesson: Lesson, stars: number, verdict: string): void {
  $("result-number").textContent = `LESSON ${lesson.number}`;
  $("result-title").textContent = lesson.title;
  $("result-stars").replaceChildren(...[0, 1, 2].map((i) => {
    const s = document.createElement("span");
    s.textContent = i < stars ? "★" : "☆";
    s.className = i < stars ? "on" : "";
    return s;
  }));
  $("result-verdict").textContent = verdict;
}

$("result-continue").addEventListener("click", () => {
  // The career's chapter screens come next; for now the next lesson in the list.
  const lessons = content?.career.lessons ?? [];
  const at = lessons.findIndex((l) => l.id === booth.lesson?.lesson.id);
  const next = lessons[at + 1];
  if (next) startLesson(next.id).catch((e) => { note.textContent = String(e); });
  else freePlay();
});

// MARK: - Buttons

const sheets = [crate, phonesPanel, lessonsSheet];
const toggle = (sheet: HTMLElement) => { const open = sheet.hidden; for (const s of sheets) s.hidden = true; sheet.hidden = !open; };
start.addEventListener("click", () => { if (!start.classList.contains("busy")) begin(); });
$("crate-button").addEventListener("click", () => toggle(crate));
$("crate-close").addEventListener("click", () => { crate.hidden = true; });
$("phones-button").addEventListener("click", () => toggle(phonesPanel));
$("phones-close").addEventListener("click", () => { phonesPanel.hidden = true; });
$("lessons-button").addEventListener("click", () => toggle(lessonsSheet));
$("jingle-button").addEventListener("click", playJingle);
$("lessons-close").addEventListener("click", () => { lessonsSheet.hidden = true; });
$("free-play").addEventListener("click", () => { lessonsSheet.hidden = true; freePlay(); });
for (const b of phonesPanel.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
  b.addEventListener("click", () => {
    engine.phones = b.dataset.mode === "split" ? "split" : "off";
    for (const o of phonesPanel.querySelectorAll("[data-mode]")) o.classList.toggle("on", o === b);
  });
}

if (params.has("autostart")) begin(); // screenshots (the browser is told to allow sound without a click)
