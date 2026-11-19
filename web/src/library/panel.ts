// The MY MUSIC tab of the crate: your folders, a search box, the list, and the fixes for the grid of
// what is on the decks.

import { Library } from "./library.ts";
import { labelOf } from "./search.ts";
import { filterIndex } from "./search.ts";
import { TAGS_VERSION } from "./scan.ts";
import { SLEEVE_PX, Sleeves, paintGenerated, paintSleeve } from "./sleeves.ts";
import type { LibraryTrack } from "./store.ts";

export type GridFix = "half" | "double" | "down" | "up" | "here";

export interface PanelHooks {
  load(deck: number, track: LibraryTrack): void;
  /** The library track on each deck (null: a record of the game, or nothing), with the tempo of its grid now. */
  loaded(): ({ track: LibraryTrack; bpm: number; unsure: boolean } | null)[];
  fix(deck: number, what: GridFix): void;
}

const SHOWN = 120;

const make = (tag: string, className = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const button = (text: string, className: string, onClick: () => void, title = ""): HTMLButtonElement => {
  const b = make("button", className, text) as HTMLButtonElement;
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
};

type View = "sleeves" | "list";
const VIEW_KEY = "headliner.myMusicView";
const savedView = (): View => { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "sleeves"; } catch { return "sleeves"; } };

