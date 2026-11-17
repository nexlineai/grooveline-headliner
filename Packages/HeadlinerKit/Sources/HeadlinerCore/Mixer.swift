import Foundation

// The mixer, as plain arithmetic the audio thread can run: per deck a three-band EQ, a fader
// to the room and a headphone cue switch; then either the room in stereo, or the room in the
// left ear and the headphones in the right ("split"), the way a DJ with one stereo socket and
// a splitter cable listens to the next record before the dancefloor does.

/// One second-order filter with its own memory for a left and a right channel.
public struct Biquad {
    public var b0: Float = 1, b1: Float = 0, b2: Float = 0, a1: Float = 0, a2: Float = 0
    var l1: Float = 0, l2: Float = 0, r1: Float = 0, r2: Float = 0

    public init() {}

    public enum Shape { case lowShelf, peak, highShelf, lowPass, highPass }

    /// Sets the filter (Robert Bristow-Johnson's formulas). `q` is used by `.peak` and the
    /// passes; the shelves have the steepest slope that does not overshoot. The passes ignore
    /// `gainDB`.
    public mutating func set(_ shape: Shape, frequency: Double, gainDB: Double, q: Double = 0.86, sampleRate: Double) {
        let a = pow(10, gainDB / 40)
        let w = 2 * Double.pi * min(frequency, sampleRate * 0.45) / sampleRate
        let cs = cos(w), sn = sin(w)
        var n0 = 1.0, n1 = 0.0, n2 = 0.0, d0 = 1.0, d1 = 0.0, d2 = 0.0
        switch shape {
        case .peak:
            let alpha = sn / (2 * q)
            n0 = 1 + alpha * a; n1 = -2 * cs; n2 = 1 - alpha * a
            d0 = 1 + alpha / a; d1 = -2 * cs; d2 = 1 - alpha / a
        case .lowShelf:
            let beta = 2 * sqrt(a) * (sn / 2 * sqrt(2))
            n0 = a * ((a + 1) - (a - 1) * cs + beta)
            n1 = 2 * a * ((a - 1) - (a + 1) * cs)
            n2 = a * ((a + 1) - (a - 1) * cs - beta)
            d0 = (a + 1) + (a - 1) * cs + beta
            d1 = -2 * ((a - 1) + (a + 1) * cs)
            d2 = (a + 1) + (a - 1) * cs - beta
        case .highShelf:
            let beta = 2 * sqrt(a) * (sn / 2 * sqrt(2))
            n0 = a * ((a + 1) + (a - 1) * cs + beta)
            n1 = -2 * a * ((a - 1) + (a + 1) * cs)
            n2 = a * ((a + 1) + (a - 1) * cs - beta)
            d0 = (a + 1) - (a - 1) * cs + beta
            d1 = 2 * ((a - 1) - (a + 1) * cs)
            d2 = (a + 1) - (a - 1) * cs - beta
        case .lowPass, .highPass:
            let alpha = sn / (2 * q)
            let low = shape == .lowPass
            n0 = low ? (1 - cs) / 2 : (1 + cs) / 2
            n1 = low ? 1 - cs : -(1 + cs)
            n2 = n0
            d0 = 1 + alpha; d1 = -2 * cs; d2 = 1 - alpha
        }
        b0 = Float(n0 / d0); b1 = Float(n1 / d0); b2 = Float(n2 / d0)
        a1 = Float(d1 / d0); a2 = Float(d2 / d0)
    }

    /// Forgets what went through it.
    public mutating func clear() { l1 = 0; l2 = 0; r1 = 0; r2 = 0 }

    /// Filters `count` frames of both channels where they lie.
    @inline(__always)
    public mutating func run(_ left: UnsafeMutablePointer<Float>, _ right: UnsafeMutablePointer<Float>, count: Int) {
        var z1 = l1, z2 = l2
        for i in 0..<count {
            let x = left[i]
            let y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            left[i] = y
        }
        // Keep the memory from drifting into denormal numbers once the music stops.
        l1 = abs(z1) < 1e-20 ? 0 : z1
        l2 = abs(z2) < 1e-20 ? 0 : z2
        z1 = r1; z2 = r2
        for i in 0..<count {
            let x = right[i]
            let y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            right[i] = y
        }
        r1 = abs(z1) < 1e-20 ? 0 : z1
        r2 = abs(z2) < 1e-20 ? 0 : z2
    }
}

/// One channel of the mixer. The game writes the wanted values; the audio thread glides to them.
public struct ChannelStrip {
    /// Wanted EQ, in decibels: low, mid, high. 0 is flat.
    public var lowDB: Float = 0
    public var midDB: Float = 0
    public var highDB: Float = 0
    /// Channel fader and crossfader together, 0...1: how much of this deck the room hears.
    public var fader: Float = 1
    /// 1 when this deck is switched to the headphones (before the fader), else 0.
    public var cue: Float = 0
    /// The one-knob filter: -1 = low-pass all the way down, 0 = off, 1 = high-pass all the way up.
    public var filter: Float = 0

