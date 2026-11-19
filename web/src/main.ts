// Grooveline Headliner in the browser: title, chapters, story, lessons, nights and free play.
// Browsers start sound only after a click or a touch: the title's buttons are that click.
//   ?lesson=<id>[&step=<n>]   start straight in a lesson
//   ?night=<id>[&length=<s>]  start straight in a night (a short length for tests)
//   ?demo                     free play with both records turning (screenshots)
//   ?autostart                no click needed (screenshots; the browser must allow sound)
//   ?unlockAll=1|0            the hidden unlock, for tests

import type { TrackInfo } from "./core/beatgrid.ts";
import { DrumPattern } from "./core/drummachine.ts";
import { DeckEngine } from "./audio/engine.ts";
import { Booth } from "./booth/booth.ts";
import { loadContent } from "./game/content.ts";
import type { Chapter, ChapterStep, Content, NightInfo, Screen } from "./game/content.ts";
import { LessonRunner } from "./game/lesson.ts";
import { NightRunner } from "./game/night.ts";
import { StudioGrid, cutInfo, loadCut, loadLoop, namedPattern } from "./game/studio.ts";
import { StoryPlayer, loadScenes } from "./game/story.ts";
import type { StoryScene } from "./game/story.ts";
import * as Progress from "./game/progress.ts";
import { showChapter } from "./menus.ts";
import { groovelineLogo } from "./logo.ts";
import { fade } from "./fade.ts";
import { BagScreen } from "./game/bag.ts";
import type { PhonesMode } from "./audio/engine.ts";
import { FX_DIVISIONS, FX_TYPES } from "./audio/fx.ts";
import { Library } from "./library/library.ts";
import { buildPanel } from "./library/panel.ts";
import type { GridFix } from "./library/panel.ts";
import { analyse } from "./library/analyse.ts";
import { monoForAnalysis } from "./library/beats.ts";
import { trackId } from "./library/search.ts";
import { probeDuration } from "./library/duration.ts";
import type { LibraryTrack } from "./library/store.ts";
import { keyOf } from "./booth/booth.ts";
import type { Kind } from "./booth/booth.ts";
import { KEYS, attachKeys } from "./input/keys.ts";
import { MidiInput } from "./input/midi.ts";
import type { Binding, TargetKind } from "./input/midi.ts";
import { Credits } from "./game/credits.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new DeckEngine();
const booth = new Booth($<HTMLCanvasElement>("booth"), $("room"), engine);
const title = $("start"), chapterScreen = $("chapter"), crate = $("crate"), crateList = $("crate-list"), phonesPanel = $("phones"), note = $("note");
const lessonOverlay = $("lesson"), nightOverlay = $("night"), result = $("result");
const params = new URLSearchParams(location.search);

let content: Content | null = null;
let tracks: TrackInfo[] = [];
let scenes = new Map<string, StoryScene>();
const progress = Progress.loadProgress();
if (params.has("unlockAll")) Progress.setUnlockAll(params.get("unlockAll") !== "0");

// For the screenshot tool's `eval` (tools/shot.ts) and the browser console.
Object.assign(window, { headliner: { engine, booth, progress, credits: () => openCredits(), play: (chapter: number, step: number) => {
  const c = content?.career.chapters.find((x) => x.number === chapter);
  if (c) playSteps(c, [c.steps[step]]);
} } });

// The canvas only uses a web font once it has loaded; ask for it now.
document.fonts.load(`600 16px "Barlow Condensed"`).catch(() => {});

// MARK: - Records

/** Your dubplate: the pattern you cut (none yet: the groove from the lessons). */
let cutPattern: DrumPattern | null = progress.track ? new DrumPattern(progress.track) : null;

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
  userOnDeck[d] = null;
  myMusicPanel?.refresh();
  booth.recordChanged(d);
}

// MARK: - Your own music (free play): the MY MUSIC tab of the crate

const library = new Library();
/** The library track on each deck (null: a record of the game, or nothing). */
const userOnDeck: (LibraryTrack | null)[] = [null, null];
/** A track longer than this is too big to hold decoded (48 kHz stereo float: about 23 MB a minute, and a copy while loading). */
const MAX_MINUTES = 15;
let myMusicPanel: { refresh(): void } | null = null;

