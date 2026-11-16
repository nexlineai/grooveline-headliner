import SwiftUI
import SpriteKit

/// The booth screen: the SpriteKit scene full-bleed, with a way back to the title.
struct BoothView: View {
    @EnvironmentObject var game: Game
    @State private var scene: BoothScene?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if let scene {
                    SpriteView(scene: scene, preferredFramesPerSecond: 120)
                        .ignoresSafeArea()
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
            }
            .onAppear {
                guard scene == nil else { return }
                let made = BoothScene(game: game)
                made.insets = geo.safeAreaInsets
                scene = made
            }
            .onChange(of: geo.safeAreaInsets) { _, new in
                scene?.insets = new
            }
        }
    }
}
