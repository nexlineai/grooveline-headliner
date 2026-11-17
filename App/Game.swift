import Foundation
import SwiftUI
import os
import AVFoundation
import HeadlinerCore
import HeadlinerAudio

let gameLog = Logger(subsystem: "org.grooveline.headliner", category: "game")

/// App-wide state: which screen is up, what comes after it, the deck engine, the crate and the story.
final class Game: ObservableObject {
    enum Screen: Equatable { case title, chapter(Int), story(String), booth, lesson(String), night(String) }

    @Published var screen: Screen = .title { didSet { updateMenuMusic() } }
    /// The radio station's ID, fired with the JINGLE button in the studio.
    private var jinglePlayer: AVAudioPlayer?
    private(set) var jingleCount = 0
    var jinglePlaying: Bool { jinglePlayer?.isPlaying ?? false }

    func playJingle() {
        guard !jinglePlaying, let url = Bundle.main.url(forResource: "jingle", withExtension: "m4a"),
              let player = try? AVAudioPlayer(contentsOf: url) else { return }
        jinglePlayer = player
        player.play()
        jingleCount += 1
    }

    /// Music under the title and chapter screens: sixteen bars of Saturday Job, looping.
    private var menuMusic: AVAudioPlayer?
    private var menuMusicStop: DispatchWorkItem?
    let engine = DeckEngine()
    private(set) var tracks: [TrackInfo] = []
    private(set) var scenes: [StoryScene] = []
    /// Screens still to come; when one ends the next is shown, and after the last `home`.
    private var queue: [Screen] = []
    /// Where the player lands when the queue is done or they leave: the title, or a chapter.
    private var home: Screen = .title
    /// Best stars and scenes seen, saved on the phone.
    @Published private(set) var progress = CareerProgress.load()
    /// The screenshot run starts the app with `-demo 1`: the decks start by themselves.
    let demo: Bool
    /// Headphones: 0 off (the room on both sides), 1 split (room left, headphones right),
    /// 2 a four-output sound card (room on 1-2, headphones on 3-4).
    @Published var phonesMode: Int {
        didSet {
            engine.phones = PhonesMode(rawValue: phonesMode) ?? .off
            UserDefaults.standard.set(phonesMode, forKey: "phonesMode")
        }
    }
    private var routeObserver: NSObjectProtocol?
    /// What the headphones hear: 0 = only the cued records, 1 = only the room.
    @Published var cueMix: Double {
        didSet {
            engine.cueMix = cueMix
            UserDefaults.standard.set(cueMix, forKey: "cueMix")
        }
    }