/** Opens a track of your library on a deck: decode, find its grid (your correction, an earlier analysis, or analysis now), play. */
async function loadUserTrack(d: number, t: LibraryTrack): Promise<void> {
  const deck = engine.decks[d];
  if (deck.motorOn && Math.abs(deck.rate) > 0.1) { note.textContent = "Stop the deck before you change its record."; return; }
  const name = t.artist ? `${t.artist} - ${t.title}` : t.title;
  try {
    note.textContent = `Opening ${name}…`;
    const file = await library.fileOf(t);
    // Ask the file how long it is before decoding it: an hour of music is two gigabytes in memory.
    const length = await probeDuration(file);
    if (length !== null && length > MAX_MINUTES * 60) { note.textContent = `${name} is ${Math.round(length / 60)} minutes long: too big to hold (the limit is ${MAX_MINUTES}).`; return; }
    let audio: AudioBuffer;
    try { audio = await engine.decode(await file.arrayBuffer()); }
    catch { note.textContent = `${name}: this browser cannot decode this ${t.ext.toUpperCase()} file.`; return; }
    if (audio.duration > MAX_MINUTES * 60) { note.textContent = `${name} is ${Math.round(audio.duration / 60)} minutes long: too big to hold (the limit is ${MAX_MINUTES}).`; return; }
    let grid: { bpm: number; firstBeat: number } | null = t.grid ?? (t.analysis ? { bpm: t.analysis.bpm, firstBeat: t.analysis.firstBeat } : null);
    if (!grid) {
      note.textContent = `Finding the beat of ${name}…`;
      const mono = monoForAnalysis(audio.getChannelData(0), audio.getChannelData(Math.min(1, audio.numberOfChannels - 1)), audio.sampleRate);
      const tempo = await analyse(mono.data, mono.rate, t.tagBpm);
      if (tempo) {
        t.analysis = { bpm: tempo.bpm, firstBeat: tempo.firstBeat, confidence: tempo.confidence };
        grid = { bpm: tempo.bpm, firstBeat: tempo.firstBeat };
        await library.update(t);
      }
    }
    const info: TrackInfo = {
      id: trackId(t), title: t.title, artist: t.artist, label: t.album, genre: t.genre, bpm: grid?.bpm ?? (t.tagBpm || 120),
      key: t.musicKey, camelot: t.camelot, bars: 0, seconds: audio.duration, file: "", chapter: null,
    };
    deck.loadDecoded(info, audio, grid ?? undefined);
    userOnDeck[d] = t;
    booth.recordChanged(d);
    const unsure = !grid || (!t.grid && !!t.analysis && t.analysis.confidence < 0.25);
    note.textContent = unsure ? `${name}: the beat is not clear. Check the grid (CRATE, MY MUSIC).` : "";
  } catch (e) {
    note.textContent = `${name}: ${e instanceof Error ? e.message : "could not be opened"}`;
  }
  myMusicPanel?.refresh();
}

// For the screenshot tool's `eval` (tools/shot.ts): the library and its loader.
Object.assign((window as unknown as { headliner: object }).headliner, { library, loadUserTrack: (d: number, t: LibraryTrack) => loadUserTrack(d, t), userOnDeck, fixGrid, showCrateTab });

function userLoaded(): ({ track: LibraryTrack; bpm: number; unsure: boolean } | null)[] {
  return [0, 1].map((d) => {
    const track = userOnDeck[d];
    if (!track || !engine.decks[d].isLoaded) return null;
    return { track, bpm: engine.decks[d].grid.bpm, unsure: !track.grid && (!track.analysis || track.analysis.confidence < 0.25) };
  });
}

/** The buttons under the list: half or double the tempo, a hundredth of a BPM either way, the first beat to the CUE mark. */
function fixGrid(d: number, what: GridFix): void {
  const t = userOnDeck[d], deck = engine.decks[d];
  if (!t || !deck.isLoaded) return;
  let bpm = deck.grid.bpm, first = deck.grid.firstBeat;
  if (what === "half") bpm /= 2;
  else if (what === "double") bpm *= 2;
  else if (what === "down") bpm -= 0.1;
  else if (what === "up") bpm += 0.1;
  else first = deck.cuePoint;
  bpm = Math.max(30, Math.min(300, Math.round(bpm * 100) / 100));
  deck.setGrid(bpm, first);
  t.grid = { bpm, firstBeat: deck.grid.firstBeat };
  library.update(t).catch(() => {});
  myMusicPanel?.refresh();
}

function showCrateTab(tab: "records" | "mine"): void {
  $("crate-list").hidden = tab !== "records";
  $("mymusic").hidden = tab !== "mine";
  $("tab-records").classList.toggle("on", tab === "records");
  $("tab-mine").classList.toggle("on", tab === "mine");
  if (tab !== "mine") return;
  myMusicPanel ??= buildPanel($("mymusic"), library, {
    load: (d, t) => { crate.hidden = true; if (booth.refuseLoad(d)) return; loadUserTrack(d, t).catch(failed); },
    loaded: userLoaded,
    fix: fixGrid,
  });
  library.init().then(() => myMusicPanel?.refresh()).catch(failed);
}
$("tab-records").addEventListener("click", () => showCrateTab("records"));
$("tab-mine").addEventListener("click", () => showCrateTab("mine"));

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
  progress.track = cutPattern.rows.map((r) => r.slice());
  Progress.saveProgress(progress);
  loadCut(cutPattern, engine.decks[0]);
  booth.recordChanged(0);
  cuts += 1;
};
(function follow() { grid.follow(engine.decks[0]); requestAnimationFrame(follow); })();

// MARK: - Start

