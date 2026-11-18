// Walks through a lesson (port of LessonRunner in App/Lesson.swift). The booth feeds it
// `BoothFacts` every frame; the overlay shows what it publishes.

import type { Lesson, LessonTarget, Line } from "./content.ts";
import { Voice, inRange } from "./content.ts";

/** Beats in a phrase: eight bars. */
export const PHRASE = 32;

/** What the lesson needs to know about the decks, read once a frame. */
export interface BoothFacts {
  motorOn: boolean[];
  /** The record is up to speed. */
  turning: boolean[];
  /** Needle position in beats on each record's own grid. */
  beat: number[];
  cross: number;
  channel: number[];
  /** EQ knobs per deck: low, mid, high; 0.5 is flat. */
  eq: number[][];
  /** The headphone output is on (split or sound card). */
  phonesOn: boolean;
  phones: boolean[];
  cueMix: number;
  bpm: number[];
  /** Where the right record's beat falls against the left one's, in beats (0 = together). */
  phase: number;
  records: (string | null)[];
  sync: boolean[];
  /** The room hears both records, and they have two basslines. */
  blend: boolean;
  bassClash: boolean;
  jingles: number;
  /** The clock, in seconds. */
  time: number;
  filter: number[];
  pattern: boolean[][];
  page: number;
  cuts: number;
  stepOns: number;
}

const mod = (x: number, m: number): number => { let r = x % m; if (r < 0) r += m; return r; };
const pad2 = (n: number): string => String(n).padStart(2, "0");

export class LessonRunner {
  readonly lesson: Lesson;
  private readonly handsOff: Line;
  caption = "";
  task = "";
  progress = "";
  taskDone = false;
  /** Set when the lesson is over: 1 to 3. */
  stars: number | null = null;
  /** The control to point at right now. */
  target: LessonTarget | null = null;
  /** Something the overlay shows changed. */
  version = 0;

  private readonly voice = new Voice();
  private index = 0;
  private started = false;
  private goalMet = false;
  private missed = false;
  private misses = 0;
  private oneError = 0;
  private startJudged = false;
  private outOnThePhrase: boolean | null = null;
  private phraseMove = "Out";
  private startBeat: number | null = null;
  private heldBeats = 0;
  private lastBeat: number | null = null;
  private jinglesSeen: number | null = null;
  private postAt: number | null = null;
  private postRearm = false;
  private recordsSeen: (string | null)[] | null = null;
  private pickMisses = 0;
  private picked = false;
  private rideAnchor: { beat: number; bpm: number } | null = null;
  private rideMisses = 0;
  private rode = false;
  private cutsSeen: number | null = null;
  private pendingSkip: number | null = null;
  private skipAt: number | null = null;
  private skipHeardOff = false;
  private skipFixed: number | null = null;
  private stepOnsSeen = 0;
  private stepMisses = 0;
  private wasOn = [false, false];
  private armed = false;
  private fresh = true;
  /** The step to begin with (screenshots jump into the middle of a lesson). */
  startAt = 0;

  constructor(lesson: Lesson, handsOff: Line) {
    this.lesson = lesson;
    this.handsOff = handsOff;
  }

  /** The coach is talking (the music steps back a little). */
  get speaking(): boolean { return this.voice.speaking; }

  begin(): void {
    if (this.started || this.lesson.steps.length === 0) return;
    this.started = true;
    this.enter(Math.min(Math.max(0, this.startAt), this.lesson.steps.length - 1));
  }

  stop(): void { this.voice.stop(); }

  private enter(i: number): void {
    this.index = i;
    this.goalMet = false;
    this.missed = false;
    this.armed = false;
    this.fresh = true;
    this.startBeat = null;
    this.heldBeats = 0;
    this.lastBeat = null;
    this.jinglesSeen = null;
    this.postAt = null;
    this.postRearm = false;
    this.recordsSeen = null;
    this.rideAnchor = null;
    this.cutsSeen = null;
    const step = this.lesson.steps[i];
    if (step.skip !== null) { this.pendingSkip = step.skip; this.skipAt = null; this.skipHeardOff = false; this.skipFixed = null; }
    this.show(step.text, step.task, step.target);
    this.voice.say(step.voice);
  }

  /** The deck whose needle skips now, once (the booth moves it). */
  takeSkip(): number | null {
    const d = this.pendingSkip;
    this.pendingSkip = null;
    return d;
  }

  private show(text: string, task: string, target: LessonTarget | null): void {
    this.caption = text;
    this.task = task;
    this.progress = "";
    this.taskDone = false;
    this.target = target;
    this.version++;
  }

  private setProgress(text: string): void {
    if (text !== this.progress) { this.progress = text; this.version++; }
  }

