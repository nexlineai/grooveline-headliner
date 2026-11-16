import AVFoundation
import SwiftUI
import UIKit

// A lesson is a short list of steps played in the booth. In every step the coach says a line
// (a voice over the room, the eyes stay on the decks), the screen names one thing to do and
// points at the control, and the step is over when the decks show it was done.

/// The control a step points at.
enum LessonTarget: Equatable {
    case play(Int), cue(Int), crossfader
}

/// What has to happen before the lesson moves on.
enum LessonGoal: Equatable {
    /// The deck's record is turning.
    case startDeck(Int)
    /// This many bars of deck A go by.
    case bars(Int)
    /// `deck` is started so that its bars begin with the bars of `against`.
    case startOnTheOne(deck: Int, against: Int)
    /// The crossfader is in this part of its travel (0 = left, 1 = right).
    case crossfader(ClosedRange<Double>)
    /// The deck's motor is off.
    case stopDeck(Int)
    /// Nothing to do: the step ends with the coach's line.
    case listen
}

struct LessonStep {
    var voice: String
    var text: String
    /// The thing to do, in a few words.
    var task: String
    var goal: LessonGoal
    var target: LessonTarget?
    /// Said when the goal was tried and missed, with what to do about it.
    var missVoice: String?
    var missText: String?
    var missTask: String?
    var missTarget: LessonTarget?
}

struct Lesson {
    var id: String
    var number: Int
    var title: String
    var coach: String
    var steps: [LessonStep]
}

enum Lessons {
    static func find(_ id: String) -> Lesson? { all.first { $0.id == id } }

    static let all: [Lesson] = [firstMix]

    /// Lesson 1, in the bedroom with Tó: start a record, hear the bar, bring the second record in
    /// on the one, crossfade. SYNC holds the tempo; that comes off in the record shop.
    static let firstMix = Lesson(id: "first-mix", number: 1, title: "FIRST MIX", coach: "TÓ", steps: [
        LessonStep(voice: "first-mix-01",
                   text: "Okay. Six people in your room, and nobody is dancing. Fix it. Press play on the left deck.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "first-mix-02",
                   text: "There we go. Hear the kick? One, two, three, four. That's a bar. The four little lamps count it for you. Let four bars go by.",
                   task: "LISTEN: COUNT FOUR BARS", goal: .bars(4), target: nil),
        LessonStep(voice: "first-mix-03",
                   text: "Now the second record. Records are built in blocks, and every block starts on the one. Wait for the first lamp, then press play on the right deck. Right on the one.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "first-mix-03-miss",
                   missText: "Nope. That was not the one. Press cue on the right deck, wait for the first lamp, and go again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "first-mix-04",
                   text: "Yes! Right on it. Nobody can hear it yet, the crossfader is all the way left. And the sync button keeps the two in time. For now.",
                   task: "ON THE ONE", goal: .listen, target: nil),
        LessonStep(voice: "first-mix-05",
                   text: "Now bring it in. Slide the crossfader to the middle. Slowly.",
                   task: "CROSSFADER TO THE MIDDLE", goal: .crossfader(0.42...0.58), target: .crossfader),
        LessonStep(voice: "first-mix-06",
                   text: "Hear that? Two records, one beat. That's a mix.",
                   task: "TWO RECORDS, ONE BEAT", goal: .listen, target: nil),
        LessonStep(voice: "first-mix-07",
                   text: "Now go all the way to the right, and let the first record go.",
                   task: "CROSSFADER ALL THE WAY RIGHT", goal: .crossfader(0.96...1), target: .crossfader),
        LessonStep(voice: "first-mix-08",
                   text: "And stop the left deck.",
                   task: "STOP THE LEFT DECK", goal: .stopDeck(0), target: .play(0)),
        LessonStep(voice: "first-mix-09",
                   text: "Your first mix! And look. Sara is dancing.",
                   task: "FIRST MIX", goal: .listen, target: nil),
    ])
}

