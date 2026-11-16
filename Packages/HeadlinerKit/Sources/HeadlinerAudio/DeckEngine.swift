import AVFoundation
import HeadlinerCore

/// Two decks into a mixer: each deck is a source node, then a three-band EQ, then the main output.
public final class DeckEngine {
    public let decks = [Deck(), Deck()]
    private let engine = AVAudioEngine()
    private var built = false

    public private(set) var running = false
    /// Why the engine is not running, for the on-screen diagnostic line.
    public private(set) var lastError: String?
    public private(set) var sampleRate: Double = 0
    /// Seconds of audio per hardware buffer (0 when unknown): the floor of the touch-to-sound delay.
    public private(set) var bufferSeconds: Double = 0

    public init() {}

    /// Everything the decks put out, 0...1. Turned down a little while a coach talks over the music.
    public var masterVolume: Float {
        get { engine.mainMixerNode.outputVolume }
        set { engine.mainMixerNode.outputVolume = max(0, min(1, newValue)) }
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
                for deck in decks {
                    deck.outputRate = rate
                    let node = deck.makeNode(format: format)
                    let eq = AVAudioUnitEQ(numberOfBands: 3)
                    let shapes: [(AVAudioUnitEQFilterType, Float)] = [(.lowShelf, 180), (.parametric, 1_000), (.highShelf, 4_500)]
                    for (band, shape) in zip(eq.bands, shapes) {
                        band.filterType = shape.0
                        band.frequency = shape.1
                        band.bandwidth = 1.6
                        band.gain = 0
                        band.bypass = false
                    }
                    engine.attach(node)
                    engine.attach(eq)
                    engine.connect(node, to: eq, format: format)
                    engine.connect(eq, to: engine.mainMixerNode, format: format)
                    deck.eq = eq
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
}
