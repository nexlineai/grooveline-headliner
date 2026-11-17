import SwiftUI
import SpriteKit

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
                    LessonOverlay(runner: runner, roomHeight: roomHeight) {
                        if let stars = runner.stars { game.record(stars, for: runner.lesson.id) }
                        game.closeBooth()
                    }
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
                // Top right: headphones, and in free play the crate.
                HStack(spacing: 8) {
                    pill("headphones", ["PHONES", "SPLIT", "SOUND CARD"][min(2, max(0, game.phonesMode))], lit: game.phonesMode != 0) { phonesOpen = true }
                    if lessonID == nil {
                        pill("square.stack.fill", "CRATE", lit: false) { crateOpen = true }
                    }
                }
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .topTrailing)
                if phonesOpen {
                    PhonesView { phonesOpen = false }
                }
                if lessonID == nil {
                    if crateOpen {
                        CrateView(tracks: game.tracks, decks: game.engine.decks, tick: crateTick, onLoad: { track, d in
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
                let made = BoothScene(game: game)
                made.insets = geo.safeAreaInsets
                // The screenshot run opens the crate by itself.
                if lessonID == nil && UserDefaults.standard.bool(forKey: "crate") { crateOpen = true }
                if UserDefaults.standard.bool(forKey: "phones") { phonesOpen = true }
                if let id = lessonID, let lesson = Lessons.find(id) {
                    let coach = LessonRunner(lesson: lesson)
                    made.lesson = coach
                    runner = coach
                }
                if let id = nightID, let info = Nights.find(id) {
                    // Four and a half minutes: room for three records and two mixes.
                    let party = NightRunner(title: info.title, length: UserDefaults.standard.bool(forKey: "demo") ? 20 : info.length)
                    made.night = party
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
        }
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
