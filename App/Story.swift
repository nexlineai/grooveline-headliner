import AVFoundation
import SwiftUI

// A story scene is a list of shots. A shot is one picture and the lines spoken over it.
// A line with a `clip` is a short film of that picture in which the character says the line:
// the voice is part of the clip, so the lips match. Every clip starts and ends on the shot's
// still picture, which is why one line can follow another without a jump.
// A line with only a `voice` is heard over the still picture. A shot without a picture is a
// title card. Scenes live in `App/Story/scenes.json`; pictures, clips and voices sit next to it.

struct StoryLine: Codable, Equatable {
    var who: String
    var text: String
    /// A film of the line being spoken (mp4 with sound).
    var clip: String?
    /// The spoken line on its own (m4a), for lines that have no clip.
    var voice: String?
}

struct StoryShot: Codable, Equatable {
    var art: String?
    var lines: [StoryLine]
}

struct StoryScene: Codable, Equatable, Identifiable {
    var id: String
    var shots: [StoryShot]
}

/// Plays one scene by itself, line after line, like a cutscene. A tap skips to the next line.
final class StoryPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    let scene: StoryScene
    @Published private(set) var shotIndex = 0
    @Published private(set) var lineIndex = 0
    @Published private(set) var video: AVQueuePlayer?
    var onEnd: () -> Void = {}

    /// The breath between two lines.
    private static let pause = 0.2

    private var items: [Int: AVPlayerItem] = [:] // line number in the shot -> its clip
    private var voice: AVAudioPlayer?
    private var endObserver: NSObjectProtocol?
    private var waiting: DispatchWorkItem?
    private var started = false
    private var finished = false

    init(scene: StoryScene) {
        self.scene = scene
        super.init()
    }

    deinit {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }

    var shot: StoryShot? { scene.shots.indices.contains(shotIndex) ? scene.shots[shotIndex] : nil }
    var line: StoryLine? {
        guard let shot, shot.lines.indices.contains(lineIndex) else { return nil }
        return shot.lines[lineIndex]
    }

    func start() {
        guard !started else { return }
        started = true
        guard line != nil else { finish(); return }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem, item === self.items[self.lineIndex] else { return }
            self.lineEnded()
        }
        loadShot()
        say()
    }

    func stop() {
        waiting?.cancel()
        waiting = nil
        voice?.stop()
        voice = nil
        video?.pause()
    }

    /// A tap cuts the current line short.
    func tap() {
        guard started, !finished else { return }
        advance()
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        stop()
        onEnd()
    }

    private func advance() {
        waiting?.cancel()
        waiting = nil
        voice?.stop()
        voice = nil
        guard let shot else { finish(); return }
        if lineIndex + 1 < shot.lines.count {
            lineIndex += 1
            say()
        } else if shotIndex + 1 < scene.shots.count {
            shotIndex += 1
            lineIndex = 0
            loadShot()
            say()
        } else {
            finish()
        }
    }

    /// Queues the shot's clips in order, so the next one is ready when its line comes.
    private func loadShot() {
        video?.pause()
        video = nil
        items = [:]
        guard let shot else { return }
        var queue: [AVPlayerItem] = []
        for (i, line) in shot.lines.enumerated() {
            guard let name = line.clip, let url = Bundle.main.url(forResource: name, withExtension: "mp4") else { continue }
            let item = AVPlayerItem(url: url)
            items[i] = item
            queue.append(item)
        }
        guard !queue.isEmpty else { return }
        let player = AVQueuePlayer(items: queue)
        player.actionAtItemEnd = .pause // hold the last frame until the next line starts
        video = player
    }

    private func say() {
        guard let line else { finish(); return }
        if let item = items[lineIndex], let player = video {
            // Step past the clips of lines that were skipped.
            while player.currentItem !== item && player.items().count > 1 { player.advanceToNextItem() }
            if player.currentItem === item {
                player.play()
                return
            }
        }
        video?.pause()
        if let name = line.voice,
           let url = Bundle.main.url(forResource: name, withExtension: "m4a"),
           let sound = try? AVAudioPlayer(contentsOf: url) {
            sound.delegate = self
            voice = sound
            sound.play()
            return
        }
        // Nothing to hear: a card, held long enough to read.
        wait(max(2.2, Double(line.text.count) * 0.07))
    }

    private func lineEnded() {
        wait(Self.pause)
    }

    private func wait(_ seconds: Double) {
        waiting?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.advance() }
        waiting = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === voice else { return }
        lineEnded()
    }
}

/// Shows a player's picture, filling its frame. Clear until the first frame arrives, so the
/// still picture underneath shows through.
struct ClipView: UIViewRepresentable {
    let player: AVPlayer

    final class Surface: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> Surface {
        let view = Surface()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.playerLayer.videoGravity = .resizeAspectFill
        view.playerLayer.player = player
        return view
    }

    func updateUIView(_ view: Surface, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
    }
}
