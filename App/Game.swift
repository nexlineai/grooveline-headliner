import Foundation
import SwiftUI
import os
import HeadlinerCore
import HeadlinerAudio

let gameLog = Logger(subsystem: "org.grooveline.headliner", category: "game")

/// App-wide state: which screen is up, the deck engine and the crate.
final class Game: ObservableObject {
    enum Screen { case title, booth }

    @Published var screen: Screen = .title
    let engine = DeckEngine()
    private(set) var tracks: [TrackInfo] = []
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
        gameLog.info("crate: \(self.tracks.count, privacy: .public) records")
        if defaults.string(forKey: "screen") == "booth" { openBooth() }
    }

    var build: String {
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
    }

    func openBooth() {
        engine.start()
        if let error = engine.lastError {
            gameLog.error("audio engine did not start: \(error, privacy: .public)")
        } else {
            gameLog.info("audio engine running at \(self.engine.sampleRate, privacy: .public) Hz, buffer \(self.engine.bufferSeconds * 1000, privacy: .public) ms")
        }
        for (deck, track) in zip(engine.decks, tracks) where !deck.isLoaded {
            load(track, on: deck)
        }
        screen = .booth
    }

    func closeBooth() {
        for deck in engine.decks { deck.motorOn = false }
        screen = .title
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
