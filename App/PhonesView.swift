import SwiftUI

/// Headphone settings: off, or split (the room in the left ear, the cued record in the right),
/// how much of the room is mixed into the headphones, and where the sound is going.
struct PhonesView: View {
    @EnvironmentObject var game: Game
    let onClose: () -> Void
    @State private var probe: String?

    var body: some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("HEADPHONES")
                        .font(.custom("Orbitron-Bold", size: 15))
                        .tracking(3)
                        .foregroundStyle(GroovelineLogo.teal)
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white.opacity(0.8))
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(.white.opacity(0.1)))
                    }
                }
                HStack(spacing: 10) {
                    mode("OFF", "The room on both sides.", on: !game.phonesSplit) { game.phonesSplit = false }
                    mode("SPLIT  L / R", "Left: the room. Right: your headphones.", on: game.phonesSplit) { game.phonesSplit = true }
                }
                HStack(spacing: 10) {
                    Text("CUE")
                        .font(.system(size: 10, weight: .heavy)).tracking(2)
                        .foregroundStyle(Color(Palette.orange))
                    Slider(value: $game.cueMix, in: 0...1)
                        .tint(GroovelineLogo.teal)
                    Text("ROOM")
                        .font(.system(size: 10, weight: .heavy)).tracking(2)
                        .foregroundStyle(GroovelineLogo.teal)
                }
                .opacity(game.phonesSplit ? 1 : 0.35)
                .disabled(!game.phonesSplit)
                Text("Press PHONES on a mixer channel to hear that record in the right ear before the room does. With a splitter cable the left side feeds the speakers and the right side your headphones; with headphones alone you practise with the room in one ear and the next record in the other.")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.65))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Text("SOUND GOES TO: \(probe ?? game.engine.outputs)")
                        .font(.system(size: 10, weight: .heavy)).tracking(1)
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(2)
                    Spacer()
                    Button {
                        probe = "AT ONCE: " + game.engine.probeSeveralOutputs()
                    } label: {
                        Text("CHECK FOR A SECOND OUTPUT")
                            .font(.system(size: 9, weight: .heavy)).tracking(1)
                            .foregroundStyle(.white.opacity(0.8))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Capsule().stroke(.white.opacity(0.3), lineWidth: 1))
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: 560)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color(Palette.panel)))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(0.12), lineWidth: 1))
            .padding(.horizontal, 20)
        }
    }

    private func mode(_ title: String, _ detail: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 13, weight: .heavy)).tracking(2)
                    .foregroundStyle(on ? Color.black : Color.white)
                Text(detail)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(on ? Color.black.opacity(0.7) : Color.white.opacity(0.55))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(on ? GroovelineLogo.teal : Color.white.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(.white.opacity(on ? 0 : 0.15), lineWidth: 1))
        }
    }
}
