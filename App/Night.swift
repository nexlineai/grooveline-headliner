import AVFoundation
import SwiftUI
import HeadlinerCore

// A night: you play for a room and the room answers. No coach, no steps. The crowd's energy
// rises with a fresh record and a clean blend, sags when a record has been on too long, and
// drops fast on a train wreck or dead air. The friends in the room change with it, and Tó says
// what is happening (voice-over, `App/Lessons/night-*.m4a`; he is the one voice that never
// appears on camera). The night ends on the clock; the stars are for the whole night.

/// The nights there are.
struct NightInfo {
    var id: String
    var title: String
    /// Seconds of play.
    var length: Double
    /// The room above the gear, and the records on the decks at the start (nil: the first two).
    var room = "bedroom"
    var records: [String]? = nil
    /// The crate holds the records of this chapter and the ones before.
    var chapter = 1
    /// Mixes needed for three stars.
    var mixesFor3Stars = 1
    /// What the room asks for, and when (share of the night): the record, Tó's line.
    var requests: [NightRequest] = []
    /// When something goes wrong (share of the night), if it does, and what.
    var mishapAt: Double? = nil
    var mishap = Mishap.cable
    /// False on vinyl nights: no SYNC.
    var syncAllowed = true
    /// The most the room can get going: 3 = going nuts; a pub with six people stops at 2.
    var maxMood = 3
    /// When the owner asks to turn it down (share of the night): the on-air fader must come down.
    var turnDownAt: Double? = nil
    /// Things the coach just says at a moment of the night (share, moment of `lines`).
    var remarks: [(at: Double, moment: String)] = []
    /// A room, or radio listeners (the meter shows their number).
    var audience = Audience.room
    /// Who comments, and lines of this night that replace the general ones (by moment).
    var coach = "TÓ"
    var lines: [String: [(voice: String, text: String)]] = [:]
    /// The records you brought (ids): the crate shows only these. nil = the whole chapter.
    var bag: [String]? = nil
    /// Records too big for this slot: one of them on air costs the third star (a warm-up).
    var hot: [String] = []
    /// Where the clock starts (minutes after midnight of the evening before); the night shows 90 minutes.
    var clockStart = 23 * 60
    /// Blends in keys that fight (or pitched apart) drain the room (`Harmony.clash`).
    var judgeKeys = false
    /// An afterhours: the tempo on air must end at or below this, and must not drop more than
    /// 2 BPM within 2 seconds (the room feels the brakes).
    var endBPM: Double? = nil
}

/// What goes wrong in a night: the cable is kicked (the record stops), the needle jumps a groove,
/// the stream drops, a scratched record sticks in one groove until the needle is moved on, or the
/// power goes (both decks stop; a few seconds of silence are nobody's fault).
enum Mishap { case cable, needleSkip, streamDrop, stuckGroove, powerCut }

/// Who the night is for: a room of people, or listeners on the stream.
enum Audience { case room, listeners }

struct NightRequest {
    var at: Double
    var record: String
    var voice: String
    var text: String
}

