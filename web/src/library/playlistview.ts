// The PLAYLISTS view of the LIVE library: your playlists on the left (NEW, IMPORT), the records of the one you picked on the right, in order, each with its A and B
// button (or a click for the which-deck popup) and arrows to move it or take it out; EXPORT saves the playlist as an .m3u8 file. The data is playlists.ts.

import { clockOf } from "./browse.ts";
import { itemOfTrack } from "./crates.ts";
import type { WallItem } from "./crates.ts";
import type { Playlists } from "./playlists.ts";

interface Box { x: number; y: number; w: number; h: number }

export interface PlaylistViewHooks {
  load(deck: number, item: WallItem): void;
  onDeck(item: WallItem): number[];
  /** A click on a row: the page asks on which deck. */
  ask(item: WallItem, anchor: Box): void;
  /** A short message for the wall's status line ("Saved Friday set.m3u8"). */
  say(text: string): void;
}

export interface PlaylistView {
  /** The "on a deck" marks follow the decks. */
  refreshMarks(): void;
  /** The view comes on screen. */
  show(): void;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const SELECTED = "headliner.playlist";

/** Saves a text under a name: the browser's own save dialog where it has one (Chromium), else a download. Returns what to tell the player ("" when they cancelled). */
export async function saveTextFile(fileName: string, text: string): Promise<string> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ name: string; createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> }> };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "Playlist (.m3u8)", accept: { "audio/x-mpegurl": [".m3u8", ".m3u"] } }] });
      const out = await handle.createWritable();
      await out.write(text);
      await out.close();
      return `Saved ${handle.name}`;
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return ""; // closed the dialog: nothing to say
      // Anything else (no user gesture, no permission): fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "audio/x-mpegurl;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `Saved ${fileName} (in your downloads)`;
}

