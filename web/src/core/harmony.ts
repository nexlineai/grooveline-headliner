// Port of HeadlinerCore/Harmony.swift. Keys on the Camelot wheel ("8A" = A minor, "8B" = C
// major). Two records sound right together when their keys are neighbours on the wheel. Our
// decks have no key lock: speeding a record up also raises its pitch, so two records in fitting
// keys still clash when one is pitched far from the other.

/** The number (1...12) and letter of a Camelot key, or null when it is not one. */
export function parseKey(key: string): { number: number; minor: boolean } | null {
  const letter = key.slice(-1);
  if (letter !== "A" && letter !== "B") return null;
  const digits = key.slice(0, -1);
  if (!/^[+-]?[0-9]+$/.test(digits)) return null;
  const number = Number(digits);
  if (number < 1 || number > 12) return null;
  return { number, minor: letter === "A" };
}

/**
 * Neighbours on the wheel: the same key, one number up or down (12 and 1 are next to each
 * other), or the same number with the other letter. Unknown keys never clash.
 */
export function compatible(a: string, b: string): boolean {
  const x = parseKey(a), y = parseKey(b);
  if (!x || !y) return true;
  if (x.minor === y.minor) {
    const apart = Math.abs(x.number - y.number);
    return apart <= 1 || apart === 11;
  }
  return x.number === y.number;
}

/** How far apart two records sound after their pitch faders, in semitones (+ = a is higher). */
export function detune(pitchA: number, pitchB: number): number {
  return 12 * Math.log2((1 + pitchA) / (1 + pitchB));
}

/**
 * Two records heard together clash: keys that are not neighbours, or pitched more than
 * `tolerance` semitones apart from each other.
 */
export function clash(a: string, pitchA: number, b: string, pitchB: number, tolerance = 0.3): boolean {
  return !compatible(a, b) || Math.abs(detune(pitchA, pitchB)) > tolerance;
}
