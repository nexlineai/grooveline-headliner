import SpriteKit
import SwiftUI
import HeadlinerCore
import HeadlinerAudio

/// The booth: the room on top, two turntables and a mixer below.
/// The settings (fader positions and so on) live here, apart from the nodes, so the gear can be
/// rebuilt for a new screen size without losing anything.
final class BoothScene: SKScene {
    private enum Kind: Equatable {
        case platter(Int), rim(Int), pitch(Int), channel(Int), cross, eq(Int, Int), play(Int), cue(Int), sync(Int)
    }

    private struct Grab {
        var kind: Kind
        var start: CGPoint
        var startValue: Double
        var angle: CGFloat = 0
    }

    /// Radians per second of a record at 33⅓ rpm.
    private static let turn = 2 * Double.pi * (100.0 / 3.0) / 60
    /// The pitch fader covers ±8 %, like a classic turntable.
    private static let pitchRange = 0.08

    private let game: Game
    private var decks: [Deck] { game.engine.decks }

    var insets = EdgeInsets() { didSet { if insets != oldValue { needsBuild = true } } }

    // Settings.
    private var pitchFader = [0.5, 0.5]      // 1 = top = slower, as on a turntable
    private var channel = [0.85, 0.85]
    private var cross = 0.5
    private var eq = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]] // per deck: low, mid, high
    private var sync = [false, false]

    // Hands.
    private var grabs: [UITouch: Grab] = [:]
    private var handTravel: [CGFloat] = [0, 0]
    private var handSpeed = [0.0, 0.0]
    private var rimTravel: [CGFloat] = [0, 0]
    private var rimSpeed = [0.0, 0.0]

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

    private var record: [SKSpriteNode] = []
    private var arm: [SKNode] = []
    private var pitchNode: [FaderNode] = []
    private var channelNode: [FaderNode] = []
    private var crossNode: FaderNode?
    private var knob: [[KnobNode]] = []
    private var playButton: [ButtonNode] = []
    private var cueButton: [ButtonNode] = []
    private var syncButton: [ButtonNode] = []
    private var meter: [MeterNode] = []
    private var meterLevel = [0.0, 0.0]
    private var bpmLabel: [SKLabelNode] = []
    private var pitchLabel: [SKLabelNode] = []
    private var beatDots: [[SKShapeNode]] = []
    private var verdict: SKLabelNode?
    private var phaseDot: SKShapeNode?
    private var roomGlow: SKSpriteNode?
    private var roomShade: SKSpriteNode?
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
        applyMix()
    }

    override func didChangeSize(_ oldSize: CGSize) {
        needsBuild = true
    }

    // MARK: - Building the gear

    private func build() {
        removeAllChildren()
        releaseAllHands()
        hits = []
        record = []; arm = []; pitchNode = []; channelNode = []; knob = []
        playButton = []; cueButton = []; syncButton = []; meter = []
        bpmLabel = []; pitchLabel = []; beatDots = []

        let W = size.width, H = size.height
        guard W > 200, H > 200 else { return }
        let left = max(insets.leading, 10), right = max(insets.trailing, 10), bottom = max(insets.bottom, 8)
        let gearTop = H * 0.62
        let gx0 = left, gy0 = bottom
        let gw = W - left - right, gh = gearTop - 6 - bottom
        let u = gh / 210
        let gap = 8 * u
        let mixerW = min(gw * 0.31, 224 * u)
        let deckW = (gw - mixerW - gap * 2) / 2

        buildRoom(CGRect(x: 0, y: gearTop, width: W, height: H - gearTop))

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

    private func buildRoom(_ rect: CGRect) {
        if let image = Art.image("room-bedroom") {
            let whole = SKTexture(image: image)
            // Show the widest band of the picture that fills the strip; the faces sit a little above the middle.
            let pictureAspect = image.size.width / image.size.height
            let band = min(1, pictureAspect / (rect.width / rect.height))
            let y = min(1 - band, max(0, 0.60 - band / 2))
            let room = SKSpriteNode(texture: SKTexture(rect: CGRect(x: 0, y: y, width: 1, height: band), in: whole))
            room.size = rect.size
            room.position = CGPoint(x: rect.midX, y: rect.midY)
            room.zPosition = -10
            addChild(room)
        }
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
        let lip = SKSpriteNode(color: Palette.teal.withAlphaComponent(0.5), size: CGSize(width: rect.width, height: 1))
        lip.position = CGPoint(x: rect.midX, y: rect.minY)
        lip.zPosition = -7
        addChild(lip)
    }

    private func buildDeck(_ d: Int, in rect: CGRect, unit u: CGFloat) {
        let tint = d == 0 ? Palette.teal : Palette.magenta
        addChild(panel(rect, radius: 10 * u))

        // Platter: as big as the panel allows, with a title row above and buttons below.
        let outer = min((rect.height - 56 * u) / 2, (rect.width - 86 * u) / 2)
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
        armLength = hypot(pivot.x - centre.x, pivot.y - centre.y)
        armPivotAngle = atan2(centre.y - pivot.y, centre.x - pivot.x)
        let tonearm = makeTonearm(length: armLength, unit: u)
        tonearm.position = pivot
        tonearm.zPosition = 3
        addChild(tonearm)
        arm.append(tonearm)

        // Title, and four lamps that count the bar.
        let info = decks[d].info
        let title = gearLabel(info.map { "\($0.artist.uppercased())  ·  \($0.title.uppercased())" } ?? "NO RECORD", size: 9.5 * u, color: Palette.ink)
        title.horizontalAlignmentMode = .left
        title.position = CGPoint(x: rect.minX + 10 * u, y: rect.maxY - 11 * u)
        addChild(title)
        var dots: [SKShapeNode] = []
        for i in 0..<4 {
            let dot = SKShapeNode(circleOfRadius: 3 * u)
            dot.fillColor = tint
            dot.strokeColor = .clear
            dot.alpha = 0.15
            let dotX = rect.maxX - 52 * u - CGFloat(3 - i) * 10 * u
            dot.position = CGPoint(x: dotX, y: rect.maxY - 11 * u)
            addChild(dot)
            dots.append(dot)
        }
        beatDots.append(dots)

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

    private func buildMixer(in rect: CGRect, unit u: CGFloat) {
        addChild(panel(rect, radius: 10 * u))
        let tints = [Palette.teal, Palette.magenta]

        // Top: both tempos, the verdict, and how far apart the beats are.
        for d in 0..<2 {
            let label = gearLabel("---.-", size: 14 * u, color: tints[d], mono: true)
            label.position = CGPoint(x: d == 0 ? rect.minX + 32 * u : rect.maxX - 32 * u, y: rect.maxY - 15 * u)
            addChild(label)
            bpmLabel.append(label)
        }
        let word = gearLabel("", size: 11.5 * u, color: Palette.dim)
        word.position = CGPoint(x: rect.midX, y: rect.maxY - 13 * u)
        addChild(word)
        verdict = word
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
            hits.insert((Kind.channel(d), centred(fx, fader.position.y, 40 * u, channelTravel + 28 * u)), at: 0)

            let lights = MeterNode(size: CGSize(width: 7 * u, height: 96 * u))
            let side: CGFloat = d == 0 ? -9 : 9
            lights.position = CGPoint(x: rect.midX + side * u, y: rect.minY + 110 * u)
            addChild(lights)
            meter.append(lights)
        }

        // Crossfader.
        crossTravel = min(112 * u, rect.width * 0.55)
        let fader = FaderNode(travel: crossTravel, vertical: false, cap: CGSize(width: 14 * u, height: 24 * u), tint: Palette.teal, centreMark: true)
        fader.position = CGPoint(x: rect.midX, y: rect.minY + 24 * u)
        fader.value = cross
        fader.zPosition = 4
        addChild(fader)
        crossNode = fader
        hits.insert((Kind.cross, centred(rect.midX, fader.position.y, crossTravel + 36 * u, 40 * u)), at: 0)
    }

    // MARK: - Hands

    private func control(at p: CGPoint) -> Kind? {
        for hit in hits where hit.rect.contains(p) {
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
            case .play(let d):
                tap.impactOccurred()
                if !decks[d].motorOn && decks[d].progress > 0.995 { decks[d].seek(to: decks[d].cuePoint) }
                decks[d].motorOn.toggle()
            case .cue(let d):
                tap.impactOccurred()
                pressCue(d)
            case .sync(let d):
                tap.impactOccurred()
                sync[d].toggle()
                if !sync[d] { decks[d].bend = 0 }
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
            case .pitch(let d):
                var v = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / pitchTravel)))
                if abs(v - 0.5) < 0.012 {
                    if pitchFader[d] != 0.5 { detent.selectionChanged() }
                    v = 0.5
                }
                pitchFader[d] = v
                pitchNode[d].value = v
                if sync[d] { sync[d] = false; decks[d].bend = 0 } // touching the pitch takes over from sync
                decks[d].pitch = (0.5 - v) * 2 * Self.pitchRange
            case .channel(let d):
                channel[d] = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / channelTravel)))
                channelNode[d].value = channel[d]
                applyMix()
            case .cross:
                cross = min(1, max(0, grab.startValue + Double((p.x - grab.start.x) / crossTravel)))
                crossNode?.value = cross
                applyMix()
            case .eq(let d, let band):
                var v = min(1, max(0, grab.startValue + Double((p.y - grab.start.y) / knobTravel)))
                if abs(v - 0.5) < 0.03 { v = 0.5 }
                eq[d][band] = v
                knob[d][band].value = v
                decks[d].setEQ(band: band, value: v)
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
            default:
                break
            }
        }
    }

    private func releaseAllHands() {
        grabs = [:]
        for d in 0..<2 {
            decks[d].held = false
            if !sync[d] { decks[d].bend = 0 }
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
    }

    // MARK: - Every frame

    override func update(_ currentTime: TimeInterval) {
        if needsBuild {
            needsBuild = false
            build()
        }
        let dt = lastTime > 0 ? min(0.05, max(0.001, currentTime - lastTime)) : 1.0 / 60
        lastTime = currentTime
        if game.demo && !demoStarted { startDemo() }
        moveHands(dt)
        runSync()
        refresh(dt)
    }

    /// The screenshot run: both records turning, the second one pitched down to match.
    private func startDemo() {
        demoStarted = true
        guard decks[0].isLoaded, decks[1].isLoaded else { return }
        sync[1] = true
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
            if deck.motorOn && !deck.held && deck.rate > 0.5 && other.rate > 0.5 {
                let behind = MixMath.phaseOffset(other.beat, deck.beat)
                deck.bend = max(-0.06, min(0.06, behind * 0.8))
            } else if deck.bend != 0 {
                deck.bend = 0
            }
        }
    }

    private func refresh(_ dt: Double) {
        guard record.count == 2, meter.count == 2, beatDots.count == 2 else { return }
        var snapshots: [DeckSnapshot] = []
        let fade = MixMath.crossfade(cross)
        for d in 0..<2 {
            let deck = decks[d]
            let seconds = deck.seconds
            record[d].zRotation = CGFloat(-seconds * Self.turn)
            // The needle rides from the outer groove to the label as the record plays.
            let needle = platterRadius * CGFloat(0.93 - 0.5 * deck.progress)
            arm[d].zRotation = armPivotAngle + 2 * asin(min(1, needle / (2 * armLength)))

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
            cueButton[d].lit = !deck.motorOn && abs(seconds - deck.cuePoint) < 0.02

            snapshots.append(DeckSnapshot(playing: moving,
                                          gain: MixMath.faderGain(channel[d]) * (d == 0 ? fade.a : fade.b),
                                          bpm: deck.bpm, beat: deck.beat, low: eq[d][0]))
        }

        let reading = MixJudge.read(snapshots[0], snapshots[1])
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
            glow.alpha = heard ? CGFloat(0.16 * exp(-phase * 5)) : 0
        }

        if let status {
            status.text = game.engine.running ? "" : "AUDIO OFF  \(game.engine.lastError ?? "")"
        }
    }
}
