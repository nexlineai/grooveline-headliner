import SwiftUI
import SpriteKit

/// The booth screen: the SpriteKit scene full-bleed, a way back to the title, and, during a
/// lesson, the coach's words and the thing to do over the room.
struct BoothView: View {
    @EnvironmentObject var game: Game
    let lessonID: String?
    @State private var scene: BoothScene?
    @State private var runner: LessonRunner?
    @State private var crateOpen = false
    @State private var crateTick = 0

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if let scene {
                    SpriteView(scene: scene, preferredFramesPerSecond: 120)
                        .ignoresSafeArea()
                }
                if let runner {
                    // The gear takes the lower 58 % of the whole screen; the room is what is left above.
                    let screenHeight = geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom
                    LessonOverlay(runner: runner, roomHeight: screenHeight * 0.42 - geo.safeAreaInsets.top) {
                        game.closeBooth()
                    }
                }
                Button {
                    game.closeBooth()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white.opacity(0.85))
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(.black.opacity(0.45)))
                }
                .padding(.top, 8)
                if lessonID == nil {
                    // Free play: the crate, top right.
                    Button {
                        crateOpen = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "square.stack.fill")
                                .font(.system(size: 12, weight: .bold))
                            Text("CRATE")
                                .font(.system(size: 11, weight: .heavy))
                                .tracking(2)
                        }
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .background(Capsule().fill(.black.opacity(0.5)))
                        .overlay(Capsule().stroke(.white.opacity(0.25), lineWidth: 1))
                    }
                    .padding(.top, 8)
                    .frame(maxWidth: .infinity, alignment: .topTrailing)
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
                if let id = lessonID, let lesson = Lessons.find(id) {
                    let coach = LessonRunner(lesson: lesson)
                    made.lesson = coach
                    runner = coach
                }
                scene = made
            }
            .onDisappear { runner?.stop() }
            .onChange(of: geo.safeAreaInsets) { _, new in
                scene?.insets = new
            }
        }
    }
}
