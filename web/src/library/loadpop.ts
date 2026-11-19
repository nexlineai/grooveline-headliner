// The question a click on a record asks: on which deck? One popup next to the record, the same on the wall's shelf, on the front record of an
// open crate and on a row of the list. The left deck is cyan and the right one amber, as in the booth. A deck that is playing says so
// (the page refuses the load and puts its own message over that deck).

import type { WallItem } from "./crates.ts";

export interface LoadPopHooks {
  /** Puts the record on a deck (the page keeps the rules). */
  load(deck: number, item: WallItem): void;
  /** True while a deck plays and cannot take a record. */
  busy?(deck: number): boolean;
  /** The heart. */
  toggleFav?(item: WallItem): void;
  /** ADD TO PLAYLIST: the playlists to choose from, and the adding (null: into a new playlist). Returns what to tell the player. Only your own music can be added. */
  playlists?: { all(): { id: number; name: string }[]; add(id: number | null, item: WallItem): Promise<string> };
}

export interface LoadPop {
  /** Opens it next to `anchor` (a rectangle in window coordinates), for this record. */
  show(item: WallItem, anchor: { x: number; y: number; w: number; h: number }): void;
  hide(): void;
  readonly open: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

/** Where the popup goes: centred over the record and above it, or under it when there is no room above; always inside the window. */
export function popPosition(anchor: Box, size: { w: number; h: number }, view: { w: number; h: number }, gap = 8, margin = 6): { x: number; y: number } {
  const x = Math.max(margin, Math.min(view.w - size.w - margin, anchor.x + anchor.w / 2 - size.w / 2));
  const above = anchor.y - gap - size.h;
  const y = above >= margin ? above : Math.max(margin, Math.min(view.h - size.h - margin, anchor.y + anchor.h + gap));
  return { x, y };
}

export function createLoadPop(hooks: LoadPopHooks): LoadPop {
  const el = document.createElement("div");
  el.className = "load-pop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Load this record on a deck");
  const title = document.createElement("b");
  const artist = document.createElement("i");
  const names = document.createElement("div");
  names.className = "lp-names";
  names.append(title, artist);
  const heart = document.createElement("button");
  heart.type = "button";
  heart.className = "lp-heart";
  const head = document.createElement("div");
  head.className = "lp-title";
  head.append(names, ...(hooks.toggleFav ? [heart] : []));
  const ask = document.createElement("p");
  ask.className = "lp-ask";
  ask.textContent = "LOAD ON";
  const decks = document.createElement("div");
  decks.className = "lp-decks";
  const buttons = [0, 1].map((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = d === 0 ? "left" : "right";
    const name = document.createElement("b");
    name.textContent = d === 0 ? "LEFT" : "RIGHT";
    const sub = document.createElement("i");
    b.append(name, sub);
    decks.append(b);
    return { b, sub };
  });
  // ADD TO PLAYLIST: one choice list under the deck buttons (for your own music).
  const add = document.createElement("select");
  add.className = "lp-add";
  add.setAttribute("aria-label", "Add this record to a playlist");
  const say = document.createElement("p");
  say.className = "lp-say";
  el.append(head, ask, decks, ...(hooks.playlists ? [add, say] : []));
  el.hidden = true;
  document.body.append(el);

  let item: WallItem | null = null;
  let isOpen = false;
  const hide = (): void => { if (!isOpen) return; isOpen = false; el.classList.remove("open"); el.hidden = true; item = null; };
  add.addEventListener("change", () => {
    const it = item, choice = add.value;
    if (!it || !hooks.playlists || !choice) return;
    hooks.playlists.add(choice === "new" ? null : Number(choice), it).then((msg) => { say.textContent = msg; }, () => { say.textContent = "Could not add it"; });
    fillAdd();
  });
  const fillAdd = (): void => {
    add.replaceChildren();
    const first = document.createElement("option");
    first.value = ""; first.textContent = "ADD TO PLAYLIST\u2026";
    add.append(first);
    for (const p of hooks.playlists?.all() ?? []) { const o = document.createElement("option"); o.value = String(p.id); o.textContent = p.name; add.append(o); }
    const fresh = document.createElement("option");
    fresh.value = "new"; fresh.textContent = "+ NEW PLAYLIST";
    add.append(fresh);
    add.value = "";
  };
  heart.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!item || !hooks.toggleFav) return;
    item.fav = !item.fav; // the popup shows it at once; the page saves it and the wall follows
    hooks.toggleFav(item);
    paintHeart();
  });
  const paintHeart = (): void => { heart.textContent = "\u2665"; heart.classList.toggle("on", !!item?.fav); heart.title = item?.fav ? "Remove from your favourites" : "Add to your favourites"; };
  buttons.forEach(({ b }, d) => b.addEventListener("click", (e) => { e.stopPropagation(); const it = item; hide(); if (it) hooks.load(d, it); }));
  document.addEventListener("pointerdown", (e) => { if (isOpen && !el.contains(e.target as Node)) hide(); }, true);
  document.addEventListener("keydown", (e) => { if (isOpen && e.key === "Escape") { e.preventDefault(); hide(); } });
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);

  return {
    show(it, anchor): void {
      item = it;
      title.textContent = it.title;
      artist.textContent = it.artist || it.sub || "";
      paintHeart();
      say.textContent = "";
      if (hooks.playlists) { fillAdd(); add.hidden = !it.track; }
      buttons.forEach(({ b, sub }, d) => { const busy = hooks.busy?.(d) ?? false; b.classList.toggle("busy", busy); sub.textContent = busy ? "PLAYING" : d === 0 ? "DECK A" : "DECK B"; });
      el.hidden = false;
      isOpen = true;
      const box = el.getBoundingClientRect();
      const at = popPosition(anchor, { w: box.width, h: box.height }, { w: window.innerWidth, h: window.innerHeight });
      el.style.left = `${Math.round(at.x)}px`;
      el.style.top = `${Math.round(at.y)}px`;
      el.classList.add("open");
      buttons[0].b.focus({ preventScroll: true });
    },
    hide,
    get open(): boolean { return isOpen; },
  };
}
