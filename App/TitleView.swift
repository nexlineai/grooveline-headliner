import SwiftUI

struct TitleView: View {
    @EnvironmentObject var game: Game

    private func small(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .heavy))
                .tracking(2)
                .foregroundStyle(.white.opacity(0.85))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Capsule().stroke(.white.opacity(0.4), lineWidth: 1))
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            Spacer()
            Text("GROOVELINE")
                .font(.system(size: 20, weight: .heavy))
                .tracking(12)
                .foregroundStyle(Color(Palette.teal))
            Text("HEADLINER")
                .font(.system(size: 66, weight: .black))
                .tracking(3)
                .foregroundStyle(.white)
                .shadow(color: Color(Palette.magenta).opacity(0.9), radius: 16)
            Text("From the bedroom to the main stage")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.75))
            Button {
                game.run([.story("cold-open"), .booth, .story("nine-years")])
            } label: {
                Text("PLAY")
                    .font(.system(size: 17, weight: .heavy))
                    .tracking(6)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 54)
                    .padding(.vertical, 13)
                    .background(Capsule().fill(Color(Palette.teal)))
            }
            .padding(.top, 16)
            HStack(spacing: 12) {
                small("DECKS ONLY") { game.run([.booth]) }
                small("SCENE: THE WHITE LABEL") { game.run([.story("white-label")]) }
            }
            .padding(.top, 10)
            Text("Test build \(game.build)")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.45))
                .padding(.top, 8)
                .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                if let art = Art.image("title-floor") {
                    Image(uiImage: art).resizable().scaledToFill()
                }
                LinearGradient(colors: [.black.opacity(0.05), .black.opacity(0.88)], startPoint: .top, endPoint: .bottom)
            }
            .ignoresSafeArea()
        }
    }
}
