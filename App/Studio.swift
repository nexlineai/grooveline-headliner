import SwiftUI
import HeadlinerCore
import HeadlinerAudio

// The studio (chapter 8): the drum machine's step grid over the room. The pattern is rendered
// into a record (`DrumMachine.render`) and played on the left deck like any other record.

enum Studio {
    static let bpm = 124.0
    /// Long enough to play like a record (about two minutes); it is one bar repeated.
    static let bars = 64

    static func track(seconds: Double) -> TrackInfo {
        TrackInfo(id: "studio", title: "YOUR TRACK", artist: "YOU", label: "BEDROOM", genre: "Drum machine",
                  bpm: bpm, key: "A minor", camelot: "8A", bars: bars, seconds: seconds, chapter: 8)
    }

    /// Renders the pattern and puts it on `deck`; with `keepPlace` a playing deck goes on playing.
    static func load(_ pattern: DrumPattern, on deck: Deck, keepPlace: Bool) {
        let audio = DrumMachine.render(pattern, bpm: bpm, bars: bars)
        let seconds = Double(audio.left.count) / DrumMachine.sampleRate
        try? deck.load(track(seconds: seconds), left: audio.left, right: audio.right,
                       sampleRate: DrumMachine.sampleRate, keepPlace: keepPlace)
    }
}

/// Three rows of sixteen steps. A tap switches a step; the column being played lights up.
struct StudioGrid: View {
    @Binding var pattern: DrumPattern
    /// The deck playing the pattern, for the running light.
    let deck: Deck

    private let tints = [GroovelineLogo.teal, Color(Palette.orange), Color(Palette.magenta)]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { _ in
            let playing = deck.motorOn && deck.rate > 0.5 && deck.info?.id == "studio"
            let beat = deck.beat
            let now = playing ? Int((beat * 4).rounded(.down)) % DrumPattern.steps : -1
            VStack(spacing: 4) {
                ForEach(0..<DrumPattern.voices.count, id: \.self) { row in
                    HStack(spacing: 3) {
                        Text(DrumPattern.voices[row])
                            .font(.system(size: 10, weight: .heavy))
                            .tracking(1.5)
                            .foregroundStyle(tints[row])
                            .frame(width: 42, alignment: .leading)
                        ForEach(0..<DrumPattern.steps, id: \.self) { step in
                            cell(row: row, step: step, now: now)
                                .padding(.leading, step > 0 && step % 4 == 0 ? 5 : 0)
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 14).fill(.black.opacity(0.72)))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(.white.opacity(0.12), lineWidth: 1))
        }
    }

    private func cell(row: Int, step: Int, now: Int) -> some View {
        let on = pattern.rows[row][step]
        let beatStart = step % 4 == 0
        return Button {
            pattern.rows[row][step].toggle()
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            RoundedRectangle(cornerRadius: 5)
                .fill(on ? tints[row] : Color.white.opacity(beatStart ? 0.16 : 0.08))
                .overlay(RoundedRectangle(cornerRadius: 5)
                    .stroke(step == now ? Color.white : Color.white.opacity(0.15), lineWidth: step == now ? 2 : 1))
                .frame(width: 30, height: 26)
        }
        .buttonStyle(.plain)
    }
}
