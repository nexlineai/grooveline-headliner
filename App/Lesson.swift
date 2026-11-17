import AVFoundation
import SwiftUI
import UIKit
import HeadlinerCore

// A lesson is a short list of steps played in the booth. In every step the coach says a line
// (a voice over the room, the eyes stay on the decks), the screen names one thing to do and
// points at the control, and the step is over when the decks show it was done.

/// The control a step points at.
enum LessonTarget: Equatable {
    case play(Int), cue(Int), crossfader, channel(Int)
    /// An EQ knob: deck, band (0 low, 1 mid, 2 high).
    case eq(Int, Int)
    /// The PHONES button of a mixer channel, and the cue mix knob between them.
    case phones(Int), cueMixKnob
    /// A pitch fader, and a whole record (for the rim).
    case pitch(Int), record(Int)
    /// A SYNC button, the CRATE button and the JINGLE button (top right).
    case sync(Int), crate, jingle
    /// The filter knob under a channel's EQ.
    case filter(Int)
}

/// What has to happen before the lesson moves on.
enum LessonGoal: Equatable {
    /// The deck's record is turning.
    case startDeck(Int)
    /// This many bars of deck A go by.
    case bars(Int)
    /// `deck` is started so that its bars begin with the bars of `against`.
    case startOnTheOne(deck: Int, against: Int)
    /// Deck A plays on into its next phrase (eight bars).
    case nextPhrase
    /// `deck` is started so that its phrases (eight bars) begin with the phrases of `against`.
    case startOnThePhrase(deck: Int, against: Int)
    /// The deck's channel fader is in this part of its travel (0 = down, 1 = up). With
    /// `onThePhrase`, the result card says whether it got there near a phrase change.
    case channelFader(Int, ClosedRange<Double>, onThePhrase: Bool)
    /// The crossfader is in this part of its travel (0 = left, 1 = right).
    case crossfader(ClosedRange<Double>)
    /// An EQ knob of `deck` is in this part of its travel (0 = killed, 0.5 = flat, 1 = boosted).
    case eq(deck: Int, band: Int, ClosedRange<Double>)
    /// The bass swap: the low of `from` is down and the low of `to` is back in the middle.
    /// The result card says whether that happened near a phrase change.
    case bassSwap(from: Int, to: Int)
    /// The headphone output is switched on in the PHONES panel (split, or a sound card).
    case phonesReady
    /// The deck's PHONES button is on.
    case phonesCue(Int)
    /// The cue mix knob is in this part of its travel (0 = only the cued record, 1 = only the room).
    case cueMix(ClosedRange<Double>)
    /// The station jingle is fired (with `onThePhrase`, within a bar of a phrase change).
    case jinglePlayed(onThePhrase: Bool)
    /// A countdown of `seconds`: both channel faders must be down within `window` seconds of zero.
    case hitThePost(seconds: Double, window: Double)
    /// This record is on that deck.
    case recordLoaded(deck: Int, id: String)
    /// One of the `good` records is put on that deck; any other record put there is a miss.
    case pickRecord(deck: Int, good: [String])
    /// The deck's SYNC is on.
    case syncOn(Int)
    /// Both records heard together, kicks within `tolerance` of a beat and one bassline, for this
    /// many bars in all (a slip pauses the count; it does not start it again).
    case blendHeld(bars: Int, tolerance: Double)
    /// Both records play at the same tempo, within `tolerance` BPM (pitch faders, no sync).
    case tempoMatched(tolerance: Double)
    /// The kicks land together (within `tolerance` of a beat) for this many bars in a row.
    case phaseHeld(bars: Int, tolerance: Double = 0.07)
    /// The deck's filter knob is in this part of its travel (0 = low-pass closed, 0.5 = off,
    /// 1 = high-pass all the way up).
    case filter(deck: Int, ClosedRange<Double>)
    /// The deck's tempo is brought down to `to` BPM with its pitch fader, never more than 1.5 BPM
    /// within one bar (faster and the room feels the brakes: a miss, then carry on).
    case rideTempo(deck: Int, to: Double)
    /// The studio's pattern: exactly these steps (0-based) are on in this row (0 kick, 1 clap,
    /// 2 hat, 3 bass, 4 chord).
    case pattern(row: Int, steps: [Int])
    /// The step grid shows this page (0 drums, 1 synth).
    case studioPage(Int)
    /// A dubplate is cut (CUT on the grid).
    case dubplateCut
    /// The crossfader goes all the way right; the result card says whether it was on a phrase
    /// change of the left record (a cut between records that do not fit).
    case crossfaderCut
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
    /// For a step that can also be missed the other way (too late): what is said then.
    var lateVoice: String?
    var lateText: String?
}

/// How the desk is set when a lesson starts (both records stopped on their first beat).
struct LessonDesk {
    var crossfader = 0.0
    var channel = [0.85, 0.85]
    var sync = [false, true]
    /// Where the cue mix knob starts, when the lesson cares.
    var cueMix: Double?
    /// The room above the gear: `room-<room>.jpg` and its mood loops.
    var room = "bedroom"
    /// False on vinyl: the SYNC buttons are dim and do nothing.
    var syncAllowed = true
    /// The records on the left and right decks (ids); nil = the first two records.
    var records: [String]?
    /// The crate is open to the player (records up to `chapter`).
    var crate = false
    var chapter = 1
    /// Ear training: no BPM readouts, no phase dot, no verdict word.
    var hideBPM = false
    /// Where the pitch faders start (0...1, 0.5 = middle, 1 = top = slowest); nil = middle.
    var pitch: [Double]?
    /// The records you brought (ids): the crate shows only these. nil = the whole chapter.
    var bag: [String]?
    /// Where every record in this lesson is cued, in bars from its first beat (also records put
    /// on from the crate): past the drum intro, where the music is. nil = the first beat.
    var cueBar: Int?
    /// The studio: the step grid over the room, and the left deck plays what it says.
    var studio = false
    /// The pattern a studio lesson starts from (nil: empty).
    var pattern: DrumPattern?
    /// The grid has a CUT button (the loop becomes a whole record).
    var cutter = false
    /// A channel fader that is broken in this booth (stuck where the desk sets it).
    var deadFader: Int?
    /// A festival field: the room also hears the far speakers this many seconds late (not the
    /// headphones, like a DJ's monitors). 0 = no echo.
    var echo: Double = 0
}

struct Lesson {
    var id: String
    var number: Int
    var title: String
    var coach: String
    var desk = LessonDesk()
    var steps: [LessonStep]
}

enum Lessons {
    static func find(_ id: String) -> Lesson? { all.first { $0.id == id } }

    static let all: [Lesson] = [firstMix, onThePhrase, bassSwap, inYourEars, requests, syncOff, byEar, holdIt, longBlend, onAir, warmUp, keys, filterMix, tempo, drums, synth, dubplate, borrowedBooth, genreSwitch, delay]