/** Builds the tab in `root`; the returned `refresh` redraws it (the page calls it after a load or a fix). */
export function buildPanel(root: HTMLElement, lib: Library, hooks: PanelHooks, sleeves: Sleeves): { refresh(): void } {
  const top = make("div", "mm-top");
  const status = make("p", "mm-status");
  const search = make("input", "mm-search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "SEARCH ARTIST, TITLE, KEY, BPM";
  let view = savedView();
  const viewSleeves = button("SLEEVES", "mini", () => setView("sleeves"), "The covers of your records, like a crate");
  const viewList = button("LIST", "mini", () => setView("list"), "A list with the tempo and key of each");
  const bar = make("div", "mm-bar");
  bar.append(search, viewSleeves, viewList);
  const list = make("div", "mm-list");
  const loaded = make("div", "mm-loaded");
  root.replaceChildren(top, status, bar, list, loaded);
  function setView(v: View): void {
    view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ }
    drawList();
  }

  const picker = make("input") as HTMLInputElement;
  picker.type = "file";
  picker.multiple = true;
  picker.hidden = true;
  picker.setAttribute("webkitdirectory", "");
  picker.addEventListener("change", () => { lib.addFromFiles([...(picker.files ?? [])]).catch(() => {}); picker.value = ""; });
  root.append(picker);

  const n = (v: number) => v.toLocaleString("en");

  function drawTop(): void {
    top.replaceChildren();
    for (const f of lib.folders) {
      const chip = make("div", "mm-folder");
      const session = f.id < 0 ? " (this visit)" : "";
      chip.append(make("b", "", f.name), make("span", "", `${n(lib.countOf(f.id))} tracks${session}`));
      if (lib.needsAccess.has(f.id)) chip.append(button("RECONNECT", "mini on", () => { lib.reconnect(f).catch(() => {}); }, "The browser asks again before it reads this folder"));
      else if (f.handle) chip.append(button("SCAN", "mini", () => { lib.rescan(f).catch(() => {}); }, "Look for new, changed and removed files"));
      chip.append(button("REMOVE", "mini", () => { lib.removeFolder(f.id).catch(() => {}); }, "Take the folder out of the library (your files are not touched)"));
      top.append(chip);
    }
    const open = Library.canPickFolder
      ? button(lib.folders.length ? "ADD A FOLDER" : "OPEN A MUSIC FOLDER", "pill", () => { lib.pickFolder().catch(() => {}); })
      : button(lib.folders.length ? "ADD A FOLDER" : "CHOOSE A FOLDER", "pill", () => picker.click());
    top.append(open);
  }

  function drawStatus(): void {
    status.replaceChildren();
    const s = lib.scan;
    if (s) {
      status.append(document.createTextNode(s.phase === "listing" ? `Looking through ${s.name}… ${n(s.found)} files so far` : `Reading ${s.name}: ${n(s.done)} of ${n(s.total)}`), " ",
                    button("STOP", "mini", () => lib.cancelScan()));
    } else if (lib.folders.length === 0) {
      status.textContent = "Your own music, played on these decks. The files stay on this computer: they are read here and never sent anywhere.";
    } else {
      const older = lib.tracks.some((t) => t.folder >= 0 && (t.v ?? 1) < TAGS_VERSION);
      status.textContent = `${n(lib.tracks.length)} tracks.${lib.remembers ? "" : " This browser does not keep your library between visits."}${older ? " Press SCAN once on a folder to find the cover pictures." : ""}`;
    }
  }

  /** Sleeves are read when they come into view, a few at a time; one that leaves the view before its turn is dropped from the queue. */
  let watcher: IntersectionObserver | null = null;
  const waiting = new Map<Element, { track: LibraryTrack; cancel: (() => void) | null }>();
  function tile(t: LibraryTrack, px: number): HTMLCanvasElement {
    const c = make("canvas", "mm-art") as HTMLCanvasElement;
    c.width = c.height = px;
    paintGenerated(c, t); // there is always something to see; the real picture replaces it
    const known = sleeves.peek(t);
    if (known instanceof HTMLCanvasElement) paintSleeve(c, known);
    else if (known === undefined) { waiting.set(c, { track: t, cancel: null }); watcher?.observe(c); }
    return c;
  }
  function watch(): void {
    watcher?.disconnect();
    for (const w of waiting.values()) w.cancel?.();
    waiting.clear();
    watcher = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      for (const e of entries) {
        const w = waiting.get(e.target);
        if (!w) continue;
        if (e.isIntersecting && !w.cancel) {
          w.cancel = sleeves.request(w.track, (s) => { waiting.delete(e.target); if (s instanceof HTMLCanvasElement) paintSleeve(e.target as HTMLCanvasElement, s); });
        } else if (!e.isIntersecting && w.cancel) { w.cancel(); w.cancel = null; }
      }
    }, { root: list, rootMargin: "240px" });
  }

  let open: HTMLElement | null = null;
  function drawList(): void {
    list.replaceChildren();
    watch();
    open = null;
    viewSleeves.classList.toggle("on", view === "sleeves");
    viewList.classList.toggle("on", view === "list");
    list.classList.toggle("sleeves", view === "sleeves");
    if (lib.tracks.length === 0) return;
    const { shown, total } = filterIndex(lib.index, search.value, SHOWN);
    for (const t of shown) {
      const l = labelOf(t);
      if (view === "sleeves") {
        const card = make("div", "mm-sleeve");
        card.tabIndex = 0;
        const pick = make("div", "mm-pick");
        for (const d of [0, 1]) pick.append(button(d === 0 ? "LEFT" : "RIGHT", d === 0 ? "left" : "right", () => hooks.load(d, t)));
        const art = make("div", "mm-cover");
        art.append(tile(t, SLEEVE_PX), pick);
        card.append(art, make("b", "", t.title || t.name), make("span", "", [t.artist, l.sub.split(" · ").slice(0, 2).join(" · ")].filter(Boolean).join(" · ")));
        const toggle = () => { open?.classList.remove("open"); open = open === card ? null : card; open?.classList.add("open"); };
        card.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("button")) toggle(); });
        card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
        list.append(card);
        continue;
      }
      const row = make("div", "record");
      const name = make("div", "name");
      name.append(make("b", "", l.main), make("span", "", l.sub));
      row.append(tile(t, 88), name);
      for (const d of [0, 1]) row.append(button(d === 0 ? "LEFT" : "RIGHT", d === 0 ? "left" : "right", () => hooks.load(d, t)));
      list.append(row);
    }
    if (total > shown.length) list.append(make("p", "small", `${n(total)} match; showing the first ${SHOWN}. Type more to narrow it down.`));
    else if (total === 0) list.append(make("p", "small", "Nothing matches."));
  }

  function drawLoaded(): void {
    loaded.replaceChildren();
    const on = hooks.loaded();
    on.forEach((l, d) => {
      if (!l) return;
      const row = make("div", "mm-fix");
      row.append(make("b", d === 0 ? "left" : "right", d === 0 ? "LEFT" : "RIGHT"),
                 make("span", "mm-name", labelOf(l.track).main),
                 make("span", l.unsure ? "mm-bpm unsure" : "mm-bpm", `${l.bpm.toFixed(2)} BPM${l.unsure ? " (not sure)" : ""}`));
      row.append(button("½", "mini", () => hooks.fix(d, "half"), "Half the tempo (the beat found was double)"),
                 button("×2", "mini", () => hooks.fix(d, "double"), "Double the tempo (the beat found was half)"),
                 button("−", "mini", () => hooks.fix(d, "down"), "0.1 BPM slower"),
                 button("+", "mini", () => hooks.fix(d, "up"), "0.1 BPM faster"),
                 button("GRID HERE", "mini", () => hooks.fix(d, "here"), "The first beat goes where the CUE mark is: put the mark on a kick first"));
      loaded.append(row);
    });
  }

  let drawing = false;
  function refresh(): void {
    if (drawing) return;
    drawing = true;
    try { drawTop(); drawStatus(); drawList(); drawLoaded(); } finally { drawing = false; }
  }
  let typing: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => { if (typing) clearTimeout(typing); typing = setTimeout(drawList, 120); });
  lib.onChange = refresh;
  refresh();
  return { refresh };
}