  private met(): void {
    this.goalMet = true;
    this.taskDone = true;
    this.target = null;
    this.version++;
  }

  private miss(text: string | null, voice: string | null, task?: string | null, target?: LessonTarget | null): void {
    const step = this.lesson.steps[this.index];
    this.show(text ?? step.text, task ?? step.task, target === undefined ? step.target : target);
    if (voice) this.voice.say(voice);
  }

  update(f: BoothFacts): void {
    if (!this.started || this.stars !== null || !this.lesson.steps[this.index]) return;
    const step = this.lesson.steps[this.index];
    if (f.stepOns > this.stepOnsSeen) {
      // A hand on her deck (the booth refused it): she says so, and it costs a star.
      this.stepOnsSeen = f.stepOns;
      this.stepMisses += 1;
      this.show(this.handsOff.text, step.task, this.goalMet ? null : step.target);
      if (this.goalMet) this.taskDone = true;
      this.voice.say(this.handsOff.voice);
    }
    // The skip: from the moment the kicks are heard apart until they are one again.
    if (step.skip !== null && this.skipFixed === null) {
      if (this.skipAt === null) this.skipAt = f.time;
      if (Math.abs(f.phase) > 0.2) this.skipHeardOff = true;
      if (this.skipHeardOff && Math.abs(f.phase) < 0.07) this.skipFixed = f.time - this.skipAt;
    }
    if (!this.goalMet) this.judge(f);
    this.wasOn = f.motorOn.slice();
    this.fresh = false;
    // Done early? The coach still finishes the sentence.
    if (this.goalMet && !this.speaking) {
      if (this.index + 1 < this.lesson.steps.length) this.enter(this.index + 1);
      else this.finish();
    }
  }

