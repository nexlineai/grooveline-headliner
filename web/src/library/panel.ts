// The MY MUSIC tab of the crate: your folders, a search box, the list, and the fixes for the grid of
// what is on the decks.

import { Library } from "./library.ts";
import { labelOf } from "./search.ts";
import { filterIndex } from "./search.ts";
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

/** Builds the tab in `root`; the returned `refresh` redraws it (the page calls it after a load or a fix). */
export function buildPanel(root: HTMLElement, lib: Library, hooks: PanelHooks): { refresh(): void } {
  const top = make("div", "mm-top");
  const status = make("p", "mm-status");
  const search = make("input", "mm-search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "SEARCH ARTIST, TITLE, KEY, BPM";
  const list = make("div", "mm-list");
  const loaded = make("div", "mm-loaded");
  root.replaceChildren(top, status, search, list, loaded);

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
      status.textContent = `${n(lib.tracks.length)} tracks.${lib.remembers ? "" : " This browser does not keep your library between visits."}`;
    }
  }

  function drawList(): void {
    list.replaceChildren();
    if (lib.tracks.length === 0) return;
    const { shown, total } = filterIndex(lib.index, search.value, SHOWN);
    for (const t of shown) {
      const row = make("div", "record");
      const name = make("div", "name");
      const l = labelOf(t);
      name.append(make("b", "", l.main), make("span", "", l.sub));
      row.append(name);
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
