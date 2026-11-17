import SwiftUI
import HeadlinerCore

// A night: you play for a room and the room answers. No coach, no steps. The crowd's energy
// rises with a fresh record and a clean blend, sags when a record has been on too long, and
// drops fast on a train wreck or dead air. The friends in the room change with it and say
// what they think. The night ends on the clock; the stars are for the whole night.

/// The nights there are.
struct NightInfo {
    var id: String
    var title: String
    /// Seconds of play.
    var length: Double
}

enum Nights {
    static let firstParty = NightInfo(id: "first-party", title: "FIRST PARTY", length: 270)
    static let all = [firstParty]
    static func find(_ id: String) -> NightInfo? { all.first { $0.id == id } }
}

final class NightRunner: ObservableObject {
    let title: String
    /// Seconds of play, from the first record to the end of the night.
    let length: Double

    @Published private(set) var energyShown = 0.3
    /// 0 waiting, 1 nodding, 2 dancing, 3 going nuts.
    @Published private(set) var mood = 0
    @Published private(set) var clock = "23:00"
    @Published private(set) var comment = ""
    @Published private(set) var commentBy = ""
    /// Set when the night is over: 1 to 3.
    @Published private(set) var stars: Int?
    private(set) var summary = ""

    private var energy = 0.3
    private var began = false
    private var now = 0.0
    private var elapsed = 0.0
    private var energySum = 0.0
    private var onAir: Int?
    private var soloAge = 0.0
    private var toldStale = false
    private var blendTime = 0.0
    private var blendQuality = 0.0
    private var transitions = 0
    private var deadAir = 0.0
    private var deadAirRun = 0.0
    private var wreck = 0.0
    private var clashRun = 0.0
    private var driftRun = 0.0
    private var commentUntil = 0.0
    private var quietUntil = 0.0
    private var shownAt = -1.0

    static let moods = ["WAITING", "NODDING", "DANCING", "GOING NUTS"]

    init(title: String, length: Double) {
        self.title = title
        self.length = length
    }

    private func say(_ who: String, _ words: String) {
        guard now >= quietUntil else { return }
        commentBy = who
        comment = words
        commentUntil = now + 4
        quietUntil = now + 8
    }

    /// Called every frame with what the room hears: nothing, one record, or two, and for two,
    /// how well they sit together. `lead` is the louder deck.
    func update(dt: Double, state: MixReading.State, quality: Double, bassClash: Bool, lead: Int) {
        guard stars == nil else { return }
        now += dt
        if !comment.isEmpty && now > commentUntil { comment = "" }
        if !began {
            if state == .silence {
                if now > 5 { say("TÓ", "Whenever you're ready. Press play.") }
                return
            }
            began = true
            say("SARA", "Finally!")
        }
        elapsed += dt

        var rate = 0.0
        switch state {
        case .silence:
            rate = -0.12
            deadAir += dt
            deadAirRun += dt
            blendTime = 0
            blendQuality = 0
            if deadAirRun > 1.5 { say("MIRA", "Is it broken?") }
        case .solo:
            deadAirRun = 0
            clashRun = 0
            driftRun = 0
            if let was = onAir, was != lead {
                // The other record has taken over.
                transitions += 1
                soloAge = 0
                toldStale = false
                let clean = blendTime >= 4 && blendQuality / max(0.01, blendTime) >= 0.6
                energy += clean ? 0.1 : 0.02
                if clean { say("SARA", "Ooh, I love this one!") } else { say("TÓ", "Rough landing. But we're in.") }
            }
            blendTime = 0
            blendQuality = 0
            onAir = lead
            soloAge += dt
            if soloAge >= 80 {
                rate = -0.012 // they have heard this one
                if soloAge > 100 && !toldStale {
                    toldStale = true
                    say("TÓ", "They know this one by heart now. Next record.")
                }
            } else {
                rate = energy < 0.6 ? 0.008 : -0.004 // one record gets a room dancing, not screaming
            }
        case .blend:
            deadAirRun = 0
            blendTime += dt
            blendQuality += quality * dt
            if quality > 0.85 {
                rate = 0.012
                driftRun = 0
            } else if quality > 0.6 {
                rate = 0.004
                driftRun = 0
            } else if quality > 0.3 {
                rate = -0.03
                driftRun += dt
                if driftRun > 3 { say("TÓ", "It's slipping. Nudge it back.") }
            } else {
                rate = -0.09
                wreck += dt
                say("MIRA", "Ouch.")
            }
            if bassClash {
                clashRun += dt
                if clashRun > 6 { say("TÓ", "Two basslines. Kill one of the lows.") }
            } else {
                clashRun = 0
            }
        }
        energy = min(1, max(0, energy + rate * dt))
        energySum += energy * dt

        // The mood follows the energy, with a little slack so it does not flicker at an edge.
        let edges = [0.22, 0.5, 0.78]
        var level = mood
        while level < 3 && energy > edges[level] + 0.03 { level += 1 }
        while level > 0 && energy < edges[level - 1] - 0.03 { level -= 1 }
        if level != mood {
            if level == 3 { say("SARA", "THIS ONE!") }
            mood = level
        }

        if elapsed - shownAt >= 0.25 {
            shownAt = elapsed
            energyShown = energy
            // The night runs from eleven to half past midnight.
            let minutes = 23 * 60 + Int(min(1, elapsed / length) * 90)
            let text = String(format: "%02d:%02d", (minutes / 60) % 24, minutes % 60)
            if text != clock { clock = text }
        }
        if elapsed >= length { finish() }
    }

