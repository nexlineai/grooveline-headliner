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

    /// The record cut from the pattern (one copy, in your crate).
    static func cutInfo(seconds: Double = 0) -> TrackInfo {
        TrackInfo(id: "dubplate", title: "YOUR DUBPLATE", artist: "YOU", label: "ONE COPY", genre: "Your own",
                  bpm: bpm, key: "A minor", camelot: "8A",
                  bars: DrumMachine.arrangement.reduce(0) { $0 + $1.bars }, seconds: seconds, chapter: 8)
    }

    /// Cuts the pattern into a whole record (intro, groove, full, break, full, outro) on `deck`.
    static func loadCut(_ pattern: DrumPattern, on deck: Deck) {
        let audio = DrumMachine.render(pattern, bpm: bpm, sections: DrumMachine.arrangement)
        let seconds = Double(audio.left.count) / DrumMachine.sampleRate
        try? deck.load(cutInfo(seconds: seconds), left: audio.left, right: audio.right, sampleRate: DrumMachine.sampleRate)
    }

    /// Renders the pattern and puts it on `deck`; with `keepPlace` a playing deck goes on playing.
    static func load(_ pattern: DrumPattern, on deck: Deck, keepPlace: Bool) {
        let audio = DrumMachine.render(pattern, bpm: bpm, bars: bars)
        let seconds = Double(audio.left.count) / DrumMachine.sampleRate
        try? deck.load(track(seconds: seconds), left: audio.left, right: audio.right,
                       sampleRate: DrumMachine.sampleRate, keepPlace: keepPlace)
    }
}

/// Rows of sixteen steps on two pages (DRUMS: kick, clap, hat; SYNTH: bass, chord). A tap
/// switches a step; the column being played lights up.
struct StudioGrid: View {
    @Binding var pattern: DrumPattern
    @Binding var page: Int
    /// The deck playing the pattern, for the running light.
    let deck: Deck
    /// The CUT button (the dubplate lesson) and what it does.
    var cutter = false
    var onCut: () -> Void = {}

    private let tints = [GroovelineLogo.teal, Color(Palette.orange), Color(Palette.magenta),
                         Color(red: 0.62, green: 0.88, blue: 0.32), Color(red: 0.66, green: 0.58, blue: 1)]
    private let pages = [[0, 1, 2], [3, 4]]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { _ in
            let playing = deck.motorOn && deck.rate > 0.5 && (deck.info?.id == "studio" || deck.info?.id == "dubplate")
            let beat = deck.beat
            let now = playing ? Int((beat * 4).rounded(.down)) % DrumPattern.steps : -1
            HStack(alignment: .center, spacing: 8) {
                VStack(spacing: 4) {
                    tab("DRUMS", 0)
                    tab("SYNTH", 1)
                    if cutter { cutButton }
                }
                VStack(spacing: 4) {
                    ForEach(pages[min(1, max(0, page))], id: \.self) { row in
                        HStack(spacing: 3) {
                            Text(DrumPattern.voices[row])
                                .font(.system(size: 10, weight: .heavy))
                                .tracking(1.5)
                                .foregroundStyle(tints[row])
                                .lineLimit(1)
                                .fixedSize()
                                .frame(width: 50, alignment: .leading)
                            ForEach(0..<DrumPattern.steps, id: \.self) { step in
                                cell(row: row, step: step, now: now)
                                    .padding(.leading, step > 0 && step % 4 == 0 ? 5 : 0)
                            }
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
                .frame(width: 28, height: 26)
        }
        .buttonStyle(.plain)
    }

    private var cutButton: some View {
        Button(action: onCut) {
            Text("CUT")
                .font(.system(size: 10, weight: .heavy))
                .tracking(1.5)
                .foregroundStyle(.black)
                .frame(width: 58, height: 26)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(Palette.orange)))
        }
        .buttonStyle(.plain)
    }

    private func tab(_ title: String, _ index: Int) -> some View {
        let on = page == index
        return Button {
            page = index
        } label: {
            Text(title)
                .font(.system(size: 10, weight: .heavy))
                .tracking(1.5)
                .foregroundStyle(on ? Color.black : Color.white.opacity(0.85))
                .frame(width: 58, height: cutter ? 26 : 39)
                .background(RoundedRectangle(cornerRadius: 8).fill(on ? GroovelineLogo.teal : Color.white.opacity(0.08)))
        }
        .buttonStyle(.plain)
    }
}
