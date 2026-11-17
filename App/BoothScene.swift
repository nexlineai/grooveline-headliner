import SpriteKit
import QuartzCore
import SwiftUI
import AVFoundation
import HeadlinerCore
import HeadlinerAudio

/// The booth: the room on top, two turntables and a mixer below.
/// The settings (fader positions and so on) live here, apart from the nodes, so the gear can be
/// rebuilt for a new screen size without losing anything.
final class BoothScene: SKScene {
    private enum Kind: Equatable {
        case platter(Int), rim(Int), pitch(Int), channel(Int), cross, eq(Int, Int), play(Int), cue(Int), sync(Int)
        case needle(Int), wave(Int), phones(Int), cueMix, filter(Int)
    }

    private struct Grab {
        var kind: Kind
        var start: CGPoint
        var startValue: Double
        var angle: CGFloat = 0
    }

    /// What the DJ on the other deck is doing (back to back, chapter 11). Ramps are counted in
    /// beats of her own record.
    private enum PartnerMove: Equatable {
        /// Her record is on air. Once your fader has been down since she came in (`armed`), your
        /// record coming up is your answer.
        case on(armed: Bool)
        /// Your record is up: at the end of this phrase of hers she takes her low out.
        case waiting(phrase: Double)
        /// Her low goes down over two beats from this beat.
        case cutting(from: Double)
        /// Her low is out; she waits for yours to come back in (or two bars).
        case swapped(since: Double)
        /// Her fader comes down over four bars from this beat and level; then she stops.
        case fading(from: Double, level: Double)
        /// Her record is out and stopped; your record has been on air alone since this time (s).
        case out(since: Double)
        /// Her answer turns at your tempo, on your beat and your phrase, her fader down: it
        /// comes up at your next phrase.
        case ready(phrase: Double)
        /// Her fader comes up over one phrase from this beat of yours (her low still out).
        case rising(from: Double)
        /// Up: her low comes back in over two beats from this beat of hers; take yours out.
        case bassing(from: Double)
    }

    /// Radians per second of a record at 33⅓ rpm.
    private static let turn = 2 * Double.pi * (100.0 / 3.0) / 60
    /// The pitch fader covers ±8 %, like a classic turntable.
    private static let pitchRange = 0.08

    private let game: Game
    private var decks: [Deck] { game.engine.decks }

    var insets = EdgeInsets() { didSet { if insets != oldValue { needsBuild = true } } }
    /// The lesson being taught here, if any. It reads the decks every frame and says what to point at.
    var lesson: LessonRunner?
    /// The night being played here, if any: the crowd's energy follows the mixing.
    var night: NightRunner?
    var nightInfo: NightInfo?
    /// A record stuck in one groove (a night's mishap): the deck, and where the groove starts (s).
    private var stuck: (deck: Int, from: Double)?
    /// A turntable whose belt slips (a night's mishap): its pitch wanders from then on.
    private var wander: (deck: Int, since: Double)?
    /// A channel fader that is broken in this booth (stuck where it is).
    private var deadFader: Int?
    /// Back to back: the deck the other DJ plays herself, what she is doing, and the hands put
    /// on her deck so far (refused; the lesson counts them).
    private var partnerDeck: Int?
    private var partnerMove = PartnerMove.on(armed: true)
    private var stepOns = 0
    /// Her records for answering yours (a night), the ones she has played, and her answers so far.
    private var partnerBag: [String] = []
    private var partnerPlayed: Set<String> = []
    private var partnerAnswers = 0
    /// When she may next move her needle to put a small slip right (her fader is down then).
    private var partnerTrimAt = 0.0
    private var pointer: SKShapeNode?
    private var pointedAt: LessonTarget?
    private var lessonReady = false