enum Nights {
    static let firstParty = NightInfo(id: "first-party", title: "FIRST PARTY", length: 270)
    /// Chapter 2: Rita's garage. Two requests, and the cable.
    static let garageParty = NightInfo(id: "garage-party", title: "RITA'S GARAGE", length: 330, room: "garage",
                                       records: ["telhado", "neon-pluck"], chapter: 2, mixesFor3Stars: 2,
                                       requests: [NightRequest(at: 0.2, record: "maos-no-ar", voice: "garage-req-1", text: "Request! Somebody wants the one with the piano."),
                                                  NightRequest(at: 0.55, record: "squelch", voice: "garage-req-2", text: "Rita wants the acid one. Squelch. It's her garage, play it.")],
                                       mishapAt: 0.75,
                                       // The bedroom friends are not here.
                                       lines: ["clean": [("night-clean-1", "Oh, that was smooth."), ("night-clean-3", "Nobody even noticed the change. That's the idea.")],
                                               "nuts": [("night-nuts-1", "Look at them go!")]])
    /// Chapter 3: a Saturday shift in Lia's shop. Vinyl, no sync, Baptista listening, the needle skips.
    static let saturdayShift = NightInfo(id: "saturday-shift", title: "SATURDAY SHIFT", length: 300, room: "shop",
                                         records: ["varanda", "dubplate"], chapter: 3, mixesFor3Stars: 1,
                                         mishapAt: 0.6, mishap: .needleSkip, syncAllowed: false, coach: "LIA",
                                         lines: ["wait": [("shop-wait", "The shop is yours, kid. Play something.")],
                                                 "start": [("shop-start", "There it is. Keep it going.")],
                                                 "clean": [("shop-clean-1", "Smooth. Nobody heard the join."), ("shop-clean-2", "Baptista nodded. He never nods.")],
                                                 "rough": [("shop-rough", "Bumpy. Listen first, then move.")],
                                                 "dead": [("shop-dead", "Silence in a record shop. The worst sound there is.")],
                                                 "stale": [("shop-stale", "This one's been on long enough. Next.")],
                                                 "slip": [("shop-slip", "It's drifting. Ride the pitch.")],
                                                 "wreck": [("shop-wreck", "Ouch. Horses again.")],
                                                 "clash": [("shop-wreck", "Ouch. Horses again.")],
                                                 "nuts": [("shop-nuts", "Look at them. Dancing between the bins."), ("shop-dance-1", "Even Baptista's foot is tapping.")],
                                                 "cable": [("shop-skip", "The needle jumped! Nudge it back in line.")]])
    /// Chapter 4: a Tuesday in Rui's pub. Six people, vinyl, long blends, "turn it down".
    static let emptyTuesday = NightInfo(id: "empty-tuesday", title: "EMPTY TUESDAY", length: 300, room: "pub",
                                        records: ["flauta", "praia"], chapter: 4, mixesFor3Stars: 2,
                                        syncAllowed: false,
                                        maxMood: 2, turnDownAt: 0.45, remarks: [(at: 0.25, moment: "drunk")],
                                        lines: ["wait": [("pub-wait", "Six people and a barman. Play something.")],
                                                "start": [("pub-start", "Easy start. Good.")],
                                                "clean": [("pub-clean-1", "Smooth. The barman nodded."), ("pub-clean-2", "Two people clapped. In here that's a standing ovation.")],
                                                "rough": [("pub-rough", "Too fast. They noticed.")],
                                                "dead": [("pub-dead", "Silence in a pub. The barman's looking at you.")],
                                                "stale": [("pub-stale", "Same record for a while now. Next.")],
                                                "slip": [("pub-slip", "It's slipping. Nudge it.")],
                                                "wreck": [("pub-wreck", "Ouch. Even the old men heard that.")],
                                                "clash": [("pub-wreck", "Ouch. Even the old men heard that.")],
                                                "nuts": [("pub-nuts", "Six people dancing. It counts.")],
                                                "loud": [("pub-loud", "Rui says turn it down. His pub. Bring your fader down a bit.")],
                                                "loudOk": [("pub-loud-ok", "Thank you. Rui's happy. Rui is never happy.")],
                                                "loudNo": [("pub-loud-no", "He asked twice. Now he's angry. Fader down!")],
                                                "drunk": [("pub-drunk", "That man wants a song we don't have. Smile and nod.")]])
    /// Chapter 5: Thursday on Grooveline Radio. Listeners, not dancers; a request from the chat;
    /// the stream drops once; the jingle helps if it lands on a phrase.
    static let thursdayShow = NightInfo(id: "thursday-show", title: "THURSDAY SHOW", length: 300, room: "studio",
                                        records: ["onda-media", "antena"], chapter: 5, mixesFor3Stars: 2,
                                        requests: [NightRequest(at: 0.3, record: "frequencia", voice: "radio-req-1", text: "The chat wants Frequência. Play it.")],
                                        mishapAt: 0.65, mishap: .streamDrop, audience: .listeners,
                                        lines: ["wait": [("radio-wait", "We're live. Play something!")],
                                                "start": [("radio-start", "And we're on air.")],
                                                "clean": [("radio-clean-1", "Smooth. The chat loves it."), ("radio-clean-2", "Clean mix. Listeners going up.")],
                                                "rough": [("radio-rough", "Bumpy. Two hundred people heard that.")],
                                                "dead": [("radio-dead", "Dead air! On the radio! Play something!")],
                                                "stale": [("radio-stale", "Long one. The chat's getting bored.")],
                                                "slip": [("radio-slip", "It's drifting. Nudge it.")],
                                                "wreck": [("radio-wreck", "Train wreck, live on air. Ouch.")],
                                                "clash": [("radio-wreck", "Train wreck, live on air. Ouch.")],
                                                "nuts": [("radio-nuts", "The chat is going crazy!")],
                                                "requestDone": [("radio-req-done", "Request played. The chat says thank you.")],
                                                "cable": [("radio-drop", "The stream dropped! It's back. Keep going, don't panic.")],
                                                "jingle": [("radio-jingle", "Nice jingle.")]])
    /// Chapter 6: the warm-up at club CAVE, half past midnight. Warm records and two o'clock
    /// records in the bag; the room may dance but should not go nuts yet; a scratched record
    /// sticks; the headliner is late.
    static let caveWarmUp = NightInfo(id: "cave-warm-up", title: "MIDNIGHT AT CAVE", length: 360, room: "cave",
                                      records: ["porta", "estatica"], chapter: 6, mixesFor3Stars: 2,
                                      mishapAt: 0.4, mishap: .stuckGroove, syncAllowed: false,
                                      maxMood: 2, remarks: [(at: 0.62, moment: "late")],
                                      lines: ["wait": [("cave-wait", "Thirty people and a smoke machine. Play something.")],
                                              "start": [("cave-start", "Here we go. Easy does it.")],
                                              "clean": [("cave-clean-1", "Smooth. They're staying."), ("cave-clean-2", "Nobody heard the join. Lia's nodding.")],
                                              "rough": [("cave-rough", "Bumpy. Thirty people heard that.")],
                                              "dead": [("cave-dead", "Silence. In a club. Play something!")],
                                              "stale": [("cave-stale", "This one's been on a while. Next.")],
                                              "slip": [("cave-slip", "It's drifting. Nudge it.")],
                                              "wreck": [("cave-wreck", "Ouch. Two kick drums, fighting.")],
                                              "clash": [("cave-clash", "Two basslines. Kill a low.")],
                                              "cable": [("cave-stuck", "The record's stuck! Pick up the needle and move it on!")],
                                              "stuck": [("cave-stuck-2", "Lift the needle! Carry it a little further in.")],
                                              "hot": [("cave-hot", "Whoa. That's a two o'clock record. Leave something for Helena.")],
                                              "late": [("cave-late", "Nuno says Helena's stuck on the bridge. Another half hour. Keep them warm.")]],
                                      bag: ["porta", "estatica", "antena", "onda-media", "fila", "seguranca", "luz-vermelha", "sem-lista", "cave"],
                                      hot: ["seguranca", "luz-vermelha", "sem-lista", "cave"],
                                      clockStart: 30)
    /// Chapter 7: Friday at CAVE, peak time, now the resident. Club players (sync is back), nine
    /// hundred people, records that have to agree in key (and in pitch: the decks have no key
    /// lock), and a power cut.
    static let fridayCave = NightInfo(id: "friday-cave", title: "FRIDAY AT CAVE", length: 360, room: "cavepeak",
                                      records: ["residente", "portao"], chapter: 7, mixesFor3Stars: 3,
                                      mishapAt: 0.55, mishap: .powerCut,
                                      lines: ["wait": [("fri-wait", "Friday. Nine hundred people. Play something!")],
                                              "start": [("fri-start", "Here we go. Peak time.")],
                                              "clean": [("fri-clean-1", "Smooth. The whole cellar felt that."), ("fri-clean-2", "Nobody even blinked. Perfect.")],
                                              "rough": [("fri-rough", "Bumpy. Nine hundred people heard that.")],
                                              "dead": [("fri-dead", "Silence! At peak time! Play!")],
                                              "stale": [("fri-stale", "This one's done. Next.")],
                                              "slip": [("fri-slip", "It's drifting. Nudge it.")],
                                              "wreck": [("fri-wreck", "Ouch. Two kicks fighting.")],
                                              "clash": [("fri-clash", "Two basslines. Kill a low.")],
                                              "nuts": [("fri-nuts", "Look at them! The whole cellar's jumping!")],
                                              "keys": [("fri-keys", "Sour! Those keys fight. Get out of it, or change it.")],
                                              "cable": [("fri-power", "Power cut! It's back, it's back! Restart, quick!")]],
                                      bag: ["residente", "portao", "sinal", "sem-lista", "seguranca", "coro", "cave", "oito-oito"],
                                      clockStart: 2 * 60, judgeKeys: true)
    /// Chapter 7: the afterhours after VEX's guest set, 05:00-06:30. Coro (132) is where he left
    /// it; bring the room down to 122 or below without anyone feeling the brakes.
    static let afterhours = NightInfo(id: "afterhours", title: "AFTERHOURS", length: 360, room: "cave",
                                      records: ["coro", "oito-oito"], chapter: 7, mixesFor3Stars: 2,
                                      maxMood: 2, remarks: [(at: 0.1, moment: "slow")],
                                      lines: ["wait": [("after-wait", "Six a.m. VEX's laptop is off. Play something.")],
                                              "start": [("after-start", "And we're back. Easy now.")],
                                              "clean": [("after-clean-1", "Smooth. They're floating."), ("after-clean-2", "Lovely. Nobody's leaving.")],
                                              "rough": [("after-rough", "Bumpy. Even at six a.m. they heard that.")],
                                              "dead": [("after-dead", "Silence! Don't lose them now!")],
                                              "stale": [("fri-stale", "This one's done. Next.")],
                                              "slip": [("fri-slip", "It's drifting. Nudge it.")],
                                              "wreck": [("fri-wreck", "Ouch. Two kicks fighting.")],
                                              "clash": [("fri-clash", "Two basslines. Kill a low.")],
                                              "brakes": [("after-brakes", "Whoa, the brakes! Slower. A little every bar.")],
                                              "slow": [("after-slow", "It's six in the morning. Bring them down. Slowly.")]],
                                      bag: ["coro", "oito-oito", "manha", "fumo", "residente", "portao"],
                                      clockStart: 5 * 60, endBPM: 122)
    static let all = [firstParty, garageParty, saturdayShift, emptyTuesday, thursdayShow, caveWarmUp, fridayCave, afterhours]
    static func find(_ id: String) -> NightInfo? { all.first { $0.id == id } }
}

