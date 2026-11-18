// Grooveline Headliner in the browser: the first playable booth (free play, two records).
// Browsers start sound only after a click or a touch, so the page waits for one.

import type { TrackInfo } from "./core/beatgrid.ts";
import { DeckEngine } from "./audio/engine.ts";
import { Booth } from "./booth/booth.ts";

const engine = new DeckEngine();
const canvas = document.getElementById("booth") as HTMLCanvasElement;
const room = document.getElementById("room") as HTMLElement;
const start = document.getElementById("start") as HTMLElement;
const crateList = document.getElementById("crate-list") as HTMLElement;
const crate = document.getElementById("crate") as HTMLElement;
const phonesPanel = document.getElementById("phones") as HTMLElement;
const note = document.getElementById("note") as HTMLElement;
const booth = new Booth(canvas, room, engine);
const params = new URLSearchParams(location.search);
// For the screenshot tool's `eval` (tools/shot.ts) and the browser console.
Object.assign(window, { headliner: { engine, booth } });

let tracks: TrackInfo[] = [];

// The canvas only uses a web font once it has loaded; ask for it now.
document.fonts.load(`600 16px "Barlow Condensed"`).catch(() => {});

async function loadRecord(d: number, track: TrackInfo): Promise<void> {
  const deck = engine.decks[d];
  if (deck.motorOn && Math.abs(deck.rate) > 0.1) {
    note.textContent = "Stop the deck before you change its record.";
    return;
  }
  note.textContent = `Loading ${track.title}…`;
  await engine.load(d, track, `assets/Tracks/${track.file}`);
  booth.recordChanged(d);
  note.textContent = "";
}

async function begin(): Promise<void> {
  start.classList.add("busy");
  try {
    await engine.start();
    tracks = await (await fetch("assets/Tracks/tracks.json")).json() as TrackInfo[];
    // Lessons rely on the first two records (122 and 124 BPM); free play starts with them too.
    await Promise.all([loadRecord(0, tracks[0]), loadRecord(1, tracks[1])]);
    start.hidden = true;
    fillCrate();
    if (params.has("demo")) booth.demo();
  } catch (e) {
    start.classList.remove("busy");
    start.querySelector("p")!.textContent = `Could not start the sound: ${e}`;
  }
  const c = engine.context;
  if (c) console.info(`audio ${c.sampleRate} Hz, latency ${(engine.latency * 1000).toFixed(1)} ms, shared memory ${engine.sharedMemory}`);
}

/** The crate: every record, newest chapter first, onto the left or the right deck. */
function fillCrate(): void {
  crateList.replaceChildren();
  const order = tracks.map((t, i) => ({ t, i })).sort((x, y) => (y.t.chapter ?? 1) - (x.t.chapter ?? 1) || x.i - y.i);
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

start.addEventListener("click", () => { if (!start.classList.contains("busy")) begin(); });
document.getElementById("crate-button")!.addEventListener("click", () => { crate.hidden = !crate.hidden; phonesPanel.hidden = true; });
document.getElementById("crate-close")!.addEventListener("click", () => { crate.hidden = true; });
document.getElementById("phones-button")!.addEventListener("click", () => { phonesPanel.hidden = !phonesPanel.hidden; crate.hidden = true; });
document.getElementById("phones-close")!.addEventListener("click", () => { phonesPanel.hidden = true; });
for (const b of phonesPanel.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
  b.addEventListener("click", () => {
    engine.phones = b.dataset.mode === "split" ? "split" : "off";
    for (const o of phonesPanel.querySelectorAll("[data-mode]")) o.classList.toggle("on", o === b);
  });
}

if (params.has("autostart")) begin(); // screenshots (the browser is told to allow sound without a click)
