// A night (port of NightRunner in App/Night.swift): you play for a room and the room answers.
// No coach, no steps. The crowd's energy rises with a fresh record and a clean blend, sags when a
// record has been on too long, and drops fast on a train wreck or dead air. Tó (or the night's
// coach) says what is happening. The night ends on the clock; the stars are for the whole night.

import type { MixState } from "../core/mixjudge.ts";
import type { Line, NightInfo, NightRequest } from "./content.ts";
import { PHRASE } from "./lesson.ts";

export interface NightFacts {
  dt: number;
  state: MixState;
  quality: number;
  bassClash: boolean;
  /** The louder deck. */
  lead: number;
  onAirRecord: string | null;
  channel: number[];
  jingles: number;
  beat: number;
  /** The room hears a record stuck in one groove. */
  stuck: boolean;
  keyClash: boolean;
  onAirBPM: number;
  lowOnAir: number;
  stepOns: number;
  partnerAnswers: number;
  partnerSteals: number;
  partnerFights: number;
}

const clockText = (minutes: number): string =>
  `${String(Math.trunc(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export class NightRunner {
  readonly info: NightInfo;
  readonly title: string;
  /** Seconds of play, from the first record to the end of the night. */
  readonly length: number;
  private readonly general: Record<string, Line[]>;
  private readonly handsOff: Line;

  energyShown = 0.3;
  /** 0 waiting, 1 nodding, 2 dancing, 3 going nuts. */
  mood = 0;
  clock: string;
  comment = "";
  commentBy = "";
  /** Set when the night is over: 0 (it did not count) to 3. */
  stars: number | null = null;
  /** Set when a `mustEnd` night did not end on its record: why it does not count. */
  missed: string | null = null;
  summary = "";
  /** Something the overlay shows changed. */
  version = 0;

  private nextRequest = 0;
  private pending: NightRequest | null = null;
  private requestsMet = 0;
  private mishapDue = false;
  private mishapDone = false;
  private nextRemark = 0;
  private turnDownAsked = false;
  private turnDownBy: number | null = null;
  private jinglesSeen: number | null = null;
  private lastJingleBonus = -100;
  private lastOnAirRecord: string | null = null;
  private hotPlayed = false;
  private stuckRun = 0;
  private keyClashRun = 0;
  private sourTime = 0;
  private graceUntil = -1;
  private bpmAnchor: { time: number; bpm: number } | null = null;
  private lastBPM = 0;
  private stopAt: number | null = null;
  private plateOnAirAt: number | null = null;
  private boomAsked = false;
  private boomBy: number | null = null;
  private stepOnsSeen = 0;
  private answersSeen = 0;
  private stealsSeen = 0;
  private fightsSeen = 0;

  private energy = 0.3;
  private began = false;
  private now = 0;
  private elapsed = 0;
  private energySum = 0;
  private onAir: number | null = null;
  private soloAge = 0;
  private toldStale = false;
  private blendTime = 0;
  private blendQuality = 0;
  private transitions = 0;
  private deadAir = 0;
  private deadAirRun = 0;
  private wreck = 0;
  private clashRun = 0;
  private driftRun = 0;
  private commentUntil = 0;
  private quietUntil = 0;
  private shownAt = -1;
  private turn = new Map<string, number>();
  private voice: HTMLAudioElement | null = null;

  constructor(info: NightInfo, length: number, general: Record<string, Line[]>, handsOff: Line) {
    this.info = info;
    this.title = info.title;
    this.length = length;
    this.general = general;
    this.handsOff = handsOff;
    this.clock = clockText(info.clockStart);
  }

  /** Listeners on the stream, from the energy (radio nights). */
  get listeners(): number { return Math.round(40 + this.energyShown * 1260); }
  /** People in front of a festival stage, from the energy (a 3 pm slot starts with two hundred). */
  get people(): number { return Math.round(200 + Math.max(0, this.energyShown - 0.3) / 0.7 * 4800); }

  /** Tó is talking (the music steps back a little). */
  get speaking(): boolean { return !!this.voice && !this.voice.paused && !this.voice.ended; }

  /** True once, when somebody has just kicked the cable: the record on air must stop. */
  takeMishap(): boolean {
    if (!this.mishapDue) return false;
    this.mishapDue = false;
    return true;
  }

  stop(): void {
    this.voice?.pause();
    this.voice = null;
  }

  private say(moment: string, urgent = false): void {
    if (!urgent && this.now < this.quietUntil) return;
    const options = this.info.lines[moment] ?? this.general[moment];
    if (!options || options.length === 0) return;
    const n = this.turn.get(moment) ?? 0;
    this.turn.set(moment, n + 1);
    this.speak(options[n % options.length]);
  }

  private speak(line: Line, by: string | null = null): void {
    this.commentBy = by ?? this.info.coach;
    this.comment = line.text;
    this.version++;
    this.voice?.pause();
    const audio = new Audio(`assets/Lessons/${line.voice}.m4a`);
    this.voice = audio;
    audio.play().catch(() => {});
    const at = this.now;
    this.commentUntil = at + 3;
    this.quietUntil = at + 7;
    // The line stays up as long as it is heard (the length is known once the file is read).
    audio.addEventListener("loadedmetadata", () => {
      if (this.voice !== audio || !isFinite(audio.duration)) return;
      const seconds = Math.max(3, audio.duration + 0.8);
      this.commentUntil = at + seconds;
      this.quietUntil = at + seconds + 4;
    });
  }

  /** Called every frame with what the room hears. */
  update(f: NightFacts): void {
    if (this.stars !== null) return;
    const info = this.info;
    // Back to back: a hand on her deck (refused) costs a little, and she says so at once.
    if (f.stepOns > this.stepOnsSeen) {
      this.stepOnsSeen = f.stepOns;
      this.energy = Math.max(0, this.energy - 0.05);
      if (info.partnerStyle === "vex") this.say("hands", true);
      else this.speak(this.handsOff, "HELENA");
    }
    // She starts an answer to your record: Tó tells you what comes next.
    if (f.partnerAnswers > this.answersSeen) { this.answersSeen = f.partnerAnswers; this.say("answer", true); }
    // VEX grabs your fader; pushing it back up in front of the room is a fight.
    if (f.partnerSteals > this.stealsSeen) { this.stealsSeen = f.partnerSteals; this.say("stolen", true); }
    if (f.partnerFights > this.fightsSeen) {
      this.fightsSeen = f.partnerFights;
      this.energy = Math.max(0, this.energy - 0.08);
      this.say("fight", true);
    }
    // Requests and the cable come at their moment of the night, and cannot wait for silence.
    if (this.began) {
      const share = this.elapsed / this.length;
      // A record too big for the slot (a warm-up playing the headliner's records).
      const id = f.onAirRecord;
      if (id && id !== this.lastOnAirRecord) {
        this.lastOnAirRecord = id;
        if (info.hot.includes(id) && !this.hotPlayed) { this.hotPlayed = true; this.say("hot", true); }
      }
      const req = info.requests[this.nextRequest];
      if (req && share >= req.at && !this.pending) {
        this.nextRequest += 1;
        if (id !== req.record) { this.pending = req; this.speak({ voice: req.voice, text: req.text }); }
        else this.requestsMet += 1; // already playing it
      }
      if (this.pending && id === this.pending.record) {
        this.pending = null;
        this.requestsMet += 1;
        this.energy = Math.min(1, this.energy + 0.12);
        this.say("requestDone", true);
      }
      // Your dubplate on a big system: the bass booms; its low knob must come down.
      if (info.mixdownCheck) {
        if (id === "your-dubplate" && this.plateOnAirAt === null) this.plateOnAirAt = this.now;
        if (this.plateOnAirAt !== null && !this.boomAsked && this.now - this.plateOnAirAt > 5 && id === "your-dubplate") {
          this.boomAsked = true;
          this.boomBy = this.now + 8;
          this.say("boom", true);
        }
        if (this.boomBy !== null) {
          if (id === "your-dubplate" && f.lowOnAir <= 0.35) {
            this.boomBy = null;
            this.energy = Math.min(1, this.energy + 0.05);
            this.say("boomOk", true);
          } else if (this.now > this.boomBy) {
            this.boomBy = null;
            this.energy = Math.max(0, this.energy - 0.12);
            this.say("boomNo", true);
          }
        }
      }
      const remark = info.remarks[this.nextRemark];
      if (remark && share >= remark.at) { this.say(remark.moment, true); this.nextRemark += 1; }
      // A jingle between two phrases sounds like a real station: a small lift, once a minute.
      const seen = this.jinglesSeen ?? f.jingles;
      this.jinglesSeen = f.jingles;
      if (f.jingles > seen) {
        const into = ((f.beat % PHRASE) + PHRASE) % PHRASE;
        if (Math.min(into, PHRASE - into) <= 4 && this.now - this.lastJingleBonus > 60 && f.state !== "silence") {
          this.lastJingleBonus = this.now;
          this.energy = Math.min(1, this.energy + 0.04);
          this.say("jingle");
        }
      }
      // The owner wants it quieter: the fader on air has to come down within eight seconds.
      if (info.turnDownAt !== null && !this.turnDownAsked && share >= info.turnDownAt && f.state !== "silence") {
        this.turnDownAsked = true;
        this.turnDownBy = this.now + 8;
        this.say("loud", true);
      }
      if (this.turnDownBy !== null && f.lead < f.channel.length) {
        if (f.channel[f.lead] < 0.6) {
          this.turnDownBy = null;
          this.energy = Math.min(1, this.energy + 0.05);
          this.say("loudOk", true);
        } else if (this.now > this.turnDownBy) {
          this.turnDownBy = null;
          this.energy = Math.max(0, this.energy - 0.12);
          this.say("loudNo", true);
        }
      }
      if (info.mishapAt !== null && !this.mishapDone && share >= info.mishapAt && f.state !== "silence") {
        this.mishapDone = true;
        this.mishapDue = true;
        if (info.mishap === "streamDrop") this.energy = Math.max(0, this.energy - 0.1); // listeners leave
        if (info.mishap === "powerCut") this.graceUntil = this.now + 6;
        if (info.mishap === "rainRush") this.energy = Math.min(1, this.energy + 0.15); // everybody runs into the tent
        this.say("cable", true);
      }
    }
    this.now += f.dt;
    if (this.comment && this.now > this.commentUntil) { this.comment = ""; this.version++; }
    if (!this.began) {
      if (f.state === "silence") {
        if (this.now > 5) this.say("wait");
        return;
      }
      this.began = true;
      this.say("start");
    }
    this.elapsed += f.dt;

    let rate = 0;
    switch (f.state) {
      case "silence":
        if (this.now < this.graceUntil) break; // the power is coming back: nobody's fault
        rate = -0.12;
        this.deadAir += f.dt;
        this.deadAirRun += f.dt;
        this.blendTime = 0;
        this.blendQuality = 0;
        if (this.deadAirRun > 1.5) this.say("dead");
        break;
      case "solo":
        this.deadAirRun = 0;
        this.clashRun = 0;
        this.driftRun = 0;
        if (this.onAir !== null && this.onAir !== f.lead) {
          // The other record has taken over.
          this.transitions += 1;
          this.soloAge = 0;
          this.toldStale = false;
          const clean = this.blendTime >= 4 && this.blendQuality / Math.max(0.01, this.blendTime) >= 0.6;
          this.energy += clean ? 0.1 : 0.02;
          this.say(clean ? "clean" : "rough");
        }
        this.blendTime = 0;
        this.blendQuality = 0;
        this.onAir = f.lead;
        this.soloAge += f.dt;
        if (this.soloAge >= 80) {
          rate = -0.012; // they have heard this one
          if (this.soloAge > 100 && !this.toldStale) { this.toldStale = true; this.say("stale"); }
        } else {
          rate = this.energy < 0.6 ? 0.008 : -0.004; // one record gets a room dancing, not screaming
        }
        break;
      case "blend":
        this.deadAirRun = 0;
        this.blendTime += f.dt;
        this.blendQuality += f.quality * f.dt;
        if (f.quality > 0.85) { rate = 0.012; this.driftRun = 0; }
        else if (f.quality > 0.6) { rate = 0.004; this.driftRun = 0; }
        else if (f.quality > 0.3) {
          rate = -0.03;
          this.driftRun += f.dt;
          if (this.driftRun > 3) this.say("slip");
        } else {
          rate = -0.09;
          this.wreck += f.dt;
          this.say("wreck");
        }
        if (f.bassClash) {
          this.clashRun += f.dt;
          if (this.clashRun > 6) this.say("clash");
        } else {
          this.clashRun = 0;
        }
        break;
    }
    // The same groove over and over: the room notices fast.
    if (f.stuck) {
      rate = -0.1;
      this.stuckRun += f.dt;
      if (this.stuckRun > 6) this.say("stuck");
    } else {
      this.stuckRun = 0;
    }
    // Keys that fight: a few seconds pass for a quick cut, then the room winces.
    if (f.keyClash && f.state === "blend") {
      this.keyClashRun += f.dt;
      if (this.keyClashRun > 3) {
        rate -= 0.03;
        this.sourTime += f.dt;
        this.say("keys");
      }
    } else {
      this.keyClashRun = 0;
    }
    // Afterhours: the tempo may only come down gently.
    if (info.endBPM !== null && f.state !== "silence") {
      const a = this.bpmAnchor;
      if (a && this.now - a.time < 2) {
        if (a.bpm - f.onAirBPM > 2) {
          this.energy = Math.max(0, this.energy - 0.06);
          this.say("brakes", true);
          this.bpmAnchor = { time: this.now, bpm: f.onAirBPM };
        }
      } else {
        this.bpmAnchor = { time: this.now, bpm: f.onAirBPM };
      }
    }
    if (f.state !== "silence") this.lastBPM = f.onAirBPM;
    // A small room only gets so wild.
    const cap = [0.24, 0.48, 0.75, 1.0][Math.min(3, Math.max(0, info.maxMood))];
    this.energy = Math.min(cap, Math.max(0, this.energy + rate * f.dt));
    this.energySum += this.energy * f.dt;

    // The mood follows the energy, with a little slack so it does not flicker at an edge.
    const edges = [0.22, 0.5, 0.78];
    let level = this.mood;
    while (level < 3 && this.energy > edges[level] + 0.03) level += 1;
    while (level > 0 && this.energy < edges[level - 1] - 0.03) level -= 1;
    if (level !== this.mood) {
      if (level === 3) this.say("nuts");
      this.mood = level;
      this.version++;
    }

    if (this.elapsed - this.shownAt >= 0.25) {
      this.shownAt = this.elapsed;
      this.energyShown = this.energy;
      // The night shows ninety minutes (from eleven to half past midnight, unless it starts later).
      this.clock = clockText(info.clockStart + Math.trunc(Math.min(1, this.elapsed / this.length) * 90));
      this.version++;
    }
    // The burnout: Tó stops the night halfway.
    if (info.stopsAt !== null && this.stopAt === null && this.elapsed >= this.length * info.stopsAt) {
      this.stopAt = this.now + 5;
      this.say("home", true);
    }
    if (this.stopAt !== null && this.now >= this.stopAt) { this.finish(true); return; }
    if (this.elapsed >= this.length) this.finish();
  }

  private finish(stopped = false): void {
    const info = this.info;
    this.version++;
    if (stopped) {
      this.stop();
      this.summary = "You stopped halfway.   ·   Tó took you home.";
      this.comment = "";
      this.stars = 1;
      return;
    }
    const crowd = this.energySum / Math.max(1, this.elapsed);
    const allRequests = this.requestsMet >= info.requests.length;
    // A small room tops out lower, so it needs less for three stars.
    const need = info.maxMood >= 3 ? 0.6 : 0.5;
    const broughtDown = info.endBPM === null || this.lastBPM <= info.endBPM + 0.5;
    const climbed = info.climbTo === null || this.lastBPM >= info.climbTo - 0.5;
    const encored = info.encoreWith.length === 0 || (this.lastOnAirRecord !== null && info.encoreWith.includes(this.lastOnAirRecord));
    const handsOff = info.partner === null || (this.stepOnsSeen === 0 && this.fightsSeen === 0);
    let earned: number;
    if (crowd >= need && this.transitions >= info.mixesFor3Stars && this.deadAir < 3 && this.wreck < 4 && allRequests &&
        !this.hotPlayed && broughtDown && climbed && encored && handsOff) earned = 3;
    else if (crowd >= 0.42 && this.transitions >= 1) earned = 2;
    else earned = 1;
    const mixes = this.transitions === 1 ? "1 mix" : `${this.transitions} mixes`;
    this.stop();
    let summary = `${mixes}   ·   crowd ${Math.round(crowd * 100)} %   ·   dead air ${Math.round(this.deadAir)} s`;
    if (info.requests.length) summary += `   ·   requests ${this.requestsMet} / ${info.requests.length}`;
    if (info.hot.length) summary += this.hotPlayed ? "   ·   too hot, too early" : "   ·   kept it warm";
    if (info.judgeKeys) summary += this.sourTime < 1 ? "   ·   in key" : `   ·   sour ${Math.round(this.sourTime)} s`;
    if (info.endBPM !== null || info.climbTo !== null) summary += `   ·   ended at ${Math.round(this.lastBPM)} BPM`;
    const whiteLabelOnly = info.encoreWith.length === 1 && info.encoreWith[0] === "white-label";
    if (whiteLabelOnly) summary += encored ? "   ·   ended on the white label" : "   ·   no white label";
    else if (info.encoreWith.length) summary += encored ? "   ·   encore!" : "   ·   no encore";
    if (info.partnerStyle === "vex") summary += this.fightsSeen === 0 ? "   ·   kept your cool" : `   ·   fought him ${this.fightsSeen}×`;
    else if (info.partner !== null) summary += this.stepOnsSeen === 0 ? "   ·   hands off her deck" : `   ·   on her deck ${this.stepOnsSeen}×`;
    this.summary = summary;
    this.comment = "";
    if (info.mustEnd && !encored) {
      this.missed = whiteLabelOnly ? "The set has to end on the white label. Lia's record, last." : "The night has to end on the right record.";
      this.stars = 0;
      return;
    }
    this.stars = earned;
  }
}
