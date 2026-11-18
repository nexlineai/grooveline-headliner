// Grooveline Headliner in the browser: the booth, free play, the lessons and the nights.
// Browsers start sound only after a click or a touch, so the page waits for one.
//   ?lesson=<id>[&step=<n>]   start straight in a lesson
//   ?night=<id>[&length=<s>]  start straight in a night (a short length for tests)
//   ?demo                     both records turning (screenshots)
//   ?autostart                no click needed (screenshots; the browser must allow sound)

import type { TrackInfo } from "./core/beatgrid.ts";
import { DrumPattern } from "./core/drummachine.ts";
import { DeckEngine } from "./audio/engine.ts";
import { Booth } from "./booth/booth.ts";
import { loadContent } from "./game/content.ts";
import type { Content, NightInfo } from "./game/content.ts";
import { LessonRunner } from "./game/lesson.ts";
import { NightRunner } from "./game/night.ts";
import { StudioGrid, cutInfo, loadCut, loadLoop, namedPattern } from "./game/studio.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new DeckEngine();
const booth = new Booth($<HTMLCanvasElement>("booth"), $("room"), engine);
const start = $("start"), crate = $("crate"), crateList = $("crate-list"), phonesPanel = $("phones"), note = $("note");
const careerSheet = $("career"), careerList = $("career-list");
const lessonOverlay = $("lesson"), nightOverlay = $("night"), result = $("result");
const params = new URLSearchParams(location.search);
// For the screenshot tool's `eval` (tools/shot.ts) and the browser console.
Object.assign(window, { headliner: { engine, booth } });

let content: Content | null = null;
let tracks: TrackInfo[] = [];

// The canvas only uses a web font once it has loaded; ask for it now.
document.fonts.load(`600 16px "Barlow Condensed"`).catch(() => {});

// MARK: - Records

/** Your dubplate: the pattern you cut (none yet: the groove from the lessons). */
let cutPattern: DrumPattern | null = null;

const trackFor = (id: string): TrackInfo | null => (id === "your-dubplate" ? cutInfo() : tracks.find((t) => t.id === id) ?? null);

async function loadRecord(d: number, track: TrackInfo): Promise<void> {
  const deck = engine.decks[d];
  if (deck.motorOn && Math.abs(deck.rate) > 0.1 && !booth.lesson && !booth.night) {
    note.textContent = "Stop the deck before you change its record.";
    return;
  }
  if (track.id === "your-dubplate") {
    // On the big system (the DUBPLATE night) the cut booms until its low comes down.
    loadCut(cutPattern ?? DrumPattern.track, deck, booth.night?.info.mixdownCheck ?? false);
  } else {
    note.textContent = `Loading ${track.title}…`;
    await engine.load(d, track, `assets/Tracks/${track.file}`);
    note.textContent = "";
  }
  booth.recordChanged(d);
}

booth.loadRecord = async (d, id) => {
  const track = trackFor(id);
  if (!track) throw new Error(`no record "${id}"`);
  await loadRecord(d, track);
};

// MARK: - The radio studio's jingle and the studio's grid

let jingles = 0;
let jingle: HTMLAudioElement | null = null;
const jinglePlaying = () => !!jingle && !jingle.paused && !jingle.ended;
function playJingle(): void {
  if (jinglePlaying()) return;
  jingle = new Audio("assets/Lessons/jingle.m4a"); // played outside the mixer, as on the iPhone
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
  // CUT: the loop becomes a whole record on the left deck, and your dubplate from now on.
  cutPattern = new DrumPattern(grid.pattern.rows.map((r) => r.slice()));
  loadCut(cutPattern, engine.decks[0]);
  booth.recordChanged(0);
  cuts += 1;
};
(function follow() { grid.follow(engine.decks[0]); requestAnimationFrame(follow); })();

// MARK: - Start

