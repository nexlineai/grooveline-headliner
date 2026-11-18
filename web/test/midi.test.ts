// The MIDI decoding and binding rules (no device needed).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MidiInput, SoftTakeover, absoluteValue, buttonActs, buttonMode, decode, relativeMode, relativeTicks, sourceOf,
} from "../src/input/midi.ts";

describe("MIDI decoding", () => {
  test("notes, with note-on at velocity 0 as a release", () => {
    assert.deepEqual(decode([0x90, 60, 100]), { type: "note", ch: 0, num: 60, value: 100, on: true });
    assert.deepEqual(decode([0x93, 60, 0]), { type: "note", ch: 3, num: 60, value: 0, on: false });
    assert.deepEqual(decode([0x80, 60, 64]), { type: "note", ch: 0, num: 60, value: 0, on: false });
  });

  test("control changes and 14-bit pitch bend", () => {
    assert.deepEqual(decode([0xb0, 7, 127]), { type: "cc", ch: 0, num: 7, value: 127 });
    const bend = decode([0xe1, 0x00, 0x40])!; // the middle
    assert.equal(bend.type, "bend");
    assert.equal(bend.value, 8192);
    assert.equal(absoluteValue(decode([0xe0, 0x7f, 0x7f])!), 1);
    assert.equal(absoluteValue(decode([0xb0, 1, 0])!), 0);
  });

  test("other messages are ignored", () => {
    assert.equal(decode([0xf8]), null); // clock
    assert.equal(decode([0xc0, 5]), null); // program change
  });

  test("the same control gives the same key", () => {
    assert.equal(sourceOf(decode([0xb2, 16, 1])!), "cc:2:16");
    assert.equal(sourceOf(decode([0x90, 36, 1])!), sourceOf(decode([0x80, 36, 0])!));
  });
});

describe("jog wheels", () => {
  test("two's complement and offset-64 encodings", () => {
    assert.equal(relativeMode(1), "twos");
    assert.equal(relativeMode(127), "twos");
    assert.equal(relativeMode(65), "offset");
    assert.equal(relativeMode(63), "offset");
    assert.equal(relativeTicks(3, "twos"), 3);
    assert.equal(relativeTicks(125, "twos"), -3);
    assert.equal(relativeTicks(66, "offset"), 2);
    assert.equal(relativeTicks(61, "offset"), -3);
  });
});

describe("buttons", () => {
  test("push buttons act when pressed, not when let go", () => {
    assert.ok(buttonActs(decode([0x90, 36, 127])!, "push"));
    assert.ok(!buttonActs(decode([0x90, 36, 0])!, "push"));
    assert.ok(buttonActs(decode([0xb0, 41, 127])!, "push"));
    assert.ok(!buttonActs(decode([0xb0, 41, 0])!, "push"));
  });

  test("latching buttons act on every change", () => {
    assert.ok(buttonActs(decode([0xb0, 41, 127])!, "toggle"));
    assert.ok(buttonActs(decode([0xb0, 41, 0])!, "toggle"));
  });

  test("learning tells a momentary CC button from a latching one", () => {
    const on = decode([0xb0, 41, 127])!;
    assert.equal(buttonMode(on, { value: 0, afterMs: 120 }), "push");
    assert.equal(buttonMode(on, null), "toggle");
    assert.equal(buttonMode(decode([0x90, 36, 100])!, null), "push");
  });
});

describe("soft takeover", () => {
  test("a fader takes over only when it reaches the screen value", () => {
    const t = new SoftTakeover();
    assert.ok(!t.feed("pitch:0:", 0.9, 0.5)); // far away: the deck does not jump
    assert.ok(!t.feed("pitch:0:", 0.7, 0.5));
    assert.ok(t.feed("pitch:0:", 0.49, 0.5)); // passed it: from now on it follows
    assert.ok(t.feed("pitch:0:", 0.2, 0.5));
  });

  test("near enough counts, and a reset makes it catch up again", () => {
    const t = new SoftTakeover();
    assert.ok(t.feed("cross::", 0.52, 0.5));
    t.reset();
    assert.ok(!t.feed("cross::", 1, 0.5));
  });
});

