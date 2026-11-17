import Foundation

/// Keys on the Camelot wheel ("8A" = A minor, "8B" = C major). Two records sound right together
/// when their keys are neighbours on the wheel. Our decks have no key lock: speeding a record up
/// also raises its pitch, so two records in fitting keys still clash when one is pitched far
/// from the other.
public enum Harmony {
    /// The number (1...12) and letter of a Camelot key, or nil when it is not one.
    static func parse(_ key: String) -> (number: Int, minor: Bool)? {
        guard let letter = key.last, letter == "A" || letter == "B",
              let number = Int(key.dropLast()), (1...12).contains(number) else { return nil }
        return (number, letter == "A")
    }

    /// Neighbours on the wheel: the same key, one number up or down (12 and 1 are next to each
    /// other), or the same number with the other letter. Unknown keys never clash.
    public static func compatible(_ a: String, _ b: String) -> Bool {
        guard let x = parse(a), let y = parse(b) else { return true }
        if x.minor == y.minor {
            let apart = abs(x.number - y.number)
            return apart <= 1 || apart == 11
        }
        return x.number == y.number
    }

    /// How far apart two records sound after their pitch faders, in semitones (+ = a is higher).
    public static func detune(_ pitchA: Double, _ pitchB: Double) -> Double {
        12 * log2((1 + pitchA) / (1 + pitchB))
    }

    /// Two records heard together clash: keys that are not neighbours, or pitched more than
    /// `tolerance` semitones apart from each other.
    public static func clash(_ a: String, pitch pitchA: Double, _ b: String, pitch pitchB: Double, tolerance: Double = 0.3) -> Bool {
        !compatible(a, b) || abs(detune(pitchA, pitchB)) > tolerance
    }
}
