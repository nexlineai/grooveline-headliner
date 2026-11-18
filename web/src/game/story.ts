// The story scenes (port of App/Story.swift and StoryView.swift). A scene is a list of shots; a
// shot is one picture and the lines spoken over it. A line with a `clip` is a short film of that
// picture in which the character says the line (voice and lips made together); a line with a
// `voice` is heard over the still picture; a shot without a picture is a title card. Scenes play
// by themselves; a click or a tap skips to the next line.

export interface StoryLine { who: string; text: string; clip?: string; voice?: string; }
export interface StoryShot { art?: string; lines: StoryLine[]; }
export interface StoryScene { id: string; shots: StoryShot[]; }

let scenes: Map<string, StoryScene> | null = null;

export async function loadScenes(): Promise<Map<string, StoryScene>> {
  if (!scenes) {
    const list = await (await fetch("assets/Story/scenes.json")).json() as StoryScene[];
    scenes = new Map(list.map((s) => [s.id, s]));
  }
  return scenes;
}

/** Plays one scene in `root`, line after line, like a cutscene. */
export class StoryPlayer {
  private readonly root: HTMLElement;
  private readonly scene: StoryScene;
  private readonly onEnd: () => void;
  private shotIndex = 0;
  private lineIndex = 0;
  private still: HTMLImageElement;
  private clips = new Map<number, HTMLVideoElement>();
  private caption: HTMLElement;
  private card: HTMLElement;
  private voice: HTMLAudioElement | null = null;
  private waiting: number | null = null;
  private finished = false;
  private readonly tapHandler = () => this.tap();

  /** The breath between two lines. */
  private static readonly pause = 0.2;

  constructor(root: HTMLElement, scene: StoryScene, onEnd: () => void) {
    this.root = root;
    this.scene = scene;
    this.onEnd = onEnd;
    root.replaceChildren();
    this.still = document.createElement("img");
    this.still.className = "still";
    this.still.alt = "";
    this.caption = document.createElement("div");
    this.caption.className = "caption";
    this.caption.innerHTML = "<b></b><p></p>";
    this.card = document.createElement("div");
    this.card.className = "card";
    root.append(this.still, this.caption, this.card);
    root.hidden = false;
    root.addEventListener("click", this.tapHandler);
  }

  private get shot(): StoryShot | undefined { return this.scene.shots[this.shotIndex]; }
  private get line(): StoryLine | undefined { return this.shot?.lines[this.lineIndex]; }

  start(): void {
    if (!this.line) { this.finish(); return; }
    this.loadShot();
    this.say();
  }

  stop(): void {
    if (this.waiting !== null) clearTimeout(this.waiting);
    this.waiting = null;
    this.voice?.pause();
    this.voice = null;
    for (const v of this.clips.values()) v.pause();
  }

  /** A tap cuts the current line short. */
  tap(): void {
    if (!this.finished) this.advance();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    this.root.removeEventListener("click", this.tapHandler);
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onEnd();
  }

  private advance(): void {
    if (this.waiting !== null) clearTimeout(this.waiting);
    this.waiting = null;
    this.voice?.pause();
    this.voice = null;
    const shot = this.shot;
    if (!shot) { this.finish(); return; }
    if (this.lineIndex + 1 < shot.lines.length) {
      this.lineIndex += 1;
      this.say();
    } else if (this.shotIndex + 1 < this.scene.shots.length) {
      this.shotIndex += 1;
      this.lineIndex = 0;
      this.loadShot();
      this.say();
    } else {
      this.finish();
    }
  }

  /** The shot's picture, and its clips made ready in order (each starts and ends on the picture). */
  private loadShot(): void {
    for (const v of this.clips.values()) v.remove();
    this.clips.clear();
    const shot = this.shot;
    if (!shot) return;
    this.still.hidden = !shot.art;
    if (shot.art) this.still.src = `assets/Story/${shot.art}.jpg`;
    shot.lines.forEach((line, i) => {
      if (!line.clip) return;
      const v = document.createElement("video");
      v.className = "clip";
      v.src = `assets/Story/${line.clip}.mp4`;
      v.preload = "auto";
      v.playsInline = true;
      v.style.opacity = "0";
      v.addEventListener("playing", () => { v.style.opacity = "1"; }); // clear until its first frame
      v.addEventListener("ended", () => { if (this.clips.get(this.lineIndex) === v) this.wait(StoryPlayer.pause); });
      this.root.insertBefore(v, this.caption);
      this.clips.set(i, v);
    });
  }

  private say(): void {
    const line = this.line;
    if (!line) { this.finish(); return; }
    const titleCard = !this.shot?.art;
    this.card.hidden = !titleCard;
    this.caption.hidden = titleCard;
    if (titleCard) this.card.textContent = line.text;
    else {
      this.caption.querySelector("b")!.textContent = line.who;
      this.caption.querySelector("p")!.textContent = line.text;
    }
    // The clip of this line on top (an earlier clip stays below, holding its last frame).
    const clip = this.clips.get(this.lineIndex);
    if (clip) {
      for (const [i, v] of this.clips) if (i !== this.lineIndex && i > this.lineIndex) v.style.opacity = "0";
      this.root.insertBefore(clip, this.caption);
      clip.currentTime = 0;
      clip.play().catch(() => this.wait(Math.max(2.2, line.text.length * 0.07)));
      return;
    }
    if (line.voice) {
      const sound = new Audio(`assets/Story/${line.voice}.m4a`);
      this.voice = sound;
      sound.addEventListener("ended", () => { if (this.voice === sound) this.wait(StoryPlayer.pause); });
      sound.play().catch(() => this.wait(Math.max(2.2, line.text.length * 0.07)));
      return;
    }
    // Nothing to hear: a card, held long enough to read.
    this.wait(Math.max(2.2, line.text.length * 0.07));
  }

  private wait(seconds: number): void {
    if (this.waiting !== null) clearTimeout(this.waiting);
    this.waiting = window.setTimeout(() => { this.waiting = null; this.advance(); }, seconds * 1000);
  }
}
