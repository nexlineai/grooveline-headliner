// The record room (free play): in front of the decks, a wall with a shelf of picks and a row of crates. A crate opens
// to dig through it: the front record stands up with the ones behind it showing their tops, flipping tips the front
// one forward. Choosing sends a record to the left or the right deck. It reads the same library as MY MUSIC; this
// file is only the look and the feel (the data is crates.ts, the covers are sleeves.ts).

import type { TrackInfo } from "../core/beatgrid.ts";
import { buildList } from "./browse.ts";
import { groupCrates, itemOfGame, itemOfTrack, pickRandom, rankShelf } from "./crates.ts";
import { createLoadPop } from "./loadpop.ts";
import type { Crate, Grouping, WallItem } from "./crates.ts";
import type { Library } from "./library.ts";
import { Sleeves, paintGenerated, paintSleeve } from "./sleeves.ts";

export interface WallHooks {
  /** Puts a record on a deck (the page keeps the rules: stop the deck first, and so on). */
  load(deck: number, item: WallItem): void;
  /** The decks (0 left, 1 right) that hold this record now. */
  onDeck(item: WallItem): number[];
  /** Asks for a music folder (called from a click, so the browser may show its picker). */
  openFolder(): void;
  /** The game's records you can play now. */
  game(): TrackInfo[];
  /** True while a deck plays and cannot take a record (the popup says so). */
  busy?(deck: number): boolean;
  /** The ROOM button (free play): the crowd instead of the wall. */
  toRoom?(): void;
  /** The heart: a favourite or not (kept with the track). */
  toggleFav?(item: WallItem): void;
}

export interface Wall {
  setVisible(visible: boolean): void;
  /** The game's records or something else outside the library changed. */
  refresh(): void;
}

const GROUP_KEY = "headliner.wallBy";
const VIEW_KEY = "headliner.libView";
const GROUP_LABELS: [Grouping, string][] = [["az", "A–Z"], ["genre", "GENRE"], ["tempo", "TEMPO"]];
const MAX_PICKS = 14;
/** The wall is drawn for a front area this high (CSS pixels); everything scales from there. */
const DESIGN_HEIGHT = 340;

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const pill = (text: string, className: string, onClick: () => void, title = ""): HTMLButtonElement => {
  const b = make("button", className, text);
  b.type = "button";
  if (title) b.title = title;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
};
const n = (v: number) => v.toLocaleString("en");
const savedView = (): "wall" | "list" => { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "wall"; } catch { return "wall"; } };
const savedGrouping = (): Grouping => { try { const v = localStorage.getItem(GROUP_KEY); return v === "genre" || v === "tempo" ? v : "az"; } catch { return "az"; } };

