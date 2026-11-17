import Foundation

// The studio's drum machine. Three voices made from arithmetic (no samples, so no codec delay),
// a 16-step pattern per voice, rendered offline into a record that an ordinary deck plays: pitch,
// sync, EQ, the filter and the room's judging all work on it unchanged.

/// What the player programmed: per voice (kick, clap, hat), sixteen steps of one bar.
public struct DrumPattern: Codable, Equatable, Sendable {
    public static let steps = 16
    public static let voices = ["KICK", "CLAP", "HAT"]
    public var rows: [[Bool]]

    public init(rows: [[Bool]]? = nil) {
        self.rows = rows ?? Array(repeating: Array(repeating: false, count: Self.steps), count: Self.voices.count)
    }

    /// The steps that are on in a row (0-based).
    public func on(_ row: Int) -> [Int] {
        guard rows.indices.contains(row) else { return [] }
        return rows[row].indices.filter { rows[row][$0] }
    }

    /// The classic house groove: kick on every beat, clap on two and four, hats in between.
    public static let house = DrumPattern(rows: [
        (0..<16).map { $0 % 4 == 0 },
        (0..<16).map { $0 == 4 || $0 == 12 },
        (0..<16).map { $0 % 4 == 2 },
    ])
}

public enum DrumMachine {
    public static let sampleRate = 44_100.0

    /// Frames in one bar at `bpm` (whole frames, so the bars tile exactly).
    public static func barFrames(bpm: Double) -> Int {
        Int((4 * 60 / bpm * sampleRate).rounded())
    }

    /// Where step `s` of a bar starts, in frames.
    public static func stepFrame(_ s: Int, bpm: Double) -> Int {
        Int((Double(s) * Double(barFrames(bpm: bpm)) / Double(DrumPattern.steps)).rounded())
    }

    /// One hit of a voice, mono: 0 kick, 1 clap, 2 hat.
    public static func voice(_ v: Int) -> [Float] {
        let sr = sampleRate
        var noise = Noise(seed: UInt32(17 + v))
        switch v {
        case 0:
            // Kick: a sine diving from 150 Hz to 50 Hz, starting at full swing (the click).
            let n = Int(0.4 * sr)
            var out = [Float](repeating: 0, count: n)
            var phase = Double.pi / 2
            for i in 0..<n {
                let t = Double(i) / sr
                phase += 2 * .pi * (50 + 100 * exp(-t * 28)) / sr
                out[i] = Float(sin(phase) * exp(-t * 7.5))
            }
            return out
        case 1:
            // Clap: three quick bursts of noise, then a short tail, through a bright band.
            let n = Int(0.25 * sr)
            var out = [Float](repeating: 0, count: n)
            var fast: Float = 0, slow: Float = 0
            for i in 0..<n {
                let t = Double(i) / sr
                let burst = t < 0.03 ? (t.truncatingRemainder(dividingBy: 0.01) < 0.004 ? 1.0 : 0.25) : exp(-(t - 0.03) * 22)
                let x = noise.next()
                fast += 0.45 * (x - fast)    // low-pass, about 6 kHz
                slow += 0.06 * (fast - slow) // low-pass, about 450 Hz
                out[i] = Float(Double(fast - slow) * burst * 1.2) // what lies between: the clap's band
            }
            return out
        default:
            // Hat: bright noise with the low end taken out, gone in a few hundredths of a second.
            let n = Int(0.08 * sr)
            var out = [Float](repeating: 0, count: n)
            var prev: Float = 0, last: Float = 0
            for i in 0..<n {
                let t = Double(i) / sr
                let x = noise.next()
                let hp = 0.85 * (last + x - prev) // one-pole high-pass
                prev = x; last = hp
                out[i] = Float(Double(hp) * exp(-t * 60) * 0.8)
            }
            return out
        }
    }

    /// The pattern played for `bars` bars at `bpm`, stereo. One bar is rendered (a hit that runs
    /// past the end of the bar continues at its start) and repeated, so an edit costs almost
    /// nothing and the record loops without a seam.
    public static func render(_ pattern: DrumPattern, bpm: Double, bars: Int) -> (left: [Float], right: [Float]) {
        let frames = barFrames(bpm: bpm)
        var barL = [Float](repeating: 0, count: frames), barR = barL
        let levels: [(gain: Float, left: Float, right: Float)] = [(0.9, 1, 1), (0.5, 1, 0.92), (0.3, 0.85, 1)]
        for v in 0..<min(pattern.rows.count, levels.count) {
            let hit = voice(v), level = levels[v]
            for s in 0..<DrumPattern.steps where s < pattern.rows[v].count && pattern.rows[v][s] {
                let start = stepFrame(s, bpm: bpm)
                for i in 0..<hit.count {
                    let j = (start + i) % frames
                    let x = hit[i] * level.gain
                    barL[j] += x * level.left
                    barR[j] += x * level.right
                }
            }
        }
        for i in 0..<frames {
            barL[i] = Float(tanh(Double(barL[i])))
            barR[i] = Float(tanh(Double(barR[i])))
        }
        var left = [Float](), right = [Float]()
        left.reserveCapacity(frames * bars)
        right.reserveCapacity(frames * bars)
        for _ in 0..<max(1, bars) {
            left.append(contentsOf: barL)
            right.append(contentsOf: barR)
        }
        return (left, right)
    }
}

/// White noise that is the same every time (so the same pattern always sounds the same).
struct Noise {
    var state: UInt32
    init(seed: UInt32) { state = seed &* 2_654_435_761 | 1 }
    mutating func next() -> Float {
        state ^= state << 13; state ^= state >> 17; state ^= state << 5
        return Float(state) / Float(UInt32.max) * 2 - 1
    }
}

public extension TrackInfo {
    /// A record made in the game (the studio's pattern), not one listed in `tracks.json`.
    init(id: String, title: String, artist: String, label: String, genre: String, bpm: Double,
         key: String, camelot: String, bars: Int, seconds: Double, chapter: Int?) {
        self.init(id: id, title: title, artist: artist, label: label, genre: genre, bpm: bpm, key: key,
                  camelot: camelot, bars: bars, seconds: seconds, file: "", chapter: chapter)
    }
}
