import SwiftUI

@main
struct HeadlinerApp: App {
    @StateObject private var game = Game()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(game)
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var game: Game

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch game.screen {
            case .title: TitleView()
            case .booth: BoothView(lessonID: nil, isNight: false)
            case .lesson(let id): BoothView(lessonID: id, isNight: false).id(id)
            case .night: BoothView(lessonID: nil, isNight: true)
            case .story(let id):
                if let scene = game.scene(id) {
                    StoryView(scene: scene) { game.next() }
                        .id(id)
                } else {
                    Color.black.onAppear { game.next() }
                }
            }
        }
    }
}
