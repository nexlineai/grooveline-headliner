// Keyboard shortcuts for laptops: the two hands a mouse does not have. Physical key positions
// (KeyboardEvent.code), so they sit in the same place on any keyboard layout. Every key goes
// through the booth's own controls (the same rules as a finger).

import type { Booth, Kind } from "../booth/booth.ts";

type Action =
  | { press: Kind }
  | { nudge: number; dir: number }
  | { step: Kind; by: number; fine: number };

const deck = (d: number) => ({
  cue: { press: { t: "cue", d } as Kind },
  play: { press: { t: "play", d } as Kind },
  sync: { press: { t: "sync", d } as Kind },
  phones: { press: { t: "phones", d } as Kind },
  slower: { nudge: d, dir: -1 },
  faster: { nudge: d, dir: 1 },
  // The pitch fader: up is slower, as on a turntable.
  pitchSlower: { step: { t: "pitch", d } as Kind, by: 0.0025, fine: 0.0005 },
  pitchFaster: { step: { t: "pitch", d } as Kind, by: -0.0025, fine: -0.0005 },
  faderDown: { step: { t: "channel", d } as Kind, by: -0.05, fine: -0.01 },
  faderUp: { step: { t: "channel", d } as Kind, by: 0.05, fine: 0.01 },
  lowDown: { step: { t: "eq", d, band: 0 } as Kind, by: -0.05, fine: -0.01 },
  lowUp: { step: { t: "eq", d, band: 0 } as Kind, by: 0.05, fine: 0.01 },
});
const A = deck(0), B = deck(1);

/** The map, and the words for the KEYS sheet (QWERTY labels). */
export const KEYS: { code: string; label: string; does: string; action: Action }[] = [
  { code: "KeyA", label: "A", does: "Left CUE (hold: plays from the mark)", action: A.cue },
  { code: "KeyS", label: "S", does: "Left PLAY", action: A.play },
  { code: "KeyD", label: "D", does: "Left SYNC", action: A.sync },
  { code: "KeyF", label: "F", does: "Left PHONES", action: A.phones },
  { code: "KeyQ", label: "Q", does: "Left: hold back (nudge)", action: A.slower },
  { code: "KeyW", label: "W", does: "Left: push on (nudge)", action: A.faster },
  { code: "Digit1", label: "1", does: "Left pitch: slower", action: A.pitchSlower },
  { code: "Digit2", label: "2", does: "Left pitch: faster", action: A.pitchFaster },
  { code: "KeyZ", label: "Z", does: "Left fader down", action: A.faderDown },
  { code: "KeyX", label: "X", does: "Left fader up", action: A.faderUp },
  { code: "KeyE", label: "E", does: "Left LOW down", action: A.lowDown },
  { code: "KeyR", label: "R", does: "Left LOW up", action: A.lowUp },
  { code: "KeyJ", label: "J", does: "Right CUE (hold: plays from the mark)", action: B.cue },
  { code: "KeyK", label: "K", does: "Right PLAY", action: B.play },
  { code: "KeyL", label: "L", does: "Right SYNC", action: B.sync },
  { code: "KeyH", label: "H", does: "Right PHONES", action: B.phones },
  { code: "KeyU", label: "U", does: "Right: hold back (nudge)", action: B.slower },
  { code: "KeyI", label: "I", does: "Right: push on (nudge)", action: B.faster },
  { code: "Digit9", label: "9", does: "Right pitch: slower", action: B.pitchSlower },
  { code: "Digit0", label: "0", does: "Right pitch: faster", action: B.pitchFaster },
  { code: "KeyN", label: "N", does: "Right fader down", action: B.faderDown },
  { code: "KeyM", label: "M", does: "Right fader up", action: B.faderUp },
  { code: "KeyO", label: "O", does: "Right LOW down", action: B.lowDown },
  { code: "KeyP", label: "P", does: "Right LOW up", action: B.lowUp },
  { code: "ArrowLeft", label: "←", does: "Crossfader left", action: { step: { t: "cross" }, by: -0.03, fine: -0.01 } },
  { code: "ArrowRight", label: "→", does: "Crossfader right", action: { step: { t: "cross" }, by: 0.03, fine: 0.01 } },
];

const byCode = new Map(KEYS.map((k) => [k.code, k.action]));

/** Listens on the window. `active()` says whether the booth is on screen (not the title, a
 * chapter, the bag or the credits); `help()` opens the sheet ("?"). Shift = small steps. */
export function attachKeys(booth: Booth, active: () => boolean, help: () => void): void {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
    if (e.key === "?") { help(); e.preventDefault(); return; }
    if (!active()) return;
    const a = byCode.get(e.code);
    if (!a) return;
    e.preventDefault();
    if ("press" in a) { if (!e.repeat) booth.press(a.press); return; } // toggles: not on key repeat
    if ("nudge" in a) { booth.nudgeKey(a.nudge, a.dir); return; }
    booth.setValue(a.step, booth.valueOf(a.step) + (e.shiftKey ? a.fine : a.by), false);
  });
  window.addEventListener("keyup", (e) => {
    const a = byCode.get(e.code);
    if (!a) return;
    if ("nudge" in a) booth.nudgeKey(a.nudge, 0);
    else if ("press" in a && a.press.t === "cue") booth.release(a.press); // CUE plays while it is held
  });
  // The window lost the keyboard: nothing stays held down (a nudge would stay bent).
  window.addEventListener("blur", () => booth.releaseKeys());
}
