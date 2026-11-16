import AVFoundation
import HeadlinerCore

/// Two decks and the mixer. All of the sound is made by `Mixer.render` in one source node, so
/// the same code that is unit-tested is what the phone plays.
public final class DeckEngine {
    public let decks = [Deck(), Deck()]
    private let engine = AVAudioEngine()
    private var built = false
    private var observer: NSObjectProtocol?

    // Shared with the audio thread: plain memory, single fields, no locks.
    private let mixer: UnsafeMutablePointer<MixerShared>
    private let deckList: UnsafeMutablePointer<UnsafeMutablePointer<DeckShared>>
    private let stripList: UnsafeMutablePointer<UnsafeMutablePointer<ChannelStrip>>
    private let scratch: UnsafeMutablePointer<Float>
    private static let chunk = 4096

    public private(set) var running = false
    /// Why the engine is not running, for the on-screen diagnostic line.
    public private(set) var lastError: String?
    public private(set) var sampleRate: Double = 0
    /// Seconds of audio per hardware buffer (0 when unknown): the floor of the touch-to-sound delay.
    public private(set) var bufferSeconds: Double = 0

    public init() {
        mixer = UnsafeMutablePointer<MixerShared>.allocate(capacity: 1)
        mixer.initialize(to: MixerShared())
        deckList = UnsafeMutablePointer<UnsafeMutablePointer<DeckShared>>.allocate(capacity: 2)
        stripList = UnsafeMutablePointer<UnsafeMutablePointer<ChannelStrip>>.allocate(capacity: 2)
        for (i, deck) in decks.enumerated() {
            (deckList + i).initialize(to: deck.shared)
            (stripList + i).initialize(to: deck.strip)
        }
        scratch = UnsafeMutablePointer<Float>.allocate(capacity: Self.chunk * 2)
        scratch.initialize(repeating: 0, count: Self.chunk * 2)
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        engine.stop()
        mixer.deinitialize(count: 1); mixer.deallocate()
        deckList.deallocate(); stripList.deallocate(); scratch.deallocate()
    }

    /// Everything the mixer puts out, 0...1. Turned down a little while a coach talks over the music.
    public var masterVolume: Float {
        get { engine.mainMixerNode.outputVolume }
        set { engine.mainMixerNode.outputVolume = max(0, min(1, newValue)) }
    }

    /// Headphone split: the room in the left ear, the headphones in the right (one stereo socket,
    /// a splitter cable, or just a pair of headphones for practising).
    public var split: Bool {
        get { mixer.pointee.split }
        set { mixer.pointee.split = newValue }
    }

    /// What the headphones hear: 0 = only the cued decks, 1 = only the room.
    public var cueMix: Double {
        get { Double(mixer.pointee.cueMix) }
        set { mixer.pointee.cueMix = Float(max(0, min(1, newValue))) }
    }

    public func start() {
        guard !running else { return }
        do {
            #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setPreferredIOBufferDuration(0.005)
            try session.setActive(true)
            bufferSeconds = session.ioBufferDuration
            #endif
            if !built {
                let hardware = engine.outputNode.outputFormat(forBus: 0).sampleRate
                let rate = hardware > 0 ? hardware : 48_000
                guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) else {
                    throw DeckError.cannotAllocate
                }
                sampleRate = rate
                mixer.pointee.sampleRate = rate
                for deck in decks { deck.outputRate = rate }
                let node = makeNode(format: format)
                engine.attach(node)
                engine.connect(node, to: engine.mainMixerNode, format: format)
                // Plugging headphones or a sound card in or out stops the engine; start it again.
                observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                    self?.restart()
                }
                built = true
            }
            engine.prepare()
            try engine.start()
            running = true
            lastError = nil
        } catch {
            running = false
            lastError = String(describing: error)
        }
    }

    public func stop() {
        engine.pause()
        running = false
    }

    /// After the output changed (headphones in or out): pick the new output up.
    public func restart() {
        engine.stop()
        running = false
        start()
    }

    /// Where the sound goes right now, in words ("Speaker", "USB Audio (2 ch)", ...).
    public var outputs: String {
        #if os(iOS)
        let ports = AVAudioSession.sharedInstance().currentRoute.outputs
        if ports.isEmpty { return "none" }
        return ports.map { "\($0.portName) (\($0.channels?.count ?? 0) ch)" }.joined(separator: " + ")
        #else
        return "this computer"
        #endif
    }

    /// Asks the phone which outputs it would drive AT THE SAME TIME (speaker plus a sound card,
    /// say), then goes back to normal. Stops the music for a moment. For finding out what a
    /// given adapter can do; nothing plays through this yet.
    public func probeSeveralOutputs() -> String {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        engine.stop()
        running = false
        var found: String
        do {
            try session.setCategory(.multiRoute, mode: .default, options: [])
            try session.setActive(true)
            found = outputs
        } catch {
            found = "not possible here (\(error.localizedDescription))"
        }
        start() // puts the normal playback mode back
        return found
        #else
        return outputs
        #endif
    }

    private func makeNode(format: AVAudioFormat) -> AVAudioSourceNode {
        let mixer = mixer, deckList = deckList, stripList = stripList, scratch = scratch
        let chunk = Self.chunk
        return AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard buffers.count > 1, let first = buffers[0].mData, let second = buffers[1].mData else {
                for buffer in buffers { if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) } }
                return noErr
            }
            let left = first.assumingMemoryBound(to: Float.self)
            let right = second.assumingMemoryBound(to: Float.self)
            let total = Int(frameCount)
            var done = 0
            while done < total {
                let n = min(chunk, total - done)
                Mixer.render(decks: deckList, strips: stripList, deckCount: 2, mixer: mixer, scratch: scratch,
                             left: left + done, right: right + done, count: n)
                done += n
            }
            return noErr
        }
    }
}
