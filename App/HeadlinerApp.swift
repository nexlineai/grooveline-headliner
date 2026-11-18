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
            case .chapter(let number):
                if let chapter = Chapters.find(number) {
                    ChapterView(chapter: chapter)
                } else {
                    TitleView()
                }
            case .booth: BoothView(lessonID: nil, nightID: nil)
            case .lesson(let id): BoothView(lessonID: id, nightID: nil).id(id)
            case .night(let id): BoothView(lessonID: nil, nightID: id).id(id)
            case .bag: BagView()
            case .credits: CreditsView()
            case .story(let id):
                if let scene = game.scene(id) {
                    StoryView(scene: scene) { game.sceneEnded(id) }
                        .id(id)
                } else {
                    Color.black.onAppear { game.next() }
                }
            }
        }
    }
}
