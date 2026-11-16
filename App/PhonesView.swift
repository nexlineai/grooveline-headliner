import SwiftUI

/// Headphone settings: off, or split (the room in the left ear, the cued record in the right);
/// with a four-output sound card connected, a third choice puts the room on outputs 1-2 and the
/// headphones on 3-4. Also how much of the room is mixed into the headphones.
struct PhonesView: View {
    @EnvironmentObject var game: Game
    let onClose: () -> Void

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
                HStack(spacing: 8) {
                    mode("OFF", "The room on both sides.", on: game.phonesMode == 0) { game.phonesMode = 0 }
                    mode("SPLIT  L / R", "Left: the room. Right: your headphones.", on: game.phonesMode == 1) { game.phonesMode = 1 }
                    if game.engine.soundCardConnected || game.phonesMode == 2 {
                        mode("SOUND CARD", "Outputs 1-2: the room. 3-4: your headphones.", on: game.phonesMode == 2) { game.phonesMode = 2 }
                    }
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
                .opacity(game.phonesMode != 0 ? 1 : 0.35)
                .disabled(game.phonesMode == 0)
                Text("Press PHONES on a mixer channel to hear that record in your headphones before the room does. SPLIT works with any wired headphones or adapter: the room in one ear, the next record in the other. With a splitter cable the left side feeds speakers and the right side your headphones. Wired is the way: Bluetooth headphones are a fifth of a second late.")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.65))
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("SOUND GOES TO: \(game.engine.outputs)")
                        .foregroundStyle(.white.opacity(0.5))
                    if !game.engine.soundCardNote.isEmpty {
                        Text(game.engine.soundCardNote)
                            .foregroundStyle(Color(Palette.orange))
                    }
                    if let problem = game.engine.lastError {
                        Text("AUDIO OFF: \(problem)")
                            .foregroundStyle(Color(Palette.red))
                    }
                }
                .font(.system(size: 10, weight: .heavy))
                .tracking(1)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: 620)
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
