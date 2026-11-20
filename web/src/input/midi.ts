// Any MIDI (or class-compliant USB) controller, by learning: click a control on the decks, move a
// knob, fader, button or jog on the controller, and it is bound. Bindings are kept per device
// name in this browser. No controller is assumed (Zé's Korg nanoKONTROL2 is one of many).
//
// The decoding and the binding rules are plain functions (tested in test/midi.test.ts); the
// MidiInput class wires them to the Web MIDI API (Chrome, Edge, Firefox, Opera; not Safari).

export type MidiEvent =
  | { type: "note"; ch: number; num: number; value: number; on: boolean }
  | { type: "cc"; ch: number; num: number; value: number }
  | { type: "bend"; ch: number; num: 0; value: number };

/** One MIDI message, or null for the ones a controller's knobs and buttons never send. */
export function decode(data: ArrayLike<number>): MidiEvent | null {
  if (data.length < 2) return null;
  const status = data[0] & 0xf0, ch = data[0] & 0x0f;
  const d1 = data[1] & 0x7f, d2 = (data[2] ?? 0) & 0x7f;
  switch (status) {
    case 0x90: return { type: "note", ch, num: d1, value: d2, on: d2 > 0 }; // velocity 0 = note off
    case 0x80: return { type: "note", ch, num: d1, value: 0, on: false };
    case 0xb0: return { type: "cc", ch, num: d1, value: d2 };
    case 0xe0: return { type: "bend", ch, num: 0, value: d1 | (d2 << 7) }; // 14 bits, 8192 = middle
    default: return null;
  }
}

/** Which physical control sent it: the same knob always gives the same key. */
export const sourceOf = (e: MidiEvent): string => `${e.type}:${e.ch}:${e.num}`;

/** button: acts once per press (PLAY, CUE). hold: on while pressed, off when let go (a nudge
 * button). absolute: a knob or fader. relative: a jog wheel. */
export type TargetKind = "button" | "hold" | "absolute" | "relative";
/** push: acts when pressed (momentary buttons). toggle: acts on every change (latching buttons,
 * which send "on" at one press and "off" at the next). twos / offset: how a jog counts its steps. */
export type BindingMode = "push" | "toggle" | "twos" | "offset" | "abs";

export interface Binding { source: string; target: string; kind: TargetKind; mode: BindingMode; }

// MARK: - A configuration file: what was learned, saved as a small text file and read again (on another computer, or by someone else with the same controller)

/** The file's own mark, so a file of something else is not taken for one of these. */
export const MIDI_CONFIG_APP = "grooveline-headliner-midi";
export interface MidiConfig { app: typeof MIDI_CONFIG_APP; version: 1; saved: string; bindings: Record<string, Binding[]> }