    /// Lesson 20, chapter 10, a festival stage: the far speakers come back late. Beatmatch to the
    /// first hit (the monitors), never to the echo.
    static let delay = Lesson(id: "delay", number: 20, title: "THE DELAY", coach: "HELENA",
                              desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0.45], sync: [false, false], room: "festival",
                                               syncAllowed: false, records: ["floresta", "tenda"], chapter: 10, echo: 0.14), steps: [
        LessonStep(voice: "delay-01",
                   text: "A festival stage. The speakers out in the field are far away, so what comes back is late. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "delay-02",
                   text: "Hear the echo? That's the field, a seventh of a second behind. Never mix to the echo. Mix to the first hit, the one from your monitors. Start the right one on the one.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "filter-04-miss", missText: "Not the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "delay-03",
                   text: "Its fader is up halfway so you can hear it. It's faster: bring the right pitch fader up until both say 122.",
                   task: "RIGHT PITCH FADER UP UNTIL BOTH SAY 122.0", goal: .tempoMatched(tolerance: 0.3), target: .pitch(1)),
        LessonStep(voice: "delay-04",
                   text: "Lock the kicks. Listen to the first kick, not the echo.",
                   task: "NUDGE THE RIGHT RECORD UNTIL THE KICKS ARE ONE", goal: .phaseHeld(bars: 4), target: .record(1)),
        LessonStep(voice: "delay-05",
                   text: "Right fader all the way up.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "delay-06",
                   text: "And the left one out, on the phrase.",
                   task: "LEFT CHANNEL FADER DOWN, AT THE NEXT PHRASE", goal: .channelFader(0, 0...0.04, onThePhrase: true), target: .channel(0)),
        LessonStep(voice: "delay-07",
                   text: "Out there, ten thousand people heard that late, and perfect. That's a big stage.",
                   task: "THE DELAY", goal: .listen, target: nil),
    ])

    /// Lesson 19, chapter 9, an Ibiza terrace: two records that do not fit (126 / 120, keys apart)
    /// are not blended. Thin the old one with the filter, start the new one on its drums-only
    /// intro on the phrase, and cut across on the next phrase.
    static let genreSwitch = Lesson(id: "genre-switch", number: 19, title: "GENRE SWITCH", coach: "TÓ",
                                    desk: LessonDesk(crossfader: 0, channel: [0.85, 0.85], sync: [false, false], room: "ibiza",
                                                     records: ["canal", "sal"], chapter: 9), steps: [
        LessonStep(voice: "switch-01",
                   text: "Ibiza, sunset. Canal is Amsterdam, 126. The terrace wants Sal: Balearic, 120, another key. You can't blend those. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "switch-02",
                   text: "When two records don't fit, you don't blend them. You hand over. First, thin the left one out: its filter up, about halfway.",
                   task: "LEFT FILTER UP, ABOUT HALFWAY", goal: .filter(deck: 0, 0.68...0.9), target: .filter(0)),
        LessonStep(voice: "switch-03",
                   text: "Now start Sal on a new phrase. The crossfader is left, so nobody hears it yet.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "phrase-03-miss",
                   missText: "Close, but that was the middle of a phrase. Press cue on the right deck, and wait for the whoosh.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "switch-04",
                   text: "Now the cut. On the next phrase, crossfader all the way right, in one move.",
                   task: "AT THE NEXT PHRASE: CROSSFADER ALL THE WAY RIGHT", goal: .crossfaderCut, target: .crossfader),
        LessonStep(voice: "switch-05",
                   text: "Sal's intro takes over, and the terrace never heard the key change. When records don't fit, cut on the phrase.",
                   task: "GENRE SWITCH", goal: .listen, target: nil),
    ])

    /// Lesson 18, chapter 9, Joli's booth in Berlin: the left channel fader is dead (stuck at
    /// full), so the mix is done with the crossfader and the EQ.
    static let borrowedBooth = Lesson(id: "borrowed-booth", number: 18, title: "BORROWED BOOTH", coach: "TÓ",
                                      desk: LessonDesk(crossfader: 0, channel: [0.85, 0.85], sync: [false, false], room: "berlin",
                                                       syncAllowed: false, records: ["berlim", "cave"], chapter: 9, deadFader: 0), steps: [
        LessonStep(voice: "booth-01",
                   text: "Berlin. Joli's booth. The left channel fader is dead, stuck at full. So tonight you mix with the crossfader. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "booth-02",
                   text: "The crossfader is all the way left, so nobody hears the right deck. Start it on the one.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "first-mix-03-miss",
                   missText: "Nope. That was not the one. Press cue on the right deck, wait for the first lamp, and go again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "booth-03",
                   text: "It's slower. Bring the right pitch fader down until both say 130.",
                   task: "RIGHT PITCH FADER DOWN UNTIL BOTH SAY 130.0", goal: .tempoMatched(tolerance: 0.3), target: .pitch(1)),
        LessonStep(voice: "booth-04",
                   text: "Lock the kicks with the rim.",
                   task: "NUDGE THE RIGHT RECORD UNTIL THE KICKS ARE ONE", goal: .phaseHeld(bars: 4), target: .record(1)),
        LessonStep(voice: "booth-05",
                   text: "Now the crossfader to the middle. Slowly.",
                   task: "CROSSFADER TO THE MIDDLE", goal: .crossfader(0.42...0.58), target: .crossfader),
        LessonStep(voice: "booth-06",
                   text: "Two basslines. Take the left low down, on the phrase.",
                   task: "AT THE NEXT PHRASE: LEFT LOW DOWN", goal: .bassSwap(from: 0, to: 1), target: .eq(0, 0)),
        LessonStep(voice: "booth-07",
                   text: "Crossfader all the way right.",
                   task: "CROSSFADER ALL THE WAY RIGHT", goal: .crossfader(0.96...1), target: .crossfader),
        LessonStep(voice: "booth-08",
                   text: "Every booth is broken somewhere. The good ones mix anyway.",
                   task: "BORROWED BOOTH", goal: .listen, target: nil),
    ])

    /// Lesson 17, chapter 8: CUT turns the loop into a whole record (intro, groove, full, break,
    /// full, outro), kept with the progress and put in the crate.
    static let dubplate = Lesson(id: "dubplate", number: 17, title: "DUBPLATE", coach: "LIA",
                                 desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, false], room: "bedroom",
                                                  chapter: 8, studio: true, pattern: .track, cutter: true), steps: [
        LessonStep(voice: "plate-01",
                   text: "This is your loop. One bar, over and over. A record needs more than that: an intro, a build, a break. Press play.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "plate-02",
                   text: "On the left of the grid there's a CUT button. It cuts your loop onto a dubplate: a whole record. Tap it.",
                   task: "TAP CUT (LEFT OF THE GRID)", goal: .dubplateCut, target: nil),
        LessonStep(voice: "plate-03",
                   text: "Cut. Play it from the top.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "plate-04",
                   text: "Listen. Only kick and hats in the intro. Then the clap and the bass. Then everything, a break with the chords, and back. That's an arrangement.",
                   task: "LISTEN: YOUR RECORD", goal: .listen, target: nil),
        LessonStep(voice: "plate-05",
                   text: "It's in your crate now. One copy, nobody else has it. Saturday, we play it at CAVE.",
                   task: "DUBPLATE", goal: .listen, target: nil),
    ])

    /// Lesson 16, chapter 8: bass and chords on the SYNTH page, over the house drums. The bass
    /// goes where the kick is not; one on the kick shows why; chord stabs just before the clap.
    static let synth = Lesson(id: "synth", number: 16, title: "BASS AND CHORDS", coach: "LIA",
                              desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, false], room: "bedroom",
                                               chapter: 8, studio: true, pattern: .house), steps: [
        LessonStep(voice: "synth-01",
                   text: "Your drums are still here. Press play.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "synth-02",
                   text: "Now the notes. Tap SYNTH, on the left of the grid.",
                   task: "TAP SYNTH (LEFT OF THE GRID)", goal: .studioPage(1), target: nil),
        LessonStep(voice: "synth-03",
                   text: "The bass goes where the kick isn't. Between the kicks: steps 3, 7, 11 and 15.",
                   task: "BASS ON 3, 7, 11 AND 15", goal: .pattern(row: 3, steps: [2, 6, 10, 14]), target: nil),
        LessonStep(voice: "synth-04",
                   text: "Now add one on step 1, with the kick. Listen.",
                   task: "ADD A BASS NOTE ON STEP 1", goal: .pattern(row: 3, steps: [0, 2, 6, 10, 14]), target: nil),
        LessonStep(voice: "synth-05",
                   text: "Hear the thump go muddy? Kick and bass, fighting for the same space. Take it off again.",
                   task: "TAKE THE BASS OFF STEP 1", goal: .pattern(row: 3, steps: [2, 6, 10, 14]), target: nil),
        LessonStep(voice: "synth-06",
                   text: "Chords. A stab on steps 4 and 12, just before the clap. It pushes the groove forward.",
                   task: "CHORD ON 4 AND 12", goal: .pattern(row: 4, steps: [3, 11]), target: nil),
        LessonStep(voice: "synth-07",
                   text: "Drums, bass, chords. That's a track. Next, we make it a record.",
                   task: "BASS AND CHORDS", goal: .listen, target: nil),
    ])

    /// Lesson 15, chapter 8, the studio: a drum machine. Three rows, sixteen steps, one bar; the
    /// left deck plays the pattern as a record. Four on the floor, the clap on two and four, the
    /// hats in between.
    static let drums = Lesson(id: "drums", number: 15, title: "DRUMS", coach: "LIA",
                              desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, false], room: "bedroom",
                                               chapter: 8, studio: true), steps: [
        LessonStep(voice: "drums-01",
                   text: "Playing other people's records is half of it. Now make your own. This is a drum machine: three rows, sixteen steps, one bar. Press play on the left deck.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "drums-02",
                   text: "Nothing yet. Tap the kick on every beat: steps 1, 5, 9 and 13. Four on the floor.",
                   task: "KICK ON 1, 5, 9 AND 13", goal: .pattern(row: 0, steps: [0, 4, 8, 12]), target: nil),
        LessonStep(voice: "drums-03",
                   text: "Now the clap, on two and four. Steps 5 and 13.",
                   task: "CLAP ON 5 AND 13", goal: .pattern(row: 1, steps: [4, 12]), target: nil),
        LessonStep(voice: "drums-04",
                   text: "And the hats, between the kicks. Steps 3, 7, 11 and 15. The off-beat.",
                   task: "HATS ON 3, 7, 11 AND 15", goal: .pattern(row: 2, steps: [2, 6, 10, 14]), target: nil),
        LessonStep(voice: "drums-05",
                   text: "Hear that? That's a groove. Every house record you love started exactly like this.",
                   task: "DRUMS", goal: .listen, target: nil),
    ])

    /// Lesson 14, chapter 7, six in the morning: the tempo comes down. Manhã (120) comes in pushed
    /// up to 128 by SYNC, on its drums-only intro (no notes to clash while it is out of tune),
    /// then its pitch is ridden down to 120, a little every bar.
    static let tempo = Lesson(id: "tempo", number: 14, title: "TEMPO", coach: "LIA",
                              desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, true], room: "cave",
                                               records: ["oito-oito", "manha"], chapter: 7), steps: [
        LessonStep(voice: "tempo-01",
                   text: "Six in the morning. The ones still here want to float, not run. We're going from 128 down to 120, and nobody's going to notice. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "tempo-02",
                   text: "The right one is Manhã. It's 120, but sync has pushed it up to 128. Start it on the one. Its fader is down.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "ear-02-miss", missText: "Not the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "tempo-03",
                   text: "Its intro is only drums. No notes to fight, so being pushed up doesn't hurt. Fader up.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "tempo-04",
                   text: "Left one out, at the next phrase.",
                   task: "LEFT CHANNEL FADER DOWN, AT THE NEXT PHRASE", goal: .channelFader(0, 0...0.04, onThePhrase: true), target: .channel(0)),
        LessonStep(voice: "tempo-05",
                   text: "Now the slow part. Push the right pitch fader up, towards 120. A little every bar. Finger to the side for small moves.",
                   task: "RIGHT PITCH FADER UP TO 120, A LITTLE EVERY BAR", goal: .rideTempo(deck: 1, to: 120), target: .pitch(1),
                   missVoice: "tempo-05-miss", missText: "Too fast! Everyone felt the brakes. Slower. A little every bar."),
        LessonStep(voice: "tempo-06",
                   text: "120. Nobody noticed, and everybody's floating. That's an afterhours.",
                   task: "TEMPO", goal: .listen, target: nil),
    ])

    /// Lesson 13, chapter 7, Helena watches the first Friday: the filter. Sink a record with the
    /// low-pass and bring it back; bring the next one in thin (high-pass), thin the old one out
    /// and open the new one: the bass changes hands through the filters.
    static let filterMix = Lesson(id: "filter", number: 13, title: "FILTER", coach: "HELENA",
                                  desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, true], room: "cavepeak",
                                                   records: ["residente", "portao"], chapter: 7, cueBar: 16), steps: [
        LessonStep(voice: "filter-01",
                   text: "Your first Friday. I'll stay for the first hour. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "filter-02",
                   text: "See the knob at the bottom, under the EQ? The filter. Drag it down, all the way. Hear the record sink, like it's under water? That's a low-pass.",
                   task: "LEFT FILTER ALL THE WAY DOWN", goal: .filter(deck: 0, 0...0.08), target: .filter(0)),
        LessonStep(voice: "filter-03",
                   text: "Now bring it back up to the middle. Slowly. Let the room feel it open.",
                   task: "LEFT FILTER BACK TO THE MIDDLE", goal: .filter(deck: 0, 0.47...0.53), target: .filter(0)),
        LessonStep(voice: "filter-04",
                   text: "The right one now, on the one. Its fader is down, and sync is on.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "filter-04-miss", missText: "Not the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "filter-05",
                   text: "Before anyone hears it, drag its filter up, all the way. High-pass. Only the hats get through.",
                   task: "RIGHT FILTER ALL THE WAY UP", goal: .filter(deck: 1, 0.92...1), target: .filter(1)),
        LessonStep(voice: "filter-06",
                   text: "Fader up. Nothing fights: it has no bass yet.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "filter-07",
                   text: "Now the swap. Drag the left filter up, all the way. It thins out and lets go of the bass.",
                   task: "LEFT FILTER ALL THE WAY UP", goal: .filter(deck: 0, 0.92...1), target: .filter(0)),
        LessonStep(voice: "filter-08",
                   text: "And open the right one. Its filter back down to the middle. The bass is all theirs now.",
                   task: "RIGHT FILTER BACK TO THE MIDDLE", goal: .filter(deck: 1, 0.47...0.53), target: .filter(1)),
        LessonStep(voice: "filter-09",
                   text: "Left fader down, at the next phrase.",
                   task: "LEFT CHANNEL FADER DOWN, AT THE NEXT PHRASE", goal: .channelFader(0, 0...0.04, onThePhrase: true), target: .channel(0)),
        LessonStep(voice: "filter-10",
                   text: "Double tap the left filter to put it back in the middle, for next time.",
                   task: "DOUBLE TAP THE LEFT FILTER", goal: .filter(deck: 0, 0.47...0.53), target: .filter(0)),
        LessonStep(voice: "filter-11",
                   text: "That's a filter mix. Use it like salt. A little, and not on everything.",
                   task: "FILTER", goal: .listen, target: nil),
    ])

    /// Lesson 12, chapter 7, CAVE on a Friday: keys. Two records at the same tempo in keys that
    /// fight, then one that is a neighbour on the Camelot wheel. All at 128 BPM: the decks have no
    /// key lock, so a record pitched to another tempo would also sound out of tune.
    static let keys = Lesson(id: "keys", number: 12, title: "KEYS", coach: "LIA",
                             desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0.85], sync: [false, true], room: "cavepeak",
                                              records: ["oito-oito", "sem-lista"], crate: true, chapter: 7,
                                              bag: ["oito-oito", "sem-lista", "madrugada", "cave", "seguranca", "sinal"],
                                              cueBar: 40), steps: [
        LessonStep(voice: "keys-01",
                   text: "Friday, peak time. CAVE has club players, so sync is back. Today isn't about your hands. It's about your ears. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "keys-02",
                   text: "Now the right one, on the one. Both faders are up.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "ear-02-miss", missText: "Not the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "keys-03",
                   text: "Hear that? Same beat, but the notes fight. Sour. Oito Oito is in E flat minor, Sem Lista is in A minor. They will never agree.",
                   task: "LISTEN: THE NOTES FIGHT", goal: .listen, target: nil),
        LessonStep(voice: "keys-04",
                   text: "Stop the right one.",
                   task: "STOP THE RIGHT DECK", goal: .stopDeck(1), target: .play(1)),
        LessonStep(voice: "keys-05",
                   text: "Open the crate. Every sleeve has a key, a number and a letter. Oito Oito is 2A. Its friends sit next to it on the wheel: 1A, 3A, or 2B, the same number with the other letter. Find one.",
                   task: "CRATE: A 1A, 3A OR 2B ON THE RIGHT DECK", goal: .pickRecord(deck: 1, good: ["madrugada"]), target: .crate,
                   missVoice: "keys-05-miss", missText: "That one fights. Look for a 1A, a 3A, or a 2B."),
        LessonStep(voice: "keys-06",
                   text: "Madrugada. 2B, and 128, like Oito Oito. Speed a record up and its notes go up too, so the tempo has to be close. Start it on the one.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "ear-02-miss", missText: "Not the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "keys-07",
                   text: "Hear that? Same beat, and now the notes agree. That's mixing in key.",
                   task: "LISTEN: THE NOTES AGREE", goal: .listen, target: nil),
        LessonStep(voice: "keys-08",
                   text: "Take the left one out at the next phrase.",
                   task: "LEFT CHANNEL FADER DOWN, AT THE NEXT PHRASE", goal: .channelFader(0, 0...0.04, onThePhrase: true), target: .channel(0)),
        LessonStep(voice: "keys-09",
                   text: "The numbers help. But your ears heard it first.",
                   task: "KEYS", goal: .listen, target: nil),
    ])

    /// The six records packed for CAVE.
    static let caveBag = ["porta", "seguranca", "fila", "luz-vermelha", "sem-lista", "cave"]

    /// Lesson 11, chapter 6, club CAVE at midnight: the warm-up. Of the six records in the bag,
    /// pick the one that is only a step up (the others are for two in the morning), bring it down
    /// to the room's tempo, lock it, swap.
    static let warmUp = Lesson(id: "warm-up", number: 11, title: "WARM-UP", coach: "LIA",
                               desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0.45], sync: [false, false], room: "cave",
                                                syncAllowed: false, records: ["porta", "sem-lista"], crate: true, chapter: 6,
                                                bag: caveBag), steps: [
        LessonStep(voice: "warm-01",
                   text: "CAVE. I played here in ninety-four. At two in the morning there'll be nine hundred people in this cellar. Right now there's thirty, and they haven't decided to stay. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "warm-02",
                   text: "Look what's on the right deck. Sem Lista. That's a two o'clock record. You're the warm-up, kid. Make them want the headliner. Don't try to be her. Tap CRATE.",
                   task: "TAP CRATE (TOP RIGHT)", goal: .listen, target: .crate),
        LessonStep(voice: "warm-03",
                   text: "Pick the next one. Not the biggest. One step up from what's playing. Read the sleeves.",
                   task: "CRATE: ONE STEP UP, ON THE RIGHT DECK", goal: .pickRecord(deck: 1, good: ["fila"]), target: .crate,
                   missVoice: "warm-03-miss",
                   missText: "Too hot. That's a record for two in the morning. Find the one that's only a little warmer."),
        LessonStep(voice: "warm-04",
                   text: "Fila. A little faster, a little warmer. Start it on a new phrase. Its fader is halfway, so you can hear it.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "warm-04-miss",
                   missText: "Middle of a phrase. Cue it, wait for the whoosh, and go again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "warm-05",
                   text: "It's faster than the room. Push the right pitch fader up until both say a hundred and twenty two. Warm-ups don't rush.",
                   task: "RIGHT PITCH FADER UP UNTIL BOTH SAY 122.0", goal: .tempoMatched(tolerance: 0.3), target: .pitch(1)),
        LessonStep(voice: "warm-06",
                   text: "Now lock the kicks with the rim.",
                   task: "NUDGE THE RIGHT RECORD UNTIL THE KICKS ARE ONE", goal: .phaseHeld(bars: 2, tolerance: 0.08), target: .record(1)),
        LessonStep(voice: "warm-07",
                   text: "Locked. Right fader all the way up.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "warm-08",
                   text: "And at the next phrase, the left fader down.",
                   task: "LEFT CHANNEL FADER DOWN, AT THE NEXT PHRASE", goal: .channelFader(0, 0...0.04, onThePhrase: true), target: .channel(0)),
        LessonStep(voice: "warm-09",
                   text: "Look at them. Nodding, not screaming. That's a warm-up. Leave the screaming for Helena.",
                   task: "WARM-UP", goal: .listen, target: nil),
    ])

    /// Lesson 10, chapter 5, the radio studio: the station jingle on a phrase, and ending the
    /// music exactly when the news starts.
    static let onAir = Lesson(id: "on-air", number: 10, title: "ON AIR", coach: "TÓ",
                              desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, true], room: "studio",
                                               records: ["onda-media", "antena"], chapter: 5), steps: [
        LessonStep(voice: "air-01",
                   text: "This is radio. Nobody can see you, so every second counts. Start the left record.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "air-02",
                   text: "Top right, there's a JINGLE button. The station ID. Fire it at the end of a phrase, so it lands between two blocks.",
                   task: "JINGLE (TOP RIGHT) AT THE END OF A PHRASE", goal: .jinglePlayed(onThePhrase: true), target: .jingle,
                   missVoice: "air-02-miss", missText: "Middle of a phrase. Wait for the whoosh, then fire it."),
        LessonStep(voice: "air-03",
                   text: "Now the next record, on a new phrase. Its fader's down, sync is on.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "phrase-03-miss",
                   missText: "Close, but that was the middle of a phrase. Press cue on the right deck, and wait for the whoosh.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "air-04",
                   text: "Bring it in. Right fader up.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "air-05",
                   text: "Now the hard part. The news starts on the hour. When the countdown hits zero, your music is out. Not before, not after. Both faders down, right on zero.",
                   task: "BOTH FADERS DOWN WHEN THE COUNTDOWN HITS ZERO", goal: .hitThePost(seconds: 30, window: 1.5), target: nil,
                   missVoice: "air-05-early", missText: "Too early. That's dead air before the news. Faders back up, and try again.",
                   lateVoice: "air-05-late", lateText: "Too late. You stepped on the news. Faders back up, and try again."),
        LessonStep(voice: "air-06",
                   text: "Bang on time. That's radio.",
                   task: "ON AIR", goal: .listen, target: nil),
    ])

    /// Lesson 9, chapter 4, the pub: a long blend. Bass out of the new record, start it audible
    /// but quiet, lock it, fader up, sixteen bars of both, the bass swap, out.
    static let longBlend = Lesson(id: "long-blend", number: 9, title: "LONG BLEND", coach: "TÓ",
                                  desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0.45], sync: [false, false], room: "pub",
                                                   syncAllowed: false, records: ["praia", "flauta"], chapter: 4,
                                                   // Flauta (119) pitched down to Praia's 118.
                                                   pitch: [0.5, 0.5525]), steps: [
        LessonStep(voice: "long-01",
                   text: "A pub on a Tuesday. Nobody's here to dance. They're here to drink, and you're here to make it nicer. That means long blends. Start the left record.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "long-02",
                   text: "First, take the bass out of the right one. Low knob, all the way down.",
                   task: "RIGHT LOW KNOB ALL THE WAY DOWN", goal: .eq(deck: 1, band: 0, 0...0.05), target: .eq(1, 0)),
        LessonStep(voice: "long-03",
                   text: "Now start it on a new phrase. Its fader is halfway, so you can hear what you're doing.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "phrase-03-miss",
                   missText: "Close, but that was the middle of a phrase. Press cue on the right deck, and wait for the whoosh.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "long-04",
                   text: "Lock the kicks. Nudge the rim until they're one.",
                   task: "NUDGE THE RIGHT RECORD UNTIL THE KICKS ARE ONE", goal: .phaseHeld(bars: 2, tolerance: 0.08), target: .record(1)),
        LessonStep(voice: "long-05",
                   text: "Good. Now the right fader all the way up.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "long-06",
                   text: "And now: patience. Sixteen bars of both records together. Kicks locked, one bassline. Let them talk to each other.",
                   task: "BLEND FOR SIXTEEN BARS", goal: .blendHeld(bars: 16, tolerance: 0.08), target: .record(1)),
        LessonStep(voice: "long-07",
                   text: "Now hand over the bass, on the phrase. Left low down, right low back to the middle.",
                   task: "AT THE NEXT PHRASE: LEFT LOW DOWN, RIGHT LOW TO THE MIDDLE", goal: .bassSwap(from: 0, to: 1), target: .eq(0, 0)),
        LessonStep(voice: "long-08",
                   text: "Left fader down. And that, my friend, was three minutes of nobody noticing anything. That's the job.",
                   task: "LEFT CHANNEL FADER DOWN", goal: .channelFader(0, 0...0.04, onThePhrase: false), target: .channel(0)),
    ])

    /// Lesson 7: the numbers are covered. Which record is ahead, how far, locked: all by ear.
    static let byEar = Lesson(id: "by-ear", number: 7, title: "BY EAR", coach: "LIA",
                              desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0.85], sync: [false, false], room: "shop",
                                               syncAllowed: false, records: ["mexe", "varanda"], chapter: 3, hideBPM: true), steps: [
        LessonStep(voice: "ear-01",
                   text: "No numbers today, kid. I've covered them up. Records don't come with a screen. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "ear-02",
                   text: "Now the right one, on the one. Both faders are up.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "ear-02-miss", missText: "Not the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "ear-03",
                   text: "Listen. Which one is running ahead? Don't look for an answer. Listen for it.",
                   task: "LISTEN: WHICH ONE IS AHEAD?", goal: .listen, target: nil),
        LessonStep(voice: "ear-04",
                   text: "Bring them to the same speed with the right pitch fader. Small moves, finger to the side. When the galloping slows to a crawl, you're close.",
                   task: "MATCH THE SPEED WITH THE RIGHT PITCH FADER", goal: .tempoMatched(tolerance: 0.3), target: .pitch(1)),
        LessonStep(voice: "ear-05",
                   text: "Now lock the kicks with the rim, and keep them there. By ear.",
                   task: "NUDGE THE RIGHT RECORD UNTIL THE KICKS ARE ONE", goal: .phaseHeld(bars: 4), target: .record(1)),
        LessonStep(voice: "ear-06",
                   text: "That's it. You did that without a single number. Now you're a DJ.",
                   task: "BY EAR", goal: .listen, target: nil),
    ])

    /// Lesson 8: a blend that drifts. The right record starts a hair slow; keep it locked for
    /// eight bars with little pitch rides and nudges.
    static let holdIt = Lesson(id: "hold-it", number: 8, title: "HOLD IT", coach: "LIA",
                               desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0.85], sync: [false, false], room: "shop",
                                                syncAllowed: false, records: ["dubplate", "mexe"], chapter: 3,
                                                // Mexe (124) pitched to about 123.3 against Dubplate's 123: close, never still.
                                                pitch: [0.5, 0.5353]), steps: [
        LessonStep(voice: "hold-01",
                   text: "Two records at the same tempo never stay together for long. Belts slip, motors wander. Start both, the right one on the one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "ear-02",
                   text: "Now the right one, on the one. Both faders are up.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "ear-02-miss", missText: "Not the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "hold-02",
                   text: "Match them, then lock them. Then hold it. Eight bars, and don't let it slip. Little touches. Listen for the flam before it becomes a gallop.",
                   task: "HOLD THE BLEND FOR EIGHT BARS", goal: .phaseHeld(bars: 8, tolerance: 0.08), target: .record(1)),
        LessonStep(voice: "hold-03",
                   text: "Eight bars. Steady hands. That's how you hold a blend for a whole record.",
                   task: "HOLD IT", goal: .listen, target: nil),
    ])

    /// Lesson 5, chapter 2, Rita's garage: a request. Open the crate, put the record on the free
    /// deck, sync it, bring it in on a phrase.
    static let requests = Lesson(id: "requests", number: 5, title: "REQUESTS", coach: "TÓ",
                                 desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, false], room: "garage",
                                                  records: ["telhado", "garage-door"], crate: true, chapter: 2), steps: [
        LessonStep(voice: "req-01",
                   text: "Rita's garage. Borrowed speakers, two records on the decks, and people already moving. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "req-02",
                   text: "Sara wants the one with the congas. Everybody has a request. The good ones, you play. Tap CRATE, top right.",
                   task: "TAP CRATE (TOP RIGHT)", goal: .listen, target: .crate),
        LessonStep(voice: "req-03",
                   text: "Find Conga Line, and put it on the right deck. The right one isn't playing, so it's free.",
                   task: "CRATE: CONGA LINE ON THE RIGHT DECK", goal: .recordLoaded(deck: 1, id: "conga-line"), target: .crate),
        LessonStep(voice: "req-04",
                   text: "Now press SYNC on the right deck, so it follows the left one.",
                   task: "PRESS SYNC ON THE RIGHT DECK", goal: .syncOn(1), target: .sync(1)),
        LessonStep(voice: "req-05",
                   text: "Start it on a new phrase. The fader's down, so nobody hears it yet.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "phrase-03-miss",
                   missText: "Close, but that was the middle of a phrase. Press cue on the right deck, and wait for the whoosh.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "req-06",
                   text: "Now push the right fader up.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "req-07",
                   text: "Look at her. That's what a request is for.",
                   task: "REQUEST PLAYED", goal: .listen, target: nil),
    ])

    /// Chapter 3, Lia's shop: no sync button. Hear the gallop, match the tempo with the pitch
    /// fader, lock the kicks with the rim. Both faders are up: the shop hears everything.
    static let syncOff = Lesson(id: "sync-off", number: 6, title: "SYNC OFF", coach: "LIA",
                                desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0.85], sync: [false, false],
                                                 room: "shop", syncAllowed: false), steps: [
        LessonStep(voice: "sync-01",
                   text: "My shop, my decks. And no sync button, kid. Records don't have one. Start the left one.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "sync-02",
                   text: "Now the right one. On the one, like your friend taught you. Both faders are up, so the whole shop hears it.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON THE ONE", goal: .startOnTheOne(deck: 1, against: 0), target: .play(1),
                   missVoice: "sync-02-miss",
                   missText: "That wasn't the one. Cue it, and try again.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "sync-03",
                   text: "Hear that? Horses galloping. Two kicks that won't agree. The right record is faster. A hundred and twenty four, against a hundred and twenty two.",
                   task: "LISTEN: THE KICKS GALLOP", goal: .listen, target: nil),
        LessonStep(voice: "sync-04",
                   text: "Slow it down. Push the right pitch fader up, a little at a time, until the two numbers match. For small moves, keep your finger to the side of the fader.",
                   task: "RIGHT PITCH FADER UP UNTIL BOTH SAY 122.0", goal: .tempoMatched(tolerance: 0.3), target: .pitch(1)),
        LessonStep(voice: "sync-05",
                   text: "Same speed now. But the kicks still don't land together. Touch the dotted rim of the right record. A little push forward, or hold it back, until you hear one kick. Then keep it there.",
                   task: "NUDGE THE RIGHT RECORD'S RIM UNTIL THE KICKS ARE ONE", goal: .phaseHeld(bars: 4), target: .record(1)),
        LessonStep(voice: "sync-06",
                   text: "There. One kick. That's beatmatching. Nobody learns that from a button.",
                   task: "BEATMATCHED", goal: .listen, target: nil),
        LessonStep(voice: "sync-07",
                   text: "Give the shop the new record. Crossfader all the way right.",
                   task: "CROSSFADER ALL THE WAY RIGHT", goal: .crossfader(0.96...1), target: .crossfader),
        LessonStep(voice: "sync-08",
                   text: "And stop the left one.",
                   task: "STOP THE LEFT DECK", goal: .stopDeck(0), target: .play(0)),
        LessonStep(voice: "sync-09",
                   text: "Not bad, kid. Saturday, ten o'clock. Don't be late.",
                   task: "SYNC OFF", goal: .listen, target: nil),
    ])

    /// Lesson 4: headphones. The next record is heard in one ear before the room gets it, the cue
    /// mix brings the room into that ear, and only then the fader goes up.
    static let inYourEars = Lesson(id: "in-your-ears", number: 4, title: "IN YOUR EARS", coach: "TÓ",
                                   desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, true], cueMix: 0), steps: [
        LessonStep(voice: "ears-01",
                   text: "Lesson four. Headphones. Wired ones, Bluetooth is too slow. Top right, tap PHONES, and choose split.",
                   task: "TAP PHONES (TOP RIGHT) AND CHOOSE SPLIT", goal: .phonesReady, target: nil),
        LessonStep(voice: "ears-02",
                   text: "Now your left ear is the room, and your right ear is yours alone. Start the left deck.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "ears-03",
                   text: "Under the right fader there's a button that says PHONES. Press it.",
                   task: "PRESS PHONES UNDER THE RIGHT FADER", goal: .phonesCue(1), target: .phones(1)),
        LessonStep(voice: "ears-04",
                   text: "The right fader is down. So start the right deck whenever you like. The room hears nothing. Only you.",
                   task: "PRESS PLAY ON THE RIGHT DECK", goal: .startDeck(1), target: .play(1)),
        LessonStep(voice: "ears-05",
                   text: "That is the whole trick. You get to be wrong in private. Now do it properly. Press cue, and start it on a new phrase.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "phrase-03-miss",
                   missText: "Close, but that was the middle of a phrase. Press cue on the right deck, and wait for the whoosh.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "ears-06",
                   text: "Now the little orange knob between the two PHONES buttons. Drag it up to the middle. That brings the room into your right ear too, so you hear the mix before anybody else.",
                   task: "CUE MIX KNOB TO THE MIDDLE", goal: .cueMix(0.35...0.65), target: .cueMixKnob),
        LessonStep(voice: "ears-07",
                   text: "Sounds right? Then give it to the room. Right fader up.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "ears-08",
                   text: "And at the next phrase, left fader down.",
                   task: "LEFT CHANNEL FADER DOWN, AT THE NEXT PHRASE", goal: .channelFader(0, 0...0.04, onThePhrase: true), target: .channel(0)),
        LessonStep(voice: "first-mix-08",
                   text: "And stop the left deck.",
                   task: "STOP THE LEFT DECK", goal: .stopDeck(0), target: .play(0)),
        LessonStep(voice: "ears-09",
                   text: "That's how every DJ on earth does it. You heard it first. They only heard it right.",
                   task: "IN YOUR EARS", goal: .listen, target: nil),
    ])

    /// Lesson 3: the three EQ knobs, and why the new record comes in without its bass and takes
    /// the bass over at a phrase change.
    static let bassSwap = Lesson(id: "bass-swap", number: 3, title: "THE BASS SWAP", coach: "TÓ",
                                 desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, true]), steps: [
        LessonStep(voice: "bass-01",
                   text: "Lesson three. The three knobs next to each fader. Start the left deck, and I'll show you.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "bass-02",
                   text: "Low is the kick and the bassline. Mid is the body. High is the hats. Now drag the left low knob all the way down.",
                   task: "LEFT LOW KNOB ALL THE WAY DOWN", goal: .eq(deck: 0, band: 0, 0...0.05), target: .eq(0, 0)),
        LessonStep(voice: "bass-03",
                   text: "Hear that? The floor just fell out. Put it back in the middle.",
                   task: "LEFT LOW KNOB BACK TO THE MIDDLE", goal: .eq(deck: 0, band: 0, 0.47...0.53), target: .eq(0, 0)),
        LessonStep(voice: "bass-04",
                   text: "Here's the thing. Two basslines at the same time is mud. So the next record comes in without its bass. Turn the right low knob all the way down.",
                   task: "RIGHT LOW KNOB ALL THE WAY DOWN", goal: .eq(deck: 1, band: 0, 0...0.05), target: .eq(1, 0)),
        LessonStep(voice: "bass-05",
                   text: "Good. Now start the right deck on a new phrase, like last time.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "phrase-03-miss",
                   missText: "Close, but that was the middle of a phrase. Press cue on the right deck, and wait for the whoosh.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "bass-06",
                   text: "Fader up. Hear how it slides in on top? No fight.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "bass-07",
                   text: "Now the swap. When the phrase changes: left low down, right low back to the middle. Two hands, one move.",
                   task: "AT THE NEXT PHRASE: LEFT LOW DOWN, RIGHT LOW TO THE MIDDLE", goal: .bassSwap(from: 0, to: 1), target: .eq(0, 0)),
        LessonStep(voice: "bass-08",
                   text: "Yes! That is the bass swap. Now pull the left fader all the way down.",
                   task: "LEFT CHANNEL FADER DOWN", goal: .channelFader(0, 0...0.04, onThePhrase: false), target: .channel(0)),
        LessonStep(voice: "first-mix-08",
                   text: "And stop the left deck.",
                   task: "STOP THE LEFT DECK", goal: .stopDeck(0), target: .play(0)),
        LessonStep(voice: "bass-09",
                   text: "Clean. Every DJ you love does that all night long. And Sara is still dancing, which is the whole point.",
                   task: "THE BASS SWAP", goal: .listen, target: nil),
    ])

    /// Beats in a phrase: eight bars. Every section of our records is a multiple of that, and the
    /// last bar before a new section has a rising noise and no kick on its last beat.
    static let phrase = 32.0

    /// Lesson 2, still in the bedroom: a record has to come in where a phrase starts, and it is
    /// brought in and taken out with the channel faders. SYNC still holds the tempo.
    static let onThePhrase = Lesson(id: "on-the-phrase", number: 2, title: "ON THE PHRASE", coach: "TÓ",
                                    desk: LessonDesk(crossfader: 0.5, channel: [0.85, 0], sync: [false, true]), steps: [
        LessonStep(voice: "phrase-01",
                   text: "Round two. Same room, same six people, and now they expect something. Start the left deck.",
                   task: "PRESS PLAY ON THE LEFT DECK", goal: .startDeck(0), target: .play(0)),
        LessonStep(voice: "phrase-02",
                   text: "Listen. Bars come in blocks of eight. That's a phrase. At the end of one you hear a little whoosh, and the kick drops out for a beat. That's the record telling you something new is coming.",
                   task: "LISTEN FOR THE END OF THE PHRASE", goal: .nextPhrase, target: nil),
        LessonStep(voice: "phrase-03",
                   text: "The next record has to start where a phrase starts, or the two will change at different times, and it sounds like an argument. The right fader is down, so nobody hears it yet. Press play on the right deck, on the first beat of a new phrase.",
                   task: "PRESS PLAY ON THE RIGHT DECK, ON A NEW PHRASE", goal: .startOnThePhrase(deck: 1, against: 0), target: .play(1),
                   missVoice: "phrase-03-miss",
                   missText: "Close, but that was the middle of a phrase. Press cue on the right deck, and wait for the whoosh.",
                   missTask: "PRESS CUE ON THE RIGHT DECK, THEN TRY AGAIN", missTarget: .cue(1)),
        LessonStep(voice: "phrase-04",
                   text: "That's it! Now they change together. Bring it in. Push the right channel fader up, slowly.",
                   task: "RIGHT CHANNEL FADER UP", goal: .channelFader(1, 0.8...1, onThePhrase: false), target: .channel(1)),
        LessonStep(voice: "phrase-05",
                   text: "Both records, same phrase. Now wait for the next whoosh, and pull the left fader all the way down.",
                   task: "LEFT CHANNEL FADER DOWN, AT THE NEXT PHRASE", goal: .channelFader(0, 0...0.04, onThePhrase: true), target: .channel(0)),
        LessonStep(voice: "phrase-06",
                   text: "Clean. Stop the left deck.",
                   task: "STOP THE LEFT DECK", goal: .stopDeck(0), target: .play(0)),
        LessonStep(voice: "phrase-07",
                   text: "That was a real mix. On the phrase. Mira just looked up from her phone. That never happens.",
                   task: "ON THE PHRASE", goal: .listen, target: nil),
    ])

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
    /// Channel faders, 0 = down, 1 = up.
    var channel: [Double]
    /// EQ knobs per deck: low, mid, high; 0.5 is flat.
    var eq: [[Double]]
    /// The headphone output is on (split or sound card).
    var phonesOn: Bool
    /// PHONES button per channel.
    var phones: [Bool]
    /// Cue mix knob: 0 = only the cued record, 1 = only the room.
    var cueMix: Double
    /// Tempo of each record after its pitch fader.
    var bpm: [Double]
    /// Where the right record's beat falls against the left one's, in beats (0 = together).
    var phase: Double
    /// The record on each deck (id).
    var records: [String?]
    /// SYNC per deck.
    var sync: [Bool]
    /// The room hears both records, and they have two basslines.
    var blend: Bool
    var bassClash: Bool
    /// Station jingles fired so far, and the clock (seconds).
    var jingles: Int
    var time: Double
    /// Filter knob per deck, 0.5 = off.
    var filter: [Double]
    /// The studio's pattern, per row the steps that are on; the grid's page.
    var pattern: [[Bool]]
    var page: Int
    /// Dubplates cut so far.
    var cuts: Int
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
    @Published private(set) var target: LessonTarget?
    /// The coach is talking (the music steps back a little).
    private(set) var speaking = false

    private var index = 0
    private var started = false
    private var goalMet = false
    private var missed = false
    private var misses = 0
    private var oneError = 0.0
    private var startJudged = false
    /// Whether the record was taken out near a phrase change (nil when the lesson does not ask).
    private var outOnThePhrase: Bool?
    /// What that move was, for the result card ("Out" or "Swap").
    private var phraseMove = "Out"
    private var startBeat: Double?
    /// For `blendHeld`: beats counted so far, and where the left record was last frame.
    private var heldBeats = 0.0
    private var lastBeat: Double?
    /// For `jinglePlayed`: jingles counted when the step began. For `hitThePost`: when zero is,
    /// and whether the faders must come back up before the next try.
    private var jinglesSeen: Int?
    private var postAt: Double?
    private var postRearm = false
    /// For `pickRecord`: the records on the decks last frame, wrong picks, and whether it was picked.
    private var recordsSeen: [String?]?
    private var pickMisses = 0
    private var picked = false
    /// For `rideTempo`: where the deck was a bar ago (beat, BPM), and the jolts so far.
    private var rideAnchor: (beat: Double, bpm: Double)?
    private var rideMisses = 0
    private var rode = false
    /// For `dubplateCut`: cuts counted when the step began.
    private var cutsSeen: Int?
    private var wasOn = [false, false]
    private var armed = false
    private var fresh = true
    private var voice: AVAudioPlayer?
    private let buzz = UINotificationFeedbackGenerator()

    init(lesson: Lesson) {
        self.lesson = lesson
        super.init()
    }

    /// The step to begin with (the screenshot run jumps into the middle of a lesson).
    var startAt = 0

    func begin() {
        guard !started, !lesson.steps.isEmpty else { return }
        started = true
        enter(min(max(0, startAt), lesson.steps.count - 1))
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
        heldBeats = 0
        lastBeat = nil
        jinglesSeen = nil
        postAt = nil
        postRearm = false
        recordsSeen = nil
        rideAnchor = nil
        cutsSeen = nil
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
            case .nextPhrase:
                if facts.turning[0] {
                    let from = startBeat ?? facts.beat[0]
                    startBeat = from
                    showBar(facts.beat[0])
                    // Over when the needle crosses into a phrase that began after this step did.
                    if (facts.beat[0] / Lessons.phrase).rounded(.down) > (from / Lessons.phrase).rounded(.down) { met() }
                }
            case .eq(let d, let band, let range):
                if range.contains(facts.eq[d][band]) { met() }
            case .jinglePlayed(let onThePhrase):
                let seen = jinglesSeen ?? facts.jingles
                jinglesSeen = facts.jingles
                if facts.jingles > seen {
                    var into = facts.beat[0].truncatingRemainder(dividingBy: Lessons.phrase)
                    if into < 0 { into += Lessons.phrase }
                    if !onThePhrase || min(into, Lessons.phrase - into) <= 4 {
                        met()
                    } else {
                        misses += 1
                        buzz.notificationOccurred(.warning)
                        show(text: step.missText ?? step.text, task: step.task, target: step.target)
                        if let name = step.missVoice { say(name) }
                    }
                }
                if !goalMet { showBar(facts.beat[0]) }
            case .hitThePost(let seconds, let window):
                let out = facts.channel[0] <= 0.04 && facts.channel[1] <= 0.04
                if postRearm {
                    // After a miss: faders back up, then a fresh countdown.
                    if !out {
                        postRearm = false
                        postAt = facts.time + seconds
                        show(text: step.text, task: step.task, target: step.target)
                    }
                    break
                }
                let zero = postAt ?? facts.time + seconds
                postAt = zero
                let left = zero - facts.time
                let text = left > 0 ? String(format: "NEWS IN %d:%02d", Int(left.rounded(.up)) / 60, Int(left.rounded(.up)) % 60) : "NEWS NOW"
                if text != progress { progress = text }
                if out || left < -window {
                    if out && abs(left) <= window {
                        oneError = abs(left) / 4 // the result card reads it like a start: closer is better
                        startJudged = true
                        met()
                    } else {
                        misses += 1
                        buzz.notificationOccurred(.warning)
                        postRearm = true
                        let early = out && left > window
                        show(text: (early ? step.missText : step.lateText) ?? step.text, task: "BOTH FADERS BACK UP, THEN TRY AGAIN", target: nil)
                        if let name = early ? step.missVoice : step.lateVoice { say(name) }
                    }
                }
            case .blendHeld(let bars, let tolerance):
                let beat = facts.beat[0]
                let moved = lastBeat.map { max(0, min(0.5, beat - $0)) } ?? 0
                lastBeat = beat
                var text: String
                if !(facts.turning[0] && facts.turning[1]) || !facts.blend {
                    text = "BOTH RECORDS IN THE ROOM"
                } else if abs(facts.phase) >= tolerance {
                    text = "KICKS APART — NUDGE"
                } else if facts.bassClash {
                    text = "BASS CLASH — KILL A LOW"
                } else {
                    heldBeats += moved
                    text = "BLEND \(min(bars, Int(heldBeats / 4))) OF \(bars) BARS"
                }
                if text != progress { progress = text }
                if heldBeats >= Double(bars * 4) { met() }
            case .recordLoaded(let d, let id):
                if facts.records[d] == id { met() }
            case .pickRecord(let d, let good):
                if let id = facts.records[d], good.contains(id) {
                    picked = true
                    met()
                } else {
                    // A record other than the one that was there, and not a good one: too hot.
                    let seen = recordsSeen ?? facts.records
                    if facts.records[d] != nil && facts.records[d] != seen[d] {
                        pickMisses += 1
                        buzz.notificationOccurred(.warning)
                        show(text: step.missText ?? step.text, task: step.task, target: step.target)
                        if let name = step.missVoice { say(name) }
                    }
                }
                recordsSeen = facts.records
            case .syncOn(let d):
                if facts.sync[d] { met() }
            case .tempoMatched(let tolerance):
                let gap = abs(facts.bpm[0] - facts.bpm[1])
                let text = lesson.desk.hideBPM ? "BY EAR" : (gap <= tolerance ? "MATCHED" : String(format: "%.1f BPM APART", gap))
                if text != progress { progress = text }
                if gap <= tolerance && facts.turning[0] && facts.turning[1] { met() }
            case .phaseHeld(let bars, let tolerance):
                // Counted in beats of the left record; a slip starts the count again.
                if facts.turning[0] && facts.turning[1] && abs(facts.phase) < tolerance {
                    let from = startBeat ?? facts.beat[0]
                    startBeat = from
                    let held = (facts.beat[0] - from) / 4
                    let text = "LOCKED \(min(bars, Int(held))) OF \(bars) BARS"
                    if text != progress { progress = text }
                    if held >= Double(bars) { met() }
                } else {
                    startBeat = nil
                    let text = facts.turning[0] && facts.turning[1] && !lesson.desk.hideBPM ? String(format: "%+.2f BEAT", facts.phase) : ""
                    if text != progress { progress = text }
                }
            case .phonesReady:
                if facts.phonesOn { met() }
            case .phonesCue(let d):
                if facts.phones[d] { met() }
            case .cueMix(let range):
                if range.contains(facts.cueMix) { met() }
            case .bassSwap(let from, let to):
                showBar(facts.beat[to])
                if facts.eq[from][0] <= 0.1 && (0.45...0.56).contains(facts.eq[to][0]) {
                    // Within a bar of a phrase change?
                    var into = facts.beat[to].truncatingRemainder(dividingBy: Lessons.phrase)
                    if into < 0 { into += Lessons.phrase }
                    outOnThePhrase = min(into, Lessons.phrase - into) <= 4
                    phraseMove = "Swap"
                    met()
                }
            case .channelFader(let d, let range, let onThePhrase):
                if onThePhrase { showBar(facts.beat[1 - d]) }
                if range.contains(facts.channel[d]) {
                    if onThePhrase {
                        // Within a bar of a phrase change on the record that stays?
                        var into = facts.beat[1 - d].truncatingRemainder(dividingBy: Lessons.phrase)
                        if into < 0 { into += Lessons.phrase }
                        outOnThePhrase = min(into, Lessons.phrase - into) <= 4
                    }
                    met()
                }
            case .startOnTheOne(let deck, let against), .startOnThePhrase(let deck, let against):
                // The records have to line up bar on bar, or phrase on phrase.
                var span = 4.0
                if case .startOnThePhrase = step.goal {
                    span = Lessons.phrase
                    if !missed { showBar(facts.beat[against]) }
                }
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
                    var apart = (facts.beat[against] - facts.beat[deck]).truncatingRemainder(dividingBy: span)
                    if apart < 0 { apart += span }
                    let error = min(apart, span - apart)
                    if error <= 0.4 {
                        oneError = error
                        startJudged = true
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
            case .filter(let d, let range):
                if range.contains(facts.filter[d]) { met() }
            case .studioPage(let p):
                if facts.page == p { met() }
            case .crossfaderCut:
                showBar(facts.beat[0])
                if facts.cross >= 0.96 {
                    var into = facts.beat[0].truncatingRemainder(dividingBy: Lessons.phrase)
                    if into < 0 { into += Lessons.phrase }
                    outOnThePhrase = min(into, Lessons.phrase - into) <= 4
                    phraseMove = "Cut"
                    met()
                }
            case .dubplateCut:
                let seen = cutsSeen ?? facts.cuts
                cutsSeen = seen
                if facts.cuts > seen { met() }
            case .pattern(let row, let steps):
                if facts.pattern.indices.contains(row) {
                    let on = facts.pattern[row].indices.filter { facts.pattern[row][$0] }
                    if on == steps.sorted() { met() }
                }
            case .rideTempo(let d, let target):
                let bpm = facts.bpm[d], beat = facts.beat[d]
                if let a = rideAnchor, beat >= a.beat, beat - a.beat < 4 {
                    if a.bpm - bpm > 1.5 {
                        // More than 1.5 BPM down within one bar: everybody felt the brakes.
                        rideMisses += 1
                        buzz.notificationOccurred(.warning)
                        show(text: step.missText ?? step.text, task: step.task, target: step.target)
                        if let name = step.missVoice { say(name) }
                        rideAnchor = (beat, bpm)
                    }
                } else {
                    rideAnchor = (beat, bpm)
                }
                let text = String(format: "%.1f BPM → %.0f", bpm, target)
                if text != progress { progress = text }
                if bpm <= target + 0.3 && facts.turning[d] {
                    rode = true
                    met()
                }
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

    /// Where the needle is in its phrase, for the task chip: "BAR 7 OF 8".
    private func showBar(_ beat: Double) {
        var into = beat.truncatingRemainder(dividingBy: Lessons.phrase)
        if into < 0 { into += Lessons.phrase }
        let text = "BAR \(Int(into / 4) + 1) OF 8"
        if text != progress { progress = text }
    }

    private func finish() {
        // Stars for what took skill: how close the start was and on which try, and, where the
        // lesson asks for it, taking the old record out at a phrase change.
        var earned: Int
        let misses = self.misses + pickMisses + rideMisses
        if misses == 0 && oneError <= 0.15 {
            earned = 3
        } else if misses <= 1 && oneError <= 0.3 {
            earned = 2
        } else {
            earned = 1
        }
        if outOnThePhrase == false { earned = min(earned, 2) }
        target = nil
        stars = earned
    }

    /// One line about how it went, for the result card.
    var verdict: String {
        var parts: [String] = []
        if picked {
            parts.append(pickMisses == 0 ? "Pick: right first time" : "Pick: \(pickMisses) too hot")
        }
        if rode {
            parts.append(rideMisses == 0 ? "Tempo: nobody felt it" : "Tempo: \(rideMisses) jolt\(rideMisses == 1 ? "" : "s")")
        }
        if startJudged {
            let tries = misses == 0 ? "first try" : (misses == 1 ? "second try" : "try \(misses + 1)")
            let how = oneError <= 0.15 ? "Right on it" : (oneError <= 0.3 ? "Close" : "Near enough")
            parts.append("Start: \(how.lowercased()), \(tries)")
        }
        if let out = outOnThePhrase {
            parts.append(out ? "\(phraseMove): on the phrase" : "\(phraseMove): in the middle of a phrase")
        }
        return parts.joined(separator: "   ·   ")
    }
}

/// What the lesson shows over the room: the thing to do on top, the coach's words just above the gear.
struct LessonOverlay: View {
    @ObservedObject var runner: LessonRunner
    /// Height of the room above the gear, from the top of this view.
    let roomHeight: CGFloat
    /// The coach's words above the gear (off in the studio, where the step grid is).
    var showWords = true
    let onContinue: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            if let stars = runner.stars {
                result(stars)
            } else {
                VStack(spacing: 0) {
                    // Top left, after the back button, narrow enough to stay clear of the
                    // buttons on the right; the count or countdown sits under the task.
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 6) {
                            chip
                            if !runner.progress.isEmpty { progressTag }
                        }
                        .frame(maxWidth: 400, alignment: .leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 48)
                    Spacer(minLength: 4)
                    if showWords { words }
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
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(colour)
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 16).fill(.black.opacity(0.72)))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(colour.opacity(0.6), lineWidth: 1))
    }

    /// The bar count, the countdown to the news, the reason a blend stopped counting.
    private var progressTag: some View {
        Text(runner.progress)
            .font(.system(size: 15, weight: .heavy).monospacedDigit())
            .tracking(1)
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Capsule().fill(.black.opacity(0.72)))
            .overlay(Capsule().stroke(Color.white.opacity(0.25), lineWidth: 1))
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