let starting: Promise<void> | null = null;

/** Sound on, content read (once; the first click on the title does it). */
function ensureStarted(): Promise<void> {
  starting ??= (async () => {
    title.classList.add("busy");
    try {
      await engine.start();
      content = await loadContent();
      scenes = await loadScenes();
      tracks = content.tracks;
      booth.tracks = tracks;
    } catch (e) {
      starting = null;
      title.querySelector(".hint")!.textContent = `Could not start: ${e}`;
      throw e;
    } finally {
      title.classList.remove("busy");
    }
    const c = engine.context;
    if (c) console.info(`audio ${c.sampleRate} Hz, latency ${(engine.latency * 1000).toFixed(1)} ms, shared memory ${engine.sharedMemory}`);
  })();
  return starting;
}

const failed = (e: unknown) => { note.textContent = String(e); console.error(e); };

/** The links for tests and screenshots. */
async function autostart(): Promise<void> {
  await ensureStarted();
  const lesson = params.get("lesson"), night = params.get("night");
  title.hidden = true;
  if (lesson) await startLesson(lesson, Number(params.get("step") ?? 0));
  else if (night) await startNight(night, Number(params.get("length") ?? 0) || null);
  else {
    await openFreePlay();
    if (params.has("demo")) booth.demo();
  }
}

const firstTwo = () => [tracks[0].id, tracks[1].id];

/** Newest chapter first; inside a chapter, the order of tracks.json. */
const newestFirst = (list: TrackInfo[]) =>
  list.map((t, i) => ({ t, i })).sort((x, y) => (y.t.chapter ?? 1) - (x.t.chapter ?? 1) || x.i - y.i).map((x) => x.t);
const upTo = (chapter: number) => newestFirst(tracks.filter((t) => (t.chapter ?? 1) <= chapter && t.id !== "white-label"));

function showMode(mode: "free" | "lesson" | "night" | "story" | "menu"): void {
  setMenuMusic(mode === "menu");
  lessonOverlay.hidden = mode !== "lesson";
  nightOverlay.hidden = mode !== "night";
  result.hidden = true;
  grid.hide();
  for (const s of [crate, phonesPanel]) s.hidden = true;
  if (mode !== "menu") { title.hidden = true; chapterScreen.hidden = true; }
}

// MARK: - Title and chapters

groovelineLogo(title.querySelector<HTMLElement>(".logo")!, 30);

// The menu music (Saturday Job, a 16-bar loop) on the title and the chapter screens, fading out
// on every other screen, as on the iPhone. Browsers allow it only after a first click or key.
let menuMusic: HTMLAudioElement | null = null;
let menuWanted = false;
function setMenuMusic(on: boolean): void {
  menuWanted = on;
  if (on) {
    if (!menuMusic) {
      menuMusic = new Audio("assets/Art/menu-loop.m4a");
      menuMusic.loop = true;
      menuMusic.volume = 0;
    }
    const m = menuMusic;
    if (m.paused) m.play().then(() => fade(m, 0.55, 1.2)).catch(() => {});
    else fade(m, 0.55, 1.2);
  } else if (menuMusic && !menuMusic.paused) {
    const m = menuMusic;
    fade(m, 0, 0.5);
    setTimeout(() => { if (!menuWanted) m.pause(); }, 550);
  }
}
const firstGesture = () => { if (menuWanted && menuMusic?.paused !== false) setMenuMusic(true); };
window.addEventListener("pointerdown", firstGesture);
window.addEventListener("keydown", firstGesture);

/** MERIDIAN played (it has a star) or its ending seen. */
const careerOver = () => (progress.stars["meridian"] ?? 0) > 0 || progress.seen.includes("meridian-end");

function showTitle(): void {
  sequence = null;
  booth.clearSession();
  for (const deck of engine.decks) deck.motorOn = false;
  showMode("menu");
  chapterScreen.hidden = true;
  title.hidden = false;
  $("title-ending").hidden = !(careerOver() || Progress.unlockedAll());
}

function openChapter(n: number): void {
  if (!content) return;
  const chapters = content.career.chapters;
  const chapter = chapters.find((c) => c.number === n) ?? chapters[0];
  sequence = null;
  booth.clearSession();
  for (const deck of engine.decks) deck.motorOn = false;
  showMode("menu");
  title.hidden = true;
  showChapter(chapterScreen, chapters, chapter, progress, {
    play: (steps) => playSteps(chapter, steps),
    open: (m) => openChapter(m),
    back: () => showTitle(),
  });
}

$("title-play").addEventListener("click", () => {
  // The chapter you are up to.
  ensureStarted().then(() => openChapter(Progress.current(progress, content!.career.chapters))).catch(failed);
});
$("title-free").addEventListener("click", () => { ensureStarted().then(() => openFreePlay()).catch(failed); });
$("title-ending").addEventListener("click", () => {
  // Once the career is over: Lia, the credits and zdB's record again.
  ensureStarted().then(() => playScreens([{ type: "story", id: "meridian-end" }, { type: "credits" }])).catch(failed);
});