/** The bindings as the text of a config file (pretty, so it can be read and edited by hand). */
export function midiConfigText(bindings: Record<string, Binding[]>, saved = new Date().toISOString()): string {
  const clean: Record<string, Binding[]> = {};
  for (const [device, list] of Object.entries(bindings)) if (list.length) clean[device] = list.map((b) => ({ source: b.source, target: b.target, kind: b.kind, mode: b.mode }));
  const file: MidiConfig = { app: MIDI_CONFIG_APP, version: 1, saved, bindings: clean };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const SOURCE = /^(note|cc|bend):([0-9]|1[0-5]):([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-7])$/;
const MODES: Record<TargetKind, readonly BindingMode[]> = { button: ["push", "toggle"], hold: ["push", "toggle"], absolute: ["abs"], relative: ["twos", "offset"] };
/** Files and what is in them are bounded: nobody has more than a few hundred controls. */
const CONFIG_MAX = { chars: 400_000, devices: 64, perDevice: 600 };

export type MidiConfigResult =
  | { ok: true; bindings: Record<string, Binding[]>; devices: number; bound: number; skipped: number }
  | { ok: false; error: string };

/** Reads a config file's text. Every binding is checked: a source like `cc:0:16`, a target this page knows (`kindOf`), a mode that fits that target. What does not pass is
 * skipped and counted (a file from a newer version may have controls this one lacks), never half-applied. `kindOf` is the page's own, so the kind is never taken from the file. */
export function parseMidiConfig(text: string, kindOf: (target: string) => TargetKind | null): MidiConfigResult {
  if (text.length > CONFIG_MAX.chars) return { ok: false, error: "That file is too big to be a MIDI config." };
  let file: unknown;
  try { file = JSON.parse(text); } catch { return { ok: false, error: "That is not a MIDI config file (it is not readable as JSON)." }; }
  const f = file as Partial<MidiConfig> | null;
  if (!f || typeof f !== "object" || f.app !== MIDI_CONFIG_APP) return { ok: false, error: "That is not a Headliner MIDI config file." };
  if (f.version !== 1) return { ok: false, error: "That config comes from a newer version of Headliner." };
  if (!f.bindings || typeof f.bindings !== "object" || Array.isArray(f.bindings)) return { ok: false, error: "That MIDI config has no controllers in it." };
  const out: Record<string, Binding[]> = {};
  let bound = 0, skipped = 0;
  const entries = Object.entries(f.bindings as Record<string, unknown>);
  if (entries.length > CONFIG_MAX.devices) return { ok: false, error: "That MIDI config has too many controllers in it." };
  for (const [device, raw] of entries) {
    if (!device || device === "__proto__" || device.length > 200 || !Array.isArray(raw)) { skipped += Array.isArray(raw) ? raw.length : 1; continue; }
    const list: Binding[] = [];
    for (const item of raw.slice(0, CONFIG_MAX.perDevice)) {
      const b = item as Partial<Binding> | null;
      const kind = b && typeof b.target === "string" ? kindOf(b.target) : null;
      if (!b || !kind || typeof b.source !== "string" || !SOURCE.test(b.source)) { skipped++; continue; }
      const mode = (MODES[kind] as readonly string[]).includes(b.mode as string) ? (b.mode as BindingMode) : MODES[kind][0];
      // One control, one target: a later line wins over an earlier one for the same control or the same target (as learning does).
      const at = list.filter((x) => x.source !== b.source && x.target !== b.target);
      at.push({ source: b.source, target: b.target as string, kind, mode });
      list.length = 0; list.push(...at);
    }
    skipped += Math.max(0, raw.length - CONFIG_MAX.perDevice);
    if (list.length) { out[device] = list; bound += list.length; }
  }
  if (!bound) return { ok: false, error: skipped ? "Nothing in that MIDI config fits this version of Headliner." : "That MIDI config is empty." };
  return { ok: true, bindings: out, devices: Object.keys(out).length, bound, skipped };
}

/** 0...1 from an absolute knob or fader. */
export function absoluteValue(e: MidiEvent): number {
  if (e.type === "bend") return e.value / 16383;
  return e.value / 127;
}

/** How a jog wheel counts: small values (1-15) or values just under 128 (113-127) are steps in
 * two's complement; values around 64 (48-80) are steps from a middle of 64. */
export function relativeMode(value: number): "twos" | "offset" {
  return value >= 48 && value <= 80 ? "offset" : "twos";
}

/** Steps turned (positive = forwards) by one relative message. */
export function relativeTicks(value: number, mode: BindingMode): number {
  if (mode === "offset") return value - 64;
  return value < 64 ? value : value - 128;
}

/** Whether a button message acts now. */
export function buttonActs(e: MidiEvent, mode: BindingMode): boolean {
  const pressed = e.type === "note" ? e.on : e.value >= 64;
  return mode === "toggle" ? true : pressed;
}

/** For a button learned from a CC: a momentary one sends its "off" right after its "on"; a
 * latching one does not. Decided from the time between the first two messages. */
export function buttonMode(first: MidiEvent, release: { value: number; afterMs: number } | null): BindingMode {
  if (first.type === "note") return "push";
  return release && release.value < 64 && release.afterMs < 600 ? "push" : "toggle";
}

/** Soft takeover: a physical fader only takes over once it reaches the value on screen (or
 * passes it), so a desk that was reset by a lesson does not jump when the fader is first moved. */
export class SoftTakeover {
  private engaged = new Map<string, boolean>();
  private last = new Map<string, number>();

  /** True when the physical value should be applied now. */
  feed(target: string, physical: number, screen: number): boolean {
    if (this.engaged.get(target)) return true;
    const was = this.last.get(target);
    this.last.set(target, physical);
    const near = Math.abs(physical - screen) <= 0.03;
    const crossed = was !== undefined && (was - screen) * (physical - screen) <= 0;
    if (near || crossed) {
      this.engaged.set(target, true);
      return true;
    }
    return false;
  }

  /** The screen values were reset (a new lesson or night): every fader must catch up again. */
  reset(): void {
    this.engaged.clear();
    this.last.clear();
  }

  /** Something on screen moved by itself (her fader, SYNC, a reset): this fader must catch up. */
  release(target: string): void {
    this.engaged.delete(target);
    this.last.delete(target);
  }
}

// MARK: - The Web MIDI side

export interface MidiTargets {
  kindOf(target: string): TargetKind | null;
  press(target: string): void;
  /** A hold target (a nudge button) is pressed (true) or let go (false). */
  hold(target: string, on: boolean): void;
  setValue(target: string, v: number): void;
  valueOf(target: string): number;
  jog(target: string, ticks: number): void;
}

type Learning = { target: string; kind: TargetKind; first: MidiEvent | null; at: number; source: string; device: string } | null;

const STORE = "headliner.midi.v1";

export class MidiInput {
  private access: MIDIAccess | null = null;
  private bindings: Record<string, Binding[]> = {};
  private learning: Learning = null;
  private readonly takeover = new SoftTakeover();
  /** Hold targets bound to latching buttons: on or off now. */
  private held = new Map<string, boolean>();
  private readonly targets: MidiTargets;
  /** Devices or bindings changed (the page redraws its list). */
  onChange: () => void = () => {};
  /** A binding was learned: what was bound, in words. */
  onLearned: (b: Binding, device: string) => void = () => {};
  /** Whether the booth is on screen: a controller does nothing during a scene, a menu or a
   * result card (a bumped button must not start a deck under the dialogue). Learning still works. */
  active: () => boolean = () => true;

  constructor(targets: MidiTargets) {
    this.targets = targets;
    try { this.bindings = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, Binding[]>; } catch { this.bindings = {}; }
  }

  static get supported(): boolean { return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator; }

  get connected(): boolean { return this.access !== null; }

  /** Asks the browser for MIDI (it may show a prompt), then listens to every input, also the ones
   * plugged in later. */
  async connect(): Promise<void> {
    if (this.access) return;
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.attach();
    this.access.onstatechange = () => { this.attach(); this.onChange(); };
    this.onChange();
  }

  private attach(): void {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (m: MIDIMessageEvent) => { if (m.data) this.handle(input.name ?? "MIDI device", m.data); };
    });
  }

  /** The devices connected now. */
  devices(): string[] {
    const names: string[] = [];
    this.access?.inputs.forEach((i) => { if (i.state === "connected") names.push(i.name ?? "MIDI device"); });
    return names;
  }

  bindingsOf(device: string): Binding[] { return this.bindings[device] ?? []; }
  allBindings(): Record<string, Binding[]> { return this.bindings; }

  /** Waits for the next control moved on a controller, for this target. */
  learn(target: string, kind: TargetKind): void {
    this.learning = { target, kind, first: null, at: 0, source: "", device: "" };
  }

  stopLearning(): void { this.finishButton(); this.learning = null; }
  get isLearning(): boolean { return this.learning !== null; }

  forget(device: string, source: string): void {
    this.bindings[device] = (this.bindings[device] ?? []).filter((b) => b.source !== source);
    this.save();
  }

  setMode(device: string, source: string, mode: BindingMode): void {
    const b = (this.bindings[device] ?? []).find((x) => x.source === source);
    if (b) { b.mode = mode; this.save(); }
  }

  clear(): void { this.bindings = {}; this.save(); }

  /** The bindings as the text of a config file. */
  configText(): string { return midiConfigText(this.bindings); }

  /** Puts a read config in: each controller in it gets the file's bindings (replacing its own); other controllers are left alone. */
  importBindings(bindings: Record<string, Binding[]>): void {
    for (const [device, list] of Object.entries(bindings)) this.bindings[device] = list.map((b) => ({ ...b }));
    this.takeover.reset();
    this.save();
  }

  /** A controller's bindings for another controller (the same device under another name: ALSA, Windows and macOS each name a USB controller differently). */
  copyBindings(from: string, to: string): void {
    if (from === to || !this.bindings[from]?.length) return;
    this.bindings[to] = this.bindings[from].map((b) => ({ ...b }));
    this.takeover.reset();
    this.save();
  }

  /** A new lesson or night set the desk: faders must catch up with the screen again. */
  resetTakeover(): void { this.takeover.reset(); }

  private save(): void {
    try { localStorage.setItem(STORE, JSON.stringify(this.bindings)); } catch { /* private window */ }
    this.onChange();
  }

  private bind(device: string, b: Binding): void {
    const list = (this.bindings[device] ?? []).filter((x) => x.source !== b.source && x.target !== b.target);
    list.push(b);
    this.bindings[device] = list;
    this.takeover.release(b.target);
    this.save();
    this.onLearned(b, device);
  }

  /** A learned CC button decides push or toggle once the moment for its "off" has passed. */
  private finishButton(release: { value: number; afterMs: number } | null = null): void {
    const l = this.learning;
    if (!l || !l.first || (l.kind !== "button" && l.kind !== "hold")) return;
    this.learning = null;
    this.bind(l.device, { source: l.source, target: l.target, kind: l.kind, mode: buttonMode(l.first, release) });
  }

  handle(device: string, data: ArrayLike<number>): void {
    const e = decode(data);
    if (!e) return;
    const source = sourceOf(e);
    const l = this.learning;
    if (l) {
      if (l.first) {
        // A learned CC button: its "off" soon after the "on" means a momentary button.
        if (source === l.source && e.type === "cc") this.finishButton({ value: e.value, afterMs: performance.now() - l.at });
        return;
      }
      if (e.type === "note" && !e.on) return; // a release is not a choice
      if (l.kind === "button" || l.kind === "hold") {
        if (e.type === "note") { this.learning = null; this.bind(device, { source, target: l.target, kind: l.kind, mode: "push" }); return; }
        this.learning = { ...l, first: e, at: performance.now(), source, device };
        setTimeout(() => { if (this.learning?.first === e) this.finishButton(null); }, 650);
        return;
      }
      if (l.kind === "relative") {
        if (e.type !== "cc") return;
        this.bind(device, { source, target: l.target, kind: "relative", mode: relativeMode(e.value) });
      } else {
        if (e.type === "note") return; // a fader or knob is a CC or a pitch bend
        this.bind(device, { source, target: l.target, kind: "absolute", mode: "abs" });
      }
      this.learning = null;
      return;
    }
    const b = (this.bindings[device] ?? []).find((x) => x.source === source);
    if (!b) return;
    // What the target is now, not what it was when learned (CUE was a push button, now it is held).
    const kind = this.targets.kindOf(b.target) ?? b.kind;
    const live = this.active();
    if (!live && kind !== "hold") return;
    switch (kind) {
      case "button":
        if (buttonActs(e, b.mode)) this.targets.press(b.target);
        break;
      case "hold": {
        // A momentary button: on while pressed. A latching one: every press switches it.
        const on = b.mode === "toggle" ? !(this.held.get(b.target) ?? false) : (e.type === "note" ? e.on : e.value >= 64);
        // Out of the booth (a scene, a menu) a press does nothing, but a let-go must still arrive.
        if (!live && on) break;
        this.held.set(b.target, on);
        this.targets.hold(b.target, on);
        break;
      }
      case "relative":
        if (e.type === "cc") this.targets.jog(b.target, relativeTicks(e.value, b.mode));
        break;
      case "absolute": {
        const v = absoluteValue(e);
        if (this.takeover.feed(b.target, v, this.targets.valueOf(b.target))) this.targets.setValue(b.target, v);
        break;
      }
    }
  }
}
