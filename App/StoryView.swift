import SwiftUI

struct StoryView: View {
    @StateObject private var player: StoryPlayer
    private let onEnd: () -> Void

    init(scene: StoryScene, onEnd: @escaping () -> Void) {
        _player = StateObject(wrappedValue: StoryPlayer(scene: scene))
        self.onEnd = onEnd
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            backdrop.ignoresSafeArea()
            if let line = player.line {
                if player.shot?.art == nil {
                    card(line)
                } else {
                    caption(line)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { player.tap() }
        .onAppear {
            player.onEnd = onEnd
            player.start()
        }
        .onDisappear { player.stop() }
    }

    /// The still picture, and on top of it the clip of the line being spoken.
    private var backdrop: some View {
        Color.black
            .overlay {
                if let name = player.shot?.art, let art = Art.storyImage(name) {
                    Image(uiImage: art).resizable().scaledToFill()
                }
            }
            .overlay {
                if let video = player.video {
                    ClipView(player: video)
                }
            }
            .clipped()
    }

    private func caption(_ line: StoryLine) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(line.who)
                .font(.system(size: 12, weight: .heavy))
                .tracking(3)
                .foregroundStyle(Color(Palette.teal))
            Text(line.text)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .frame(maxWidth: 600, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(.black.opacity(0.66)))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(Palette.teal).opacity(0.35), lineWidth: 1))
        .padding(.bottom, 12)
    }

    private func card(_ line: StoryLine) -> some View {
        Text(line.text)
            .font(.system(size: 34, weight: .black))
            .tracking(8)
            .multilineTextAlignment(.center)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