  private judge(f: BoothFacts): void {
    const step = this.lesson.steps[this.index];
    const g = step.goal;
    switch (g.type) {
      case "startDeck":
        if (f.turning[g.deck]) this.met();
        break;
      case "bars":
        if (f.turning[0]) {
          const from = this.startBeat ?? f.beat[0];
          this.startBeat = from;
          const gone = Math.max(0, (f.beat[0] - from) / 4);
          this.setProgress(`BAR ${Math.min(g.bars, Math.trunc(gone) + 1)} OF ${g.bars}`);
          if (gone >= g.bars) this.met();
        }
        break;
      case "nextPhrase":
        if (f.turning[0]) {
          const from = this.startBeat ?? f.beat[0];
          this.startBeat = from;
          this.showBar(f.beat[0]);
          // Over when the needle crosses into a phrase that began after this step did.
          if (Math.floor(f.beat[0] / PHRASE) > Math.floor(from / PHRASE)) this.met();
        }
        break;
      case "eq":
        if (inRange(g.range, f.eq[g.deck][g.band])) this.met();
        break;
      case "jinglePlayed": {
        const seen = this.jinglesSeen ?? f.jingles;
        this.jinglesSeen = f.jingles;
        if (f.jingles > seen) {
          const into = mod(f.beat[0], PHRASE);
          if (!g.onThePhrase || Math.min(into, PHRASE - into) <= 4) this.met();
          else { this.misses += 1; this.miss(step.missText, step.missVoice); }
        }
        if (!this.goalMet) this.showBar(f.beat[0]);
        break;
      }
      case "hitThePost": {
        const out = f.channel[0] <= 0.04 && f.channel[1] <= 0.04;
        if (this.postRearm) {
          // After a miss: faders back up, then a fresh countdown.
          if (!out) {
            this.postRearm = false;
            this.postAt = f.time + g.seconds;
            this.show(step.text, step.task, step.target);
          }
          break;
        }
        const zero = this.postAt ?? f.time + g.seconds;
        this.postAt = zero;
        const left = zero - f.time;
        const whole = Math.ceil(left);
        this.setProgress(left > 0 ? `NEWS IN ${Math.trunc(whole / 60)}:${pad2(whole % 60)}` : "NEWS NOW");
        if (out || left < -g.window) {
          if (out && Math.abs(left) <= g.window) {
            this.oneError = Math.abs(left) / 4; // the result card reads it like a start: closer is better
            this.startJudged = true;
            this.met();
          } else {
            this.misses += 1;
            this.postRearm = true;
            const early = out && left > g.window;
            this.miss(early ? step.missText : step.lateText, early ? step.missVoice : step.lateVoice, "BOTH FADERS BACK UP, THEN TRY AGAIN", null);
          }
        }
        break;
      }
      case "blendHeld": {
        const beat = f.beat[0];
        const moved = this.lastBeat === null ? 0 : Math.max(0, Math.min(0.5, beat - this.lastBeat));
        this.lastBeat = beat;
        let text: string;
        if (!(f.turning[0] && f.turning[1]) || !f.blend) text = "BOTH RECORDS IN THE ROOM";
        else if (Math.abs(f.phase) >= g.tolerance) text = "KICKS APART — NUDGE";
        else if (f.bassClash) text = "BASS CLASH — KILL A LOW";
        else {
          this.heldBeats += moved;
          text = `BLEND ${Math.min(g.bars, Math.trunc(this.heldBeats / 4))} OF ${g.bars} BARS`;
        }
        this.setProgress(text);
        if (this.heldBeats >= g.bars * 4) this.met();
        break;
      }
      case "recordLoaded":
        if (f.records[g.deck] === g.id) this.met();
        break;
      case "pickRecord": {
        const id = f.records[g.deck];
        if (id && g.good.includes(id)) {
          this.picked = true;
          this.met();
        } else {
          // A record other than the one that was there, and not a good one: too hot.
          const seen = this.recordsSeen ?? f.records;
          if (id !== null && id !== seen[g.deck]) { this.pickMisses += 1; this.miss(step.missText, step.missVoice); }
        }
        this.recordsSeen = f.records.slice();
        break;
      }
      case "syncOn":
        if (f.sync[g.deck]) this.met();
        break;
      case "tempoMatched": {
        const gap = Math.abs(f.bpm[0] - f.bpm[1]);
        this.setProgress(this.lesson.desk.hideBPM ? "BY EAR" : gap <= g.tolerance ? "MATCHED" : `${gap.toFixed(1)} BPM APART`);
        if (gap <= g.tolerance && f.turning[0] && f.turning[1]) this.met();
        break;
      }
      case "phaseHeld":
        // Counted in beats of the left record; a slip starts the count again.
        if (f.turning[0] && f.turning[1] && Math.abs(f.phase) < g.tolerance) {
          const from = this.startBeat ?? f.beat[0];
          this.startBeat = from;
          const held = (f.beat[0] - from) / 4;
          this.setProgress(`LOCKED ${Math.min(g.bars, Math.trunc(held))} OF ${g.bars} BARS`);
          if (held >= g.bars) this.met();
        } else {
          this.startBeat = null;
          this.setProgress(f.turning[0] && f.turning[1] && !this.lesson.desk.hideBPM ? `${f.phase >= 0 ? "+" : "-"}${Math.abs(f.phase).toFixed(2)} BEAT` : "");
        }
        break;
      case "phonesReady":
        if (f.phonesOn) this.met();
        break;
      case "phonesCue":
        if (f.phones[g.deck]) this.met();
        break;
      case "cueMix":
        if (inRange(g.range, f.cueMix)) this.met();
        break;
      case "bassSwap":
        this.showBar(f.beat[g.to]);
        if (f.eq[g.from][0] <= 0.1 && f.eq[g.to][0] >= 0.45 && f.eq[g.to][0] <= 0.56) {
          const into = mod(f.beat[g.to], PHRASE);
          this.outOnThePhrase = Math.min(into, PHRASE - into) <= 4;
          this.phraseMove = "Swap";
          this.met();
        }
        break;
      case "channelFader":
        if (g.onThePhrase) this.showBar(f.beat[1 - g.deck]);
        if (inRange(g.range, f.channel[g.deck])) {
          if (g.onThePhrase) {
            // Within a bar of a phrase change on the record that stays?
            const into = mod(f.beat[1 - g.deck], PHRASE);
            this.outOnThePhrase = Math.min(into, PHRASE - into) <= 4;
          }
          this.met();
        }
        break;
      case "startOnTheOne":
      case "startOnThePhrase": {
        // The records have to line up bar on bar, or phrase on phrase.
        const { deck, against } = g;
        let span = 4;
        if (g.type === "startOnThePhrase") {
          span = PHRASE;
          if (!this.missed) this.showBar(f.beat[against]);
        }
        if (this.fresh && f.motorOn[deck]) {
          // Already running when the step began: it has to be stopped first.
          this.missed = true;
          this.show(step.text, step.missTask ?? step.task, step.missTarget ?? step.target);
        }
        if (f.motorOn[deck] && !this.wasOn[deck]) this.armed = true;
        if (!f.motorOn[deck]) {
          this.armed = false;
          if (this.missed) {
            // Stopped after a miss: back to the instruction, ready for another go.
            this.missed = false;
            this.show(step.text, step.task, step.target);
          }
        }
        if (this.armed && f.turning[deck] && f.turning[against]) {
          // Up to speed: where do its bars fall against the other record's bars?
          this.armed = false;
          const apart = mod(f.beat[against] - f.beat[deck], span);
          const error = Math.min(apart, span - apart);
          if (error <= 0.4) {
            this.oneError = error;
            this.startJudged = true;
            this.met();
          } else {
            this.misses += 1;
            this.missed = true;
            this.miss(step.missText, step.missVoice, step.missTask, step.missTarget ?? step.target);
          }
        }
        break;
      }
      case "crossfader":
        if (inRange(g.range, f.cross)) this.met();
        break;
      case "stopDeck":
        if (!f.motorOn[g.deck]) this.met();
        break;
      case "filter":
        if (inRange(g.range, f.filter[g.deck])) this.met();
        break;
      case "studioPage":
        if (f.page === g.page) this.met();
        break;
      case "crossfaderCut":
        this.showBar(f.beat[0]);
        if (f.cross >= 0.96) {
          const into = mod(f.beat[0], PHRASE);
          this.outOnThePhrase = Math.min(into, PHRASE - into) <= 4;
          this.phraseMove = "Cut";
          this.met();
        }
        break;
      case "dubplateCut": {
        const seen = this.cutsSeen ?? f.cuts;
        this.cutsSeen = seen;
        if (f.cuts > seen) this.met();
        break;
      }
      case "pattern": {
        const row = f.pattern[g.row];
        if (row) {
          const on = row.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
          if (JSON.stringify(on) === JSON.stringify(g.steps.slice().sort((a, b) => a - b))) this.met();
        }
        break;
      }
      case "rideTempo": {
        const bpm = f.bpm[g.deck], beat = f.beat[g.deck];
        const a = this.rideAnchor;
        if (a && beat >= a.beat && beat - a.beat < 4) {
          if (a.bpm - bpm > 1.5) {
            // More than 1.5 BPM down within one bar: everybody felt the brakes.
            this.rideMisses += 1;
            this.miss(step.missText, step.missVoice);
            this.rideAnchor = { beat, bpm };
          }
        } else {
          this.rideAnchor = { beat, bpm };
        }
        this.setProgress(`${bpm.toFixed(1)} BPM → ${g.to.toFixed(0)}`);
        if (bpm <= g.to + 0.3 && f.turning[g.deck]) { this.rode = true; this.met(); }
        break;
      }
      case "listen":
        if (!this.speaking) this.met();
        break;
    }
  }

