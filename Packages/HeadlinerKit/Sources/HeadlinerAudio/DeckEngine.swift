import AVFoundation
import HeadlinerCore
import QuartzCore

/// How the headphones are fed.
public enum PhonesMode: Int, Sendable {
    /// No headphone feed: the room in stereo.
    case off = 0
    /// One stereo output: the room in the left ear, the headphones in the right.
    case split = 1
    /// Two outputs at once: the room on the phone's speaker, the headphones on a plugged-in
    /// sound card or adapter.
    case twoOutputs = 2
}

/// Two decks and the mixer. All of the sound is made by `Mixer.render` in one source node, so
/// the same code that is unit-tested is what the phone plays.
public final class DeckEngine {
    public let decks = [Deck(), Deck()]
    private var engine = AVAudioEngine()
    private var observer: NSObjectProtocol?
    private var startedAt: CFTimeInterval = 0

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
    /// With `.twoOutputs`: which output carries what ("ROOM: Speaker · PHONES: USB Audio"), or
    /// why it is not happening. Empty in the other modes.
    public private(set) var twoOutputsNote = ""

    public init() {
        mixer = UnsafeMutablePointer<MixerShared>.allocate(capacity: 1)
        mixer.initialize(to: MixerShared())
        deckList = UnsafeMutablePointer<UnsafeMutablePointer<DeckShared>>.allocate(capacity: 2)
        stripList = UnsafeMutablePointer<UnsafeMutablePointer<ChannelStrip>>.allocate(capacity: 2)
        for (i, deck) in decks.enumerated() {
            (deckList + i).initialize(to: deck.shared)
            (stripList + i).initialize(to: deck.strip)
        }
        scratch = UnsafeMutablePointer<Float>.allocate(capacity: Self.chunk * 4)
        scratch.initialize(repeating: 0, count: Self.chunk * 4)
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        engine.stop()
        mixer.deinitialize(count: 1); mixer.deallocate()
        deckList.deallocate(); stripList.deallocate(); scratch.deallocate()
    }

    /// Everything the mixer puts out, 0...1. Turned down a little while a coach talks over the music.
    public var masterVolume: Float {
        get { mixer.pointee.master }
        set { mixer.pointee.master = max(0, min(1, newValue)) }
    }

    /// How the headphones are fed. Changing to or from `.twoOutputs` rebuilds the sound output
    /// (a short gap in the music).
    public var phones: PhonesMode = .off {
        didSet {
            mixer.pointee.split = phones == .split
            let rebuild = (phones == .twoOutputs) != (oldValue == .twoOutputs)
            if rebuild && running { restart() }
            if phones != .twoOutputs { twoOutputsNote = "" }
        }
    }

    /// What the headphones hear: 0 = only the cued decks, 1 = only the room.
    public var cueMix: Double {
        get { Double(mixer.pointee.cueMix) }
        set { mixer.pointee.cueMix = Float(max(0, min(1, newValue))) }
    }