final class NightRunner: ObservableObject {
    let title: String
    /// Seconds of play, from the first record to the end of the night.
    let length: Double
    private let info: NightInfo
    private var nextRequest = 0
    private var pending: NightRequest?
    private var requestsMet = 0
    private var mishapDue = false
    private var mishapDone = false
    private var nextRemark = 0
    private var turnDownAsked = false
    private var turnDownBy: Double?
    private var jinglesSeen: Int?
    private var lastJingleBonus = -100.0
    /// The record last on air, and whether a record too big for the slot was played.
    private var lastOnAirRecord: String?
    private var hotPlayed = false
    /// Seconds the room has been hearing a stuck groove.
    private var stuckRun = 0.0
    /// Seconds of a blend in keys that fight, now and in all; after a power cut, until when the
    /// silence does not count.
    private var keyClashRun = 0.0
    private var sourTime = 0.0
    private var graceUntil = -1.0
    /// Afterhours: the tempo on air two seconds ago, and the last tempo heard.
    private var bpmAnchor: (time: Double, bpm: Double)?
    private var lastBPM = 0.0

    /// Listeners on the stream, from the energy (radio nights).
    var listeners: Int { Int((40 + energyShown * 1260).rounded()) }
    var audience: Audience { info.audience }

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

    init(info: NightInfo, length: Double) {
        self.info = info
        self.title = info.title
        self.length = length
        clock = Self.clockText(info.clockStart)
    }

