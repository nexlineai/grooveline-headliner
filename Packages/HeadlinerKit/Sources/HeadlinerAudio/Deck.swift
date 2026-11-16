import AVFoundation
import HeadlinerCore

public enum DeckError: Error {
    case cannotAllocate
    case emptyFile
}

/// One turntable with a record on it. The game sets what the motor and the hand are doing;
/// the audio thread (`Vinyl.render`) moves the needle and reports back where it is.
/// Call everything here from the main thread.
public final class Deck {
    let shared: UnsafeMutablePointer<DeckShared>
    private var buffer: AVAudioPCMBuffer?
    private var retired: [AVAudioPCMBuffer] = []
    var eq: AVAudioUnitEQ?

    public private(set) var info: TrackInfo?
    public private(set) var grid = BeatGrid(bpm: 120)
    public private(set) var duration: Double = 0
    public private(set) var fileRate: Double = 44_100
    public var isLoaded: Bool { shared.pointee.frames > 0 }

    /// Output sample rate of the engine; set by `DeckEngine` before it starts.
    var outputRate: Double = 48_000 { didSet { apply() } }

    /// The platter motor (the START/STOP button).
    public var motorOn = false { didSet { apply() } }
    /// Pitch fader, as a fraction: 0.02 is +2 %.
    public var pitch: Double = 0 { didSet { apply() } }
    /// A short push or drag on top of the pitch (rim nudge, or sync pulling the beats together).
    public var bend: Double = 0 { didSet { apply() } }
    /// A hand is on the record: it turns at the hand's speed and ignores the motor.
    public var held = false { didSet { apply() } }
    /// Speed of the hand, in record speeds (1 = normal play, 0 = holding still, negative = pulling back).
    public var handRate: Double = 0 { didSet { apply() } }
    /// Channel fader and crossfader combined, 0...1.
    public var volume: Double = 1 { didSet { shared.pointee.targetGain = Float(volume) } }
    /// Where CUE returns to, in seconds.
    public var cuePoint: Double = 0

    public init() {
        shared = UnsafeMutablePointer<DeckShared>.allocate(capacity: 1)
        shared.initialize(to: DeckShared())
        apply()
    }

    deinit {
        shared.deinitialize(count: 1)
        shared.deallocate()
    }

    private func apply() {
        let target: Double
        let seconds: Double // time for the platter to cover most of the gap
        if held {
            target = handRate; seconds = 0.006
        } else if motorOn {
            target = 1 + pitch + bend; seconds = 0.05
        } else {
            target = 0; seconds = 0.12
        }
        shared.pointee.targetRate = target
        shared.pointee.glide = 1 - exp(-1 / (seconds * outputRate))
        shared.pointee.step = fileRate / outputRate
    }

    /// Puts a record on the platter, needle on the first beat, motor off.
    public func load(_ track: TrackInfo, from url: URL) throws {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw DeckError.cannotAllocate
        }
        try file.read(into: buf)
        guard let channels = buf.floatChannelData, buf.frameLength > 64 else { throw DeckError.emptyFile }
        let frames = Int(buf.frameLength)
        let left = channels[0]
        let right = format.channelCount > 1 ? channels[1] : channels[0]

        // The audio thread may be mid-read: silence the deck, keep the old record alive a moment, then swap.
        shared.pointee.frames = 0
        motorOn = false
        if let old = buffer {
            retired.append(old)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.retired.removeAll() }
        }
        buffer = buf
        fileRate = format.sampleRate
        duration = Double(frames) / fileRate
        // Our records start on a kick; the grid starts where that kick is found in the decoded audio.
        let onset = Vinyl.firstOnset(left, count: min(frames, Int(fileRate * 2)))
        grid = BeatGrid(bpm: track.bpm, firstBeat: Double(onset) / fileRate)
        cuePoint = grid.firstBeat
        info = track
        pitch = 0; bend = 0
        shared.pointee.left = left
        shared.pointee.right = right
        shared.pointee.rate = 0
        shared.pointee.position = max(1, cuePoint * fileRate)
        shared.pointee.seekTo = -1
        apply()
        shared.pointee.frames = frames
    }

    /// Needle position in seconds.
    public var seconds: Double { shared.pointee.position / fileRate }
    /// Needle position in beats on the record's grid.
    public var beat: Double { grid.beat(at: seconds) }
    /// How fast the record is turning right now (1 = normal).
    public var rate: Double { shared.pointee.rate }
    /// Tempo after the pitch fader (without bends).
    public var bpm: Double { grid.bpm * (1 + pitch) }
    /// 0...1 through the record.
    public var progress: Double { duration > 0 ? min(1, max(0, seconds / duration)) : 0 }

    /// Lifts the needle and drops it at `seconds`.
    public func seek(to seconds: Double) {
        shared.pointee.seekTo = max(1, seconds * fileRate)
    }

    /// Loudest output sample since the last call (for the meters).
    public func takePeak() -> Float {
        let p = shared.pointee.peak
        shared.pointee.peak = 0
        return p
    }

    /// EQ knob: band 0 low, 1 mid, 2 high; value 0...1 with 0.5 flat.
    public func setEQ(band: Int, value: Double) {
        guard let eq, band >= 0, band < eq.bands.count else { return }
        eq.bands[band].gain = Float(MixMath.eqDecibels(value))
    }

    func makeNode(format: AVAudioFormat) -> AVAudioSourceNode {
        let s = shared
        return AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard buffers.count > 0, let first = buffers[0].mData else { return noErr }
            let left = first.assumingMemoryBound(to: Float.self)
            var right = left
            if buffers.count > 1, let second = buffers[1].mData {
                right = second.assumingMemoryBound(to: Float.self)
            }
            Vinyl.render(s, left: left, right: right, count: Int(frameCount))
            return noErr
        }
    }
}
