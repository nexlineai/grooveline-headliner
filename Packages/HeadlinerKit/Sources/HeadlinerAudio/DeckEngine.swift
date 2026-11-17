import AVFoundation
import HeadlinerCore
import QuartzCore

/// How the headphones are fed.
public enum PhonesMode: Int, Sendable {
    /// No headphone feed: the room in stereo.
    case off = 0
    /// One stereo output: the room in the left ear, the headphones in the right.
    case split = 1
    /// A sound card with four outputs: the room on outputs 1-2, the headphones on 3-4, both in
    /// stereo. (The iPhone cannot play its own speaker next to a plugged-in adapter or Bluetooth
    /// headphones: tried on Zé's phone, 16 Nov 2026. It sends everything to the one that was added.)
    case soundCard = 2
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
    /// With `.soundCard`: which outputs carry what, or that no such card is connected. Empty in
    /// the other modes.
    public private(set) var soundCardNote = ""

    public init() {
        mixer = UnsafeMutablePointer<MixerShared>.allocate(capacity: 1)
        mixer.initialize(to: MixerShared())
        for side in 0..<2 {
            let ring = UnsafeMutablePointer<Float>.allocate(capacity: Mixer.echoCapacity)
            ring.initialize(repeating: 0, count: Mixer.echoCapacity)
            if side == 0 { mixer.pointee.echoL = ring } else { mixer.pointee.echoR = ring }
        }
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
        mixer.pointee.echoL?.deallocate(); mixer.pointee.echoR?.deallocate()
        mixer.deinitialize(count: 1); mixer.deallocate()
        deckList.deallocate(); stripList.deallocate(); scratch.deallocate()
    }

    /// The far speakers of a festival stage: the room hears the music this late as well (0 = off).
    public var echoSeconds: Double = 0 {
        didSet { mixer.pointee.echoDelay = Int(max(0, echoSeconds) * mixer.pointee.sampleRate) }
    }

    /// Everything the mixer puts out, 0...1. Turned down a little while a coach talks over the music.
    public var masterVolume: Float {
        get { mixer.pointee.master }
        set { mixer.pointee.master = max(0, min(1, newValue)) }
    }

    /// How the headphones are fed. Changing to or from `.soundCard` rebuilds the sound output
    /// (a short gap in the music).
    public var phones: PhonesMode = .off {
        didSet {
            applySplit()
            if phones != .soundCard { soundCardNote = "" }
            let rebuild = (phones == .soundCard) != (oldValue == .soundCard)
            if rebuild && running { restart() }
        }
    }

    /// SPLIT stays on whatever the output is. (Build 16 held it off on the phone's speaker; that
    /// silenced the cued record in lesson 4, since without SPLIT the cue goes nowhere. Removed.)
    private func applySplit() {
        mixer.pointee.split = phones == .split
    }

    /// Something was plugged in or pulled out.
    public func routeChanged() {
        applySplit()
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

            let wantCard = phones == .soundCard
            #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setPreferredIOBufferDuration(0.005)
            // Four channels when a sound card offers them and they are wanted, otherwise plain stereo.
            let most = session.maximumOutputNumberOfChannels
            try? session.setPreferredOutputNumberOfChannels(wantCard && most >= 4 ? 4 : min(2, max(1, most)))
            try session.setActive(true)
            bufferSeconds = session.ioBufferDuration
            #endif
            routeChanged()

            let hardware = engine.outputNode.outputFormat(forBus: 0)
            let rate = hardware.sampleRate > 0 ? hardware.sampleRate : 48_000
            sampleRate = rate
            mixer.pointee.sampleRate = rate
            mixer.pointee.echoDelay = Int(max(0, echoSeconds) * rate)
            for deck in decks { deck.outputRate = rate }

            if wantCard && hardware.channelCount >= 4 {
                // Straight to the hardware in its own format: room on channels 1-2, headphones on 3-4.
                let node = makeNode(format: hardware, plan: OutputPlan(room: 0, roomWidth: 2, phones: 2, phonesWidth: 2))
                engine.attach(node)
                engine.connect(node, to: engine.outputNode, format: hardware)
                soundCardNote = "ROOM: outputs 1-2  ·  PHONES: outputs 3-4 (\(outputs))"
            } else {
                if wantCard { soundCardNote = "No sound card with four outputs is connected. Playing the room only." }
                guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) else {
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

    /// A sound card with four or more outputs is connected (so the sound-card mode can be offered).
    public var soundCardConnected: Bool {
        #if os(iOS)
        return AVAudioSession.sharedInstance().maximumOutputNumberOfChannels >= 4
        #else
        return false
        #endif
    }

    /// Which hardware channels carry the room and which the headphones.
    struct OutputPlan {
        var room: Int, roomWidth: Int
        var phones: Int, phonesWidth: Int
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