    private static func clockText(_ minutes: Int) -> String {
        String(format: "%02d:%02d", (minutes / 60) % 24, minutes % 60)
    }

    /// True once, when somebody has just kicked the cable: the record on air must stop.
    func takeMishap() -> Bool {
        guard mishapDue else { return false }
        mishapDue = false
        return true
    }

    /// What Tó can say, by moment; where there are several, they take turns.
    private static let lines: [String: [(voice: String, text: String)]] = [
        "wait": [("night-wait", "Whenever you're ready. Press play.")],
        "start": [("night-start", "Finally! Here we go.")],
        "clean": [("night-clean-1", "Oh, that was smooth."),
                  ("night-clean-2", "Sara loves this one!"),
                  ("night-clean-3", "Nobody even noticed the change. That's the idea.")],
        "rough": [("night-rough", "Rough landing. But we're in.")],
        "dead": [("night-dead-1", "Dead air! Play something, quick!"),
                 ("night-dead-2", "Hello? Is it broken?")],
        "stale": [("night-stale", "They know this one by heart now. Next record.")],
        "slip": [("night-slip", "It's slipping. Nudge it back.")],
        "wreck": [("night-wreck", "Ouch. Train wreck.")],
        "clash": [("night-clash", "Two basslines. Kill one of the lows.")],
        "nuts": [("night-nuts-1", "Look at them go!"),
                 ("night-nuts-2", "Mira is dancing on the bed. Mira never dances!")],
        "requestDone": [("garage-req-done", "Request played. They love you.")],
        "cable": [("garage-cable", "Somebody kicked the cable! Get it back, quick!")],
    ]
    private var turn: [String: Int] = [:]
    private var voice: AVAudioPlayer?

