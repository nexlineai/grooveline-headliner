import Foundation

// The studio's drum machine. Three voices made from arithmetic (no samples, so no codec delay),
// a 16-step pattern per voice, rendered offline into a record that an ordinary deck plays: pitch,
// sync, EQ, the filter and the room's judging all work on it unchanged.

/// What the player programmed: per voice (kick, clap, hat, bass, chord), sixteen steps of one
/// bar. The bass and the chord are in A minor (the studio's key).
public struct DrumPattern: Codable, Equatable, Sendable {
    public static let steps = 16
    public static let voices = ["KICK", "CLAP", "HAT", "BASS", "CHORD"]
    public var rows: [[Bool]]

    /// Missing rows (or steps) are filled in empty, so an older or shorter pattern still works.
    public init(rows: [[Bool]]? = nil) {
        var all = rows ?? []
        while all.count < Self.voices.count { all.append([]) }
        self.rows = all.map { row in
            Array(row.prefix(Self.steps)) + Array(repeating: false, count: max(0, Self.steps - row.count))
        }
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

    /// The house groove with the bass between the kicks and chord stabs before the clap.
    public static let track = DrumPattern(rows: Array(house.rows.prefix(3)) + [
        (0..<16).map { $0 % 4 == 2 },
        (0..<16).map { $0 == 3 || $0 == 11 },
    ])
}

/// A part of a record cut from the pattern: how many bars, and which rows play in it.
public struct StudioSection: Sendable, Equatable {
    public var name: String
    public var bars: Int
    public var rows: Set<Int>
    public init(name: String, bars: Int, rows: Set<Int>) {
        self.name = name; self.bars = bars; self.rows = rows
    }
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

    /// One hit of a voice, mono: 0 kick, 1 clap, 2 hat, 3 bass (A, 110 Hz), 4 chord (A minor 7).
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
        case 3:
            // Bass: a saw on A (110 Hz) whose low-pass closes fast: a short, round pluck.
            return saws([110], length: 0.22, startHz: 2_400, endHz: 180, decay: 18, gain: 0.9, noise: &noise)
        case 4:
            // Chord: A minor 7 (A, C, E, G) on detuned saws, a bright stab that closes quickly.
            return saws([220, 261.63, 329.63, 392], length: 0.3, startHz: 3_200, endHz: 400, decay: 12, gain: 0.55, noise: &noise)
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

    /// Saws at `freqs` (two slightly detuned per note) through a low-pass that falls from `startHz`
    /// to `endHz`, fading over `length` seconds.
    static func saws(_ freqs: [Double], length: Double, startHz: Double, endHz: Double, decay: Double, gain: Double,
                     noise: inout Noise) -> [Float] {
        let sr = sampleRate, n = Int(length * sr)
        var out = [Float](repeating: 0, count: n)
        var phases = freqs.flatMap { _ in [Double(noise.next()), Double(noise.next())] }.map { abs($0) }
        let speeds = freqs.flatMap { [$0 * 0.996 / sr, $0 * 1.004 / sr] }
        var y: Double = 0
        for i in 0..<n {
            let t = Double(i) / sr
            var x = 0.0
            for k in 0..<phases.count {
                phases[k] += speeds[k]
                if phases[k] >= 1 { phases[k] -= 1 }
                x += 2 * phases[k] - 1
            }
            x /= Double(phases.count)
            let cutoff = endHz + (startHz - endHz) * exp(-t * decay)
            y += (1 - exp(-2 * .pi * cutoff / sr)) * (x - y) // one-pole low-pass
            let fade = min(1, t * 400) * (t < length - 0.02 ? 1 : max(0, (length - t) / 0.02))
            out[i] = Float(y * fade * gain * 2)
        }
        return out
    }

    /// The pattern played for `bars` bars at `bpm`, stereo. One bar is rendered (a hit that runs
    /// past the end of the bar continues at its start) and repeated, so an edit costs almost
    /// nothing and the record loops without a seam.
    public static func render(_ pattern: DrumPattern, bpm: Double, bars: Int) -> (left: [Float], right: [Float]) {
        render(pattern, bpm: bpm, sections: [StudioSection(name: "loop", bars: bars, rows: Set(0..<DrumPattern.voices.count))])
    }

