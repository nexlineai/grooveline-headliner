import SwiftUI
import HeadlinerCore

// The career is told in chapters. A chapter is a list of steps (story scenes, lessons, nights);
// the player's best stars and the scenes already seen are saved on the phone, so the game goes
// on where it was left.

struct ChapterStep: Identifiable {
    enum Kind { case story, lesson, night }
    var id: String
    var kind: Kind
    var title: String
    var detail: String
    /// What is played for this step, one screen after the other.
    var screens: [Game.Screen]
}

struct Chapter {
    var number: Int
    var title: String
    var line: String
    var steps: [ChapterStep]
}

enum Chapters {
    /// Locks every step after the first one not done yet. Off while Zé tests, so any part can be
    /// played straight away; on for the release.
    static let locked = false

    static let all: [Chapter] = [bedroom, houseParties, shop, pubs, radio, door, resident, studio, road, festivals, backToBack, headliner]

    /// Chapter 12: headliner. MERIDIAN calls; the needle will skip again, so this time you are
    /// ready. (The night itself, the white label and the credits come last, with Zé.)
    static let headliner = Chapter(number: 12, title: "HEADLINER",
                                   line: "MERIDIAN's main stage, sixty thousand people, and a record bag you packed yourself.",
                                   steps: [
        ChapterStep(id: "carla-meridian", kind: .story, title: "CARLA", detail: "MERIDIAN called.",
                    screens: [.story("carla-meridian")]),
        ChapterStep(id: "skip", kind: .lesson, title: "THE SKIP", detail: "It skipped once. This time you know what to do.",
                    screens: [.lesson("skip")]),
    ])

    /// Chapter 11: back to back. Helena first: one booth, two DJs, her deck is hers.
    static let backToBack = Chapter(number: 11, title: "BACK TO BACK",
                                    line: "Legend nights, a boat on the river, and someone else's hands on the same mixer.",
                                    steps: [
        ChapterStep(id: "helena-b2b", kind: .story, title: "HELENA", detail: "One booth, two DJs.",
                    screens: [.story("helena-b2b")]),
        ChapterStep(id: "b2b", kind: .lesson, title: "BACK TO BACK", detail: "Answer her record. Never touch her deck.",
                    screens: [.lesson("b2b")]),
        ChapterStep(id: Nights.boatParty.id, kind: .night, title: Nights.boatParty.title, detail: "Sunset on the river. You answer her, she answers you.",
                    screens: [.story("boat-party"), .night(Nights.boatParty.id)]),
        ChapterStep(id: "vex-poster", kind: .story, title: "VEX", detail: "His name on top. Yours underneath.",
                    screens: [.story("vex-poster")]),
        ChapterStep(id: Nights.vexB2B.id, kind: .night, title: Nights.vexB2B.title, detail: "His set, his timing. Keep the room. Keep your cool.",
                    screens: [.night(Nights.vexB2B.id), .story("chapter-11-end")]),
    ])

    /// Chapter 10: festivals. Carla, a big stage whose far speakers come back late, the sunset slot.
    static let festivals = Chapter(number: 10, title: "FESTIVALS",
                                   line: "A tent, a forest, a sunset slot: big systems, big fields, and a manager with a phone.",
                                   steps: [
        ChapterStep(id: "carla", kind: .story, title: "CARLA", detail: "Three festivals. Don't be late.",
                    screens: [.story("carla")]),
        ChapterStep(id: "delay", kind: .lesson, title: "THE DELAY", detail: "The field is late. Mix to your monitors.",
                    screens: [.lesson("delay")]),
        ChapterStep(id: Nights.sunsetSlot.id, kind: .night, title: Nights.sunsetSlot.title, detail: "Start slow, end at 126. The generator.",
                    screens: [.night(Nights.sunsetSlot.id)]),
        ChapterStep(id: Nights.threePM.id, kind: .night, title: Nights.threePM.title, detail: "Two hundred people on a field for twenty thousand.",
                    screens: [.story("three-pm"), .night(Nights.threePM.id)]),
        ChapterStep(id: Nights.tentRain.id, kind: .night, title: Nights.tentRain.title, detail: "The sky turns black. Everyone runs in.",
                    screens: [.night(Nights.tentRain.id)]),
        ChapterStep(id: Nights.forestStage.id, kind: .night, title: Nights.forestStage.title, detail: "Lasers in the trees. They will want an encore.",
                    screens: [.night(Nights.forestStage.id), .story("chapter-10-end")]),
    ])

