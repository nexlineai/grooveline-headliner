// The career's content (web/content/career.json, generated from the iPhone's Swift by
// tools/content.ts). These types mirror App/Lesson.swift, Night.swift and Chapter.swift.

import type { TrackInfo } from "../core/beatgrid.ts";

export type Range = [number, number];
export const inRange = (r: Range, x: number): boolean => x >= r[0] && x <= r[1];

export type LessonTarget =
  | { type: "play" | "cue" | "channel" | "phones" | "pitch" | "record" | "sync" | "filter"; deck: number }
  | { type: "eq"; deck: number; band: number }
  | { type: "crossfader" | "cueMixKnob" | "crate" | "jingle" };

export type LessonGoal =
  | { type: "startDeck" | "phonesCue" | "syncOn" | "stopDeck"; deck: number }
  | { type: "bars"; bars: number }
  | { type: "startOnTheOne" | "startOnThePhrase"; deck: number; against: number }
  | { type: "nextPhrase" | "phonesReady" | "dubplateCut" | "crossfaderCut" | "listen" }
  | { type: "channelFader"; deck: number; range: Range; onThePhrase: boolean }
  | { type: "crossfader" | "cueMix"; range: Range }
  | { type: "eq"; deck: number; band: number; range: Range }
  | { type: "bassSwap"; from: number; to: number }
  | { type: "jinglePlayed"; onThePhrase: boolean }
  | { type: "hitThePost"; seconds: number; window: number }
  | { type: "recordLoaded"; deck: number; id: string }
  | { type: "pickRecord"; deck: number; good: string[] }
  | { type: "blendHeld"; bars: number; tolerance: number }
  | { type: "tempoMatched"; tolerance: number }
  | { type: "phaseHeld"; bars: number; tolerance: number }
  | { type: "filter"; deck: number; range: Range }
  | { type: "rideTempo"; deck: number; to: number }
  | { type: "pattern"; row: number; steps: number[] }
  | { type: "studioPage"; page: number };

export interface LessonStep {
  voice: string; text: string; task: string; goal: LessonGoal; target: LessonTarget | null;
  missVoice: string | null; missText: string | null; missTask: string | null; missTarget: LessonTarget | null;
  lateVoice: string | null; lateText: string | null;
  /** The needle of this deck skips (0.4 beat on) as the step begins. */
  skip: number | null;
}

export interface LessonDesk {
  crossfader: number; channel: number[]; sync: boolean[]; cueMix: number | null; room: string; syncAllowed: boolean;
  records: string[] | null; crate: boolean; chapter: number; hideBPM: boolean; pitch: number[] | null;
  bag: string[] | null; cueBar: number | null; studio: boolean; pattern: string | null; cutter: boolean;
  deadFader: number | null; echo: number; partner: number | null; partnerBag: string[]; partnerStyle: "helena" | "vex";
}

export interface Lesson { id: string; number: number; title: string; coach: string; desk: LessonDesk; steps: LessonStep[]; }

export interface Line { voice: string; text: string; }

export interface NightRequest { at: number; record: string; voice: string; text: string; }

export interface NightInfo {
  id: string; title: string; length: number; room: string; records: string[] | null; chapter: number;
  mixesFor3Stars: number; requests: NightRequest[];
  mishapAt: number | null; mishap: string; syncAllowed: boolean; maxMood: number; turnDownAt: number | null;
  remarks: { at: number; moment: string }[]; audience: "room" | "listeners" | "field"; coach: string;
  lines: Record<string, Line[]>; bag: string[] | null; hot: string[]; clockStart: number; judgeKeys: boolean;
  endBPM: number | null; mixdownCheck: boolean; deadFader: number | null; stopsAt: number | null; echo: number;
  climbTo: number | null; encoreWith: string[]; partner: number | null; partnerBag: string[];
  partnerStyle: "helena" | "vex"; closingSet: boolean; lastRecord: string | null; wholeCollection: boolean; mustEnd: boolean;
}

export type Screen =
  | { type: "title" | "booth" | "bag" | "credits" }
  | { type: "chapter"; number: number }
  | { type: "story" | "lesson" | "night"; id: string };

export interface ChapterStep { id: string; kind: "story" | "lesson" | "night"; title: string; detail: string; screens: Screen[]; icon: string | null; }
export interface Chapter { number: number; title: string; line: string; steps: ChapterStep[]; }

export interface Career {
  chapters: Chapter[];
  lessons: Lesson[];
  nights: NightInfo[];
  nightLines: Record<string, Line[]>;
  moods: string[];
  handsOff: Line;
  whiteLabel: string;
}

export interface Content { career: Career; tracks: TrackInfo[]; }

export async function loadContent(): Promise<Content> {
  const [career, tracks] = await Promise.all([
    fetch("content/career.json").then((r) => r.json() as Promise<Career>),
    fetch("assets/Tracks/tracks.json").then((r) => r.json() as Promise<TrackInfo[]>),
  ]);
  return { career, tracks };
}

/** A voice line (`App/Lessons/<name>.m4a`): one at a time, and whether it is still talking. */
export class Voice {
  private audio: HTMLAudioElement | null = null;
  get speaking(): boolean { return !!this.audio && !this.audio.paused && !this.audio.ended; }
  say(name: string): void {
    this.stop();
    const a = new Audio(`assets/Lessons/${name}.m4a`);
    this.audio = a;
    a.play().catch(() => { if (this.audio === a) this.audio = null; });
  }
  stop(): void {
    this.audio?.pause();
    this.audio = null;
  }
}
