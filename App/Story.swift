import AVFoundation
import SwiftUI

// A story scene is a list of shots. A shot is one picture, a looping clip of that same picture
// in motion, and the lines spoken over it. A shot without a picture is a title card.
// Scenes live in `App/Story/scenes.json`; pictures, clips and voice files sit next to it.

struct StoryLine: Codable, Equatable {
    var who: String
    var text: String
    var voice: String?
}

struct StoryShot: Codable, Equatable {
    var art: String?
    var clip: String?
    var lines: [StoryLine]
}

struct StoryScene: Codable, Equatable, Identifiable {
    var id: String
    var shots: [StoryShot]
}

/// Plays one scene: shows a shot, speaks a line, waits for a tap, moves on.
final class StoryPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    let scene: StoryScene
    @Published private(set) var shotIndex = 0
    @Published private(set) var lineIndex = 0
    @Published private(set) var speaking = false
    @Published private(set) var video: AVQueuePlayer?
    var onEnd: () -> Void = {}

    private var looper: AVPlayerLooper?
    private var voice: AVAudioPlayer?
    private var started = false

    init(scene: StoryScene) {
        self.scene = scene
        super.init()
    }

    var shot: StoryShot? { scene.shots.indices.contains(shotIndex) ? scene.shots[shotIndex] : nil }
    var line: StoryLine? {
        guard let shot, shot.lines.indices.contains(lineIndex) else { return nil }
        return shot.lines[lineIndex]
    }

    func start() {
        guard !started else { return }
        started = true
        guard line != nil else { onEnd(); return }
        loadShot()
        say()
    }

    func stop() {
        voice?.stop()
        voice = nil
        video?.pause()
    }

    /// A tap cuts the current line short and moves to the next one.
    func tap() {
        guard let shot else { return }
        voice?.stop()
        if lineIndex + 1 < shot.lines.count {
            lineIndex += 1
            say()
        } else if shotIndex + 1 < scene.shots.count {
            shotIndex += 1
            lineIndex = 0
            loadShot()
            say()
        } else {
            stop()
            onEnd()
        }
    }

    private func loadShot() {
        video?.pause()
        looper = nil
        video = nil
        guard let name = shot?.clip, let url = Bundle.main.url(forResource: name, withExtension: "mp4") else { return }
        let player = AVQueuePlayer()
        player.isMuted = true
        looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        video = player
    }

    /// The clip moves while the line is spoken and holds still while the game waits for a tap.
    private func say() {
        voice = nil
        if let name = line?.voice,
           let url = Bundle.main.url(forResource: name, withExtension: "m4a"),
           let player = try? AVAudioPlayer(contentsOf: url) {
            player.delegate = self
            voice = player
            player.play()
            speaking = true
        } else {
            speaking = false
        }
        video?.play()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === voice else { return }
        speaking = false
        video?.pause()
    }
}

/// A view that shows a player's picture, filling its frame.
struct LoopVideo: UIViewRepresentable {
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