    /// Chapter 9: on the road. Other people's booths, other cities; Berlin first.
    static let road = Chapter(number: 9, title: "ON THE ROAD",
                              line: "Berlin, Amsterdam, Ibiza, Detroit: strange booths, other people's records, and too many airports.",
                              steps: [
        ChapterStep(id: "joli", kind: .story, title: "JOLI", detail: "My booth is tired. Show me.",
                    screens: [.story("joli")]),
        ChapterStep(id: "borrowed-booth", kind: .lesson, title: "BORROWED BOOTH", detail: "The left fader is dead. Mix with the crossfader.",
                    screens: [.lesson("borrowed-booth")]),
        ChapterStep(id: Nights.berlinNight.id, kind: .night, title: Nights.berlinNight.title, detail: "Vinyl, a dead fader, a belt that slips.",
                    screens: [.night(Nights.berlinNight.id)]),
        ChapterStep(id: "lost-bag", kind: .story, title: "LOST BAG", detail: "Your records went to Málaga.",
                    screens: [.story("lost-bag")]),
        ChapterStep(id: "genre-switch", kind: .lesson, title: "GENRE SWITCH", detail: "Records that don't fit: thin, then cut on the phrase.",
                    screens: [.lesson("genre-switch")]),
        ChapterStep(id: Nights.ibizaNight.id, kind: .night, title: Nights.ibizaNight.title, detail: "Joli's records. Read the sleeves.",
                    screens: [.night(Nights.ibizaNight.id)]),
        ChapterStep(id: "detroit", kind: .story, title: "DETROIT", detail: "A test pressing from 1991.",
                    screens: [.story("detroit")]),
        ChapterStep(id: Nights.burnout.id, kind: .night, title: Nights.burnout.title, detail: "Forty nights in forty days.",
                    screens: [.night(Nights.burnout.id), .story("chapter-9-end")]),
    ])

    /// Chapter 8: the studio. A drum machine first; bass and chords, the arrangement and your own
    /// record in the crate follow.
    static let studio = Chapter(number: 8, title: "THE STUDIO",
                                line: "A drum machine on the desk, your own record in your own crate, and a label that might say no.",
                                steps: [
        ChapterStep(id: "drums", kind: .lesson, title: "DRUMS", detail: "Sixteen steps. Four on the floor.",
                    screens: [.lesson("drums")]),
        ChapterStep(id: "synth", kind: .lesson, title: "BASS AND CHORDS", detail: "The bass goes where the kick isn't.",
                    screens: [.lesson("synth")]),
        ChapterStep(id: "dubplate", kind: .lesson, title: "DUBPLATE", detail: "Your loop becomes a record. One copy.",
                    screens: [.lesson("dubplate")]),
        ChapterStep(id: Nights.dubplateNight.id, kind: .night, title: Nights.dubplateNight.title, detail: "Your record, at CAVE, on a big system.",
                    screens: [.night(Nights.dubplateNight.id), .story("chapter-8-end")]),
    ])

    /// Chapter 7: Fridays at CAVE. Helena gives you peak time; club players, keys, a power cut.
    static let resident = Chapter(number: 7, title: "RESIDENT",
                                  line: "Fridays at CAVE, peak time: club players, nine hundred people, and records that have to agree.",
                                  steps: [
        ChapterStep(id: "helena", kind: .story, title: "HELENA VOSS", detail: "Fridays, peak time. They're yours.",
                    screens: [.story("helena")]),
        ChapterStep(id: "keys", kind: .lesson, title: "KEYS", detail: "Same beat, wrong notes. Find a neighbour on the wheel.",
                    screens: [.lesson("keys")]),
        ChapterStep(id: "filter", kind: .lesson, title: "FILTER", detail: "Helena shows you the knob under the EQ.",
                    screens: [.lesson("filter")]),
        ChapterStep(id: Nights.fridayCave.id, kind: .night, title: Nights.fridayCave.title, detail: "Peak time, records in key, and the power goes.",
                    screens: [.night(Nights.fridayCave.id)]),
        ChapterStep(id: "vex", kind: .story, title: "VEX", detail: "Dani's guest night. Two hours, every second planned.",
                    screens: [.story("vex")]),
        ChapterStep(id: "tempo", kind: .lesson, title: "TEMPO", detail: "From 128 to 120, and nobody notices.",
                    screens: [.lesson("tempo")]),
        ChapterStep(id: Nights.afterhours.id, kind: .night, title: Nights.afterhours.title, detail: "Six a.m. Bring them down, slowly.",
                    screens: [.night(Nights.afterhours.id), .story("chapter-7-end")]),
    ])