    /// How loud the full mix is cut: the RMS of our records' full sections (about -15 dBFS), so a
    /// record from the studio sits level with the crate and the meters.
    public static let targetRMS = 0.178

    /// The dubplate: a whole record from one pattern, each section playing only some rows.
    public static let arrangement = [
        StudioSection(name: "intro", bars: 16, rows: [0, 2]),
        StudioSection(name: "groove", bars: 16, rows: [0, 1, 2, 3]),
        StudioSection(name: "full", bars: 16, rows: [0, 1, 2, 3, 4]),
        StudioSection(name: "break", bars: 8, rows: [2, 4]),
        StudioSection(name: "full", bars: 16, rows: [0, 1, 2, 3, 4]),
        StudioSection(name: "outro", bars: 8, rows: [0, 2]),
    ]

    /// The pattern played section by section (each section is one bar rendered with only its
    /// rows, repeated), at the crate's level. `heavyLows`: kick and bass 6 dB up, a bad mixdown
    /// that booms on a big system.
    public static func render(_ pattern: DrumPattern, bpm: Double, sections: [StudioSection],
                              heavyLows: Bool = false) -> (left: [Float], right: [Float]) {
        let gain = levelGain(pattern, bpm: bpm, heavyLows: heavyLows)
        var left = [Float](), right = [Float]()
        let total = sections.reduce(0) { $0 + max(0, $1.bars) } * barFrames(bpm: bpm)
        left.reserveCapacity(total)
        right.reserveCapacity(total)
        for section in sections where section.bars > 0 {
            let bar = renderBar(pattern, bpm: bpm, rows: section.rows, gain: gain, heavyLows: heavyLows)
            for _ in 0..<section.bars {
                left.append(contentsOf: bar.left)
                right.append(contentsOf: bar.right)
            }
        }
        return (left, right)
    }

    /// The gain that brings the full mix (every row) to `targetRMS`: measured, then corrected
    /// twice more for the soft clipping. 1 for a silent pattern; never more than 8.
    static func levelGain(_ pattern: DrumPattern, bpm: Double, heavyLows: Bool) -> Float {
        var gain: Float = 1
        let all = Set(0..<DrumPattern.voices.count)
        for _ in 0..<3 {
            let bar = renderBar(pattern, bpm: bpm, rows: all, gain: gain, heavyLows: heavyLows)
            var sum = 0.0
            for i in 0..<bar.left.count { sum += Double(bar.left[i] * bar.left[i] + bar.right[i] * bar.right[i]) }
            let rms = sqrt(sum / Double(2 * max(1, bar.left.count)))
            guard rms > 1e-4 else { return 1 }
            gain = min(8, gain * Float(targetRMS / rms))
        }
        return gain
    }

    /// One bar of the rows asked for.
    static func renderBar(_ pattern: DrumPattern, bpm: Double, rows: Set<Int>, gain: Float = 1,
                          heavyLows: Bool = false) -> (left: [Float], right: [Float]) {
        let frames = barFrames(bpm: bpm)
        var barL = [Float](repeating: 0, count: frames), barR = barL
        let levels: [(gain: Float, left: Float, right: Float)] = [(0.9, 1, 1), (0.5, 1, 0.92), (0.3, 0.85, 1), (0.7, 1, 1), (0.35, 0.9, 1)]
        for v in 0..<min(pattern.rows.count, levels.count) where rows.contains(v) {
            let hit = voice(v), level = levels[v]
            let boost: Float = heavyLows && (v == 0 || v == 3) ? 2 : 1
            for s in 0..<DrumPattern.steps where s < pattern.rows[v].count && pattern.rows[v][s] {
                let start = stepFrame(s, bpm: bpm)
                for i in 0..<hit.count {
                    let j = (start + i) % frames
                    let x = hit[i] * level.gain * boost * gain
                    barL[j] += x * level.left
                    barR[j] += x * level.right
                }
            }
        }
        for i in 0..<frames {
            barL[i] = Float(tanh(Double(barL[i])))
            barR[i] = Float(tanh(Double(barR[i])))
        }
        return (barL, barR)
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