    init() {
        let defaults = UserDefaults.standard
        demo = defaults.bool(forKey: "demo")
        phonesMode = defaults.integer(forKey: "phonesMode")
        cueMix = defaults.double(forKey: "cueMix")
        engine.phones = PhonesMode(rawValue: phonesMode) ?? .off
        engine.cueMix = cueMix
        // Something was plugged in or pulled out: let the screens that show the outputs redraw.
        routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                self?.engine.routeChanged()
                self?.objectWillChange.send()
            }
        }
        if let url = Bundle.main.url(forResource: "tracks", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let list = try? JSONDecoder().decode([TrackInfo].self, from: data) {
            tracks = list
        }
        if let url = Bundle.main.url(forResource: "scenes", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let list = try? JSONDecoder().decode([StoryScene].self, from: data) {
            scenes = list
        }
        // Voices and music must sound with the ring switch on silent, like any game with headphones on.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        gameLog.info("crate: \(self.tracks.count, privacy: .public) records, story: \(self.scenes.count, privacy: .public) scenes")
        switch defaults.string(forKey: "screen") ?? "" {
        case "booth": openBooth()
        case "lesson": openBooth(lesson: defaults.string(forKey: "lesson") ?? "first-mix")
        case "night": openBooth(night: defaults.string(forKey: "night") ?? Nights.firstParty.id)
        case "story": screen = .story(defaults.string(forKey: "scene") ?? "cold-open")
        case "chapter":
            // The screenshot run shows a chapter part-way through (not saved).
            if defaults.bool(forKey: "demoProgress") {
                progress.stars = ["first-mix": 3, "on-the-phrase": 2]
                progress.seen = ["cold-open"]
            }
            screen = .chapter(max(1, defaults.integer(forKey: "chapter")))
        default: break
        }
        updateMenuMusic()
    }

    var build: String {
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
    }

    /// Opens the booth: free play, or a lesson when one is named.
    func openBooth(lesson: String? = nil, night: String? = nil) {
        engine.start()
        if let error = engine.lastError {
            gameLog.error("audio engine did not start: \(error, privacy: .public)")
        } else {
            gameLog.info("audio engine running at \(self.engine.sampleRate, privacy: .public) Hz, buffer \(self.engine.bufferSeconds * 1000, privacy: .public) ms")
        }
        for (deck, track) in zip(engine.decks, tracks) where !deck.isLoaded {
            load(track, on: deck)
        }
        if let night {
            screen = .night(night)
        } else if let lesson {
            screen = .lesson(lesson)
        } else {
            screen = .booth
        }
    }

    /// The booth is done with: the next screen in line, or with `leaving` straight home.
    func closeBooth(leaving: Bool = false) {
        for deck in engine.decks { deck.motorOn = false }
        engine.masterVolume = 1
        if leaving { leave() } else { next() }
    }

    /// Stops whatever was lined up and goes home (the chapter, or the title).
    func leave() {
        queue = []
        screen = home
    }

    /// Keeps the best stars of a lesson or a night.
    func record(_ stars: Int, for id: String) {
        guard !demo || UserDefaults.standard.string(forKey: "screen") == nil else { return }
        if stars > (progress.stars[id] ?? 0) {
            progress.stars[id] = stars
            progress.save()
        }
    }

    /// A story scene was watched to the end.
    func sceneEnded(_ id: String) {
        if !progress.seen.contains(id) {
            progress.seen.insert(id)
            progress.save()
        }
        next()
    }

    func scene(_ id: String) -> StoryScene? { scenes.first { $0.id == id } }

    /// Shows these screens one after the other, then `home`.
    func run(_ screens: [Screen], home: Screen = .title) {
        self.home = home
        queue = screens
        next()
    }

    /// The current screen is over.
    func next() {
        guard !queue.isEmpty else {
            screen = home
            return
        }
        switch queue.removeFirst() {
        case .booth: openBooth()
        case .lesson(let id): openBooth(lesson: id)
        case .night(let id): openBooth(night: id)
        case let other: screen = other
        }
    }

    /// The menu music plays on the title and chapter screens and fades out everywhere else.
    private func updateMenuMusic() {
        var wanted = screen == .title
        if case .chapter = screen { wanted = true }
        if wanted {
            menuMusicStop?.cancel()
            menuMusicStop = nil
            if menuMusic == nil, let url = Bundle.main.url(forResource: "menu-loop", withExtension: "m4a"),
               let player = try? AVAudioPlayer(contentsOf: url) {
                player.numberOfLoops = -1
                player.volume = 0
                menuMusic = player
            }
            guard let player = menuMusic else { return }
            if !player.isPlaying {
                try? AVAudioSession.sharedInstance().setActive(true)
                player.play()
            }
            player.setVolume(0.55, fadeDuration: 1.2)
        } else if let player = menuMusic, player.isPlaying, menuMusicStop == nil {
            player.setVolume(0, fadeDuration: 0.5)
            let pause = DispatchWorkItem { [weak self] in
                self?.menuMusic?.pause()
                self?.menuMusicStop = nil
            }
            menuMusicStop = pause
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.55, execute: pause)
        }
    }

    func load(_ track: TrackInfo, on deck: Deck) {
        guard let url = Bundle.main.url(forResource: track.id, withExtension: "m4a") else {
            gameLog.error("no audio file for \(track.id, privacy: .public)")
            return
        }
        do {
            try deck.load(track, from: url)
            gameLog.info("loaded \(track.id, privacy: .public): \(deck.duration, privacy: .public) s, first beat at \(deck.grid.firstBeat * 1000, privacy: .public) ms")
        } catch {
            gameLog.error("could not load \(track.id, privacy: .public): \(String(describing: error), privacy: .public)")
        }
    }
}