    /// Tó is talking (the music steps back a little).
    var speaking: Bool { voice?.isPlaying ?? false }

    func stop() {
        voice?.stop()
        voice = nil
    }

    private func say(_ moment: String, urgent: Bool = false) {
        guard urgent || now >= quietUntil, let options = info.lines[moment] ?? Self.lines[moment], !options.isEmpty else { return }
        let n = turn[moment, default: 0]
        turn[moment] = n + 1
        speak(options[n % options.count])
    }

    private func speak(_ line: (voice: String, text: String)) {
        commentBy = info.coach
        comment = line.text
        var seconds = 3.0
        if let url = Bundle.main.url(forResource: line.voice, withExtension: "m4a"),
           let player = try? AVAudioPlayer(contentsOf: url) {
            voice?.stop()
            voice = player
            player.play()
            seconds = max(seconds, player.duration + 0.8)
        }
        commentUntil = now + seconds
        quietUntil = now + seconds + 4
    }

    /// Called every frame with what the room hears: nothing, one record, or two, and for two,
    /// how well they sit together. `lead` is the louder deck. `stuck`: the room hears a record
    /// stuck in one groove.
    func update(dt: Double, state: MixReading.State, quality: Double, bassClash: Bool, lead: Int, onAirRecord: String?, channel: [Double],
                jingles: Int, beat: Double, stuck: Bool = false, keyClash: Bool = false, onAirBPM: Double = 0) {
        guard stars == nil else { return }
        // Requests and the cable come at their moment of the night, and cannot wait for silence.
        if began {
            let share = elapsed / length
            // A record too big for the slot (a warm-up playing the headliner's records).
            if let id = onAirRecord, id != lastOnAirRecord {
                lastOnAirRecord = id
                if info.hot.contains(id) && !hotPlayed {
                    hotPlayed = true
                    say("hot", urgent: true)
                }
            }
            if nextRequest < info.requests.count && share >= info.requests[nextRequest].at && pending == nil {
                let request = info.requests[nextRequest]
                nextRequest += 1
                if onAirRecord != request.record {
                    pending = request
                    speak((request.voice, request.text))
                } else {
                    requestsMet += 1 // already playing it
                }
            }
            if let request = pending, onAirRecord == request.record {
                pending = nil
                requestsMet += 1
                energy = min(1, energy + 0.12)
                say("requestDone", urgent: true)
            }
            if nextRemark < info.remarks.count && share >= info.remarks[nextRemark].at {
                say(info.remarks[nextRemark].moment, urgent: true)
                nextRemark += 1
            }
            // A jingle between two phrases sounds like a real station: a small lift, once a minute.
            let seen = jinglesSeen ?? jingles
            jinglesSeen = jingles
            if jingles > seen {
                var into = beat.truncatingRemainder(dividingBy: Lessons.phrase)
                if into < 0 { into += Lessons.phrase }
                if min(into, Lessons.phrase - into) <= 4 && now - lastJingleBonus > 60 && state != .silence {
                    lastJingleBonus = now
                    energy = min(1, energy + 0.04)
                    say("jingle")
                }
            }
            // The owner wants it quieter: the fader on air has to come down within eight seconds.
            if let at = info.turnDownAt, !turnDownAsked, share >= at, state != .silence {
                turnDownAsked = true
                turnDownBy = now + 8
                say("loud", urgent: true)
            }
            if let by = turnDownBy, lead < channel.count {
                if channel[lead] < 0.6 {
                    turnDownBy = nil
                    energy = min(1, energy + 0.05)
                    say("loudOk", urgent: true)
                } else if now > by {
                    turnDownBy = nil
                    energy = max(0, energy - 0.12)
                    say("loudNo", urgent: true)
                }
            }
            if let at = info.mishapAt, !mishapDone, share >= at, state != .silence {
                mishapDone = true
                mishapDue = true
                if info.mishap == .streamDrop { energy = max(0, energy - 0.1) } // listeners leave
                if info.mishap == .powerCut { graceUntil = now + 6 }
                say("cable", urgent: true)
            }
        }
        now += dt
        if !comment.isEmpty && now > commentUntil { comment = "" }
        if !began {
            if state == .silence {
                if now > 5 { say("wait") }
                return
            }
            began = true
            say("start")
        }
        elapsed += dt

        var rate = 0.0
        switch state {
        case .silence where now < graceUntil:
            break // the power is coming back: nobody's fault
        case .silence:
            rate = -0.12
            deadAir += dt
            deadAirRun += dt
            blendTime = 0
            blendQuality = 0
            if deadAirRun > 1.5 { say("dead") }
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
                say(clean ? "clean" : "rough")
            }
            blendTime = 0
            blendQuality = 0
            onAir = lead
            soloAge += dt
            if soloAge >= 80 {
                rate = -0.012 // they have heard this one
                if soloAge > 100 && !toldStale {
                    toldStale = true
                    say("stale")
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
                if driftRun > 3 { say("slip") }
            } else {
                rate = -0.09
                wreck += dt
                say("wreck")
            }
            if bassClash {
                clashRun += dt
                if clashRun > 6 { say("clash") }
            } else {
                clashRun = 0
            }
        }
        // The same groove over and over: the room notices fast.
        if stuck {
            rate = -0.1
            stuckRun += dt
            if stuckRun > 6 { say("stuck") }
        } else {
            stuckRun = 0
        }
        // Keys that fight: a few seconds pass for a quick cut, then the room winces.
        if keyClash && state == .blend {
            keyClashRun += dt
            if keyClashRun > 3 {
                rate -= 0.03
                sourTime += dt
                say("keys")
            }
        } else {
            keyClashRun = 0
        }
        // Afterhours: the tempo may only come down gently.
        if info.endBPM != nil, state != .silence {
            if let a = bpmAnchor, now - a.time < 2 {
                if a.bpm - onAirBPM > 2 {
                    energy = max(0, energy - 0.06)
                    say("brakes", urgent: true)
                    bpmAnchor = (now, onAirBPM)
                }
            } else {
                bpmAnchor = (now, onAirBPM)
            }
            lastBPM = onAirBPM
        }
        // A small room only gets so wild.
        let cap = [0.24, 0.48, 0.75, 1.0][min(3, max(0, info.maxMood))]
        energy = min(cap, max(0, energy + rate * dt))
        energySum += energy * dt

        // The mood follows the energy, with a little slack so it does not flicker at an edge.
        let edges = [0.22, 0.5, 0.78]
        var level = mood
        while level < 3 && energy > edges[level] + 0.03 { level += 1 }
        while level > 0 && energy < edges[level - 1] - 0.03 { level -= 1 }
        if level != mood {
            if level == 3 { say("nuts") }
            mood = level
        }

        if elapsed - shownAt >= 0.25 {
            shownAt = elapsed
            energyShown = energy
            // The night shows ninety minutes (from eleven to half past midnight, unless it starts later).
            let text = Self.clockText(info.clockStart + Int(min(1, elapsed / length) * 90))
            if text != clock { clock = text }
        }
        if elapsed >= length { finish() }
    }