    private func finish() {
        let crowd = energySum / max(1, elapsed)
        let earned: Int
        if crowd >= 0.6 && transitions >= 2 && deadAir < 3 && wreck < 4 {
            earned = 3
        } else if crowd >= 0.42 && transitions >= 1 {
            earned = 2
        } else {
            earned = 1
        }
        let mixes = transitions == 1 ? "1 mix" : "\(transitions) mixes"
        summary = "\(mixes)   ·   crowd \(Int((crowd * 100).rounded())) %   ·   dead air \(Int(deadAir.rounded())) s"
        comment = ""
        stars = earned
    }
}

/// What a night shows over the room: the clock and the crowd's energy on top, what a friend
/// just said above the gear, and the result at the end.
struct NightOverlay: View {
    @ObservedObject var runner: NightRunner
    let roomHeight: CGFloat
    let onContinue: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            if let stars = runner.stars {
                result(stars)
            } else {
                VStack(spacing: 0) {
                    meter
                    Spacer(minLength: 4)
                    if !runner.comment.isEmpty { words }
                }
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .frame(height: max(60, roomHeight))
                .allowsHitTesting(false)
                .animation(.easeOut(duration: 0.2), value: runner.comment)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var meter: some View {
        let tint = [Color.white.opacity(0.6), GroovelineLogo.teal, Color(Palette.orange), Color(Palette.magenta)][min(3, max(0, runner.mood))]
        return HStack(spacing: 10) {
            Text(runner.clock)
                .font(.system(size: 12, weight: .heavy).monospacedDigit())
                .foregroundStyle(.white)
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.15))
                Capsule().fill(tint).frame(width: max(6, 150 * runner.energyShown))
            }
            .frame(width: 150, height: 7)
            .animation(.linear(duration: 0.25), value: runner.energyShown)
            Text(NightRunner.moods[min(3, max(0, runner.mood))])
                .font(.system(size: 10, weight: .heavy))
                .tracking(2)
                .foregroundStyle(tint)
                .frame(width: 86, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(Capsule().fill(.black.opacity(0.72)))
    }

    private var words: some View {
        HStack(spacing: 8) {
            Text(runner.commentBy)
                .font(.system(size: 10, weight: .heavy))
                .tracking(3)
                .foregroundStyle(GroovelineLogo.teal)
            Text(runner.comment)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(Capsule().fill(.black.opacity(0.66)))
    }

    private func result(_ stars: Int) -> some View {
        VStack(spacing: 10) {
            Text("THE NIGHT IS OVER")
                .font(.system(size: 12, weight: .heavy))
                .tracking(5)
                .foregroundStyle(GroovelineLogo.teal)
            Text(runner.title)
                .font(.custom("Orbitron-Black", size: 38))
                .tracking(3)
                .foregroundStyle(.white)
            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    Image(systemName: i < stars ? "star.fill" : "star")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(i < stars ? Color(Palette.orange) : .white.opacity(0.3))
                }
            }
            Text(runner.summary)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.75))
            Button(action: onContinue) {
                Text("CONTINUE")
                    .font(.system(size: 15, weight: .heavy))
                    .tracking(5)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 40)
                    .padding(.vertical, 12)
                    .background(Capsule().fill(GroovelineLogo.teal))
            }
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.72).ignoresSafeArea())
    }
}