describe("learning and playing a controller", () => {
  const recorder = () => {
    const calls: string[] = [];
    const targets = {
      kindOf: () => null,
      press: (t: string) => { calls.push(`press ${t}`); },
      hold: (t: string, on: boolean) => { calls.push(`hold ${t} ${on}`); },
      setValue: (t: string, v: number) => { calls.push(`set ${t} ${v.toFixed(2)}`); },
      valueOf: () => 0.5,
      jog: (t: string, n: number) => { calls.push(`jog ${t} ${n}`); },
    };
    return { calls, midi: new MidiInput(targets) };
  };

  test("a momentary nudge button pushes while held and lets go on release", () => {
    const { calls, midi } = recorder();
    midi.learn("nudge:0:1", "hold");
    midi.handle("Korg", [0x90, 45, 127]); // a note button: learned at once
    midi.handle("Korg", [0x90, 45, 127]);
    midi.handle("Korg", [0x80, 45, 0]);
    assert.deepEqual(calls, ["hold nudge:0:1 true", "hold nudge:0:1 false"]);
  });

  test("a momentary CC button learned as a hold: off soon after on means push", () => {
    const { calls, midi } = recorder();
    midi.learn("nudge:1:-1", "hold");
    midi.handle("Korg", [0xb0, 44, 127]);
    midi.handle("Korg", [0xb0, 44, 0]); // its release, right after: momentary
    assert.equal(midi.bindingsOf("Korg")[0].mode, "push");
    midi.handle("Korg", [0xb0, 44, 127]);
    midi.handle("Korg", [0xb0, 44, 0]);
    assert.deepEqual(calls, ["hold nudge:1:-1 true", "hold nudge:1:-1 false"]);
  });

  test("a CUE learned as a push button (stored before CUE was held) now plays while held", () => {
    const calls: string[] = [];
    const midi = new MidiInput({
      kindOf: (t) => (t.startsWith("cue") ? "hold" : null),
      press: (t) => { calls.push(`press ${t}`); },
      hold: (t, on) => { calls.push(`hold ${t} ${on}`); },
      setValue: () => {}, valueOf: () => 0.5, jog: () => {},
    });
    midi.learn("cue:0:", "button"); // the old way: a push button
    midi.handle("Korg", [0x90, 45, 127]);
    assert.equal(midi.bindingsOf("Korg")[0].kind, "button");
    midi.handle("Korg", [0x90, 45, 127]);
    midi.handle("Korg", [0x80, 45, 0]);
    midi.handle("Korg", [0xb0, 45, 127]); // the same note on a CC is a different source: ignored
    assert.deepEqual(calls, ["hold cue:0: true", "hold cue:0: false"]);
  });

  test("out of the booth a held button does not start, but its let-go still arrives", () => {
    const calls: string[] = [];
    let live = true;
    const midi = new MidiInput({
      kindOf: (t) => (t.startsWith("cue") ? "hold" : "button"),
      press: (t) => { calls.push(`press ${t}`); },
      hold: (t, on) => { calls.push(`hold ${t} ${on}`); },
      setValue: () => {}, valueOf: () => 0.5, jog: () => {},
    });
    midi.active = () => live;
    midi.learn("cue:1:", "hold");
    midi.handle("Korg", [0x90, 46, 127]);
    midi.learn("play:1:", "button");
    midi.handle("Korg", [0x90, 47, 127]);
    midi.handle("Korg", [0x90, 46, 127]); // pressed in the booth
    live = false; // a scene opens while CUE is down
    midi.handle("Korg", [0x80, 46, 0]); // let go: must still arrive
    midi.handle("Korg", [0x90, 46, 127]); // pressed again outside the booth: nothing
    midi.handle("Korg", [0x90, 47, 127]); // a plain button outside the booth: nothing
    assert.deepEqual(calls, ["hold cue:1: true", "hold cue:1: false"]);
  });

  test("buttons and jogs keep working side by side", () => {
    const { calls, midi } = recorder();
    midi.learn("play:0:", "button");
    midi.handle("Korg", [0x90, 41, 127]);
    midi.learn("jog:0:", "relative");
    midi.handle("Korg", [0xb0, 16, 1]);
    midi.handle("Korg", [0x90, 41, 127]);
    midi.handle("Korg", [0xb0, 16, 127]);
    assert.deepEqual(calls, ["press play:0:", "jog jog:0: -1"]);
  });
});