// Zé's hidden unlock, as on the iPhone: hold the Grooveline logo three seconds.
{
  const logo = title.querySelector<HTMLElement>(".logo")!;
  let timer: number | null = null;
  logo.addEventListener("pointerdown", () => {
    timer = window.setTimeout(() => {
      Progress.setUnlockAll(!Progress.unlockedAll());
      const toast = $("title-toast");
      toast.textContent = Progress.unlockedAll() ? "EVERY CHAPTER OPEN" : "CHAPTERS IN ORDER";
      toast.hidden = false;
      setTimeout(() => { toast.hidden = true; }, 2000);
      $("title-ending").hidden = !(careerOver() || Progress.unlockedAll());
      timer = null;
    }, 3000);
  });
  const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  logo.addEventListener("pointerup", cancel);
  logo.addEventListener("pointerleave", cancel);
}

// MARK: - Free play and the crate

async function openFreePlay(): Promise<void> {
  showMode("free");
  // Lessons rely on the first two records (122 and 124 BPM); free play starts with them too.
  if (!engine.decks[0].isLoaded || !engine.decks[1].isLoaded) await Promise.all([loadRecord(0, tracks[0]), loadRecord(1, tracks[1])]);
  freePlay();
}

/** Free play: the records of the chapters played so far (the white label once it was played at
 * MERIDIAN), and your dubplate once it is cut. */
function freePlay(): void {
  sequence = null;
  booth.clearSession();
  midi.resetTakeover();
  showMode("free");
  $("crate-button").hidden = false;
  $("jingle-button").hidden = true;
  const open = content ? Progress.recordsOpen(progress, content.career.chapters) : new Set([1]);
  const meridian = (progress.stars["meridian"] ?? 0) > 0;
  fillCrate([...newestFirst(tracks.filter((t) => open.has(t.chapter ?? 1) && (t.id !== "white-label" || meridian))),
             ...(cutPattern ? [cutInfo()] : [])]);
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
        loadRecord(d, t).catch(failed);
      });
      row.append(b);
    }
    crateList.append(row);
  }
}

// MARK: - Playing steps (their screens one after the other)

/** What is being played from a chapter: the steps left, and the screens of the current one. */
let sequence: { chapter: Chapter | null; steps: ChapterStep[]; screens: Screen[]; at: number } | null = null;

function playSteps(chapter: Chapter, steps: ChapterStep[]): void {
  if (steps.length === 0) return;
  sequence = { chapter, steps, screens: withBag(steps[0].screens), at: -1 };
  nextScreen();
}

/** Screens with no step around them (THE ENDING from the title). */
function playScreens(screens: Screen[]): void {
  sequence = { chapter: null, steps: [], screens, at: -1 };
  nextScreen();
}

/** THE NIGHT BEFORE and MERIDIAN play the bag you packed: with none packed yet, THE BAG comes
 * first (before the scenes that lead into the night), instead of a set of records not yours. */
function withBag(screens: Screen[]): Screen[] {
  if (progress.closingSet?.length === 6 || screens.some((s) => s.type === "bag")) return screens;
  const at = screens.findIndex((s) => s.type === "night" && content?.career.nights.find((n) => n.id === s.id)?.closingSet);
  if (at < 0) return screens;
  let before = at;
  while (before > 0 && screens[before - 1].type === "story") before -= 1;
  return [...screens.slice(0, before), { type: "bag" }, ...screens.slice(before)];
}

function nextScreen(): void {
  const seq = sequence;
  if (!seq) return;
  seq.at += 1;
  const screen = seq.screens[seq.at];
  if (!screen) {
    // The step is over: a story step counts as seen; then the next step, or back to the chapter.
    const step = seq.steps[0];
    if (step?.kind === "story") Progress.markSeen(progress, step.id);
    seq.steps = seq.steps.slice(1);
    if (seq.steps.length > 0) {
      seq.screens = withBag(seq.steps[0].screens);
      seq.at = -1;
      nextScreen();
      return;
    }
    const back = seq.chapter;
    sequence = null;
    if (back) openChapter(back.number);
    else showTitle();
    return;
  }
  switch (screen.type) {
    case "story": playStory(scenes.get(screen.id) ?? card(`(${screen.id})`)); break;
    case "lesson": startLesson(screen.id).catch(failed); break;
    case "night": startNight(screen.id).catch(failed); break;
    case "bag": openBag(); break;
    case "credits": openCredits(); break;
    default: nextScreen();
  }
}

/** A title card, as a scene of its own. */
const card = (...lines: string[]): StoryScene => ({ id: "card", shots: [{ lines: lines.map((text) => ({ who: "", text })) }] });

function quietBooth(): void {
  booth.clearSession();
  for (const deck of engine.decks) deck.motorOn = false; // the screen has the room to itself
}

