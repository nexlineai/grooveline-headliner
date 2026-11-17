import Foundation

/// Where the beats of a record are: a steady tempo and the time of the first beat of the first bar.
public struct BeatGrid: Equatable, Codable, Sendable {
    public var bpm: Double
    /// Seconds into the file where beat 0 (a bar start) sits.
    public var firstBeat: Double

    public init(bpm: Double, firstBeat: Double = 0) {
        self.bpm = bpm
        self.firstBeat = firstBeat
    }

    public var beatLength: Double { 60 / bpm }

    /// Beats since the first beat; fractional, negative before it.
    public func beat(at seconds: Double) -> Double { (seconds - firstBeat) / beatLength }

    public func seconds(atBeat beat: Double) -> Double { firstBeat + beat * beatLength }

    /// 0 on a beat, rising to just under 1 before the next.
    public func phase(at seconds: Double) -> Double {
        let b = beat(at: seconds)
        return b - b.rounded(.down)
    }

    /// 0-based bar number (4 beats to the bar).
    public func bar(at seconds: Double) -> Int { Int((beat(at: seconds) / 4).rounded(.down)) }

    /// 0, 1, 2 or 3: which beat of the bar is sounding.
    public func beatInBar(at seconds: Double) -> Int {
        let b = Int(beat(at: seconds).rounded(.down))
        return ((b % 4) + 4) % 4
    }
}

/// One record in the crate, as listed in `tracks.json`.
public struct TrackInfo: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var artist: String
    public var label: String
    public var genre: String
    public var bpm: Double
    public var key: String
    public var camelot: String
    public var bars: Int
    public var seconds: Double
    public var file: String
    /// The chapter whose crate the record belongs to (nil: chapter 1).
    public var chapter: Int?
}