    // The audio thread's own.
    var lowNow: Float = 0, midNow: Float = 0, highNow: Float = 0
    var faderNow: Float = 0, cueNow: Float = 0
    var filterNow: Float = 0
    var low = Biquad(), mid = Biquad(), high = Biquad(), sweep = Biquad()

    public init() {}
}

/// What the whole mixer is set to.
public struct MixerShared {
    /// false: the room in stereo on both channels. true: the room in the left ear, the headphones in the right.
    public var split = false
    /// What the headphones hear: 0 = only the cued decks, 1 = only the room.
    public var cueMix: Float = 0
    /// Everything that comes out, 0...1 (turned down a little while a coach talks).
    public var master: Float = 1
    var masterNow: Float = 1
    public var sampleRate: Double = 48_000
    /// The far speakers of a big system: the room also hears the music `echoDelay` frames late
    /// (a quieter copy); the headphones do not, like a DJ's monitors. 0 = off. The ring buffers
    /// (`Mixer.echoCapacity` frames each) belong to the engine; nil = no echo.
    public var echoDelay: Int = 0
    public var echoGain: Float = 0.5
    public var echoL: UnsafeMutablePointer<Float>?
    public var echoR: UnsafeMutablePointer<Float>?
    var echoWrite = 0

    public init() {}
}

public enum Mixer {
    public static let lowHz = 180.0, midHz = 1_000.0, highHz = 4_500.0

    /// One step of an EQ knob's gain towards where it was turned to (once per buffer).
    @inline(__always)
    static func glide(_ now: Float, to wanted: Float) -> Float {
        let next = now + (wanted - now) * 0.25
        return abs(wanted - next) < 0.02 ? wanted : next
    }

    /// Frames in each echo ring buffer (a third of a second at 48 kHz).
    public static let echoCapacity = 16_384

    /// Adds the late copy from the far speakers to the room channels (`right` nil: the room is
    /// one channel).
    public static func applyEcho(_ mixer: UnsafeMutablePointer<MixerShared>, left: UnsafeMutablePointer<Float>,
                                 right: UnsafeMutablePointer<Float>?, count: Int) {
        let delay = min(mixer.pointee.echoDelay, echoCapacity - 1)
        guard delay > 0, let bl = mixer.pointee.echoL, let br = mixer.pointee.echoR else { return }
        let gain = mixer.pointee.echoGain
        var w = mixer.pointee.echoWrite
        for i in 0..<count {
            let r = (w - delay + echoCapacity) % echoCapacity
            let l = left[i]
            left[i] = l + bl[r] * gain
            bl[w] = l
            if let right {
                let x = right[i]
                right[i] = x + br[r] * gain
                br[w] = x
            }
            w = (w + 1) % echoCapacity
        }
        mixer.pointee.echoWrite = w
    }

    /// Around the middle of the filter knob nothing is filtered.
    public static let filterDeadZone: Float = 0.03

    /// The filter's corner for a knob position: the low-pass closes from 20 kHz to 100 Hz, the
    /// high-pass opens from 20 Hz to 8 kHz, both evenly in octaves along the knob.
    public static func filterHz(_ position: Float) -> Double {
        let x = Double(max(-1, min(1, position)))
        return x < 0 ? 20_000 * pow(100.0 / 20_000, -x) : 20 * pow(8_000.0 / 20, x)
    }