    // Settings.
    private var pitchFader = [0.5, 0.5]      // 1 = top = slower, as on a turntable
    private var channel = [0.85, 0.85]
    private var cross = 0.5
    private var eq = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]] // per deck: low, mid, high
    private var sync = [false, false]
    /// Headphone cue per channel: that record is heard in the headphones, before its fader.
    private var phones = [false, false]

    // Hands.
    private var grabs: [UITouch: Grab] = [:]
    private var handTravel: [CGFloat] = [0, 0]
    private var handSpeed = [0.0, 0.0]
    private var rimTravel: [CGFloat] = [0, 0]
    private var rimSpeed = [0.0, 0.0]
    /// While a needle is in the air: where on the record it will come down, 0...1.
    private var dropAt: [Double?] = [nil, nil]

    // Gear on screen.
    private var needsBuild = true
    private var hits: [(kind: Kind, rect: CGRect)] = []
    private var platterCentre: [CGPoint] = [.zero, .zero]
    private var platterRadius: CGFloat = 60
    private var pitchTravel: CGFloat = 100
    private var channelTravel: CGFloat = 80
    private var crossTravel: CGFloat = 100
    private var knobTravel: CGFloat = 90
    private var phaseWidth: CGFloat = 100
    private var armPivotAngle: CGFloat = 0
    private var armLength: CGFloat = 100
    private var armPivot: [CGPoint] = [.zero, .zero]
    private var needleReach: CGFloat = 20
    private var waveRect: [CGRect] = [.zero, .zero]

    private var record: [SKSpriteNode] = []
    private var arm: [SKNode] = []
    private var pitchNode: [FaderNode] = []
    private var channelNode: [FaderNode] = []
    private var crossNode: FaderNode?
    private var knob: [[KnobNode]] = []
    /// The one-knob filter per channel (0.5 = off), shown from chapter 7 on and in free play.
    private var filterSetting = [0.5, 0.5]
    private var filterKnob: [KnobNode] = []
    private var hasFilter = true
    private var playButton: [ButtonNode] = []
    private var cueButton: [ButtonNode] = []
    private var syncButton: [ButtonNode] = []
    private var phonesButton: [ButtonNode] = []
    private var cueMixKnob: KnobNode?
    private var meter: [MeterNode] = []
    private var meterLevel = [0.0, 0.0]
    private var bpmLabel: [SKLabelNode] = []
    private var pitchLabel: [SKLabelNode] = []
    private var beatDots: [[SKShapeNode]] = []
    private var wavePlayed: [SKSpriteNode] = []
    private var wavePlayhead: [SKSpriteNode] = []
    private var waveCue: [SKSpriteNode] = []
    private var waveDrop: [SKSpriteNode] = []
    private var timeLabel: [SKLabelNode] = []
    private var verdict: SKLabelNode?
    private var phaseDot: SKShapeNode?
    private var roomGlow: SKSpriteNode?
    private var roomShade: SKSpriteNode?
    /// The room in four moods, each a loop of the same picture: waiting, nodding, dancing, going nuts.
    private static let moodNames = ["waiting", "nodding", "dancing", "nuts"]
    /// Which room is above the gear (`room-<room>.jpg`); a lesson can name another.
    private var room = "bedroom"
    /// Extra lift of a room's picture, as a part of its height, for rooms whose people stand low
    /// in the picture (chapter 10's open air: at the default only sky and trees showed, build 46).
    private static let roomLift: [String: CGFloat] = ["field": 0.28, "forest": 0.32, "festival": 0.2, "tent": 0.2]
    /// False on vinyl: SYNC is dim and does nothing.
    private var syncAllowed = true
    /// Ear training: the tempo readouts, the phase dot and the verdict are hidden.
    private var hideNumbers = false
    /// What the room heard this frame (for the lesson, which runs after the drawing).
    private var lastReading: MixReading?
    private var roomVideos: [SKVideoNode?] = [nil, nil, nil, nil]
    private var roomPlayers: [AVQueuePlayer?] = [nil, nil, nil, nil]
    private var roomLoopers: [AVPlayerLooper?] = [nil, nil, nil, nil]
    /// The mood on show, or -1 while only the still picture has been seen.
    private var roomMood = -1
    private var roomPictureSize = CGSize.zero
    private var roomCentre = CGPoint.zero
    private var status: SKLabelNode?

    private var lastTime: TimeInterval = 0
    private var demoStarted = false
    private let tap = UIImpactFeedbackGenerator(style: .light)
    private let detent = UISelectionFeedbackGenerator()

    init(game: Game) {
        self.game = game
        super.init(size: CGSize(width: 852, height: 393))
        scaleMode = .resizeFill
        backgroundColor = Palette.night
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func didMove(to view: SKView) {
        view.isMultipleTouchEnabled = true
        if let lesson {
            setTheDesk(lesson.lesson.desk)
        } else if let info = nightInfo {
            // A night starts like a gig: the first record ready, the second one's fader down.
            setTheDesk(LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: info.syncAllowed ? [false, true] : [false, false],
                                  room: info.room, syncAllowed: info.syncAllowed, records: info.records, crate: true, chapter: info.chapter,
                                  deadFader: info.deadFader, echo: info.echo, partner: info.partner, partnerBag: info.partnerBag))
        }
        applyMix()
    }

    /// A new record was put on deck `d`: its pitch fader goes back to the middle and the deck is
    /// drawn again (title, strip).
    func recordChanged(on d: Int) {
        guard d >= 0, d < 2 else { return }
        pitchFader[d] = 0.5
        dropAt[d] = nil
        // A lesson that cues its records past the intro cues the new one there too.
        if let bar = lesson?.lesson.desk.cueBar {
            let deck = decks[d]
            deck.cuePoint = cueAt(bar, on: deck)
            deck.seek(to: deck.cuePoint)
        }
        needsBuild = true
    }

    /// The studio's pattern was edited: the left deck plays the new version from where it is.
    func patternChanged() {
        guard lesson?.lesson.desk.studio == true, decks[0].info?.id != "your-dubplate" else { return }
        Studio.load(game.pattern, on: decks[0], keepPlace: true)
    }

    /// Where a record is cued: `bar` bars after its first beat (when the record is that long),
    /// otherwise on the first beat.
    private func cueAt(_ bar: Int?, on deck: Deck) -> Double {
        guard let bar else { return deck.grid.firstBeat }
        let at = deck.grid.seconds(atBeat: Double(bar * 4))
        return at < deck.duration - 20 ? at : deck.grid.firstBeat
    }

    /// A lesson starts from a known desk: both records at their first beat and stopped, pitch
    /// and EQ in the middle, and the crossfader, channel faders and SYNC as the lesson wants them.
    private func setTheDesk(_ desk: LessonDesk) {
        cross = desk.crossfader
        channel = desk.channel
        pitchFader = desk.pitch ?? [0.5, 0.5]
        hideNumbers = desk.hideBPM
        eq = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]]
        filterSetting = [0.5, 0.5]
        hasFilter = desk.chapter >= 7
        deadFader = desk.deadFader
        wander = nil
        game.engine.echoSeconds = desk.echo
        sync = desk.sync
        room = desk.room
        syncAllowed = desk.syncAllowed
        // The records this lesson or night is written for (default: the first two, 122 and 124
        // BPM); put them on if the crate swapped them.
        let wanted = desk.records ?? game.tracks.prefix(2).map { $0.id }
        for d in 0..<min(2, wanted.count) where decks[d].info?.id != wanted[d] {
            if let track = game.tracks.first(where: { $0.id == wanted[d] }) { game.load(track, on: decks[d]) }
        }
        // The studio: the left deck plays the drum pattern.
        if desk.studio { Studio.load(game.pattern, on: decks[0], keepPlace: false) }
        if let mix = desk.cueMix { game.cueMix = mix }
        phones = [false, false]
        for d in 0..<2 {
            let deck = decks[d]
            deck.motorOn = false
            deck.pitch = (0.5 - pitchFader[d]) * 2 * Self.pitchRange
            deck.bend = 0
            deck.cuePoint = cueAt(desk.cueBar, on: deck)
            deck.seek(to: deck.cuePoint)
            for band in 0..<3 { deck.setEQ(band: band, value: 0.5) }
            deck.setFilter(0.5)
        }
        // Back to back: her record is already on air when the lesson starts.
        partnerDeck = desk.partner
        partnerMove = .on(armed: true)
        stepOns = 0
        partnerBag = desk.partnerBag
        partnerAnswers = 0
        partnerPlayed = []
        if let h = desk.partner, decks[h].isLoaded {
            decks[h].motorOn = true
            if let id = decks[h].info?.id { partnerPlayed.insert(id) }
        }
        needsBuild = true
    }

    override func didChangeSize(_ oldSize: CGSize) {
        needsBuild = true
    }

    // MARK: - Building the gear

    private func build() {
        removeAllChildren()
        pointer = nil
        pointedAt = nil
        releaseAllHands()
        hits = []
        record = []; arm = []; pitchNode = []; channelNode = []; knob = []; filterKnob = []
        playButton = []; cueButton = []; syncButton = []; phonesButton = []; meter = []
        bpmLabel = []; pitchLabel = []; beatDots = []
        wavePlayed = []; wavePlayhead = []; waveCue = []; waveDrop = []; timeLabel = []

        let W = size.width, H = size.height
        guard W > 200, H > 200 else { return }
        let left = max(insets.leading, 10), right = max(insets.trailing, 10), bottom = max(insets.bottom, 8)
        let gearTop = H * 0.58
        let gx0 = left, gy0 = bottom
        let gw = W - left - right, gh = gearTop - 6 - bottom
        let u = gh / 210
        let gap = 8 * u
        let mixerW = min(gw * 0.31, 224 * u)
        let deckW = (gw - mixerW - gap * 2) / 2

        buildRoom(above: gearTop)

        let deckRects = [CGRect(x: gx0, y: gy0, width: deckW, height: gh),
                         CGRect(x: gx0 + deckW + gap + mixerW + gap, y: gy0, width: deckW, height: gh)]
        for d in 0..<2 { buildDeck(d, in: deckRects[d], unit: u) }
        buildMixer(in: CGRect(x: gx0 + deckW + gap, y: gy0, width: mixerW, height: gh), unit: u)

        let line = gearLabel("", size: 10 * u, color: Palette.red)
        line.horizontalAlignmentMode = .left
        line.position = CGPoint(x: left + 44, y: H - 14)
        line.zPosition = 20
        addChild(line)
        status = line
    }

    /// The room is the DJ's view over the desk: a picture as wide as the screen, with the people in
    /// its upper part. The gear covers the rest. A looping clip of the same picture plays on top of
    /// the still while a record is heard.
    private func buildRoom(above gearTop: CGFloat) {
        let W = size.width, H = size.height
        // Picture and clip are the same crop (1456 x 472). Lifted a little so heads and shoulders
        // sit in the part the gear leaves free. Open-air rooms have their people lower in the
        // picture (and in the clip, which is the same crop): they are lifted further, never so far
        // that the picture's bottom edge comes above the gear.
        let pictureSize = CGSize(width: W, height: W * 472 / 1456)
        let maxLift = max(0, gearTop + pictureSize.height - H - W * 0.026)
        let lift = min((Self.roomLift[room] ?? 0) * pictureSize.height, maxLift)
        let centre = CGPoint(x: W / 2, y: H + W * 0.026 + lift - pictureSize.height / 2)
        if let image = Art.image("room-\(room)") ?? Art.image("room-bedroom") {
            let still = SKSpriteNode(texture: SKTexture(image: image))
            still.size = pictureSize
            still.position = centre
            still.zPosition = -12
            addChild(still)
        }
        // The moving room is added when a mood is first wanted (see `showRoom`).
        roomPictureSize = pictureSize
        roomCentre = centre
        roomVideos = [nil, nil, nil, nil]
        for (m, player) in roomPlayers.enumerated() where m != roomMood { player?.pause() }
        if roomMood >= 0, let node = roomVideo(roomMood) { node.alpha = 1 }

        let rect = CGRect(x: 0, y: gearTop, width: W, height: H - gearTop)
        let shade = SKSpriteNode(color: .black, size: rect.size)
        shade.position = CGPoint(x: rect.midX, y: rect.midY)
        shade.alpha = 0.45
        shade.zPosition = -9
        addChild(shade)
        roomShade = shade
        let glow = SKSpriteNode(color: Palette.orange, size: rect.size)
        glow.position = CGPoint(x: rect.midX, y: rect.midY)
        glow.blendMode = .add
        glow.alpha = 0
        glow.zPosition = -8
        addChild(glow)
        roomGlow = glow
        // The desk the gear stands on hides the lower part of the picture.
        let desk = SKSpriteNode(color: Palette.night, size: CGSize(width: W, height: gearTop))
        desk.position = CGPoint(x: W / 2, y: gearTop / 2)
        desk.zPosition = -7
        addChild(desk)
        let lip = SKSpriteNode(color: Palette.teal.withAlphaComponent(0.5), size: CGSize(width: W, height: 1))
        lip.position = CGPoint(x: W / 2, y: gearTop)
        lip.zPosition = -6
        addChild(lip)
    }

    /// The video node of one mood, made (with its looping player) the first time it is wanted.
    private func roomVideo(_ mood: Int) -> SKVideoNode? {
        guard mood >= 0, mood < Self.moodNames.count else { return nil }
        if let node = roomVideos[mood] { return node }
        if roomPlayers[mood] == nil {
            // A room without a loop for this mood borrows the nearest mood it has (the shop only nods).
            let order = [mood, 1, 2, 0, 3]
            guard let url = order.lazy.compactMap({ Bundle.main.url(forResource: "room-\(self.room)-\(Self.moodNames[$0])", withExtension: "mp4") }).first
            else { return nil }
            let player = AVQueuePlayer()
            player.isMuted = true
            player.preventsDisplaySleepDuringVideoPlayback = false
            roomLoopers[mood] = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
            roomPlayers[mood] = player
        }
        guard let player = roomPlayers[mood] else { return nil }
        let video = SKVideoNode(avPlayer: player)
        video.size = roomPictureSize
        video.position = roomCentre
        video.zPosition = -11
        video.alpha = 0
        addChild(video)
        roomVideos[mood] = video
        return video
    }

    /// Shows the room in `mood` (fading over from the mood before), or with -1 holds it still
    /// where it is.
    private func showRoom(_ mood: Int, _ dt: Double) {
        var wanted = mood
        if wanted >= 0 && roomVideo(wanted) == nil { wanted = roomVideo(2) == nil ? -1 : 2 } // no clip: dancing will do
        if wanted >= 0 {
            roomMood = wanted
            if let player = roomPlayers[wanted], player.rate == 0 { player.play() }
        }
        for m in 0..<roomVideos.count {
            guard let node = roomVideos[m] else { continue }
            let target: CGFloat = m == roomMood ? 1 : 0
            node.alpha += (target - node.alpha) * CGFloat(min(1, dt * 4))
            let gone = m != roomMood && node.alpha < 0.02
            if (gone || wanted < 0), let player = roomPlayers[m], player.rate != 0 { player.pause() }
        }
    }

    private func buildDeck(_ d: Int, in rect: CGRect, unit u: CGFloat) {
        let tint = d == 0 ? Palette.teal : Palette.magenta
        addChild(panel(rect, radius: 10 * u))

        // Platter: as big as the panel allows, with the title and the record's strip above and
        // buttons below.
        let outer = min((rect.height - 64 * u) / 2, (rect.width - 86 * u) / 2)
        let r = outer / 1.07
        let centre = CGPoint(x: rect.minX + 8 * u + outer, y: rect.minY + 34 * u + outer)
        platterCentre[d] = centre
        platterRadius = r

        let disc = SKSpriteNode(texture: Draw.platter(radius: r, label: tint))
        disc.size = CGSize(width: outer * 2, height: outer * 2)
        disc.position = centre
        disc.zPosition = 1
        addChild(disc)
        record.append(disc)
        let sheen = SKSpriteNode(texture: Draw.sheen(radius: r))
        sheen.size = CGSize(width: r * 2, height: r * 2)
        sheen.position = centre
        sheen.zPosition = 2
        sheen.blendMode = .add
        addChild(sheen)
        let reach = outer * 2.16
        hits.append((Kind.platter(d), centred(centre.x, centre.y, reach, reach)))

        // Tonearm: pivot behind the platter on the right, needle travelling in as the record plays.
        let pivot = CGPoint(x: centre.x + r * 0.98, y: centre.y + r * 0.86)
        armPivot[d] = pivot
        needleReach = max(20, 20 * u)
        armLength = hypot(pivot.x - centre.x, pivot.y - centre.y)
        armPivotAngle = atan2(centre.y - pivot.y, centre.x - pivot.x)
        let tonearm = makeTonearm(length: armLength, unit: u)
        tonearm.position = pivot
        tonearm.zPosition = 3
        addChild(tonearm)
        arm.append(tonearm)

        // Top row: title, time left on the record, and four lamps that count the bar.
        let info = decks[d].info
        let rowY = rect.maxY - 8 * u
        let title = gearLabel(info.map { "\($0.artist.uppercased())  ·  \($0.title.uppercased())" } ?? "NO RECORD", size: 8.5 * u, color: Palette.ink)
        title.horizontalAlignmentMode = .left
        title.position = CGPoint(x: rect.minX + 10 * u, y: rowY)
        addChild(title)
        var dots: [SKShapeNode] = []
        for i in 0..<4 {
            let dot = SKShapeNode(circleOfRadius: 2.6 * u)
            dot.fillColor = tint
            dot.strokeColor = .clear
            dot.alpha = 0.15
            let dotX = rect.maxX - 52 * u - CGFloat(3 - i) * 9 * u
            dot.position = CGPoint(x: dotX, y: rowY)
            addChild(dot)
            dots.append(dot)
        }
        beatDots.append(dots)
        let time = gearLabel("", size: 8.5 * u, color: Palette.dim, mono: true)
        time.horizontalAlignmentMode = .right
        time.position = CGPoint(x: rect.maxX - 88 * u, y: rowY)
        addChild(time)
        timeLabel.append(time)
        // A long title makes room for the time.
        let titleRoom = time.position.x - 34 * u - title.position.x
        if title.frame.width > titleRoom, title.frame.width > 0 { title.setScale(titleRoom / title.frame.width) }

        buildWave(d, in: CGRect(x: rect.minX + 10 * u, y: rect.maxY - 27 * u, width: rect.width - 58 * u, height: 12 * u), tint: tint)

        // Buttons.
        let buttonSize = CGSize(width: 46 * u, height: 22 * u)
        let y = rect.minY + 17 * u
        let cue = ButtonNode(size: buttonSize, title: "CUE", tint: Palette.orange)
        let play = ButtonNode(size: buttonSize, title: "PLAY", tint: tint)
        let syncB = ButtonNode(size: buttonSize, title: "SYNC", tint: Palette.ink)
        let kinds: [Kind] = [.cue(d), .play(d), .sync(d)]
        for (i, button) in [cue, play, syncB].enumerated() {
            let pitchOfButtons = buttonSize.width + 8 * u
            let x = rect.minX + 10 * u + buttonSize.width / 2 + CGFloat(i) * pitchOfButtons
            button.position = CGPoint(x: x, y: y)
            button.zPosition = 4
            addChild(button)
            hits.insert((kinds[i], centred(x, y, buttonSize.width + 8, buttonSize.height + 12)), at: 0)
        }
        cueButton.append(cue); playButton.append(play); syncButton.append(syncB)

        // Pitch fader on the right edge: up is slower.
        pitchTravel = rect.height - 78 * u
        let fader = FaderNode(travel: pitchTravel, vertical: true, cap: CGSize(width: 26 * u, height: 13 * u), tint: tint, centreMark: true)
        fader.position = CGPoint(x: rect.maxX - 24 * u, y: rect.midY + 3 * u)
        fader.value = pitchFader[d]
        fader.zPosition = 4
        addChild(fader)
        pitchNode.append(fader)
        hits.insert((Kind.pitch(d), centred(fader.position.x, fader.position.y, 48 * u, pitchTravel + 32 * u)), at: 0)
        let minus = gearLabel("−", size: 12 * u)
        minus.position = CGPoint(x: fader.position.x, y: fader.position.y + pitchTravel / 2 + 20 * u)
        addChild(minus)
        let readout = gearLabel("0.0%", size: 10 * u, color: tint, mono: true)
        readout.position = CGPoint(x: fader.position.x - 6 * u, y: rect.minY + 13 * u)
        addChild(readout)
        pitchLabel.append(readout)
    }

    /// The record at a glance: loud and quiet stretches, a line where the needle is, an orange
    /// mark at the cue point. Touch it to lift the needle, let go to drop it there.
    private func buildWave(_ d: Int, in rect: CGRect, tint: UIColor) {
        waveRect[d] = rect
        let slot = SKShapeNode(rect: rect.insetBy(dx: -2, dy: -2), cornerRadius: 3)
        slot.fillColor = Palette.slot
        slot.strokeColor = Palette.edge
        slot.lineWidth = 1
        slot.zPosition = 3
        addChild(slot)

        let deck = decks[d]
        let beatsPerPhrase = 64.0 // sixteen bars
        var ticks: [CGFloat] = []
        if deck.duration > 0 {
            var beat = 0.0
            while true {
                let at = deck.grid.seconds(atBeat: beat) / deck.duration
                if at >= 1 { break }
                ticks.append(CGFloat(at))
                beat += beatsPerPhrase
            }
        }
        let picture = SKSpriteNode(texture: Draw.waveform(deck.overview, size: rect.size, tint: tint, ticks: ticks))
        picture.size = rect.size
        picture.position = CGPoint(x: rect.midX, y: rect.midY)
        picture.zPosition = 4
        addChild(picture)

        let played = SKSpriteNode(color: UIColor(white: 0, alpha: 0.55), size: CGSize(width: 1, height: rect.height))
        played.anchorPoint = CGPoint(x: 0, y: 0.5)
        played.position = CGPoint(x: rect.minX, y: rect.midY)
        played.zPosition = 5
        addChild(played)
        wavePlayed.append(played)

        func line(_ colour: UIColor, width: CGFloat, taller: CGFloat) -> SKSpriteNode {
            let node = SKSpriteNode(color: colour, size: CGSize(width: width, height: rect.height + taller))
            node.position = CGPoint(x: rect.minX, y: rect.midY)
            node.zPosition = 6
            addChild(node)
            return node
        }
        waveCue.append(line(Palette.orange, width: 1.5, taller: 0))
        wavePlayhead.append(line(.white, width: 1.5, taller: 4))
        let drop = line(tint, width: 2.5, taller: 6)
        drop.zPosition = 7
        drop.isHidden = true
        waveDrop.append(drop)

        // Easy to hit with a thumb: the touch area is much taller than the strip, upwards.
        let reach = CGRect(x: rect.minX - 8, y: rect.minY - 1, width: rect.width + 16, height: rect.height + 30)
        hits.insert((Kind.wave(d), reach), at: 0)
    }

    private func buildMixer(in rect: CGRect, unit u: CGFloat) {
        addChild(panel(rect, radius: 10 * u))
        let tints = [Palette.teal, Palette.magenta]

        // Top: both tempos, the verdict, and how far apart the beats are.
        for d in 0..<2 {
            let label = gearLabel("---.-", size: 14 * u, color: tints[d], mono: true)
            label.position = CGPoint(x: d == 0 ? rect.minX + 32 * u : rect.maxX - 32 * u, y: rect.maxY - 15 * u)
            addChild(label)
            label.isHidden = hideNumbers
            bpmLabel.append(label)
        }
        let word = gearLabel("", size: 11.5 * u, color: Palette.dim)
        word.position = CGPoint(x: rect.midX, y: rect.maxY - 13 * u)
        addChild(word)
        verdict = word
        word.isHidden = hideNumbers
        phaseWidth = min(104 * u, rect.width * 0.5)
        let track = SKShapeNode(rectOf: CGSize(width: phaseWidth, height: 3 * u), cornerRadius: 1.5 * u)
        track.fillColor = Palette.slot
        track.strokeColor = Palette.edge
        track.position = CGPoint(x: rect.midX, y: rect.maxY - 30 * u)
        addChild(track)
        let centreMark = SKShapeNode(rectOf: CGSize(width: 1.5, height: 10 * u))
        centreMark.fillColor = Palette.dim
        centreMark.strokeColor = .clear
        centreMark.position = track.position
        addChild(centreMark)
        let dot = SKShapeNode(circleOfRadius: 4 * u)
        dot.fillColor = Palette.dim
        dot.strokeColor = .clear
        dot.position = track.position
        dot.zPosition = 5
        addChild(dot)
        phaseDot = dot
        dot.isHidden = hideNumbers
        track.isHidden = hideNumbers
        centreMark.isHidden = hideNumbers

        // Channel strips: EQ knobs on the outside, fader inside, meters in the middle.
        knobTravel = 90 * u
        channelTravel = 88 * u
        let names = ["LOW", "MID", "HI"]
        for d in 0..<2 {
            let kx = d == 0 ? rect.minX + 27 * u : rect.maxX - 27 * u
            var column: [KnobNode] = []
            for band in 0..<3 {
                let node = KnobNode(radius: 13 * u, tint: tints[d], title: names[band])
                // HI on top, LOW at the bottom.
                let ky = rect.minY + 74 * u + CGFloat(band) * 41 * u
                node.position = CGPoint(x: kx, y: ky)
                node.value = eq[d][band]
                node.zPosition = 4
                addChild(node)
                column.append(node)
                hits.insert((Kind.eq(d, band), centred(kx, ky, 42 * u, 40 * u)), at: 0)
            }
            knob.append(column)

            let fx = d == 0 ? rect.minX + 72 * u : rect.maxX - 72 * u
            let fader = FaderNode(travel: channelTravel, vertical: true, cap: CGSize(width: 24 * u, height: 13 * u), tint: tints[d])
            fader.position = CGPoint(x: fx, y: rect.minY + 110 * u)
            fader.value = channel[d]
            fader.zPosition = 4
            addChild(fader)
            channelNode.append(fader)
            if d == deadFader { fader.alpha = 0.4 } // broken in this booth
            hits.insert((Kind.channel(d), centred(fx, fader.position.y, 40 * u, channelTravel + 28 * u)), at: 0)

            // Headphone cue, under the channel fader.
            let listen = ButtonNode(size: CGSize(width: 36 * u, height: 15 * u), title: "PHONES", tint: Palette.orange)
            listen.position = CGPoint(x: fx, y: rect.minY + 49 * u)
            listen.zPosition = 4
            listen.lit = phones[d]
            addChild(listen)
            phonesButton.append(listen)
            hits.insert((Kind.phones(d), centred(fx, listen.position.y, 44 * u, 24 * u)), at: 0)

            let lights = MeterNode(size: CGSize(width: 7 * u, height: 96 * u))
            let side: CGFloat = d == 0 ? -9 : 9
            lights.position = CGPoint(x: rect.midX + side * u, y: rect.minY + 110 * u)
            addChild(lights)
            meter.append(lights)
        }

        // Cue mix, between the two PHONES buttons: left = only the cued record in the headphones,
        // right = only the room.
        let mixKnob = KnobNode(radius: 9 * u, tint: Palette.orange, title: "")
        mixKnob.position = CGPoint(x: rect.midX, y: rect.minY + 49 * u)
        mixKnob.value = game.cueMix
        mixKnob.zPosition = 4
        addChild(mixKnob)
        cueMixKnob = mixKnob
        hits.insert((Kind.cueMix, centred(rect.midX, mixKnob.position.y, 30 * u, 26 * u)), at: 0)

        // Crossfader.
        crossTravel = min(112 * u, rect.width * 0.55)
        let fader = FaderNode(travel: crossTravel, vertical: false, cap: CGSize(width: 14 * u, height: 24 * u), tint: Palette.teal, centreMark: true)
        fader.position = CGPoint(x: rect.midX, y: rect.minY + 24 * u)
        fader.value = cross
        fader.zPosition = 4
        addChild(fader)
        crossNode = fader
        hits.insert((Kind.cross, centred(rect.midX, fader.position.y, crossTravel + 36 * u, 40 * u)), at: 0)

        // Filter knobs, under the EQ columns, beside the crossfader's ends (added last, so they win
        // the little overlap with the crossfader's touch area, outside its travel).
        if hasFilter {
            for d in 0..<2 {
                let kx = d == 0 ? rect.minX + 27 * u : rect.maxX - 27 * u, ky = rect.minY + 27 * u
                let node = KnobNode(radius: 10 * u, tint: d == 0 ? Palette.teal : Palette.magenta, title: "FILTER")
                node.position = CGPoint(x: kx, y: ky)
                node.value = filterSetting[d]
                node.zPosition = 4
                addChild(node)
                filterKnob.append(node)
                hits.insert((Kind.filter(d), centred(kx, ky, 30 * u, 30 * u)), at: 0)
            }
        }
    }

    // MARK: - Hands

    /// Where the needle sits on screen right now.
    private func needleTip(_ d: Int) -> CGPoint {
        guard d < arm.count else { return .zero }
        let a = arm[d].zRotation
        return CGPoint(x: armPivot[d].x + cos(a) * armLength, y: armPivot[d].y + sin(a) * armLength)
    }

    /// How far through the record a needle is that sits `distance` from the spindle.
    private func progress(atNeedle distance: CGFloat) -> Double {
        let ratio = Double(distance / max(1, platterRadius))
        return min(1, max(0, (0.93 - ratio) / 0.5))
    }

    private func control(at p: CGPoint) -> Kind? {
        // The headshell first: it lies on the record, and picking it up must not grab the record.
        for d in 0..<2 where d < arm.count && decks[d].isLoaded {
            let tip = needleTip(d)
            if hypot(p.x - tip.x, p.y - tip.y) <= needleReach { return .needle(d) }
        }
        for hit in hits where hit.rect.contains(p) {
            if case .wave(let d) = hit.kind {
                // The top of the platter's rim reaches into the strip's touch area; the rim wins there,
                // so a nudge at twelve o'clock never throws the needle across the record.
                let dist = hypot(p.x - platterCentre[d].x, p.y - platterCentre[d].y)
                if dist <= platterRadius * 1.13 || !decks[d].isLoaded { continue }
                return hit.kind
            }
            if case .platter(let d) = hit.kind {
                // On the record the hand grabs it; on the dotted rim it only pushes or drags.
                let dist = hypot(p.x - platterCentre[d].x, p.y - platterCentre[d].y)
                if dist <= platterRadius * 0.93 { return .platter(d) }
                if dist <= platterRadius * 1.2 { return .rim(d) }
                continue
            }
            return hit.kind
        }
        return nil
    }

    /// A touch area of `w` by `h` centred on a control.
    private func centred(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
        CGRect(x: x - w / 2, y: y - h / 2, width: w, height: h)
    }

    private func value(of kind: Kind) -> Double {
        switch kind {
        case .pitch(let d): return pitchFader[d]
        case .channel(let d): return channel[d]
        case .cross: return cross
        case .eq(let d, let band): return eq[d][band]
        case .filter(let d): return filterSetting[d]
        case .cueMix: return game.cueMix
        default: return 0
        }
    }

    private func angle(_ p: CGPoint, on d: Int) -> CGFloat {
        atan2(p.y - platterCentre[d].y, p.x - platterCentre[d].x)
    }

    private func turned(from a: CGFloat, to b: CGFloat) -> CGFloat {
        var d = b - a
        if d > .pi { d -= 2 * .pi }
        if d < -.pi { d += 2 * .pi }
        return d
    }

    private func holds(_ kind: Kind) -> Bool { grabs.values.contains { $0.kind == kind } }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            let p = touch.location(in: self)
            guard let kind = control(at: p) else { continue }
            if partnerHolds(kind) {
                stepOn()
                continue
            }
            var grab = Grab(kind: kind, start: p, startValue: value(of: kind))
            switch kind {
            case .platter(let d):
                grab.angle = angle(p, on: d)
                handTravel[d] = 0
                handSpeed[d] = decks[d].rate
                decks[d].handRate = decks[d].rate
                decks[d].held = true
            case .rim(let d):
                grab.angle = angle(p, on: d)
                rimTravel[d] = 0
                rimSpeed[d] = 0
            case .needle(let d):
                // Remember where on the headshell the finger sits, so the arm does not jump to it.
                grab.angle = atan2(p.y - armPivot[d].y, p.x - armPivot[d].x) - arm[d].zRotation
                tap.impactOccurred()
                decks[d].lifted = true
                dropAt[d] = decks[d].progress
            case .wave(let d):
                tap.impactOccurred()
                decks[d].lifted = true
                dropAt[d] = waveProgress(p, on: d)
            case .play(let d):
                tap.impactOccurred()
                if !decks[d].motorOn && decks[d].progress > 0.995 { decks[d].seek(to: decks[d].cuePoint) }
                decks[d].motorOn.toggle()
            case .cue(let d):
                tap.impactOccurred()
                pressCue(d)
            case .sync(let d):
                guard syncAllowed else {
                    // Vinyl has no sync button.
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                    break
                }
                tap.impactOccurred()
                sync[d].toggle()
                if !sync[d] { decks[d].bend = 0 }
            case .phones(let d):
                tap.impactOccurred()
                phones[d].toggle()
                decks[d].cue = phones[d]
            case .eq(let d, let band):
                // A double tap puts a knob back at its default: EQ flat, in the middle.
                if touch.tapCount >= 2 {
                    eq[d][band] = 0.5
                    knob[d][band].value = 0.5
                    decks[d].setEQ(band: band, value: 0.5)
                    grab.startValue = 0.5
                    detent.selectionChanged()
                }
            case .filter(let d):
                // A double tap switches the filter off (the middle).
                if touch.tapCount >= 2 {
                    filterSetting[d] = 0.5
                    if d < filterKnob.count { filterKnob[d].value = 0.5 }
                    decks[d].setFilter(0.5)
                    grab.startValue = 0.5
                    detent.selectionChanged()
                }
            case .cueMix:
                // The cue mix's default is CUE: only the cued record in the headphones.
                if touch.tapCount >= 2 {
                    game.cueMix = 0
                    cueMixKnob?.value = 0
                    grab.startValue = 0
                    detent.selectionChanged()
                }
            default:
                break
            }
            grabs[touch] = grab
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            guard var grab = grabs[touch] else { continue }
            let p = touch.location(in: self)
            switch grab.kind {
            case .platter(let d):
                let a = angle(p, on: d)
                handTravel[d] += turned(from: grab.angle, to: a)
                grab.angle = a
            case .rim(let d):
                let a = angle(p, on: d)
                rimTravel[d] += turned(from: grab.angle, to: a)
                grab.angle = a
            case .needle(let d):
                // The arm swings round its pivot after the finger; the needle stays on the grooves.
                var swing = atan2(p.y - armPivot[d].y, p.x - armPivot[d].x) - grab.angle - armPivotAngle
                while swing > .pi { swing -= 2 * .pi }
                while swing < -.pi { swing += 2 * .pi }
                let distance = 2 * armLength * sin(max(0, swing) / 2)
                dropAt[d] = progress(atNeedle: distance)
            case .wave(let d):
                dropAt[d] = waveProgress(p, on: d)
            case .pitch(let d):
                // Fine mode: with the finger well to the side of the fader it moves four times slower.
                // Moved step by step from the last touch, so switching modes mid-drag does not jump.
                let fine = abs(p.x - pitchNode[d].position.x) > 60
                let raw = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / pitchTravel) * (fine ? 0.25 : 1)))
                grab.startValue = raw
                grab.start = p
                var v = raw
                if abs(v - 0.5) < 0.012 {
                    if pitchFader[d] != 0.5 { detent.selectionChanged() }
                    v = 0.5
                }
                pitchFader[d] = v
                pitchNode[d].value = v
                if sync[d] { sync[d] = false; decks[d].bend = 0 } // touching the pitch takes over from sync
                decks[d].pitch = (0.5 - v) * 2 * Self.pitchRange
            case .channel(let d):
                if d == deadFader { break } // a broken fader: stuck where it is
                channel[d] = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / channelTravel)))
                channelNode[d].value = channel[d]
                applyMix()
            case .cross:
                cross = min(1, max(0, grab.startValue + Double((p.x - grab.start.x) / crossTravel)))
                crossNode?.value = cross
                applyMix()
            case .cueMix:
                game.cueMix = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / knobTravel)))
                cueMixKnob?.value = game.cueMix
            case .eq(let d, let band):
                var v = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / knobTravel)))
                if abs(v - 0.5) < 0.03 { v = 0.5 }
                eq[d][band] = v
                knob[d][band].value = v
                decks[d].setEQ(band: band, value: v)
            case .filter(let d):
                var v = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / knobTravel)))
                if abs(v - 0.5) < 0.03 { v = 0.5 }
                filterSetting[d] = v
                if d < filterKnob.count { filterKnob[d].value = v }
                decks[d].setFilter(v)
            default:
                break
            }
            grabs[touch] = grab
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { release(touches) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { release(touches) }

    private func release(_ touches: Set<UITouch>) {
        for touch in touches {
            guard let grab = grabs.removeValue(forKey: touch) else { continue }
            switch grab.kind {
            case .platter(let d):
                if !holds(.platter(d)) { decks[d].held = false }
            case .rim(let d):
                if !holds(.rim(d)) && !sync[d] { decks[d].bend = 0 }
            case .needle(let d), .wave(let d):
                if !holds(.needle(d)) && !holds(.wave(d)) { dropNeedle(d) }
            default:
                break
            }
        }
    }

    private func waveProgress(_ p: CGPoint, on d: Int) -> Double {
        let rect = waveRect[d]
        guard rect.width > 0 else { return 0 }
        return Double(min(1, max(0, (p.x - rect.minX) / rect.width)))
    }

    /// The needle comes down where it was carried to. The record never stopped turning.
    private func dropNeedle(_ d: Int) {
        let deck = decks[d]
        if let at = dropAt[d] {
            // Not past the last groove; and at the very start, on the first beat.
            let seconds = min(max(deck.grid.firstBeat, at * deck.duration), max(0, deck.duration - 0.25))
            deck.seek(to: seconds)
            tap.impactOccurred()
        }
        dropAt[d] = nil
        deck.lifted = false
    }

    private func releaseAllHands() {
        grabs = [:]
        for d in 0..<2 {
            decks[d].held = false
            if !sync[d] { decks[d].bend = 0 }
            // A needle left in the air goes back where it was.
            dropAt[d] = nil
            decks[d].lifted = false
        }
    }

    /// CUE as on a club deck: stopped, it marks this spot; playing, it goes back to the mark and stops.
    private func pressCue(_ d: Int) {
        let deck = decks[d]
        if deck.motorOn {
            deck.motorOn = false
            deck.seek(to: deck.cuePoint)
        } else {
            deck.cuePoint = deck.seconds
        }
    }

    private func applyMix() {
        let x = MixMath.crossfade(cross)
        decks[0].volume = MixMath.faderGain(channel[0]) * x.a
        decks[1].volume = MixMath.faderGain(channel[1]) * x.b
        for d in 0..<2 { decks[d].cue = phones[d] }
    }

    // MARK: - Every frame

    override func update(_ currentTime: TimeInterval) {
        if needsBuild {
            needsBuild = false
            build()
        }
        let dt = lastTime > 0 ? min(0.05, max(0.001, currentTime - lastTime)) : 1.0 / 60
        lastTime = currentTime
        if game.demo && !demoStarted && lesson == nil { startDemo() }
        moveHands(dt)
        runSync()
        drivePartner(at: currentTime)
        refresh(dt)
        teach(dt, at: currentTime)
    }

    /// Feeds the lesson what the decks are doing, points at the control it names, and turns the
    /// music down a little while the coach talks.
    private func teach(_ dt: Double, at time: TimeInterval) {
        guard let lesson else { return }
        if !lessonReady {
            lessonReady = true
            lesson.begin()
        }
        // In a lesson a record that runs out starts again, so nobody gets stuck waiting.
        for (d, deck) in decks.enumerated() where deck.motorOn && deck.progress > 0.985 {
            // Back to back: her record never jumps while yours is in the room with it.
            if d == partnerDeck && channel[1 - d] > 0.04 { continue }
            deck.seek(to: deck.cuePoint < deck.duration * 0.9 ? deck.cuePoint : deck.grid.firstBeat)
        }
        lesson.update(BoothFacts(motorOn: decks.map { $0.motorOn },
                                 turning: decks.map { $0.rate > 0.5 },
                                 beat: decks.map { $0.beat },
                                 cross: cross,
                                 channel: channel,
                                 eq: eq,
                                 phonesOn: game.phonesMode != 0,
                                 phones: phones,
                                 cueMix: game.cueMix,
                                 bpm: decks.map { $0.bpm },
                                 phase: MixMath.phaseOffset(decks[0].beat, decks[1].beat),
                                 records: decks.map { $0.info?.id },
                                 sync: sync,
                                 blend: lastReading?.state == .blend,
                                 bassClash: lastReading?.bassClash ?? false,
                                 jingles: game.jingleCount,
                                 time: CACurrentMediaTime(),
                                 filter: filterSetting,
                                 pattern: game.pattern.rows,
                                 page: game.studioPage,
                                 cuts: game.cuts,
                                 stepOns: stepOns))
        let wanted: Float = lesson.speaking || game.jinglePlaying ? 0.5 : 1
        let now = game.engine.masterVolume
        if abs(wanted - now) > 0.002 {
            game.engine.masterVolume = now + (wanted - now) * Float(min(1, dt * 6))
        }

        if lesson.target != pointedAt {
            pointedAt = lesson.target
            pointer?.removeFromParent()
            pointer = nil
            if let target = lesson.target, target != .crate, target != .jingle, let hit = hits.first(where: { $0.kind == kind(for: target) }) {
                let ring = SKShapeNode(rect: hit.rect.insetBy(dx: -2, dy: -2), cornerRadius: 9)
                ring.strokeColor = Palette.orange
                ring.fillColor = .clear
                ring.lineWidth = 2.5
                ring.glowWidth = 2
                ring.zPosition = 30
                addChild(ring)
                pointer = ring
            }
        }
        pointer?.alpha = CGFloat(0.55 + 0.45 * sin(time * 6))
    }

    private func kind(for target: LessonTarget) -> Kind {
        switch target {
        case .play(let d): return .play(d)
        case .cue(let d): return .cue(d)
        case .crossfader: return .cross
        case .channel(let d): return .channel(d)
        case .eq(let d, let band): return .eq(d, band)
        case .phones(let d): return .phones(d)
        case .cueMixKnob: return .cueMix
        case .filter(let d): return .filter(d)
        case .pitch(let d): return .pitch(d)
        case .record(let d): return .platter(d)
        case .sync(let d): return .sync(d)
        case .crate, .jingle: return .cueMix // drawn by SwiftUI (the pill pulses); no ring here
        }
    }

    /// The screenshot run: both records turning, the second one pitched down to match.
    private func startDemo() {
        demoStarted = true
        guard decks[0].isLoaded, decks[1].isLoaded else { return }
        sync[1] = true
        // Needles some way into the records, so the strips show something.
        decks[0].seek(to: decks[0].duration * 0.36)
        decks[1].seek(to: decks[1].duration * 0.12)
        decks[0].motorOn = true
        decks[1].motorOn = true
    }

    private func moveHands(_ dt: Double) {
        for d in 0..<2 {
            if decks[d].held {
                // Clockwise on screen is forwards, and angles grow anticlockwise, hence the minus.
                let speed = -Double(handTravel[d]) / dt / Self.turn
                handTravel[d] = 0
                handSpeed[d] = handSpeed[d] * 0.35 + speed * 0.65
                decks[d].handRate = handSpeed[d]
            }
            if holds(.rim(d)) && !sync[d] {
                let speed = -Double(rimTravel[d]) / dt / Self.turn
                rimTravel[d] = 0
                rimSpeed[d] = rimSpeed[d] * 0.7 + speed * 0.3
                decks[d].bend = max(-0.08, min(0.08, rimSpeed[d] * 0.06))
            }
        }
    }

    /// SYNC: copy the other deck's tempo, then lean on the record until the beats line up.
    private func runSync() {
        for d in 0..<2 where sync[d] {
            let other = decks[1 - d], deck = decks[d]
            guard deck.isLoaded, other.isLoaded else { continue }
            let p = max(-Self.pitchRange, min(Self.pitchRange, MixMath.pitch(toPlay: deck.grid.bpm, at: other.bpm)))
            if abs(p - deck.pitch) > 1e-7 {
                deck.pitch = p
                pitchFader[d] = 0.5 - p / (2 * Self.pitchRange)
                if d < pitchNode.count { pitchNode[d].value = pitchFader[d] }
            }
            if deck.motorOn && !deck.held && !deck.lifted && deck.rate > 0.5 && other.rate > 0.5 {
                let behind = MixMath.phaseOffset(other.beat, deck.beat)
                deck.bend = max(-0.06, min(0.06, behind * 0.8))
            } else if deck.bend != 0 {
                deck.bend = 0
            }
        }
    }

    // MARK: - Back to back

    /// Her deck is hers all lesson (PHONES aside: cueing her in your headphones is fine); the
    /// crossfader is hers too while her record is on.
    private func partnerHolds(_ kind: Kind) -> Bool {
        guard let h = partnerDeck else { return false }
        switch kind {
        case .platter(let d), .rim(let d), .pitch(let d), .channel(let d), .play(let d), .cue(let d),
             .sync(let d), .needle(let d), .wave(let d), .filter(let d):
            return d == h
        case .eq(let d, _):
            return d == h
        case .cross:
            return channel[h] > 0.04
        case .phones, .cueMix:
            return false
        }
    }

    /// A hand on the other DJ's deck: refused, with a buzz, and counted (the lesson says so).
    private func stepOn() {
        stepOns += 1
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    /// The crate asks before putting a record on a deck: never on hers (that counts as a step-on).
    func refuseLoad(on d: Int) -> Bool {
        guard d == partnerDeck else { return false }
        stepOn()
        return true
    }

    /// She plays her own deck. Your answer: once your record is up she takes her low out at her
    /// next phrase, waits for yours to come in, fades her record out over four bars and stops it.
    /// Her answer (a night, with records in her bag): after your record has been on alone for a
    /// while she puts on one that fits it, at your tempo at once (her pitch fader, not SYNC: with
    /// your SYNC on, your record follows hers, so hers must never jump), drops the needle at your
    /// place in the phrase a spin-up ahead, trims the phase while her fader is down, brings her
    /// fader up over your next phrase with her low out, then her low in: your turn to take
    /// yours out.
    private func drivePartner(at time: Double) {
        guard let h = partnerDeck, h < 2 else { return }
        let her = decks[h], you = 1 - h
        let beat = her.beat, yours = decks[you].beat
        switch partnerMove {
        case .on(let armed):
            if !armed {
                if channel[you] <= 0.04 { partnerMove = .on(armed: true) }
            } else if her.rate > 0.5 && decks[you].rate > 0.5 && channel[you] >= 0.8 {
                partnerMove = .waiting(phrase: (beat / Lessons.phrase).rounded(.down))
            }
        case .waiting(let phrase):
            if (beat / Lessons.phrase).rounded(.down) > phrase { partnerMove = .cutting(from: beat) }
        case .cutting(let from):
            setPartnerLow(0.5 * (1 - min(1, max(0, (beat - from) / 2))), on: h)
            if beat - from >= 2 { partnerMove = .swapped(since: beat) }
        case .swapped(let since):
            if eq[you][0] >= 0.45 || beat - since >= 8 { partnerMove = .fading(from: beat, level: channel[h]) }
        case .fading(let from, let level):
            let t = min(1, max(0, (beat - from) / 16))
            setPartnerFader(level * (1 - t), on: h)
            if t >= 1 {
                her.motorOn = false
                partnerMove = .out(since: time)
            }
        case .out(let since):
            guard !partnerBag.isEmpty else { break }
            // Your record has to be on air by itself for a while before she answers it.
            if !(decks[you].rate > 0.5 && channel[you] >= 0.5) {
                partnerMove = .out(since: time)
            } else if time - since >= 35, let track = partnerPick() {
                game.load(track, on: her)
                partnerPlayed.insert(track.id)
                recordChanged(on: h)
                setPartnerLow(0, on: h)
                setPartnerFader(0, on: h)
                sync[h] = false
                partnerMatchTempo(h)
                // A phrase past her intro, where your record is in its phrase, plus the 0.05 s the
                // platter takes to come up to speed.
                var into = yours.truncatingRemainder(dividingBy: Lessons.phrase)
                if into < 0 { into += Lessons.phrase }
                her.seek(to: her.grid.seconds(atBeat: Lessons.phrase + into + 0.05 * her.bpm / 60))
                her.motorOn = true
                partnerTrimAt = time + 0.3
                partnerAnswers += 1
                partnerMove = .ready(phrase: (yours / Lessons.phrase).rounded(.down))
            }
        case .ready(let phrase):
            partnerMatchTempo(h)
            // Her fader is down: a small slip is put right by moving the needle (now and then,
            // so a move has landed before the next is measured).
            let slip = MixMath.phaseOffset(yours, beat)
            if time >= partnerTrimAt && her.rate > 0.9 && abs(slip) > 0.01 {
                her.seek(to: her.grid.seconds(atBeat: beat + slip))
                partnerTrimAt = time + 0.3
            }
            if (yours / Lessons.phrase).rounded(.down) > phrase { partnerMove = .rising(from: yours) }
        case .rising(let from):
            partnerMatchTempo(h)
            let t = min(1, max(0, (yours - from) / Lessons.phrase))
            setPartnerFader(0.85 * t, on: h)
            if t >= 1 { partnerMove = .bassing(from: beat) }
        case .bassing(let from):
            partnerMatchTempo(h)
            setPartnerLow(0.5 * min(1, max(0, (beat - from) / 2)), on: h)
            if beat - from >= 2 { partnerMove = .on(armed: false) }
        }
    }

    /// She rides her pitch fader to your tempo (with your SYNC on, yours follows hers: no change).
    private func partnerMatchTempo(_ h: Int) {
        let her = decks[h], you = decks[1 - h]
        guard her.isLoaded, you.isLoaded else { return }
        let p = max(-Self.pitchRange, min(Self.pitchRange, MixMath.pitch(toPlay: her.grid.bpm, at: you.bpm)))
        guard abs(p - her.pitch) > 1e-7 else { return }
        her.pitch = p
        pitchFader[h] = 0.5 - p / (2 * Self.pitchRange)
        if h < pitchNode.count { pitchNode[h].value = pitchFader[h] }
    }

    /// Her answer: a record from her bag she has not played, in a key that fits yours and close
    /// to your tempo (no key lock: her pitch fader moves its key too); failing that, any that fits.
    private func partnerPick() -> TrackInfo? {
        guard let h = partnerDeck else { return nil }
        let yours = decks[1 - h].info
        let tempo = decks[1 - h].bpm
        let open = partnerBag.filter { !partnerPlayed.contains($0) && $0 != yours?.id }
            .compactMap { id in game.tracks.first { $0.id == id } }
        let fits = open.filter { Harmony.compatible($0.camelot, yours?.camelot ?? $0.camelot) }
        return fits.first { abs($0.bpm - tempo) <= 2.1 } ?? fits.first
    }

    private func setPartnerLow(_ v: Double, on h: Int) {
        eq[h][0] = v
        if h < knob.count, !knob[h].isEmpty { knob[h][0].value = v }
        decks[h].setEQ(band: 0, value: v)
    }

    private func setPartnerFader(_ v: Double, on h: Int) {
        channel[h] = v
        if h < channelNode.count { channelNode[h].value = v }
        applyMix()
    }

    private func clock(_ seconds: Double) -> String {
        let whole = Int(max(0, seconds))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    private func refresh(_ dt: Double) {
        guard record.count == 2, meter.count == 2, beatDots.count == 2, wavePlayhead.count == 2, timeLabel.count == 2 else { return }
        var snapshots: [DeckSnapshot] = []
        let fade = MixMath.crossfade(cross)
        for d in 0..<2 {
            let deck = decks[d]
            let seconds = deck.seconds
            record[d].zRotation = CGFloat(-seconds * Self.turn)
            // The needle rides from the outer groove to the label as the record plays; in the air
            // it follows the hand.
            let needle = platterRadius * CGFloat(0.93 - 0.5 * (dropAt[d] ?? deck.progress))
            arm[d].zRotation = armPivotAngle + 2 * asin(min(1, needle / (2 * armLength)))
            arm[d].setScale(deck.lifted ? 1.05 : 1)

            // The strip: played part darker, a line at the needle, the cue mark, and the landing spot.
            let strip = waveRect[d]
            let at = strip.minX + strip.width * CGFloat(deck.progress)
            wavePlayhead[d].position.x = at
            wavePlayed[d].size.width = max(0.5, at - strip.minX)
            waveCue[d].position.x = strip.minX + strip.width * CGFloat(deck.duration > 0 ? deck.cuePoint / deck.duration : 0)
            waveCue[d].isHidden = !deck.isLoaded
            if let drop = dropAt[d] {
                waveDrop[d].isHidden = false
                waveDrop[d].position.x = strip.minX + strip.width * CGFloat(drop)
                timeLabel[d].text = clock(drop * deck.duration)
                timeLabel[d].fontColor = Palette.ink
            } else {
                waveDrop[d].isHidden = true
                timeLabel[d].text = deck.isLoaded ? "-" + clock(max(0, deck.duration - seconds)) : ""
                timeLabel[d].fontColor = Palette.dim
            }

            let moving = abs(deck.rate) > 0.3
            let beatNow = deck.grid.beatInBar(at: seconds)
            let flash = 1 - deck.grid.phase(at: seconds)
            for (i, dot) in beatDots[d].enumerated() {
                dot.alpha = moving && i == beatNow ? CGFloat(0.35 + 0.65 * flash) : 0.15
            }

            meterLevel[d] = max(Double(deck.takePeak()), meterLevel[d] - dt * 1.6)
            meter[d].level = min(1, meterLevel[d] * 1.15)

            bpmLabel[d].text = deck.isLoaded ? String(format: "%.1f", deck.bpm) : "---.-"
            pitchLabel[d].text = String(format: "%+.1f%%", deck.pitch * 100)
            playButton[d].lit = deck.motorOn
            syncButton[d].lit = sync[d]
            syncButton[d].alpha = syncAllowed ? 1 : 0.25
            if d < phonesButton.count { phonesButton[d].lit = phones[d] }
            // The knob follows the slider in the headphone panel.
            if let knob = cueMixKnob, knob.value != game.cueMix { knob.value = game.cueMix }
            cueButton[d].lit = !deck.motorOn && abs(seconds - deck.cuePoint) < 0.02

            let heardGain = deck.lifted ? 0 : MixMath.faderGain(channel[d]) * (d == 0 ? fade.a : fade.b)
            snapshots.append(DeckSnapshot(playing: moving,
                                          gain: heardGain,
                                          bpm: deck.bpm, beat: deck.beat, low: eq[d][0]))
        }

        let reading = MixJudge.read(snapshots[0], snapshots[1])
        lastReading = reading
        verdict?.text = reading.verdict
        let colour: UIColor
        switch reading.state {
        case .blend: colour = reading.quality > 0.85 ? Palette.teal : (reading.quality > 0.3 ? Palette.orange : Palette.red)
        default: colour = Palette.dim
        }
        verdict?.fontColor = colour

        // The dot shows where deck B's beat falls against deck A's, whenever both records turn.
        if let dot = phaseDot {
            let bothTurn = snapshots[0].playing && snapshots[1].playing
            let offset = bothTurn ? MixMath.phaseOffset(snapshots[0].beat, snapshots[1].beat) : 0
            let centreX = verdict?.position.x ?? dot.position.x
            dot.position.x = centreX - CGFloat(offset) * phaseWidth
            dot.fillColor = bothTurn ? (abs(offset) < 0.03 ? Palette.teal : Palette.orange) : Palette.dim
        }

        // The room: darker when nothing plays, a warm pulse on every beat of the loudest deck.
        let lead = snapshots[0].gain >= snapshots[1].gain ? 0 : 1
        let heard = snapshots[lead].audible
        if let shade = roomShade {
            let wanted: CGFloat = heard ? 0.06 : 0.45
            shade.alpha += (wanted - shade.alpha) * CGFloat(min(1, dt * 3))
        }
        if let glow = roomGlow {
            let phase = decks[lead].grid.phase(at: decks[lead].seconds)
            glow.alpha = heard ? CGFloat(0.12 * exp(-phase * 5)) : 0
        }
        if let night {
            // A night: the crowd answers the mixing, and the room shows its mood.
            // The record on air is the one that is heard; with both heard, the louder one.
            let onAir = snapshots[0].audible ? (snapshots[1].audible ? lead : 0) : 1
            // A scratched record: the needle falls back into the same groove, one turn of the
            // platter (1.8 s at 33 rpm), until it is picked up and moved on or the deck is stopped.
            if let s = stuck {
                let deck = decks[s.deck]
                if deck.lifted || !deck.motorOn {
                    stuck = nil
                } else if deck.seconds >= s.from + 1.8 || deck.seconds < s.from - 0.5 {
                    deck.seek(to: s.from)
                }
            }
            // A slipping belt: the deck's speed drifts slowly around where its pitch fader says.
            if let w = wander, !sync[w.deck] {
                let t = CACurrentMediaTime() - w.since
                let drift = 0.0035 * sin(t * 2 * .pi / 23) + 0.002 * sin(t * 2 * .pi / 7.3)
                decks[w.deck].pitch = (0.5 - pitchFader[w.deck]) * 2 * Self.pitchRange + drift
            }
            // Two records heard together in keys that fight (or pitched apart: no key lock).
            var keyClash = false
            if nightInfo?.judgeKeys == true, reading.state == .blend,
               let a = decks[0].info?.camelot, let b = decks[1].info?.camelot {
                keyClash = Harmony.clash(a, pitch: decks[0].pitch, b, pitch: decks[1].pitch)
            }
            night.update(dt: dt, state: reading.state, quality: reading.quality, bassClash: reading.bassClash, lead: onAir,
                         onAirRecord: reading.state == .silence ? nil : decks[onAir].info?.id, channel: channel,
                         jingles: game.jingleCount, beat: decks[onAir].beat,
                         stuck: stuck.map { snapshots[$0.deck].audible } ?? false, keyClash: keyClash,
                         onAirBPM: decks[onAir].bpm, lowOnAir: eq[onAir][0],
                         stepOns: stepOns, partnerAnswers: partnerAnswers)
            // Things go wrong: somebody kicks the cable and the record on air stops.
            if night.takeMishap() {
                switch nightInfo?.mishap ?? .cable {
                case .needleSkip:
                    // The needle jumps a groove: the record lands a little ahead of the beat.
                    let deck = decks[onAir]
                    deck.seek(to: deck.seconds + 0.4 * deck.grid.beatLength)
                case .stuckGroove:
                    stuck = (onAir, decks[onAir].seconds)
                case .powerCut:
                    // Everything stops; the power is back a moment later and the room waits.
                    for deck in decks { deck.motorOn = false }
                case .pitchWander:
                    wander = (onAir, CACurrentMediaTime())
                default:
                    decks[onAir].motorOn = false
                }
            }
            // The music steps back a little while Tó talks, as in the lessons.
            let wanted: Float = night.speaking || game.jinglePlaying ? 0.5 : 1
            let level = game.engine.masterVolume
            if abs(wanted - level) > 0.002 {
                game.engine.masterVolume = level + (wanted - level) * Float(min(1, dt * 6))
            }
            showRoom(night.mood, dt)
        } else {
            // Otherwise the friends dance while there is music and stop where they are when it goes quiet.
            showRoom(heard ? 2 : -1, dt)
        }

        if let status {
            status.text = game.engine.running ? "" : "AUDIO OFF  \(game.engine.lastError ?? "")"
        }
    }
}