    private func finish() {
        let crowd = energySum / max(1, elapsed)
        let earned: Int
        let allRequests = requestsMet >= info.requests.count
        // A small room tops out lower, so it needs less for three stars.
        let need = info.maxMood >= 3 ? 0.6 : 0.5
        let broughtDown = info.endBPM.map { lastBPM <= $0 + 0.5 } ?? true
        if crowd >= need && transitions >= info.mixesFor3Stars && deadAir < 3 && wreck < 4 && allRequests && !hotPlayed && broughtDown {
            earned = 3
        } else if crowd >= 0.42 && transitions >= 1 {
            earned = 2
        } else {
            earned = 1
        }
        let mixes = transitions == 1 ? "1 mix" : "\(transitions) mixes"
        stop()
        summary = "\(mixes)   ·   crowd \(Int((crowd * 100).rounded())) %   ·   dead air \(Int(deadAir.rounded())) s"
        if !info.requests.isEmpty { summary += "   ·   requests \(requestsMet) / \(info.requests.count)" }
        if !info.hot.isEmpty { summary += hotPlayed ? "   ·   too hot, too early" : "   ·   kept it warm" }
        if info.judgeKeys { summary += sourTime < 1 ? "   ·   in key" : "   ·   sour \(Int(sourTime.rounded())) s" }
        if info.endBPM != nil { summary += "   ·   ended at \(Int(lastBPM.rounded())) BPM" }
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
                    // Top left, after the back button: the top right holds up to three buttons.
                    HStack { meter; Spacer(minLength: 0) }
                        .padding(.leading, 48)
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
            Text(runner.audience == .listeners ? "\(runner.listeners) LISTENERS" : NightRunner.moods[min(3, max(0, runner.mood))])
                .font(.system(size: 10, weight: .heavy))
                .tracking(2)
                .foregroundStyle(tint)
                .fixedSize()
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
