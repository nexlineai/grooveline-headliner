import Foundation

/// What the audio thread and the game share about one deck. It lives in manually allocated memory
/// and both sides touch single fields only, so the audio thread never waits on a lock.
/// The game writes the "wanted" fields; the audio thread writes `position`, `rate`, `gain`, `peak`.
public struct DeckShared {
    public var left: UnsafeMutablePointer<Float>?
    public var right: UnsafeMutablePointer<Float>?
    /// Frames in the record; 0 means nothing is loaded and the deck is silent.
    public var frames: Int = 0
    /// File frames advanced per output frame at normal speed (file rate / output rate).
    public var step: Double = 1
    /// Where the needle is, in file frames.
    public var position: Double = 1
    /// How fast the record turns right now: 1 normal, 0 stopped, negative backwards.
    public var rate: Double = 0
    public var targetRate: Double = 0
    /// Share of the gap to `targetRate` closed on every output frame (motor torque, or a hand).
    public var glide: Double = 1
    /// A needle drop waiting to happen (file frames), or -1.
    public var seekTo: Double = -1
    public var gain: Float = 0
    public var targetGain: Float = 1
    /// Loudest sample since the game last read it.
    public var peak: Float = 0

    public init() {}
}

public enum Vinyl {
    /// 4-point Hermite interpolation: the sample `f` of the way from frame `i` to `i + 1`.
    @inline(__always)
    public static func hermite(_ p: UnsafePointer<Float>, _ i: Int, _ f: Float) -> Float {
        let xm1 = p[i - 1], x0 = p[i], x1 = p[i + 1], x2 = p[i + 2]
        let c = (x1 - xm1) * 0.5
        let v = x0 - x1
        let w = c + v
        let a = w + v + (x2 - x0) * 0.5
        let b = w + a
        return ((a * f - b) * f + c) * f + x0
    }

    /// Fills `count` output frames by reading the record at its (changing) speed.
    /// One mechanism covers play, stop, pitch, nudging, scratching and spinbacks, as on a turntable.
    public static func render(_ s: UnsafeMutablePointer<DeckShared>,
                              left outL: UnsafeMutablePointer<Float>,
                              right outR: UnsafeMutablePointer<Float>,
                              count: Int) {
        let frames = s.pointee.frames
        guard frames > 8, let l = s.pointee.left, let r = s.pointee.right else {
            for n in 0..<count { outL[n] = 0; outR[n] = 0 }
            return
        }
        var pos = s.pointee.position
        let seek = s.pointee.seekTo
        if seek >= 0 {
            pos = seek
            s.pointee.seekTo = -1
        }
        var rate = s.pointee.rate
        var gain = s.pointee.gain
        let target = s.pointee.targetRate
        let glide = s.pointee.glide
        let targetGain = s.pointee.targetGain
        let step = s.pointee.step
        let first = 1.0, last = Double(frames - 3)
        var peak: Float = 0

        for n in 0..<count {
            rate += (target - rate) * glide
            gain += (targetGain - gain) * 0.004
            pos += rate * step
            var edge = false
            if pos < first { pos = first; edge = true } else if pos > last { pos = last; edge = true }
            // A record that is not moving makes no sound; fade over the last few percent of speed.
            let moving = Float(min(1, abs(rate) * 40))
            let a = edge ? 0 : gain * moving
            let i = Int(pos)
            let f = Float(pos - Double(i))
            let yl = hermite(l, i, f) * a
            let yr = hermite(r, i, f) * a
            outL[n] = yl
            outR[n] = yr
            let m = max(abs(yl), abs(yr))
            if m > peak { peak = m }
        }
        s.pointee.position = pos
        s.pointee.rate = rate
        s.pointee.gain = gain
        if peak > s.pointee.peak { s.pointee.peak = peak }
    }

    /// The whole record at a glance: how loud each of `bins` equal slices is, 0...1 against the
    /// loudest slice. Quiet stretches (intros, breakdowns) show as dips.
    public static func overview(_ p: UnsafePointer<Float>, count: Int, bins: Int, stride step: Int = 8) -> [Float] {
        guard count > 0, bins > 0 else { return [] }
        var out = [Float](repeating: 0, count: bins)
        var loudest: Float = 0
        for b in 0..<bins {
            let from = count * b / bins
            let to = max(from + 1, count * (b + 1) / bins)
            var sum: Float = 0
            var n: Float = 0
            var i = from
            while i < to && i < count {
                sum += p[i] * p[i]
                n += 1
                i += step
            }
            let level = n > 0 ? (sum / n).squareRoot() : 0
            out[b] = level
            if level > loudest { loudest = level }
        }
        if loudest > 0 {
            for b in 0..<bins { out[b] /= loudest }
        }
        return out
    }

    /// Frame of the first sample louder than `threshold`: where the first kick starts.
    public static func firstOnset(_ p: UnsafePointer<Float>, count: Int, threshold: Float = 0.05) -> Int {
        for i in 0..<count where abs(p[i]) > threshold { return i }
        return 0
    }
}