/// What the lesson needs to know about the decks, read once a frame.
struct BoothFacts {
    var motorOn: [Bool]
    /// The record is up to speed.
    var turning: [Bool]
    /// Needle position in beats on each record's own grid.
    var beat: [Double]
    var cross: Double
}

/// Walks through a lesson. The booth scene feeds it `BoothFacts` every frame; the overlay shows
/// what it publishes.
final class LessonRunner: NSObject, ObservableObject, AVAudioPlayerDelegate {
    let lesson: Lesson
    @Published private(set) var caption = ""
    @Published private(set) var task = ""
    @Published private(set) var progress = ""
    @Published private(set) var taskDone = false
    /// Set when the lesson is over: 1 to 3.
    @Published private(set) var stars: Int?
    /// The control to point at right now.
    private(set) var target: LessonTarget?
    /// The coach is talking (the music steps back a little).
    private(set) var speaking = false

    private var index = 0
    private var started = false
    private var goalMet = false
    private var missed = false
    private var misses = 0
    private var oneError = 0.0
    private var startBeat: Double?
    private var wasOn = [false, false]
    private var armed = false
    private var fresh = true
    private var voice: AVAudioPlayer?
    private let buzz = UINotificationFeedbackGenerator()

    init(lesson: Lesson) {
        self.lesson = lesson
        super.init()
    }

    func begin() {
        guard !started, !lesson.steps.isEmpty else { return }
        started = true
        enter(0)
    }

    func stop() {
        voice?.stop()
        voice = nil
        speaking = false
    }

    private func enter(_ i: Int) {
        index = i
        goalMet = false
        missed = false
        armed = false
        fresh = true
        startBeat = nil
        let step = lesson.steps[i]
        show(text: step.text, task: step.task, target: step.target)
        say(step.voice)
    }

    private func show(text: String, task newTask: String, target newTarget: LessonTarget?) {
        caption = text
        task = newTask
        progress = ""
        taskDone = false
        target = newTarget
    }

    private func say(_ name: String) {
        voice?.stop()
        voice = nil
        speaking = false
        guard let url = Bundle.main.url(forResource: name, withExtension: "m4a"),
              let player = try? AVAudioPlayer(contentsOf: url) else { return }
        player.delegate = self
        voice = player
        speaking = player.play()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if player === voice { speaking = false }
    }

    private func met() {
        goalMet = true
        taskDone = true
        target = nil
        buzz.notificationOccurred(.success)
    }

    func update(_ facts: BoothFacts) {
        guard started, stars == nil, lesson.steps.indices.contains(index) else { return }
        let step = lesson.steps[index]
        if !goalMet {
            switch step.goal {
            case .startDeck(let d):
                if facts.turning[d] { met() }
            case .bars(let n):
                if facts.turning[0] {
                    let from = startBeat ?? facts.beat[0]
                    startBeat = from
                    let gone = max(0, (facts.beat[0] - from) / 4)
                    let text = "BAR \(min(n, Int(gone) + 1)) OF \(n)"
                    if text != progress { progress = text }
                    if gone >= Double(n) { met() }
                }
            case .startOnTheOne(let deck, let against):
                if fresh && facts.motorOn[deck] {
                    // Already running when the step began: it has to be stopped first.
                    missed = true
                    show(text: step.text, task: step.missTask ?? step.task, target: step.missTarget ?? step.target)
                }
                if facts.motorOn[deck] && !wasOn[deck] { armed = true }
                if !facts.motorOn[deck] {
                    armed = false
                    if missed {
                        // Stopped after a miss: back to the instruction, ready for another go.
                        missed = false
                        show(text: step.text, task: step.task, target: step.target)
                    }
                }
                if armed && facts.turning[deck] && facts.turning[against] {
                    // Up to speed: where do its bars fall against the other record's bars?
                    armed = false
                    var apart = (facts.beat[against] - facts.beat[deck]).truncatingRemainder(dividingBy: 4)
                    if apart < 0 { apart += 4 }
                    let error = min(apart, 4 - apart)
                    if error <= 0.4 {
                        oneError = error
                        met()
                    } else {
                        misses += 1
                        missed = true
                        buzz.notificationOccurred(.warning)
                        show(text: step.missText ?? step.text, task: step.missTask ?? step.task, target: step.missTarget ?? step.target)
                        if let name = step.missVoice { say(name) }
                    }
                }
            case .crossfader(let range):
                if range.contains(facts.cross) { met() }
            case .stopDeck(let d):
                if !facts.motorOn[d] { met() }
            case .listen:
                if !speaking { met() }
            }
        }
        wasOn = facts.motorOn
        fresh = false
        // Done early? The coach still finishes the sentence.
        if goalMet && !speaking {
            if index + 1 < lesson.steps.count {
                enter(index + 1)
            } else {
                finish()
            }
        }
    }

