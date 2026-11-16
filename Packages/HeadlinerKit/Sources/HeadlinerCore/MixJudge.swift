import Foundation

public enum MixMath {
    /// How far deck B's beat is from deck A's nearest beat, in beats: -0.5 ..< 0.5.
    /// Positive means B's beats land late (B is behind), negative means B is ahead.
    public static func phaseOffset(_ beatA: Double, _ beatB: Double) -> Double {
        var d = (beatA - beatB).truncatingRemainder(dividingBy: 1)
        if d >= 0.5 { d -= 1 }
        if d < -0.5 { d += 1 }
        return d
    }

    /// Pitch (as a fraction, 0.02 = +2 %) that makes a record of `bpm` play at `target`.
    public static func pitch(toPlay bpm: Double, at target: Double) -> Double { target / bpm - 1 }

    /// Crossfader gains. Each side stays at full volume until the fader passes the middle.
    public static func crossfade(_ x: Double) -> (a: Double, b: Double) {
        let c = min(1, max(0, x))
        return (min(1, 2 * (1 - c)), min(1, 2 * c))
    }

    /// Channel fader position (0...1) to gain, with an audio taper.
    public static func faderGain(_ x: Double) -> Double {
        let c = min(1, max(0, x))
        return c * c
    }

    /// EQ knob (0...1, 0.5 is flat) to decibels: a full kill at the bottom, a small boost at the top.
    public static func eqDecibels(_ x: Double) -> Double {
        let c = min(1, max(0, x))
        return c < 0.5 ? -36 * (1 - 2 * c) : 6 * (2 * c - 1)
    }
}

/// What one deck is doing at this instant, as far as the room can hear.
public struct DeckSnapshot: Equatable, Sendable {
    public var playing: Bool
    /// Channel fader and crossfader combined, 0...1.
    public var gain: Double
    /// Tempo after the pitch fader.
    public var bpm: Double
    /// Beat position on the record's grid.
    public var beat: Double
    /// Low EQ knob, 0...1 (0.5 flat).
    public var low: Double

    public init(playing: Bool, gain: Double, bpm: Double, beat: Double, low: Double) {
        self.playing = playing; self.gain = gain; self.bpm = bpm; self.beat = beat; self.low = low
    }

    public var audible: Bool { playing && gain > 0.03 }
}

public struct MixReading: Equatable, Sendable {
    public enum State: Equatable, Sendable { case silence, solo, blend }
    public var state: State
    /// B against A in beats (see `MixMath.phaseOffset`); 0 outside a blend.
    public var offsetBeats: Double
    /// The same gap in milliseconds at A's tempo.
    public var offsetMs: Double
    /// B's tempo minus A's, in BPM.
    public var tempoGap: Double
    /// Both basslines up at once.
    public var bassClash: Bool
    /// 0 (train wreck) ... 1 (locked). 1 when only one record is heard.
    public var quality: Double

    public var verdict: String {
        switch state {
        case .silence: return "SILENCE"
        case .solo: return "ONE DECK"
        case .blend:
            if quality > 0.85 { return "LOCKED" }
            if quality > 0.6 { return "CLOSE" }
            if quality > 0.3 { return "DRIFTING" }
            return "TRAIN WRECK"
        }
    }
}

public enum MixJudge {
    public static func read(_ a: DeckSnapshot, _ b: DeckSnapshot) -> MixReading {
        guard a.audible || b.audible else {
            return MixReading(state: .silence, offsetBeats: 0, offsetMs: 0, tempoGap: 0, bassClash: false, quality: 0)
        }
        guard a.audible && b.audible else {
            return MixReading(state: .solo, offsetBeats: 0, offsetMs: 0, tempoGap: 0, bassClash: false, quality: 1)
        }
        let offset = MixMath.phaseOffset(a.beat, b.beat)
        let ms = offset * 60_000 / max(a.bpm, 1)
        let gap = b.bpm - a.bpm
        // Ears forgive about 12 ms; by 70 ms two kicks are clearly a gallop.
        let phaseScore = 1 - min(1, max(0, (abs(ms) - 12) / 58))
        let tempoScore = 1 - min(1, max(0, (abs(gap) - 0.05) / 0.95))
        let clash = a.low > 0.4 && b.low > 0.4 && a.gain > 0.5 && b.gain > 0.5
        let quality = max(0, phaseScore * 0.7 + tempoScore * 0.3 - (clash ? 0.2 : 0))
        return MixReading(state: .blend, offsetBeats: offset, offsetMs: ms, tempoGap: gap, bassClash: clash, quality: quality)
    }
}
