import SwiftUI
import AVFoundation
import HeadlinerCore

/// Chapter 12, THE BAG: the closing set, packed from your own records, six parts in order.
/// Saved with the progress (`CareerProgress.closingSet`) for the night it is played. Tap a part on
/// the left, then a record on the right; between two parts it says whether the keys fit and how
/// far the tempo moves (the decks have no key lock).
struct BagView: View {
    @EnvironmentObject var game: Game

    static let parts = ["OPENER", "BUILD", "PEAK", "BREAK", "SECOND PEAK", "CLOSER"]
    static let hints = ["Say hello. Not too hot.", "Lift them up.", "The big one.", "Let them breathe.",
                        "Higher than the first.", "The one they go home with."]

    @State private var picks: [String?] = Array(repeating: nil, count: 6)
    @State private var slot = 0
    @State private var voice: AVAudioPlayer?

    /// Your records: every record of the career (by chapter 12 they are all yours; with the
    /// chapters locked for release every earlier chapter is played by now), and your dubplate.
    /// Not `Chapters.recordsOpen`: chapter 12 only opens once THE NIGHT BEFORE has a star, which
    /// comes after this, so its own records would be missing.
    private var records: [TrackInfo] {
        // Newest first: chapter 12's records on top, the bedroom's at the bottom.
        var list = BoothView.newestFirst(game.tracks.filter { ($0.chapter ?? 1) <= 12 && $0.id != WhiteLabel.id })
        if game.progress.track != nil { list.append(Studio.cutInfo()) }
        return list
    }

    private func info(_ id: String?) -> TrackInfo? {
        guard let id else { return nil }
        if id == "your-dubplate" { return Studio.cutInfo() }
        return game.tracks.first { $0.id == id }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 5) {
                Text("THE BAG")
                    .font(.custom("Orbitron-Bold", size: 17))
                    .tracking(3)
                    .foregroundStyle(GroovelineLogo.teal)
                Text("YOUR CLOSING SET · SIX RECORDS, IN ORDER")
                    .font(.system(size: 9, weight: .heavy))
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.bottom, 3)
                ForEach(0..<6, id: \.self) { i in slotRow(i) }
                Button(action: pack) {
                    Text("PACK THE BAG")
                        .font(.system(size: 14, weight: .heavy))
                        .tracking(4)
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(GroovelineLogo.teal.opacity(full ? 1 : 0.3)))
                }
                .disabled(!full)
                .padding(.top, 4)
            }
            .frame(width: 330)
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(records, id: \.id) { track in
                            recordRow(track)
                            Divider().overlay(Color.white.opacity(0.06))
                        }
                    }
                }
            }
            .background(RoundedRectangle(cornerRadius: 14).fill(Color(Palette.panel)))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(.white.opacity(0.12), lineWidth: 1))
        }
        .padding(.leading, 56)
        .padding(.trailing, 20)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(Palette.night).ignoresSafeArea())
        .overlay(alignment: .topLeading) {
            Button {
                voice?.stop()
                game.leave()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(.black.opacity(0.45)))
            }
            .padding(.top, 8)
            .padding(.leading, 8)
        }
        .onAppear {
            if let saved = game.progress.closingSet, saved.count == 6 {
                picks = saved.map { Optional($0) }
            } else if let demo = game.demoBag {
                picks = demo.map { Optional($0) } + Array(repeating: nil, count: max(0, 6 - demo.count))
            }
            slot = picks.firstIndex { $0 == nil } ?? 0
            if let url = Bundle.main.url(forResource: "bag-01", withExtension: "m4a"), let player = try? AVAudioPlayer(contentsOf: url) {
                voice = player
                player.play()
            }
        }
        .onDisappear { voice?.stop() }
    }

    private var full: Bool { !picks.contains { $0 == nil } }

    private func slotRow(_ i: Int) -> some View {
        let track = info(picks[i])
        let chosen = i == slot
        return Button {
            slot = i
        } label: {
            HStack(spacing: 10) {
                Text("\(i + 1)")
                    .font(.system(size: 12, weight: .heavy).monospacedDigit())
                    .foregroundStyle(chosen ? Color.black : GroovelineLogo.teal)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(chosen ? GroovelineLogo.teal : Color.white.opacity(0.08)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(Self.parts[i])
                        .font(.system(size: 9, weight: .heavy))
                        .tracking(1.5)
                        .foregroundStyle(.white.opacity(0.5))
                    Text(track.map { "\($0.title)  ·  \(Int($0.bpm.rounded()))  ·  \($0.camelot)" } ?? Self.hints[i])
                        .font(.system(size: 12, weight: track == nil ? .medium : .bold))
                        .foregroundStyle(.white.opacity(track == nil ? 0.4 : 1))
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if i > 0, let a = info(picks[i - 1]), let b = track {
                    let fits = Harmony.compatible(a.camelot, b.camelot)
                    Text((fits ? "FITS" : "KEYS FIGHT") + String(format: " %+.0f", b.bpm - a.bpm))
                        .font(.system(size: 8, weight: .heavy).monospacedDigit())
                        .foregroundStyle(fits ? GroovelineLogo.teal : Color(Palette.orange))
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 38)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.black.opacity(chosen ? 0.7 : 0.4)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(chosen ? GroovelineLogo.teal.opacity(0.8) : Color.white.opacity(0.1), lineWidth: 1))
        }
    }

    private func recordRow(_ track: TrackInfo) -> some View {
        let at = picks.firstIndex { $0 == track.id }
        return Button {
            put(track.id)
        } label: {
            HStack(spacing: 10) {
                CrateView.sleeve(track)
                VStack(alignment: .leading, spacing: 1) {
                    Text(track.title)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text("\(track.artist)  ·  \(track.genre)")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Text("\(Int(track.bpm.rounded()))")
                    .font(.system(size: 13, weight: .bold).monospacedDigit())
                    .foregroundStyle(.white)
                    .frame(width: 34)
                Text(track.camelot)
                    .font(.system(size: 13, weight: .bold).monospacedDigit())
                    .foregroundStyle(.white)
                    .frame(width: 34)
                Text(at.map { "\($0 + 1)" } ?? "")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(.black)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(at == nil ? Color.clear : GroovelineLogo.teal))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
    }

    /// Puts the record in the chosen part (moving it if it was in another), then moves on to the
    /// next empty part.
    private func put(_ id: String) {
        if let was = picks.firstIndex(where: { $0 == id }) { picks[was] = nil }
        picks[slot] = id
        UISelectionFeedbackGenerator().selectionChanged()
        if let empty = picks.firstIndex(where: { $0 == nil }) { slot = empty }
    }

    private func pack() {
        guard full else { return }
        voice?.stop()
        game.packBag(picks.compactMap { $0 })
    }
}