  /** Where the needle is in its phrase, for the task chip: "BAR 7 OF 8". */
  private showBar(beat: number): void {
    this.setProgress(`BAR ${Math.trunc(mod(beat, PHRASE) / 4) + 1} OF 8`);
  }

  private finish(): void {
    // Stars for what took skill: how close the start was and on which try, and, where the
    // lesson asks for it, taking the old record out at a phrase change.
    const misses = this.misses + this.pickMisses + this.rideMisses + this.stepMisses;
    let earned = misses === 0 && this.oneError <= 0.15 ? 3 : misses <= 1 && this.oneError <= 0.3 ? 2 : 1;
    if (this.outOnThePhrase === false) earned = Math.min(earned, 2);
    if (this.skipFixed !== null && this.skipFixed > 6) earned = Math.min(earned, 2); // the room heard it too long
    this.target = null;
    this.stars = earned;
    this.version++;
  }

  /** One line about how it went, for the result card. */
  get verdict(): string {
    const parts: string[] = [];
    if (this.picked) parts.push(this.pickMisses === 0 ? "Pick: right first time" : `Pick: ${this.pickMisses} too hot`);
    if (this.rode) parts.push(this.rideMisses === 0 ? "Tempo: nobody felt it" : `Tempo: ${this.rideMisses} jolt${this.rideMisses === 1 ? "" : "s"}`);
    if (this.startJudged) {
      const tries = this.misses === 0 ? "first try" : this.misses === 1 ? "second try" : `try ${this.misses + 1}`;
      const how = this.oneError <= 0.15 ? "Right on it" : this.oneError <= 0.3 ? "Close" : "Near enough";
      parts.push(`Start: ${how.toLowerCase()}, ${tries}`);
    }
    if (this.outOnThePhrase !== null) {
      parts.push(this.outOnThePhrase ? `${this.phraseMove}: on the phrase` : `${this.phraseMove}: in the middle of a phrase`);
    }
    if (this.skipFixed !== null) parts.push(`Skip: fixed in ${this.skipFixed.toFixed(1)} s`);
    if (this.lesson.desk.partner !== null) parts.push(this.stepMisses === 0 ? "Hands: never on her deck" : `Hands: on her deck ${this.stepMisses}×`);
    return parts.join("   ·   ");
  }
}
