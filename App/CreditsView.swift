import SwiftUI
import AVFoundation

/// The end of the game: the credits roll over the white label (zdB's 2007 dubplate) from its drop,
/// then zdB himself hands over a real record: a live set on Grooveline (his own voice, a button
/// that opens grooveline.org in Safari; the app itself fetches nothing). Then back to the title.
struct CreditsView: View {
    @EnvironmentObject var game: Game

    /// Where the drop is in the white label (seconds into the file, 121 BPM).
    static let dropAt: TimeInterval = 414.5
    static let rollSeconds: Double = 75
    static let liveURL = URL(string: "https://grooveline.org/start-dj")!

    @State private var music: AVAudioPlayer?
    @State private var voice: AVAudioPlayer?
    @State private var rolling = false
    @State private var zdb = false
    @State private var textHeight: CGFloat = 1200

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color(Palette.night).ignoresSafeArea()
                if zdb {
                    zdbCard
                        .transition(.opacity)
                } else {
                    roll(height: geo.size.height)
                        .transition(.opacity)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if !zdb { showZdb() } }
        .onAppear(perform: start)
        .onDisappear {
            music?.stop()
            voice?.stop()
        }
    }

    // MARK: - The roll

    private func roll(height: CGFloat) -> some View {
        ZStack {
            Color.black
                .overlay {
                    if let art = Art.image("room-meridian") {
                        Image(uiImage: art).resizable().scaledToFill().opacity(0.28)
                    }
                }
                .clipped()
                .ignoresSafeArea()
            credits
                .background(GeometryReader { g in Color.clear.onAppear { textHeight = g.size.height } })
                .offset(y: rolling ? -(textHeight / 2 + height / 2 + 20) : (textHeight / 2 + height / 2))
                .animation(.linear(duration: Self.rollSeconds), value: rolling)
        }
    }

    private var credits: some View {
        VStack(spacing: 34) {
            VStack(spacing: 10) {
                GroovelineLogo(height: 30)
                Text("HEADLINER")
                    .font(.custom("Orbitron-Bold", size: 30))
                    .tracking(8)
                    .foregroundStyle(.white)
            }
            section("THANK YOU, LISBON.", [
                "To the Lisbon scene of the nineties and the two-thousands: the record shops and the listening booths, the clubs, the warehouses and the after-hours, the flyers on every wall, the DJs who carried their crates up the stairs, the promoters, the sound engineers, the doormen, and everyone who danced until the sky over the river turned pink. This game is made of your nights.",
            ])
            section("THANK YOU, GROOVELINE.", [
                "In March 2002 a small record shop opened in Chiado, Lisbon. New records every week: trance, progressive house, techno, beats, and decks and gear for anyone who wanted to start.",
                "In the same building there was an old radio studio. In a corner of its small booth, zdB set up two cameras and started streaming DJs live on the internet, years before that was normal. Some of the DJs were customers of the shop; some were names from Lisbon's clubs. By 2004 Grooveline Radio had a weekly timetable, guests from abroad, and sets you could watch again.",
                "Later Grooveline moved to the Netherlands: Rotterdam, festivals, warehouses, hundreds of sets on camera. In 2026 it came back as an open station where any DJ can book a slot and go live.",
                "This game grew out of that shop and that booth. Lia's shop. The glass studio. Thursday nights on the radio. To every DJ who played in that corner, and to everyone who listened: thank you.",
            ])
            section("THE WHITE LABEL", [
                "The record with no name that Lia hands you, and the last one you play at MERIDIAN, is a dubplate produced by zdB in 2007.",
            ])
            section("HOW IT WAS MADE", [
                "Every record in this game except the white label was written as code and synthesized from nothing: no samples, no commercial music. The pictures, the voices and the moving scenes were made with generative AI from our own descriptions. The decks, the mixer and the crowd are all written in code.",
            ])
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 24)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func section(_ title: String, _ paragraphs: [String]) -> some View {
        VStack(spacing: 12) {
            Text(title)
                .font(.custom("Orbitron-Bold", size: 17))
                .tracking(4)
                .foregroundStyle(GroovelineLogo.teal)
            ForEach(paragraphs, id: \.self) { p in
                Text(p)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white.opacity(0.92))
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - zdB's record

    private var zdbCard: some View {
        ZStack(alignment: .bottom) {
            Color.black
                .overlay {
                    if let art = Art.storyImage("scene-zdb") {
                        Image(uiImage: art).resizable().scaledToFill()
                    }
                }
                .clipped()
                .ignoresSafeArea()
            VStack(alignment: .leading, spacing: 10) {
                Text("ZDB")
                    .font(.system(size: 12, weight: .heavy))
                    .tracking(3)
                    .foregroundStyle(Color(Palette.teal))
                Text("This one is real. Play a live set on Grooveline.")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Link(destination: Self.liveURL) {
                        Text("GO LIVE ON GROOVELINE")
                            .font(.system(size: 13, weight: .heavy))
                            .tracking(2)
                            .foregroundStyle(.black)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Capsule().fill(GroovelineLogo.teal))
                    }
                    Button(action: finish) {
                        Text("THE END")
                            .font(.system(size: 13, weight: .heavy))
                            .tracking(2)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Capsule().stroke(.white.opacity(0.5), lineWidth: 1))
                    }
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .frame(maxWidth: 600, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14).fill(.black.opacity(0.66)))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(Palette.teal).opacity(0.35), lineWidth: 1))
            .padding(.bottom, 12)
        }
    }

    // MARK: - Running it

    private func start() {
        if let url = Bundle.main.url(forResource: WhiteLabel.id, withExtension: "m4a"),
           let player = try? AVAudioPlayer(contentsOf: url) {
            try? AVAudioSession.sharedInstance().setActive(true)
            player.currentTime = Self.dropAt
            player.volume = 0
            player.play()
            player.setVolume(0.9, fadeDuration: 2)
            music = player
        }
        // The screenshot run can open the card or a point in the roll.
        let defaults = UserDefaults.standard
        if defaults.string(forKey: "creditsPhase") == "zdb" {
            showZdb()
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { rolling = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.rollSeconds + 1) { if !zdb { showZdb() } }
    }

    private func showZdb() {
        withAnimation(.easeInOut(duration: 0.8)) { zdb = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            guard let url = Bundle.main.url(forResource: "zdb-real", withExtension: "m4a"),
                  let player = try? AVAudioPlayer(contentsOf: url) else { return }
            music?.setVolume(0.35, fadeDuration: 0.4)
            voice = player
            player.play()
            DispatchQueue.main.asyncAfter(deadline: .now() + player.duration + 0.3) {
                music?.setVolume(0.7, fadeDuration: 1)
            }
        }
    }

    private func finish() {
        music?.setVolume(0, fadeDuration: 0.8)
        voice?.stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { game.finish() }
    }
}