async function begin(): Promise<void> {
  start.classList.add("busy");
  try {
    await engine.start();
    content = await loadContent();
    tracks = content.tracks;
    booth.tracks = tracks;
    fillCareer();
    const lesson = params.get("lesson"), night = params.get("night");
    if (lesson) await startLesson(lesson, Number(params.get("step") ?? 0));
    else if (night) await startNight(night, Number(params.get("length") ?? 0) || null);
    else {
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

const firstTwo = () => [tracks[0].id, tracks[1].id];

/** Newest chapter first; inside a chapter, the order of tracks.json. */
const newestFirst = (list: TrackInfo[]) =>
  list.map((t, i) => ({ t, i })).sort((x, y) => (y.t.chapter ?? 1) - (x.t.chapter ?? 1) || x.i - y.i).map((x) => x.t);
const upTo = (chapter: number) => newestFirst(tracks.filter((t) => (t.chapter ?? 1) <= chapter && t.id !== "white-label"));

function showMode(mode: "free" | "lesson" | "night"): void {
  lessonOverlay.hidden = mode !== "lesson";
  nightOverlay.hidden = mode !== "night";
  result.hidden = true;
  grid.hide();
  for (const s of [crate, phonesPanel, careerSheet]) s.hidden = true;
}

/** Free play: every chapter's records (a preview without progress yet), and your dubplate. */
function freePlay(): void {
  booth.clearSession();
  showMode("free");
  $("crate-button").hidden = false;
  $("jingle-button").hidden = true;
  fillCrate([...upTo(12), ...(cutPattern ? [cutInfo()] : [])]);
}

/** The crate: onto the left or the right deck. */
function fillCrate(list: TrackInfo[]): void {
  crateList.replaceChildren();
  for (const t of list) {
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
      b.addEventListener("click", () => {
        crate.hidden = true;
        if (booth.refuseLoad(d)) return; // back to back: her deck is hers
        loadRecord(d, t).catch((e) => { note.textContent = String(e); });
      });
      row.append(b);
    }
    crateList.append(row);
  }
}

// MARK: - The career (chapters, their lessons and nights)

function fillCareer(): void {
  if (!content) return;
  careerList.replaceChildren();
  for (const c of content.career.chapters) {
    const head = document.createElement("div");
    head.className = "chapter-head";
    head.innerHTML = `<span class="n"></span><b></b><p></p>`;
    head.querySelector(".n")!.textContent = String(c.number);
    head.querySelector("b")!.textContent = c.title;
    head.querySelector("p")!.textContent = c.line;
    careerList.append(head);
    for (const step of c.steps) {
      const row = document.createElement("button");
      row.className = `step-row ${step.kind}`;
      row.innerHTML = `<span class="k"></span><b></b><span class="c"></span>`;
      row.querySelector(".k")!.textContent = step.kind.toUpperCase();
      row.querySelector("b")!.textContent = step.title;
      let play: (() => Promise<void>) | null = null;
      for (const sc of step.screens) {
        if (sc.type === "lesson") { const id = sc.id; play = () => startLesson(id); }
        if (sc.type === "night") { const id = sc.id; play = () => startNight(id); }
      }
      row.querySelector(".c")!.textContent = play ? step.detail : `${step.detail} (story: not on the web yet)`;
      row.disabled = !play;
      row.addEventListener("click", () => {
        careerSheet.hidden = true;
        play?.().catch((e) => { note.textContent = String(e); });
      });
      careerList.append(row);
    }
  }
}

// MARK: - Lessons

async function startLesson(id: string, step = 0): Promise<void> {
  const lesson = content?.career.lessons.find((l) => l.id === id);
  if (!lesson || !content) throw new Error(`no lesson "${id}"`);
  const runner = new LessonRunner(lesson, content.career.handsOff);
  runner.startAt = step;
  note.textContent = `Lesson ${lesson.number}…`;
  await booth.startLesson(runner, firstTwo());
  note.textContent = "";
  showMode("lesson");
  if (lesson.desk.studio) {
    // A studio lesson starts from its own pattern, or an empty one; the dubplate lesson cuts what
    // you made (or the groove from the lessons).
    grid.pattern = lesson.desk.cutter && grid.pattern.rows.some((r) => r.some(Boolean)) ? grid.pattern : namedPattern(lesson.desk.pattern);
    grid.page = 0;
    loadLoop(grid.pattern, engine.decks[0], false);
    grid.show(lesson.desk.cutter);
  }
  $("lesson-words").hidden = lesson.desk.studio; // the grid takes the room; the coach is heard
  $("lesson-coach").textContent = lesson.coach;
  $("jingle-button").hidden = lesson.desk.room !== "studio";
  $("crate-button").hidden = !lesson.desk.crate;
  if (lesson.desk.crate) fillCrate(lesson.desk.bag ? lesson.desk.bag.map(trackFor).filter((t): t is TrackInfo => !!t) : upTo(lesson.desk.chapter));
  shownLesson = -1;
}

let shownLesson = -1;
function showLesson(): void {
  const r = booth.lesson;
  if (!r || r.version === shownLesson) return;
  shownLesson = r.version;
  if (r.stars !== null) {
    lessonOverlay.hidden = true;
    showResult(`LESSON ${r.lesson.number}`, r.lesson.title, r.stars, r.verdict, null);
    return;
  }
  $("lesson-chip").classList.toggle("done", r.taskDone);
  $("lesson-task").textContent = r.task;
  $("lesson-progress").textContent = r.progress;
  $("lesson-progress").hidden = !r.progress;
  $("lesson-caption").textContent = r.caption;
  // The page's buttons pulse when the coach points at them.
  $("crate-button").classList.toggle("pointed", r.target?.type === "crate");
  $("jingle-button").classList.toggle("pointed", r.target?.type === "jingle");
}

// MARK: - Nights

/** The crate of a night: its bag (MERIDIAN: then the white label, then your whole collection),
 * or the records of its chapter and the ones before. */
function nightCrate(info: NightInfo): TrackInfo[] {
  if (!info.bag) return upTo(info.chapter);
  const bag = info.bag.slice();
  if (info.lastRecord && !bag.includes(info.lastRecord)) bag.push(info.lastRecord);
  let list = bag.map(trackFor).filter((t): t is TrackInfo => !!t);
  if (info.wholeCollection) {
    list = list.concat(upTo(12).filter((t) => !bag.includes(t.id)));
    if (cutPattern && !bag.includes("your-dubplate")) list.push(cutInfo());
  }
  return list;
}

async function startNight(id: string, length: number | null = null): Promise<void> {
  const info = content?.career.nights.find((n) => n.id === id);
  if (!info || !content) throw new Error(`no night "${id}"`);
  const runner = new NightRunner(info, length ?? info.length, content.career.nightLines, content.career.handsOff);
  note.textContent = `${info.title}…`;
  await booth.startNight(runner, firstTwo());
  note.textContent = "";
  showMode("night");
  $("jingle-button").hidden = info.room !== "studio";
  $("crate-button").hidden = false;
  fillCrate(nightCrate(info));
  shownNight = -1;
}

let shownNight = -1;
function showNight(): void {
  const r = booth.night;
  if (!r || r.version === shownNight) return;
  shownNight = r.version;
  if (r.stars !== null) {
    nightOverlay.hidden = true;
    showResult("THE NIGHT IS OVER", r.title, r.stars, r.summary, r.missed);
    return;
  }
  const tint = ["rgba(255,255,255,0.6)", "var(--teal)", "var(--orange)", "var(--magenta)"][Math.min(3, Math.max(0, r.mood))];
  $("night-clock").textContent = r.clock;
  const bar = $("night-energy");
  bar.style.width = `${Math.max(4, r.energyShown * 100)}%`;
  bar.style.background = tint;
  const label = $("night-label");
  label.textContent = r.info.audience === "listeners" ? `${r.listeners} LISTENERS` : r.info.audience === "field" ? `${r.people} PEOPLE`
    : (content?.career.moods[Math.min(3, Math.max(0, r.mood))] ?? "");
  label.style.color = tint;
  $("night-words").hidden = !r.comment;
  $("night-by").textContent = r.commentBy;
  $("night-comment").textContent = r.comment;
}

// MARK: - The result card (a lesson's stars, a night's)

function showResult(kicker: string, title: string, stars: number, line: string, missed: string | null): void {
  result.hidden = false;
  $("result-number").textContent = kicker;
  $("result-title").textContent = title;
  $("result-stars").replaceChildren(...[0, 1, 2].map((i) => {
    const s = document.createElement("span");
    s.textContent = i < stars ? "★" : "☆";
    s.className = i < stars ? "on" : "";
    return s;
  }));
  $("result-verdict").textContent = line;
  $("result-missed").textContent = missed ?? "";
  $("result-missed").hidden = !missed;
  $("result-retry").hidden = !missed;
  $("result-continue").textContent = missed ? "BACK" : "CONTINUE";
}

$("result-retry").addEventListener("click", () => {
  const id = booth.night?.info.id;
  if (id) startNight(id).catch((e) => { note.textContent = String(e); });
});

$("result-continue").addEventListener("click", () => {
  // The chapter screens come next; for now: back to the career list.
  freePlay();
  careerSheet.hidden = false;
});

(function overlays() { showLesson(); showNight(); requestAnimationFrame(overlays); })();

// MARK: - Buttons

const sheets = [crate, phonesPanel, careerSheet];
const toggle = (sheet: HTMLElement) => { const open = sheet.hidden; for (const s of sheets) s.hidden = true; sheet.hidden = !open; };
start.addEventListener("click", () => { if (!start.classList.contains("busy")) begin(); });
$("crate-button").addEventListener("click", () => toggle(crate));
$("crate-close").addEventListener("click", () => { crate.hidden = true; });
$("phones-button").addEventListener("click", () => toggle(phonesPanel));
$("phones-close").addEventListener("click", () => { phonesPanel.hidden = true; });
$("career-button").addEventListener("click", () => toggle(careerSheet));
$("career-close").addEventListener("click", () => { careerSheet.hidden = true; });
$("free-play").addEventListener("click", () => freePlay());
$("jingle-button").addEventListener("click", playJingle);
for (const b of phonesPanel.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
  b.addEventListener("click", () => {
    engine.phones = b.dataset.mode === "split" ? "split" : "off";
    for (const o of phonesPanel.querySelectorAll("[data-mode]")) o.classList.toggle("on", o === b);
  });
}

if (params.has("autostart")) begin(); // screenshots (the browser is told to allow sound without a click)