    public func start() {
        guard !running else { return }
        do {
            // A fresh engine every time: it then sees the outputs as they are now.
            if let observer { NotificationCenter.default.removeObserver(observer) }
            observer = nil
            engine.stop()
            engine = AVAudioEngine()

            var wantTwo = phones == .twoOutputs
            #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(wantTwo ? .multiRoute : .playback, mode: .default, options: [])
            try session.setPreferredIOBufferDuration(0.005)
            try session.setActive(true)
            bufferSeconds = session.ioBufferDuration
            #else
            wantTwo = false
            #endif

            let hardware = engine.outputNode.outputFormat(forBus: 0)
            let rate = hardware.sampleRate > 0 ? hardware.sampleRate : 48_000
            sampleRate = rate
            mixer.pointee.sampleRate = rate
            for deck in decks { deck.outputRate = rate }

            var plan: OutputPlan?
            if wantTwo {
                plan = Self.planTwoOutputs(channels: Int(hardware.channelCount))
                if plan == nil {
                    twoOutputsNote = "No second output found. Plug in headphones or a sound card. Playing the room only (\(outputs))."
                    #if os(iOS)
                    // Back to the ordinary single output.
                    try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
                    try AVAudioSession.sharedInstance().setActive(true)
                    engine = AVAudioEngine()
                    #endif
                }
            }

            if let plan {
                // Straight to the hardware, one channel per socket channel, in the phone's own format.
                let format = engine.outputNode.outputFormat(forBus: 0)
                let node = makeNode(format: format, plan: plan)
                engine.attach(node)
                engine.connect(node, to: engine.outputNode, format: format)
                twoOutputsNote = plan.note
            } else {
                let now = engine.outputNode.outputFormat(forBus: 0).sampleRate
                guard let format = AVAudioFormat(standardFormatWithSampleRate: now > 0 ? now : rate, channels: 2) else {
                    throw DeckError.cannotAllocate
                }
                let node = makeNode(format: format, plan: nil)
                engine.attach(node)
                engine.connect(node, to: engine.mainMixerNode, format: format)
            }
            // Plugging headphones or a sound card in or out stops the engine; start it again.
            observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                // Starting up can itself report a change; only a later one means something was plugged.
                guard let self, CACurrentMediaTime() - self.startedAt > 0.7 else { return }
                self.restart()
            }
            engine.prepare()
            try engine.start()
            startedAt = CACurrentMediaTime()
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

    /// After the output changed (headphones in or out, or another headphone mode): build the
    /// sound output again for what is there now.
    public func restart() {
        engine.stop()
        running = false
        start()
    }

    /// Where the sound goes right now, in words ("Speaker (2 ch) + USB Audio (2 ch)").
    public var outputs: String {
        #if os(iOS)
        let ports = AVAudioSession.sharedInstance().currentRoute.outputs
        if ports.isEmpty { return "none" }
        return ports.map { "\($0.portName) (\($0.channels?.count ?? 0) ch)" }.joined(separator: " + ")
        #else
        return "this computer"
        #endif
    }

    /// Which hardware channels carry the room and which the headphones.
    struct OutputPlan {
        var channels: Int
        var room: Int, roomWidth: Int
        var phones: Int, phonesWidth: Int
        var note: String
    }

    /// With several outputs active, the hardware channels are the outputs' channels one after
    /// the other. The room goes to the phone's own speaker (or the first output), the headphones
    /// to a plugged-in output (or the other one).
    private static func planTwoOutputs(channels: Int) -> OutputPlan? {
        #if os(iOS)
        let ports = AVAudioSession.sharedInstance().currentRoute.outputs
        guard ports.count >= 2 else { return nil }
        var first: [Int] = [], width: [Int] = []
        var at = 0
        for port in ports {
            let n = max(1, port.channels?.count ?? 0)
            first.append(at); width.append(n)
            at += n
        }
        guard at <= channels else { return nil }
        let wired: [AVAudioSession.Port] = [.headphones, .usbAudio, .lineOut]
        let phonesAt = ports.firstIndex { wired.contains($0.portType) } ?? 1
        let roomAt = ports.firstIndex { $0.portType == .builtInSpeaker } ?? (phonesAt == 0 ? 1 : 0)
        guard roomAt != phonesAt else { return nil }
        return OutputPlan(channels: channels,
                          room: first[roomAt], roomWidth: min(2, width[roomAt]),
                          phones: first[phonesAt], phonesWidth: min(2, width[phonesAt]),
                          note: "ROOM: \(ports[roomAt].portName)  ·  PHONES: \(ports[phonesAt].portName)")
        #else
        return nil
        #endif
    }

    private func makeNode(format: AVAudioFormat, plan: OutputPlan?) -> AVAudioSourceNode {
        let mixer = mixer, deckList = deckList, stripList = stripList, scratch = scratch
        let chunk = Self.chunk
        // Plain numbers only inside the audio callback.
        let two = plan != nil
        let room = plan?.room ?? 0, roomWidth = plan?.roomWidth ?? 2
        let phones = plan?.phones ?? 0, phonesWidth = plan?.phonesWidth ?? 2
        // Spare room behind the mixer's own scratch, for the second channel of a one-channel output.
        let spareA = scratch + chunk * 2, spareB = scratch + chunk * 3
        return AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let total = Int(frameCount)
            func channel(_ i: Int) -> UnsafeMutablePointer<Float>? {
                guard i >= 0, i < buffers.count, let data = buffers[i].mData,
                      Int(buffers[i].mDataByteSize) >= total * MemoryLayout<Float>.size else { return nil }
                return data.assumingMemoryBound(to: Float.self)
            }
            func silence() {
                for buffer in buffers { if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) } }
            }

            guard two else {
                // One stereo output.
                guard let left = channel(0), let right = channel(1) else { silence(); return noErr }
                var done = 0
                while done < total {
                    let n = min(chunk, total - done)
                    Mixer.render(decks: deckList, strips: stripList, deckCount: 2, mixer: mixer, scratch: scratch,
                                 left: left + done, right: right + done, count: n)
                    done += n
                }
                return noErr
            }

            // Two outputs: the room on one, the headphones on the other.
            guard let roomL = channel(room), let phonesL = channel(phones) else { silence(); return noErr }
            let roomR = roomWidth > 1 ? channel(room + 1) : nil
            let phonesR = phonesWidth > 1 ? channel(phones + 1) : nil
            // Channels that belong to neither stay silent.
            for i in 0..<buffers.count {
                let used = i == room || i == phones || (roomR != nil && i == room + 1) || (phonesR != nil && i == phones + 1)
                if !used, let data = buffers[i].mData { memset(data, 0, Int(buffers[i].mDataByteSize)) }
            }
            var done = 0
            while done < total {
                let n = min(chunk, total - done)
                let rl = roomL + done, pl = phonesL + done
                let rr = roomR.map { $0 + done } ?? spareA
                let pr = phonesR.map { $0 + done } ?? spareB
                Mixer.render(decks: deckList, strips: stripList, deckCount: 2, mixer: mixer, scratch: scratch,
                             left: rl, right: rr, phonesLeft: pl, phonesRight: pr, count: n)
                // An output with a single channel gets both sides folded into it.
                if roomR == nil { for i in 0..<n { rl[i] = (rl[i] + rr[i]) * 0.5 } }
                if phonesR == nil { for i in 0..<n { pl[i] = (pl[i] + pr[i]) * 0.5 } }
                done += n
            }
            return noErr
        }
    }
}