export function buildWall(root: HTMLElement, lib: Library, sleeves: Sleeves, hooks: WallHooks): Wall {
  let grouping = savedGrouping();
  let visible = false;
  let dirty = true;
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let items: WallItem[] = [];
  let gameItems: WallItem[] = [];
  let crates: Crate[] = [];
  let picks: WallItem[] = [];
  /** SHUFFLE was pressed: random records, until the page is opened again. */
  let shuffled = false;
  let shown = MAX_PICKS;
  /** Covers waiting to be read for what is on the wall now: dropped when the wall is drawn again. */
  let pending: (() => void)[] = [];
  const lastIndex = new Map<string, number>();

  const top = make("div", "w-top");
  const topLeft = make("div", "w-topl"); // drawn again whenever the library changes
  const topRight = make("div", "w-topr"); // the search and the view switch: made once, so typing is never interrupted
  top.append(topLeft, topRight);
  const shelf = make("div", "w-shelf");
  const floor = make("div", "w-floor");
  const listHost = make("div", "w-list");
  root.replaceChildren(top, shelf, floor, listHost);

  // The two ways to look at the records: the WALL (covers on a shelf and in crates) and the LIST (one line each, no covers).
  let view = savedView();
  const search = make("input", "w-search");
  search.type = "search";
  search.placeholder = "SEARCH THE RECORDS";
  search.title = "Artist, title, tempo, key, genre, album: every word you type must match";
  search.setAttribute("aria-label", "Search the records");
  const viewWall = pill("WALL", "mini", () => setView("wall"), "Covers on a shelf and in crates");
  const viewList = pill("LIST", "mini", () => setView("list"), "One line for each record, with the search and sorting");
  topRight.append(search, viewWall, viewList);
  // A click on a record asks "on which deck?" with one popup, wherever the record is (shelf, open crate, list).
  const toggleFav = (item: WallItem): void => { hooks.toggleFav?.(item); };
  const pop = createLoadPop({ load: (d, item) => { hooks.load(d, item); if (current) renderInfo(); }, busy: hooks.busy, toggleFav });
  const list = buildList(listHost, { load: (d, item) => hooks.load(d, item), onDeck: (item) => hooks.onDeck(item), ask: (item, anchor) => pop.show(item, anchor), toggleFav });
  function setView(v: "wall" | "list"): void {
    view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ }
    root.classList.toggle("listing", v === "list");
    viewWall.classList.toggle("on", v === "wall");
    viewList.classList.toggle("on", v === "list");
    if (v === "list") { closeDig(); list.resize(); }
  }
  search.addEventListener("input", () => {
    if (search.value.trim() && view === "wall") setView("list"); // a search shows its answer as a list
    list.setQuery(search.value);
  });
  setInterval(() => { if (visible && view === "list") list.refreshMarks(); }, 500);

  // MARK: - Data

  function rebuild(): void {
    dirty = false;
    items = lib.tracks.map(itemOfTrack);
    gameItems = hooks.game().map(itemOfGame);
    const mine = groupCrates(items, grouping);
    crates = [...(gameItems.length ? [{ id: "game", label: "THE GAME", items: gameItems } as Crate] : []), ...mine];
    list.setItems(items.length ? items : gameItems);
    const pool = items.length ? items : gameItems;
    const ids = new Set(pool.map((i) => i.id));
    if (picks.length === 0 || picks.some((p) => !ids.has(p.id))) picks = pickRandom(pool, MAX_PICKS);
    // The shelf shows your favourites, or what you play most, first; random records fill what is left (and stay as they were between redraws).
    if (!shuffled) {
      const ranked = rankShelf(pool, MAX_PICKS);
      if (ranked.length) {
        const keep = picks.filter((p) => !ranked.some((r) => r.id === p.id)).map((p) => pool.find((i) => i.id === p.id)!).filter(Boolean);
        picks = [...ranked, ...keep].slice(0, MAX_PICKS);
        if (picks.length < MAX_PICKS) picks = [...picks, ...pickRandom(pool.filter((i) => !picks.some((p) => p.id === i.id)), MAX_PICKS - picks.length)];
      }
    }
    draw();
  }

  function soon(): void {
    dirty = true;
    if (!visible || rebuildTimer) return;
    // A scan reports every few hundred milliseconds; the wall is redrawn at that pace at most.
    rebuildTimer = setTimeout(() => { rebuildTimer = null; if (visible && dirty) rebuild(); }, 800);
  }
  lib.subscribe(soon);

  // MARK: - Covers

  /** A cover for a canvas: a sleeve made from the name at once, the real picture when it has been read. */
  function fill(canvas: HTMLCanvasElement, item: WallItem): void {
    paintGenerated(canvas, item);
    const t = item.track;
    if (!t || !Sleeves.hasPicture(t)) return;
    const known = sleeves.peek(t);
    if (known instanceof HTMLCanvasElement) { paintSleeve(canvas, known); return; }
    if (known === "none") return;
    pending.push(sleeves.request(t, (s) => { if (s instanceof HTMLCanvasElement) paintSleeve(canvas, s); }));
  }
  const cover = (item: WallItem, px: number): HTMLCanvasElement => {
    const c = make("canvas", "w-art");
    c.width = c.height = px;
    fill(c, item);
    return c;
  };

  // MARK: - The wall

  function draw(): void {
    for (const cancel of pending) cancel();
    pending = [];
    drawTop();
    drawShelf();
    drawFloor();
    if (current) {
      const again = crates.find((c) => c.id === current!.crate.id);
      if (again) { current.crate = again; renderDig(); } else closeDig();
    }
  }

  function drawTop(): void {
    topLeft.replaceChildren();
    const group = make("div", "w-group");
    group.append(make("span", "w-cap", "CRATES BY"));
    for (const [g, label] of GROUP_LABELS) {
      const b = pill(label, g === grouping ? "mini on" : "mini", () => {
        grouping = g;
        try { localStorage.setItem(GROUP_KEY, g); } catch { /* private window */ }
        rebuild();
      });
      group.append(b);
    }
    topLeft.append(group, pill("SHUFFLE", "mini w-shuffle", () => { shuffled = true; picks = pickRandom(items.length ? items : gameItems, MAX_PICKS); drawShelf(); }, "Another handful of records for the wall"));
    if (lib.folders.some((f) => f.handle)) topLeft.append(pill("RESCAN", "mini w-rescan", () => { lib.rescanAll().catch(() => {}); }, "Look through your folders again: new files, changed ones, files that are gone; lengths and dates are read"));
    if (hooks.toRoom) topLeft.append(pill("ROOM", "mini w-room", () => hooks.toRoom!(), "Show the crowd instead of the wall"));
    // What the library is doing: reading, or waiting for a click.
    const s = lib.scan;
    if (s) topLeft.append(make("span", "w-status", s.phase === "listing" ? `Looking through ${s.name}… ${n(s.found)}` : `Reading ${s.name}: ${n(s.done)} of ${n(s.total)}`));
    for (const f of lib.folders) {
      if (lib.needsAccess.has(f.id)) topLeft.append(pill(`RECONNECT ${f.name}`.slice(0, 28), "mini on", () => { lib.reconnect(f).catch(() => {}); }, "The browser asks again before it reads this folder"));
    }
  }

  function drawShelf(): void {
    shelf.replaceChildren();
    const row = make("div", "w-row");
    for (const item of picks.slice(0, shown)) row.append(pickTile(item));
    shelf.append(row, make("div", "w-board"));
    if (picks.length === 0) shelf.prepend(make("p", "w-empty", "Nothing on the wall yet."));
  }

  function pickTile(item: WallItem): HTMLElement {
    const tile = make("div", "w-pick");
    tile.tabIndex = 0;
    tile.title = `${item.artist ? item.artist + " · " : ""}${item.title}`;
    tile.append(cover(item, 192));
    if (item.fav) tile.append(make("span", "w-fav", "\u2665"));
    const ask = () => { const r = tile.getBoundingClientRect(); pop.show(item, { x: r.x, y: r.y, w: r.width, h: r.height }); };
    tile.addEventListener("click", ask);
    tile.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ask(); } });
    return tile;
  }

  function deckButtons(item: WallItem): HTMLElement {
    const box = make("div", "w-decks");
    for (const d of [0, 1]) box.append(pill(d === 0 ? "LEFT" : "RIGHT", d === 0 ? "left" : "right", () => { hooks.load(d, item); if (current) renderInfo(); }));
    return box;
  }

  function drawFloor(): void {
    floor.replaceChildren();
    crates.forEach((crate, i) => floor.append(crateButton(crate, i)));
    if (items.length === 0 && lib.folders.length === 0) {
      const ask = make("button", "w-crate w-ask");
      ask.type = "button";
      ask.append(make("span", "w-box"), make("b", "", "YOUR MUSIC"), make("i", "", "OPEN A FOLDER"));
      ask.addEventListener("click", hooks.openFolder);
      floor.append(ask);
    }
  }

  /** A crate is a DJ's flight case or a record bag (they alternate along the floor). */
  function crateButton(crate: Crate, index: number): HTMLElement {
    const bag = index % 2 === 1;
    const b = make("button", "w-crate " + (bag ? "bag" : "case"));
    b.style.setProperty("--i", String(index));
    b.type = "button";
    b.title = `${crate.label}: ${n(crate.items.length)} records`;
    const peek = make("span", "w-peek");
    // Four records standing in the crate, spread over what it holds; only their tops show.
    const want = Math.min(4, crate.items.length);
    for (let k = 0; k < want; k++) {
      const at = want === 1 ? 0 : Math.round(k * (crate.items.length - 1) / (want - 1));
      const rec = make("span", "w-rec");
      rec.style.setProperty("--k", String(k));
      rec.append(cover(crate.items[at], 128));
      peek.append(rec);
    }
    const box = make("span", "w-box");
    // The case has a handle on its lid, two latches and steel corners; the bag has a flap with a buckle, two straps and a patch.
    const deco = make("span", "w-deco");
    if (bag) deco.append(make("span", "w-strap l"), make("span", "w-strap r"), make("span", "w-flap"), make("span", "w-buckle"));
    else deco.append(make("span", "w-handle"), make("span", "w-latch l"), make("span", "w-latch r"), make("span", "w-corner tl"), make("span", "w-corner tr"), make("span", "w-corner bl"), make("span", "w-corner br"));
    box.append(deco, make("b", "", crate.label), make("i", "", n(crate.items.length)));
    b.append(peek, box);
    b.addEventListener("click", () => openDig(crate));
    return b;
  }

  // MARK: - Digging through a crate

  interface Dig { crate: Crate; index: number; nodes: Map<number, { el: HTMLElement; cancel: () => void }>; }
  let current: Dig | null = null;
  const dig = make("div", "w-dig");
  dig.hidden = true;
  const dLeft = make("div", "d-left"), stage = make("div", "d-stage"), dInfo = make("div", "d-info"), scrub = make("input", "d-scrub");
  scrub.type = "range";
  scrub.min = "0";
  scrub.step = "1";
  scrub.setAttribute("aria-label", "Position in the crate");
  dig.append(dLeft, stage, dInfo);
  root.append(dig);

  /** A record takes a moment to load: while a crate is open, the "on the left deck" line follows the decks. */
  let watchDecks: ReturnType<typeof setInterval> | null = null;
  let shownOn = "";
  const WINDOW_BEHIND = 7;
  let sizes = { S: 160, peek: 14, depth: 30 };

  function layoutDig(): void {
    const h = stage.clientHeight || 300;
    // The front record as big as the stage allows once the ones behind have their strips (about half a record of them) and the scrub bar its row.
    const S = Math.max(90, Math.min((h - 24) / 1.45, stage.clientWidth * 0.8));
    sizes = { S, peek: Math.max(9, S * 0.085), depth: Math.max(18, S * 0.17) };
    stage.style.setProperty("--S", `${S}px`);
  }

  function openDig(crate: Crate): void {
    current = { crate, index: Math.min(lastIndex.get(crate.id) ?? 0, crate.items.length - 1), nodes: new Map() };
    dig.hidden = false;
    root.classList.add("digging");
    renderDig(true); // no focus on the scrub bar: the booth's keys ignore anything typed into an input
    watchDecks = setInterval(() => {
      const it = current?.crate.items[current.index];
      if (it && hooks.onDeck(it).join() !== shownOn) renderInfo();
    }, 400);
  }

  function closeDig(): void {
    if (!current) return;
    lastIndex.set(current.crate.id, current.index);
    for (const nd of current.nodes.values()) nd.cancel();
    if (watchDecks) { clearInterval(watchDecks); watchDecks = null; }
    current = null;
    stage.replaceChildren();
    dig.hidden = true;
    root.classList.remove("digging");
  }

  function renderDig(first = false): void {
    const c = current;
    if (!c) return;
    layoutDig();
    dLeft.replaceChildren(pill("✕ CLOSE", "mini", closeDig, "Back to the wall"), make("h3", "", c.crate.label), make("p", "", `${n(c.crate.items.length)} records`), make("p", "d-pos", ""), scrub);
    scrub.max = String(Math.max(0, c.crate.items.length - 1));
    scrub.disabled = c.crate.items.length < 2;
    place(first);
    renderInfo();
  }

  /** Which records are standing in the stage, and where each one is. */
  function place(first = false): void {
    const c = current;
    if (!c) return;
    const from = Math.max(0, c.index - 2), to = Math.min(c.crate.items.length - 1, c.index + WINDOW_BEHIND);
    for (const [i, nd] of c.nodes) if (i < from || i > to) { nd.cancel(); nd.el.remove(); c.nodes.delete(i); }
    for (let i = from; i <= to; i++) {
      let nd = c.nodes.get(i);
      if (!nd) {
        const el = make("div", "d-rec");
        const before = pending.length;
        el.append(cover(c.crate.items[i], 320), make("span", "d-shade"));
        const mine = pending.splice(before); // these belong to the record, not to the wall
        el.addEventListener("click", () => {
          if (!current) return;
          if (i !== current.index) { go(i); return; }
          const r = el.getBoundingClientRect(); // the front record: which deck?
          pop.show(current.crate.items[i], { x: r.x, y: r.y, w: r.width, h: r.height });
        });
        nd = { el, cancel: () => { for (const f of mine) f(); } };
        c.nodes.set(i, nd);
        stage.append(el);
        if (first || i < c.index) el.style.transition = "none"; // standing there from the start, not flying in
      }
      const j = i - c.index;
      const { S, peek, depth } = sizes;
      nd.el.classList.toggle("front", j === 0);
      nd.el.style.setProperty("--dark", String(Math.min(0.75, j * 0.1)));
      if (j >= 0) {
        nd.el.style.transform = `translate3d(0, ${-j * peek}px, ${-j * depth}px) rotateX(${j === 0 ? -4 : 0}deg)`;
        nd.el.style.opacity = j > WINDOW_BEHIND - 1 ? "0" : "1";
        nd.el.style.zIndex = String(100 - j);
        nd.el.style.pointerEvents = "auto";
      } else {
        // Flipped forward: down and tipped over the front edge of the crate.
        nd.el.style.transform = `translate3d(0, ${S * 0.62}px, ${S * 0.28}px) rotateX(${70 + (-j - 1) * 6}deg)`;
        nd.el.style.opacity = "0";
        nd.el.style.zIndex = String(101 - j);
        nd.el.style.pointerEvents = "none";
      }
      if (nd.el.style.transition === "none") { void nd.el.offsetWidth; nd.el.style.transition = ""; }
    }
    scrub.value = String(c.index);
    const pos = dLeft.querySelector(".d-pos");
    if (pos) pos.textContent = `${n(c.index + 1)} / ${n(c.crate.items.length)}`;
  }

  function renderInfo(): void {
    const c = current;
    if (!c) return;
    const item = c.crate.items[c.index];
    dInfo.replaceChildren();
    if (!item) return;
    const on = hooks.onDeck(item);
    shownOn = on.join();
    dInfo.append(make("h3", "", item.title), make("p", "d-artist", item.artist || "—"), make("p", "d-sub", item.sub));
    if (on.length) dInfo.append(make("p", "d-on", `ON THE ${on.map((d) => (d === 0 ? "LEFT" : "RIGHT")).join(" AND ")} DECK`));
    dInfo.append(deckButtons(item));
    const next = c.crate.items.slice(c.index + 1, c.index + 4);
    if (next.length) {
      const list = make("ol", "d-next");
      for (const it of next) list.append(make("li", "", `${it.artist ? it.artist + " · " : ""}${it.title}`));
      dInfo.append(make("p", "d-cap", "NEXT IN THE CRATE"), list);
    }
  }

  function go(index: number): void {
    const c = current;
    if (!c) return;
    const i = Math.max(0, Math.min(c.crate.items.length - 1, Math.round(index)));
    if (i === c.index) return;
    c.index = i;
    place();
    renderInfo();
  }
  const step = (by: number) => { if (current) go(current.index + by); };

  scrub.addEventListener("input", () => go(Number(scrub.value)));
  // The wheel and a finger or mouse pulled up and down flip the records, one for every little push.
  let wheel = 0;
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    wheel += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    const whole = Math.trunc(wheel / 45);
    if (whole) { wheel -= whole * 45; step(whole); }
  }, { passive: false });
  let drag: { y: number; moved: number } | null = null;
  let dragged = false;
  stage.addEventListener("pointerdown", (e) => { drag = { y: e.clientY, moved: 0 }; dragged = false; });
  // A click on the empty stage (not on a record, not the end of a drag) goes back to the wall: Esc in fullscreen leaves fullscreen instead.
  stage.addEventListener("click", (e) => { if (e.target === stage && !dragged) closeDig(); });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    const whole = Math.trunc(dy / 34);
    if (whole) { drag.y += whole * 34; drag.moved += Math.abs(whole); dragged = true; step(-whole); }
  });
  addEventListener("pointerup", () => { drag = null; });
  // Keys only while a crate is open (the arrows are the crossfader the rest of the time), and never from a text box.
  addEventListener("keydown", (e) => {
    if (!current || (e.target instanceof HTMLInputElement && e.target.type === "search")) return;
    const by: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
    const mine = e.key in by || e.key === "Home" || e.key === "End" || e.key === "Escape";
    if (!mine) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // the booth's own key listener must not also move the crossfader
    if (e.key in by) step(by[e.key]);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(current.crate.items.length - 1);
    else closeDig();
  }, true);

  // MARK: - Size

  function layout(): void {
    const h = root.clientHeight, w = root.clientWidth;
    if (!h) return;
    // As big as the height allows, but never so big that the row of seven crates no longer fits the width.
    const ws = Math.max(0.6, Math.min(1.5, h / DESIGN_HEIGHT, (w - 24) / 1180));
    root.style.setProperty("--ws", String(ws));
    // A short front (a phone held sideways): no shelf, just the crates.
    root.classList.toggle("compact", h < 240);
    const want = Math.max(4, Math.min(MAX_PICKS, Math.floor((w - 60) / (118 * ws))));
    if (want !== shown) { shown = want; if (visible) drawShelf(); }
    if (current) { layoutDig(); place(); }
    list.resize();
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(layout).observe(root);

  return {
    setVisible(v: boolean): void {
      if (v === visible) return;
      visible = v;
      root.hidden = !v;
      if (!v) { closeDig(); for (const cancel of pending) cancel(); pending = []; return; }
      lib.init().catch(() => {});
      layout();
      setView(view);
      rebuild();
    },
    refresh(): void { soon(); },
  };
}
