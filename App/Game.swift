import Foundation
import SwiftUI
import os
import AVFoundation
import HeadlinerCore
import HeadlinerAudio

let gameLog = Logger(subsystem: "org.grooveline.headliner", category: "game")

/// App-wide state: which screen is up, what comes after it, the deck engine, the crate and the story.
final class Game: ObservableObject {
    enum Screen: Equatable { case title, story(String), booth, lesson(String) }

    @Published var screen: Screen = .title
    let engine = DeckEngine()
    private(set) var tracks: [TrackInfo] = []
    private(set) var scenes: [StoryScene] = []
    /// Screens still to come; when one ends the next is shown, and after the last the title.
    private var queue: [Screen] = []
    /// The screenshot run starts the app with `-demo 1`: the decks start by themselves.
    let demo: Bool

    init() {
        let defaults = UserDefaults.standard
        demo = defaults.bool(forKey: "demo")
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
        case "story": screen = .story(defaults.string(forKey: "scene") ?? "cold-open")
        default: break
        }
    }

    var build: String {
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
    }

    /// Opens the booth: free play, or a lesson when one is named.
    func openBooth(lesson: String? = nil) {
        engine.start()
        if let error = engine.lastError {
            gameLog.error("audio engine did not start: \(error, privacy: .public)")
        } else {
            gameLog.info("audio engine running at \(self.engine.sampleRate, privacy: .public) Hz, buffer \(self.engine.bufferSeconds * 1000, privacy: .public) ms")
        }
        for (deck, track) in zip(engine.decks, tracks) where !deck.isLoaded {
            load(track, on: deck)
        }
        screen = lesson.map { Screen.lesson($0) } ?? Screen.booth
    }

    func closeBooth() {
        for deck in engine.decks { deck.motorOn = false }
        engine.masterVolume = 1
        next()
    }

    func scene(_ id: String) -> StoryScene? { scenes.first { $0.id == id } }

    /// Shows these screens one after the other, then the title.
    func run(_ screens: [Screen]) {
        queue = screens
        next()
    }

    /// The current screen is over.
    func next() {
        guard !queue.isEmpty else {
            screen = .title
            return
        }
        switch queue.removeFirst() {
        case .booth: openBooth()
        case .lesson(let id): openBooth(lesson: id)
        case let other: screen = other
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