    /// Mixes `deckCount` decks into one stereo output, or into two when `phonesLeft` and
    /// `phonesRight` are given: then `left`/`right` carry the room and the other pair carries
    /// the headphones, both in stereo (a second sound output), and `split` is ignored.
    /// `scratch` is room for `2 * count` samples; `decks` and `strips` hold `deckCount` entries.
    public static func render(decks: UnsafePointer<UnsafeMutablePointer<DeckShared>>,
                              strips: UnsafePointer<UnsafeMutablePointer<ChannelStrip>>,
                              deckCount: Int,
                              mixer: UnsafeMutablePointer<MixerShared>,
                              scratch: UnsafeMutablePointer<Float>,
                              left outL: UnsafeMutablePointer<Float>,
                              right outR: UnsafeMutablePointer<Float>,
                              phonesLeft: UnsafeMutablePointer<Float>? = nil,
                              phonesRight: UnsafeMutablePointer<Float>? = nil,
                              count: Int) {
        let split = mixer.pointee.split
        let cueMix = max(0, min(1, mixer.pointee.cueMix))
        let rate = mixer.pointee.sampleRate
        let tl = scratch, tr = scratch + count
        for i in 0..<count { outL[i] = 0; outR[i] = 0 }
        if let pl = phonesLeft, let pr = phonesRight {
            for i in 0..<count { pl[i] = 0; pr[i] = 0 }
        }

        for d in 0..<deckCount {
            let strip = strips[d]
            // The record, before the fader.
            Vinyl.render(decks[d], left: tl, right: tr, count: count)

            // EQ: follow the knobs, re-tune a band only while it is moving.
            if strip.pointee.lowNow != strip.pointee.lowDB {
                let g = glide(strip.pointee.lowNow, to: strip.pointee.lowDB)
                strip.pointee.lowNow = g
                strip.pointee.low.set(.lowShelf, frequency: lowHz, gainDB: Double(g), sampleRate: rate)
                if g == 0 { strip.pointee.low.clear() }
            }
            if strip.pointee.midNow != strip.pointee.midDB {
                let g = glide(strip.pointee.midNow, to: strip.pointee.midDB)
                strip.pointee.midNow = g
                strip.pointee.mid.set(.peak, frequency: midHz, gainDB: Double(g), sampleRate: rate)
                if g == 0 { strip.pointee.mid.clear() }
            }
            if strip.pointee.highNow != strip.pointee.highDB {
                let g = glide(strip.pointee.highNow, to: strip.pointee.highDB)
                strip.pointee.highNow = g
                strip.pointee.high.set(.highShelf, frequency: highHz, gainDB: Double(g), sampleRate: rate)
                if g == 0 { strip.pointee.high.clear() }
            }
            if strip.pointee.lowNow != 0 { strip.pointee.low.run(tl, tr, count: count) }
            if strip.pointee.midNow != 0 { strip.pointee.mid.run(tl, tr, count: count) }
            if strip.pointee.highNow != 0 { strip.pointee.high.run(tl, tr, count: count) }

            // Filter: glides like the EQ, re-tuned only while the knob moves; off in the middle.
            if strip.pointee.filterNow != strip.pointee.filter {
                let wanted = max(-1, min(1, strip.pointee.filter))
                var f = strip.pointee.filterNow + (wanted - strip.pointee.filterNow) * 0.3
                if abs(wanted - f) < 0.002 { f = wanted }
                let crossed = (f < 0) != (strip.pointee.filterNow < 0)
                strip.pointee.filterNow = f
                if abs(f) < filterDeadZone || crossed {
                    strip.pointee.sweep.clear()
                }
                if abs(f) >= filterDeadZone {
                    strip.pointee.sweep.set(f < 0 ? .lowPass : .highPass, frequency: filterHz(f), gainDB: 0, q: 1.0, sampleRate: rate)
                }
            }
            if abs(strip.pointee.filterNow) >= filterDeadZone { strip.pointee.sweep.run(tl, tr, count: count) }

            var fader = strip.pointee.faderNow, cue = strip.pointee.cueNow
            let faderWanted = strip.pointee.fader, cueWanted = strip.pointee.cue
            if let pl = phonesLeft, let pr = phonesRight {
                // Two outputs: the room on one, the headphones on the other, both in stereo.
                for i in 0..<count {
                    fader += (faderWanted - fader) * 0.004
                    cue += (cueWanted - cue) * 0.004
                    let l = tl[i], r = tr[i]
                    outL[i] += l * fader
                    outR[i] += r * fader
                    let heard = cue * (1 - cueMix) + fader * cueMix
                    pl[i] += l * heard
                    pr[i] += r * heard
                }
            } else if split {
                // Left: the room, in mono. Right: the headphones, in mono.
                for i in 0..<count {
                    fader += (faderWanted - fader) * 0.004
                    cue += (cueWanted - cue) * 0.004
                    let mono = (tl[i] + tr[i]) * 0.5
                    let room = mono * fader
                    outL[i] += room
                    outR[i] += mono * cue * (1 - cueMix) + room * cueMix
                }
            } else {
                for i in 0..<count {
                    fader += (faderWanted - fader) * 0.004
                    cue += (cueWanted - cue) * 0.004
                    outL[i] += tl[i] * fader
                    outR[i] += tr[i] * fader
                }
            }
            strip.pointee.faderNow = fader
            strip.pointee.cueNow = cue
        }

        // Master volume, gliding (about 10 ms) so a change makes no click.
        var master = mixer.pointee.masterNow
        let masterWanted = max(0, min(1, mixer.pointee.master))
        if master != 1 || masterWanted != 1 {
            if let pl = phonesLeft, let pr = phonesRight {
                for i in 0..<count {
                    master += (masterWanted - master) * 0.002
                    outL[i] *= master; outR[i] *= master
                    pl[i] *= master; pr[i] *= master
                }
            } else {
                for i in 0..<count {
                    master += (masterWanted - master) * 0.002
                    outL[i] *= master; outR[i] *= master
                }
            }
            if abs(master - masterWanted) < 1e-4 { master = masterWanted }
            mixer.pointee.masterNow = master
        }

        // The far speakers: only the room is late, never the headphones.
        if phonesLeft != nil {
            applyEcho(mixer, left: outL, right: outR, count: count)
        } else if split {
            applyEcho(mixer, left: outL, right: nil, count: count)
        } else {
            applyEcho(mixer, left: outL, right: outR, count: count)
        }
    }
}