function playStory(scene: StoryScene): void {
  quietBooth();
  showMode("story");
  // A scene watched to the end counts as seen (the ending's scene opens THE ENDING on the title).
  new StoryPlayer($("story"), scene, () => { Progress.markSeen(progress, scene.id); nextScreen(); }).start();
}

let bag: BagScreen | null = null;
function openBag(): void {
  quietBooth();
  showMode("story");
  // Your records: every record of the career (no white label) and your dubplate.
  const records = [...upTo(12), ...(cutPattern ? [cutInfo()] : [])];
  bag = new BagScreen($("bag"), records, (id) => (id ? trackFor(id) : null), progress.closingSet, (ids) => {
    bag = null;
    progress.closingSet = ids;
    Progress.saveProgress(progress);
    Progress.markSeen(progress, "the-bag");
    nextScreen();
  }, () => { bag = null; leave(); });
  bag.show();
}

let credits: Credits | null = null;
function openCredits(): void {
  quietBooth();
  showMode("story");
  credits = new Credits($("credits"), () => {
    // The game is over: back to the title, nothing lined up.
    credits = null;
    sequence = null;
    showTitle();
  });
  credits.start();
}

// MARK: - Lessons

async function startLesson(id: string, step = 0): Promise<void> {
  const lesson = content?.career.lessons.find((l) => l.id === id);
  if (!lesson || !content) throw new Error(`no lesson "${id}"`);
  const runner = new LessonRunner(lesson, content.career.handsOff);
  runner.startAt = step;
  showMode("lesson");
  lessonOverlay.hidden = true;
  note.textContent = `Lesson ${lesson.number}…`;
  await booth.startLesson(runner, firstTwo());
  midi.resetTakeover(); // the desk was reset: faders on the controller catch up first
  note.textContent = "";
  lessonOverlay.hidden = false;
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
  const written = content?.career.nights.find((n) => n.id === id);
  if (!written || !content) throw new Error(`no night "${id}"`);
  // THE NIGHT BEFORE and MERIDIAN play the bag you packed: its first two records on the decks,
  // its six in the crate (your dubplate keeps its place).
  const packed = written.closingSet && progress.closingSet?.length === 6
    ? progress.closingSet.filter((x) => x === "your-dubplate" || tracks.some((t) => t.id === x)) : null;
  const info: NightInfo = packed && packed.length >= 2 ? { ...written, records: packed.slice(0, 2), bag: packed } : written;
  const runner = new NightRunner(info, length ?? info.length, content.career.nightLines, content.career.handsOff);
  showMode("night");
  nightOverlay.hidden = true;
  note.textContent = `${info.title}…`;
  await booth.startNight(runner, firstTwo());
  midi.resetTakeover();
  note.textContent = "";
  nightOverlay.hidden = false;
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

function showResult(kicker: string, heading: string, stars: number, line: string, missed: string | null): void {
  result.hidden = false;
  $("result-number").textContent = kicker;
  $("result-title").textContent = heading;
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
  if (id) startNight(id).catch(failed);
});

$("result-continue").addEventListener("click", () => {
  // The stars count at CONTINUE (never on BACK, which leaves the step).
  const lesson = booth.lesson, night = booth.night;
  const missed = !!night?.missed;
  if (lesson && lesson.stars !== null) Progress.record(progress, lesson.lesson.id, lesson.stars);
  if (night && night.stars !== null && !missed) Progress.record(progress, night.info.id, night.stars);
  result.hidden = true;
  if (sequence && !missed) { nextScreen(); return; }
  leave();
});

/** Back: leaves the lesson, night or story (and whatever was lined up after it). */
function leave(): void {
  bag?.close();
  bag = null;
  credits?.stop();
  credits = null;
  for (const v of document.querySelectorAll<HTMLVideoElement>("#story video")) v.pause();
  $("story").hidden = true;
  $("story").replaceChildren();
  const back = sequence?.chapter;
  sequence = null;
  if (back) openChapter(back.number);
  else showTitle();
}

(function overlays() { showLesson(); showNight(); requestAnimationFrame(overlays); })();

// MARK: - Buttons

const sheets = [crate, phonesPanel, $("controls")];
const toggle = (sheet: HTMLElement) => { const open = sheet.hidden; for (const s of sheets) s.hidden = true; sheet.hidden = !open; };
$("back").addEventListener("click", leave);
$("crate-button").addEventListener("click", () => {
  toggle(crate);
  // Your own music is free play's: in a lesson or a night the crate is the game's.
  const free = !booth.lesson && !booth.night;
  $("crate-tabs").hidden = !free;
  if (!free) showCrateTab("records");
});
$("crate-close").addEventListener("click", () => { crate.hidden = true; });
$("phones-close").addEventListener("click", () => { phonesPanel.hidden = true; });
$("jingle-button").addEventListener("click", playJingle);
$("controls-button").addEventListener("click", () => { fillControls(); toggle($("controls")); });