    /// Chapter 6: club CAVE, the warm-up slot. Nuno at the door, a bag of records, the headliner late.
    static let door = Chapter(number: 6, title: "THE DOOR",
                              line: "Club CAVE at midnight: the warm-up slot, a bag of records, and a doorman who has never heard of you.",
                              steps: [
        ChapterStep(id: "nuno", kind: .story, title: "NUNO", detail: "Not on the list.",
                    screens: [.story("nuno")]),
        ChapterStep(id: "warm-up", kind: .lesson, title: "WARM-UP", detail: "Make them want the headliner. Don't be the headliner.",
                    screens: [.lesson("warm-up")]),
        ChapterStep(id: Nights.caveWarmUp.id, kind: .night, title: Nights.caveWarmUp.title, detail: "Vinyl, a stuck record, and the headliner is late.",
                    screens: [.night(Nights.caveWarmUp.id), .story("chapter-6-end")]),
    ])

    /// Chapter 5: Grooveline Radio. Vera's Thursday show, live; jingles, requests, the news.
    static let radio = Chapter(number: 5, title: "GROOVELINE RADIO",
                               line: "A Thursday slot on Grooveline Radio. Nobody sees you; everybody hears the gaps.",
                               steps: [
        ChapterStep(id: "vera", kind: .story, title: "VERA", detail: "Live. Dead air is a sin.",
                    screens: [.story("vera")]),
        ChapterStep(id: "on-air", kind: .lesson, title: "ON AIR", detail: "The jingle on a phrase. Out exactly on the news.",
                    screens: [.lesson("on-air")]),
        ChapterStep(id: Nights.thursdayShow.id, kind: .night, title: Nights.thursdayShow.title, detail: "Listeners, a request from the chat, a dropped stream.",
                    screens: [.night(Nights.thursdayShow.id), .story("chapter-5-end")]),
    ])

    /// Chapter 4: pubs and bars. Rui Prata pays "in exposure"; six people on a Tuesday; long blends.
    static let pubs = Chapter(number: 4, title: "PUBS AND BARS",
                              line: "Your own records in a bag, a pub with six people in it, and a promoter who pays in exposure.",
                              steps: [
        ChapterStep(id: "rui", kind: .story, title: "RUI PRATA", detail: "No money. But exposure. Lots of exposure.",
                    screens: [.story("rui")]),
        ChapterStep(id: "long-blend", kind: .lesson, title: "LONG BLEND", detail: "Sixteen bars of two records. Nobody notices. That's the job.",
                    screens: [.lesson("long-blend")]),
        ChapterStep(id: Nights.emptyTuesday.id, kind: .night, title: Nights.emptyTuesday.title, detail: "Six people. Vinyl. Rui wants it quieter.",
                    screens: [.night(Nights.emptyTuesday.id), .story("chapter-4-end")]),
    ])

    /// Chapter 2: other people's houses. A garage, borrowed speakers, requests, a kicked cable.
    static let houseParties = Chapter(number: 2, title: "HOUSE PARTIES",
                                      line: "Borrowed speakers, somebody's garage, a crate of new records and a room that asks for things.",
                                      steps: [
        ChapterStep(id: "garage", kind: .story, title: "SARA", detail: "Rita's garage. She'll be right there, in front.",
                    screens: [.story("garage")]),
        ChapterStep(id: "requests", kind: .lesson, title: "REQUESTS", detail: "Open the crate. Play what they ask for.",
                    screens: [.lesson("requests")]),
        ChapterStep(id: Nights.garageParty.id, kind: .night, title: Nights.garageParty.title, detail: "Two requests, two mixes, one kicked cable.",
                    screens: [.night(Nights.garageParty.id), .story("chapter-2-end")]),
    ])

