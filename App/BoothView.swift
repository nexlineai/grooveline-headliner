import SwiftUI
import SpriteKit
import HeadlinerCore

/// The booth screen: the SpriteKit scene full-bleed, a way back to the title, and, during a
/// lesson, the coach's words and the thing to do over the room.
struct BoothView: View {
    @EnvironmentObject var game: Game
    let lessonID: String?
    /// A night for a room, judged by the crowd.
    let nightID: String?
    @State private var nightRunner: NightRunner?
    @State private var scene: BoothScene?
    @State private var runner: LessonRunner?
    @State private var crateOpen = false
    @State private var phonesOpen = false
    @State private var crateTick = 0

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if let scene {
                    SpriteView(scene: scene, preferredFramesPerSecond: 120)
                        .ignoresSafeArea()
                }
                // The gear takes the lower 58 % of the whole screen; the room is what is left above.
                let roomHeight = (geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom) * 0.42 - geo.safeAreaInsets.top
                if let runner {
                    // In the studio the step grid takes the room; the coach is heard, not shown.
                    LessonOverlay(runner: runner, roomHeight: roomHeight, showWords: !studio) {
                        if let stars = runner.stars { game.record(stars, for: runner.lesson.id) }
                        game.closeBooth()
                    }
                }
                if studio && runner?.stars == nil {
                    StudioGrid(pattern: $game.pattern, page: $game.studioPage, deck: game.engine.decks[0])
                        .frame(maxWidth: .infinity)
                        .frame(height: max(60, roomHeight - 4), alignment: .bottom)
                }
                if let nightRunner {
                    NightOverlay(runner: nightRunner, roomHeight: roomHeight) {
                        if let stars = nightRunner.stars, let id = nightID { game.record(stars, for: id) }
                        game.closeBooth()
                    }
                }
                Button {
                    // Back leaves the lesson or night (and whatever was lined up after it).
                    game.closeBooth(leaving: true)
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white.opacity(0.85))
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(.black.opacity(0.45)))
                }
                .padding(.top, 8)
                // Top right: headphones, and the crate (free play, nights, lessons that use it).
                HStack(spacing: 8) {
                    pill("headphones", ["PHONES", "SPLIT", "SOUND CARD"][min(2, max(0, game.phonesMode))], lit: game.phonesMode != 0) { phonesOpen = true }
                    if inStudio {
                        if let runner {
                            CratePill(runner: runner, target: .jingle, symbol: "dot.radiowaves.left.and.right", title: "JINGLE") { game.playJingle() }
                        } else {
                            pill("dot.radiowaves.left.and.right", "JINGLE", lit: false) { game.playJingle() }
                        }
                    }
                    if crateShown {
                        if let runner {
                            CratePill(runner: runner, target: .crate, symbol: "square.stack.fill", title: "CRATE") { crateOpen = true }
                        } else {
                            pill("square.stack.fill", "CRATE", lit: false) { crateOpen = true }
                        }
                    }
                }
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .topTrailing)
                if phonesOpen {
                    PhonesView { phonesOpen = false }
                }
                if crateShown {
                    if crateOpen {
                        CrateView(tracks: crateRecords, decks: game.engine.decks, tick: crateTick, onLoad: { track, d in
                            game.load(track, on: game.engine.decks[d])
                            scene?.recordChanged(on: d)
                            crateTick += 1
                        }, onClose: {
                            crateOpen = false
                        })
                    }
                }
            }
            .onAppear {
                guard scene == nil else { return }
                // A studio lesson starts from its own pattern, or an empty one (the screenshot run
                // can bring a groove), on the page asked for.
                if studio, let id = lessonID, let lesson = Lessons.find(id) {
                    if !UserDefaults.standard.bool(forKey: "demoPattern") { game.pattern = lesson.desk.pattern ?? DrumPattern() }
                    game.studioPage = UserDefaults.standard.integer(forKey: "studioPage")
                }
                let made = BoothScene(game: game)
                made.insets = geo.safeAreaInsets
                // The screenshot run opens the crate by itself.
                if crateShown && UserDefaults.standard.bool(forKey: "crate") { crateOpen = true }
                if UserDefaults.standard.bool(forKey: "phones") { phonesOpen = true }
                if let id = lessonID, let lesson = Lessons.find(id) {
                    let coach = LessonRunner(lesson: lesson)
                    coach.startAt = UserDefaults.standard.integer(forKey: "lessonStep")
                    made.lesson = coach
                    runner = coach
                }
                if let id = nightID, let info = Nights.find(id) {
                    let party = NightRunner(info: info, length: UserDefaults.standard.bool(forKey: "demo") ? 20 : info.length)
                    made.night = party
                    made.nightInfo = info
                    nightRunner = party
                }
                scene = made
            }
            .onDisappear {
                runner?.stop()
                nightRunner?.stop()
            }
            .onChange(of: geo.safeAreaInsets) { _, new in
                scene?.insets = new
            }
            .onChange(of: game.pattern) { _, _ in
                scene?.patternChanged()
            }
        }
    }

    /// The studio (chapter 8): the drum machine's grid over the room.
    private var studio: Bool {
        if let id = lessonID { return Lessons.find(id)?.desk.studio ?? false }
        return false
    }

    /// The radio studio has a station jingle.
    private var inStudio: Bool {
        if let id = lessonID { return Lessons.find(id)?.desk.room == "studio" }
        if let id = nightID { return Nights.find(id)?.room == "studio" }
        return false
    }

    /// The crate is there in free play, in nights, and in lessons that teach it.
    private var crateShown: Bool {
        if let id = lessonID { return Lessons.find(id)?.desk.crate ?? false }
        return true
    }

    /// Free play: the records of the chapters played so far (`Chapters.recordsOpen`). A lesson or
    /// night: the records of its chapter and the ones before, or only the bag when it names them.
    private var crateRecords: [TrackInfo] {
        if lessonID == nil && nightID == nil {
            let open = Chapters.recordsOpen(game.progress)
            return game.tracks.filter { open.contains($0.chapter ?? 1) }
        }
        var chapter = Int.max
        var bag: [String]?
        if let id = lessonID, let lesson = Lessons.find(id) { chapter = lesson.desk.chapter; bag = lesson.desk.bag }
        if let id = nightID, let info = Nights.find(id) { chapter = info.chapter; bag = info.bag }
        if let bag { return game.tracks.filter { bag.contains($0.id) } }
        return game.tracks.filter { ($0.chapter ?? 1) <= chapter }
    }

    private func pill(_ symbol: String, _ title: String, lit: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .bold))
                Text(title)
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(2)
            }
            .foregroundStyle(lit ? Color.black : Color.white.opacity(0.9))
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(Capsule().fill(lit ? GroovelineLogo.teal : Color.black.opacity(0.5)))
            .overlay(Capsule().stroke(.white.opacity(lit ? 0 : 0.25), lineWidth: 1))
        }
    }
}

/// A top-right button in a lesson (CRATE, JINGLE): it pulses when the coach points at it.
struct CratePill: View {
    @ObservedObject var runner: LessonRunner
    let target: LessonTarget
    let symbol: String
    let title: String
    let action: () -> Void
    @State private var glow = false

    var body: some View {
        let pointed = runner.target == target
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .bold))
                Text(title)
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(2)
            }
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(Capsule().fill(Color.black.opacity(0.5)))
            .overlay(Capsule().stroke(pointed ? Color(Palette.orange) : Color.white.opacity(0.25), lineWidth: pointed ? 2.5 : 1))
            .shadow(color: pointed ? Color(Palette.orange).opacity(glow ? 0.9 : 0.2) : .clear, radius: 8)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { glow = true }
        }
    }
}