    private func finish() {
        // Stars for the one thing that took skill: how close to the one, and on which try.
        let earned: Int
        if misses == 0 && oneError <= 0.15 {
            earned = 3
        } else if misses <= 1 && oneError <= 0.3 {
            earned = 2
        } else {
            earned = 1
        }
        target = nil
        stars = earned
    }

    /// One line about how the start on the one went, for the result card.
    var verdict: String {
        let tries = misses == 0 ? "first try" : (misses == 1 ? "second try" : "try \(misses + 1)")
        let how = oneError <= 0.15 ? "Right on the one" : (oneError <= 0.3 ? "Close to the one" : "Near the one")
        return "\(how), \(tries)"
    }
}

/// What the lesson shows over the room: the thing to do on top, the coach's words just above the gear.
struct LessonOverlay: View {
    @ObservedObject var runner: LessonRunner
    /// Height of the room above the gear, from the top of this view.
    let roomHeight: CGFloat
    let onContinue: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            if let stars = runner.stars {
                result(stars)
            } else {
                VStack(spacing: 0) {
                    chip
                    Spacer(minLength: 4)
                    words
                }
                .padding(.top, 8)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity)
                .frame(height: max(60, roomHeight))
                .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.easeOut(duration: 0.2), value: runner.taskDone)
    }

    private var chip: some View {
        let colour = runner.taskDone ? GroovelineLogo.teal : Color(Palette.orange)
        return HStack(spacing: 8) {
            Image(systemName: runner.taskDone ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 12, weight: .bold))
            Text(runner.task)
                .font(.system(size: 11, weight: .heavy))
                .tracking(1.5)
            if !runner.progress.isEmpty {
                Text(runner.progress)
                    .font(.system(size: 11, weight: .heavy).monospacedDigit())
                    .foregroundStyle(.white)
            }
        }
        .foregroundStyle(colour)
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(Capsule().fill(.black.opacity(0.72)))
        .overlay(Capsule().stroke(colour.opacity(0.6), lineWidth: 1))
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(runner.lesson.coach)
                .font(.system(size: 10, weight: .heavy))
                .tracking(3)
                .foregroundStyle(GroovelineLogo.teal)
            Text(runner.caption)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: 560, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(.black.opacity(0.66)))
    }

    private func result(_ stars: Int) -> some View {
        VStack(spacing: 10) {
            Text("LESSON \(runner.lesson.number)")
                .font(.system(size: 12, weight: .heavy))
                .tracking(5)
                .foregroundStyle(GroovelineLogo.teal)
            Text(runner.lesson.title)
                .font(.custom("Orbitron-Black", size: 38))
                .tracking(3)
                .foregroundStyle(.white)
            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    Image(systemName: i < stars ? "star.fill" : "star")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(i < stars ? Color(Palette.orange) : .white.opacity(0.3))
                }
            }
            Text(runner.verdict)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.75))
            Button(action: onContinue) {
                Text("CONTINUE")
                    .font(.system(size: 15, weight: .heavy))
                    .tracking(5)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 40)
                    .padding(.vertical, 12)
                    .background(Capsule().fill(GroovelineLogo.teal))
            }
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.72).ignoresSafeArea())
    }
}