    /// Chapter 3: Lia's shop, where the sync button comes off.
    static let shop = Chapter(number: 3, title: "GROOVELINE RECORDS",
                              line: "A record shop with two old turntables, a rare-groove wall, and Lia, who has heard it all.",
                              steps: [
        ChapterStep(id: "white-label", kind: .story, title: "THE WHITE LABEL", detail: "Lia closes in ten minutes. She gives you a record.",
                    screens: [.story("white-label")]),
        ChapterStep(id: "sync-off", kind: .lesson, title: "SYNC OFF", detail: "Hear the gallop. Pitch it, nudge it, lock it.",
                    screens: [.lesson("sync-off")]),
        ChapterStep(id: "by-ear", kind: .lesson, title: "BY EAR", detail: "No numbers. Which one is ahead?",
                    screens: [.lesson("by-ear")]),
        ChapterStep(id: "hold-it", kind: .lesson, title: "HOLD IT", detail: "Blends drift. Eight bars without a slip.",
                    screens: [.lesson("hold-it")]),
        ChapterStep(id: Nights.saturdayShift.id, kind: .night, title: Nights.saturdayShift.title, detail: "Vinyl only. Baptista is listening.",
                    screens: [.story("baptista"), .night(Nights.saturdayShift.id), .story("chapter-3-end")]),
    ])

    static func find(_ number: Int) -> Chapter? { all.first { $0.number == number } }

    /// Chapters whose records are in the free-play crate: the first from the start, the others
    /// once their night has been played (one star is enough); a chapter without a night yet,
    /// once one of its lessons has been done. Records belong to the chapter that brought them.
    static func recordsOpen(_ progress: CareerProgress) -> Set<Int> {
        var open: Set<Int> = [1]
        for chapter in all {
            let nights = chapter.steps.filter { $0.kind == .night }
            let counted = nights.isEmpty ? chapter.steps.filter { $0.kind == .lesson } : nights
            if counted.contains(where: { (progress.stars[$0.id] ?? 0) > 0 }) { open.insert(chapter.number) }
        }
        return open
    }

    static let bedroom = Chapter(number: 1, title: "THE BEDROOM",
                                 line: "Your room, a cheap controller with the sync button on, and the friends who will put up with anything.",
                                 steps: [
        ChapterStep(id: "cold-open", kind: .story, title: "MERIDIAN", detail: "Sixty thousand people. Nine years from now.",
                    screens: [.story("cold-open"), .story("nine-years")]),
        ChapterStep(id: "first-mix", kind: .lesson, title: "FIRST MIX", detail: "Play, count the bars, start on the one, crossfade.",
                    screens: [.lesson("first-mix")]),
        ChapterStep(id: "on-the-phrase", kind: .lesson, title: "ON THE PHRASE", detail: "Eight bars make a phrase. Mix where it changes.",
                    screens: [.lesson("on-the-phrase")]),
        ChapterStep(id: "bass-swap", kind: .lesson, title: "THE BASS SWAP", detail: "Two basslines are mud. Hand the low end over.",
                    screens: [.lesson("bass-swap")]),
        ChapterStep(id: "dani", kind: .story, title: "DANI", detail: "Your oldest friend has opinions.",
                    screens: [.story("dani")]),
        ChapterStep(id: "in-your-ears", kind: .lesson, title: "IN YOUR EARS", detail: "Hear the next record before the room does.",
                    screens: [.lesson("in-your-ears")]),
        // The finale: Mira's lights, the party, the end card.
        ChapterStep(id: Nights.firstParty.id, kind: .night, title: Nights.firstParty.title, detail: "Six friends, four and a half minutes, no help.",
                    screens: [.story("mira-lights"), .night(Nights.firstParty.id), .story("chapter-1-end")]),
    ])
}

/// What the player has done, kept on the phone.
struct CareerProgress: Codable, Equatable {
    /// Best stars per lesson or night id.
    var stars: [String: Int] = [:]
    /// Story steps seen to the end.
    var seen: Set<String> = []
    /// The pattern of the record cut in the studio (chapter 8). Optional, so saves from before it
    /// existed still load (a new non-optional field would make every old save fail to decode).
    var track: DrumPattern?

    private static let key = "progress.v1"

    static func load() -> CareerProgress {
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONDecoder().decode(CareerProgress.self, from: data) else { return CareerProgress() }
        return saved
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: Self.key) }
    }

    func done(_ step: ChapterStep) -> Bool {
        step.kind == .story ? seen.contains(step.id) : (stars[step.id] ?? 0) > 0
    }
}

struct ChapterView: View {
    @EnvironmentObject var game: Game
    let chapter: Chapter