// FULLSCREEN: the whole page (the booth redraws to the new size by itself). Not offered where the
// browser has none (iPhone Safari).
const fullscreenButton = $("fullscreen-button");
if (document.fullscreenEnabled) {
  fullscreenButton.hidden = false;
  fullscreenButton.addEventListener("click", () => {
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => { fullscreenButton.textContent = document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN"; });
}
$("controls-close").addEventListener("click", () => { $("controls").hidden = true; });
$("phones-button").addEventListener("click", () => { fillPhones().then(() => toggle(phonesPanel)).catch(failed); });

// MARK: - PHONES: how the headphones are fed

const el = (tag: string, className = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

engine.onOutputsChanged = (why) => {
  note.textContent = why;
  setTimeout(() => { if (note.textContent === why) note.textContent = ""; }, 6000);
  if (!phonesPanel.hidden) fillPhones().catch(() => {});
};

/** The modes this browser and this hardware can do, and the sound devices to choose from. */
async function fillPhones(): Promise<void> {
  const body = $("phones-body");
  body.replaceChildren();
  const modes: { mode: PhonesMode; title: string; about: string; can: boolean; why?: string }[] = [
    { mode: "off", title: "OFF", about: "The room in stereo. No headphone feed.", can: true },
    { mode: "split", title: "SPLIT L/R", about: "One stereo output and a splitter cable: the room in the left ear, the next record in the right.", can: true },
    { mode: "card", title: "SOUND CARD", about: "A sound card with four outputs: the room on 1-2, the headphones on 3-4.", can: engine.cardAvailable,
      why: "No sound card with four outputs is the output right now (on Linux, give the card a 4.0 or pro-audio profile)." },
    { mode: "second", title: "TWO DEVICES", about: "The room on one sound device, the headphones on another (a USB headphone adapter, a second card). The headphones can run a little behind the speakers.",
      can: DeckEngine.canChoosePhones, why: "This browser cannot choose a second sound device (Chrome or Edge on a computer can)." },
  ];
  for (const m of modes) {
    const row = el("div", `mode${engine.phones === m.mode ? " on" : ""}${m.can ? "" : " off"}`);
    const b = el("button", `pill${engine.phones === m.mode ? " on" : ""}`, m.title) as HTMLButtonElement;
    b.disabled = !m.can;
    b.addEventListener("click", () => {
      engine.setPhones(m.mode).then(() => fillPhones()).catch((e) => { note.textContent = e instanceof Error ? e.message : String(e); });
    });
    row.append(b, el("p", "", m.can ? m.about : `${m.about} ${m.why ?? ""}`));
    body.append(row);
  }
  // TWO DEVICES: the headphones' timing, measured, and set by ear.
  if (engine.phones === "second") {
    const t = engine.timing;
    const box = el("div", "timing");
    box.append(el("span", "head", "HEADPHONES TIMING"));
    box.append(el("p", "small", t.ring
      ? `Room about ${t.roomMs} ms, headphones about ${t.phonesMs} ms: the room waits ${t.roomWaitsMs} ms so both sound together.`
      : "This page has no shared memory, so the headphones go through a slower stream: set the timing by ear."));
    const row = el("div", "trim");
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "-150"; slider.max = "400"; slider.step = "5";
    slider.value = String(engine.phonesTrimMs);
    const value = el("span", "ms", `${engine.phonesTrimMs > 0 ? "+" : ""}${engine.phonesTrimMs} ms`);
    slider.addEventListener("input", () => {
      engine.setPhonesTrim(Number(slider.value));
      value.textContent = `${engine.phonesTrimMs > 0 ? "+" : ""}${engine.phonesTrimMs} ms`;
    });
    row.append(el("span", "end", "HEADPHONES EARLY"), slider, el("span", "end", "HEADPHONES LATE"), value);
    box.append(row, el("p", "small", "By ear: turn the cue mix knob to ROOM and play a record. Move the slider until the headphones and the speakers sound as one (no echo). Kept for this headphone device."));
    body.append(box);
  }
  // The devices, where the browser lets us choose them.
  if (DeckEngine.canChooseRoom || DeckEngine.canChoosePhones) {
    const outputs = await engine.listOutputs().catch(() => []);
    const named = outputs.some((o) => o.label && !/^Output \d+$/.test(o.label));
    const pick = (label: string, current: string, set: (id: string) => Promise<void>) => {
      const wrap = el("label", "device");
      wrap.append(el("span", "", label));
      const select = document.createElement("select");
      for (const o of [{ id: "", label: "System default" }, ...outputs.filter((x) => x.id !== "")]) {
        const opt = document.createElement("option");
        opt.value = o.id;
        opt.textContent = o.label;
        opt.selected = o.id === current;
        select.append(opt);
      }
      select.addEventListener("change", () => { set(select.value).then(() => fillPhones()).catch(failed); });
      wrap.append(select);
      return wrap;
    };
    if (DeckEngine.canChooseRoom) body.append(pick("ROOM (SPEAKERS)", engine.roomDevice, (id) => engine.setRoomDevice(id)));
    if (DeckEngine.canChoosePhones) body.append(pick("HEADPHONES", engine.phonesDevice, (id) => engine.setPhonesDevice(id)));
    if (!named) {
      const ask = el("button", "quiet", "SHOW MY SOUND DEVICES");
      ask.addEventListener("click", () => { engine.allowDeviceNames().then(() => fillPhones()).catch(failed); });
      body.append(ask, el("p", "small", "The browser asks for the microphone only to show the names of your sound devices. It is switched off at once; nothing is recorded."));
    }
  }
}

// MARK: - KEYS & MIDI

/** "play:0:" and the like back into a control of the booth. */
function kindFromKey(key: string): Kind | null {
  const [t, ds, bs] = key.split(":");
  const d = Number(ds), band = Number(bs);
  switch (t) {
    case "play": case "cue": case "sync": case "phones": case "pitch": case "channel": case "filter": case "trim": case "jog":
      return { t, d } as Kind;
    case "eq": return { t: "eq", d, band };
    case "cross": return { t: "cross" };
    case "cueMix": return { t: "cueMix" };
    case "phonesLevel": return { t: "phonesLevel" };
    case "fxOn": return { t: "fxOn" };
    case "fxAmount": return { t: "fxAmount" };
    case "fxType": case "fxDiv": return { t, d } as Kind;
    default: return null;
  }
}

function targetKind(key: string): TargetKind | null {
  const t = key.split(":")[0];
  if (["play", "sync", "phones", "fxOn", "fxType", "fxDiv"].includes(t)) return "button";
  if (t === "jog") return "relative";
  if (t === "nudge" || t === "cue") return "hold"; // held down: a nudge pushes, CUE plays from its mark
  if (["pitch", "channel", "cross", "eq", "filter", "trim", "cueMix", "phonesLevel", "fxAmount"].includes(t)) return "absolute";
  return null;
}

/** "LEFT PITCH", "RIGHT LOW", "CROSSFADER" for a control. */
function labelOf(key: string): string {
  const [t, ds, bs] = key.split(":");
  if (t === "fxOn") return "EFFECT ON";
  if (t === "fxAmount") return "EFFECT AMOUNT";
  if (t === "fxType") return `EFFECT ${FX_TYPES[Number(ds)] ?? "(NEXT)"}`;
  if (t === "fxDiv") return `NOTE ${FX_DIVISIONS[Number(ds)]?.label ?? "(NEXT)"}`;
  const side = ds === "0" ? "LEFT " : ds === "1" ? "RIGHT " : "";
  const names: Record<string, string> = { play: "PLAY", cue: "CUE", sync: "SYNC", phones: "PHONES", pitch: "PITCH", channel: "FADER",
    filter: "FILTER", trim: "GAIN", jog: "JOG (THE RECORD)", cross: "CROSSFADER", cueMix: "CUE MIX", phonesLevel: "HEADPHONES LEVEL" };
  if (t === "eq") return `${side}${["LOW", "MID", "HI"][Number(bs)] ?? "EQ"}`;
  if (t === "nudge") return `${side}NUDGE ${bs === "-1" ? "BACK" : "FORWARD"} (BUTTON)`;
  return `${side}${names[t] ?? t.toUpperCase()}`;
}

const midi = new MidiInput({
  kindOf: targetKind,
  press: (key) => { const k = kindFromKey(key); if (k) booth.press(k); },
  setValue: (key, v) => { const k = kindFromKey(key); if (k) booth.setValue(k, v); },
  valueOf: (key) => { const k = kindFromKey(key); return k ? booth.valueOf(k) : 0; },
  jog: (key, ticks) => { const k = kindFromKey(key); if (k && "d" in k) booth.jog(k.d, ticks); },
  // "nudge:<deck>:<-1 back | 1 forward>": held down, the record is held back or pushed on.
  // "cue:<deck>:": held down, the record plays from the cue mark; let go, it goes back to it.
  hold: (key, on) => {
    const [t, d, dir] = key.split(":");
    if (t === "cue") { if (on) booth.press({ t: "cue", d: Number(d) }); else booth.release({ t: "cue", d: Number(d) }); return; }
    booth.nudgeKey(Number(d), on ? Number(dir) : 0);
  },
});
midi.onChange = () => { if (!$("controls").hidden) fillControls(); };

const describe = (b: Binding): string => {
  const [type, ch, num] = b.source.split(":");
  const what = type === "cc" ? `CC ${num}` : type === "note" ? `NOTE ${num}` : "PITCH BEND";
  return `${what} · CH ${Number(ch) + 1}`;
};

function setLearn(on: boolean): void {
  $("learn").hidden = !on;
  booth.learnPick = on ? (kind) => {
    if (kind.t === "jog") { chooseRecordControl(kind.d); return; }
    learnTarget(keyOf(kind));
  } : null;
  if (on) $("learn-text").textContent = "MIDI LEARN: click a control on the decks (a record: its jog wheel or nudge buttons), then move one on your controller.";
  else { midi.stopLearning(); $("learn-choice").replaceChildren(); }
}

/** Waits for the controller's move for this control, and says what to move. */
function learnTarget(key: string): void {
  const kindOf = targetKind(key);
  $("learn-choice").replaceChildren();
  if (!kindOf) { $("learn-text").textContent = "That one cannot be learned. Click a button, knob, fader or a record."; return; }
  midi.learn(key, kindOf);
  const what = kindOf === "button" || kindOf === "hold" ? "a button" : kindOf === "relative" ? "a jog wheel" : "a knob or a fader";
  $("learn-text").textContent = `${labelOf(key)}: now ${kindOf === "button" || kindOf === "hold" ? "press" : "move"} ${what} on your controller.`;
}

/** A record can be moved by a jog wheel, or by two buttons (one holds it back, one pushes it on). */
function chooseRecordControl(d: number): void {
  const side = d === 0 ? "LEFT" : "RIGHT";
  $("learn-text").textContent = `${side} RECORD: what moves it on your controller?`;
  const choice = $("learn-choice");
  choice.replaceChildren();
  for (const [title, key] of [["JOG WHEEL", `jog:${d}:`], ["NUDGE BACK BUTTON", `nudge:${d}:-1`], ["NUDGE FORWARD BUTTON", `nudge:${d}:1`]]) {
    const b = el("button", "pill", title);
    b.addEventListener("click", () => learnTarget(key));
    choice.append(b);
  }
}
midi.onLearned = (b, device) => {
  const how = b.kind === "button" || b.kind === "hold" ? (b.mode === "toggle" ? " (toggle button)" : " (push button)") : "";
  $("learn-text").textContent = `Learned: ${describe(b)} on ${device} → ${labelOf(b.target)}${how}. Click the next control, or DONE.`;
};
$("learn-done").addEventListener("click", () => { setLearn(false); fillControls(); });

function fillControls(): void {
  const body = $("controls-body");
  body.replaceChildren();
  const keys = el("div", "keys");
  keys.append(el("h3", "", "KEYBOARD"), el("p", "small", "Shift: small steps. ?: this sheet. CUE: stopped, it marks the spot and plays while you hold it, then goes back to the mark. Playing, it stops at the mark. PLAY during the hold keeps it playing."));
  const table = el("div", "keytable");
  for (const k of KEYS) table.append(el("kbd", "", k.label), el("span", "", k.does));
  keys.append(table);
  const m = el("div", "midi");
  m.append(el("h3", "", "MIDI / USB CONTROLLERS"));
  if (!MidiInput.supported) {
    m.append(el("p", "small", "This browser has no MIDI (Safari). Chrome, Edge, Firefox and Opera do."));
  } else if (!midi.connected) {
    const connect = el("button", "pill", "CONNECT MIDI");
    connect.addEventListener("click", () => { midi.connect().then(() => fillControls()).catch(failed); });
    m.append(el("p", "small", "Any MIDI controller, or a USB one that speaks MIDI. The browser asks once."), connect);
  } else {
    const devices = midi.devices();
    m.append(el("p", "small", devices.length ? `Connected: ${devices.join(", ")}` : "No controller connected. Plug one in (it shows up here)."));
    const learn = el("button", "pill", "LEARN");
    learn.addEventListener("click", () => { $("controls").hidden = true; setLearn(true); });
    m.append(learn);
    for (const [device, list] of Object.entries(midi.allBindings())) {
      if (!list.length) continue;
      m.append(el("h4", "", device));
      for (const b of list) {
        const row = el("div", "binding");
        row.append(el("span", "src", describe(b)), el("span", "dst", labelOf(b.target)));
        if (b.kind === "button" || b.kind === "hold") {
          const mode = el("button", "mini", b.mode === "toggle" ? "TOGGLE" : "PUSH");
          mode.title = "Push buttons act when pressed; toggle (latching) buttons act on every change.";
          mode.addEventListener("click", () => midi.setMode(device, b.source, b.mode === "toggle" ? "push" : "toggle"));
          row.append(mode);
        }
        const forget = el("button", "mini", "×");
        forget.addEventListener("click", () => midi.forget(device, b.source));
        row.append(forget);
        m.append(row);
      }
    }
  }
  body.append(keys, m);
}

Object.assign((window as unknown as { headliner: object }).headliner, { midi, learn: setLearn, menu: () => menuMusic });

// Keys and controllers work only while the booth is on screen (not a menu, a scene, the bag, the
// credits or a result card).
const boothActive = () => title.hidden && chapterScreen.hidden && $("story").hidden && $("bag").hidden && $("credits").hidden && result.hidden;
midi.active = boothActive;
attachKeys(booth, boothActive, () => { fillControls(); toggle($("controls")); });

if (params.has("autostart")) autostart().catch(failed); // screenshots (the browser allows sound without a click)
else showTitle();
