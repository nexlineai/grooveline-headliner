import SwiftUI
import HeadlinerCore
import HeadlinerAudio

/// The record crate: every record you own, with what a DJ reads off a sleeve (tempo, key,
/// length), and a button to put it on the left or the right turntable.
struct CrateView: View {
    let tracks: [TrackInfo]
    let decks: [Deck]
    /// Changes when a record was loaded, so the rows redraw.
    let tick: Int
    let onLoad: (TrackInfo, Int) -> Void
    let onClose: () -> Void

    private static let tints = [GroovelineLogo.teal, Color(Palette.magenta)]

    var body: some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)
            VStack(spacing: 0) {
                HStack {
                    Text("RECORD CRATE")
                        .font(.custom("Orbitron-Bold", size: 15))
                        .tracking(3)
                        .foregroundStyle(GroovelineLogo.teal)
                    Text("\(tracks.count) RECORDS")
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(2)
                        .foregroundStyle(.white.opacity(0.45))
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white.opacity(0.8))
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(.white.opacity(0.1)))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                Divider().overlay(Color.white.opacity(0.12))
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(tracks, id: \.id) { track in
                            row(track)
                            Divider().overlay(Color.white.opacity(0.06))
                        }
                    }
                }
            }
            .frame(maxWidth: 640)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color(Palette.panel)))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(0.12), lineWidth: 1))
            .padding(.vertical, 14)
            .padding(.horizontal, 20)
        }
    }

    /// Which deck the record is on, if any.
    private func deck(of track: TrackInfo) -> Int? {
        decks.firstIndex { $0.info?.id == track.id }
    }

    private func row(_ track: TrackInfo) -> some View {
        let on = deck(of: track)
        return HStack(spacing: 12) {
            Self.sleeve(track)
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text("\(track.artist)  ·  \(track.label)  ·  \(track.genre)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.55))
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            fact(String(format: "%.0f", track.bpm), "BPM")
            fact(track.camelot, track.key.uppercased())
            fact(clock(track.seconds), "LENGTH")
            ForEach(0..<2, id: \.self) { d in
                load(track, on: d, isOn: on == d, elsewhere: on != nil && on != d)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    /// A small sleeve in the record's own colour (always the same for the same record).
    static func sleeve(_ track: TrackInfo) -> some View {
        var sum = 0
        for scalar in track.id.unicodeScalars { sum = (sum * 31 + Int(scalar.value)) % 360 }
        let colour = Color(hue: Double(sum) / 360, saturation: 0.6, brightness: 0.85)
        return ZStack {
            RoundedRectangle(cornerRadius: 4).fill(colour.opacity(0.9))
            Circle().fill(.black.opacity(0.75)).padding(5)
            Circle().fill(colour).frame(width: 8, height: 8)
        }
        .frame(width: 34, height: 34)
    }

    private func fact(_ value: String, _ name: String) -> some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.system(size: 14, weight: .bold).monospacedDigit())
                .foregroundStyle(.white)
            Text(name)
                .font(.system(size: 8, weight: .heavy))
                .tracking(1)
                .foregroundStyle(.white.opacity(0.4))
                .lineLimit(1)
        }
        .frame(width: 58)
    }

    private func load(_ track: TrackInfo, on d: Int, isOn: Bool, elsewhere: Bool) -> some View {
        let tint = Self.tints[d]
        // A turning record stays where it is, and there is one copy of each record.
        let blocked = decks[d].motorOn || elsewhere || isOn
        return Button {
            onLoad(track, d)
        } label: {
            Text(isOn ? "ON" : (d == 0 ? "LEFT" : "RIGHT"))
                .font(.system(size: 10, weight: .heavy))
                .tracking(1)
                .foregroundStyle(isOn ? Color.black : tint.opacity(blocked ? 0.3 : 1))
                .frame(width: 48, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(isOn ? tint : Color.clear))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(blocked && !isOn ? 0.25 : 0.8), lineWidth: 1.5))
        }
        .disabled(blocked)
    }

    private func clock(_ seconds: Double) -> String {
        let whole = Int(seconds.rounded())
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}
