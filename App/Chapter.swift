import SwiftUI

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

    static let all: [Chapter] = [bedroom, shop]

    /// Chapter 3: Lia's shop, where the sync button comes off. (Chapter 2, the house parties,
    /// is not written yet.)
    static let shop = Chapter(number: 3, title: "GROOVELINE RECORDS",
                              line: "A record shop with two old turntables, a rare-groove wall, and Lia, who has heard it all.",
                              steps: [
        ChapterStep(id: "white-label", kind: .story, title: "THE WHITE LABEL", detail: "Lia closes in ten minutes. She gives you a record.",
                    screens: [.story("white-label")]),
        ChapterStep(id: "sync-off", kind: .lesson, title: "SYNC OFF", detail: "Hear the gallop. Pitch it, nudge it, lock it.",
                    screens: [.lesson("sync-off")]),
    ])

    static func find(_ number: Int) -> Chapter? { all.first { $0.number == number } }

    static let bedroom = Chapter(number: 1, title: "THE BEDROOM",
                                 line: "Your room, a cheap controller with the sync button on, and the friends who will put up with anything.",
                                 steps: [
        ChapterStep(id: "cold-open", kind: .story, title: "MERIDIAN", detail: "Sixty thousand people. Nine years from now.",
                    screens: [.story("cold-open"), .story("nine-years")]),
        ChapterStep(id: "dani", kind: .story, title: "DANI", detail: "Your oldest friend has opinions.",
                    screens: [.story("dani")]),
        ChapterStep(id: "first-mix", kind: .lesson, title: "FIRST MIX", detail: "Play, count the bars, start on the one, crossfade.",
                    screens: [.lesson("first-mix")]),
        ChapterStep(id: "on-the-phrase", kind: .lesson, title: "ON THE PHRASE", detail: "Eight bars make a phrase. Mix where it changes.",
                    screens: [.lesson("on-the-phrase")]),
        ChapterStep(id: "bass-swap", kind: .lesson, title: "THE BASS SWAP", detail: "Two basslines are mud. Hand the low end over.",
                    screens: [.lesson("bass-swap")]),
        ChapterStep(id: "in-your-ears", kind: .lesson, title: "IN YOUR EARS", detail: "Hear the next record before the room does.",
                    screens: [.lesson("in-your-ears")]),
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
                    HStack(spacing: 10) {
                        Text("CHAPTER \(chapter.number)")
                            .font(.system(size: 12, weight: .heavy))
                            .tracking(5)
                            .foregroundStyle(GroovelineLogo.teal)
                        // Other chapters, while nothing is locked.
                        if !Chapters.locked {
                            ForEach(Chapters.all.filter { $0.number != chapter.number }, id: \.number) { other in
                                Button {
                                    game.screen = .chapter(other.number)
                                } label: {
                                    Text("\(other.number)")
                                        .font(.system(size: 11, weight: .heavy))
                                        .foregroundStyle(.white.opacity(0.8))
                                        .frame(width: 24, height: 24)
                                        .background(Circle().stroke(.white.opacity(0.35), lineWidth: 1))
                                }
                            }
                        }
                    }
                    Text(chapter.title)
                        .font(.custom("Orbitron-Black", size: 34))
                        .tracking(2)
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
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