export function buildPlaylistView(host: HTMLElement, playlists: Playlists, hooks: PlaylistViewHooks): PlaylistView {
  let selected: number | null = (() => { try { const v = Number(localStorage.getItem(SELECTED)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } })();
  let renaming = false;
  let sure = false; // DELETE asked once
  let sureTimer: ReturnType<typeof setTimeout> | null = null;

  const side = make("div", "pl-side");
  const main = make("div", "pl-main");
  host.replaceChildren(side, main);

  const picker = make("input");
  picker.type = "file";
  picker.accept = ".m3u8,.m3u,.txt,audio/x-mpegurl";
  picker.hidden = true;
  picker.setAttribute("aria-label", "Open a playlist file");
  host.append(picker);
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    try {
      const r = await playlists.importText(await file.text(), file.name.replace(/\.[^.]+$/, ""));
      selected = r.playlist.id;
      hooks.say(r.total === 0 ? `${file.name}: no records in it` : r.found === r.total ? `Imported ${r.playlist.name}: all ${r.total} records found` : `Imported ${r.playlist.name}: ${r.found} of ${r.total} records found (the others are kept, in grey)`);
    } catch { hooks.say(`Could not read ${file.name}`); }
  });

  const button = (text: string, className: string, onClick: () => void, title = ""): HTMLButtonElement => {
    const b = make("button", className, text);
    b.type = "button";
    if (title) b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  };

  function select(id: number | null): void {
    selected = id; renaming = false; sure = false;
    try { if (id) localStorage.setItem(SELECTED, String(id)); else localStorage.removeItem(SELECTED); } catch { /* private window */ }
    render();
  }

  function drawSide(): void {
    side.replaceChildren();
    const head = make("div", "pl-head");
    head.append(make("span", "pl-cap", "PLAYLISTS"));
    const bar = make("div", "pl-bar");
    bar.append(
      button("NEW", "mini", () => { playlists.create().then((p) => { select(p.id); renaming = true; render(); }).catch(() => {}); }, "A new, empty playlist"),
      button("IMPORT", "mini", () => picker.click(), "Open a playlist file (.m3u8 or .m3u)"),
    );
    head.append(bar);
    const list = make("div", "pl-lists");
    for (const p of playlists.lists) {
      const b = make("button", "pl-item" + (p.id === selected ? " on" : ""));
      b.type = "button";
      b.append(make("span", "pl-name", p.name), make("i", "", String(p.items.length)));
      b.addEventListener("click", () => select(p.id));
      list.append(b);
    }
    if (playlists.lists.length === 0) list.append(make("p", "pl-none", "No playlists yet."));
    side.append(head, list);
  }

  function drawMain(): void {
    main.replaceChildren();
    const p = selected === null ? undefined : playlists.get(selected);
    if (!p) {
      main.append(make("p", "pl-empty", playlists.lists.length ? "Pick a playlist on the left." : "NEW makes a playlist; click a record anywhere and choose ADD TO PLAYLIST. IMPORT opens a file you saved before."));
      return;
    }
    const head = make("div", "pl-title");
    if (renaming) {
      const input = make("input", "pl-rename");
      input.type = "text";
      input.value = p.name;
      input.maxLength = 80;
      input.setAttribute("aria-label", "Playlist name");
      const done = (save: boolean) => { renaming = false; if (save) playlists.rename(p.id, input.value).then(render, render); else render(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); });
      input.addEventListener("blur", () => { if (renaming) done(true); });
      head.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
    } else {
      head.append(make("h3", "", p.name), make("span", "pl-count", `${p.items.length} record${p.items.length === 1 ? "" : "s"}`));
    }
    const actions = make("div", "pl-actions");
    actions.append(
      button("RENAME", "mini", () => { renaming = true; render(); }),
      button("EXPORT .M3U8", "mini", () => {
        const out = playlists.exportOf(p.id);
        if (out) saveTextFile(out.fileName, out.text).then((msg) => { if (msg) hooks.say(msg); }).catch(() => hooks.say("Could not save the file"));
      }, "Save this playlist as a file, to import next time (or in Mixxx, Traktor, VirtualDJ)"),
      button(sure ? "SURE?" : "DELETE", sure ? "mini warn" : "mini", () => {
        if (!sure) { sure = true; render(); sureTimer && clearTimeout(sureTimer); sureTimer = setTimeout(() => { sure = false; render(); }, 3000); return; }
        sure = false;
        playlists.remove(p.id).then(() => select(playlists.lists[0]?.id ?? null)).catch(() => {});
      }, "Delete this playlist (the records stay in your library)"),
    );
    head.append(actions);
    const rows = make("div", "pl-rows");
    p.items.forEach((e, i) => {
      const track = playlists.trackOf(e);
      const item = track ? itemOfTrack(track) : null;
      const on = item ? hooks.onDeck(item) : [];
      const row = make("div", "pl-row" + (item ? "" : " gone") + (on.length ? " on" : "") + (on.includes(0) ? " ona" : "") + (on.includes(1) ? " onb" : ""));
      const who = make("span", "pl-who");
      for (const d of on) who.append(make("i", d === 0 ? "mark a" : "mark b", d === 0 ? "A" : "B"));
      who.append(e.artist || "—");
      row.append(make("span", "pl-n", String(i + 1)), who, make("span", "pl-t", e.title + (item ? "" : "  ·  NOT IN YOUR LIBRARY")), make("span", "pl-time", clockOf(e.seconds)));
      const load = make("span", "pl-load");
      if (item) for (const d of [0, 1]) load.append(button(d === 0 ? "A" : "B", d === 0 ? "left" : "right", () => hooks.load(d, item), d === 0 ? "Load on the left deck" : "Load on the right deck"));
      const move = make("span", "pl-move");
      move.append(
        button("▲", "arrow", () => { playlists.move(p.id, i, i - 1).catch(() => {}); }, "Move up"),
        button("▼", "arrow", () => { playlists.move(p.id, i, i + 1).catch(() => {}); }, "Move down"),
        button("✕", "arrow x", () => { playlists.removeAt(p.id, i).catch(() => {}); }, "Take it out of the playlist"),
      );
      row.append(load, move);
      if (item) row.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).closest("button")) return;
        const r = row.getBoundingClientRect();
        hooks.ask(item, { x: r.x, y: r.y, w: r.width, h: r.height });
      });
      rows.append(row);
    });
    if (p.items.length === 0) rows.append(make("p", "pl-empty", "Empty. Click a record on the wall or in the list and choose ADD TO PLAYLIST."));
    main.append(head, rows);
  }

  let drawing = false;
  function render(): void {
    if (drawing) return;
    drawing = true;
    if (selected !== null && !playlists.get(selected)) selected = playlists.lists[0]?.id ?? null;
    if (selected === null && playlists.lists.length) selected = playlists.lists[0].id;
    drawSide();
    drawMain();
    drawing = false;
  }
  playlists.subscribe(() => { if (!renaming) render(); else drawSide(); });
  render();

  let marks = "";
  return {
    refreshMarks(): void {
      const p = selected === null ? undefined : playlists.get(selected);
      if (!p || renaming) return;
      const sig = p.items.map((e) => { const t = playlists.trackOf(e); return t ? hooks.onDeck(itemOfTrack(t)).join("") : "-"; }).join(",");
      if (sig !== marks) { marks = sig; render(); }
    },
    show(): void { render(); },
  };
}
