// The end of the game (port of App/CreditsView.swift): the credits roll over the white label
// (zdB's 2007 dubplate) from its drop, then zdB himself hands over a real record: a live set on
// Grooveline (his own voice, a link to grooveline.org). Then back to the title. The text is the
// one Zé approved for the iPhone (18 Nov 2026); change both together.

import { fade } from "../fade.ts";
import { groovelineLogo } from "../logo.ts";

const DROP_AT = 414.5; // seconds into the white label (121 BPM)
const ROLL_SPEED = 24; // pixels per second the text climbs
const START_AT = 0.42; // where the top of the text starts, as a share of the screen height
export const LIVE_URL = "https://grooveline.org/start-dj";

const SECTIONS: [string, string[]][] = [
  ["THANK YOU, LISBON.", [
    "To the Lisbon scene of the nineties and the two-thousands: the record shops and the listening booths, the clubs, the warehouses and the after-hours, the flyers on every wall, the DJs who carried their crates up the stairs, the promoters, the sound engineers, the doormen, and everyone who danced until the sky over the river turned pink. This game is made of your nights.",
  ]],
  ["THANK YOU, GROOVELINE.", [
    "In March 2002 a small record shop opened in Chiado, Lisbon. New records every week: trance, progressive house, techno, beats, and decks and gear for anyone who wanted to start.",
    "In the same building there was an old radio studio. In a corner of its small booth, zdB set up two cameras and started streaming DJs live on the internet, years before that was normal. Some of the DJs were customers of the shop; some were names from Lisbon's clubs. By 2004 Grooveline Radio had a weekly timetable, guests from abroad, and sets you could watch again.",
    "Later Grooveline moved to the Netherlands: Rotterdam, festivals, warehouses, hundreds of sets on camera. In 2026 it came back as an open station where any DJ can book a slot and go live.",
    "This game grew out of that shop and that booth. Lia's shop. The glass studio. Thursday nights on the radio. To every DJ who played in that corner, and to everyone who listened: thank you.",
  ]],
  ["THE WHITE LABEL", [
    "The record with no name that Lia hands you, and the last one you play at MERIDIAN, is a dubplate produced by zdB in 2007.",
  ]],
  ["HOW IT WAS MADE", [
    "Every record in this game except the white label was written as code and synthesized from nothing: no samples, no commercial music. The pictures, the voices and the moving scenes were made with generative AI from our own descriptions: the pictures, the voices and the moving rooms with Grok (xAI), the talking scenes with Grok (xAI) and Gemini (Google). The decks, the mixer and the crowd are all written in code.",
  ]],
];

const el = (tag: string, className = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};


export class Credits {
  private readonly root: HTMLElement;
  private readonly onEnd: () => void;
  private music: HTMLAudioElement | null = null;
  private voice: HTMLAudioElement | null = null;
  private timers: number[] = [];
  private zdb = false;
  private readonly tap = () => { if (!this.zdb) this.showZdb(); };

  constructor(root: HTMLElement, onEnd: () => void) {
    this.root = root;
    this.onEnd = onEnd;
  }

  start(): void {
    const root = this.root;
    root.replaceChildren();
    root.hidden = false;
    root.className = "screen credits";
    // The white label from its drop, faded in.
    const music = new Audio("assets/Tracks/white-label.m4a");
    music.volume = 0;
    music.addEventListener("loadedmetadata", () => { music.currentTime = DROP_AT; music.play().then(() => fade(music, 0.9, 2)).catch(() => {}); }, { once: true });
    music.load();
    this.music = music;

    const roll = el("div", "roll");
    const logo = el("div", "logo");
    groovelineLogo(logo, 30);
    roll.append(logo, el("div", "name", "HEADLINER"));
    for (const [title, paragraphs] of SECTIONS) {
      const section = el("section");
      section.append(el("h3", "", title));
      for (const p of paragraphs) section.append(el("p", "", p));
      roll.append(section);
    }
    root.append(roll);
    root.addEventListener("click", this.tap);
    // The text hangs from just below the middle and climbs until its last line is off the top.
    requestAnimationFrame(() => {
      const h = root.clientHeight, textHeight = roll.offsetHeight;
      const seconds = (textHeight + h * START_AT + 20) / ROLL_SPEED;
      roll.style.transform = `translateY(${h * START_AT}px)`;
      this.timers.push(window.setTimeout(() => {
        roll.style.transition = `transform ${seconds}s linear`;
        roll.style.transform = `translateY(${-(textHeight + 20)}px)`;
      }, 800));
      this.timers.push(window.setTimeout(() => { if (!this.zdb) this.showZdb(); }, (0.8 + seconds + 1) * 1000));
    });
  }

  /** zdB's record: his face in shadow, his own voice, the way to a real live set. */
  private showZdb(): void {
    this.zdb = true;
    const root = this.root;
    const card = el("div", "zdb");
    const words = el("div", "words");
    const live = el("a", "live", "GO LIVE ON GROOVELINE") as HTMLAnchorElement;
    live.href = LIVE_URL;
    live.target = "_blank";
    live.rel = "noopener";
    const end = el("button", "end", "THE END");
    end.addEventListener("click", (e) => { e.stopPropagation(); this.finish(); });
    const buttons = el("div", "buttons");
    buttons.append(live, end);
    words.append(el("b", "", "ZDB"), el("p", "", "This one is real. Play a live set on Grooveline."), buttons);
    card.append(words);
    root.append(card);
    requestAnimationFrame(() => card.classList.add("shown"));
    this.timers.push(window.setTimeout(() => {
      const voice = new Audio("assets/Lessons/zdb-real.m4a");
      this.voice = voice;
      if (this.music) fade(this.music, 0.35, 0.4);
      voice.addEventListener("ended", () => { if (this.music) fade(this.music, 0.7, 1); });
      voice.play().catch(() => {});
    }, 1200));
  }

  private finish(): void {
    if (this.music) fade(this.music, 0, 0.8);
    this.voice?.pause();
    this.timers.push(window.setTimeout(() => { this.stop(); this.onEnd(); }, 800));
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.music?.pause();
    this.voice?.pause();
    this.music = null;
    this.voice = null;
    this.root.removeEventListener("click", this.tap);
    this.root.hidden = true;
    this.root.replaceChildren();
  }
}