    private var nextIndex: Int? { chapter.steps.firstIndex { !game.progress.done($0) } }
    private var earned: Int { chapter.steps.reduce(0) { $0 + (game.progress.stars[$1.id] ?? 0) } }
    private var possible: Int { chapter.steps.filter { $0.kind != .story }.count * 3 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            HStack(alignment: .center, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("CHAPTER \(chapter.number)")
                        .font(.system(size: 12, weight: .heavy))
                        .tracking(5)
                        .foregroundStyle(GroovelineLogo.teal)
                        .fixedSize()
                    // Other chapters, while nothing is locked: their own line, so twelve still fit.
                    if !Chapters.locked {
                        HStack(spacing: 4) {
                            ForEach(Chapters.all.filter { $0.number != chapter.number }, id: \.number) { other in
                                Button {
                                    game.screen = .chapter(other.number)
                                } label: {
                                    Text("\(other.number)")
                                        .font(.system(size: 10, weight: .heavy))
                                        .foregroundStyle(.white.opacity(0.8))
                                        .frame(width: 21, height: 21)
                                        .background(Circle().stroke(.white.opacity(0.35), lineWidth: 1))
                                }
                            }
                        }
                    }
                    Text(chapter.title)
                        .font(.custom("Orbitron-Black", size: 34))
                        .tracking(2)
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                    Text(chapter.line)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.75))
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill").foregroundStyle(Color(Palette.orange))
                        Text("\(earned) / \(possible)")
                            .font(.system(size: 14, weight: .heavy).monospacedDigit())
                            .foregroundStyle(.white)
                    }
                    .padding(.top, 2)
                    Button(action: playOn) {
                        Text(nextIndex == nil ? "PLAY IT AGAIN" : (nextIndex == 0 ? "START" : "CONTINUE"))
                            .font(.system(size: 16, weight: .heavy))
                            .tracking(5)
                            .foregroundStyle(.black)
                            .padding(.horizontal, 44)
                            .padding(.vertical, 12)
                            .background(Capsule().fill(GroovelineLogo.teal))
                    }
                    .padding(.top, 8)
                }
                .frame(maxWidth: 300, alignment: .leading)
                VStack(spacing: 4) {
                    ForEach(Array(chapter.steps.enumerated()), id: \.element.id) { index, step in
                        row(step, index: index)
                    }
                }
                .frame(maxWidth: 420)
            }
            .padding(.horizontal, 30)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Button {
                game.screen = .title
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(.black.opacity(0.45)))
            }
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // In the background, so the picture (wider than the screen) cannot make the screen wider.
        .background { backdrop }
    }

    private var backdrop: some View {
        ZStack {
            Color(Palette.night)
            if let art = Art.image("room-bedroom") {
                Image(uiImage: art).resizable().scaledToFill().opacity(0.35)
            }
            LinearGradient(colors: [.black.opacity(0.3), .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
    }

    /// From the first step not done to the end of the chapter; with everything done, from the start.
    private func playOn() {
        let from = nextIndex ?? 0
        let screens = chapter.steps[from...].flatMap { $0.screens }
        game.run(screens, home: .chapter(chapter.number))
    }

    private func row(_ step: ChapterStep, index: Int) -> some View {
        let done = game.progress.done(step)
        let open = !Chapters.locked || index <= (nextIndex ?? chapter.steps.count)
        let isNext = index == nextIndex
        let icon: String
        switch step.kind {
        case .story: icon = "film"
        case .lesson: icon = "slider.horizontal.3"
        case .night: icon = "party.popper.fill"
        }

        return Button {
            game.run(step.screens, home: .chapter(chapter.number))
        } label: {
            HStack(spacing: 12) {
                Image(systemName: open ? icon : "lock.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(isNext ? Color.black : GroovelineLogo.teal)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(isNext ? GroovelineLogo.teal : Color.white.opacity(0.08)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(step.title)
                        .font(.system(size: 13, weight: .heavy))
                        .tracking(1.5)
                        .foregroundStyle(.white)
                    Text(step.detail)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.white.opacity(0.55))
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                if step.kind == .story {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(done ? GroovelineLogo.teal : Color.white.opacity(0.3))
                } else {
                    let got = game.progress.stars[step.id] ?? 0
                    HStack(spacing: 2) {
                        ForEach(0..<3, id: \.self) { i in
                            Image(systemName: i < got ? "star.fill" : "star")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(i < got ? Color(Palette.orange) : Color.white.opacity(0.25))
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(isNext ? 0.7 : 0.5)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(isNext ? GroovelineLogo.teal.opacity(0.7) : Color.white.opacity(0.1), lineWidth: 1))
            .opacity(open ? 1 : 0.45)
        }
        .disabled(!open)
    }
}
