import SwiftUI

struct TitleView: View {
    @EnvironmentObject var game: Game
    @State private var toast: String?

    /// MERIDIAN played (it has a star) or its ending seen.
    private var finished: Bool {
        (game.progress.stars[Nights.meridian.id] ?? 0) > 0 || game.progress.seen.contains("meridian-end")
    }

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
            GroovelineLogo(height: 30)
                .padding(.bottom, 6)
                // Hidden: hold for three seconds to open (or lock again) every chapter, for testing.
                .onLongPressGesture(minimumDuration: 3) {
                    game.toggleUnlock()
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    toast = game.unlockAll ? "EVERY CHAPTER OPEN" : "CHAPTERS IN ORDER"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { toast = nil }
                }
            Text("HEADLINER")
                .font(.custom("Orbitron-Black", size: 58))
                .tracking(4)
                .foregroundStyle(.white)
                .shadow(color: Color(Palette.magenta).opacity(0.9), radius: 16)
            Text("From the bedroom to the main stage")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.75))
            Button {
                // The chapter you are up to.
                game.screen = .chapter(Chapters.current(game.progress))
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
                small("FREE PLAY") { game.run([.booth]) }
                // Once the career is over: Lia, the credits and zdB's record again.
                if finished || game.unlockAll {
                    small("THE ENDING") { game.run([.story("meridian-end"), .credits]) }
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .top) {
            if let toast {
                Text(toast)
                    .font(.system(size: 12, weight: .heavy))
                    .tracking(3)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(Color(Palette.teal)))
                    .padding(.top, 14)
            }
        }
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
